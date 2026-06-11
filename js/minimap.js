// Minimap: a small live overview of the current layer with a draggable viewport window.
import { on } from './state.js';

const W = 184, H = 122, PAD = 14;

export function initMinimap(host, canvasApi) {
  const canvas = document.createElement('canvas');
  canvas.className = 'minimap-canvas';
  host.appendChild(canvas);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let colors = {};
  let accent = '#0a84ff';
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    colors = {};
    for (const t of ['phase', 'agent', 'skill', 'hook', 'code', 'doc', 'other']) {
      colors[t] = cs.getPropertyValue('--c-' + t).trim() || '#999';
    }
    accent = cs.getPropertyValue('--accent').trim() || accent;
  };
  readColors();
  new MutationObserver(() => { readColors(); dirty(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let scheduled = false;
  let mapping = null; // {s, ox, oy} world→mini

  // rAF-coalesced with a timeout backstop (rAF may not tick when throttled/headless)
  function dirty() {
    if (host.hidden || scheduled) return;
    scheduled = true;
    const go = () => { if (!scheduled) return; scheduled = false; draw(); };
    requestAnimationFrame(go);
    setTimeout(go, 70);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const geom = canvasApi.getGeom();
    const vp = canvasApi.getViewport(); // world rect currently visible
    if (!geom.size && !vp) { mapping = null; return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y, w, h) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    };
    for (const g of geom.values()) add(g.x, g.y, g.w, g.h);
    if (vp) add(vp.x, vp.y, vp.w, vp.h);
    if (!Number.isFinite(minX)) { mapping = null; return; }

    const s = Math.min((W - PAD * 2) / Math.max(1, maxX - minX), (H - PAD * 2) / Math.max(1, maxY - minY));
    const ox = (W - (maxX - minX) * s) / 2 - minX * s;
    const oy = (H - (maxY - minY) * s) / 2 - minY * s;
    mapping = { s, ox, oy };

    for (const g of geom.values()) {
      ctx.fillStyle = colors[g.type] || colors.other;
      ctx.globalAlpha = 0.85;
      const x = g.x * s + ox, y = g.y * s + oy;
      const w = Math.max(3, g.w * s), h = Math.max(2.5, g.h * s);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(2.5, h / 2));
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (vp) {
      const x = vp.x * s + ox, y = vp.y * s + oy, w = vp.w * s, h = vp.h * s;
      ctx.fillStyle = accent + '14';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();
      ctx.stroke();
    }
  }

  /* click / drag to move the viewport */
  let dragging = false;
  const jump = (e) => {
    if (!mapping) return;
    const r = canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - mapping.ox) / mapping.s;
    const wy = (e.clientY - r.top - mapping.oy) / mapping.s;
    canvasApi.panTo(wx, wy);
  };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    jump(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging) jump(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  for (const evt of ['view', 'graph', 'moved', 'layer', 'node', 'project:open']) on(evt, dirty);

  return {
    dirty,
    setVisible(v) { host.hidden = !v; if (v) dirty(); },
    get visible() { return !host.hidden; },
  };
}
