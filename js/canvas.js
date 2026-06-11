// Infinite canvas: pan/zoom viewport, draggable node cards, curved edges, magnetic
// snapping with alignment guides, marquee selection, port-drag connections, layers.
import {
  state, on, emit, TYPES, getNode, childrenOf, childCount, layerEdges,
  addNode, addEdge, deleteEdge, setParent, setSelection, clearSelection,
  setView, getView, snapEnabled, markDirty, pushUndo, runUndo,
} from './state.js';
import { esc, clamp, toast } from './ui.js';
import { icon } from './icons.js';
import { computeLayout } from './layout.js';

const GRID = 24;       // dot spacing
const SNAP = 12;       // grid snap step
const NODE_W = 216;
const cssEsc = (s) => (window.CSS?.escape ? CSS.escape(s) : s);
const snap12 = (v) => Math.round(v / SNAP) * SNAP;

export function initCanvas(host) {
  host.innerHTML = `
    <div class="viewport" tabindex="-1">
      <div class="world">
        <svg class="edge-svg" width="2" height="2">
          <defs>
            <marker id="am-arrow" viewBox="0 0 10 10" refX="7.6" refY="5" markerWidth="6.4" markerHeight="6.4" orient="auto-start-reverse">
              <path d="M0.9,0.9 L9.1,5 L0.9,9.1 L2.9,5 Z" fill="var(--edge-solid)" stroke="none"/>
            </marker>
            <marker id="am-arrow-sel" viewBox="0 0 10 10" refX="7.6" refY="5" markerWidth="6.4" markerHeight="6.4" orient="auto-start-reverse">
              <path d="M0.9,0.9 L9.1,5 L0.9,9.1 L2.9,5 Z" fill="var(--accent)" stroke="none"/>
            </marker>
          </defs>
          <g class="edge-g"></g>
        </svg>
        <div class="node-layer"></div>
        <svg class="overlay-svg" width="2" height="2">
          <g class="guide-g"></g>
          <path class="temp-edge" hidden></path>
          <rect class="marquee" vector-effect="non-scaling-stroke" hidden></rect>
        </svg>
      </div>
      <div class="empty-hint" hidden>
        <div class="eh-title">This layer is empty</div>
        <div class="eh-sub">Double-click anywhere to add a component</div>
      </div>
    </div>`;

  const viewport = host.querySelector('.viewport');
  const world = host.querySelector('.world');
  const edgeG = host.querySelector('.edge-g');
  const nodeLayer = host.querySelector('.node-layer');
  const guideG = host.querySelector('.guide-g');
  const tempEdge = host.querySelector('.temp-edge');
  const marqueeEl = host.querySelector('.marquee');
  const emptyHint = host.querySelector('.empty-hint');

  let view = { x: 0, y: 0, z: 1 };
  let nodeEls = new Map();   // id -> element
  let geom = new Map();      // id -> {x,y,w,h,type}
  let edgeList = [];
  let edgeMids = new Map();  // edge id -> {x,y}
  let gesture = null;
  let spaceDown = false;
  let edgeXBtn = null;
  let viewAnim = null;
  const touchPts = new Map();

  /* ════════ coordinates & view ════════ */

  const toWorld = (e) => {
    const r = viewport.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z };
  };

  let viewSaveTimer = null;

  // rAF-coalesced with a timeout backstop (rAF may not tick when throttled/headless)
  const coalesce = (fn) => {
    let scheduled = false;
    const go = () => { if (!scheduled) return; scheduled = false; fn(); };
    return () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(go);
      setTimeout(go, 70);
    };
  };
  const queueViewEmit = coalesce(() => emit('view'));

  function applyView(save = true) {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    let g = GRID;
    while (g * view.z < 13) g *= 2;
    while (g * view.z > 62) g /= 2;
    viewport.style.backgroundSize = `${g * view.z}px ${g * view.z}px`;
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    queueViewEmit();
    if (save && state.project) {
      const pid = state.parentId;
      const snap = { ...view };
      clearTimeout(viewSaveTimer);
      viewSaveTimer = setTimeout(() => setView(pid, snap), 400);
    }
  }

  function stopViewAnim() {
    if (viewAnim) { cancelAnimationFrame(viewAnim); viewAnim = null; }
  }

  function animateViewTo(target, ms = 260) {
    stopViewAnim();
    const from = { ...view };
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      view = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        z: from.z + (target.z - from.z) * e,
      };
      applyView();
      viewAnim = k < 1 ? requestAnimationFrame(step) : null;
    };
    viewAnim = requestAnimationFrame(step);
  }

  function zoomAt(clientX, clientY, factor) {
    const r = viewport.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const z2 = clamp(view.z * factor, 0.12, 3);
    view.x = sx - ((sx - view.x) / view.z) * z2;
    view.y = sy - ((sy - view.y) / view.z) * z2;
    view.z = z2;
    applyView();
  }

  function fit(animate = true) {
    const r = viewport.getBoundingClientRect();
    let target;
    if (!geom.size) {
      target = { x: r.width / 2 - NODE_W / 2, y: r.height / 2 - 50, z: 1 };
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const g of geom.values()) {
        minX = Math.min(minX, g.x); minY = Math.min(minY, g.y);
        maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h);
      }
      const pad = 90;
      const z = clamp(Math.min((r.width - pad) / (maxX - minX || 1), (r.height - pad) / (maxY - minY || 1)), 0.12, 1.2);
      target = {
        x: (r.width - (maxX - minX) * z) / 2 - minX * z,
        y: (r.height - (maxY - minY) * z) / 2 - minY * z,
        z,
      };
    }
    if (animate) animateViewTo(target);
    else { view = target; applyView(); }
  }

  /* ════════ rendering ════════ */

  function nodeHTML(n) {
    const kc = childCount(n.id);
    const tags = n.tags || [];
    return `
      <div class="node t-${esc(n.type)}${kc ? ' container' : ''}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px">
        <div class="node-head">
          <span class="chip t-${esc(n.type)}">${icon(TYPES[n.type]?.icon || 'dot')}</span>
          <div class="nh-text">
            <div class="node-title">${esc(n.title) || 'Untitled'}</div>
            <div class="node-type">${TYPES[n.type]?.label || 'Other'}</div>
          </div>
        </div>
        ${tags.length ? `<div class="node-tags">${tags.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${tags.length > 3 ? `<span class="tag tag-more">+${tags.length - 3}</span>` : ''}</div>` : ''}
        ${kc ? `<button class="node-kids" data-open="${esc(n.id)}">${icon('stack')}<span>${kc} component${kc === 1 ? '' : 's'}</span>${icon('chev-r', 'kids-chev')}</button>` : ''}
        <span class="port port-in" data-port="in" data-tip="Drag to connect"></span>
        <span class="port port-out" data-port="out" data-tip="Drag to connect"></span>
      </div>`;
  }

  function measure(id) {
    const el = nodeEls.get(id);
    const n = getNode(id);
    if (!el || !n) return;
    geom.set(id, { x: n.x, y: n.y, w: el.offsetWidth, h: el.offsetHeight, type: n.type });
  }

  function rebuild() {
    if (!state.project) return;
    const nodes = childrenOf(state.parentId);
    nodeLayer.innerHTML = nodes.map(nodeHTML).join('');
    nodeEls = new Map([...nodeLayer.querySelectorAll('.node')].map((el) => [el.dataset.id, el]));
    geom = new Map();
    for (const n of nodes) measure(n.id);

    edgeList = layerEdges(state.parentId);
    edgeG.innerHTML = edgeList.map((e) => `
      <g class="edge" data-id="${esc(e.id)}">
        <path class="edge-hit"></path>
        <path class="edge-line" marker-end="url(#am-arrow)"></path>
      </g>`).join('');
    for (const e of edgeList) updateEdgePath(e);

    emptyHint.hidden = nodes.length > 0;
    applySelection();
    applyFilters();
  }

  function edgePathFor(g1, g2) {
    const c1 = { x: g1.x + g1.w / 2, y: g1.y + g1.h / 2 };
    const c2 = { x: g2.x + g2.w / 2, y: g2.y + g2.h / 2 };
    const dx = c2.x - c1.x, dy = c2.y - c1.y;
    let a, b, h1, h2;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const s = dx >= 0 ? 1 : -1;
      a = { x: c1.x + s * (g1.w / 2), y: c1.y };
      b = { x: c2.x - s * (g2.w / 2), y: c2.y };
      const o = clamp(Math.abs(dx) * 0.42, 34, 170);
      h1 = { x: a.x + s * o, y: a.y };
      h2 = { x: b.x - s * o, y: b.y };
    } else {
      const s = dy >= 0 ? 1 : -1;
      a = { x: c1.x, y: c1.y + s * (g1.h / 2) };
      b = { x: c2.x, y: c2.y - s * (g2.h / 2) };
      const o = clamp(Math.abs(dy) * 0.42, 30, 150);
      h1 = { x: a.x, y: a.y + s * o };
      h2 = { x: b.x, y: b.y - s * o };
    }
    const mid = {
      x: (a.x + 3 * h1.x + 3 * h2.x + b.x) / 8,
      y: (a.y + 3 * h1.y + 3 * h2.y + b.y) / 8,
    };
    return { d: `M ${a.x} ${a.y} C ${h1.x} ${h1.y}, ${h2.x} ${h2.y}, ${b.x} ${b.y}`, mid };
  }

  function updateEdgePath(e) {
    const g1 = geom.get(e.from), g2 = geom.get(e.to);
    const g = edgeG.querySelector(`.edge[data-id="${cssEsc(e.id)}"]`);
    if (!g1 || !g2 || !g) return;
    const { d, mid } = edgePathFor(g1, g2);
    edgeMids.set(e.id, mid);
    for (const p of g.children) p.setAttribute('d', d);
    if (state.selectedEdge === e.id) positionEdgeX();
  }

  const updateEdgesTouching = (ids) => {
    for (const e of edgeList) if (ids.has(e.from) || ids.has(e.to)) updateEdgePath(e);
  };

  function renderOne(id) {
    const n = getNode(id);
    const el = nodeEls.get(id);
    if (!n || !el) { rebuild(); return; }
    el.outerHTML = nodeHTML(n);
    const ne = nodeLayer.querySelector(`.node[data-id="${cssEsc(id)}"]`);
    nodeEls.set(id, ne);
    measure(id);
    updateEdgesTouching(new Set([id]));
    applySelection();
    applyFilters();
  }

  /* ════════ selection, filters, edge delete button ════════ */

  function applySelection() {
    for (const [id, el] of nodeEls) el.classList.toggle('sel', state.selection.has(id));
    for (const g of edgeG.children) {
      const sel = g.dataset.id === state.selectedEdge;
      g.classList.toggle('sel', sel);
      g.querySelector('.edge-line')?.setAttribute('marker-end', sel ? 'url(#am-arrow-sel)' : 'url(#am-arrow)');
    }
    positionEdgeX();
  }

  function positionEdgeX() {
    if (!state.selectedEdge || !edgeMids.has(state.selectedEdge)) {
      edgeXBtn?.remove();
      edgeXBtn = null;
      return;
    }
    if (!edgeXBtn) {
      edgeXBtn = document.createElement('button');
      edgeXBtn.className = 'edge-x';
      edgeXBtn.innerHTML = icon('x');
      edgeXBtn.setAttribute('data-tip', 'Remove connection');
      edgeXBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      edgeXBtn.addEventListener('click', () => deleteEdge(state.selectedEdge));
      world.appendChild(edgeXBtn);
    }
    const m = edgeMids.get(state.selectedEdge);
    edgeXBtn.style.left = m.x + 'px';
    edgeXBtn.style.top = m.y + 'px';
  }

  function applyFilters() {
    const f = state.filters;
    const active = f.size > 0;
    for (const [id, el] of nodeEls) {
      const g = geom.get(id);
      el.classList.toggle('dim', active && !f.has(g?.type));
    }
    for (const e of edgeList) {
      const g = edgeG.querySelector(`.edge[data-id="${cssEsc(e.id)}"]`);
      if (!g) continue;
      const dim = active && (!f.has(geom.get(e.from)?.type) || !f.has(geom.get(e.to)?.type));
      g.classList.toggle('dim', dim);
    }
  }

  /* ════════ snapping & guides ════════ */

  function computeSnap(pos, size, excluded) {
    const tol = clamp(6 / view.z + 2, 4, 14);
    const res = { x: pos.x, y: pos.y, guides: [] };
    let bestX = null, bestY = null;

    for (const [id, g] of geom) {
      if (excluded.has(id)) continue;
      const candX = [g.x, g.x + g.w / 2, g.x + g.w];
      const mineX = [pos.x, pos.x + size.w / 2, pos.x + size.w];
      for (const cv of candX) for (let i = 0; i < 3; i++) {
        const d = Math.abs(mineX[i] - cv);
        if (d <= tol && (!bestX || d < bestX.d)) bestX = { d, snapped: pos.x + (cv - mineX[i]), line: cv, other: g };
      }
      const candY = [g.y, g.y + g.h / 2, g.y + g.h];
      const mineY = [pos.y, pos.y + size.h / 2, pos.y + size.h];
      for (const cv of candY) for (let i = 0; i < 3; i++) {
        const d = Math.abs(mineY[i] - cv);
        if (d <= tol && (!bestY || d < bestY.d)) bestY = { d, snapped: pos.y + (cv - mineY[i]), line: cv, other: g };
      }
    }

    if (bestX) {
      res.x = bestX.snapped;
      const o = bestX.other;
      res.guides.push({ v: true, at: bestX.line, from: Math.min(o.y, res.y) - 24, to: Math.max(o.y + o.h, res.y + size.h) + 24 });
    } else res.x = snap12(pos.x);
    if (bestY) {
      res.y = bestY.snapped;
      const o = bestY.other;
      res.guides.push({ v: false, at: bestY.line, from: Math.min(o.x, res.x) - 24, to: Math.max(o.x + o.w, res.x + size.w) + 24 });
    } else res.y = snap12(pos.y);
    return res;
  }

  function drawGuides(guides) {
    guideG.innerHTML = guides.map((g) => g.v
      ? `<line class="guide" vector-effect="non-scaling-stroke" x1="${g.at}" y1="${g.from}" x2="${g.at}" y2="${g.to}"/>`
      : `<line class="guide" vector-effect="non-scaling-stroke" x1="${g.from}" y1="${g.at}" x2="${g.to}" y2="${g.at}"/>`).join('');
  }

  /* ════════ gestures ════════ */

  const emitMoved = coalesce(() => emit('moved'));

  function startPan(e, opts = {}) {
    gesture = { type: 'pan', last: { x: e.clientX, y: e.clientY }, moved: false, clickClears: !!opts.clickClears, pointerId: e.pointerId };
    try { viewport.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    viewport.classList.add('grabbing');
    e.preventDefault();
  }

  function startNodeInteraction(e, nodeEl) {
    const id = nodeEl.dataset.id;
    if (e.shiftKey) {
      gesture = { type: 'toggle', id, pointerId: e.pointerId };
      try { viewport.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      return;
    }
    if (!state.selection.has(id)) setSelection([id]);
    if (!state.canEdit) return; // viewers can select, not move
    const ids = [...state.selection];
    gesture = {
      type: 'drag', ids, primary: id, pointerId: e.pointerId,
      startWorld: toWorld(e), moved: false,
      orig: new Map(ids.map((i) => { const n = getNode(i); return [i, { x: n.x, y: n.y }]; })),
    };
    try { viewport.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    e.preventDefault();
  }

  function startMarquee(e) {
    gesture = { type: 'marquee', start: toWorld(e), hits: [], pointerId: e.pointerId };
    marqueeEl.hidden = false;
    try { viewport.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    e.preventDefault();
  }

  function startPort(e, portEl) {
    if (!state.canEdit) return;
    const nodeEl = portEl.closest('.node');
    const id = nodeEl.dataset.id;
    const side = portEl.dataset.port;
    const g = geom.get(id);
    if (!g) return;
    gesture = {
      type: 'port', from: id, side, pointerId: e.pointerId, target: null, dist: 0,
      anchor: side === 'out' ? { x: g.x + g.w, y: g.y + g.h / 2 } : { x: g.x, y: g.y + g.h / 2 },
    };
    tempEdge.hidden = false;
    try { viewport.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    e.preventDefault();
  }

  function onDown(e) {
    stopViewAnim();
    if (e.pointerType === 'touch') {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPts.size === 2) { beginPinch(); return; }
    }
    if (gesture) return;
    if (e.button === 1 || (e.button === 0 && spaceDown)) { startPan(e); return; }
    if (e.button !== 0) return;
    if (e.target.closest('.edge-x')) return;
    const portEl = e.target.closest('.port');
    if (portEl) { startPort(e, portEl); return; }
    if (e.target.closest('.node-kids')) return; // click navigates; no drag
    const nodeEl = e.target.closest('.node');
    if (nodeEl) { startNodeInteraction(e, nodeEl); return; }
    if (e.shiftKey) startMarquee(e);
    else startPan(e, { clickClears: true });
  }

  function beginPinch() {
    if (gesture?.type === 'drag' && gesture.moved) restoreDragOrigins();
    const pts = [...touchPts.values()];
    gesture = {
      type: 'pinch',
      lastMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      lastDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
    };
    tempEdge.hidden = true;
    marqueeEl.hidden = true;
  }

  function restoreDragOrigins() {
    if (gesture?.type !== 'drag') return;
    for (const [i, o] of gesture.orig) {
      const n = getNode(i);
      if (!n) continue;
      n.x = o.x; n.y = o.y;
      const el = nodeEls.get(i);
      if (el) { el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; el.classList.remove('dragging'); }
      measure(i);
    }
    updateEdgesTouching(new Set(gesture.ids));
    guideG.innerHTML = '';
    emitMoved();
  }

  function onMove(e) {
    if (e.pointerType === 'touch' && touchPts.has(e.pointerId)) {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (!gesture) return;

    if (gesture.type === 'pinch') {
      const pts = [...touchPts.values()];
      if (pts.length < 2) return;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      view.x += mid.x - gesture.lastMid.x;
      view.y += mid.y - gesture.lastMid.y;
      zoomAt(mid.x, mid.y, dist / gesture.lastDist);
      gesture.lastMid = mid;
      gesture.lastDist = dist;
      return;
    }

    if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;

    if (gesture.type === 'pan') {
      view.x += e.clientX - gesture.last.x;
      view.y += e.clientY - gesture.last.y;
      if (Math.abs(e.clientX - gesture.last.x) + Math.abs(e.clientY - gesture.last.y) > 1) gesture.moved = true;
      gesture.last = { x: e.clientX, y: e.clientY };
      applyView();
      return;
    }

    if (gesture.type === 'drag') {
      const w = toWorld(e);
      const dxw = w.x - gesture.startWorld.x, dyw = w.y - gesture.startWorld.y;
      if (!gesture.moved && Math.hypot(dxw * view.z, dyw * view.z) < 4) return;
      if (!gesture.moved) {
        gesture.moved = true;
        for (const i of gesture.ids) nodeEls.get(i)?.classList.add('dragging');
      }
      const o = gesture.orig.get(gesture.primary);
      const g = geom.get(gesture.primary);
      let nx = o.x + dxw, ny = o.y + dyw;
      const snapping = snapEnabled() && !e.altKey;
      let guides = [];
      if (snapping) {
        const excluded = new Set(gesture.ids);
        const r = computeSnap({ x: nx, y: ny }, { w: g.w, h: g.h }, excluded);
        nx = r.x; ny = r.y; guides = r.guides;
      }
      const ddx = nx - o.x, ddy = ny - o.y;
      for (const i of gesture.ids) {
        const oo = gesture.orig.get(i);
        const n = getNode(i);
        if (!n || !oo) continue;
        n.x = Math.round(oo.x + ddx);
        n.y = Math.round(oo.y + ddy);
        const el = nodeEls.get(i);
        if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
        measure(i);
      }
      updateEdgesTouching(new Set(gesture.ids));
      drawGuides(guides);
      emitMoved();
      return;
    }

    if (gesture.type === 'marquee') {
      const w = toWorld(e);
      const x = Math.min(w.x, gesture.start.x), y = Math.min(w.y, gesture.start.y);
      const ww = Math.abs(w.x - gesture.start.x), hh = Math.abs(w.y - gesture.start.y);
      marqueeEl.setAttribute('x', x); marqueeEl.setAttribute('y', y);
      marqueeEl.setAttribute('width', ww); marqueeEl.setAttribute('height', hh);
      gesture.hits = [...geom.entries()]
        .filter(([, g]) => g.x < x + ww && g.x + g.w > x && g.y < y + hh && g.y + g.h > y)
        .map(([id]) => id);
      for (const [id, el] of nodeEls) el.classList.toggle('sel', gesture.hits.includes(id) || state.selection.has(id));
      return;
    }

    if (gesture.type === 'port') {
      const w = toWorld(e);
      const a = gesture.anchor;
      const s = gesture.side === 'out' ? 1 : -1;
      const o = clamp(Math.abs(w.x - a.x) * 0.5, 30, 150);
      tempEdge.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + s * o} ${a.y}, ${w.x - s * o * 0.6} ${w.y}, ${w.x} ${w.y}`);
      gesture.dist = Math.max(gesture.dist, Math.hypot((w.x - a.x) * view.z, (w.y - a.y) * view.z));
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tn = el?.closest?.('.node');
      const targetId = tn && tn.dataset.id !== gesture.from ? tn.dataset.id : null;
      if (targetId !== gesture.target) {
        nodeEls.get(gesture.target)?.classList.remove('drop-ok');
        gesture.target = targetId;
        nodeEls.get(targetId)?.classList.add('drop-ok');
      }
    }
  }

  function onUp(e) {
    if (e.pointerType === 'touch') {
      touchPts.delete(e.pointerId);
      if (gesture?.type === 'pinch') {
        if (touchPts.size < 2) gesture = null;
        return;
      }
    }
    if (!gesture || (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId)) return;
    const g = gesture;
    gesture = null;
    viewport.classList.remove('grabbing');

    if (g.type === 'pan') {
      if (g.clickClears && !g.moved) clearSelection();
      return;
    }
    if (g.type === 'toggle') {
      const next = new Set(state.selection);
      if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
      setSelection([...next]);
      return;
    }
    if (g.type === 'drag') {
      for (const i of g.ids) nodeEls.get(i)?.classList.remove('dragging');
      guideG.innerHTML = '';
      if (g.moved) { markDirty(); emitMoved(); }
      else if (state.selection.size > 1) setSelection([g.primary]);
      return;
    }
    if (g.type === 'marquee') {
      marqueeEl.hidden = true;
      marqueeEl.setAttribute('width', 0);
      setSelection(g.hits);
      return;
    }
    if (g.type === 'port') {
      tempEdge.hidden = true;
      nodeEls.get(g.target)?.classList.remove('drop-ok');
      if (g.target) {
        const [f, t] = g.side === 'out' ? [g.from, g.target] : [g.target, g.from];
        if (!addEdge(f, t)) toast('Those components are already connected.', { type: 'info', timeout: 2200 });
      } else if (g.dist > 36) {
        // released over empty canvas: create a connected node right there
        const w = toWorld(e);
        const n = addNode({ x: snap12(w.x - (g.side === 'out' ? 0 : NODE_W)), y: snap12(w.y - 30), type: 'agent' });
        if (g.side === 'out') addEdge(g.from, n.id); else addEdge(n.id, g.from);
        setSelection([n.id], { focusTitle: true });
      }
    }
  }

  function cancelGesture() {
    if (!gesture) return;
    if (gesture.type === 'drag' && gesture.moved) restoreDragOrigins();
    if (gesture.type === 'port') {
      tempEdge.hidden = true;
      nodeEls.get(gesture.target)?.classList.remove('drop-ok');
    }
    if (gesture.type === 'marquee') {
      marqueeEl.hidden = true;
      applySelection();
    }
    viewport.classList.remove('grabbing');
    gesture = null;
  }

  viewport.addEventListener('pointerdown', onDown);
  viewport.addEventListener('pointermove', onMove);
  viewport.addEventListener('pointerup', onUp);
  viewport.addEventListener('pointercancel', cancelGesture);

  /* wheel: two-finger scroll pans, ctrl/cmd-wheel (and pinch) zooms — Figma-style */
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopViewAnim();
    const k = e.deltaMode === 1 ? 16 : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0028));
    } else if (e.shiftKey && !dx) {
      view.x -= dy; applyView();
    } else {
      view.x -= dx; view.y -= dy; applyView();
    }
  }, { passive: false });

  /* Safari trackpad pinch */
  let lastGestureScale = 1;
  viewport.addEventListener('gesturestart', (e) => { e.preventDefault(); lastGestureScale = e.scale; });
  viewport.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.scale / lastGestureScale);
    lastGestureScale = e.scale;
  });
  viewport.addEventListener('gestureend', (e) => e.preventDefault());

  viewport.addEventListener('dblclick', (e) => {
    if (e.target.closest('.port') || e.target.closest('.edge-x')) return;
    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
      // double-click anywhere on a card: containers open, leaves focus the title
      const id = nodeEl.dataset.id;
      if (childCount(id)) setParent(id);
      else setSelection([id], { focusTitle: state.canEdit });
      return;
    }
    if (e.target.closest('.edge')) return;
    const w = toWorld(e);
    api.addNodeAt({ x: w.x - NODE_W / 2, y: w.y - 28 });
  });

  /* navigate into containers via the footer chip */
  nodeLayer.addEventListener('click', (e) => {
    const k = e.target.closest('.node-kids');
    if (k) { e.stopPropagation(); setParent(k.dataset.open); }
  });

  /* edge selection */
  edgeG.addEventListener('click', (e) => {
    const g = e.target.closest('.edge');
    if (g) setSelection([], { edge: g.dataset.id });
  });

  /* space-to-pan + esc-to-cancel */
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.repeat && !e.target.closest('input, textarea, select, [contenteditable]')) {
      spaceDown = true;
      viewport.classList.add('space');
      if (state.mode === 'project') e.preventDefault();
    }
    if (e.key === 'Escape') cancelGesture();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; viewport.classList.remove('space'); }
  });
  window.addEventListener('blur', () => { spaceDown = false; viewport.classList.remove('space'); cancelGesture(); });

  new ResizeObserver(() => { applyView(false); emit('view'); }).observe(viewport);

  /* ════════ state subscriptions ════════ */

  on('layer', () => {
    rebuild();
    const v = getView(state.parentId);
    if (v) { stopViewAnim(); view = { ...v }; applyView(false); }
    else fit(false);
  });
  on('graph', rebuild);
  on('node', ({ id }) => renderOne(id));
  on('selection', applySelection);
  on('filters', applyFilters);
  on('locate', (id) => {
    if (!nodeEls.has(id)) return;
    api.centerOnNode(id);
    api.pulse(id);
  });
  on('project:close', () => { nodeLayer.innerHTML = ''; edgeG.innerHTML = ''; geom.clear(); nodeEls.clear(); });

  /* ════════ public api ════════ */

  const api = {
    fit,
    zoomBy(f) {
      const r = viewport.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
    },
    resetZoom() {
      const r = viewport.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / view.z);
    },
    getZoom: () => view.z,
    getViewport() {
      const r = viewport.getBoundingClientRect();
      return { x: -view.x / view.z, y: -view.y / view.z, w: r.width / view.z, h: r.height / view.z };
    },
    getGeom: () => geom,
    panTo(wx, wy) {
      stopViewAnim();
      const r = viewport.getBoundingClientRect();
      view.x = r.width / 2 - wx * view.z;
      view.y = r.height / 2 - wy * view.z;
      applyView();
    },
    centerOnNode(id, ms = 240) {
      const g = geom.get(id);
      if (!g) return;
      const r = viewport.getBoundingClientRect();
      const z = view.z < 0.5 ? 0.85 : view.z;
      animateViewTo({
        x: r.width / 2 - (g.x + g.w / 2) * z,
        y: r.height / 2 - (g.y + g.h / 2) * z,
        z,
      }, ms);
    },
    pulse(id) {
      const el = nodeEls.get(id);
      if (!el) return;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 1300);
    },
    addNodeAt(pos, type = 'agent') {
      let x = snap12(pos.x), y = snap12(pos.y);
      const collides = () => [...geom.values()].some((g) => x < g.x + g.w + 12 && x + NODE_W > g.x - 12 && y < g.y + g.h + 12 && y + 76 > g.y - 12);
      let tries = 0;
      while (collides() && tries++ < 24) { x += 28; y += 28; }
      const n = addNode({ x, y, type });
      if (n) setSelection([n.id], { focusTitle: true });
      return n;
    },
    addNodeAtCenter(type = 'agent') {
      const r = viewport.getBoundingClientRect();
      const w = {
        x: (r.width / 2 - view.x) / view.z - NODE_W / 2,
        y: (r.height / 2 - view.y) / view.z - 44,
      };
      return api.addNodeAt(w, type);
    },
    runAutoLayout() {
      if (!state.canEdit) return;
      const nodes = childrenOf(state.parentId);
      if (nodes.length < 2) return;
      const sizes = new Map([...geom.entries()].map(([id, g]) => [id, { w: g.w, h: g.h }]));
      const targets = computeLayout(nodes, layerEdges(state.parentId), sizes);
      const before = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      pushUndo('Auto-arrange', () => {
        for (const [id, p] of before) {
          const n = getNode(id);
          if (n) { n.x = p.x; n.y = p.y; }
        }
        markDirty();
        emit('graph');
      });
      const t0 = performance.now();
      const ms = 380;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        for (const [id, target] of targets) {
          const n = getNode(id);
          const b = before.get(id);
          if (!n || !b) continue;
          n.x = Math.round(b.x + (target.x - b.x) * ease);
          n.y = Math.round(b.y + (target.y - b.y) * ease);
          const el = nodeEls.get(id);
          if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
          measure(id);
        }
        for (const e2 of edgeList) updateEdgePath(e2);
        emitMoved();
        if (k < 1) requestAnimationFrame(step);
        else {
          markDirty();
          fit(true);
          toast('Auto-arranged this layer.', { type: 'ok', timeout: 3500, action: { label: 'Undo', fn: runUndo } });
        }
      };
      requestAnimationFrame(step);
    },
    refresh: rebuild,
  };

  return api;
}
