# Spec009: Module Agent Workflows

- **ID:** spec009-module-agent-workflows
- **Status:** Draft — pending owner review. Not approved for implementation.
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** — (pending owner review)
- **Last updated:** 2026-10-06

> WHAT and WHY only. Architecture, contracts, and the file-level handoff are in `PLAN.md`;
> ordered work is in `TASKS.md`.

## Summary

Give QuantMeridian modules an embedded agent panel: a chat in which each message queues an
agentic workflow job, built on QuantSmith's data-analysis and visualization agents —
`nl_analytics`, `data_visualization`, `data_storytelling`, and the economists'
`macro_backdrop_summarizer` — and on its spec `0081` analytics packs and spec `0093`
visualization packs (`economics_macro`, `rates_fixed_income`). Jobs run in a
separate Python worker pinned to an exact QuantSmith commit. Charts render through QuantMeridian's
own chart engine. Every number reaches the screen only after QuantMeridian re-resolves it against
Gold. The LLM behind any step — Anthropic, OpenAI, an OpenAI- or Anthropic-compatible gateway, a
local server, or no LLM at all — is a named, configurable profile rather than a hard-coded
provider, and the existing AI Copilot moves onto the same profiles.

## Problem & Context

### What QuantMeridian has today

- **One LLM touchpoint, hard-wired.** The AI Copilot (`AI`, `/copilot`) calls the Anthropic SDK
  with a fixed model (`model: "claude-opus-4-8"`, `src/app/api/copilot/route.ts:59`). The only LLM
  setting is `ANTHROPIC_API_KEY`; there is no profile, base-URL, or gateway setting, and no way to
  use another provider.
- **Single-turn, unqueued chat.** The Copilot page shows a thread, but each request sends only the
  current question (`body: JSON.stringify({ question: t })`) and a new question cannot be sent
  while one is in flight (`if (!t || pending) return;`, `src/app/copilot/page.tsx:303`). Nothing is
  queued, persisted, or resumable.
- **Copilot context is simulated desk data.** `src/lib/server/copilotContext.ts` builds its
  snapshot from the deterministic `@/data/securitiesLending`, `primeFinance`, `collateral`, and
  `cash` getters; `docs/gold-db/MODULE_DATA_AUDIT.md` classifies the module as SIM. It is not a
  foundation for analysis over Gold data.
- **No in-module analysis.** Analysis and charting happen by hand in each module or in the
  `MGC`/`MKC` chart studios. Roadmap §3.6 (`docs/roadmaps/FUTURE_FEATURE_ROADMAP.md`) asks for
  copilot actions that "build charts, compare securities, and draft desk summaries", but no spec
  covers it.
- **spec005 proved the trust pattern by hand only.** Its Phase 2 pilot re-verified an
  agent-drafted macro brief against Gold (17 of 23 claims verified, every injected claim caught,
  two non-injected problems found) and recommended the concept was sound but "not yet proven
  unattended enough to wire into `MPUB` live." Nothing has been automated since.

### What QuantSmith now offers

spec005's pin (`d57cb67`, 2026-08-29) predates most of the QuantSmith surface this spec uses. At
QuantSmith `main` `0134d403d5a336ce20e7abd7fb7a0935d7917114` (assessed 2026-10-06):

- **`nl_analytics` (spec `0080`, status Draft, runtime largely built).** Question → typed
  `QueryPlan` over governed `0008` metrics (never SQL) → `validate_plan` → `0058` clearance →
  execution over a caller-injected `Reader` → deterministic chart → computed insights → grounded
  narrative → typed `ChatResponse` (`answered`, `clarification_needed`, `masked`, `empty`,
  `stale`, `write_rejected`). Tasks T-001–T-018 and T-020 are done; T-019, T-021, and T-022 are
  open. LLM interpreters plug in through `register_interpreter` and "live outside the package".
- **`data_visualization` agent.** The single-chart form rule (`kpi` / `line` / `bar` / `table` /
  `scatter`), finding-first titles, units, alt text, a minimal Vega-Lite spec, and a Markdown table
  (`src/quantsmith/nl_analytics/chart.py`).
- **Analytics domain packs (spec `0081`, Draft).** `economics_macro` and `rates_fixed_income` (and
  `credit_markets`, `fx_markets`, …) declare units, additivity classes (`additive`,
  `semi_additive`, `non_additive`), insight suppressions, caveats, and chart conventions — for
  example "rate changes are reported in basis points" and "plot curves with tenor ordered by
  maturity". Both packs carry review status `draft`.
- **Visualization packs (spec `0093`, Approved).** Decision-specific recipes such as
  `economics_macro/policy_path` and `rates_fixed_income/curve_levels` that assemble ordered,
  evidence-backed visual stories and can hand off a `DashboardSpec`.
- **Run envelope (spec `0070`, Approved, foundation implemented)** recording prompt, model,
  provider, tools, inputs, and replay class for every agentic run.
- **`adapters/llm_runtime/`** — a provider-neutral invocation contract with OpenAI, Anthropic, and
  local-model profiles that require "approved model profiles rather than hard-coded model names".
  It is documentation only: QuantSmith ships no live provider client and no gateway profile, and
  spec `0080` lists choosing a provider as an adopter decision.

### Constraints that shape this spec

1. **QuantSmith's insight layer is not yet safe for non-additive, point-in-time series.** `0008`
   aggregates only with `sum`, `count`, or `mean`, and `0080`'s level insight sums the
   window-aggregated values across dimension values. For a yield, that reports a window mean (or
   sum) as "the level"; for a curve broken down by tenor, it sums yields across tenors. `0081`'s
   additivity rules would prevent this, but applying them in `0080`'s output path is exactly open
   tasks T-021/T-022 — a gap spec `0093` itself flags. Charts that only plot per-period values
   are unaffected.
2. **QuantSmith's knowledge packs are not in its Python package.** `pyproject.toml` ships only
   `src/quantsmith` (plus `asian_nlp` fixtures); `load_catalog(root)` reads `knowledge/` from a
   repository checkout. Code and packs must come from the same pinned checkout.
3. **QuantMeridian has no user authentication.** IBAL's production gate
   (`IBAL_PRODUCTION_ENABLED` plus `IBAL_TRUSTED_ACCESS_BOUNDARY`) is the precedent for anything
   that spends money or touches sensitive state.
4. **QuantMeridian's charts never need numbers from outside.** A `ChartSpec`
   (`src/lib/charting/spec.ts`) is a list of series references plus range and transform; the
   resolver fetches data from Gold through `/api/chart/series` and keeps per-series provenance. An
   agent can propose a chart without supplying a single value.
5. **Gold is the only numeric source** (spec004 Data Policy; spec005 Explicit Non-Goals). Missing,
   stale, or unsupported data renders as unavailable with a reason, never as fallback values.

## Goals

- Let a user ask for analysis or a chart inside the module they are working in, queue several
  requests without waiting, and get results back in that module's thread — durable across reloads.
- Build the workflows on QuantSmith's existing data-analysis and visualization agents and
  runtimes rather than reimplementing them, executed outside QuantMeridian's Node process.
- Render every chart through QuantMeridian's own chart engine and provenance badges, with a
  one-step hand-off into the `MGC`/`MKC` chart studios.
- Guarantee that every number an agent result shows has been re-resolved against Gold by
  QuantMeridian; anything that cannot be is dropped or flagged, never shown as-is.
- Make LLM access configurable per module and workflow through named profiles covering direct
  providers, gateways, local servers, and a deterministic no-LLM mode — with no secret in any
  committed file and the provider and model visible on every answer.
- Make each job auditable and, where the path is deterministic, reproducible.
- Keep production off until access, cost, and data boundaries are approved.

## Non-Goals

- **No autonomous or scheduled agent runs.** Every job is started by a person in a module panel.
  Scheduled workflows (QuantSmith `0055`/`0060`) are a follow-up spec.
- **No publishing or delivery.** No `MPUB` queue insertion, alert delivery, export to external
  channels, or QuantSmith `0080` database write-back. The chat path has no side effects beyond
  its own job records.
- **No new data source.** spec004's Source Gate still applies. In particular,
  `morning_brief_writer`'s news APIs are not approved by this spec.
- **No trading, portfolio, optimization, or backtesting agents**, and no IBAL data sent to an LLM
  (spec005 non-goals, reaffirmed).
- **No analysis over simulated, uploaded, or confidential data.** Modules backed by SIM desk data
  or uploads (`SLAB`, `PB`, `COLL`, `CASH`, `IBAL`, …) and the Copilot's desk snapshot are out of
  scope for agent workflows in version one.
- **No LLM-executed code, SQL, or side-effecting tools.** Models return typed plans or typed
  claims only.
- **No QuantSmith code in the Node process.** No `pip install quantsmith`, no TypeScript
  reimplementation of QuantSmith semantics.
- **No authentication system.** Production stays disabled until a trusted access boundary that
  also supplies requester identity is approved (same posture as spec007).
- **No native cloud-IAM provider flows** (AWS Bedrock SigV4, Google Vertex service accounts, Azure
  Entra ID). Those providers are reachable in version one only through an OpenAI- or
  Anthropic-compatible gateway.
- **No token streaming, cross-module queue view, or job chaining** in version one.
- **No change to how existing modules resolve or display data**, and no replacement of the
  Copilot's deterministic keyword engine.

## Relationship To Existing Specs

- **spec005 (QuantSmith Integration Layer).** spec009 automates spec005's item 2 (agent-drafted
  narrative re-verified before display) in an attended form and delivers a narrow slice of item 4
  (agent-authored chart definitions rendered by `MGC`/`MKC`). Every spec005 non-goal holds:
  QuantSmith runs in its own process (a Python worker, as IBAL's service does for
  InventoryBallast), Node never imports it, and every number is re-resolved against Gold.
  spec009 adds a second sanctioned invocation mode beside spec005's external Claude Code/agent
  SDK session: a pinned QuantSmith checkout inside a QuantMeridian-hosted worker. A dated note in
  spec005 points here. spec005's open Phase 1 item (registering QuantMeridian as a QuantSmith
  downstream consumer) becomes companion item Q-5 below.
- **spec004 (`MPUB`).** spec009 applies spec004's Data Policy, Source Gate, and Trust And
  Citation Contract to every agent result. It does not touch `MPUB` workspaces or queues.
- **spec006 (material-change detector).** spec009 reuses its approved pattern for app-owned
  operational state: separate, non-`gold`-prefixed tables, optionally in the same Postgres
  instance as Gold.
- **spec007 (IBAL).** spec009 reuses its separate-Python-service, pinned-dependency, health,
  and production-gate patterns. spec007's RISK-009 names a queue/worker as a follow-up for large
  solves; spec009's queue is built for agent workflows only and does not change IBAL.

## Workflow Catalog (Version One)

| Workflow | Built on (QuantSmith) | LLM | Output | Readiness at the assessed commit |
| --- | --- | --- | --- | --- |
| `chart.build` | `nl_analytics` interpret → `validate_plan` → `authorize_plan` → execute; `data_visualization` form rule (`choose_chart`); `0081` chart conventions | Optional (interpreter only) | Time-series chart proposal (one or more series) rendered by QuantMeridian, plan echo, caveats. No numeric narrative. | Buildable now; uses only completed `0080` stages. Multi-series overlays are composed from per-series plans on the QuantMeridian side (companion item Q-7 would move this upstream). |
| `analysis.answer` | `nl_analytics` `answer()`: insights, grounded narrative, caveats, citations; `data_visualization` | Optional (interpreter, narrator) | Chart, insights, and narrative bound to verified claims | Blocked on companion items Q-1 and Q-2. |
| `story.build` | `visualization_packs` (`0093`) recipes, e.g. `economics_macro/policy_path`, `rates_fixed_income/curve_levels`; `data_storytelling` | None | Ordered sections: charts, captions, caveats, follow-up prompt | Chart-only sections buildable; insight-bearing sections blocked on Q-1 and Q-2; packs `draft` (Q-3). |
| `brief.draft` | `economists/macro_backdrop_summarizer` with `templates/docs/macro_backdrop_report.md` (the spec005 Phase 2 pilot) | Required (drafter) | Draft narrative bound to structured claims, plus a verification table | Later phase; needs the claim verifier and structured-claims prompt from earlier phases. |

Each workflow declares its readiness in the catalog. A workflow whose dependencies are not met is
not offered and cannot be queued.

## LLM Access Model

LLM access is configured by **profile**, never in code. A profile names an API style, a model, an
optional base URL (for gateways and local servers), credential and header *references* (names of
environment variables, never values), limits, the data classes it may receive, and the uses it
may serve (`copilot`, `interpreter`, `narrator`, `drafter`). Two API styles plus a no-LLM mode
cover the required range:

| Example profile | API style | Endpoint | Credential reference | Covers |
| --- | --- | --- | --- | --- |
| `anthropic-direct` | `anthropic_messages` | Provider default | `ANTHROPIC_API_KEY` | Today's Copilot behavior |
| `openai-direct` | `openai_chat_completions` | Provider default | `OPENAI_API_KEY` | OpenAI |
| `gateway-openai` | `openai_chat_completions` | `LLM_GATEWAY_BASE_URL` | `LLM_GATEWAY_API_KEY` (+ optional header refs) | Any OpenAI-compatible gateway (for example LiteLLM, OpenRouter, a corporate proxy), and through it Bedrock, Vertex, Azure, or others |
| `gateway-anthropic` | `anthropic_messages` | `ANTHROPIC_GATEWAY_BASE_URL` | `ANTHROPIC_GATEWAY_API_KEY` | Anthropic-compatible proxies |
| `local-openai` | `openai_chat_completions` | `LOCAL_LLM_BASE_URL` | Optional | Local servers (for example Ollama, vLLM, llama.cpp) |
| `deterministic` | `none` | — | — | Keyword interpreter and template narrative; always available |

Profile selection follows a fixed precedence: the user's choice (where the module allows one),
then the module default, then the global default. A workflow does not pick a profile; its LLM
requirement (none, optional, required), uses, and data classes decide which profiles qualify. An
unusable profile fails closed with a stable code; a fallback profile is used only when the
profile declares one, and the result says so. Both runtimes — Node for the Copilot
and Python for the worker — implement the same profile schema and pass the same conformance
fixtures.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| REQ-001 | A module shall show the agent panel only when enabled for that module in a committed agent-workflow configuration; requests for a module that is not enabled shall be rejected. The pilot module is `MGC`; `CURV` and `INFL` follow by configuration. | must |
| REQ-002 | Each submitted message shall create exactly one durable job (idempotent on a client-supplied key) bound to module, thread, requester, workflow, and a module-context snapshot. A job shall be accepted while the worker is offline and shown as queued. | must |
| REQ-003 | Users shall be able to queue multiple messages without waiting. Jobs in a thread shall run in submission order; each job shall show its lifecycle state (`queued`, `running`, `verifying`, `succeeded`, `needs_clarification`, `failed`, `cancelled`, `expired`); queued or running jobs shall be cancellable, failed jobs retryable, and a thread shall be restored after a page reload. | must |
| REQ-004 | The queue shall enforce per-requester queued and running limits, global worker concurrency, per-workflow timeouts, a maximum attempt count, and a queue time-to-live, each with a stable code. A job held by a lost worker shall be re-queued or failed when its lease expires, never left running. | must |
| REQ-005 | The module-context snapshot shall contain only fields allowlisted for that module (for example `MGC`'s series references, range, and transform), stay within a size limit, contain no data values, and be shown to the user as sent. | must |
| REQ-006 | An ambiguous request shall end in a clarification, never a guess. The user's reply shall create a new job linked to the clarified one. | must |
| REQ-007 | A versioned workflow catalog shall declare each workflow's ID, version, QuantSmith agents and specs it builds on, input schema, output blocks, LLM requirement, allowed modules, data classes, and readiness. Only ready workflows shall be offered or accepted. | must |
| REQ-008 | Workflows shall execute only in a separate Python worker whose QuantSmith code and knowledge packs come from one checkout of the pinned commit recorded in `QUANTSMITH_PIN.md`. The worker shall refuse to claim jobs when the installed commit differs from the pin. No Node code shall import or execute QuantSmith. | must |
| REQ-009 | QuantMeridian shall generate a versioned metric registry, conforming to QuantSmith `0008` and mapped to `0081` domain packs, from its series catalog: each metric declares unit, additivity class, grain, source, and domain tags. Plans may reference registry metrics only, and a catalog change without regeneration shall fail CI. | must |
| REQ-010 | The worker shall obtain every data row through QuantMeridian's own Gold-backed series read path. A series that resolves with any provenance other than Gold (`ERR`, `SIM`, `SNAPSHOT`, unavailable) shall produce a typed data-unavailable result with no chart and no number. | must |
| REQ-011 | `chart.build` shall turn a chart request into one governed plan per requested series and a chart proposal in QuantMeridian's chart format, using the `data_visualization` form rule for each plan. Version one supports time-series line and area charts of one or more registry series; an overlay requires a shared unit and grain or an explicit normalizing transform, otherwise the request ends in a clarification. Any other form (KPI, bar, table, scatter) returns a typed `unsupported_chart` result carrying no numbers. `chart.build` shall emit no numeric narrative. | must |
| REQ-012 | `analysis.answer` shall be queueable only when companion items Q-1 and Q-2 are met at the pinned commit. Its insights and narrative shall follow the applicable `0081` pack's units, additivity, suppressions, and conventions (for example, rate changes in basis points; no contributor insight on a non-additive metric). | must |
| REQ-013 | `story.build` shall select a `0093` recipe from the module's domains and the request's intent and return its sections in recipe order. Sections that carry insights are subject to REQ-012's gate. Draft packs shall carry a visible unreviewed-pack caveat. | should |
| REQ-014 | `brief.draft` shall require the LLM to return narrative text whose numbers are placeholders bound to structured claims. A draft containing a literal number not bound to a claim shall be rejected and replaced by the deterministic template narrative, flagged. Drafts are never published or forwarded automatically. | should |
| REQ-015 | Every number in a result shall be carried as a typed claim, and every narrative or insight shall reference claims rather than embed numbers. A QuantMeridian-side verifier shall re-resolve each claim against Gold before the result becomes visible and assign `VERIFIED`, `DROPPED`, or `FLAGGED`. The worker shall have no way to set a verdict. | must |
| REQ-016 | The panel shall render only verified values. A dropped claim is replaced by a visible notice, a flagged claim shows its reason, and each result shows a verification summary. | must |
| REQ-017 | Each result shall disclose, per spec004's Trust And Citation Contract: workflow and version, interpreter mode, LLM profile and provider and model when used, QuantSmith commit, plan echo, data as-of dates, series IDs, transforms, caveats (including pack caveats), and pack review status. | must |
| REQ-018 | Chart proposals shall be validated against the metric registry and rendered by QuantMeridian's chart engine with per-series provenance. "Open in Chart Studio" shall open `MGC` or `MKC` with the same series, range, transform, and chart type, re-resolving the data itself. | must |
| REQ-019 | LLM access shall be configured through a committed profile registry that contains no secret values: each profile declares API style (`anthropic_messages`, `openai_chat_completions`, or `none`), model, an optional base-URL reference, a credential reference, optional header references, limits, allowed data classes, and allowed uses. | must |
| REQ-020 | Profile resolution shall follow the user's choice (where the module allows one) → module default → global default, and accept only profiles that satisfy the workflow's LLM requirement, uses, and data classes. An unknown, disallowed, or credential-less profile shall fail closed with a stable code before any provider call. A fallback profile shall be used only if declared, and the result shall show it. | must |
| REQ-021 | Node and the worker shall implement the same profile schema and pass shared conformance fixtures. Any OpenAI-compatible gateway or local server and any Anthropic-compatible gateway shall work through configuration alone. | must |
| REQ-022 | The Copilot shall resolve its LLM through the profile registry. With the default profile it shall send the same model, prompt, and limits as today and keep its deterministic fallback; its response shall name the profile and model for its badge. | must |
| REQ-023 | Data Ops shall show each profile's dry-run validation (configuration, credential presence, data-class and use constraints) and, on request, a live probe. No secret value or credential-bearing URL shall be returned. | should |
| REQ-024 | LLM output shall be accepted only as a typed plan, clarification, or claim set. The worker shall never execute model-produced code, SQL, or tool calls. An invalid output yields a typed failure, optionally retried once on a declared fallback profile. | must |
| REQ-025 | Production shall be off by default and require an explicit enable flag plus a trusted access boundary reference (mirroring IBAL). A kill switch shall stop new jobs and worker claims without a redeploy. Jobs shall be visible only to their requester. | must |
| REQ-026 | The worker shall enforce per-job token caps and per-profile daily token budgets from usage metadata, fail with a stable code when a budget would be exceeded, and record usage on every job. | must |
| REQ-027 | Data Ops shall report worker heartbeat and readiness, queue depth, oldest-queued age, outcome counts by category, latency percentiles, verification drop and flag rates, profile state, and budget use — metadata only. | should |
| REQ-028 | Each job shall keep an audit record — pins, workflow version, prompt IDs and hashes, profile/provider/model, canonical plan and hash, series references with as-of dates and content hash, result, verification, timings, usage — plus a QuantSmith `0070` envelope. Question text and LLM transcripts shall be purged after a configured retention window. | must |
| REQ-029 | Version one shall accept only Gold-backed public series. Configuration shall reject enabling the panel on modules backed by simulated, uploaded, or confidential data, and a profile shall never receive a data class it does not allow. | must |

## Non-Functional Requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-001 | Numeric integrity | Zero unverified numbers rendered: enforced by construction (claims and placeholders) and by tests that scan rendered results. |
| NFR-002 | Reproducibility | A deterministic job (no LLM) produces a byte-identical result payload for the same question, context, registry version, data content hash, and pins. An LLM job records enough to replay from fixtures and is labeled non-reproducible otherwise. |
| NFR-003 | Responsiveness | Job creation acknowledged in ≤ 300 ms p95. A deterministic `chart.build` job completes claim-to-result in ≤ 5 s p95 and verification in ≤ 1 s p95 for ≤ 50 claims, on the documented reference runtime. LLM jobs are bounded by per-workflow timeouts; their latency is measured and reported. |
| NFR-004 | Reliability | No job is lost or duplicated across worker crash, restart, or duplicate submission, and at most one attempt's result is ever recorded (leases, attempt fencing, idempotency keys). A stalled job is detected within one lease period. |
| NFR-005 | Security and privacy | No secret in the repository, configuration, logs, payloads, or Data Ops output. Logs are metadata-only. Question text and context are untrusted input. Only declared data classes reach a provider. |
| NFR-006 | Provider neutrality | Provider-specific code exists only in the profile client layer on each side. Switching providers is a configuration change verified by the conformance suite. |
| NFR-007 | Failure semantics | Worker offline, limits, budget, profile misconfiguration, provider error, timeout, invalid model output, clarification, unavailable data, verification failure, cancellation, and expiry are distinct, visible states — never a success and never fallback data. |
| NFR-008 | Usability and accessibility | The panel supports keyboard operation, visible focus, labeled controls, non-color status cues, and readable layouts at 375×812, 768×1024, and 1440×900. |
| NFR-009 | Contract compatibility | Job, result, catalog, profile, and registry contracts carry `schema_version`. Breaking changes require a new major version; QuantMeridian refuses a payload it does not understand and shows an incompatible-result state. |
| NFR-010 | Observability and testability | Correlation IDs span browser, API, queue, worker, and provider call. Deterministic fixtures, worker tests, Node tests, conformance fixtures, and an end-to-end test with a stub LLM run in CI. |

## Acceptance Criteria

| ID | Given / When / Then | Covers |
| --- | --- | --- |
| AC-001 | Given the panel enabled for `MGC` and not for `INFL`, when each module loads, then only `MGC` shows it, and a job request naming `INFL` is rejected with `AGENT_MODULE_DISABLED`. | REQ-001 |
| AC-002 | Given the worker stopped, when a message is sent, then a `queued` job is created and labeled "worker offline"; re-sending with the same idempotency key returns the same job. | REQ-002, NFR-004 |
| AC-003 | Given three messages sent in quick succession, when the worker runs, then they execute in order with each transition visible; a queued job can be cancelled before it starts; a failed job can be retried as a new attempt linked to the original; reloading restores the thread. | REQ-003 |
| AC-004 | Given the requester's queued limit reached, when another message is sent, then it is rejected with `AGENT_QUEUE_LIMIT`. Given a worker killed mid-job, when its lease expires, then the job is re-queued or, after the maximum attempts, failed with `WORKER_LOST`; it never stays `running`. | REQ-004, NFR-004 |
| AC-005 | Given a context containing a non-allowlisted field or a data value, when a job is created, then the server rejects it with `AGENT_CONTEXT_INVALID`, and an accepted job's panel shows exactly the context that was sent. | REQ-005, NFR-005 |
| AC-006 | Given "chart rates" in `MGC`, when interpreted, then the job ends `needs_clarification` with a question and no chart; the user's reply creates a job linked to it. | REQ-006 |
| AC-007 | Given a workflow whose readiness is `blocked`, when a module panel loads, then the workflow is not offered, and a direct request is rejected with `WORKFLOW_NOT_READY` naming the unmet dependency. | REQ-007 |
| AC-008 | Given a worker installed from a QuantSmith commit other than the pin, when it starts, then readiness fails with `QUANTSMITH_PIN_MISMATCH` and it claims nothing; a source scan finds no QuantSmith import or subprocess call in Node code. | REQ-008 |
| AC-009 | Given the series catalog, when the registry is generated, then every metric declares unit, additivity, grain, source, and domain tags; a catalog change without regeneration fails CI; a plan naming a series outside the registry is rejected before execution. | REQ-009 |
| AC-010 | Given a series whose read path returns `ERR`, `SIM`, or `SNAPSHOT`, when a workflow needs it, then the job returns `data_unavailable` naming the series and reason, with no chart and no number. | REQ-010, NFR-007 |
| AC-011 | Given `MGC` with a `5Y` range in its context, when the user asks "chart the 2-year and 10-year Treasury yields" and `chart.build` runs with the keyword interpreter, then the proposal overlays `DGS2` and `DGS10` over `5Y`, matching the plan echo; it renders through the chart engine with per-series provenance; it contains no numeric narrative. A request overlaying a percent-unit rate with an index-unit series and no normalizing transform ends in a clarification; a request whose form is a KPI or breakdown returns `unsupported_chart` with no numbers. | REQ-011, REQ-018 |
| AC-012 | Given Q-1 or Q-2 unmet at the pin, when `analysis.answer` is requested, then it is rejected with `WORKFLOW_NOT_READY`. Given both met, when asked for the 10-year yield's level and its change against a one-month comparison window, then the level equals the latest Gold observation (not a window mean), the change is in basis points, and no contributor or concentration insight appears. | REQ-012, REQ-007 |
| AC-013 | Given a curve-levels request at one as-of date in `CURV` with Q-1/Q-2 met, when `story.build` runs, then sections follow the `curve_levels` recipe order, tenors are ordered by maturity, no insight sums yields across tenors, and the unreviewed-pack caveat shows while the pack is `draft`. | REQ-013 |
| AC-014 | Given a `brief.draft` model output containing a literal number not bound to a claim, when post-processed, then the narrative is rejected and replaced by the template narrative flagged `ungrounded_text`. Given claim-bound output, every displayed number comes from a verified claim. | REQ-014, NFR-001 |
| AC-015 | Given claims that are correct, wrong in value, on an unknown series, and on a date without an observation, when verified, then the verdicts are `VERIFIED`, `FLAGGED` (Gold value shown), `DROPPED`, and `DROPPED`; any verdict field written by the worker is ignored. | REQ-015 |
| AC-016 | Given a result with dropped and flagged claims, when rendered, then dropped numbers are absent with a notice, flagged numbers show their reason, the summary shows counts, and a DOM scan of fixture results finds no unverified number. | REQ-016, NFR-001 |
| AC-017 | Given any succeeded result, when rendered, then workflow and version, interpreter mode, profile/provider/model (if any), QuantSmith commit, plan echo, as-of dates, series IDs, transforms, caveats, and pack review status are visible or one interaction away. | REQ-017 |
| AC-018 | Given a chart proposal, when "Open in Chart Studio" is used, then the studio opens with the same series, range, transform, and chart type and resolves the data itself; a proposal with a series outside the registry is rejected before rendering. | REQ-018 |
| AC-019 | Given the committed profile registry, when validated and secret-scanned, then it passes its schema, contains only environment variable names, and includes `anthropic-direct`, `openai-direct`, `gateway-openai`, `gateway-anthropic`, `local-openai`, and `deterministic`. | REQ-019, NFR-005 |
| AC-020 | Given a user choice, a module default, and a global default, when profiles resolve, then precedence holds and a profile failing the workflow's requirement is never selected. Given a profile with a missing credential or a disallowed use, when requested, then the job fails with `LLM_PROFILE_UNAVAILABLE` or `LLM_PROFILE_NOT_ALLOWED` and no provider call is made; a fallback runs only when declared and is shown. | REQ-020, NFR-007 |
| AC-021 | Given the shared conformance fixtures, when Node and the worker resolve each profile, then endpoint, auth header, extra headers, model, and limits match. Given `gateway-openai` pointed at a stub OpenAI-compatible server and `gateway-anthropic` at a stub Anthropic-compatible server, when called, then both succeed with no code change. | REQ-021, NFR-006 |
| AC-022 | Given only `ANTHROPIC_API_KEY` set, when the Copilot answers, then its request matches today's model, system prompt, and token limit, and the response carries `source: "AI"` plus profile and model; with no credential it returns `source: "LOCAL"` as today. | REQ-022 |
| AC-023 | Given valid, credential-less, and malformed profiles, when Data Ops loads, then each shows a distinct dry-run state, and the response contains no secret or credential-bearing URL. | REQ-023, NFR-005 |
| AC-024 | Given stub interpreter outputs of SQL text, a plan naming an unregistered metric, and malformed JSON, when processed, then each yields a typed failure or clarification and nothing executes; a valid plan executes only after `validate_plan` and `authorize_plan`. | REQ-024, NFR-005 |
| AC-025 | Given a production runtime without the enable flag or boundary reference, when the app loads, then no panel renders and the API returns `AGENT_PRODUCTION_DISABLED` or `AGENT_TRUSTED_BOUNDARY_MISSING`. Setting the kill switch stops job creation and worker claims within one poll interval without a redeploy. Requester A cannot read requester B's jobs. | REQ-025 |
| AC-026 | Given a profile's daily budget nearly spent, when a job would exceed it, then the job fails with `LLM_BUDGET_EXCEEDED` before the call or stops at its per-job cap; usage is recorded on every job. | REQ-026 |
| AC-027 | Given healthy, stalled-worker, backlog, and misconfigured-profile states, when Data Ops loads, then each is distinct and shows queue depth, oldest-queued age, outcome counts, latency, verification rates, and budget use, with no question text. | REQ-027, NFR-010 |
| AC-028 | Given a completed job, when its audit record is exported, then it contains every REQ-028 field; a deterministic job replayed from the record yields an identical result payload; after the retention window the question text is purged and metadata remains. | REQ-028, NFR-002 |
| AC-029 | Given configuration enabling the panel on `SLAB`, `PB`, `COLL`, `CASH`, or `IBAL`, when validated, then it is rejected; a profile without the `public_market_data` class cannot serve any workflow. | REQ-029 |
| AC-030 | Given the reference runtime and fixture database, when the benchmark suite runs, then job creation, deterministic `chart.build`, and verification meet NFR-003, and the runtime profile is recorded. | NFR-003 |
| AC-031 | Given desktop, tablet, and mobile viewports plus keyboard-only use, when queueing, cancelling, retrying, clarifying, and opening a chart in the studio, then every action and state is reachable, labeled, non-overlapping, and not color-only. | NFR-008 |
| AC-032 | Given a result payload with an unknown major `schema_version`, when the panel loads it, then it shows an incompatible-result state and does not render its content. | NFR-009 |
| AC-033 | Given CI from a clean checkout, when it runs, then typecheck, unit tests, build, worker tests, conformance fixtures, and the end-to-end panel test (real worker, stub LLM, fixture Gold database) pass. | NFR-010 |

## Data & Dependencies

- **Gold** (`fred-bronze-to-gold-pipeline`) remains the only source of numbers. The worker reads
  it only through QuantMeridian's series read path; the verifier reads it through `GoldStore`.
- **QuantMeridian** owns module enablement, the panel, the job API, the queue tables, the
  verifier, chart rendering and hand-off, the profile registry and its clients, the metric
  registry, the Copilot, and Data Ops.
- **QuantSmith** (pinned) owns plan, interpretation, validation, authorization, execution
  semantics, chart choice, insights, grounding, the run envelope, the agent contracts, and the
  domain and visualization packs. QuantMeridian supplies only adopter-side pieces those contracts
  leave open: the reader, the metric registry, the LLM interpreter/narrator/drafter
  implementations, and profile clients.
- **LLM providers** receive the user's question, the module-context snapshot (no data values),
  the metric registry vocabulary, and — for narrator and drafter uses only — public Gold values
  and computed insights. Nothing simulated, uploaded, or confidential.
- **QuantSmith companion items** (QuantSmith-repository work, not done in QuantMeridian):
  - **Q-1** — complete `0080` T-021 and T-022: apply `0081` packs in the answer path (units,
    additivity, insight suppression, conventions, term conflicts) and add the unreviewed-pack
    caveat. Blocks `analysis.answer` and insight-bearing `story.build` sections.
  - **Q-2** — point-in-time level semantics for non-additive and semi-additive metrics: the
    level and change insights use the latest observation in the window, and nothing sums a
    non-additive metric across dimension values. May land as part of Q-1; spec009 requires the
    behavior, proven by golden cases. Blocks the same workflows as Q-1.
  - **Q-3** — review the `economics_macro` and `rates_fixed_income` analytics and visualization
    packs, or accept draft packs with a visible caveat outside production. Production requires
    reviewed packs (decision D-5).
  - **Q-4** (optional) — let QuantSmith's `quantsmith-version-check.sh` recognize PEP 508
    direct-reference (git commit) pins. Until then QuantMeridian's own pin check covers the worker.
  - **Q-5** (optional) — register QuantMeridian as a downstream repository for `0047`
    release notifications (spec005's open Phase 1 item).
  - **Q-6** (optional) — add a gateway profile document to `adapters/llm_runtime/`.
  - **Q-7** (optional) — a multi-series time-series form in `0080` (one plan, several metrics or
    one dimension over time, rendered as a multi-line chart). `0080`'s keyword interpreter
    currently returns a clarification when two metrics match, and `choose_chart` renders one
    dimension as a bar over the whole window, so spec009 composes overlays from per-series plans
    until this exists.
- Exact paths, schemas, the claim vocabulary, and environment variables are in `PLAN.md`.

## Risks

| ID | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| RISK-001 | A fluent agent result reads as more verified than it is (borrowed authority). | Users act on an unverified number. | Claims and placeholders, a verifier the worker cannot bypass, verdict badges, and a verification summary on every result. |
| RISK-002 | QuantSmith's insight layer misstates non-additive series (window means as levels, yields summed across tenors, percent changes for rates). | Plausible but wrong analysis. | `analysis.answer` and insight-bearing story sections are blocked until Q-1/Q-2 pass golden cases; `chart.build` ships without insights. |
| RISK-003 | Draft (unreviewed) packs encode a wrong convention. | Misleading captions or caveats. | Visible unreviewed-pack caveat; production requires reviewed packs (D-5). |
| RISK-004 | Public endpoints run up LLM cost or are abused. | Cost spike, provider suspension. | Production off by default, trusted boundary, per-requester limits, per-job caps, daily budgets, kill switch. |
| RISK-005 | A secret leaks through configuration, logs, payloads, or Data Ops. | Credential compromise. | Environment references only, schema-level secret rejection, metadata-only logs, redaction tests, secret scan in CI. |
| RISK-006 | Prompt injection in a question or context steers the model to widen access or invent numbers. | Unauthorized reads or fabricated content. | Typed plans over registry metrics only, `validate_plan` and `authorize_plan`, no tools, context allowlist, claim verification. |
| RISK-007 | The worker's QuantSmith code, its knowledge packs, and the pin record drift apart. | Behavior differs from what was reviewed. | One checkout for code and packs, PEP 610 commit check at startup, readiness failure on mismatch, pin re-review task. |
| RISK-008 | The Node and Python profile clients diverge. | A profile works in one runtime but not the other. | One JSON Schema, shared conformance fixtures run in both CIs. |
| RISK-009 | Queue reliability on serverless hosting. | Lost or duplicated jobs. | Durable database queue, worker hosted outside Vercel, leases, idempotency keys, and an append-only event log. |
| RISK-010 | Data reaches a provider without approval. | Policy breach. | Data classes on profiles and workflows, enforced before every call; version one limited to public Gold series. |
| RISK-011 | Scope creep toward autonomous publishing or a merged system. | Unreviewed output leaves the terminal. | Attended jobs only, no delivery or write-back, spec005 non-goals reaffirmed, follow-ups require new specs. |
| RISK-012 | The worker's reader and the verifier resolve a series differently. | Correct claims flagged or wrong claims verified. | One server-side series resolution function used by both the series route and the verifier; transforms recomputed from levels with `src/lib/charting/transforms.ts`. Finding: `/api/chart/series` and `/api/econ/series` currently resolve non-`lin` units differently, so version-one claims use levels only. |
| RISK-013 | Gateways differ in model naming, headers, error shapes, or rate limiting. | Profiles fail in surprising ways. | Profiles name the model as the gateway exposes it, declare extra header references, and get a dry-run plus an optional live probe; errors normalize to the `llm_runtime` output contract. |
| RISK-014 | spec009 depends on QuantSmith specs still in Draft (`0080`, `0081`). | Contract churn breaks the worker. | Pinned commit, re-review before every pin bump, contract tests in the worker, readiness gating per workflow. |

## Decisions Before Implementation

| ID | Decision | Recommendation |
| --- | --- | --- |
| D-1 | Execution boundary | A separate Python worker in this repository (as IBAL's service), installing QuantSmith from one checkout of the pinned commit. |
| D-2 | Queue store | QuantMeridian-owned `agent_*` tables behind an explicit `AGENT_QUEUE_DB_URL` (which may point at the Gold Postgres instance, per spec006). No implicit fallback to `MACRO_DB_URL`. |
| D-3 | Pilot module | `MGC`; then `CURV` and `INFL` by configuration after the pilot. |
| D-4 | Default LLM profile | `anthropic-direct`, seeded with the Copilot's current model so migration changes nothing; `deterministic` whenever no credential is configured. |
| D-5 | Draft packs | Allowed locally and in protected staging with a visible caveat; production requires reviewed packs (Q-3). |
| D-6 | Retention | Question text and LLM transcripts purged after 30 days; job metadata and verification kept for 180 days. |
| D-7 | Production | Off. Same gates as IBAL plus an identity-supplying trusted boundary, a hosting decision for the worker, and approved budgets. |
| D-8 | Copilot | Migrates onto profiles in the first phase; it does not get the agent panel in version one because its data is simulated. |
| D-9 | Gateways | OpenAI-compatible and Anthropic-compatible gateways by base URL and header references; native cloud-IAM flows are out of scope. |

## Open Questions

- Should threads follow a person across browsers and devices? That needs requester identity
  beyond a browser session, which version one does not have.
- Should a verified chart or result be offered to `MPUB`'s Chart Queue as a `Candidate`? Deferred
  to an `MPUB` spec; spec009 adds no `MPUB` path.
- Which follow-up comes first after version one: scheduled workflows (`0055`), a cross-module
  queue view, streaming, or job chaining?
- Should an `analysis.eda` workflow follow, built on QuantSmith's `eda-specialist-agent` contract
  and reading the lead-lag, correlation, and structural-break facts Gold already publishes
  (`src/lib/server/goldEda.ts`)? It would need claim types for those statistics.

## Exceptions

None. spec009 adds a documented invocation mode to spec005 rather than breaking one of its rules;
see Relationship To Existing Specs.

## Related Documents

- `docs/specs/spec009/PLAN.md`, `docs/specs/spec009/TASKS.md`
- `docs/specs/spec005/SPEC.md`, `docs/specs/spec005/QUANTSMITH_PIN.md`,
  `docs/specs/spec005/PHASE2_PILOT_VERIFICATION.md`
- `docs/specs/spec004/SPEC.md` (Data Policy, Source Gate, Trust And Citation Contract)
- `docs/specs/spec006/SPEC.md`, `src/lib/server/detectorStateStore.ts` (app-owned state pattern)
- `docs/specs/spec007/SPEC.md`, `src/lib/server/inventoryOptimizerProxy.ts` (service and gate
  pattern)
- `src/app/api/copilot/route.ts`, `src/app/copilot/page.tsx`, `src/lib/server/copilotContext.ts`
- `src/lib/charting/spec.ts`, `src/lib/charting/resolver.ts`, `src/app/api/chart/series/route.ts`
- QuantSmith (pinned): `specs/0080-nl-analytics-insights/`, `specs/0081-analytics-domain-packs/`,
  `specs/0093-visualization-packs/`, `specs/0070-prompt-context-harness-foundation/`,
  `specs/0008-metrics-semantic-layer/`, `specs/0047-downstream-contract/`,
  `agents/analytics/README.md`, `agents/analytics/data_visualization/`,
  `agents/analytics/nl_analytics/`, `agents/economists/macro_backdrop_summarizer/`,
  `adapters/llm_runtime/`, `knowledge/analytics_packs/`, `knowledge/visualization_packs/`
