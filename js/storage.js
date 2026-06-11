// Persistence layer with three backends, picked at boot:
//   remote — the AgentMap server's REST API (when the app is deployed with one);
//            projects sync across devices and AI assistants see them via MCP
//   idb    — IndexedDB (default for static hosting)
//   local  — localStorage fallback (e.g. some private-browsing modes)
// All functions are async and operate on whole project objects keyed by project.id.

const DB_NAME = 'agentmap';
const STORE = 'projects';
const LS_KEY = 'agentmap.projects';

let mode = 'idb';
let dbPromise = null;

/* ════════════════════════ remote (REST API) ════════════════════════ */

// Thrown by putProject when someone else (an AI assistant, another device)
// wrote the project after we last read it.
export class ConflictError extends Error {
  constructor(current) {
    super('Project changed on the server.');
    this.current = current;
  }
}

// Auth is an HttpOnly session cookie — sent automatically on same-origin
// requests, never visible to this code.
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 409) throw new ConflictError((await res.json()).current);
  if (!res.ok) {
    let message = `Server responded ${res.status}`;
    try { message = (await res.json()).error || message; } catch { /* keep default */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function probeRemote() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok === true && j.remote === true ? { private: j.private === true } : null;
  } catch {
    return null;
  }
}

export function enableRemote() {
  mode = 'remote';
}

export const listProjectMeta = () => api('api/projects?meta=1');
export const fetchProject = (id) => api(`api/projects/${encodeURIComponent(id)}`);

/* ── owner auth ── */

export const authMe = () => api('api/auth/me');
export const authLogin = (email, password) => api('api/auth/login', { method: 'POST', body: { email, password } });
export const authRegister = (email, password) => api('api/auth/register', { method: 'POST', body: { email, password } });
export const authLogout = () => api('api/auth/logout', { method: 'POST' });

/* ════════════════════════ IndexedDB ════════════════════════ */

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }
  return dbPromise;
}

function tx(db, mode_, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode_);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  });
}

/* localStorage fallback */
function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function lsWrite(map) {
  localStorage.setItem(LS_KEY, JSON.stringify(map));
}

/* ════════════════════════ shared interface ════════════════════════ */

export async function initStorage() {
  if (mode === 'remote') return mode; // enabled before boot via enableRemote()
  try {
    if (!globalThis.indexedDB) throw new Error('no indexedDB');
    const db = await openDB();
    // probe a readonly transaction so failures surface now rather than on first save
    await tx(db, 'readonly', (s) => s.count());
    mode = 'idb';
  } catch {
    mode = 'local';
  }
  return mode;
}

export const storageMode = () => mode;

export async function getAllProjects() {
  if (mode === 'remote') return api('api/projects');
  if (mode === 'idb') {
    const db = await openDB();
    const rows = await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return rows;
  }
  return Object.values(lsRead());
}

export async function putProject(project, { force = false } = {}) {
  if (mode === 'remote') {
    const headers = {};
    if (!force && Number.isFinite(project.version)) headers['X-AgentMap-Version'] = String(project.version);
    const saved = await api(`api/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body: project, headers });
    project.version = saved.version;
    return;
  }
  if (mode === 'idb') {
    const db = await openDB();
    await tx(db, 'readwrite', (s) => s.put(project));
    return;
  }
  const map = lsRead();
  map[project.id] = project;
  lsWrite(map);
}

export async function deleteProjectRow(id) {
  if (mode === 'remote') {
    await api(`api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return;
  }
  if (mode === 'idb') {
    const db = await openDB();
    await tx(db, 'readwrite', (s) => s.delete(id));
    return;
  }
  const map = lsRead();
  delete map[id];
  lsWrite(map);
}
