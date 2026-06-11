// Unauthenticated probe the web app uses to decide between server storage and
// browser storage. Reports configuration only — never any data.
import { storeInfo } from './_lib/store.js';
import { tokenConfigured, privateMode } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const store = storeInfo();
  const body = {
    ok: true,
    app: 'agentmap',
    remote: store.configured,
    storage: store.configured ? store.kind : null,
    mcp: store.configured && tokenConfigured(),
    private: privateMode(),
  };
  if (!store.configured) {
    body.reason = 'No database configured — set DATABASE_URL (Postgres) or AGENTMAP_DATA_DIR (file storage).';
  }
  res.status(200).json(body);
}
