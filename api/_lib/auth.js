// Bearer-token auth for every API route. The token is a single shared secret in
// AGENTMAP_TOKEN — accepted as "Authorization: Bearer <token>" or "?token=<token>"
// (for MCP clients that cannot set custom headers).
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();

export function tokenConfigured() {
  return Boolean(process.env.AGENTMAP_TOKEN);
}

function givenToken(req) {
  const header = req.headers?.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (m) return m[1].trim();
  if (req.query?.token) return String(req.query.token);
  try {
    return new URL(req.url || '', 'http://local').searchParams.get('token') || '';
  } catch {
    return '';
  }
}

export function authError(req) {
  if (!tokenConfigured()) {
    return { status: 503, message: 'Server not configured: set the AGENTMAP_TOKEN environment variable.' };
  }
  const given = givenToken(req);
  if (!given || !timingSafeEqual(digest(given), digest(process.env.AGENTMAP_TOKEN))) {
    return { status: 401, message: 'Invalid or missing access token.' };
  }
  return null;
}

export function requireAuth(req, res) {
  const err = authError(req);
  if (!err) return true;
  if (err.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="agentmap"');
  res.status(err.status).json({ error: err.message });
  return false;
}

/* ── write authorization: bearer token (AI assistants) OR owner session ── */

import { sessionEmail } from './session.js';

export async function canWrite(req, store) {
  if (tokenConfigured() && !authError(req)) return { ok: true, via: 'token' };
  const email = await sessionEmail(req, store);
  if (!email) return { ok: false };
  // cookie-authenticated mutation: if the browser sent an Origin/Referer,
  // it must match this host (belt-and-braces on top of SameSite=Lax)
  const source = req.headers.origin || req.headers.referer;
  if (source) {
    try {
      const srcHost = new URL(source).host;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (srcHost !== host) return { ok: false };
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, via: 'session', email };
}

export async function requireWrite(req, res, store) {
  const result = await canWrite(req, store);
  if (result.ok) return true;
  res.status(401).json({ error: 'Sign in (or use the API token) to make changes.' });
  return false;
}

/* ── read authorization: public by default; AGENTMAP_PRIVATE=1 locks reads
      to the owner session / bearer token as well ── */

export const privateMode = () => /^(1|true|yes)$/i.test(process.env.AGENTMAP_PRIVATE || '');

export async function requireRead(req, res, store) {
  if (!privateMode()) return true;
  const result = await canWrite(req, store); // same credentials grant reads
  if (result.ok) return true;
  res.status(401).json({ error: 'This workspace is private — sign in to view it.' });
  return false;
}
