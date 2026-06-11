// Base UI utilities: escaping, ids, theme, toasts, modals, menus. No dependency on app state.
import { icon } from './icons.js';

/* ---------- small helpers ---------- */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function slugify(s) {
  const out = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return out || 'project';
}

export function debounce(fn, ms, maxWait = 0) {
  let t = null, first = 0;
  const run = (args) => { t = null; first = 0; fn(...args); };
  return (...args) => {
    const now = Date.now();
    if (!first) first = now;
    clearTimeout(t);
    if (maxWait && now - first >= maxWait) { run(args); return; }
    t = setTimeout(() => run(args), ms);
  };
}

export function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 2) return 'yesterday';
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function download(filename, text, mime = 'application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API can be unavailable on http hosts — fall back to a hidden textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ---------- theme ---------- */

const THEME_KEY = 'agentmap.theme';

export function initTheme() {
  let t = null;
  try {
    t = new URLSearchParams(location.search).get('theme') || localStorage.getItem(THEME_KEY);
  } catch { /* storage may be blocked */ }
  if (t !== 'light' && t !== 'dark') t = 'light'; // light-first; dark via the toggle
  setTheme(t, false);
}

export function setTheme(t, persist = true) {
  document.documentElement.dataset.theme = t;
  if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ } }
}

export const getTheme = () => document.documentElement.dataset.theme || 'light';
export const toggleTheme = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark');

export function uiPref(key, value) {
  const k = 'agentmap.ui.' + key;
  if (value === undefined) {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  try { localStorage.setItem(k, String(value)); } catch { /* ignore */ }
}

/* ---------- toasts ---------- */

let toastHost = null;

export function toast(msg, opts = {}) {
  const { type = 'info', timeout = 4200, action = null, html = false } = opts;
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const ic = { info: 'logo', ok: 'check', warn: 'warn', error: 'warn' }[type] || 'logo';
  el.innerHTML = `<span class="toast-ic">${icon(ic)}</span><span class="toast-msg">${html ? msg : esc(msg)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-act';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { dismiss(); action.fn?.(); });
    el.appendChild(btn);
  }
  const xb = document.createElement('button');
  xb.className = 'toast-x';
  xb.innerHTML = icon('x');
  xb.setAttribute('aria-label', 'Dismiss');
  xb.addEventListener('click', () => dismiss());
  el.appendChild(xb);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 260);
  };
  if (timeout > 0) setTimeout(dismiss, timeout);
  return dismiss;
}

/* ---------- modals ---------- */

const modalStack = [];

export function openModal({ title = '', content = '', width = 460, onClose = null, plain = false }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const card = document.createElement('div');
  card.className = 'modal' + (plain ? ' modal-plain' : '');
  card.style.maxWidth = width + 'px';
  card.setAttribute('role', 'dialog');
  if (title) {
    const head = document.createElement('div');
    head.className = 'modal-head';
    head.innerHTML = `<div class="modal-title">${esc(title)}</div>`;
    const xb = document.createElement('button');
    xb.className = 'icon-btn';
    xb.innerHTML = icon('x');
    xb.setAttribute('aria-label', 'Close');
    xb.addEventListener('click', () => close());
    head.appendChild(xb);
    card.appendChild(head);
  }
  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);
  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const entry = { overlay, close };
  modalStack.push(entry);

  function close(result) {
    const i = modalStack.indexOf(entry);
    if (i >= 0) modalStack.splice(i, 1);
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 180);
    onClose?.(result);
  }
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  requestAnimationFrame(() => overlay.classList.add('in'));
  const input = card.querySelector('input, textarea, select');
  if (input) setTimeout(() => input.focus(), 60);
  return { close, body, card };
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}

export const hasOpenModal = () => modalStack.length > 0;

export function confirmDialog({ title, body = '', confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="confirm-body">${body}</div>
      <div class="modal-actions">
        <button class="btn" data-act="cancel">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmLabel)}</button>
      </div>`;
    const m = openModal({ title, content: wrap, width: 420, onClose: () => done(false) });
    wrap.querySelector('[data-act=cancel]').addEventListener('click', () => m.close());
    wrap.querySelector('[data-act=ok]').addEventListener('click', () => { done(true); m.close(); });
    setTimeout(() => wrap.querySelector('[data-act=ok]')?.focus(), 60);
  });
}

export function promptDialog({ title, fields, confirmLabel = 'Save' }) {
  // fields: [{key, label, value, placeholder, textarea}]
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const wrap = document.createElement('form');
    wrap.className = 'prompt-form';
    wrap.innerHTML = fields.map((f) => `
      <label class="field">
        <span class="field-label">${esc(f.label)}</span>
        ${f.textarea
          ? `<textarea class="text-input" data-key="${esc(f.key)}" rows="2" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
          : `<input class="text-input" data-key="${esc(f.key)}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" />`}
      </label>`).join('') + `
      <div class="modal-actions">
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${esc(confirmLabel)}</button>
      </div>`;
    const m = openModal({ title, content: wrap, width: 440, onClose: () => done(null) });
    wrap.querySelector('[data-act=cancel]').addEventListener('click', () => m.close());
    wrap.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      wrap.querySelectorAll('[data-key]').forEach((el) => { out[el.dataset.key] = el.value; });
      done(out);
      m.close();
    });
    const first = wrap.querySelector('input, textarea');
    if (first) setTimeout(() => { first.focus(); first.select?.(); }, 60);
  });
}

/* ---------- popover menus ---------- */

let openMenuEl = null;

export function closeMenus() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
}

export function menu(anchor, items, opts = {}) {
  closeMenus();
  const el = document.createElement('div');
  el.className = 'menu';
  for (const it of items) {
    if (it.hr) {
      el.appendChild(Object.assign(document.createElement('div'), { className: 'menu-hr' }));
      continue;
    }
    const b = document.createElement('button');
    b.className = 'menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
    b.innerHTML = `${it.icon ? `<span class="mi-ic" ${it.color ? `style="color:${it.color}"` : ''}>${icon(it.icon)}</span>` : ''}<span>${esc(it.label)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}`;
    if (!it.disabled) b.addEventListener('click', () => { closeMenus(); it.fn?.(); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let x = opts.align === 'left' ? r.left : r.right - mw;
  let y = r.bottom + 6;
  x = clamp(x, 8, window.innerWidth - mw - 8);
  if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  requestAnimationFrame(() => el.classList.add('in'));
  openMenuEl = el;

  const onDown = (e) => {
    if (!el.contains(e.target)) {
      closeMenus();
      window.removeEventListener('pointerdown', onDown, true);
    }
  };
  window.addEventListener('pointerdown', onDown, true);
  return el;
}

/* ---------- global key handling for overlays ---------- */

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (openMenuEl) { closeMenus(); e.stopPropagation(); return; }
    if (closeTopModal()) e.stopPropagation();
  }
}, true);
