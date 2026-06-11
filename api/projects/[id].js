// GET    /api/projects/:id → project (public, view-only access)
// PUT    /api/projects/:id → owner session or API token. Optional X-AgentMap-Version
//                            header enables optimistic concurrency: stale → 409 + current copy.
// DELETE /api/projects/:id → owner session or API token.
import { requireWrite } from '../_lib/auth.js';
import { getStore } from '../_lib/store.js';
import { normalizeProject } from '../_lib/core.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const store = await getStore();
  if (!store) { res.status(503).json({ error: 'No database configured.' }); return; }
  const id = req.query?.id;
  if (!id) { res.status(400).json({ error: 'Missing project id.' }); return; }

  if (req.method === 'GET') {
    const row = await store.get(id);
    if (!row) { res.status(404).json({ error: `No project with id "${id}".` }); return; }
    res.status(200).json({ ...row.data, version: row.version });
    return;
  }

  if (!(await requireWrite(req, res, store))) return;

  if (req.method === 'DELETE') {
    res.status(200).json({ deleted: await store.del(id) });
    return;
  }

  if (req.method === 'PUT') {
    let raw = req.body;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
    if (!raw || typeof raw !== 'object') { res.status(400).json({ error: 'Body must be a project JSON object.' }); return; }
    if (raw.id && raw.id !== id) { res.status(400).json({ error: 'Body project id does not match the URL.' }); return; }

    let project, warnings;
    try {
      const r = normalizeProject({ ...raw, id });
      project = r.project;
      warnings = r.warnings;
    } catch (e) {
      res.status(400).json({ error: `Invalid project: ${e.message}` });
      return;
    }

    const headerVersion = parseInt(req.headers['x-agentmap-version'], 10);
    const expectedVersion = Number.isFinite(headerVersion) ? headerVersion : null;
    try {
      const saved = await store.put(id, project, { expectedVersion });
      res.status(200).json({ version: saved.version, updatedAt: saved.updatedAt, warnings });
    } catch (e) {
      if (e.code === 'conflict') {
        res.status(409).json({ error: 'conflict', current: { ...e.current.data, version: e.current.version } });
        return;
      }
      throw e;
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
