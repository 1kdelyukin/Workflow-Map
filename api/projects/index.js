// GET /api/projects        → full project objects (each with its server `version`)
// GET /api/projects?meta=1 → [{id, name, version, updatedAt}] — cheap sync polling
// Reads are public (view-only access) unless AGENTMAP_PRIVATE is set;
// all writes live on /api/projects/:id.
import { getStore } from '../_lib/store.js';
import { requireRead } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  const store = await getStore();
  if (!store) { res.status(503).json({ error: 'No database configured.' }); return; }
  if (!(await requireRead(req, res, store))) return;

  if (req.query?.meta) {
    res.status(200).json(await store.listMeta());
    return;
  }
  const rows = await store.list();
  res.status(200).json(rows.map((r) => ({ ...r.data, version: r.version })));
}
