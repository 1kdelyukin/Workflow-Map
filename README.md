# AgentMap

A polished, layered node-graph workspace for mapping AI-agent systems — phases, orchestrators, sub-agents, skills, hooks, code, and docs — with drill-down navigation, lossless import/export, **and a built-in MCP server so AI assistants can import, explore, and edit your workflows live**.

Two ways to run it:

- **Static** — the frontend is dependency-free HTML/CSS/JS with no build step; host it anywhere that serves files. Projects live in your browser (IndexedDB).
- **Server** — deploy to Vercel (free tier) with a Postgres database, or run the bundled Node server. Projects sync across devices, AI assistants connect over **MCP** and REST, and the deployment is **single-owner**: a landing page registers exactly one account (the owner's email), signed-in = edit, everyone else = view-only. The app picks the mode automatically at boot.

## Features

- **Project library** — create, open, rename, describe, duplicate, delete, search, and sort multiple projects; each remembers its full graph, layers, positions, and camera per layer.
- **Infinite canvas** — pan, zoom, starfield dot grid, draggable cards, smooth curved connections with arrowheads, marquee + multi-select.
- **Space-station UI** — dark-first deep-space theme (light theme included), solid rounded cards with type-colored edges, nebula-glow accents.
- **Layers** — any node can contain an inner sub-map. Opening one enters **focus mode**: the sub-map floats as a rounded panel over a blurred ghost of the parent layer, with side rails showing what feeds in and out of the container at the parent level — click a rail item to jump to that neighbor.
- **Magnetic snapping** — grid snapping plus alignment guides; hold `⌥/Alt` to bypass, `S` to toggle.
- **Detail panel** — title, type, file path, tags, summary, and a full-content editor (monospace for code), with copy button, child navigation, connection list, resize grip.
- **Editing** — double-click to add a node, drag from a card's side port to connect, duplicate/delete with one-step undo, everything autosaves.
- **Live AI sync (server mode)** — assistants import or edit projects over MCP and the changes appear in your open browser within seconds; simultaneous edits are caught with a clear keep-mine / take-theirs resolution.
- **Import / export**
  - `*.agentmap.json` — exact, lossless project file (round-trip verified).
  - Backup — every project in one file, restorable in bulk.
  - **AI handoff (`.md`)** — a self-describing document another AI can read directly, at three depths: *Overview*, *Standard*, *Full*. Standard/Full embed the complete project JSON, so they re-import losslessly.
  - Drag & drop any of these onto the window to import; the importer validates, repairs, and reports what it fixed.
- **Extras** — global search (`/` or `⌘K`), legend that doubles as a type filter, **auto-arrange view** (`L`, a display-only toggle that never touches saved positions — available to viewers too), minimap, shortcut reference (`?`), save-status indicator, sample project on first run.

## Quick start (local)

```sh
node scripts/dev-server.mjs
# → http://localhost:5173  (token: dev-token, projects stored in ./data)
```

This serves the app **and** the API/MCP endpoints with file-based storage — the full server experience with zero dependencies. Prefer browser-only storage? Serve the folder statically instead (`python3 -m http.server 5173`) and the app falls back to IndexedDB automatically.

## Deploy to Vercel (free) with server storage + MCP

1. Push this folder to a Git repo and import it in Vercel (framework preset: **Other**, no build command). `npm install` happens automatically for the API's one dependency.
2. Add a Postgres database — Vercel Marketplace → **Neon** (free tier) sets `DATABASE_URL` for you.
3. Environment variables:
   - `AGENTMAP_TOKEN` — any long random string; the API key AI assistants use for MCP.
   - `AGENTMAP_OWNER_EMAIL` — the one email allowed to register (defaults to `1kdelyukin@gmail.com`).
   - `AGENTMAP_PRIVATE` — optional; set to `1` to require sign-in even for viewing (no guest mode).
4. Deploy. Open the site → the landing page asks you to **create your password on first sign-in**. After that, registration is closed permanently and the same card is a normal sign-in.

The tables are created automatically on first use. Make a habit of **Library → ⋯ → Back up all projects** regardless of where data lives — free-tier databases deserve backups.

## Access model & security

| Who | Can |
| --- | --- |
| Owner (signed in) | everything — edit, import, delete, export |
| Guests (no sign-in) | browse and export everything, edit nothing |
| AI assistants (bearer token) | full read/write over MCP and REST |

Under the hood: the password is stored as a salted **scrypt** hash; sessions are stateless **HMAC-signed tokens** in an `HttpOnly` + `SameSite=Lax` cookie (the signing secret is generated once and kept in the database); cookie-authenticated writes additionally verify the request `Origin`; login/registration attempts are rate-limited with constant-time comparisons and generic errors; all responses carry `nosniff` / frame-deny / referrer-policy headers. Reads are public by default — that is what makes guest view-only mode work. Set `AGENTMAP_PRIVATE=1` to lock viewing behind sign-in as well (the landing page then has no guest option).

## Connect an AI assistant (MCP)

```sh
claude mcp add --transport http agentmap https://<your-host>/api/mcp \
  --header "Authorization: Bearer <AGENTMAP_TOKEN>"
```

Clients that can't set headers can append `?token=<AGENTMAP_TOKEN>` to the URL instead. Then ask things like:

- *"Import the workflow in this repo into AgentMap"* — the assistant reads the repo, builds the map, and it appears in your library live.
- *"Give me an overview of my Deep Research Assistant project"* — `get_overview`/`get_tree` return compact structure without reading every file.
- *"Add a fact-checking agent between Research and Synthesis"* — granular edit tools with server-side validation and repair warnings.
- *"Export it as a handoff doc for review"* — lossless JSON or self-describing markdown.

The complete format spec, tool reference, and import playbook live in [`SPEC.md`](SPEC.md), served at `/SPEC.md` on every deployment.

## Where your data lives

| Mode | Storage | Reach |
| --- | --- | --- |
| Server (`DATABASE_URL` + `AGENTMAP_TOKEN` set) | Postgres via the REST API | all your devices + AI assistants |
| Server (`AGENTMAP_DATA_DIR`) | JSON files on disk | self-hosting without a database |
| Static hosting | browser IndexedDB (localStorage fallback) | this browser only |

In server mode the browser holds a working copy and autosaves with optimistic versioning; conflicting writes surface a keep-mine / take-theirs choice instead of silently clobbering either side.

## File formats

| Format | Shape | Re-importable |
| --- | --- | --- |
| Project | `{ format: "agentmap/project@1", project: {...} }` | ✅ lossless |
| Backup | `{ format: "agentmap/backup@1", projects: [...] }` | ✅ lossless |
| Handoff (Standard/Full) | Markdown with an embedded ` ```json ` project block | ✅ lossless |
| Handoff (Overview) | Markdown prose only | ❌ (by design — smallest output) |

## Keyboard shortcuts

Press `?` in the app for the full reference. Highlights: scroll = pan, `⌘/Ctrl`+scroll = zoom, double-click = new node / open container, `N` new node, `⌘D` duplicate, `⌫` delete, `⌘Z` undo, `F` fit, `L` auto-arrange, `S` snapping, `U` up a level, `/` search, `T` theme, `M` minimap.

## Project structure

```
agentmap/
├── index.html            entry point (theme boot + favicon inline)
├── css/styles.css        design system: tokens, space theme, all components
├── js/                   the frontend (no build step, no dependencies)
│   ├── main.js           boot, server handshake, hash routing, first-run seeding
│   ├── state.js          app state, event bus, mutations, autosave, live sync
│   ├── storage.js        remote API / IndexedDB / localStorage backends
│   ├── canvas.js         viewport, drag/snap/guides, ports, edges, marquee
│   ├── workspace.js      top bar, search, focus mode, export dialog, shortcuts
│   ├── panel.js          right-side detail editor
│   ├── library.js        project library view
│   ├── minimap.js        live overview map
│   ├── layout.js         auto-arrange (layered DAG, cycle-safe)
│   ├── transfer.js       export builders + import parser/normalizer (pure)
│   ├── importer.js       file picker, drag-drop overlay, import feedback
│   ├── sample.js         "Deep Research Assistant" starter project
│   ├── ui.js             toasts, modals, menus, theme, helpers
│   └── icons.js          inline SVG icon set
├── api/                  Vercel serverless functions (server mode)
│   ├── health.js         deployment probe
│   ├── projects/         REST CRUD with optimistic versioning
│   ├── mcp.js            MCP endpoint (Streamable HTTP, stateless)
│   └── _lib/             auth, storage backends, shared model ops, MCP tools
│                         (reuses transfer.js/layout.js — one format implementation)
├── scripts/dev-server.mjs  zero-dependency local/self-host server
├── tests/                roundtrip + MCP + end-to-end API suites (`npm test`)
└── SPEC.md               format & integration spec for AI assistants
```

## Extending

- **New node type** — add it to `TYPES`/`TYPE_ORDER` in `state.js`, a glyph in `icons.js`, and a `--c-<type>` color (light + dark) in `styles.css`. Everything else (legend, cards, exports, MCP schemas, minimap) picks it up.
- **New export flavor** — add a builder in `transfer.js` and an option in `workspace.js`'s export dialog; the MCP `export_project` tool lives in `api/_lib/mcp.js`.
- **New MCP tool** — add the model operation to `api/_lib/core.js` (pure, testable) and register the tool in `api/_lib/mcp.js`.
- `transfer.js`, `layout.js`, and everything under `api/_lib/` are pure and run in Node: `npm test` covers format round trips, the MCP dispatcher, and the live HTTP surface.
