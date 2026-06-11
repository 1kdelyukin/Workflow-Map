// Local dev & self-host server: serves the static app and mounts the api/
// functions with Vercel-style (req, res) shims. Zero dependencies.
//
//   node scripts/dev-server.mjs
//
// Env:
//   PORT               default 5173
//   AGENTMAP_TOKEN     access token for /api (default "dev-token", printed on boot)
//   AGENTMAP_DATA_DIR  where projects are stored (default ./data)
//   DATABASE_URL       use Postgres instead of file storage (needs `npm install`)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  process.env.AGENTMAP_DATA_DIR ||= path.join(root, 'data');
}
let generatedToken = false;
if (!process.env.AGENTMAP_TOKEN) {
  process.env.AGENTMAP_TOKEN = 'dev-token';
  generatedToken = true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function routeApi(pathname) {
  if (pathname === '/api/health') return { load: () => import('../api/health.js') };
  if (pathname === '/api/mcp') return { load: () => import('../api/mcp.js') };
  if (pathname === '/api/projects') return { load: () => import('../api/projects/index.js') };
  const m = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (m) return { load: () => import('../api/projects/[id].js'), params: { id: decodeURIComponent(m[1]) } };
  const a = pathname.match(/^\/api\/auth\/([a-z]+)$/);
  if (a) return { load: () => import('../api/auth/[action].js'), params: { action: a[1] } };
  return null;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function shimRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
  res.send = (body) => res.end(body);
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] || '').includes('json')) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end('Method not allowed'); return; }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
  const blocked = ['data', 'node_modules', 'api', 'scripts', '.git'].some(
    (d) => file.startsWith(path.join(root, d) + path.sep) || file === path.join(root, d));
  if (!file.startsWith(root + path.sep) || blocked) { res.statusCode = 404; res.end('Not found'); return; }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  shimRes(res);
  securityHeaders(res);
  try {
    const route = await routeApi(url.pathname);
    if (route) {
      req.body = await readBody(req);
      req.query = { ...Object.fromEntries(url.searchParams), ...(route.params || {}) };
      const { default: handler } = await route.load();
      await handler(req, res);
      if (!res.writableEnded) res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.status(404).json({ error: 'Not found' }); return; }
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('[dev-server]', req.method, url.pathname, e);
    if (!res.writableEnded) res.status(500).json({ error: e.message });
  }
});

const port = Number(process.env.PORT) || 5173;
server.listen(port, () => {
  console.log(`AgentMap running at http://localhost:${port}`);
  console.log(`  storage: ${process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'postgres' : process.env.AGENTMAP_DATA_DIR}`);
  console.log(`  token:   ${process.env.AGENTMAP_TOKEN}${generatedToken ? '  (dev default — set AGENTMAP_TOKEN to change)' : ''}`);
  console.log(`  MCP:     claude mcp add --transport http agentmap http://localhost:${port}/api/mcp --header "Authorization: Bearer ${process.env.AGENTMAP_TOKEN}"`);
});
