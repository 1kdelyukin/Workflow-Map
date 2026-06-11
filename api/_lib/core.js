// Shared model operations for the API: tree/overview/search projections and
// validated graph mutations. Everything here is pure project-object-in,
// result-out — storage and HTTP live elsewhere. Reuses the same modules the
// browser app runs, so the format can't drift between client and server.
import './shim.js';
import {
  normalizeProject, parseImportText, buildHandoff, exportProjectFile,
} from '../../js/transfer.js';
import { TYPES, TYPE_ORDER, VERSION, projectStats, blankProject } from '../../js/state.js';
import { computeLayout } from '../../js/layout.js';
import { uid } from '../../js/ui.js';

export const APP_VERSION = VERSION;
export { TYPE_ORDER, blankProject };

/* A ToolError is a user-correctable mistake (bad id, invalid type, …) — callers
   report its message verbatim instead of treating it as a server fault. */
export class ToolError extends Error {}

const now = () => new Date().toISOString();
const CARD = { w: 216, h: 88 };

const nodeById = (p, id) => p.nodes.find((n) => n.id === id) || null;
const childrenOf = (p, pid) =>
  p.nodes.filter((n) => n.parentId === pid).sort((a, b) => (a.x - b.x) || (a.y - b.y));

function requireNode(p, id, what = 'component') {
  const n = nodeById(p, id);
  if (!n) throw new ToolError(`No ${what} with id "${id}" in this project. Use get_tree or search to find valid ids.`);
  return n;
}

function descendantIds(p, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of p.nodes) if (n.parentId === cur) { out.push(n.id); stack.push(n.id); }
  }
  return out;
}

export function breadcrumbOf(p, id) {
  const parts = [];
  let cur = nodeById(p, id);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(cur.title || 'Untitled');
    cur = nodeById(p, cur.parentId);
  }
  return parts.join(' ▸ ');
}

export function statsOf(p) {
  const s = projectStats(p);
  return { components: s.nodes, connections: s.edges, depth: s.depth, by_type: s.byType };
}

export function projectSummary(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    updated_at: p.updatedAt,
    ...statsOf(p),
  };
}

/* ════════════════════════ read projections ════════════════════════ */

export function overviewText(p) {
  return buildHandoff(p, 'overview').text;
}

// Compact structure: full hierarchy + summaries + connections, no content.
// This is the "manifest" shape — small enough to read whole even for big maps.
export function treeOf(p, { rootId = 'root', depth = 0 } = {}) {
  if (rootId !== 'root') requireNode(p, rootId, 'layer');

  const inScope = new Set();
  const build = (pid, level) => childrenOf(p, pid).map((n) => {
    inScope.add(n.id);
    const kids = childrenOf(p, n.id);
    const entry = { id: n.id, type: n.type, title: n.title };
    if (n.path) entry.path = n.path;
    if (n.tags?.length) entry.tags = n.tags;
    if (n.summary) entry.summary = n.summary;
    if (n.content) entry.content_chars = n.content.length;
    if (kids.length) {
      if (!depth || level < depth) entry.components = build(n.id, level + 1);
      else entry.components_omitted = descendantIds(p, n.id).length;
    }
    return entry;
  });

  const components = build(rootId, 1);
  const titleOf = (id) => nodeById(p, id)?.title || id;
  const connections = p.edges
    .filter((e) => inScope.has(e.from) && inScope.has(e.to))
    .map((e) => {
      const layer = nodeById(p, e.from).parentId;
      return {
        from: e.from, from_title: titleOf(e.from),
        to: e.to, to_title: titleOf(e.to),
        layer: layer === 'root' ? 'root' : layer,
      };
    });

  return {
    project: { id: p.id, name: p.name, description: p.description || '', updated_at: p.updatedAt },
    stats: statsOf(p),
    root: rootId,
    note: 'Nesting under "components" is containment. "connections" are directed A → B links, always between siblings of one layer.',
    components,
    connections,
  };
}

export function componentOf(p, id, includeContent = true) {
  const n = requireNode(p, id);
  const kids = childrenOf(p, n.id);
  const incoming = p.edges.filter((e) => e.to === n.id).map((e) => ({ id: e.from, title: nodeById(p, e.from)?.title }));
  const outgoing = p.edges.filter((e) => e.from === n.id).map((e) => ({ id: e.to, title: nodeById(p, e.to)?.title }));
  const out = {
    id: n.id,
    type: n.type,
    title: n.title,
    breadcrumb: breadcrumbOf(p, n.id),
    parent_id: n.parentId,
    path: n.path || '',
    tags: n.tags || [],
    summary: n.summary || '',
    children: kids.map((k) => ({ id: k.id, title: k.title, type: k.type })),
    connections: { in: incoming, out: outgoing },
  };
  if (includeContent) out.content = n.content || '';
  else out.content_chars = (n.content || '').length;
  return out;
}

export function searchProject(p, query, types = null) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) throw new ToolError('search needs a non-empty query.');
  const typeSet = types?.length ? new Set(types) : null;
  const results = [];
  for (const n of p.nodes) {
    if (typeSet && !typeSet.has(n.type)) continue;
    const matches = [];
    if ((n.title || '').toLowerCase().includes(q)) matches.push('title');
    if ((n.path || '').toLowerCase().includes(q)) matches.push('path');
    if ((n.tags || []).some((t) => t.toLowerCase().includes(q))) matches.push('tags');
    if ((n.summary || '').toLowerCase().includes(q)) matches.push('summary');
    let snippet;
    const ci = (n.content || '').toLowerCase().indexOf(q);
    if (ci >= 0) {
      matches.push('content');
      const start = Math.max(0, ci - 60);
      snippet = (start > 0 ? '…' : '') + n.content.slice(start, ci + q.length + 100).replace(/\s+/g, ' ') + '…';
    }
    if (matches.length) {
      const r = { id: n.id, title: n.title, type: n.type, breadcrumb: breadcrumbOf(p, n.id), matched: matches };
      if (snippet) r.snippet = snippet;
      results.push(r);
    }
  }
  return results.slice(0, 50);
}

/* ════════════════════════ placement helpers ════════════════════════ */

function layerEdgesOf(p, pid) {
  const inLayer = new Set(p.nodes.filter((n) => n.parentId === pid).map((n) => n.id));
  return p.edges.filter((e) => inLayer.has(e.from) && inLayer.has(e.to));
}

function applyLayout(p, pid) {
  const nodes = p.nodes.filter((n) => n.parentId === pid);
  if (!nodes.length) return 0;
  const sizes = new Map(nodes.map((n) => [n.id, CARD]));
  const placed = computeLayout(nodes, layerEdgesOf(p, pid), sizes);
  let moved = 0;
  for (const n of nodes) {
    const t = placed.get(n.id);
    if (t && (n.x !== t.x || n.y !== t.y)) { n.x = t.x; n.y = t.y; moved++; }
  }
  return moved;
}

// Place freshly added nodes that came without coordinates: if the whole layer is
// new, lay it out as a flow; otherwise grid them below the existing cards.
function placeNewNodes(p, pid, newIds) {
  const layer = p.nodes.filter((n) => n.parentId === pid);
  const unplaced = layer.filter((n) => newIds.has(n.id) && !(Number.isFinite(n.x) && Number.isFinite(n.y)));
  if (!unplaced.length) return;
  const settled = layer.filter((n) => !newIds.has(n.id));
  if (!settled.length) {
    for (const n of unplaced) { n.x = 0; n.y = 0; }
    applyLayout(p, pid);
    return;
  }
  const left = Math.min(...settled.map((n) => n.x));
  let y = Math.max(...settled.map((n) => n.y)) + CARD.h + 72;
  let col = 0;
  for (const n of unplaced) {
    n.x = left + col * (CARD.w + 36);
    n.y = y;
    if (++col >= 4) { col = 0; y += CARD.h + 56; }
  }
}

export function arrangeLayers(p, layerId = 'root', recursive = false) {
  if (layerId !== 'root') requireNode(p, layerId, 'layer');
  const layers = [layerId];
  if (recursive) {
    const sub = layerId === 'root' ? p.nodes : p.nodes.filter((n) => descendantIds(p, layerId).includes(n.id));
    for (const n of sub) if (p.nodes.some((m) => m.parentId === n.id)) layers.push(n.id);
  }
  let moved = 0;
  for (const pid of layers) moved += applyLayout(p, pid);
  return { layers_arranged: layers.length, components_moved: moved };
}

/* ════════════════════════ mutations ════════════════════════ */

const str = (v, fb = '') => (typeof v === 'string' ? v : fb);
const cleanTags = (v) => (Array.isArray(v) ? v.map((t) => String(t)).filter(Boolean).slice(0, 24) : []);

export function addComponents(p, comps, conns = []) {
  if (!Array.isArray(comps) || !comps.length) throw new ToolError('add_components needs a non-empty `components` array.');
  const warnings = [];
  const ids = new Set(p.nodes.map((n) => n.id));
  const newNodes = [];

  for (const c of comps) {
    if (!c || typeof c !== 'object') { warnings.push('Skipped a malformed component entry.'); continue; }
    let id = str(c.id);
    if (!id) id = uid();
    else if (ids.has(id)) { warnings.push(`id "${id}" already exists — assigned a new one.`); id = uid(); }
    ids.add(id);
    let type = str(c.type, 'other');
    if (!TYPES[type]) {
      if (c.type !== undefined) warnings.push(`Unknown type "${type}" on "${str(c.title, 'Untitled')}" — using "other". Valid: ${TYPE_ORDER.join(', ')}.`);
      type = 'other';
    }
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    newNodes.push({
      id,
      parentId: str(c.parent_id ?? c.parentId, 'root') || 'root',
      type,
      title: str(c.title).trim() || 'Untitled',
      path: str(c.path),
      tags: cleanTags(c.tags),
      summary: str(c.summary),
      content: str(c.content),
      x: num(c.x), y: num(c.y),
    });
  }
  if (!newNodes.length) throw new ToolError('No valid components in the `components` array.');

  for (const n of newNodes) {
    if (n.parentId !== 'root' && !ids.has(n.parentId)) {
      warnings.push(`"${n.title}" referenced unknown parent "${n.parentId}" — placed at the top level.`);
      n.parentId = 'root';
    }
  }
  p.nodes.push(...newNodes);

  // break containment cycles introduced by the new nodes
  for (const n of newNodes) {
    const visited = new Set([n.id]);
    let cur = n;
    while (cur && cur.parentId !== 'root') {
      if (visited.has(cur.parentId)) {
        warnings.push(`"${n.title}" was inside its own descendants — moved to the top level.`);
        n.parentId = 'root';
        break;
      }
      visited.add(cur.parentId);
      cur = nodeById(p, cur.parentId);
    }
  }

  const connWarnings = [];
  for (const e of Array.isArray(conns) ? conns : []) {
    try {
      addConnection(p, str(e?.from ?? e?.from_id), str(e?.to ?? e?.to_id));
    } catch (err) {
      if (err instanceof ToolError) connWarnings.push(`Connection skipped: ${err.message}`);
      else throw err;
    }
  }
  warnings.push(...connWarnings);

  const newIds = new Set(newNodes.map((n) => n.id));
  for (const pid of new Set(newNodes.map((n) => n.parentId))) placeNewNodes(p, pid, newIds);

  return { created: newNodes.map((n) => ({ id: n.id, title: n.title, type: n.type, parent_id: n.parentId })), warnings };
}

export function updateComponent(p, id, patch) {
  const n = requireNode(p, id);
  const warnings = [];

  if (patch.type !== undefined) {
    if (!TYPES[patch.type]) throw new ToolError(`Unknown type "${patch.type}". Valid types: ${TYPE_ORDER.join(', ')}.`);
    n.type = patch.type;
  }
  if (patch.title !== undefined) n.title = str(patch.title).trim() || n.title;
  if (patch.path !== undefined) n.path = str(patch.path);
  if (patch.summary !== undefined) n.summary = str(patch.summary);
  if (patch.content !== undefined) n.content = str(patch.content);
  if (patch.tags !== undefined) n.tags = cleanTags(patch.tags);
  if (typeof patch.x === 'number' && Number.isFinite(patch.x)) n.x = Math.round(patch.x);
  if (typeof patch.y === 'number' && Number.isFinite(patch.y)) n.y = Math.round(patch.y);

  const newParent = patch.parent_id ?? patch.parentId;
  if (newParent !== undefined && newParent !== n.parentId) {
    if (newParent !== 'root') {
      requireNode(p, newParent, 'parent');
      if (newParent === n.id || descendantIds(p, n.id).includes(newParent)) {
        throw new ToolError(`Cannot move "${n.title}" inside itself or its own descendants.`);
      }
    }
    n.parentId = newParent;
    const before = p.edges.length;
    p.edges = p.edges.filter((e) => {
      if (e.from !== n.id && e.to !== n.id) return true;
      const other = nodeById(p, e.from === n.id ? e.to : e.from);
      return other && other.parentId === n.parentId;
    });
    const dropped = before - p.edges.length;
    if (dropped) warnings.push(`Moving "${n.title}" dropped ${dropped} connection${dropped === 1 ? '' : 's'} that would have crossed layers (connections must stay within one layer).`);
    placeNewNodes(p, n.parentId, new Set([n.id]));
  }

  return { component: { id: n.id, title: n.title, type: n.type, parent_id: n.parentId }, warnings };
}

export function deleteComponents(p, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new ToolError('delete_components needs a non-empty `component_ids` array.');
  const warnings = [];
  const all = new Set();
  for (const id of ids) {
    if (!nodeById(p, id)) { warnings.push(`No component with id "${id}" — skipped.`); continue; }
    all.add(id);
    for (const d of descendantIds(p, id)) all.add(d);
  }
  if (!all.size) throw new ToolError('None of the given component_ids exist in this project.');
  const removed = p.nodes.filter((n) => all.has(n.id)).map((n) => ({ id: n.id, title: n.title }));
  p.nodes = p.nodes.filter((n) => !all.has(n.id));
  p.edges = p.edges.filter((e) => !all.has(e.from) && !all.has(e.to));
  for (const id of all) delete p.views?.[id];
  if (p.lastParent && p.lastParent !== 'root' && !nodeById(p, p.lastParent)) p.lastParent = 'root';
  return { removed, warnings };
}

export function addConnection(p, from, to) {
  const a = requireNode(p, from);
  const b = requireNode(p, to);
  if (from === to) throw new ToolError('A component cannot connect to itself.');
  if (a.parentId !== b.parentId) {
    throw new ToolError(
      `"${a.title}" and "${b.title}" are in different layers (connections must link siblings). ` +
      `Move one of them first, or connect their containers instead.`);
  }
  if (p.edges.some((e) => e.from === from && e.to === to)) {
    throw new ToolError(`"${a.title}" → "${b.title}" already exists.`);
  }
  const edge = { id: uid(), from, to };
  p.edges.push(edge);
  return { connection: { from, from_title: a.title, to, to_title: b.title } };
}

export function removeConnection(p, from, to) {
  const i = p.edges.findIndex((e) => e.from === from && e.to === to);
  if (i < 0) throw new ToolError(`No connection ${from} → ${to}. Use get_tree to list connections.`);
  p.edges.splice(i, 1);
  return { removed: { from, to } };
}

/* ════════════════════════ import / export ════════════════════════ */

// Collect node ids that arrive without usable coordinates, so the importer can
// auto-arrange exactly those layers instead of leaving the default grid.
function unplacedIds(raw) {
  const out = new Set();
  const scan = (proj) => {
    const nodes = Array.isArray(proj?.nodes) ? proj.nodes
      : (proj?.nodes && typeof proj.nodes === 'object' ? Object.values(proj.nodes) : []);
    for (const n of nodes) {
      if (n && typeof n === 'object' && !(Number.isFinite(n.x) && Number.isFinite(n.y)) && typeof n.id === 'string') out.add(n.id);
    }
  };
  scan(raw.project || raw);
  for (const proj of raw.projects || []) scan(proj);
  return out;
}

export function importAny(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const parsed = parseImportText(text, 'import');
  let unplaced = new Set();
  try { unplaced = unplacedIds(JSON.parse(text)); } catch { /* markdown input — embedded JSON has positions */ }

  for (const project of parsed.projects) {
    const layers = new Set(project.nodes.filter((n) => unplaced.has(n.id)).map((n) => n.parentId));
    for (const pid of layers) applyLayout(project, pid);
    if (layers.size) parsed.warnings.push(`${project.name}: auto-arranged ${layers.size} layer${layers.size === 1 ? '' : 's'} (components had no positions).`);
  }
  return parsed;
}

export function exportText(p, format = 'json', depth = 'standard') {
  if (format === 'json') return exportProjectFile(p).text;
  if (format === 'markdown') {
    if (!['overview', 'standard', 'full'].includes(depth)) {
      throw new ToolError(`Unknown depth "${depth}" — use overview, standard, or full.`);
    }
    return buildHandoff(p, depth).text;
  }
  throw new ToolError(`Unknown format "${format}" — use "json" (lossless, re-importable) or "markdown" (AI handoff document).`);
}

export { normalizeProject };
