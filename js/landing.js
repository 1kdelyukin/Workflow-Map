// Landing & sign-in view, shown on server deployments when nobody is signed in.
// Single-owner model: the first sign-in registers the owner's password; after
// that the same card is a plain sign-in. Guests can browse everything read-only.
import { state } from './state.js';
import { authLogin, authRegister } from './storage.js';
import { icon } from './icons.js';

export function initLanding(viewEl) {
  const registered = state.auth.registered;
  viewEl.innerHTML = `
    <div class="landing">
      <div class="land-orbs" aria-hidden="true"><span></span><span></span><span></span></div>
      <header class="land-head">
        <div class="lib-brand">${icon('logo', 'brand-ic')}<span class="brand-name">AgentMap</span></div>
        <div class="flex-1"></div>
        <button class="btn" data-act="guest-top">${icon('eye')}<span>Browse as guest</span></button>
      </header>
      <main class="land-main">
        <section class="land-copy">
          <h1>Map the systems<br/>your agents run on.</h1>
          <p class="land-sub">AgentMap turns AI-agent workflows — phases, agents, skills, hooks, code, and docs — into layered, navigable maps. Made for humans to explore, and for AI assistants to read and edit live over MCP.</p>
          <div class="land-points">
            <div class="land-point">
              <span class="land-pt-ic">${icon('stack')}</span>
              <div><b>Layered maps</b><span>Drill into any component — every subsystem opens as its own canvas.</span></div>
            </div>
            <div class="land-point">
              <span class="land-pt-ic">${icon('spark')}</span>
              <div><b>Live AI access</b><span>Assistants import, query, and edit over MCP — changes appear here instantly.</span></div>
            </div>
            <div class="land-point">
              <span class="land-pt-ic">${icon('download')}</span>
              <div><b>Lossless portability</b><span>Exact round-trip JSON plus self-describing AI handoff documents.</span></div>
            </div>
          </div>
        </section>
        <section class="land-card">
          <h2>${registered ? 'Welcome back' : 'Set up your account'}</h2>
          <p class="land-card-sub">${registered
            ? 'Sign in to edit your maps. Guests can view everything.'
            : 'First sign-in: confirm your email and choose a password. This deployment registers exactly one owner.'}</p>
          <form class="land-form" novalidate>
            <label class="field">
              <span class="field-label">Email</span>
              <input class="text-input" type="email" name="email" autocomplete="email" placeholder="you@example.com" required />
            </label>
            <label class="field">
              <span class="field-label">Password</span>
              <input class="text-input" type="password" name="password" autocomplete="${registered ? 'current-password' : 'new-password'}" placeholder="${registered ? '••••••••' : 'at least 8 characters'}" minlength="8" required />
            </label>
            <div class="land-error" role="alert" hidden></div>
            <button class="btn btn-primary land-submit" type="submit">${registered ? 'Sign in' : 'Create password & sign in'}</button>
          </form>
          <button class="land-guest" data-act="guest">Just looking? <b>Browse as guest →</b></button>
        </section>
      </main>
      <footer class="land-foot">Single-owner deployment · guests are view-only · AI assistants connect via <code>/api/mcp</code></footer>
    </div>`;

  const form = viewEl.querySelector('.land-form');
  const errEl = viewEl.querySelector('.land-error');
  const submit = viewEl.querySelector('.land-submit');
  const submitLabel = submit.textContent;

  const browseAsGuest = () => { location.hash = '#library'; };
  viewEl.querySelector('[data-act=guest]').addEventListener('click', browseAsGuest);
  viewEl.querySelector('[data-act=guest-top]').addEventListener('click', browseAsGuest);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { errEl.textContent = 'Enter your email and password.'; errEl.hidden = false; return; }
    submit.disabled = true;
    submit.textContent = 'One moment…';
    try {
      if (registered) await authLogin(email, password);
      else await authRegister(email, password);
      location.hash = '#library';
      location.reload(); // boot fresh with the session cookie in place
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong — try again.';
      errEl.hidden = false;
      submit.disabled = false;
      submit.textContent = submitLabel;
      form.password.focus();
    }
  });
}
