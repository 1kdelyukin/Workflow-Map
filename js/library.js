// Project library: the landing view. Create, open, rename, duplicate, delete,
// search, sort, import/export — plus the whole-library backup.
import {
  state, on, VERSION, TYPE_ORDER, projectStats, createProject, openProject,
  renameProject, duplicateProject, deleteProjectWithUndo,
} from './state.js';
import { esc, timeAgo, menu, toast, download, confirmDialog, promptDialog, uiPref, toggleTheme, getTheme } from './ui.js';
import { authLogout } from './storage.js';
import { icon } from './icons.js';
import { exportProjectFile, exportBackupFile } from './transfer.js';
import { openImportPicker } from './importer.js';
import { sampleProject } from './sample.js';
import { openHelp } from './workspace.js';

export function initLibrary(viewEl) {
  let query = '';
  let sort = uiPref('sort') || 'updated';

  const remote = state.storage === 'remote';
  const guest = remote && !state.canEdit;
  viewEl.innerHTML = `
    <div class="lib-wrap">
      <header class="lib-head">
        <div class="lib-brand">${icon('logo', 'brand-ic')}<span class="brand-name">AgentMap</span></div>
        <div class="flex-1"></div>
        ${guest ? `<button class="btn btn-primary" data-act="signin">Sign in</button>` : ''}
        <button class="icon-btn" data-act="theme" data-tip="Theme">${icon('moon')}</button>
        <button class="icon-btn" data-act="more" data-tip="More">${icon('dots')}</button>
      </header>
      <div class="lib-hero">
        <h1>Projects</h1>
        <p class="lib-sub">Visual maps of your AI-agent systems — ${guest
          ? `viewing as guest · ${icon('eye')} read-only`
          : remote
            ? 'synced to your server, live for AI assistants over MCP'
            : 'stored in this browser, portable as files'}.</p>
      </div>
      <div class="lib-controls">
        <div class="searchbox lib-search">
          ${icon('search', 'search-ic')}
          <input class="search-input" placeholder="Search projects…" spellcheck="false" />
        </div>
        <span class="select-wrap sort-wrap">
          <select class="sort-select" aria-label="Sort projects">
            <option value="updated">Last edited</option>
            <option value="created">Newest</option>
            <option value="name">Name A–Z</option>
            <option value="size">Most components</option>
          </select>${icon('chev-d', 'select-chev')}
        </span>
        <div class="flex-1"></div>
        ${state.canEdit ? `
        <button class="btn" data-act="import">${icon('upload')}<span>Import</span></button>
        <button class="btn btn-primary" data-act="new">${icon('plus')}<span>New project</span></button>` : ''}
      </div>
      <div class="lib-grid"></div>
      <footer class="lib-foot">AgentMap ${esc(VERSION)} · ${remote
        ? (guest ? `${icon('eye')} viewing as guest` : `${icon('cloud')} synced to your server`)
        : 'everything stays in this browser'} · back up from the ${icon('dots')} menu</footer>
    </div>`;

  const grid = viewEl.querySelector('.lib-grid');
  const searchInput = viewEl.querySelector('.search-input');
  const sortSelect = viewEl.querySelector('.sort-select');
  const themeBtn = viewEl.querySelector('[data-act=theme]');
  sortSelect.value = sort;

  const reflectTheme = () => { themeBtn.innerHTML = icon(getTheme() === 'dark' ? 'sun' : 'moon'); };
  reflectTheme();
  themeBtn.addEventListener('click', () => { toggleTheme(); reflectTheme(); });

  searchInput.addEventListener('input', () => { query = searchInput.value.trim().toLowerCase(); render(); });
  sortSelect.addEventListener('change', () => { sort = sortSelect.value; uiPref('sort', sort); render(); });

  viewEl.querySelector('[data-act=new]')?.addEventListener('click', newProject);
  viewEl.querySelector('[data-act=import]')?.addEventListener('click', openImportPicker);
  viewEl.querySelector('[data-act=signin]')?.addEventListener('click', () => { location.hash = '#welcome'; });
  viewEl.querySelector('[data-act=more]').addEventListener('click', (e) => {
    const serverItems = state.storage === 'remote'
      ? (state.canEdit
        ? [{ label: state.auth.email ? `Sign out (${state.auth.email})` : 'Sign out', icon: 'cloud', fn: signOut }]
        : [{ label: 'Sign in…', icon: 'cloud', fn: () => { location.hash = '#welcome'; } }])
      : [];
    const editItems = state.canEdit
      ? [{ label: 'Import files…', icon: 'upload', fn: openImportPicker }, { hr: true }, { label: 'Add sample project', icon: 'spark', fn: addSample }]
      : [];
    menu(e.currentTarget, [
      { label: 'Back up all projects', icon: 'download', fn: backupAll },
      ...editItems,
      { label: 'Shortcuts & tips', icon: 'help', fn: openHelp },
      ...(serverItems.length ? [{ hr: true }, ...serverItems] : []),
    ]);
  });

  async function signOut() {
    const ok = await confirmDialog({
      title: 'Sign out?',
      body: 'You will stay on this page as a viewer. Your projects are untouched.',
      confirmLabel: 'Sign out',
      danger: false,
    });
    if (!ok) return;
    try { await authLogout(); } catch { /* cookie may already be gone */ }
    location.reload();
  }

  async function newProject() {
    const res = await promptDialog({
      title: 'New project',
      confirmLabel: 'Create',
      fields: [
        { key: 'name', label: 'Name', placeholder: 'e.g. Support Triage System' },
        { key: 'description', label: 'Description (optional)', placeholder: 'What is this system for?', textarea: true },
      ],
    });
    if (!res) return;
    const p = await createProject({ name: res.name.trim() || 'Untitled project', description: res.description.trim() });
    if (p) openProject(p.id);
  }

  async function addSample() {
    const p = await createProject({ project: sampleProject() });
    if (p) toast(`Added “${p.name}”.`, { type: 'ok' });
  }

  function backupAll() {
    if (!state.projects.length) { toast('Nothing to back up yet.', { type: 'info' }); return; }
    const { filename, text } = exportBackupFile(state.projects);
    download(filename, text, 'application/json');
    toast(`Backed up ${state.projects.length} project${state.projects.length === 1 ? '' : 's'} → ${filename}`, { type: 'ok' });
  }

  /* ── cards ── */

  function visibleProjects() {
    let list = [...state.projects];
    if (query) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query));
    }
    const cmp = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      created: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.nodes.length - a.nodes.length,
    }[sort] || ((a, b) => 0);
    return list.sort(cmp);
  }

  function typeBar(p) {
    const s = projectStats(p);
    if (!s.nodes) return '<div class="type-bar empty"></div>';
    const segs = TYPE_ORDER.filter((t) => s.byType[t] > 0)
      .map((t) => `<span style="flex:${s.byType[t]};background:var(--c-${t})"></span>`).join('');
    return `<div class="type-bar">${segs}</div>`;
  }

  function render() {
    const list = visibleProjects();

    if (!state.projects.length) {
      grid.innerHTML = state.canEdit ? `
        <div class="lib-empty">
          ${icon('logo', 'empty-ic')}
          <h2>Map your first system</h2>
          <p>Projects are layered node graphs: phases and agents on top, skills, hooks, code and docs inside.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" data-act="new2">${icon('plus')} New project</button>
            <button class="btn" data-act="sample2">${icon('spark')} Explore the sample</button>
            <button class="btn" data-act="import2">${icon('upload')} Import</button>
          </div>
        </div>` : `
        <div class="lib-empty">
          ${icon('logo', 'empty-ic')}
          <h2>Nothing here yet</h2>
          <p>This workspace has no projects. The owner can sign in to create one.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" data-act="signin2">Sign in</button>
          </div>
        </div>`;
      grid.querySelector('[data-act=new2]')?.addEventListener('click', newProject);
      grid.querySelector('[data-act=sample2]')?.addEventListener('click', addSample);
      grid.querySelector('[data-act=import2]')?.addEventListener('click', openImportPicker);
      grid.querySelector('[data-act=signin2]')?.addEventListener('click', () => { location.hash = '#welcome'; });
      return;
    }

    if (!list.length) {
      grid.innerHTML = `<div class="lib-empty"><h2>No matches</h2><p>No project named “${esc(query)}”.</p></div>`;
      return;
    }

    grid.innerHTML = list.map((p) => {
      const s = projectStats(p);
      return `
        <article class="proj-card" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Open ${esc(p.name)}">
          <div class="pc-top">
            <h3 class="pc-name">${esc(p.name)}</h3>
            <button class="icon-btn icon-btn-sm pc-menu" data-menu="${esc(p.id)}" aria-label="Project menu">${icon('dots')}</button>
          </div>
          ${p.description ? `<p class="pc-desc">${esc(p.description)}</p>` : ''}
          ${typeBar(p)}
          <div class="pc-meta">
            <span>${s.nodes} component${s.nodes === 1 ? '' : 's'} · ${s.depth} level${s.depth === 1 ? '' : 's'} · ${s.edges} link${s.edges === 1 ? '' : 's'}</span>
          </div>
          <div class="pc-foot">Edited ${esc(timeAgo(p.updatedAt))}</div>
        </article>`;
    }).join('');

    for (const card of grid.querySelectorAll('.proj-card')) {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pc-menu')) return;
        openProject(card.dataset.id);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.target.closest('.pc-menu')) openProject(card.dataset.id);
      });
    }
    for (const btn of grid.querySelectorAll('[data-menu]')) {
      btn.addEventListener('click', () => projectMenu(btn, btn.dataset.menu));
    }
  }

  function projectMenu(anchor, id) {
    const p = state.projects.find((x) => x.id === id);
    if (!p) return;
    const exportItem = { label: 'Export (.json)', icon: 'download', fn: () => {
      const { filename, text } = exportProjectFile(p);
      download(filename, text, 'application/json');
      toast(`Exported ${filename}`, { type: 'ok' });
    } };
    if (!state.canEdit) {
      menu(anchor, [{ label: 'Open', icon: 'chev-r', fn: () => openProject(id) }, exportItem]);
      return;
    }
    menu(anchor, [
      { label: 'Open', icon: 'chev-r', fn: () => openProject(id) },
      { label: 'Rename…', icon: 'pencil', fn: () => rename(p) },
      { label: 'Duplicate', icon: 'copy', fn: async () => { if (await duplicateProject(id)) toast('Duplicated.', { type: 'ok' }); } },
      exportItem,
      { hr: true },
      { label: 'Delete…', icon: 'trash', danger: true, fn: async () => {
        const ok = await confirmDialog({
          title: `Delete “${p.name}”?`,
          body: `This removes the project and its ${p.nodes.length} component${p.nodes.length === 1 ? '' : 's'}. You can undo for a few seconds — or export it first if unsure.`,
        });
        if (ok) deleteProjectWithUndo(id);
      } },
    ]);
  }

  async function rename(p) {
    const res = await promptDialog({
      title: 'Project details',
      confirmLabel: 'Save',
      fields: [
        { key: 'name', label: 'Name', value: p.name },
        { key: 'description', label: 'Description', value: p.description || '', textarea: true },
      ],
    });
    if (res) renameProject(p.id, { name: res.name, description: res.description.trim() });
  }

  on('projects', render);
  render();
}
