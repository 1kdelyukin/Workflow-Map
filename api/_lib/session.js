// Owner account + sessions.
//
// Single-owner model: exactly one account may ever exist, and only for the
// email in AGENTMAP_OWNER_EMAIL. The first successful registration sets the
// password (scrypt, per-account salt); after that registration is closed.
//
// Sessions are stateless signed tokens — HMAC-SHA256 over a payload with an
// expiry, keyed by a random secret that is generated once and persisted in the
// store (so it survives serverless cold starts). Delivered as an HttpOnly,
// SameSite=Lax cookie; never readable by page JavaScript.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'agentmap_session';
const SESSION_DAYS = 30;

export const ownerEmail = () =>
  (process.env.AGENTMAP_OWNER_EMAIL || '1kdelyukin@gmail.com').trim().toLowerCase();

/* ── account ── */

export const getAccount = (store) => store.kvGet('owner-account');

export async function createAccount(store, password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  const account = { email: ownerEmail(), salt, hash, createdAt: new Date().toISOString() };
  await store.kvSet('owner-account', account);
  return account;
}

export function verifyPassword(account, password) {
  try {
    const test = scryptSync(String(password), account.salt, 64);
    const real = Buffer.from(account.hash, 'hex');
    return test.length === real.length && timingSafeEqual(test, real);
  } catch {
    return false;
  }
}

/* ── signing secret (generated once, persisted) ── */

export async function getSecret(store) {
  let row = await store.kvGet('session-secret');
  if (!row?.key) {
    row = { key: randomBytes(32).toString('hex') };
    await store.kvSet('session-secret', row);
  }
  return row.key;
}

/* ── tokens ── */

export function signSession(secret, email) {
  const payload = Buffer.from(JSON.stringify({
    e: email,
    x: Date.now() + SESSION_DAYS * 86400000,
    n: randomBytes(8).toString('hex'),
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data?.e || !(data.x > Date.now())) return null;
    return data.e;
  } catch {
    return null;
  }
}

/* ── HTTP plumbing ── */

export function sessionTokenFromReq(req) {
  const cookies = req.headers?.cookie || '';
  for (const part of cookies.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE) return rest.join('=');
  }
  return null;
}

export async function sessionEmail(req, store) {
  const token = sessionTokenFromReq(req);
  if (!token) return null;
  return verifySessionToken(await getSecret(store), token);
}

export const isSecure = (req) => (req.headers?.['x-forwarded-proto'] || '') === 'https';

export const setCookie = (token, secure) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;

export const clearCookie = (secure) =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
