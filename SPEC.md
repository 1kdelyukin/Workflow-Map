# AgentMap — format & integration spec

This document is for **AI assistants and tool authors** working with AgentMap projects. It covers the data model, the file formats, the REST API, the MCP server, and a playbook for importing existing workflows from repositories or folders. It is served at `/SPEC.md` on every AgentMap deployment.

## What AgentMap is

AgentMap stores **visual maps of AI-agent systems** as layered node graphs. A *project* contains *components* (nodes) connected by directed *connections* (edges). Any component can contain an inner sub-map (*layering*), which is how subsystems are expressed.

## Data model

A project:

```jsonc
{
  "id": "uuid",                  // stable identity — preserve it for round trips
  "schema": 1,
  "name": "Deep Research Assistant",
  "description": "What this system is for",
  "createdAt": "ISO-8601", "updatedAt": "ISO-8601",
  "settings": { "snap": true },
  "lastParent": "root",          // last layer the user had open
  "views": { "<layer-id>": { "x": 0, "y": 0, "z": 1 } },  // camera per layer
  "nodes": [ /* components, see below */ ],
  "edges": [ { "id": "uuid", "from": "<node-id>", "to": "<node-id>", "kind": "callback" } ]
}
```

Connection (edge) kinds — `kind` is optional and defaults to `flow` (omit it for flow):

| Kind | Meaning | Drawn as |
| --- | --- | --- |
| `flow` | A feeds into, precedes, or triggers B | solid arrow |
| `callback` | A returns or reports back to B (a response leg, usually closing a loop) | dashed, open arrowhead |
| `relation` | non-directional association | dotted, no arrowhead |

Other optional edge fields:

| Field | Meaning |
| --- | --- |
| `label` | short note (≤ 140 chars) on what triggers or carries the connection — shown on the arrow in the app and quoted in handoff exports |
| `points` | manual waypoints `[{ "x": n, "y": n }, …]` (≤ 32) for the user-drawn arrow shape in grid-locked mode — display-only routing data; **omit when generating** |

A component (node):

| Field | Meaning |
| --- | --- |
| `id` | unique string |
| `parentId` | `"root"` for the top level, or the id of the containing component |
| `type` | `phase` · `agent` · `skill` · `hook` · `code` · `doc` · `other` |
| `title` | display name |
| `path` | original file path, when the component corresponds to a file |
| `tags` | string array (≤ 24) |
| `summary` | 1–2 sentence summary shown on the card |
| `content` | full stored content (file text, prompt, instructions, notes) |
| `x`, `y` | canvas position — **omit when generating; layouts are computed automatically** |

Component types:

| Type | Use for |
| --- | --- |
| `phase` | a stage of the overall workflow (top-level flow reads left → right) |
| `agent` | an autonomous AI worker with its own instructions |
| `skill` | a reusable capability, prompt module, or tool wrapper |
| `hook` | an automation trigger or guardrail that runs at a defined moment |
| `code` | a source file or script |
| `doc` | reference material, policies, schemas, templates |
| `other` | anything else |

Rules the validator enforces (violations are repaired and reported as warnings, not errors):

- every `parentId` must be `"root"` or an existing node id; containment must be acyclic
- connections join **siblings only** (both endpoints share the same `parentId`); no self-loops or duplicates (at most one connection per ordered pair, whatever its kind)
- unknown types become `other`; unknown connection kinds become `flow`; missing positions are auto-placed

## File formats

| Format | Shape | Re-importable |
| --- | --- | --- |
| Project | `{ "format": "agentmap/project@1", "project": {…} }` | ✅ lossless |
| Backup | `{ "format": "agentmap/backup@1", "projects": […] }` | ✅ lossless |
| AI handoff (Standard/Full) | Markdown with an embedded ```` ```json ```` project block | ✅ lossless |
| AI handoff (Overview) | Markdown prose only | ❌ by design |

Bare project JSON (just `{nodes, edges, …}` without the wrapper) is also accepted with a warning. The importer validates, repairs, and reports everything it changed — **read the warnings**: they are your feedback loop.

## Deployment modes

- **Static** (any file host): projects live in the browser's IndexedDB. Exchange happens through the file formats above.
- **Server** (Vercel + Postgres, or the bundled Node server): projects live in a shared database. The browser app syncs live, and AI assistants connect through MCP or REST. Env vars: `DATABASE_URL` (or `AGENTMAP_DATA_DIR` for file storage), `AGENTMAP_TOKEN` (the API bearer token for MCP), optionally `AGENTMAP_OWNER_EMAIL` (the only email allowed to register the single owner account), and optionally `AGENTMAP_PRIVATE=1` (reads also require auth — no anonymous viewing).

## Access model

| Channel | Read | Write |
| --- | --- | --- |
| Browser, signed-in owner (HttpOnly session cookie) | ✅ | ✅ |
| Browser, guest | ✅ | ❌ (view-only) |
| MCP / REST with `Authorization: Bearer <AGENTMAP_TOKEN>` | ✅ | ✅ |
| Anonymous REST | ✅ (`GET` only) | ❌ |

Auth endpoints: `GET /api/auth/me` → `{registered, authenticated, email?}`; `POST /api/auth/register` (first time only, owner email only, sets the password); `POST /api/auth/login`; `POST /api/auth/logout`.

## MCP server

Endpoint: `POST /api/mcp` (Streamable HTTP, stateless, JSON responses).
Auth: `Authorization: Bearer <AGENTMAP_TOKEN>` header, or `?token=<AGENTMAP_TOKEN>` query parameter for clients that cannot set headers.

```sh
claude mcp add --transport http agentmap https://<your-host>/api/mcp \
  --header "Authorization: Bearer <AGENTMAP_TOKEN>"
```

### Tools

**Reading — use the cheapest level that answers the question:**

| Tool | Returns |
| --- | --- |
| `list_projects` | every project with stats — start here |
| `get_overview(project_id)` | short prose architecture overview |
| `get_tree(project_id, root_id?, depth?)` | full structure + summaries + connections, **no content** — small even for big maps |
| `get_component(project_id, component_id, include_content?)` | one component in full detail |
| `search(project_id, query, types?)` | matches with breadcrumbs and snippets |

**Writing:**

| Tool | Does |
| --- | --- |
| `create_project` / `update_project` / `delete_project` | project lifecycle |
| `import_project(data, mode?)` | import a whole project from JSON or handoff markdown; `mode: "replace"` updates in place by id |
| `add_components(project_id, components, connections?)` | batch-add; omit x/y to auto-place; give explicit ids to reference new components within the call; connections accept an optional `kind` |
| `update_component(project_id, component_id, …patch)` | edit fields, move between layers via `parent_id` |
| `delete_components(project_id, component_ids)` | cascades to nested components |
| `connect(project_id, from_id, to_id, kind?)` / `disconnect` | manage directed sibling connections; `connect` on an existing pair with a different `kind` changes its kind |
| `export_project(project_id, format, depth?)` | lossless JSON or handoff markdown |
| `arrange(project_id, layer_id?, recursive?)` | auto-layout |

Changes made over MCP appear in the user's open browser within a few seconds (the app polls). Every mutation returns warnings describing anything that was repaired, skipped, or dropped — verify your own work by reading them, and call `get_tree` afterwards to confirm the structure you intended.

## REST API

All routes require the bearer token.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | deployment probe (no auth): `{ok, remote, storage}` |
| `GET /api/projects` | all projects (each carries a server `version`) |
| `GET /api/projects?meta=1` | `[{id, name, version, updatedAt}]` — cheap polling |
| `GET /api/projects/:id` | one project |
| `PUT /api/projects/:id` | validate + upsert; optional `X-AgentMap-Version` header for optimistic concurrency (stale → `409` with the current copy) |
| `DELETE /api/projects/:id` | delete |

## Import playbook: turning a repo or folder into a map

When a user asks you to import an existing workflow (a repository, a `.claude/` setup, a folder of agent definitions):

1. **Survey first.** List the files before reading any in full. Classify by convention:
   - `.claude/agents/*.md`, `agents/` → `agent`
   - `.claude/skills/`, `skills/`, prompt modules, tool wrappers → `skill`
   - hooks in `.claude/settings.json`, CI triggers, guardrail scripts → `hook`
   - `README`, `CLAUDE.md`, `AGENTS.md`, docs/, schemas, policies → `doc`
   - source files and scripts the workflow executes → `code`
   - pipeline stages described in docs or orchestration code → `phase`
2. **Structure with layers, don't flatten.** Top level: the macro flow as phases/major components, left → right. Put a subsystem's internals *inside* its component (`parentId`), not beside it. 5–15 components per layer is the readable range.
3. **Write a 1–2 sentence `summary` for every component** — summaries are what make `get_tree` useful. Set `path` to the real file path and put the file's full text in `content`.
4. **Add connections** for data flow, sequencing, and triggering — between siblings only. Top-level arrows describe the macro flow; arrows inside a container describe its internal mechanics. Use `kind: "callback"` for response/feedback legs (reviewer → author, worker → orchestrator reports) and `kind: "relation"` for loose associations; leave the main flow as the default kind.
5. **Omit all `x`/`y`** and let the importer auto-arrange.
6. **Account for everything.** Every relevant file is either mapped or deliberately skipped (say which in your reply to the user). Don't silently drop components.
7. **Import** via `import_project` (or `create_project` + batched `add_components` for very large systems), then **read the warnings and `get_tree`** to verify the result matches your plan.

## Export & round trips

- For backups or moving between deployments: `export_project` with `format: "json"` — exact and lossless, including layout.
- For committing to a repo: the same JSON file works as a portable artifact (`<name>.agentmap.json`). To update an existing project later, re-import it with `mode: "replace"` — the id keeps the round trip stable.
- For handing to another AI without MCP access: `format: "markdown"` at depth `standard` (structure + metadata) or `full` (+ all content). Both embed the complete project JSON, so they re-import losslessly.
