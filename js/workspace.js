// Project workspace shell: top bar (breadcrumbs, search, actions), legend, zoom pill,
// minimap host, keyboard shortcuts, export dialog, and the help/shortcut reference.
import {
  state, on, emit, TYPES, TYPE_ORDER, childrenOf, crumbs, closeProject,
  setParent, goUp, setSelection, deleteNodes, duplicateNodes, deleteEdge,
  toggleSnap, snapEnabled, setFilters, runUndo, projectStats,
  getNode, layerEdges, hasChildren, childCount,
} from './state.js';
import { esc, toast, menu, openModal, download, copyText, debounce, uiPref, toggleTheme, getTheme } from './ui.js';
import { icon } from './icons.js';
import { initCanvas } from './canvas.js';
import { initMinimap } from './minimap.js';
import { initPanel } from './panel.js';
import { exportProjectFile, buildHandoff } from './transfer.js';

let canvas = null;
let minimap = null;

export function initWorkspace(viewEl) {
  viewEl.innerHTML = `
    <header class="topbar glass">
      <button class="btn btn-ghost back-btn" data-act="library" data-tip="Back to library">${icon('arrow-l')}<span>Library</span></button>
      <nav class="crumbs" aria-label="Breadcrumbs"></nav>
      <div class="flex-1"></div>
      <div class="searchbox">
        ${icon('search', 'search-ic')}
        <input class="search-input" placeholder="Search components…" spellcheck="false" />
        <kbd class="search-kbd">/</kbd>
        <div class="search-drop" hidden></div>
      </div>
      ${state.canEdit
        ? `<div class="save-status" data-status="saved"><span class="ss-dot"></span><span class="ss-label">Saved</span></div>
           <button class="btn btn-primary" data-act="add">${icon('plus')}<span>Node</span></button>`
        : `<span class="view-pill" data-tip="Sign in to edit">${icon('eye')}<span>View only</span></span>
           <button class="btn btn-primary" data-act="signin"><span>Sign in</span></button>`}
      <button class="btn" data-act="export">${icon('download')}<span>Export</span></button>
      <div class="tool-group">
        <button class="icon-btn toggle" data-act="arrange" data-tip="Auto-arrange view · L">${icon('layout')}</button>
        <button class="icon-btn" data-act="fit" data-tip="Zoom to fit · F">${icon('fit')}</button>
        ${state.canEdit ? `
        <button class="icon-btn toggle" data-act="snap" data-tip="Snapping · S (hold ⌥ to bypass)">${icon('magnet')}</button>` : ''}
        <button class="icon-btn" data-act="theme" data-tip="Theme · T">${icon('moon')}</button>
        <button class="icon-btn" data-act="help" data-tip="Shortcuts · ?">${icon('help')}</button>
      </div>
    </header>
    <div class="sub-backdrop" hidden><div class="sub-ghost"></div></div>
    <div class="canvas-host"></div>
    <div class="sub-rails" hidden>
      <div class="sub-rail sub-rail-in">
        <div class="rail-label">${icon('arrow-l', 'rail-flip')} Feeds in</div>
        <div class="rail-items"></div>
      </div>
      <div class="sub-rail sub-rail-out">
        <div class="rail-label">Feeds out ${icon('arrow-l', 'rail-flip')}</div>
        <div class="rail-items"></div>
      </div>
    </div>
    <div class="sub-head glass" hidden></div>
    <aside class="panel-host"></aside>
    <div class="hud hud-bl">
      <div class="minimap glass">
        <button class="icon-btn icon-btn-sm mm-hide" data-tip="Hide minimap · M">${icon('x')}</button>
      </div>
      <div class="hud-row">
        <div class="zoom-pill glass">
          <button class="icon-btn icon-btn-sm" data-zoom="out" data-tip="Zoom out · −">−</button>
          <button class="zoom-label" data-zoom="reset" data-tip="Reset to 100% · 0">100%</button>
          <button class="icon-btn icon-btn-sm" data-zoom="in" data-tip="Zoom in · +">+</button>
        </div>
        <button class="icon-btn glass mm-show" data-tip="Show minimap · M" hidden>${icon('map')}</button>
      </div>
    </div>
    <div class="legend glass">
      <button class="legend-toggle icon-btn icon-btn-sm" data-tip="Collapse legend">${icon('chev-d')}</button>
      <div class="legend-items"></div>
      <button class="legend-clear" hidden>Clear</button>
    </div>`;

  const crumbsEl = viewEl.querySelector('.crumbs');
  const searchInput = viewEl.querySelector('.search-input');
  const searchDrop = viewEl.querySelector('.search-drop');
  const saveStatus = viewEl.querySelector('.save-status');
  const legendEl = viewEl.querySelector('.legend');
  const legendItems = viewEl.querySelector('.legend-items');
  const legendClear = viewEl.querySelector('.legend-clear');
  const zoomLabel = viewEl.querySelector('.zoom-label');
  const snapBtn = viewEl.querySelector('[data-act=snap]');
  const themeBtn = viewEl.querySelector('[data-act=theme]');

  /* ── sub-workflow focus mode ──
     Inside a container, the canvas becomes a rounded panel floating over a
     blurred ghost of the parent layer; rails on the sides list what feeds
     into / out of this container at the parent level.
     Registered BEFORE initCanvas so the layer-change class lands (and the
     host has its popup size) before the canvas computes its fit. */
  const subBackdrop = viewEl.querySelector('.sub-backdrop');
  const subGhost = viewEl.querySelector('.sub-ghost');
  const subRails = viewEl.querySelector('.sub-rails');
  const subHead = viewEl.querySelector('.sub-head');
  const railInItems = viewEl.querySelector('.sub-rail-in .rail-items');
  const railOutItems = viewEl.querySelector('.sub-rail-out .rail-items');

  function ghostHTML(siblings, activeId) {
    return siblings.map((n) => `
      <div class="ghost-node${n.id === activeId ? ' active' : ''}" style="left:${n.x}px;top:${n.y}px">
        <span class="chip chip-sm t-${esc(TYPES[n.type] ? n.type : 'other')}">${icon(TYPES[n.type]?.icon || 'dot')}</span>
        <span class="gn-title">${esc(n.title) || 'Untitled'}</span>
      </div>`).join('');
  }

  function railHTML(nodes, emptyText) {
    if (!nodes.length) return `<div class="rail-empty">${esc(emptyText)}</div>`;
    return nodes.map((n) => `
      <button class="rail-item" data-nav="${esc(n.id)}" title="${esc(n.title)}">
        <span class="chip chip-sm t-${esc(TYPES[n.type] ? n.type : 'other')}">${icon(TYPES[n.type]?.icon || 'dot')}</span>
        <span class="ri-text">
          <span class="ri-title">${esc(n.title) || 'Untitled'}</span>
          <span class="ri-type">${TYPES[n.type]?.label || ''}${hasChildren(n.id) ? ' · open ▸' : ''}</span>
        </span>
      </button>`).join('');
  }

  function renderSubFocus() {
    const pid = state.parentId;
    const container = state.project && pid !== 'root' ? getNode(pid) : null;
    viewEl.classList.toggle('subfocus', !!container);
    subBackdrop.hidden = !container;
    subRails.hidden = !container;
    subHead.hidden = !container;
    if (!container) return;

    /* ghost of the parent layer, scaled to fit behind the popup */
    const siblings = childrenOf(container.parentId);
    const CW = 216, CH = 92, PAD = 80;
    const rect = subBackdrop.getBoundingClientRect();
    const minX = Math.min(...siblings.map((n) => n.x));
    const maxX = Math.max(...siblings.map((n) => n.x + CW));
    const minY = Math.min(...siblings.map((n) => n.y));
    const maxY = Math.max(...siblings.map((n) => n.y + CH));
    const s = Math.min((rect.width - PAD * 2) / (maxX - minX), (rect.height - PAD * 2) / (maxY - minY), 0.9);
    const ox = (rect.width - (maxX - minX) * s) / 2 - minX * s;
    const oy = (rect.height - (maxY - minY) * s) / 2 - minY * s;
    subGhost.style.transformOrigin = '0 0';
    subGhost.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
    subGhost.innerHTML = ghostHTML(siblings, container.id);

    /* head: what we're inside of */
    const parentName = container.parentId === 'root' ? (state.project?.name || 'Top level') : (getNode(container.parentId)?.title || 'parent');
    const kids = childCount(container.id);
    subHead.innerHTML = `
      <span class="chip t-${esc(TYPES[container.type] ? container.type : 'other')}">${icon(TYPES[container.type]?.icon || 'dot')}</span>
      <span class="sh-text">
        <span class="sh-title">${esc(container.title) || 'Untitled'}</span>
        <span class="sh-sub">${kids} component${kids === 1 ? '' : 's'} inside · part of ${esc(parentName)}</span>
      </span>
      <button class="icon-btn icon-btn-sm" data-act="closesub" data-tip="Close · U">${icon('x')}</button>`;
    subHead.querySelector('[data-act=closesub]').addEventListener('click', () => goUp());

    /* rails: parent-layer connections of this container */
    const edges = layerEdges(container.parentId);
    const inputs = edges.filter((e) => e.to === container.id).map((e) => getNode(e.from)).filter(Boolean);
    const outputs = edges.filter((e) => e.from === container.id).map((e) => getNode(e.to)).filter(Boolean);
    railInItems.innerHTML = railHTML(inputs, 'Nothing connects in at the parent level.');
    railOutItems.innerHTML = railHTML(outputs, 'Nothing connects out at the parent level.');
  }

  subBackdrop.addEventListener('click', () => goUp());
  subRails.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    const id = b.dataset.nav;
    const n = getNode(id);
    if (!n) return;
    if (hasChildren(id)) {
      setParent(id);            // jump straight into the neighboring sub-workflow
    } else {
      setParent(n.parentId);    // surface at the parent level with it selected
      setSelection([id]);
      emit('locate', id);
    }
  });
  on('layer', renderSubFocus);
  on('graph', renderSubFocus);
  on('node', renderSubFocus);
  on('project:close', renderSubFocus);
  window.addEventListener('resize', debounce(renderSubFocus, 160));

  canvas = initCanvas(viewEl.querySelector('.canvas-host'));
  initPanel(viewEl.querySelector('.panel-host'));
  minimap = initMinimap(viewEl.querySelector('.minimap'), canvas);

  /* ── minimap show/hide ── */
  const mmHost = viewEl.querySelector('.minimap');
  const mmShow = viewEl.querySelector('.mm-show');
  const setMinimap = (vis) => {
    minimap.setVisible(vis);
    mmShow.hidden = vis;
    uiPref('minimap', vis ? '1' : '0');
  };
  viewEl.querySelector('.mm-hide').addEventListener('click', () => setMinimap(false));
  mmShow.addEventListener('click', () => setMinimap(true));
  if (uiPref('minimap') === '0') setMinimap(false);
  // keep the canvas reference: hidden state lives on the host element
  mmHost.hidden = uiPref('minimap') === '0';

  /* ── top bar actions ── */
  viewEl.querySelector('[data-act=library]').addEventListener('click', () => closeProject());
  viewEl.querySelector('[data-act=fit]').addEventListener('click', () => canvas.fit());
  const arrangeBtn = viewEl.querySelector('[data-act=arrange]');
  const toggleArrange = () => {
    const on = canvas.toggleArrangeView();
    arrangeBtn.classList.toggle('on', on);
    toast(on ? 'Auto-arrange view on — positions are not changed.' : 'Auto-arrange view off.', { type: 'info', timeout: 2000 });
  };
  arrangeBtn.addEventListener('click', toggleArrange);
  arrangeBtn.classList.toggle('on', canvas.arrangeViewOn());
  viewEl.querySelector('[data-act=signin]')?.addEventListener('click', () => { location.hash = '#welcome'; });
  snapBtn?.addEventListener('click', toggleSnap);
  themeBtn.addEventListener('click', () => { toggleTheme(); reflectTheme(); });
  viewEl.querySelector('[data-act=help]').addEventListener('click', openHelp);
  viewEl.querySelector('[data-act=export]').addEventListener('click', openExportDialog);
  viewEl.querySelector('[data-act=add]')?.addEventListener('click', (e) => {
    menu(e.currentTarget, TYPE_ORDER.map((t) => ({
      label: TYPES[t].label,
      icon: TYPES[t].icon,
      color: `var(--c-${t})`,
      fn: () => canvas.addNodeAtCenter(t),
    })));
  });

  const reflectTheme = () => { themeBtn.innerHTML = icon(getTheme() === 'dark' ? 'sun' : 'moon'); };
  reflectTheme();

  const reflectSnap = () => snapBtn?.classList.toggle('on', snapEnabled());
  on('snap', () => {
    reflectSnap();
    toast(snapEnabled() ? 'Snapping on.' : 'Snapping off.', { type: 'info', timeout: 1600 });
  });

  /* ── zoom pill ── */
  viewEl.querySelector('[data-zoom=in]').addEventListener('click', () => canvas.zoomBy(1.25));
  viewEl.querySelector('[data-zoom=out]').addEventListener('click', () => canvas.zoomBy(1 / 1.25));
  viewEl.querySelector('[data-zoom=reset]').addEventListener('click', () => canvas.resetZoom());
  on('view', () => { zoomLabel.textContent = Math.round(canvas.getZoom() * 100) + '%'; });

  /* ── save status ── */
  on('save', (s) => {
    if (!saveStatus) return;
    saveStatus.dataset.status = s;
    saveStatus.querySelector('.ss-label').textContent = { saving: 'Saving…', saved: 'Saved', error: 'Save failed — retrying' }[s] || s;
  });

  /* ── breadcrumbs ── */
  function renderCrumbs() {
    if (!state.project) return;
    let chain = crumbs(state.parentId);
    let parts = [];
    const crumbBtn = (c, last) =>
      `<button class="crumb${last ? ' current' : ''}" data-crumb="${esc(c.id)}" ${last ? 'aria-current="page"' : ''}>${esc(c.name)}</button>`;
    if (chain.length > 4) {
      const hidden = chain.slice(1, chain.length - 2);
      parts.push(crumbBtn(chain[0], false), `<span class="crumb-sep">▸</span>`,
        `<button class="crumb crumb-more" data-more>…</button>`, `<span class="crumb-sep">▸</span>`);
      chain = chain.slice(-2);
      crumbsEl.innerHTML = parts.join('') + chain.map((c, i) =>
        `${i ? '<span class="crumb-sep">▸</span>' : ''}${crumbBtn(c, i === chain.length - 1)}`).join('');
      crumbsEl.querySelector('[data-more]').addEventListener('click', (e) => {
        menu(e.currentTarget, hidden.map((c) => ({ label: c.name, icon: 'stack', fn: () => setParent(c.id) })), { align: 'left' });
      });
    } else {
      crumbsEl.innerHTML = chain.map((c, i) =>
        `${i ? '<span class="crumb-sep">▸</span>' : ''}${crumbBtn(c, i === chain.length - 1)}`).join('');
    }
    for (const b of crumbsEl.querySelectorAll('[data-crumb]')) {
      b.addEventListener('click', () => setParent(b.dataset.crumb));
    }
  }
  on('layer', renderCrumbs);
  on('project:open', () => { renderCrumbs(); reflectSnap(); renderLegend(); });
  on('node', renderCrumbs);          // renames may affect the trail
  on('graph', renderCrumbs);

  /* ── legend (doubles as a type filter) ── */
  function renderLegend() {
    if (!state.project) return;
    const counts = projectStats(state.project).byType;
    legendItems.innerHTML = TYPE_ORDER.map((t) => `
      <button class="legend-item${state.filters.has(t) ? ' on' : ''}" data-type="${t}" data-tip="${counts[t]} in project — click to focus">
        <span class="legend-dot" style="background:var(--c-${t})"></span><span>${TYPES[t].label}</span>
      </button>`).join('');
    legendClear.hidden = state.filters.size === 0;
    for (const b of legendItems.querySelectorAll('[data-type]')) {
      b.addEventListener('click', () => {
        const next = new Set(state.filters);
        if (next.has(b.dataset.type)) next.delete(b.dataset.type);
        else next.add(b.dataset.type);
        setFilters(next);
      });
    }
  }
  on('filters', renderLegend);
  on('graph', renderLegend);
  legendClear.addEventListener('click', () => setFilters(new Set()));
  const legendToggle = viewEl.querySelector('.legend-toggle');
  legendToggle.addEventListener('click', () => {
    const collapsed = legendEl.classList.toggle('collapsed');
    uiPref('legend', collapsed ? '0' : '1');
    legendToggle.dataset.tip = collapsed ? 'Show legend' : 'Collapse legend';
  });
  if (uiPref('legend') === '0') legendEl.classList.add('collapsed');

  /* ── search ── */
  let results = [];
  let activeIdx = -1;

  const runSearch = debounce(() => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q || !state.project) { hideDrop(); return; }
    results = state.project.nodes.map((n) => {
      let score = 0;
      const title = (n.title || '').toLowerCase();
      if (title.startsWith(q)) score += 5;
      else if (title.includes(q)) score += 3;
      if ((n.tags || []).some((t) => t.toLowerCase().includes(q))) score += 2.5;
      if ((n.path || '').toLowerCase().includes(q)) score += 2;
      if ((n.summary || '').toLowerCase().includes(q)) score += 1;
      else if ((n.content || '').toLowerCase().includes(q)) score += 0.5;
      return { n, score };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    activeIdx = results.length ? 0 : -1;
    renderDrop(q);
  }, 130);

  function renderDrop(q) {
    if (!results.length) {
      searchDrop.innerHTML = `<div class="sd-empty">No matches for “${esc(q)}”</div>`;
      searchDrop.hidden = false;
      return;
    }
    searchDrop.innerHTML = results.map(({ n }, i) => {
      const where = crumbs(n.parentId).map((c) => c.name);
      where[0] = 'Top level';
      return `
        <button class="sd-item${i === activeIdx ? ' active' : ''}" data-idx="${i}">
          <span class="chip chip-sm t-${esc(n.type)}">${icon(TYPES[n.type]?.icon || 'dot')}</span>
          <span class="sd-text">
            <span class="sd-title">${esc(n.title) || 'Untitled'}</span>
            <span class="sd-where">${esc(where.join(' ▸ '))}</span>
          </span>
          <span class="sd-type">${TYPES[n.type]?.label || ''}</span>
        </button>`;
    }).join('');
    searchDrop.hidden = false;
    for (const b of searchDrop.querySelectorAll('.sd-item')) {
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep input focus
      b.addEventListener('click', () => gotoResult(+b.dataset.idx));
    }
  }

  function hideDrop() { searchDrop.hidden = true; results = []; activeIdx = -1; }

  function gotoResult(i) {
    const r = results[i];
    if (!r) return;
    hideDrop();
    searchInput.blur();
    if (state.parentId !== r.n.parentId) setParent(r.n.parentId);
    setSelection([r.n.id]);
    emit('locate', r.n.id);
  }

  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) runSearch(); });
  searchInput.addEventListener('blur', () => setTimeout(hideDrop, 140));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      renderDrop(searchInput.value.trim());
    } else if (e.key === 'Enter') {
      e.preventDefault();
      gotoResult(activeIdx);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      hideDrop();
      searchInput.blur();
    }
  });

  /* ── keyboard shortcuts ── */
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, select, [contenteditable]');
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (state.mode === 'project') searchInput.focus();
      return;
    }
    if (typing) return;

    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (state.mode !== 'project') return;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!runUndo()) toast('Nothing to undo.', { type: 'info', timeout: 1500 }); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dupSelection(); return; }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection(childrenOf(state.parentId).map((n) => n.id));
      return;
    }
    if (mod) return;

    switch (e.key) {
      case '/': e.preventDefault(); searchInput.focus(); break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (state.selectedEdge) deleteEdge(state.selectedEdge);
        else if (state.selection.size) deleteNodes([...state.selection]);
        break;
      case 'Escape':
        if (state.selection.size || state.selectedEdge) setSelection([]);
        break;
      case 'n': case 'N': canvas.addNodeAtCenter('agent'); break;
      case 'f': case 'F': canvas.fit(); break;
      case 'l': case 'L': toggleArrange(); break;
      case 's': case 'S': toggleSnap(); break;
      case 'm': case 'M': setMinimap(mmHost.hidden); break;
      case 't': case 'T': toggleTheme(); reflectTheme(); break;
      case 'u': case 'U': goUp(); break;
      case '0': canvas.resetZoom(); break;
      case '+': case '=': canvas.zoomBy(1.25); break;
      case '-': case '_': canvas.zoomBy(1 / 1.25); break;
    }
  });

  function dupSelection() {
    if (!state.selection.size) return;
    const clones = duplicateNodes([...state.selection]);
    if (clones.length) setSelection(clones.map((c) => c.id));
  }
}

/* ════════ export dialog ════════ */

function openExportDialog() {
  const p = state.project;
  if (!p) return;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="export-opts">
      <label class="export-opt">
        <input type="radio" name="fmt" value="json" checked />
        <span class="eo-body">
          <span class="eo-title">${icon('logo')} Project file <code>.agentmap.json</code></span>
          <span class="eo-desc">Exact, lossless copy of this project. Best for backups and moving between browsers — re-imports perfectly.</span>
        </span>
      </label>
      <label class="export-opt">
        <input type="radio" name="fmt" value="handoff" />
        <span class="eo-body">
          <span class="eo-title">${icon('spark')} AI handoff <code>.md</code></span>
          <span class="eo-desc">Self-describing Markdown another AI can read directly — architecture, hierarchy, connections, and key components explained.</span>
          <span class="depth-seg" role="radiogroup">
            <button class="seg" data-depth="overview">Overview</button>
            <button class="seg on" data-depth="standard">Standard</button>
            <button class="seg" data-depth="full">Full detail</button>
          </span>
          <span class="eo-note" data-note></span>
        </span>
      </label>
    </div>
    <div class="export-foot">
      <span class="export-size" data-size></span>
      <span class="flex-1"></span>
      <button class="btn" data-act="copy">${icon('copy')} Copy</button>
      <button class="btn btn-primary" data-act="download">${icon('download')} Download</button>
    </div>`;

  const m = openModal({ title: `Export “${p.name}”`, content: wrap, width: 560 });

  const notes = {
    overview: 'Smallest output — architecture prose only. Not re-importable.',
    standard: 'Adds every component’s metadata + embedded project data. Re-importable.',
    full: 'Everything, including full file contents. Re-importable.',
  };
  let fmt = 'json';
  let depth = 'standard';
  let built = null;

  const rebuild = () => {
    built = fmt === 'json' ? exportProjectFile(p) : buildHandoff(p, depth);
    const kb = built.text.length / 1024;
    wrap.querySelector('[data-size]').textContent =
      `${built.filename} · ≈ ${kb >= 1000 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB'}`;
    wrap.querySelector('[data-note]').textContent = fmt === 'handoff' ? notes[depth] : '';
    wrap.querySelector('.depth-seg').style.display = fmt === 'handoff' ? '' : 'none';
  };

  for (const r of wrap.querySelectorAll('input[name=fmt]')) {
    r.addEventListener('change', () => { fmt = r.value; rebuild(); });
  }
  for (const b of wrap.querySelectorAll('.seg')) {
    b.addEventListener('click', () => {
      wrap.querySelector('.seg.on')?.classList.remove('on');
      b.classList.add('on');
      depth = b.dataset.depth;
      wrap.querySelector('input[value=handoff]').checked = true;
      fmt = 'handoff';
      rebuild();
    });
  }
  wrap.querySelector('[data-act=download]').addEventListener('click', () => {
    download(built.filename, built.text, fmt === 'json' ? 'application/json' : 'text/markdown');
    m.close();
    toast(`Exported ${built.filename}`, { type: 'ok' });
  });
  wrap.querySelector('[data-act=copy]').addEventListener('click', async () => {
    const ok = await copyText(built.text);
    toast(ok ? 'Copied to clipboard.' : 'Copy failed — try Download instead.', { type: ok ? 'ok' : 'error' });
    if (ok) m.close();
  });
  rebuild();
}

/* ════════ help / shortcut reference ════════ */

export function openHelp() {
  const K = (...keys) => keys.map((k) => `<kbd>${k}</kbd>`).join(' ');
  const row = (keys, label) => `<div class="help-row"><span class="help-keys">${keys}</span><span>${label}</span></div>`;
  openModal({
    title: 'Shortcuts & tips',
    width: 640,
    content: `
      <div class="help-grid">
        <div class="help-col">
          <div class="help-h">Canvas</div>
          ${row(K('scroll'), 'Pan')}
          ${row(K('⌘', 'scroll'), 'Zoom (or pinch)')}
          ${row(K('space', 'drag'), 'Pan (also middle-drag)')}
          ${row(K('F'), 'Zoom to fit')}
          ${row(K('0'), 'Reset zoom')}
          ${row(K('+') + ' / ' + K('−'), 'Zoom in / out')}
          ${row(K('M'), 'Toggle minimap')}
          <div class="help-h">Navigation</div>
          ${row(K('dbl-click') + ' container', 'Open its inner map')}
          ${row(K('U'), 'Up one level')}
          ${row(K('/') + ' or ' + K('⌘', 'K'), 'Search everything')}
        </div>
        <div class="help-col">
          <div class="help-h">Editing</div>
          ${row(K('dbl-click') + ' canvas', 'New node at cursor')}
          ${row(K('N'), 'New node at center')}
          ${row('drag from a side port', 'Connect nodes (drop on empty space to create + connect)')}
          ${row(K('⇧', 'click'), 'Multi-select')}
          ${row(K('⇧', 'drag') + ' canvas', 'Marquee select')}
          ${row(K('⌘', 'D'), 'Duplicate selection')}
          ${row(K('⌫'), 'Delete selection / connection')}
          ${row(K('⌘', 'Z'), 'Undo last delete or auto-arrange')}
          ${row(K('S'), 'Toggle snapping')}
          ${row(K('⌥', 'drag'), 'Bypass snapping')}
          ${row(K('L'), 'Auto-arrange view (display only — saved positions are untouched)')}
          ${row(K('T'), 'Light / dark theme')}
        </div>
      </div>
      <div class="help-note">${icon('logo')} Projects autosave — to your server when one is connected, otherwise to this browser. Use <b>Export → Project file</b> or the library's <b>Back up all projects</b> to move or safeguard your work.</div>`,
  });
}
