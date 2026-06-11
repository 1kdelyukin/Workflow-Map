// Unit tests for the MCP dispatcher + core model operations, run against an
// in-memory store (no network, no database).
globalThis.window = { addEventListener() {} };

const base = new URL('../', import.meta.url).href;
const { createMcp } = await import(base + 'api/_lib/mcp.js');
const { sampleProject } = await import(base + 'js/sample.js');
const { exportProjectFile, buildHandoff } = await import(base + 'js/transfer.js');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ✓', label);
  else { failures++; console.error('  ✗ FAIL:', label); }
};

function memStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    async list() { return [...rows.values()]; },
    async listMeta() { return [...rows.values()].map(({ id, name, version, updatedAt }) => ({ id, name, version, updatedAt })); },
    async get(id) { return rows.get(id) || null; },
    async put(id, project, { expectedVersion = null } = {}) {
      const existing = rows.get(id);
      if (expectedVersion != null && existing && existing.version !== expectedVersion) {
        const err = new Error('conflict');
        err.code = 'conflict';
        err.current = existing;
        throw err;
      }
      const row = {
        id,
        name: project.name || '',
        data: structuredClone(project),
        version: (existing?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      rows.set(id, row);
      return { version: row.version, updatedAt: row.updatedAt };
    },
    async del(id) { return rows.delete(id); },
  };
}

const store = memStore();
const mcp = createMcp(store, { appUrl: 'http://test' });

let nextId = 1;
async function rpc(method, params) {
  return mcp.handleBody({ jsonrpc: '2.0', id: nextId++, method, params });
}
async function tool(name, args) {
  const out = await rpc('tools/call', { name, arguments: args });
  const result = out.json.result;
  const text = result.content[0].text;
  let value = text;
  try { value = JSON.parse(text); } catch { /* plain text tool */ }
  return { value, text, isError: !!result.isError };
}

console.log('— protocol basics');
{
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  ok(init.status === 200 && init.json.result.protocolVersion === '2025-03-26', 'initialize echoes a supported protocol version');
  ok(init.json.result.serverInfo.name === 'agentmap', 'serverInfo present');
  ok(/get_tree/.test(init.json.result.instructions), 'instructions teach the tool flow');
  const initFuture = await rpc('initialize', { protocolVersion: '2099-01-01' });
  ok(initFuture.json.result.protocolVersion === '2025-06-18', 'unknown protocol version → latest supported');
  const notif = await mcp.handleBody({ jsonrpc: '2.0', method: 'notifications/initialized' });
  ok(notif.status === 202 && notif.json === undefined, 'notifications → 202, no body');
  const list = await rpc('tools/list');
  ok(list.json.result.tools.length === 16, `tools/list exposes ${list.json.result.tools.length} tools`);
  ok(list.json.result.tools.every((t) => t.description && t.inputSchema?.type === 'object'), 'every tool has description + schema');
  const nope = await rpc('does/not/exist');
  ok(nope.json.error?.code === -32601, 'unknown method → -32601');
  const badTool = await rpc('tools/call', { name: 'nope', arguments: {} });
  ok(badTool.json.error?.code === -32602, 'unknown tool → -32602');
  const batch = await mcp.handleBody([
    { jsonrpc: '2.0', id: 'a', method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/whatever' },
  ]);
  ok(batch.status === 200 && Array.isArray(batch.json) && batch.json.length === 1, 'batch: responses only for requests');
}

console.log('— project lifecycle');
let pid;
{
  const created = await tool('create_project', { name: 'Test System', description: 'desc' });
  pid = created.value.project_id;
  ok(!!pid && created.value.url.includes(pid), 'create_project returns id + url');
  const list = await tool('list_projects', {});
  ok(list.value.projects.length === 1 && list.value.projects[0].name === 'Test System', 'list_projects shows it');
}

console.log('— add_components');
{
  const r = await tool('add_components', {
    project_id: pid,
    components: [
      { id: 'a', type: 'phase', title: 'Intake', summary: 'first' },
      { id: 'b', type: 'agent', title: 'Worker' },
      { id: 'c', type: 'skill', title: 'Inner Skill', parent_id: 'b', content: 'do the thing' },
      { id: 'a', type: 'bogus', title: 'Dupe id, bad type' },
    ],
    connections: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ],
  });
  ok(r.value.created.length === 4, 'four components created');
  ok(r.value.created[3].id !== 'a', 'duplicate id got a fresh one');
  ok(r.value.warnings.some((w) => /Unknown type/.test(w)), 'bad type warned');
  ok(r.value.warnings.some((w) => /different layers/.test(w)), 'cross-layer connection skipped with warning');
}

console.log('— read projections');
{
  const tree = await tool('get_tree', { project_id: pid });
  const worker = tree.value.components.find((c) => c.id === 'b');
  ok(worker?.components?.[0]?.id === 'c', 'tree nests c under b');
  ok(worker.components[0].content_chars === 'do the thing'.length, 'tree reports content size, not content');
  ok(tree.value.connections.length === 1 && tree.value.connections[0].from_title === 'Intake', 'tree lists the valid connection');
  ok(tree.value.components.every((c) => c.summary === undefined || typeof c.summary === 'string'), 'summaries inline');

  const comp = await tool('get_component', { project_id: pid, component_id: 'c' });
  ok(comp.value.content === 'do the thing' && comp.value.breadcrumb === 'Worker ▸ Inner Skill', 'get_component: content + breadcrumb');

  const found = await tool('search', { project_id: pid, query: 'the thing' });
  ok(found.value.results.length === 1 && found.value.results[0].matched.includes('content') && /the thing/.test(found.value.results[0].snippet), 'search hits content with snippet');

  const overview = await tool('get_overview', { project_id: pid });
  ok(/How to read this map/.test(overview.text), 'overview is the self-describing doc');
}

console.log('— edits');
{
  const up = await tool('update_component', { project_id: pid, component_id: 'a', title: 'Intake Phase', summary: 'updated' });
  ok(up.value.component.title === 'Intake Phase', 'rename works');

  const badType = await tool('update_component', { project_id: pid, component_id: 'a', type: 'starship' });
  ok(badType.isError && /Unknown type/.test(badType.text), 'invalid type → tool error with guidance');

  const move = await tool('update_component', { project_id: pid, component_id: 'a', parent_id: 'b' });
  ok(move.value.warnings.some((w) => /dropped 1 connection/.test(w)), 'reparent drops cross-layer edge with warning');

  const cyc = await tool('update_component', { project_id: pid, component_id: 'b', parent_id: 'c' });
  ok(cyc.isError && /inside itself/.test(cyc.text), 'containment cycle rejected');

  const conn = await tool('connect', { project_id: pid, from_id: 'a', to_id: 'c' });
  ok(conn.value.connection.from === 'a' && conn.value.connection.kind === 'flow', 'connect now-siblings works (default kind flow)');
  const dup = await tool('connect', { project_id: pid, from_id: 'a', to_id: 'c' });
  ok(dup.isError && /already exists/.test(dup.text), 'duplicate connection rejected');
  const rekind = await tool('connect', { project_id: pid, from_id: 'a', to_id: 'c', kind: 'callback' });
  ok(rekind.value.connection.kind === 'callback' && /changed its kind/.test(rekind.value.note), 'connect on existing pair changes its kind');
  const badKind = await tool('connect', { project_id: pid, from_id: 'a', to_id: 'c', kind: 'wormhole' });
  ok(badKind.isError && /Unknown connection kind/.test(badKind.text), 'invalid kind → tool error with guidance');
  const ktree = await tool('get_tree', { project_id: pid });
  ok(ktree.value.connections.some((c) => c.from === 'a' && c.to === 'c' && c.kind === 'callback'), 'get_tree reports connection kinds');
  const kcomp = await tool('get_component', { project_id: pid, component_id: 'c', include_content: false });
  ok(kcomp.value.connections.in.some((c) => c.id === 'a' && c.kind === 'callback'), 'get_component reports connection kinds');
  const disc = await tool('disconnect', { project_id: pid, from_id: 'a', to_id: 'c' });
  ok(disc.value.removed.from === 'a', 'disconnect works');

  const del = await tool('delete_components', { project_id: pid, component_ids: ['b'] });
  ok(del.value.removed.length === 3, 'deleting container cascades to nested components');
  const tree = await tool('get_tree', { project_id: pid });
  ok(tree.value.stats.components === 1, 'one component left');
}

console.log('— import / export');
{
  const sample = sampleProject();
  const file = exportProjectFile(sample);
  const imp = await tool('import_project', { data: file.text });
  ok(imp.value.imported[0].components === sample.nodes.length, 'sample import: all components arrive');
  ok(imp.value.warnings.length === 0, 'sample import: no warnings');
  const sid = imp.value.imported[0].project_id;

  const again = await tool('import_project', { data: file.text });
  ok(again.value.imported[0].project_id !== sid, 'create mode: same id → new project');
  ok(again.value.warnings.some((w) => /replace/.test(w)), 'and a warning points at mode replace');
  await tool('delete_project', { project_id: again.value.imported[0].project_id });

  const exported = await tool('export_project', { project_id: sid, format: 'json' });
  const reparsed = JSON.parse(exported.text);
  ok(reparsed.format === 'agentmap/project@1' && reparsed.project.nodes.length === sample.nodes.length, 'export json is lossless agentmap format');

  const replaced = await tool('import_project', { data: exported.text, mode: 'replace' });
  ok(replaced.value.imported[0].project_id === sid, 'replace mode keeps the id (round-trip update)');

  const handoff = buildHandoff(sample, 'standard');
  const fromMd = await tool('import_project', { data: handoff.text });
  ok(fromMd.value.imported[0].components === sample.nodes.length, 'standard handoff markdown imports');
  await tool('delete_project', { project_id: fromMd.value.imported[0].project_id });

  // positionless import → auto-arranged
  const bare = structuredClone(sample);
  for (const n of bare.nodes) { delete n.x; delete n.y; }
  bare.id = 'bare-1';
  const arranged = await tool('import_project', { data: JSON.stringify(bare) });
  ok(arranged.value.warnings.some((w) => /auto-arranged/.test(w)), 'positionless import reports auto-arrange');
  const arrangedId = arranged.value.imported[0].project_id;
  const row = await store.get(arrangedId);
  ok(row.data.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), 'every imported node got coordinates');
  const xs = new Set(row.data.nodes.filter((n) => n.parentId === 'root').map((n) => `${n.x},${n.y}`));
  ok(xs.size === row.data.nodes.filter((n) => n.parentId === 'root').length, 'no two top-level nodes share a position');
  await tool('delete_project', { project_id: arrangedId });

  const arr = await tool('arrange', { project_id: sid, recursive: true });
  ok(arr.value.layers_arranged >= 2, 'recursive arrange touches sub-layers');

  const gone = await tool('delete_project', { project_id: sid });
  ok(gone.value.deleted.project_id === sid, 'delete_project');
  const missing = await tool('get_tree', { project_id: sid });
  ok(missing.isError && /list_projects/.test(missing.text), 'reads on deleted project → helpful error');
}

console.log('— concurrency');
{
  const created = await tool('create_project', { name: 'Racy' });
  const rid = created.value.project_id;
  // simulate a competing writer bumping the version between read and write:
  const realGet = store.get.bind(store);
  let raced = false;
  store.get = async (id) => {
    const row = await realGet(id);
    if (!raced && id === rid) {
      raced = true;
      await store.put(rid, { ...row.data, description: 'racer was here' });
    }
    return row;
  };
  const r = await tool('add_components', { project_id: rid, components: [{ title: 'Late arrival' }] });
  store.get = realGet;
  ok(!r.isError && r.value.created.length === 1, 'mutation retries through a version conflict');
  const tree = await tool('get_tree', { project_id: rid });
  ok(tree.value.stats.components === 1, 'late component survived the race');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL MCP TESTS PASSED');
process.exit(failures ? 1 : 0);
