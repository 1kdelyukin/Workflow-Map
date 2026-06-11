// Starter project: a realistic multi-agent research pipeline used to seed first runs
// (and available any time from the library menu).
import { uid } from './ui.js';
import { SCHEMA, nowISO } from './state.js';

const L = (...lines) => lines.join('\n');

export function sampleProject() {
  const id = {};
  for (const k of [
    'intake', 'planning', 'research', 'synthesis', 'delivery', 'orchestrator', 'mission', 'pipeline',
    'classifier', 'reqSchema', 'planner', 'decompose', 'planTemplate',
    'searcher', 'reader', 'factChecker', 'webSearch', 'fetchClean', 'searchTs', 'rubric',
    'claimExtract', 'verifier', 'protocol',
    'writer', 'critic', 'cite', 'styleGuide',
    'qaGate', 'render', 'contract',
    'charter', 'preflight', 'budget', 'orchConfig',
  ]) id[k] = uid();

  const N = (nid, parentId, type, title, x, y, extra = {}) => ({
    id: nid, parentId, type, title,
    path: extra.path || '', tags: extra.tags || [], summary: extra.summary || '', content: extra.content || '',
    x, y,
  });
  const E = (from, to) => ({ id: uid(), from, to });

  const nodes = [
    /* ── top level ───────────────────────────────────────────── */
    N(id.intake, 'root', 'phase', 'Intake', 48, 264, {
      tags: ['entry'],
      summary: 'Receives a research request, classifies intent, and normalizes it into a structured brief.',
      content: L(
        'Goal: turn a raw user request into a structured research brief.',
        '',
        'Steps:',
        '1. Intent Classifier labels the request (question / report / comparison / monitor).',
        '2. Required fields are extracted into the request schema.',
        '3. Ambiguous requests are bounced back with 2-3 clarifying questions.',
        '',
        'Exit criteria: a brief with topic, depth, deadline, and output format.',
      ),
    }),
    N(id.planning, 'root', 'phase', 'Planning', 336, 264, {
      summary: 'Decomposes the brief into sub-questions and produces a budgeted research plan.',
      content: L(
        'The Planner agent turns the brief into an executable plan:',
        '- splits the topic into 3-7 sub-questions',
        '- assigns each sub-question a priority and a token/time budget',
        '- chooses which sources are acceptable (news, papers, docs, forums)',
        '',
        'Plans are validated against the plan template before the run starts.',
      ),
    }),
    N(id.research, 'root', 'phase', 'Research', 624, 168, {
      tags: ['parallel', 'core'],
      summary: 'Parallel evidence gathering: search, read, extract, and verify claims with citations.',
      content: L(
        'The heart of the system. For each sub-question:',
        '',
        '  Searcher -> Reader -> Fact-Checker',
        '',
        'Runs up to 4 sub-questions in parallel. Every extracted claim keeps a',
        'pointer to its source URL and quote span so the Fact-Checker and the',
        'final report can cite precisely.',
      ),
    }),
    N(id.synthesis, 'root', 'phase', 'Synthesis', 912, 264, {
      summary: 'Drafts the report from verified notes, then runs a writer/critic revision loop.',
      content: L(
        'Writer drafts from verified notes only (unverified claims are dropped',
        'or flagged). Critic reviews for structure, missing angles, and',
        'unsupported statements, then sends targeted revision notes back to',
        'the Writer. Max 2 revision cycles.',
      ),
    }),
    N(id.delivery, 'root', 'phase', 'Delivery', 1200, 264, {
      tags: ['exit'],
      summary: 'Final QA gate, rendering, and hand-off of the finished report.',
      content: L(
        'Last stop before the user sees anything:',
        '1. QA gate hook checks citations resolve and the output contract is met.',
        '2. render_report.py produces Markdown + PDF.',
        '3. The report and its source bundle are handed back to the caller.',
      ),
    }),
    N(id.orchestrator, 'root', 'agent', 'Orchestrator', 624, 540, {
      tags: ['coordinator', 'long-running'],
      path: 'agents/orchestrator.md',
      summary: 'Top-level agent that owns the run: schedules phases, enforces budgets, and recovers from failures.',
      content: L(
        '# Orchestrator',
        '',
        'You coordinate a multi-agent research pipeline. You never do research',
        'yourself - you schedule phases, route artifacts between them, and',
        'enforce the run budget.',
        '',
        '## Rules',
        '- Phases run in order; Research sub-tasks may run in parallel (max 4).',
        '- Every artifact passed between phases must validate against its schema.',
        '- On a sub-agent failure: retry once with the error attached, then',
        '  degrade gracefully (mark the sub-question unanswered, continue).',
        '- Stop the run and report if the budget guard fires twice.',
        '',
        '## Outputs',
        'A run ledger: phase timings, tokens spent, artifacts produced, failures.',
      ),
    }),
    N(id.mission, 'root', 'doc', 'Mission & guardrails', 336, 540, {
      path: 'docs/mission.md',
      tags: ['policy'],
      summary: 'What the system is for, what it must never do, and how quality is judged.',
      content: L(
        '# Mission',
        'Produce trustworthy, citation-backed research reports with minimal',
        'human supervision.',
        '',
        '# Guardrails',
        '- Never present an unverified claim as fact.',
        '- Prefer primary sources; mark paywalled or low-quality sources.',
        '- All numbers must carry a citation.',
        '- If confidence is low, say so explicitly in the report.',
      ),
    }),
    N(id.pipeline, 'root', 'code', 'pipeline.ts', 912, 540, {
      path: 'src/pipeline.ts',
      tags: ['entrypoint'],
      summary: 'Entry point that boots the orchestrator with a brief and streams run events.',
      content: L(
        'import { Orchestrator } from "./agents/orchestrator";',
        'import { loadConfig } from "./config";',
        '',
        'export async function runPipeline(brief: Brief) {',
        '  const config = await loadConfig();',
        '  const orchestrator = new Orchestrator(config);',
        '',
        '  for await (const event of orchestrator.run(brief)) {',
        '    ledger.append(event);          // every phase transition is recorded',
        '    if (event.kind === "budget-exceeded") break;',
        '  }',
        '  return ledger.summary();',
        '}',
      ),
    }),

    /* ── Intake ──────────────────────────────────────────────── */
    N(id.classifier, id.intake, 'agent', 'Intent Classifier', 48, 96, {
      path: 'agents/intent-classifier.md',
      tags: ['fast', 'haiku'],
      summary: 'Small, fast agent that labels the request and extracts brief fields.',
      content: L(
        '# Intent Classifier',
        '',
        'Classify the incoming request into exactly one of:',
        'question | report | comparison | monitor.',
        '',
        'Then fill the request schema. If a required field cannot be inferred,',
        'return clarifying_questions (max 3) instead of guessing.',
        '',
        'Latency budget: under 2 seconds. Use the smallest capable model.',
      ),
    }),
    N(id.reqSchema, id.intake, 'doc', 'Request schema', 336, 96, {
      path: 'docs/request-schema.md',
      summary: 'The structured brief every request is normalized into.',
      content: L(
        'brief:',
        '  topic: string            # what to research',
        '  depth: quick | standard | deep',
        '  format: answer | report | table',
        '  deadline_minutes: number',
        '  audience: string         # who reads the output',
        '  constraints: string[]    # source types to prefer/avoid',
      ),
    }),

    /* ── Planning ────────────────────────────────────────────── */
    N(id.planner, id.planning, 'agent', 'Planner', 48, 96, {
      path: 'agents/planner.md',
      summary: 'Turns the brief into sub-questions with priorities and budgets.',
      content: L(
        '# Planner',
        '',
        'Input: a validated brief. Output: a plan that the orchestrator can',
        'execute without further interpretation.',
        '',
        'For each sub-question include: question, why it matters, priority',
        '(P0-P2), source guidance, and a token budget. The sum of budgets must',
        'fit the run budget from orchestrator.config.json.',
      ),
    }),
    N(id.decompose, id.planning, 'skill', 'Decompose question', 336, 96, {
      path: 'skills/decompose/SKILL.md',
      tags: ['reusable'],
      summary: 'Reusable decomposition prompt: one topic in, 3-7 orthogonal sub-questions out.',
      content: L(
        '# Skill: decompose',
        '',
        'Break a research topic into sub-questions that are:',
        '- mutually exclusive (no two answerable by the same evidence)',
        '- collectively sufficient to answer the topic',
        '- individually answerable from public sources',
        '',
        'Reject decompositions where any sub-question is broader than the topic.',
      ),
    }),
    N(id.planTemplate, id.planning, 'doc', 'Plan template', 192, 300, {
      path: 'docs/plan-template.md',
      summary: 'Canonical shape of a research plan; plans are validated against it.',
      content: L(
        'plan:',
        '  topic: string',
        '  sub_questions:',
        '    - q: string',
        '      priority: P0 | P1 | P2',
        '      budget_tokens: number',
        '      sources: string[]',
        '  stop_conditions: string[]',
      ),
    }),

    /* ── Research ────────────────────────────────────────────── */
    N(id.searcher, id.research, 'agent', 'Searcher', 48, 60, {
      path: 'agents/searcher.md',
      tags: ['parallel'],
      summary: 'Finds candidate sources per sub-question; returns ranked URLs with reasons.',
      content: L(
        '# Searcher',
        '',
        'For one sub-question, produce up to 8 candidate sources.',
        'Use the web-search skill; diversify queries (synonyms, site: filters,',
        'date ranges). For each candidate return url, title, why it is',
        'promising, and a source-quality guess from the rubric.',
        '',
        'Never fetch page contents yourself - that is the Reader’s job.',
      ),
    }),
    N(id.reader, id.research, 'agent', 'Reader', 336, 60, {
      path: 'agents/reader.md',
      tags: ['parallel'],
      summary: 'Fetches and reads sources, extracting quotable claims with exact spans.',
      content: L(
        '# Reader',
        '',
        'Input: ranked URLs from the Searcher. For each source:',
        '1. fetch-and-clean to get readable text',
        '2. extract claims relevant to the sub-question',
        '3. for every claim keep: quote, char span, url, retrieved_at',
        '',
        'Drop sources that turn out to be off-topic; note why.',
      ),
    }),
    N(id.factChecker, id.research, 'agent', 'Fact-Checker', 624, 60, {
      tags: ['gatekeeper'],
      summary: 'Verifies extracted claims before they may be used downstream. Contains its own sub-pipeline.',
      content: L(
        'Every claim that will appear in the report passes through here.',
        '',
        'Internally: claim-extraction normalizes claims, then the Verifier',
        'cross-checks each one against at least one independent source.',
        'Claims end up labeled: verified | unverified | contested.',
      ),
    }),
    N(id.webSearch, id.research, 'skill', 'Web search', 48, 276, {
      path: 'skills/web-search/SKILL.md',
      summary: 'Wraps the search API: query shaping, dedup, and polite rate limits.',
      content: L(
        '# Skill: web-search',
        '',
        'query(q, opts) -> results[]',
        '- expands q into 2-3 query variants',
        '- merges and dedups by canonical URL',
        '- respects a global 2 req/s rate limit',
        '- returns title, url, snippet, published_at when available',
      ),
    }),
    N(id.fetchClean, id.research, 'skill', 'Fetch & clean', 336, 276, {
      path: 'skills/fetch-clean/SKILL.md',
      summary: 'Fetches a URL and returns readable article text with boilerplate stripped.',
      content: L(
        '# Skill: fetch-clean',
        '',
        'fetch(url) -> { text, title, byline, published_at }',
        '- honors robots.txt; 10s timeout; max 2 MB',
        '- strips nav/ads/comments, keeps headings and tables',
        '- records final URL after redirects for citation integrity',
      ),
    }),
    N(id.searchTs, id.research, 'code', 'tools/search.ts', 48, 462, {
      path: 'src/tools/search.ts',
      summary: 'Implementation behind the web-search skill.',
      content: L(
        'export async function search(q: string, opts: SearchOpts = {}) {',
        '  const variants = expandQuery(q, opts);        // synonyms, filters',
        '  const batches = await Promise.all(variants.map(callSearchApi));',
        '  const merged = dedupeByCanonicalUrl(batches.flat());',
        '  return rank(merged, opts.recencyBias ?? 0.3).slice(0, opts.limit ?? 8);',
        '}',
      ),
    }),
    N(id.rubric, id.research, 'doc', 'Source quality rubric', 624, 276, {
      path: 'docs/source-rubric.md',
      tags: ['policy'],
      summary: 'How sources are scored: provenance, recency, independence, expertise.',
      content: L(
        '# Source quality rubric',
        '',
        'Score each source 0-3 on four axes:',
        '- Provenance: primary > institutional > reputable media > anonymous',
        '- Recency: fresher is better for moving topics, irrelevant for stable ones',
        '- Independence: does it merely cite another candidate source?',
        '- Expertise: author credentials in this domain',
        '',
        'Sources scoring under 4 total may support but never solely carry a claim.',
      ),
    }),

    /* ── Research ▸ Fact-Checker ─────────────────────────────── */
    N(id.claimExtract, id.factChecker, 'skill', 'Claim extraction', 48, 84, {
      path: 'skills/claim-extraction/SKILL.md',
      summary: 'Normalizes prose into atomic, checkable claims.',
      content: L(
        '# Skill: claim-extraction',
        '',
        'Rewrite evidence into atomic claims:',
        '- one fact per claim, no conjunctions',
        '- resolve pronouns and relative dates ("last year" -> 2025)',
        '- keep the original quote and source attached',
      ),
    }),
    N(id.verifier, id.factChecker, 'agent', 'Verifier', 336, 84, {
      path: 'agents/verifier.md',
      tags: ['skeptical'],
      summary: 'Adversarial checker: tries to refute each claim before approving it.',
      content: L(
        '# Verifier',
        '',
        'For each claim, actively try to REFUTE it:',
        '- find an independent source that confirms or contradicts',
        '- check numbers, dates, and units exactly',
        '- label: verified (2+ independent sources), unverified, or contested',
        '',
        'Bias rule: when uncertain, prefer "unverified" over "verified".',
      ),
    }),
    N(id.protocol, id.factChecker, 'doc', 'Verification protocol', 192, 288, {
      path: 'docs/verification-protocol.md',
      summary: 'The exact ladder a claim climbs from extracted to verified.',
      content: L(
        '1. Extracted   - atomic claim with source quote',
        '2. Corroborated - second independent source found',
        '3. Verified    - numbers/dates match exactly across sources',
        'X. Contested   - credible sources disagree; report both sides',
      ),
    }),

    /* ── Synthesis ───────────────────────────────────────────── */
    N(id.writer, id.synthesis, 'agent', 'Writer', 48, 84, {
      path: 'agents/writer.md',
      summary: 'Drafts the report from verified notes, citing as it writes.',
      content: L(
        '# Writer',
        '',
        'Draft the report using ONLY verified or clearly-flagged claims.',
        'Every number gets an inline citation [n]. Follow the style guide.',
        'Open with the answer, then the evidence, then caveats.',
      ),
    }),
    N(id.critic, id.synthesis, 'agent', 'Critic', 336, 84, {
      tags: ['review-loop'],
      path: 'agents/critic.md',
      summary: 'Reviews drafts for gaps and unsupported statements; sends revision notes back.',
      content: L(
        '# Critic',
        '',
        'Review the draft as a hostile expert reader:',
        '- Is any statement unsupported by the notes?',
        '- What obvious counter-argument is missing?',
        '- Does the structure answer the brief, in its requested format?',
        '',
        'Return at most 5 revision notes, each pointing at a specific passage.',
      ),
    }),
    N(id.cite, id.synthesis, 'skill', 'Cite sources', 48, 300, {
      path: 'skills/cite/SKILL.md',
      summary: 'Renders the citation list and validates that every [n] resolves.',
      content: L(
        '# Skill: cite',
        '',
        'Build the reference list from claim metadata. Fail the draft if any',
        'inline [n] has no entry, or any entry is never referenced.',
      ),
    }),
    N(id.styleGuide, id.synthesis, 'doc', 'Style guide', 336, 300, {
      path: 'docs/style.md',
      summary: 'Voice, structure, and formatting rules for reports.',
      content: L(
        '- Lead with the answer in 2-3 sentences.',
        '- Short paragraphs; headings every 4-6 paragraphs.',
        '- Numbers: round sensibly, always cite, show units.',
        '- Confidence labels: high / medium / low, stated in plain language.',
      ),
    }),

    /* ── Delivery ────────────────────────────────────────────── */
    N(id.qaGate, id.delivery, 'hook', 'QA gate', 48, 84, {
      path: 'hooks/qa-gate.sh',
      tags: ['blocking'],
      summary: 'Blocking hook: refuses delivery if citations or the output contract fail.',
      content: L(
        '#!/usr/bin/env bash',
        '# Runs before delivery. Non-zero exit blocks the hand-off.',
        'set -euo pipefail',
        '',
        'report="$1"',
        'check_citations "$report"        # every [n] resolves to a live source',
        'check_contract  "$report"        # sections required by docs/output-contract.md',
        'check_confidence_labels "$report"',
        'echo "QA gate passed"',
      ),
    }),
    N(id.render, id.delivery, 'code', 'render_report.py', 336, 84, {
      path: 'src/render_report.py',
      summary: 'Renders the approved draft to Markdown and PDF with the citation appendix.',
      content: L(
        'def render(draft: Draft) -> Artifacts:',
        '    md = to_markdown(draft, citations=True)',
        '    pdf = to_pdf(md, theme="report")',
        '    bundle = SourceBundle(draft.claims)   # quotes + URLs for audit',
        '    return Artifacts(md=md, pdf=pdf, sources=bundle)',
      ),
    }),
    N(id.contract, id.delivery, 'doc', 'Output contract', 192, 288, {
      path: 'docs/output-contract.md',
      summary: 'What every delivered report must contain, in order.',
      content: L(
        '1. Answer (2-3 sentences, plain language)',
        '2. Key findings with citations',
        '3. Evidence detail per sub-question',
        '4. Caveats & confidence',
        '5. References',
        '6. Appendix: source bundle manifest',
      ),
    }),

    /* ── Orchestrator internals ──────────────────────────────── */
    N(id.charter, id.orchestrator, 'doc', 'CLAUDE.md (charter)', 48, 84, {
      path: 'CLAUDE.md',
      tags: ['always-loaded'],
      summary: 'Standing instructions loaded into every agent in the system.',
      content: L(
        '# System charter',
        '',
        'You are part of a multi-agent research pipeline. Always:',
        '- pass artifacts forward in the exact schema the next phase expects',
        '- log decisions that a human reviewer might question',
        '- prefer saying "unknown" over fabricating',
        '- stay inside your phase: do not do another agent’s job',
      ),
    }),
    N(id.preflight, id.orchestrator, 'hook', 'Pre-flight check', 336, 84, {
      path: 'hooks/preflight.sh',
      summary: 'Runs before each phase: validates the incoming artifact against its schema.',
      content: L(
        '#!/usr/bin/env bash',
        '# Validate the artifact a phase is about to consume.',
        'set -euo pipefail',
        'artifact="$1"; schema="$2"',
        'validate --schema "schemas/$schema.json" "$artifact" ||',
        '  { echo "preflight: $schema invalid" >&2; exit 2; }',
      ),
    }),
    N(id.budget, id.orchestrator, 'hook', 'Budget guard', 336, 276, {
      path: 'hooks/budget-guard.sh',
      tags: ['safety'],
      summary: 'Watches token/time spend; warns at 80%, halts the run at 100%.',
      content: L(
        '#!/usr/bin/env bash',
        '# Called after every agent turn with the running totals.',
        'spent=$1; budget=$2',
        'pct=$(( spent * 100 / budget ))',
        '[ "$pct" -ge 100 ] && { echo "halt: budget exhausted"; exit 3; }',
        '[ "$pct" -ge 80 ]  && echo "warn: ${pct}% of budget used"',
        'exit 0',
      ),
    }),
    N(id.orchConfig, id.orchestrator, 'code', 'orchestrator.config.json', 48, 276, {
      path: 'src/orchestrator.config.json',
      summary: 'Run budgets, parallelism, and model routing per agent.',
      content: L(
        '{',
        '  "budget": { "tokens": 400000, "minutes": 25 },',
        '  "parallelism": { "research": 4 },',
        '  "models": {',
        '    "intent-classifier": "small-fast",',
        '    "planner": "frontier",',
        '    "searcher": "mid",',
        '    "reader": "mid",',
        '    "verifier": "frontier",',
        '    "writer": "frontier",',
        '    "critic": "mid"',
        '  },',
        '  "retries": { "per_agent": 1, "backoff_seconds": 5 }',
        '}',
      ),
    }),
  ];

  const edges = [
    // top level flow
    E(id.intake, id.planning), E(id.planning, id.research), E(id.research, id.synthesis), E(id.synthesis, id.delivery),
    E(id.orchestrator, id.planning), E(id.orchestrator, id.research), E(id.orchestrator, id.synthesis),
    E(id.mission, id.orchestrator), E(id.pipeline, id.orchestrator),
    // intake
    E(id.classifier, id.reqSchema),
    // planning
    E(id.decompose, id.planner), E(id.planTemplate, id.planner),
    // research
    E(id.webSearch, id.searcher), E(id.searchTs, id.webSearch), E(id.searcher, id.reader),
    E(id.fetchClean, id.reader), E(id.reader, id.factChecker), E(id.rubric, id.factChecker),
    // fact-checker internals
    E(id.claimExtract, id.verifier), E(id.protocol, id.verifier),
    // synthesis (includes a revision loop)
    E(id.cite, id.writer), E(id.styleGuide, id.writer), E(id.writer, id.critic), E(id.critic, id.writer),
    // delivery
    E(id.contract, id.qaGate), E(id.qaGate, id.render),
    // orchestrator internals
    E(id.orchConfig, id.preflight),
  ];

  const t = nowISO();
  return {
    id: uid(), schema: SCHEMA,
    name: 'Deep Research Assistant',
    description: 'Sample project — a multi-agent research pipeline. Explore, edit, and export it freely.',
    createdAt: t, updatedAt: t,
    settings: { snap: true },
    lastParent: 'root',
    views: {},
    nodes, edges,
  };
}
