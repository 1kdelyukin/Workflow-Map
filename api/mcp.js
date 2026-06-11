// MCP endpoint (Streamable HTTP, stateless). Connect with:
//   claude mcp add --transport http agentmap https://<host>/api/mcp \
//     --header "Authorization: Bearer <AGENTMAP_TOKEN>"
import { requireAuth } from './_lib/auth.js';
import { getStore } from './_lib/store.js';
import { createMcp } from './_lib/mcp.js';

function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return '';
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    // Stateless server: no SSE stream (GET) and no session to delete (DELETE).
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed — POST JSON-RPC messages to this endpoint.' });
    return;
  }
  if (!requireAuth(req, res)) return;
  const store = await getStore();
  if (!store) { res.status(503).json({ error: 'No database configured.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = undefined; } }
  if (body === undefined || body === null) {
    res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: body must be JSON' } });
    return;
  }

  const mcp = createMcp(store, { appUrl: originOf(req) });
  const out = await mcp.handleBody(body);
  if (out.json !== undefined) res.status(out.status).json(out.json);
  else res.status(out.status).end();
}
