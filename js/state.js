// Central app state, event bus, and all data mutations (with autosave + single-step undo).
import {
  initStorage, storageMode, getAllProjects, putProject, deleteProjectRow,
  ConflictError, listProjectMeta, fetchProject,
} from './storage.js';
import { uid, toast, confirmDialog, esc } from './ui.js';

export const VERSION = '1.1.0';
export const SCHEMA = 1;

export const TYPES = {
  phase: { label: 'Phase', icon: 'flag' },
  agent: { label: 'Agent', icon: 'spark' },
  skill: { label: 'Skill', icon: 'wand' },
  hook:  { label: 'Hook',  icon: 'hook' },
  code:  { label: 'Code',  icon: 'code' },
  doc:   { label: 'Documentation', icon: 'doc' },
  other: { label: 'Other', icon: 'dot' },
};
export const TYPE_ORDER = ['phase', 'agent', 'skill', 'hook', 'code', 'doc', 'other'];

export const state = {
  mode: 'library',        // 'library' | 'project'
  projects: [],           // full project objects, in memory
  project: null,          // currently open project (reference into projects[])
  parentId: 'root',       // current layer
  selection: new Set(),   // selected node ids (current layer)
  selectedEdge: null,
  filters: new Set(),     // emphasized node types (empty = all)
  storage: 'idb',
  saveStatus: 'saved',    // 'saved' | 'saving' | 'error'
  firstRun: false,
  remoteAvailable: false,
  canEdit: true,          // false = signed-out viewer on a server deployment
  auth: { registered: false, email: null },
};

/* ---------- edit gate (view-only mode) ---------- */

export const canEdit = () => state.canEdit !== false;

let lastGuardToast = 0;
export function guardEdit() {
  if (canEdit()) return true;
  const now = Date.now();
  if (now - lastGuardToast > 2500) {
    lastGuardToast = now;
    toast('View only — sign in to edit.', { type: 'warn', timeout: 2600 });
  }
  return false;
}

/* ---------- event bus ---------- */

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  const set = listeners.get(evt);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(data); } catch (e) { console.error(`[agentmap] listener for "${evt}" failed`, e); }
  }
}

/* ---------- boot ---------- */

export async function boot() {
  state.storage = await initStorage();
  let rows = [];
  try { rows = await getAllProjects(); } catch (e) { console.error(e); }
  state.projects = rows.filter((p) => p && p.id && Array.isArray(p.nodes));
  if (state.projects.length === 0) state.firstRun = true;
  emit('projects');
  return state;
}

export const nowISO = () => new Date().toISOString();

export function blankProject({ name, description = '' }) {
  const t = nowISO();
  return {
    id: uid(), schema: SCHEMA, name: name || 'Untitled project', description,
    createdAt: t, updatedAt: t,
    settings: { snap: true },
    lastParent: 'root',
    views: {},
    nodes: [],
    edges: [],
  };
}

/* ---------- graph helpers (operate on the open project unless given one) ---------- */

export const getNode = (id, p = state.project) => p?.nodes.find((n) => n.id === id) || null;
export const childrenOf = (pid, p = state.project) => (p ? p.nodes.filter((n) => n.parentId === pid) : []);
export const childCount = (id, p = state.project) => (p ? p.nodes.reduce((a, n) => a + (n.parentId === id ? 1 : 0), 0) : 0);
export const hasChildren = (id, p = state.project) => childCount(id, p) > 0;

export function layerEdges(pid, p = state.project) {
  if (!p) return [];
  const inLayer = new Set(childrenOf(pid, p).map((n) => n.id));
  return p.edges.filter((e) => inLayer.has(e.from) && inLayer.has(e.to));
}

export function crumbs(pid, p = state.project) {
  // path from root → pid as [{id, name}], root entry uses the project name
  const chain = [];
  let cur = pid;
  const guard = new Set();
  while (cur && cur !== 'root' && !guard.has(cur)) {
    guard.add(cur);
    const n = getNode(cur, p);
    if (!n) break;
    chain.unshift({ id: n.id, name: n.title || 'Untitled' });
    cur = n.parentId;
  }
  chain.unshift({ id: 'root', name: p?.name || 'Project' });
  return chain;
}

export function descendants(id, p = state.project) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of p.nodes) {
      if (n.parentId === cur) { out.push(n.id); stack.push(n.id); }
    }
  }
  return out;
}

export function projectStats(p) {
  const byType = {};
  for (const t of TYPE_ORDER) byType[t] = 0;
  let depth = 1;
  const depthOf = new Map([['root', 0]]);
  const resolve = (n, guard = 0) => {
    if (depthOf.has(n.id)) return depthOf.get(n.id);
    if (guard > 200) return 1;
    const parent = n.parentId === 'root' ? 0 : (() => {
      const pn = getNode(n.parentId, p);
      return pn ? resolve(pn, guard + 1) : 0;
    })();
    const d = parent + 1;
    depthOf.set(n.id, d);
    return d;
  };
  for (const n of p.nodes) {
    byType[TYPES[n.type] ? n.type : 'other']++;
    depth = Math.max(depth, resolve(n));
  }
  return { nodes: p.nodes.length, edges: p.edges.length, depth, byType };
}

/* ---------- autosave ---------- */

let saveTimer = null;
let saving = false;
let queued = false;
let retryTimer = null;
let dirty = false;

function setStatus(s) {
  state.saveStatus = s;
  emit('save', s);
}

export function markDirty(meta = true) {
  const p = state.project;
  if (!p || !canEdit()) return;
  if (meta) p.updatedAt = nowISO();
  dirty = true;
  setStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 650);
}

async function doSave() {
  const p = state.project;
  if (conflictPending) return;
  if (!p || !dirty) { if (!dirty) setStatus('saved'); return; }
  if (saving) { queued = true; return; }
  saving = true;
  dirty = false;
  try {
    await putProject(p);
    if (!dirty) setStatus('saved');
  } catch (e) {
    if (e instanceof ConflictError) {
      saving = false;
      queued = false;
      resolveConflict(p, e.current);
      return;
    }
    if (e.status === 401) {
      dirty = true;
      setStatus('error');
      toast('Your session ended — sign in again to save your changes.', { type: 'error', timeout: 9000 });
      return;
    }
    console.error('[agentmap] save failed', e);
    dirty = true;
    setStatus('error');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(doSave, 4000);
  } finally {
    saving = false;
    if (queued) { queued = false; doSave(); }
  }
}

/* ---------- server sync (remote storage only) ---------- */

let conflictPending = false;

// The same project was edited here and on the server (usually by an AI assistant
// over MCP, or another device). Let the user pick a side.
async function resolveConflict(p, serverCopy) {
  if (conflictPending) return;
  conflictPending = true;
  setStatus('error');
  const useServer = await confirmDialog({
    title: 'Project changed on the server',
    body: `<p>“${esc(p.name)}” was updated outside this window — usually by an AI assistant or another device — while you had unsaved edits here.</p>
           <p><strong>Load server version</strong> replaces your unsaved edits with theirs. <strong>Keep my edits</strong> overwrites their change.</p>`,
    confirmLabel: 'Load server version',
    cancelLabel: 'Keep my edits',
    danger: true,
  });
  conflictPending = false;
  if (useServer && serverCopy) {
    dirty = false;
    adoptServerProject(serverCopy);
    setStatus('saved');
  } else {
    try {
      await putProject(p, { force: true });
      dirty = false;
      setStatus('saved');
    } catch (e) {
      console.error('[agentmap] force save failed', e);
      dirty = true;
      setStatus('error');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(doSave, 4000);
    }
  }
}

export const isDirty = () => dirty || saving || state.saveStatus !== 'saved';

// Swap in a newer copy of a project that arrived from the server.
export function adoptServerProject(fresh) {
  const i = state.projects.findIndex((x) => x.id === fresh.id);
  if (i >= 0) state.projects[i] = fresh;
  else state.projects.push(fresh);
  if (state.project?.id === fresh.id) {
    state.project = fresh;
    if (state.parentId !== 'root' && !getNode(state.parentId, fresh)) state.parentId = 'root';
    state.selection = new Set();
    state.selectedEdge = null;
    emit('project:open', fresh);
    emit('layer', state.parentId);
  }
  emit('projects');
}

// Light polling: pick up projects that AI assistants import or edit via MCP
// while the app is open. Skips the open project whenever local edits are unsaved.
export function startRemoteSync(interval = 4000) {
  let busy = false;
  setInterval(async () => {
    if (busy || document.hidden || storageMode() !== 'remote') return;
    busy = true;
    try {
      const metas = await listProjectMeta();
      const seen = new Set(metas.map((m) => m.id));
      let libChanged = false;
      for (const p of [...state.projects]) {
        if (!seen.has(p.id) && state.project?.id !== p.id) {
          state.projects.splice(state.projects.indexOf(p), 1);
          libChanged = true;
        }
      }
      for (const m of metas) {
        const local = state.projects.find((x) => x.id === m.id);
        if (local && (local.version ?? 0) >= m.version) continue;
        if (state.project?.id === m.id && (isDirty() || conflictPending)) continue;
        const fresh = await fetchProject(m.id);
        if (!fresh) continue;
        if (!local) toast(`“${fresh.name}” appeared from your server.`, { type: 'ok' });
        adoptServerProject(fresh);
        libChanged = true;
      }
      if (libChanged) emit('projects');
    } catch { /* transient network errors — next tick will retry */ }
    finally { busy = false; }
  }, interval);
}

export function flushSaves() {
  if (dirty) { clearTimeout(saveTimer); doSave(); }
}

export async function persistProject(p) {
  // direct write for projects that are not currently open (library operations)
  await putProject(p);
}

/* ---------- project actions ---------- */

export async function installProject(project, { silent = false } = {}) {
  if (!guardEdit()) return null;
  // give the project a fresh id/name if they collide with existing ones
  if (state.projects.some((p) => p.id === project.id)) project.id = uid();
  if (state.projects.some((p) => p.name === project.name)) project.name = `${project.name} (imported)`;
  await putProject(project);
  state.projects.push(project);
  if (!silent) emit('projects');
  return project;
}

export async function createProject({ name, description = '', project = null }) {
  if (!guardEdit()) return null;
  const p = project || blankProject({ name, description });
  await putProject(p);
  state.projects.push(p);
  emit('projects');
  return p;
}

export function openProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return false;
  flushSaves();
  state.project = p;
  state.mode = 'project';
  state.parentId = (p.lastParent && (p.lastParent === 'root' || getNode(p.lastParent, p))) ? p.lastParent : 'root';
  state.selection = new Set();
  state.selectedEdge = null;
  state.filters = new Set();
  emit('project:open', p);
  emit('layer', state.parentId);
  return true;
}

export function closeProject() {
  if (!state.project) return;
  flushSaves();
  state.project = null;
  state.mode = 'library';
  state.selection = new Set();
  state.selectedEdge = null;
  emit('project:close');
  emit('projects');
}

export async function renameProject(id, { name, description }) {
  if (!guardEdit()) return;
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  if (name !== undefined) p.name = name.trim() || p.name;
  if (description !== undefined) p.description = description;
  p.updatedAt = nowISO();
  if (p === state.project) { markDirty(false); emit('project:open', p); emit('layer', state.parentId); }
  else await persistProject(p);
  emit('projects');
}

export async function duplicateProject(id) {
  if (!guardEdit()) return null;
  const src = state.projects.find((x) => x.id === id);
  if (!src) return null;
  const copy = structuredClone(src);
  copy.id = uid();
  copy.name = `${src.name} copy`;
  copy.createdAt = copy.updatedAt = nowISO();
  await putProject(copy);
  state.projects.push(copy);
  emit('projects');
  return copy;
}

export async function deleteProjectWithUndo(id) {
  if (!guardEdit()) return;
  const idx = state.projects.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [removed] = state.projects.splice(idx, 1);
  await deleteProjectRow(id);
  emit('projects');
  toast(`Deleted “${removed.name}”`, {
    type: 'info', timeout: 7000,
    action: { label: 'Undo', fn: async () => { await installProject(removed); } },
  });
}

/* ---------- navigation ---------- */

export function setParent(pid) {
  const p = state.project;
  if (!p) return;
  if (pid !== 'root' && !getNode(pid)) pid = 'root';
  if (state.parentId === pid) return;
  state.parentId = pid;
  p.lastParent = pid;
  state.selection = new Set();
  state.selectedEdge = null;
  markDirty(false);
  emit('layer', pid);
  emit('selection', {});
}

export function goUp() {
  if (state.parentId === 'root') return;
  const n = getNode(state.parentId);
  setParent(n ? n.parentId : 'root');
}

export function setView(pid, view) {
  const p = state.project;
  if (!p) return;
  p.views[pid] = view;
  markDirty(false);
}
export const getView = (pid) => state.project?.views?.[pid] || null;

/* ---------- node & edge actions ---------- */

export function addNode(props = {}) {
  const p = state.project;
  if (!p || !guardEdit()) return null;
  const n = {
    id: uid(),
    parentId: props.parentId || state.parentId,
    type: TYPES[props.type] ? props.type : 'other',
    title: props.title ?? 'Untitled',
    path: props.path ?? '',
    tags: Array.isArray(props.tags) ? props.tags : [],
    summary: props.summary ?? '',
    content: props.content ?? '',
    x: Math.round(props.x ?? 0),
    y: Math.round(props.y ?? 0),
  };
  p.nodes.push(n);
  markDirty();
  emit('graph');
  return n;
}

export function updateNode(id, patch, opts = {}) {
  if (!guardEdit()) return;
  const n = getNode(id);
  if (!n) return;
  Object.assign(n, patch);
  markDirty();
  emit('node', { id, patch, source: opts.source || null });
}

export function deleteNodes(ids, { notify = true } = {}) {
  const p = state.project;
  if (!p || !ids.length || !guardEdit()) return 0;
  const all = new Set();
  for (const id of ids) {
    all.add(id);
    for (const d of descendants(id)) all.add(d);
  }
  const removedNodes = p.nodes.filter((n) => all.has(n.id));
  const removedEdges = p.edges.filter((e) => all.has(e.from) || all.has(e.to));
  p.nodes = p.nodes.filter((n) => !all.has(n.id));
  p.edges = p.edges.filter((e) => !all.has(e.from) && !all.has(e.to));
  for (const id of all) { delete p.views[id]; state.selection.delete(id); }
  pushUndo('Delete', () => {
    const live = state.project;
    if (!live) return;
    const ids2 = new Set(live.nodes.map((n) => n.id));
    for (const n of removedNodes) {
      if (n.parentId !== 'root' && !ids2.has(n.parentId) && !removedNodes.some((r) => r.id === n.parentId)) n.parentId = 'root';
      live.nodes.push(n);
      ids2.add(n.id);
    }
    for (const e of removedEdges) live.edges.push(e);
    markDirty();
    emit('graph');
  });
  markDirty();
  emit('graph');
  emit('selection', {});
  if (notify && removedNodes.length) {
    const inner = removedNodes.length - ids.length;
    toast(`Deleted ${removedNodes.length} component${removedNodes.length === 1 ? '' : 's'}${inner > 0 ? ` (incl. ${inner} inside)` : ''}.`, {
      type: 'info', timeout: 6000,
      action: { label: 'Undo', fn: runUndo },
    });
  }
  return removedNodes.length;
}

export function duplicateNodes(ids) {
  const p = state.project;
  if (!p || !guardEdit()) return [];
  const clones = [];
  for (const id of ids) {
    const src = getNode(id);
    if (!src) continue;
    const map = new Map();
    const cloneTree = (node, parentId, dx, dy) => {
      const c = structuredClone(node);
      c.id = uid();
      c.parentId = parentId;
      c.x = Math.round(node.x + dx);
      c.y = Math.round(node.y + dy);
      map.set(node.id, c.id);
      p.nodes.push(c);
      for (const child of p.nodes.filter((n) => n.parentId === node.id && !map.has(n.id))) {
        cloneTree(child, c.id, 0, 0);
      }
      return c;
    };
    const top = cloneTree(src, src.parentId, 32, 32);
    // copy edges fully inside the duplicated subtree
    for (const e of [...p.edges]) {
      if (map.has(e.from) && map.has(e.to)) {
        p.edges.push({ id: uid(), from: map.get(e.from), to: map.get(e.to) });
      }
    }
    clones.push(top);
  }
  if (clones.length) { markDirty(); emit('graph'); }
  return clones;
}

export function addEdge(from, to) {
  const p = state.project;
  if (!p || from === to || !getNode(from) || !getNode(to) || !guardEdit()) return null;
  if (p.edges.some((e) => e.from === from && e.to === to)) return null;
  const e = { id: uid(), from, to };
  p.edges.push(e);
  markDirty();
  emit('graph');
  return e;
}

export function deleteEdge(id) {
  const p = state.project;
  if (!p || !guardEdit()) return;
  const i = p.edges.findIndex((e) => e.id === id);
  if (i < 0) return;
  p.edges.splice(i, 1);
  if (state.selectedEdge === id) state.selectedEdge = null;
  markDirty();
  emit('graph');
}

/* ---------- selection ---------- */

export function setSelection(ids, opts = {}) {
  state.selection = new Set(ids);
  state.selectedEdge = opts.edge ?? null;
  emit('selection', opts);
}
export const clearSelection = () => setSelection([]);

/* ---------- settings & filters ---------- */

export const snapEnabled = () => state.project?.settings?.snap !== false;
export function toggleSnap() {
  const p = state.project;
  if (!p) return;
  p.settings.snap = !snapEnabled();
  markDirty(false);
  emit('snap', p.settings.snap);
}

export function setFilters(set) {
  state.filters = new Set(set);
  emit('filters', state.filters);
}

/* ---------- single-step undo ---------- */

let undoSlot = null;
export function pushUndo(label, apply) {
  undoSlot = { label, apply };
  emit('undo', label);
}
export function runUndo() {
  if (!undoSlot) return false;
  const u = undoSlot;
  undoSlot = null;
  u.apply();
  emit('undo', null);
  return true;
}
export const undoLabel = () => undoSlot?.label || null;

export const storageModeLive = storageMode;
