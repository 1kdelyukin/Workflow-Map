// Owner authentication: /api/auth/register | login | logout | me
//
// - register: allowed exactly once, and only for the owner email
//   (AGENTMAP_OWNER_EMAIL). The first registration sets the password.
// - login:    verifies scrypt hash, issues an HttpOnly session cookie.
// - me:       public probe: { registered, authenticated, email? }.
// Failed attempts share a generic message, a small delay, and a best-effort
// per-IP rate limit to blunt guessing.
import { getStore } from '../_lib/store.js';
import * as S from '../_lib/session.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const attempts = new Map(); // ip -> {count, since} (per warm instance, best-effort)
function rateLimited(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.since > 10 * 60 * 1000) {
    attempts.set(ip, { count: 1, since: now });
    return false;
  }
  a.count++;
  return a.count > 20;
}
const ipOf = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const store = await getStore();
  if (!store) { res.status(503).json({ error: 'No database configured.' }); return; }
  const action = req.query?.action;

  if (action === 'me') {
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const account = await S.getAccount(store);
    const email = await S.sessionEmail(req, store);
    res.status(200).json({ registered: !!account, authenticated: !!email, ...(email ? { email } : {}) });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', S.clearCookie(S.isSecure(req)));
    res.status(200).json({ ok: true });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (action === 'register') {
    if (rateLimited(ipOf(req))) { res.status(429).json({ error: 'Too many attempts — try again later.' }); return; }
    if (await S.getAccount(store)) { res.status(409).json({ error: 'Registration is closed.' }); return; }
    if (email !== S.ownerEmail()) {
      await sleep(400);
      res.status(403).json({ error: 'This deployment is private — that email cannot register.' });
      return;
    }
    if (password.length < 8) { res.status(400).json({ error: 'Password must be at least 8 characters.' }); return; }
    await S.createAccount(store, password);
    const token = S.signSession(await S.getSecret(store), S.ownerEmail());
    res.setHeader('Set-Cookie', S.setCookie(token, S.isSecure(req)));
    res.status(200).json({ ok: true, email: S.ownerEmail() });
    return;
  }

  if (action === 'login') {
    if (rateLimited(ipOf(req))) { res.status(429).json({ error: 'Too many attempts — try again later.' }); return; }
    await sleep(300 + Math.random() * 250);
    const account = await S.getAccount(store);
    if (!account || email !== account.email || !S.verifyPassword(account, password)) {
      res.status(401).json({ error: 'Wrong email or password.' });
      return;
    }
    const token = S.signSession(await S.getSecret(store), account.email);
    res.setHeader('Set-Cookie', S.setCookie(token, S.isSecure(req)));
    res.status(200).json({ ok: true, email: account.email });
    return;
  }

  res.status(404).json({ error: 'Unknown auth action.' });
}
