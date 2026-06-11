// Project storage backends for the API. Rows have the shape
//   { id, name, data, version, updatedAt }
// where `data` is the full project object and `version` increments on every write.
// put() with expectedVersion performs an optimistic-concurrency check and throws
// { code: 'conflict', current } when someone else wrote in between.
//
// Backends:
//   - postgres: DATABASE_URL / POSTGRES_URL (Neon serverless driver, loaded lazily)
//   - file:     AGENTMAP_DATA_DIR (one JSON file per project — local dev & self-hosting)

export function storeInfo() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return { configured: true, kind: 'postgres' };
  if (process.env.AGENTMAP_DATA_DIR) return { configured: true, kind: 'file' };
  return { configured: false, kind: null };
}

let cached = null;

export async function getStore() {
  if (cached) return cached;
  const info = storeInfo();
  if (!info.configured) return null;
  cached = info.kind === 'postgres' ? await pgStore() : await fileStore();
  return cached;
}

export function conflict(current) {
  const err = new Error('Version conflict: the project changed since it was read.');
  err.code = 'conflict';
  err.current = current;
  return err;
}

/* ════════════════════════ postgres (Neon) ════════════════════════ */

async function pgStore() {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  await sql`CREATE TABLE IF NOT EXISTS agentmap_projects (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    data jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS agentmap_kv (
    k text PRIMARY KEY,
    v jsonb NOT NULL
  )`;

  const out = (r) => ({
    id: r.id,
    name: r.name,
    data: r.data,
    version: r.version,
    updatedAt: new Date(r.updated_at).toISOString(),
  });

  return {
    kind: 'postgres',

    async list() {
      const rows = await sql`SELECT id, name, data, version, updated_at FROM agentmap_projects ORDER BY updated_at DESC`;
      return rows.map(out);
    },

    async listMeta() {
      const rows = await sql`SELECT id, name, version, updated_at FROM agentmap_projects ORDER BY updated_at DESC`;
      return rows.map((r) => ({ id: r.id, name: r.name, version: r.version, updatedAt: new Date(r.updated_at).toISOString() }));
    },

    async get(id) {
      const rows = await sql`SELECT id, name, data, version, updated_at FROM agentmap_projects WHERE id = ${id}`;
      return rows.length ? out(rows[0]) : null;
    },

    async put(id, project, { expectedVersion = null } = {}) {
      const name = project.name || '';
      const json = JSON.stringify(project);
      if (expectedVersion == null) {
        const rows = await sql`
          INSERT INTO agentmap_projects (id, name, data) VALUES (${id}, ${name}, ${json}::jsonb)
          ON CONFLICT (id) DO UPDATE
            SET name = ${name}, data = ${json}::jsonb,
                version = agentmap_projects.version + 1, updated_at = now()
          RETURNING version, updated_at`;
        return { version: rows[0].version, updatedAt: new Date(rows[0].updated_at).toISOString() };
      }
      const rows = await sql`
        UPDATE agentmap_projects
          SET name = ${name}, data = ${json}::jsonb, version = version + 1, updated_at = now()
          WHERE id = ${id} AND version = ${expectedVersion}
        RETURNING version, updated_at`;
      if (rows.length) return { version: rows[0].version, updatedAt: new Date(rows[0].updated_at).toISOString() };
      const current = await this.get(id);
      if (!current) return this.put(id, project); // deleted meanwhile — recreate
      throw conflict(current);
    },

    async del(id) {
      const rows = await sql`DELETE FROM agentmap_projects WHERE id = ${id} RETURNING id`;
      return rows.length > 0;
    },

    async kvGet(k) {
      const rows = await sql`SELECT v FROM agentmap_kv WHERE k = ${k}`;
      return rows.length ? rows[0].v : null;
    },

    async kvSet(k, v) {
      const json = JSON.stringify(v);
      await sql`INSERT INTO agentmap_kv (k, v) VALUES (${k}, ${json}::jsonb)
        ON CONFLICT (k) DO UPDATE SET v = ${json}::jsonb`;
    },
  };
}

/* ════════════════════════ file (dev & self-host) ════════════════════════ */

async function fileStore() {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = process.env.AGENTMAP_DATA_DIR;
  await fs.mkdir(dir, { recursive: true });

  const fileOf = (id) => path.join(dir, encodeURIComponent(id) + '.json');

  async function readRow(file) {
    try {
      const row = JSON.parse(await fs.readFile(file, 'utf8'));
      return row && row.id && row.data ? row : null;
    } catch {
      return null;
    }
  }

  async function writeRow(row) {
    const file = fileOf(row.id);
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(row, null, 2));
    await fs.rename(tmp, file);
  }

  async function allRows() {
    // underscore-prefixed files hold server metadata (auth, secrets), not projects
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('_'));
    const rows = [];
    for (const n of names) {
      const row = await readRow(path.join(dir, n));
      if (row) rows.push(row);
    }
    rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return rows;
  }

  return {
    kind: 'file',

    async list() {
      return allRows();
    },

    async listMeta() {
      return (await allRows()).map((r) => ({ id: r.id, name: r.name, version: r.version, updatedAt: r.updatedAt }));
    },

    async get(id) {
      return readRow(fileOf(id));
    },

    async put(id, project, { expectedVersion = null } = {}) {
      const existing = await this.get(id);
      if (expectedVersion != null && existing && existing.version !== expectedVersion) {
        throw conflict(existing);
      }
      const row = {
        id,
        name: project.name || '',
        data: project,
        version: (existing?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      await writeRow(row);
      return { version: row.version, updatedAt: row.updatedAt };
    },

    async del(id) {
      try {
        await fs.unlink(fileOf(id));
        return true;
      } catch {
        return false;
      }
    },

    async kvGet(k) {
      try {
        const map = JSON.parse(await fs.readFile(path.join(dir, '_meta.json'), 'utf8'));
        return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
      } catch {
        return null;
      }
    },

    async kvSet(k, v) {
      let map = {};
      try { map = JSON.parse(await fs.readFile(path.join(dir, '_meta.json'), 'utf8')); } catch { /* first write */ }
      map[k] = v;
      const file = path.join(dir, '_meta.json');
      await fs.writeFile(file + '.tmp', JSON.stringify(map, null, 2));
      await fs.rename(file + '.tmp', file);
    },
  };
}
