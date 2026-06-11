// Logic tests for AgentMap's pure modules (run in node with stubbed window).
globalThis.window = { addEventListener() {} };

const base = new URL("../js/", import.meta.url).href;
const { sampleProject } = await import(base + 'sample.js');
const { exportProjectFile, exportBackupFile, buildHandoff, parseImportText } = await import(base + 'transfer.js');
const { computeLayout } = await import(base + 'layout.js');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ✓', label);
  else { failures++; console.error('  ✗ FAIL:', label); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('— sample project integrity');
const p = sampleProject();
const ids = new Set(p.nodes.map((n) => n.id));
ok(p.nodes.length > 25, `has ${p.nodes.length} nodes`);
ok(ids.size === p.nodes.length, 'node ids unique');
ok(p.nodes.every((n) => n.parentId === 'root' || ids.has(n.parentId)), 'all parents exist');
const parentOf = new Map(p.nodes.map((n) => [n.id, n.parentId]));
ok(p.edges.every((e) => ids.has(e.from) && ids.has(e.to)), 'edge endpoints exist');
ok(p.edges.every((e) => parentOf.get(e.from) === parentOf.get(e.to)), 'edges stay within one layer');
ok(new Set(p.edges.map((e) => e.id)).size === p.edges.length, 'edge ids unique');
const depth3 = p.nodes.some((n) => {
  let d = 1, cur = n;
  while (cur.parentId !== 'root') { d++; cur = p.nodes.find((m) => m.id === cur.parentId); }
  return d >= 3;
});
ok(depth3, 'has 3+ levels of nesting');

console.log('— project file round trip');
const file = exportProjectFile(p);
ok(file.filename.endsWith('.agentmap.json'), `filename: ${file.filename}`);
const r1 = parseImportText(file.text, file.filename);
ok(r1.kind === 'project' && r1.projects.length === 1, 'parsed as single project');
ok(r1.warnings.length === 0, `no warnings (got: ${r1.warnings.join('; ') || 'none'})`);
ok(eq(r1.projects[0], p), 'lossless round trip (deep equal)');

console.log('— backup round trip');
const p2 = sampleProject();
p2.name = 'Second System';
const bak = exportBackupFile([p, p2]);
const r2 = parseImportText(bak.text, bak.filename);
ok(r2.kind === 'backup' && r2.projects.length === 2, 'backup restores 2 projects');
ok(eq(r2.projects[0], p) && eq(r2.projects[1], p2), 'backup is lossless');

console.log('— AI handoff');
for (const depth of ['overview', 'standard', 'full']) {
  const h = buildHandoff(p, depth);
  ok(h.text.length > 800, `${depth}: ${Math.round(h.text.length / 1024)} KB built`);
  ok(h.text.includes('## How to read this map'), `${depth}: self-describing`);
}
const std = buildHandoff(p, 'standard');
const full = buildHandoff(p, 'full');
const ovw = buildHandoff(p, 'overview');
ok(full.text.length > std.text.length && std.text.length > ovw.text.length, 'depths are ordered by size');
ok(full.text.includes('check_citations'), 'full handoff embeds file contents');
const r3 = parseImportText(std.text, std.filename);
ok(eq(r3.projects[0], p), 'standard .md re-imports losslessly');
const r4 = parseImportText(full.text, full.filename);
ok(eq(r4.projects[0], p), 'full .md re-imports losslessly');
let threw = false;
try { parseImportText(ovw.text, ovw.filename); } catch (e) { threw = /Overview/.test(e.message); }
ok(threw, 'overview .md rejects with a helpful message');

console.log('— malformed input handling');
let msg = '';
try { parseImportText('{"hello": 1}', 'x.json'); } catch (e) { msg = e.message; }
ok(/isn't an AgentMap export/.test(msg), 'foreign JSON rejected gracefully');
const mangled = JSON.parse(file.text);
mangled.project.nodes[3].parentId = 'nonexistent-id';
mangled.project.edges.push({ id: 'bad', from: 'nope', to: mangled.project.nodes[0].id });
delete mangled.project.nodes[5].x;
const r5 = parseImportText(JSON.stringify(mangled), 'mangled.json');
ok(r5.projects.length === 1 && r5.warnings.length >= 3, `repairs + warns (${r5.warnings.length} warnings)`);
ok(r5.projects[0].nodes.every((n) => n.parentId === 'root' || r5.projects[0].nodes.some((m) => m.id === n.parentId)), 'repaired parents valid');

console.log('— bare project JSON (no wrapper)');
const bare = parseImportText(JSON.stringify(p), 'bare.json');
ok(bare.projects.length === 1 && bare.warnings.length >= 1, 'bare project accepted with warning');

console.log('— auto layout');
const rootNodes = p.nodes.filter((n) => n.parentId === 'root');
const rootIds = new Set(rootNodes.map((n) => n.id));
const rootEdges = p.edges.filter((e) => rootIds.has(e.from) && rootIds.has(e.to));
const sizes = new Map(rootNodes.map((n) => [n.id, { w: 216, h: 88 }]));
const placed = computeLayout(rootNodes, rootEdges, sizes);
ok(placed.size === rootNodes.length, 'every node placed');
const positions = [...placed.values()];
ok(positions.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), 'positions finite');
const overlaps = positions.filter((a, i) => positions.some((b, j) => j > i && Math.abs(a.x - b.x) < 100 && Math.abs(a.y - b.y) < 40)).length;
ok(overlaps === 0, 'no overlapping placements');
// cycle robustness (Writer ⇄ Critic exists inside Synthesis)
const syn = p.nodes.find((n) => n.title === 'Synthesis');
const synKids = p.nodes.filter((n) => n.parentId === syn.id);
const synIds = new Set(synKids.map((n) => n.id));
const synEdges = p.edges.filter((e) => synIds.has(e.from) && synIds.has(e.to));
const placed2 = computeLayout(synKids, synEdges, new Map(synKids.map((n) => [n.id, { w: 216, h: 88 }])));
ok(placed2.size === synKids.length, 'layout survives a cycle');
ok([...placed2.values()].every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), 'cycle positions are finite');
// pure 2-cycle: no column-0 entry point — regression test for sparse column NaN
const cyc = [{ id: 'w', y: 0 }, { id: 'c', y: 10 }];
const cycPlaced = computeLayout(cyc, [{ from: 'w', to: 'c' }, { from: 'c', to: 'w' }], new Map());
ok([...cycPlaced.values()].every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), 'pure cycle layout is finite');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TESTS PASSED');
process.exit(failures ? 1 : 0);
