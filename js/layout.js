// Auto-layout: layered left→right flow for connected nodes, a tidy grid for isolated ones.
// Pure function — returns target positions, the canvas animates to them.

const GAP_X = 130;
const GAP_Y = 44;
const GRID = 12;

const snap = (v) => Math.round(v / GRID) * GRID;

export function computeLayout(nodes, edges, sizes) {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const within = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to);

  const out = new Map();   // id -> [targets]
  const indeg = new Map(ids.map((i) => [i, 0]));
  for (const e of within) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const degree = new Map(ids.map((i) => [i, 0]));
  for (const e of within) {
    degree.set(e.from, degree.get(e.from) + 1);
    degree.set(e.to, degree.get(e.to) + 1);
  }

  const connected = ids.filter((i) => degree.get(i) > 0);
  const isolated = ids.filter((i) => degree.get(i) === 0);

  /* topological order (Kahn); cycles broken by appending leftovers */
  const order = [];
  const deg = new Map(indeg);
  let queue = connected.filter((i) => deg.get(i) === 0);
  const seen = new Set();
  while (queue.length) {
    queue.sort((a, b) => (degree.get(b) - degree.get(a)));
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    order.push(cur);
    for (const t of out.get(cur) || []) {
      deg.set(t, deg.get(t) - 1);
      if (deg.get(t) <= 0 && !seen.has(t)) queue.push(t);
    }
  }
  for (const i of connected) if (!seen.has(i)) order.push(i); // cycle members

  /* longest-path column assignment */
  const col = new Map(connected.map((i) => [i, 0]));
  for (const cur of order) {
    for (const t of out.get(cur) || []) {
      if (col.get(t) <= col.get(cur)) col.set(t, Math.min(col.get(cur) + 1, connected.length));
    }
  }

  /* group by column, order rows by barycenter of predecessors for fewer crossings */
  const preds = new Map(connected.map((i) => [i, []]));
  for (const e of within) if (preds.has(e.to)) preds.get(e.to).push(e.from);

  /* cycles can leave early columns empty — remap to dense indices so the
     placement math never sees holes */
  const used = [...new Set(connected.map((i) => col.get(i)))].sort((a, b) => a - b);
  const dense = new Map(used.map((v, k) => [v, k]));
  const cols = [];
  for (const i of connected) {
    const c = dense.get(col.get(i));
    (cols[c] = cols[c] || []).push(i);
  }
  const rowOf = new Map();
  cols.forEach((list, c) => {
    if (!list) return;
    if (c === 0) {
      list.sort((a, b) => (nodes.find((n) => n.id === a)?.y ?? 0) - (nodes.find((n) => n.id === b)?.y ?? 0));
    } else {
      const bary = (i) => {
        const ps = (preds.get(i) || []).filter((x) => rowOf.has(x));
        if (!ps.length) return 1e9;
        return ps.reduce((s, x) => s + rowOf.get(x), 0) / ps.length;
      };
      list.sort((a, b) => bary(a) - bary(b));
    }
    list.forEach((i, r) => rowOf.set(i, r));
  });

  /* place columns */
  const result = new Map();
  const sizeOf = (i) => sizes.get(i) || { w: 216, h: 80 };
  let x = 0;
  const colHeights = cols.map((list) => (list || []).reduce((s, i) => s + sizeOf(i).h + GAP_Y, -GAP_Y));
  const maxH = Math.max(0, ...colHeights);
  cols.forEach((list, c) => {
    if (!list || !list.length) return;
    const w = Math.max(...list.map((i) => sizeOf(i).w));
    let y = (maxH - colHeights[c]) / 2;
    for (const i of list) {
      result.set(i, { x: snap(x), y: snap(y) });
      y += sizeOf(i).h + GAP_Y;
    }
    x += w + GAP_X;
  });

  /* isolated nodes: grid to the right of the flow */
  if (isolated.length) {
    const perCol = Math.max(2, Math.ceil(Math.sqrt(isolated.length)));
    isolated.sort((a, b) => (nodes.find((n) => n.id === a)?.y ?? 0) - (nodes.find((n) => n.id === b)?.y ?? 0));
    let ix = x + (connected.length ? GAP_X / 2 : 0);
    let iy = 0, row = 0, colW = 0;
    for (const i of isolated) {
      const s = sizeOf(i);
      result.set(i, { x: snap(ix), y: snap(iy) });
      colW = Math.max(colW, s.w);
      iy += s.h + GAP_Y;
      if (++row >= perCol) { row = 0; iy = 0; ix += colW + GAP_X / 2; colW = 0; }
    }
  }

  return result;
}
