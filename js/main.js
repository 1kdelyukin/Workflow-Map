// Boot: theme, storage/auth handshake, views, hash routing, first-run seeding,
// global error surface.
import { state, on, boot, openProject, closeProject, createProject, flushSaves, startRemoteSync } from './state.js';
import { probeRemote, enableRemote, authMe } from './storage.js';
import { initTheme, toast } from './ui.js';
import { initLibrary } from './library.js';
import { initWorkspace } from './workspace.js';
import { initLanding } from './landing.js';
import { wireDropImport } from './importer.js';
import { sampleProject } from './sample.js';

initTheme();

const app = document.getElementById('app');
app.innerHTML = `
  <main id="view-landing" class="view" hidden></main>
  <main id="view-library" class="view"></main>
  <main id="view-project" class="view" hidden></main>`;
const viewLanding = app.querySelector('#view-landing');
const viewLibrary = app.querySelector('#view-library');
const viewProject = app.querySelector('#view-project');

let landingAvailable = false; // server deployment + nobody signed in

/* ── hash routing ── */
let settingHash = false;
const setHash = (h) => {
  if (location.hash === h) return;
  settingHash = true;
  location.hash = h;
  setTimeout(() => { settingHash = false; }, 0);
};

function showLanding() {
  if (state.project) closeProject();
  viewLibrary.hidden = true;
  viewProject.hidden = true;
  viewLanding.hidden = false;
  setHash('#welcome');
  document.title = 'AgentMap';
}

function showLibrary() {
  viewLanding.hidden = true;
  viewProject.hidden = true;
  viewLibrary.hidden = false;
  document.title = 'AgentMap';
}

function route() {
  if (settingHash) return;
  const m = location.hash.match(/^#p\/([\w-]+)/);
  if (m) {
    viewLanding.hidden = true;
    if (state.project?.id === m[1]) return;
    if (!openProject(m[1])) {
      toast('That project no longer exists here.', { type: 'warn' });
      setHash('#library');
      if (state.project) closeProject();
      else showLibrary();
    }
    return;
  }
  if (landingAvailable && (location.hash === '' || location.hash === '#welcome')) {
    showLanding();
    return;
  }
  if (state.project) closeProject();
  else showLibrary();
}
window.addEventListener('hashchange', route);

on('project:open', (p) => {
  viewLanding.hidden = true;
  viewLibrary.hidden = true;
  viewProject.hidden = false;
  setHash(`#p/${p.id}`);
  document.title = `${p.name} — AgentMap`;
});
on('project:close', () => {
  viewProject.hidden = true;
  showLibrary();
  setHash('#library');
});

/* ── persistence safety nets ── */
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });
window.addEventListener('pagehide', flushSaves);
window.addEventListener('beforeunload', flushSaves);

/* ── error surface (throttled) ── */
let lastErrToast = 0;
const surface = (msg) => {
  const now = Date.now();
  if (now - lastErrToast < 5000) return;
  lastErrToast = now;
  toast(`Something went wrong: ${msg}`, { type: 'error', timeout: 7000 });
};
window.addEventListener('error', (e) => surface(e.message || 'unknown error'));
window.addEventListener('unhandledrejection', (e) => surface(e.reason?.message || String(e.reason || 'unknown error')));

/* ── boot ── */
(async () => {
  // Server handshake: when this deployment has a database, the session cookie
  // (HttpOnly, invisible here) decides between edit and view-only mode.
  const remote = await probeRemote();
  if (remote) {
    state.remoteAvailable = true;
    enableRemote();
    try {
      const me = await authMe();
      state.auth = { registered: !!me.registered, email: me.email || null };
      state.canEdit = !!me.authenticated;
    } catch {
      state.canEdit = false;
    }
    landingAvailable = !state.canEdit;
  }
  document.body.classList.toggle('view-only', remote && !state.canEdit);

  await boot();

  initWorkspace(viewProject);
  initLibrary(viewLibrary);
  if (landingAvailable) initLanding(viewLanding);
  wireDropImport();

  if (remote) {
    startRemoteSync();
  } else if (state.storage === 'local') {
    toast('IndexedDB is unavailable — using basic browser storage. Back up regularly.', { type: 'warn', timeout: 9000 });
  }

  if (state.firstRun && state.canEdit) {
    await createProject({ project: sampleProject() });
    toast(remote
      ? 'Added a sample project so you can explore — it syncs to your server.'
      : 'Added a sample project so you can explore. Your data stays in this browser.', { type: 'info', timeout: 7000 });
  }

  route();
})();
