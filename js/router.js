// Orthogonal connection routing for grid-locked mode: Manhattan paths that snap
// to the canvas grid and steer around node cards. Pure geometry — no DOM, no state.

const STEP = 12;        // grid step routes snap to (matches canvas SNAP)
const MARGIN = 18;      // clearance kept between a route and any card
const TURN = 30;        // A* penalty per bend — prefers straighter routes

const snap = (v) => Math.round(v / STEP) * STEP;
const dirOf = (x, y) => (x > 0 ? 0 : x < 0 ? 1 : y > 0 ? 2 : 3); // 0:+x 1:-x 2:+y 3:-y

/* Port selection — same dominant-axis rule as the curved renderer, so the
   arrows attach to the same card sides whichever mode is on. */
export function orthoPorts(g1, g2) {
  const c1 = { x: g1.x + g1.w / 2, y: g1.y + g1.h / 2 };
  const c2 = { x: g2.x + g2.w / 2, y: g2.y + g2.h / 2 };
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = dx >= 0 ? 1 : -1;
    return {
      a: { x: c1.x + s * (g1.w / 2), y: c1.y }, da: { x: s, y: 0 },
      b: { x: c2.x - s * (g2.w / 2), y: c2.y }, db: { x: -s, y: 0 },
    };
  }
  const s = dy >= 0 ? 1 : -1;
  return {
    a: { x: c1.x, y: c1.y + s * (g1.h / 2) }, da: { x: 0, y: s },
    b: { x: c2.x, y: c2.y - s * (g2.h / 2) }, db: { x: 0, y: -s },
  };
}

/* Drop duplicate and collinear points (including overlap reversals). */
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const u = out[out.length - 1];
    if (u && u.x === p.x && u.y === p.y) continue;
    out.push({ x: p.x, y: p.y });
    while (out.length >= 3) {
      const s = out[out.length - 1], q = out[out.length - 2], r = out[out.length - 3];
      if (!((r.x === q.x && q.x === s.x) || (r.y === q.y && q.y === s.y))) break;
      out.splice(out.length - 2, 1);
      const v = out[out.length - 1], w = out[out.length - 2];
      if (w && v.x === w.x && v.y === w.y) out.pop();
    }
  }
  return out;
}

/* Reconnect a manually shaped route: ports may have moved since the waypoints
   were saved, so insert right-angle bends wherever a joint went diagonal. */
export function withBends(a, da, points, b) {
  const out = [{ x: a.x, y: a.y }];
  let horiz = da.x !== 0;
  for (const p of [...points, b]) {
    const u = out[out.length - 1];
    if (p.x !== u.x && p.y !== u.y) {
      out.push(horiz ? { x: p.x, y: u.y } : { x: u.x, y: p.y });
    }
    const v = out[out.length - 1];
    if (p.y === v.y && p.x !== v.x) horiz = true;
    else if (p.x === v.x && p.y !== v.y) horiz = false;
    out.push({ x: p.x, y: p.y });
  }
  return simplify(out);
}

/* Polyline → SVG path with rounded corners. */
export function polyToPath(pts, r = 7) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], u = pts[i - 1], v = pts[i + 1];
    const lu = Math.hypot(p.x - u.x, p.y - u.y), lv = Math.hypot(v.x - p.x, v.y - p.y);
    const k = Math.min(r, lu / 2, lv / 2);
    if (!(k > 0.5)) { d += ` L ${p.x} ${p.y}`; continue; }
    const p1 = { x: p.x - ((p.x - u.x) / lu) * k, y: p.y - ((p.y - u.y) / lu) * k };
    const p2 = { x: p.x + ((v.x - p.x) / lv) * k, y: p.y + ((v.y - p.y) / lv) * k };
    d += ` L ${p1.x} ${p1.y} Q ${p.x} ${p.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L ${last.x} ${last.y}`;
}

/* Point at half the polyline's length — where tools, badges and labels sit. */
export function polyMid(pts) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  let t = total / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    if (t <= seg && seg > 0) {
      const k = t / seg;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    t -= seg;
  }
  return { ...pts[pts.length - 1] };
}

export function distToSeg(p, u, v) {
  const dx = v.x - u.x, dy = v.y - u.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (u.x + dx * t), p.y - (u.y + dy * t));
}

export function nearestSegment(pts, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSeg(p, pts[i], pts[i + 1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* ── A* over the sparse channel lattice ── */

function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

function astar(X, Y, blocked, start, goal, startDir, endDir) {
  const W = X.length, H = Y.length;
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  const OPP = [1, 0, 3, 2];
  const key = (i, j, d) => (i * H + j) * 4 + d;
  const best = new Map();
  const parent = new Map();
  const h = (i, j) => Math.abs(X[i] - X[goal.i]) + Math.abs(Y[j] - Y[goal.j]);
  const open = [];
  best.set(key(start.i, start.j, startDir), 0);
  heapPush(open, [h(start.i, start.j), 0, start.i, start.j, startDir]);
  let found = null;
  let guard = 0;
  while (open.length && guard++ < 24000) {
    const [, g0, i, j, d] = heapPop(open);
    const k = key(i, j, d);
    if (g0 > (best.get(k) ?? Infinity)) continue;
    if (i === goal.i && j === goal.j) { found = k; break; }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === OPP[d]) continue;
      const ni = i + DX[nd], nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      if (blocked(X[ni], Y[nj]) || blocked((X[i] + X[ni]) / 2, (Y[j] + Y[nj]) / 2)) continue;
      let cost = Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (nd === d ? 0 : TURN);
      if (ni === goal.i && nj === goal.j && nd !== endDir) cost += TURN;
      const nk = key(ni, nj, nd);
      const ng = g0 + cost;
      if (ng >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, ng);
      parent.set(nk, k);
      heapPush(open, [ng + h(ni, nj), ng, ni, nj, nd]);
    }
  }
  if (found === null) return null;
  const pts = [];
  let cur = found;
  while (cur !== undefined) {
    const d4 = cur % 4;
    const cell = (cur - d4) / 4;
    const j = cell % H;
    pts.unshift({ x: X[(cell - j) / H], y: Y[j] });
    cur = parent.get(cur);
  }
  return pts;
}

/* Obstacle-free fallback: a single S (or L) route between the two stubs. */
function direct(a, da, b, a2, b2) {
  if (da.x !== 0) {
    const mx = snap((a2.x + b2.x) / 2);
    return simplify([a, a2, { x: mx, y: a2.y }, { x: mx, y: b2.y }, b2, b]);
  }
  const my = snap((a2.y + b2.y) / 2);
  return simplify([a, a2, { x: a2.x, y: my }, { x: b2.x, y: my }, b2, b]);
}

/* Route one connection orthogonally around the given card rects ({x,y,w,h}).
   Returns the polyline from the source port to the target port. */
export function routeOrtho(g1, g2, rects) {
  const { a, da, b, db } = orthoPorts(g1, g2);
  const a2 = { x: a.x + da.x * MARGIN, y: a.y + da.y * MARGIN };
  const b2 = { x: b.x + db.x * MARGIN, y: b.y + db.y * MARGIN };
  if (a2.x === b2.x && a2.y === b2.y) return simplify([a, a2, b]);

  // working corridor — cards far outside the endpoints' box can't matter
  const pad = 380;
  const lo = { x: Math.min(a2.x, b2.x) - pad, y: Math.min(a2.y, b2.y) - pad };
  const hi = { x: Math.max(a2.x, b2.x) + pad, y: Math.max(a2.y, b2.y) + pad };
  const near = rects.filter((r) => r.x < hi.x && r.x + r.w > lo.x && r.y < hi.y && r.y + r.h > lo.y);

  // blocking test runs slightly inside the channel lines so channels stay usable;
  // cards that already overlap a stub can't be routed around — drop them
  const inset = MARGIN - 2;
  const inSide = (r, x, y) => x > r.x - inset && x < r.x + r.w + inset && y > r.y - inset && y < r.y + r.h + inset;
  const blockers = near.filter((r) => !inSide(r, a2.x, a2.y) && !inSide(r, b2.x, b2.y));
  const blocked = (x, y) => blockers.some((r) => inSide(r, x, y));

  const down = (v) => Math.floor(v / STEP) * STEP;
  const up = (v) => Math.ceil(v / STEP) * STEP;
  const xs = new Set([a2.x, b2.x, snap((a2.x + b2.x) / 2)]);
  const ys = new Set([a2.y, b2.y, snap((a2.y + b2.y) / 2)]);
  for (const r of near) {
    xs.add(down(r.x - MARGIN)); xs.add(up(r.x + r.w + MARGIN));
    ys.add(down(r.y - MARGIN)); ys.add(up(r.y + r.h + MARGIN));
  }
  const X = [...xs].filter((v) => v >= lo.x && v <= hi.x).sort((m, n) => m - n);
  const Y = [...ys].filter((v) => v >= lo.y && v <= hi.y).sort((m, n) => m - n);
  const start = { i: X.indexOf(a2.x), j: Y.indexOf(a2.y) };
  const goal = { i: X.indexOf(b2.x), j: Y.indexOf(b2.y) };
  if (start.i < 0 || start.j < 0 || goal.i < 0 || goal.j < 0 || blocked(a2.x, a2.y) || blocked(b2.x, b2.y)) {
    return direct(a, da, b, a2, b2);
  }

  const path = astar(X, Y, blocked, start, goal, dirOf(da.x, da.y), dirOf(-db.x, -db.y));
  if (!path) return direct(a, da, b, a2, b2);
  return simplify([a, ...path, b]);
}
