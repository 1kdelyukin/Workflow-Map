// Right-side detail panel: read and edit the selected node, navigate its children
// and connections. Collapsible, resizable, autosaves through state actions.
import {
  state, on, emit, TYPES, TYPE_ORDER, getNode, childrenOf, childCount,
  updateNode, deleteNodes, duplicateNodes, deleteEdge, addNode, setParent, setSelection,
} from './state.js';
import { esc, clamp, copyText, uiPref } from './ui.js';
import { icon } from './icons.js';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|py|sh|bash|json|ya?ml|css|html|sql|go|rs|rb|java|toml)$/i;

export function initPanel(host) {
  host.className = 'panel';
  host.hidden = true;

  let width = clamp(parseInt(uiPref('panelWidth') || '388', 10) || 388, 320, 620);
  host.style.width = width + 'px';

  let currentId = null;

  /* ---------- rendering ---------- */

  function render() {
    const sel = [...state.selection];
    if (state.mode !== 'project' || sel.length === 0) {
      host.hidden = true;
      currentId = null;
      return;
    }
    if (sel.length > 1) {
      currentId = null;
      host.hidden = false;
      host.innerHTML = `
        <div class="panel-grip"></div>
        <div class="panel-multi">
          <div class="pm-count">${sel.length} selected</div>
          <button class="btn" data-act="dup">${icon('copy')} Duplicate</button>
          <button class="btn btn-danger-ghost" data-act="del">${icon('trash')} Delete</button>
          <button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button>
        </div>`;
      wireCommon();
      return;
    }

    const n = getNode(sel[0]);
    if (!n) { host.hidden = true; currentId = null; return; }
    currentId = n.id;
    host.hidden = false;

    const kids = childrenOf(n.id);
    const edges = state.project.edges.filter((e) => e.from === n.id || e.to === n.id);
    const mono = n.type === 'code' || CODE_EXT.test(n.path || '');

    host.innerHTML = `
      <div class="panel-grip" title="Drag to resize"></div>
      <div class="panel-head">
        <span class="chip t-${esc(n.type)}">${icon(TYPES[n.type].icon)}</span>
        <input class="panel-title" data-field="title" value="${esc(n.title)}" placeholder="Untitled" spellcheck="false" />
        <button class="icon-btn" data-act="close" aria-label="Close panel" data-tip="Close (esc)">${icon('x')}</button>
      </div>

      <div class="panel-scroll">
        <div class="panel-meta">
          <label class="field">
            <span class="field-label">Type</span>
            <span class="select-wrap"><select data-field="type">
              ${TYPE_ORDER.map((t) => `<option value="${t}" ${t === n.type ? 'selected' : ''}>${TYPES[t].label}</option>`).join('')}
            </select>${icon('chev-d', 'select-chev')}</span>
          </label>
          <label class="field">
            <span class="field-label">File path</span>
            <input class="text-input mono" data-field="path" value="${esc(n.path)}" placeholder="e.g. agents/planner.md" spellcheck="false" />
          </label>
          <div class="field">
            <span class="field-label">Tags</span>
            <div class="tags-edit" data-tags>
              ${n.tags.map((t) => tagChip(t)).join('')}
              <input class="tag-input" placeholder="${n.tags.length ? '' : 'Add tag…'}" spellcheck="false" />
            </div>
          </div>
          <label class="field">
            <span class="field-label">Summary</span>
            <textarea class="text-input" data-field="summary" rows="2" placeholder="One or two sentences on what this does…" spellcheck="false">${esc(n.summary)}</textarea>
          </label>
        </div>

        <div class="panel-section">
          <div class="section-head">
            <span class="field-label">Content</span>
            <button class="mini-btn" data-act="copy" data-tip="Copy content">${icon('copy')} Copy</button>
          </div>
          <textarea class="content-input ${mono ? 'mono' : ''}" data-field="content" placeholder="Full content — instructions, documentation, or code…" spellcheck="false">${esc(n.content)}</textarea>
        </div>

        <div class="panel-section">
          <div class="section-head">
            <span class="field-label">Inside this component</span>
            ${kids.length ? `<button class="mini-btn accent" data-act="open">Open ${icon('chev-r')}</button>` : ''}
          </div>
          ${kids.length ? `
            <div class="kid-list">
              ${kids.slice(0, 6).map((k) => `
                <button class="kid-row" data-kid="${esc(k.id)}">
                  <span class="chip chip-sm t-${esc(k.type)}">${icon(TYPES[k.type].icon)}</span>
                  <span class="kid-name">${esc(k.title)}</span>
                  ${childCount(k.id) ? `<span class="kid-count">${childCount(k.id)}</span>` : ''}
                </button>`).join('')}
              ${kids.length > 6 ? `<div class="kid-more">+ ${kids.length - 6} more inside</div>` : ''}
            </div>` : `<div class="hint-text">Nothing inside yet — add a child to turn this into a container.</div>`}
          <button class="mini-btn" data-act="add-child">${icon('plus')} Add child component</button>
        </div>

        <div class="panel-section">
          <div class="section-head"><span class="field-label">Connections</span></div>
          ${edges.length ? `<div class="conn-list">${edges.map((e) => connRow(n, e)).join('')}</div>`
            : `<div class="hint-text">No connections — drag from a node's edge port to link it.</div>`}
        </div>

        <div class="panel-footer">
          <button class="mini-btn" data-act="dup">${icon('copy')} Duplicate</button>
          <span class="flex-1"></span>
          <button class="mini-btn danger" data-act="del">${icon('trash')} Delete</button>
        </div>
      </div>`;
    wireCommon();
    wireEditor(n);
    if (!state.canEdit) {
      // viewers can read, select, and copy — not change
      for (const el of host.querySelectorAll('input, textarea')) el.readOnly = true;
      for (const el of host.querySelectorAll('select')) el.disabled = true;
    }
  }

  const tagChip = (t) => `<span class="tag-chip">${esc(t)}<button class="tag-x" data-tag="${esc(t)}" aria-label="Remove tag">${icon('x')}</button></span>`;

  function connRow(n, e) {
    const out = e.from === n.id;
    const other = getNode(out ? e.to : e.from);
    if (!other) return '';
    return `
      <div class="conn-row">
        <span class="conn-dir ${out ? 'out' : 'in'}" data-tip="${out ? 'Outgoing' : 'Incoming'}">${icon('arrow-l')}</span>
        <button class="conn-name" data-goto="${esc(other.id)}">${esc(other.title)}</button>
        <button class="icon-btn icon-btn-sm" data-unlink="${esc(e.id)}" aria-label="Remove connection">${icon('x')}</button>
      </div>`;
  }

  /* ---------- wiring ---------- */

  function wireCommon() {
    host.querySelector('[data-act=close]')?.addEventListener('click', () => setSelection([]));
    host.querySelector('[data-act=dup]')?.addEventListener('click', () => {
      const clones = duplicateNodes([...state.selection]);
      if (clones.length) setSelection(clones.map((c) => c.id));
    });
    host.querySelector('[data-act=del]')?.addEventListener('click', () => deleteNodes([...state.selection]));

    /* resize grip */
    const grip = host.querySelector('.panel-grip');
    grip?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      const move = (ev) => {
        width = clamp(window.innerWidth - ev.clientX - 14, 320, 620);
        host.style.width = width + 'px';
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        uiPref('panelWidth', width);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  function wireEditor(n) {
    const id = n.id;

    for (const el of host.querySelectorAll('[data-field]')) {
      el.addEventListener('input', () => {
        updateNode(id, { [el.dataset.field]: el.value }, { source: 'panel' });
        if (el.dataset.field === 'summary') autoGrow(el);
      });
      if (el.dataset.field === 'type') {
        el.addEventListener('change', () => updateNode(id, { type: el.value }, { source: 'panel' }));
      }
    }
    const summary = host.querySelector('[data-field=summary]');
    if (summary) autoGrow(summary);

    /* content: keep Tab as indentation */
    const content = host.querySelector('[data-field=content]');
    content?.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: epos } = content;
        content.value = content.value.slice(0, s) + '  ' + content.value.slice(epos);
        content.selectionStart = content.selectionEnd = s + 2;
        updateNode(id, { content: content.value }, { source: 'panel' });
      }
    });

    host.querySelector('[data-act=copy]')?.addEventListener('click', async (e) => {
      const ok = await copyText(getNode(id)?.content || '');
      const btn = e.currentTarget;
      btn.innerHTML = ok ? `${icon('check')} Copied` : `${icon('warn')} Failed`;
      setTimeout(() => { btn.innerHTML = `${icon('copy')} Copy`; }, 1400);
    });

    /* tags */
    const tagsBox = host.querySelector('[data-tags]');
    const tagInput = tagsBox?.querySelector('.tag-input');
    tagsBox?.addEventListener('click', (e) => {
      const x = e.target.closest('.tag-x');
      if (x) {
        const cur = getNode(id);
        updateNode(id, { tags: cur.tags.filter((t) => t !== x.dataset.tag) }, { source: 'panel' });
        x.closest('.tag-chip').remove();
        return;
      }
      tagInput?.focus();
    });
    tagInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = tagInput.value.trim().replace(/,+$/, '');
        if (!v) return;
        const cur = getNode(id);
        if (!cur.tags.includes(v)) {
          updateNode(id, { tags: [...cur.tags, v] }, { source: 'panel' });
          tagInput.insertAdjacentHTML('beforebegin', tagChip(v)); // removal is delegated on tagsBox
        }
        tagInput.value = '';
      } else if (e.key === 'Backspace' && !tagInput.value) {
        const cur = getNode(id);
        if (cur.tags.length) {
          updateNode(id, { tags: cur.tags.slice(0, -1) }, { source: 'panel' });
          tagsBox.querySelector('.tag-chip:last-of-type')?.remove();
        }
      }
    });

    /* children */
    host.querySelector('[data-act=open]')?.addEventListener('click', () => setParent(id));
    host.querySelector('[data-act=add-child]')?.addEventListener('click', () => {
      const child = addNode({ parentId: id, x: 60, y: 60, title: 'Untitled', type: 'agent' });
      setParent(id);
      setSelection([child.id], { focusTitle: true });
    });
    for (const row of host.querySelectorAll('[data-kid]')) {
      row.addEventListener('click', () => {
        setParent(id);
        setSelection([row.dataset.kid]);
        emit('locate', row.dataset.kid);
      });
    }

    /* connections */
    for (const b of host.querySelectorAll('[data-goto]')) {
      b.addEventListener('click', () => {
        setSelection([b.dataset.goto]);
        emit('locate', b.dataset.goto);
      });
    }
    for (const b of host.querySelectorAll('[data-unlink]')) {
      b.addEventListener('click', () => deleteEdge(b.dataset.unlink));
    }

    /* esc inside inputs blurs instead of bubbling to canvas */
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.matches('input, textarea, select')) {
        e.stopPropagation();
        e.target.blur();
      }
    });
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(160, el.scrollHeight + 2) + 'px';
  }

  /* ---------- subscriptions ---------- */

  on('selection', (opts = {}) => {
    render();
    if (opts.focusTitle) {
      const t = host.querySelector('.panel-title');
      if (t) { t.focus(); t.select(); }
    }
  });
  on('layer', render);
  on('project:open', render);
  on('project:close', render);
  on('graph', () => { if (currentId || state.selection.size) render(); });
  on('node', ({ id, source }) => {
    // external edits to the open node (e.g. type changed elsewhere) refresh the panel
    if (source !== 'panel' && id === currentId) render();
  });
}
