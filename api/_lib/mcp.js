// Stateless MCP server (Streamable HTTP, JSON responses) exposing AgentMap
// projects as tools. Hand-rolled JSON-RPC — no session state, every request is
// authenticated and self-contained, which is exactly what serverless wants.
import * as core from './core.js';
import { ToolError } from './core.js';

const LATEST_PROTOCOL = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set([LATEST_PROTOCOL, '2025-03-26', '2024-11-05']);

const INSTRUCTIONS = `AgentMap stores visual maps of AI-agent systems as layered node graphs.
Components (nodes) have a type — phase, agent, skill, hook, code, doc, other — plus a title,
optional file path, tags, a 1–2 sentence summary, and full content. Nesting (parent_id)
expresses containment: any component can contain an inner sub-map. Connections are directed
A → B links and always join siblings within one layer.

Typical flows:
- Explore: list_projects → get_tree (structure + summaries, no content) → get_component for full content. Use search to locate things. Only fetch what you need — get_tree is small even for big maps.
- Import a workflow: build the components yourself (from a repo, folder, or description), then call import_project with a full project JSON, or create_project + add_components in batches. Omit x/y — layouts are computed automatically. Read back warnings: they tell you what was repaired or dropped.
- Edit: update_component / add_components / delete_components / connect / disconnect. Changes appear live in the user's browser.
- Hand off: export_project gives lossless JSON or a self-describing markdown document.

The full format spec and import playbook is served at /SPEC.md on this host.`;

/* ── shared schema fragments ── */

const TYPE_ENUM = ['phase', 'agent', 'skill', 'hook', 'code', 'doc', 'other'];
const PID = { type: 'string', description: 'Project id (from list_projects).' };

const componentSchema = (forUpdate = false) => ({
  type: 'object',
  properties: {
    ...(forUpdate ? {} : {
      id: { type: 'string', description: 'Optional. Set one only if you need to reference this component from `connections` or as another new component\'s parent_id in the same call.' },
    }),
    parent_id: { type: 'string', description: 'Id of the containing component, or "root" for the top level. Default "root".' },
    type: { type: 'string', enum: TYPE_ENUM },
    title: { type: 'string' },
    path: { type: 'string', description: 'Original file path when this component corresponds to a file (e.g. ".claude/agents/researcher.md").' },
    tags: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: '1–2 sentence summary shown on the card and in get_tree.' },
    content: { type: 'string', description: 'Full content: file text, prompt, instructions, notes.' },
    x: { type: 'number', description: 'Canvas position. Omit to auto-place (recommended).' },
    y: { type: 'number', description: 'Canvas position. Omit to auto-place (recommended).' },
  },
});

/* ── server factory ── */

export function createMcp(store, { appUrl = '' } = {}) {
  const projectUrl = (id) => (appUrl ? `${appUrl}/#p/${encodeURIComponent(id)}` : `#p/${encodeURIComponent(id)}`);

  async function getRow(projectId) {
    if (!projectId || typeof projectId !== 'string') {
      throw new ToolError('project_id is required. Call list_projects to see available projects.');
    }
    const row = await store.get(projectId);
    if (!row) throw new ToolError(`No project with id "${projectId}". Call list_projects to see available projects.`);
    return row;
  }

  // Read-modify-write with optimistic retry: granular edits survive racing with
  // the browser's autosave.
  async function mutate(projectId, fn) {
    for (let attempt = 0; ; attempt++) {
      const row = await getRow(projectId);
      const project = row.data;
      const result = fn(project) || {};
      project.updatedAt = new Date().toISOString();
      try {
        await store.put(project.id, project, { expectedVersion: row.version });
        return result;
      } catch (e) {
        if (e.code === 'conflict' && attempt < 2) continue;
        throw e;
      }
    }
  }

  const TOOLS = [
    {
      name: 'list_projects',
      description: 'List every project with id, name, description and size stats. Start here.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const rows = await store.list();
        return {
          projects: rows.map((r) => ({ ...core.projectSummary(r.data), url: projectUrl(r.id) })),
          hint: 'Use get_tree for structure, get_component for content.',
        };
      },
    },
    {
      name: 'get_overview',
      description: 'A short human-readable architecture overview of one project: component mix, top-level flow, entry/exit points, most important components. No file contents.',
      inputSchema: { type: 'object', properties: { project_id: PID }, required: ['project_id'] },
      run: async (a) => core.overviewText((await getRow(a.project_id)).data),
    },
    {
      name: 'get_tree',
      description: 'The complete structure of a project as compact JSON: nested components with summaries and tags (no content), plus all connections. This is the cheapest way to understand a whole map. Optionally scope to a sub-layer (root_id) or limit nesting depth.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: PID,
          root_id: { type: 'string', description: 'Component id to use as the root — returns only that sub-map. Default "root" (whole project).' },
          depth: { type: 'number', description: 'Max nesting levels to expand (0 or omitted = all). Cut-off branches report components_omitted.' },
        },
        required: ['project_id'],
      },
      run: async (a) => core.treeOf((await getRow(a.project_id)).data, { rootId: a.root_id || 'root', depth: a.depth || 0 }),
    },
    {
      name: 'get_component',
      description: 'Full detail of one component: metadata, children, connections, and stored content. Set include_content=false to skip a large content field.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: PID,
          component_id: { type: 'string' },
          include_content: { type: 'boolean', description: 'Default true.' },
        },
        required: ['project_id', 'component_id'],
      },
      run: async (a) => core.componentOf((await getRow(a.project_id)).data, a.component_id, a.include_content !== false),
    },
    {
      name: 'search',
      description: 'Search a project across titles, paths, tags, summaries and content. Returns matches with breadcrumbs and content snippets (max 50).',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: PID,
          query: { type: 'string' },
          types: { type: 'array', items: { type: 'string', enum: TYPE_ENUM }, description: 'Optional filter by component type.' },
        },
        required: ['project_id', 'query'],
      },
      run: async (a) => ({ results: core.searchProject((await getRow(a.project_id)).data, a.query, a.types) }),
    },
    {
      name: 'create_project',
      description: 'Create a new empty project. Returns its id and URL. Add components with add_components, or use import_project instead to create a populated project in one call.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' } },
        required: ['name'],
      },
      run: async (a) => {
        const p = core.blankProject({ name: String(a.name || '').trim() || 'Untitled project', description: String(a.description || '') });
        await store.put(p.id, p);
        return { project_id: p.id, name: p.name, url: projectUrl(p.id) };
      },
    },
    {
      name: 'import_project',
      description: 'Import a complete project in one call. Accepts AgentMap project JSON (wrapped or bare {nodes, edges, ...}), a whole-library backup, or a Standard/Full AI-handoff markdown document. Input is validated and repaired; layers whose components lack positions are auto-arranged. Returns warnings describing every repair — read them to verify nothing was dropped. mode "replace" overwrites the project that has the same id (round-trip update); default "create" makes a new project.',
      inputSchema: {
        type: 'object',
        properties: {
          data: { description: 'The project: a JSON string, a JSON object, or handoff markdown text.' },
          mode: { type: 'string', enum: ['create', 'replace'], description: 'Default "create".' },
        },
        required: ['data'],
      },
      run: async (a) => {
        const parsed = core.importAny(a.data);
        const installed = [];
        for (const project of parsed.projects) {
          if (a.mode === 'replace') {
            await store.put(project.id, project);
          } else {
            const existing = await store.get(project.id);
            if (existing) {
              project.id = crypto.randomUUID();
              parsed.warnings.push(`A project with that id already exists — created a new one (${project.id}). Use mode "replace" to update in place.`);
            }
            await store.put(project.id, project);
          }
          installed.push({ project_id: project.id, name: project.name, ...core.statsOf(project), url: projectUrl(project.id) });
        }
        return { imported: installed, warnings: parsed.warnings };
      },
    },
    {
      name: 'update_project',
      description: 'Rename a project or update its description.',
      inputSchema: {
        type: 'object',
        properties: { project_id: PID, name: { type: 'string' }, description: { type: 'string' } },
        required: ['project_id'],
      },
      run: (a) => mutate(a.project_id, (p) => {
        if (a.name !== undefined) p.name = String(a.name).trim() || p.name;
        if (a.description !== undefined) p.description = String(a.description);
        return { project: { id: p.id, name: p.name, description: p.description } };
      }),
    },
    {
      name: 'delete_project',
      description: 'Permanently delete a project and everything in it. There is no undo — consider export_project first.',
      inputSchema: { type: 'object', properties: { project_id: PID }, required: ['project_id'] },
      run: async (a) => {
        const row = await getRow(a.project_id);
        await store.del(a.project_id);
        return { deleted: { project_id: row.id, name: row.name } };
      },
    },
    {
      name: 'add_components',
      description: 'Add one or more components (and optionally connections between them) to a project. Components without x/y are placed automatically. Reference other components in the same call by giving them explicit ids. Returns the created ids plus warnings for anything repaired or skipped.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: PID,
          components: { type: 'array', items: componentSchema(false) },
          connections: {
            type: 'array',
            description: 'Directed links {from, to} using component ids (existing or just created). Both ends must share the same parent.',
            items: {
              type: 'object',
              properties: { from: { type: 'string' }, to: { type: 'string' } },
              required: ['from', 'to'],
            },
          },
        },
        required: ['project_id', 'components'],
      },
      run: (a) => mutate(a.project_id, (p) => core.addComponents(p, a.components, a.connections || [])),
    },
    {
      name: 'update_component',
      description: 'Update fields of one component: title, type, path, tags, summary, content, position, or parent_id (moving it into another container; connections that would cross layers are dropped with a warning).',
      inputSchema: {
        type: 'object',
        properties: { project_id: PID, component_id: { type: 'string' }, ...componentSchema(true).properties },
        required: ['project_id', 'component_id'],
      },
      run: (a) => mutate(a.project_id, (p) => core.updateComponent(p, a.component_id, a)),
    },
    {
      name: 'delete_components',
      description: 'Delete components by id. Everything nested inside them and every connection touching them is removed too. No undo.',
      inputSchema: {
        type: 'object',
        properties: { project_id: PID, component_ids: { type: 'array', items: { type: 'string' } } },
        required: ['project_id', 'component_ids'],
      },
      run: (a) => mutate(a.project_id, (p) => core.deleteComponents(p, a.component_ids)),
    },
    {
      name: 'connect',
      description: 'Add a directed connection between two sibling components (same layer): from feeds into / precedes / triggers to.',
      inputSchema: {
        type: 'object',
        properties: { project_id: PID, from_id: { type: 'string' }, to_id: { type: 'string' } },
        required: ['project_id', 'from_id', 'to_id'],
      },
      run: (a) => mutate(a.project_id, (p) => core.addConnection(p, a.from_id, a.to_id)),
    },
    {
      name: 'disconnect',
      description: 'Remove the connection from one component to another.',
      inputSchema: {
        type: 'object',
        properties: { project_id: PID, from_id: { type: 'string' }, to_id: { type: 'string' } },
        required: ['project_id', 'from_id', 'to_id'],
      },
      run: (a) => mutate(a.project_id, (p) => core.removeConnection(p, a.from_id, a.to_id)),
    },
    {
      name: 'export_project',
      description: 'Export a project as text. format "json": exact lossless .agentmap.json (re-importable anywhere, ideal for backups and git). format "markdown": self-describing AI-handoff document at depth overview (prose only), standard (+ metadata, re-importable), or full (+ all content, re-importable).',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: PID,
          format: { type: 'string', enum: ['json', 'markdown'] },
          depth: { type: 'string', enum: ['overview', 'standard', 'full'], description: 'Markdown only. Default "standard".' },
        },
        required: ['project_id', 'format'],
      },
      run: async (a) => core.exportText((await getRow(a.project_id)).data, a.format, a.depth || 'standard'),
    },
    {
      name: 'arrange',
      description: 'Auto-arrange a layer (or, with recursive=true, the whole sub-tree) into a tidy left-to-right flow. Useful after many edits.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: PID,
          layer_id: { type: 'string', description: 'Container component id, or "root" (default).' },
          recursive: { type: 'boolean' },
        },
        required: ['project_id'],
      },
      run: (a) => mutate(a.project_id, (p) => core.arrangeLayers(p, a.layer_id || 'root', !!a.recursive)),
    },
  ];

  /* ── JSON-RPC plumbing ── */

  const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function callTool(name, args) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return null;
    try {
      const out = await tool.run(args || {});
      const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      if (e instanceof ToolError) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
      console.error('[agentmap mcp] tool failed:', name, e);
      return { content: [{ type: 'text', text: `Error: the ${name} tool failed unexpectedly: ${e.message}` }], isError: true };
    }
  }

  // One JSON-RPC message in → one response out (or null for notifications).
  async function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return rpcError(null, -32600, 'Invalid request');
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    if (typeof method !== 'string') {
      return isNotification ? null : rpcError(id, -32600, 'Invalid request');
    }
    if (method.startsWith('notifications/')) return null;

    try {
      switch (method) {
        case 'initialize': {
          const asked = params?.protocolVersion;
          return rpcResult(id, {
            protocolVersion: SUPPORTED_PROTOCOLS.has(asked) ? asked : LATEST_PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'agentmap', title: 'AgentMap', version: core.APP_VERSION },
            instructions: INSTRUCTIONS,
          });
        }
        case 'ping':
          return rpcResult(id, {});
        case 'tools/list':
          return rpcResult(id, {
            tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
          });
        case 'tools/call': {
          const result = await callTool(params?.name, params?.arguments);
          if (!result) return rpcError(id, -32602, `Unknown tool "${params?.name}". Call tools/list for available tools.`);
          return isNotification ? null : rpcResult(id, result);
        }
        default:
          return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      console.error('[agentmap mcp]', method, e);
      return isNotification ? null : rpcError(id, -32603, `Internal error: ${e.message}`);
    }
  }

  // Body may be a single message or (older protocol versions) a batch array.
  async function handleBody(body) {
    if (Array.isArray(body)) {
      if (!body.length) return { status: 400, json: rpcError(null, -32600, 'Empty batch') };
      const responses = (await Promise.all(body.map(handleMessage))).filter(Boolean);
      return responses.length ? { status: 200, json: responses } : { status: 202 };
    }
    const response = await handleMessage(body);
    return response ? { status: 200, json: response } : { status: 202 };
  }

  return { handleBody, tools: TOOLS };
}
