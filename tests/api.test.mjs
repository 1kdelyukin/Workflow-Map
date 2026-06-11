// End-to-end tests: spawn the dev server (file store, temp dir) and exercise the
// REST API, owner auth, and MCP endpoint over real HTTP — the same surface
// Vercel exposes.
globalThis.window = { addEventListener() {} };

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = new URL('../', import.meta.url).href;
const { sampleProject } = await import(base + 'js/sample.js');

const PORT = 5641;
const TOKEN = 'e2e-secret';
const OWNER = 'owner@example.test';
const URL_ = `http://localhost:${PORT}`;
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ✓', label);
  else { failures++; console.error('  ✗ FAIL:', label); }
};

const dataDir = await mkdtemp(path.join(tmpdir(), 'agentmap-e2e-'));
const server = spawn(process.execPath, [new URL('../scripts/dev-server.mjs', import.meta.url).pathname], {
  env: {
    ...process.env,
    PORT: String(PORT),
    AGENTMAP_TOKEN: TOKEN,
    AGENTMAP_OWNER_EMAIL: OWNER,
    AGENTMAP_DATA_DIR: dataDir,
    DATABASE_URL: '',
    POSTGRES_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${URL_}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

const post = (path_, body, headers = {}) =>
  fetch(`${URL_}${path_}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function mcp(method, params, id = 1) {
  const res = await fetch(`${URL_}/api/mcp`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}
async function tool(name, args) {
  const { body } = await mcp('tools/call', { name, arguments: args });
  const text = body.result.content[0].text;
  let value = text;
  try { value = JSON.parse(text); } catch { /* text tool */ }
  return { value, text, isError: !!body.result.isError };
}

try {
  await waitForServer();

  console.log('— health, public reads, security headers');
  {
    const healthRes = await fetch(`${URL_}/api/health`);
    const health = await healthRes.json();
    ok(health.ok && health.remote === true && health.storage === 'file' && health.mcp === true, 'health reports remote + mcp');
    ok(healthRes.headers.get('x-content-type-options') === 'nosniff' && healthRes.headers.get('x-frame-options') === 'DENY', 'security headers set');
    ok((await fetch(`${URL_}/api/projects`)).status === 200, 'project list is public (view-only access)');
    ok((await fetch(`${URL_}/api/mcp`, { headers: AUTH })).status === 405, 'GET /api/mcp → 405 (stateless server)');
    const noAuthMcp = await fetch(`${URL_}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    ok(noAuthMcp.status === 401, 'MCP without token → 401');
    const staticApp = await fetch(`${URL_}/`);
    ok(staticApp.ok && /AgentMap/.test(await staticApp.text()), 'static app served from the same origin');
  }

  console.log('— owner registration (exactly once, owner email only)');
  let cookie = '';
  {
    const me0 = await (await fetch(`${URL_}/api/auth/me`)).json();
    ok(me0.registered === false && me0.authenticated === false, 'me: fresh deployment is unregistered');

    ok((await post('/api/auth/register', { email: 'intruder@evil.test', password: 'longenough1' })).status === 403, 'foreign email cannot register');
    ok((await post('/api/auth/register', { email: OWNER, password: 'short' })).status === 400, 'short password rejected');

    const reg = await post('/api/auth/register', { email: OWNER.toUpperCase(), password: 'correct horse 9' });
    ok(reg.status === 200, 'owner registers (case-insensitive email)');
    const setCookie = reg.headers.get('set-cookie') || '';
    ok(/agentmap_session=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), 'session cookie is HttpOnly + SameSite=Lax');
    cookie = setCookie.split(';')[0];

    ok((await post('/api/auth/register', { email: OWNER, password: 'another pass 9' })).status === 409, 'second registration is closed');

    const me1 = await (await fetch(`${URL_}/api/auth/me`, { headers: { Cookie: cookie } })).json();
    ok(me1.registered === true && me1.authenticated === true && me1.email === OWNER, 'me: cookie authenticates the owner');
    const me2 = await (await fetch(`${URL_}/api/auth/me`)).json();
    ok(me2.registered === true && me2.authenticated === false, 'me: no cookie → viewer');
  }

  console.log('— login / logout');
  {
    ok((await post('/api/auth/login', { email: OWNER, password: 'wrong password' })).status === 401, 'wrong password rejected');
    ok((await post('/api/auth/login', { email: 'other@x.test', password: 'correct horse 9' })).status === 401, 'wrong email rejected');
    const login = await post('/api/auth/login', { email: OWNER, password: 'correct horse 9' });
    ok(login.status === 200, 'correct login succeeds');
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];

    const out = await post('/api/auth/logout', {}, { Cookie: cookie });
    ok(/Max-Age=0/.test(out.headers.get('set-cookie') || ''), 'logout clears the cookie');
    // the signed token itself is stateless; get a fresh one for the write tests
    const again = await post('/api/auth/login', { email: OWNER, password: 'correct horse 9' });
    cookie = (again.headers.get('set-cookie') || '').split(';')[0];
  }

  console.log('— write protection');
  const sample = sampleProject();
  {
    const anon = await fetch(`${URL_}/api/projects/${sample.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample),
    });
    ok(anon.status === 401, 'anonymous PUT → 401');

    const viaCookie = await fetch(`${URL_}/api/projects/${sample.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(sample),
    });
    ok(viaCookie.status === 200 && (await viaCookie.json()).version === 1, 'owner session PUT works');

    const badOrigin = await fetch(`${URL_}/api/projects/${sample.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' },
      body: JSON.stringify(sample),
    });
    ok(badOrigin.status === 401, 'cookie PUT with foreign Origin → 401 (CSRF check)');

    const viaToken = await fetch(`${URL_}/api/projects/${sample.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...AUTH, 'X-AgentMap-Version': '1' }, body: JSON.stringify(sample),
    });
    ok(viaToken.status === 200 && (await viaToken.json()).version === 2, 'bearer-token PUT works (AI assistants)');

    const stale = await fetch(`${URL_}/api/projects/${sample.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...AUTH, 'X-AgentMap-Version': '1' }, body: JSON.stringify(sample),
    });
    ok(stale.status === 409 && (await stale.json()).current?.version === 2, 'stale versioned PUT → 409 with current copy');

    const pub = await (await fetch(`${URL_}/api/projects/${sample.id}`)).json();
    ok(pub.nodes.length === sample.nodes.length && pub.version === 2, 'anonymous GET sees the project (view-only)');
    const metas = await (await fetch(`${URL_}/api/projects?meta=1`)).json();
    ok(metas.length === 1 && metas[0].version === 2, 'meta polling is public');
  }

  console.log('— MCP over HTTP (bearer)');
  {
    const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    ok(init.status === 200 && init.body.result.protocolVersion === '2025-06-18', 'initialize over HTTP');

    const list = await tool('list_projects', {});
    ok(list.value.projects.length === 1 && list.value.projects[0].id === sample.id, 'MCP sees the project');

    const add = await tool('add_components', {
      project_id: sample.id,
      components: [{ id: 'e2e-probe', type: 'doc', title: 'E2E Probe', summary: 'added over MCP' }],
    });
    ok(!add.isError && add.value.created[0].id === 'e2e-probe', 'MCP mutation works');

    const meta = await (await fetch(`${URL_}/api/projects?meta=1`)).json();
    ok(meta[0].version === 3, 'MCP write bumped the version (browser polling picks it up)');

    const del = await fetch(`${URL_}/api/projects/${sample.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    ok(del.status === 200 && (await del.json()).deleted === true, 'owner DELETE works');
    ok((await fetch(`${URL_}/api/projects/${sample.id}`)).status === 404, 'GET after delete → 404');
  }
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL API TESTS PASSED');
process.exit(failures ? 1 : 0);
