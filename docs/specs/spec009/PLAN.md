# Plan: Module Agent Workflows

- **Spec:** spec009-module-agent-workflows (`SPEC.md`)
- **Status:** Draft — pending owner review
- **Author:** Joshua Lutkemuller, CFA
- **Last updated:** 2026-10-06

> HOW. Written for the engineer implementing spec009 in QuantMeridian. QuantSmith stays the
> source of truth for analysis semantics; Gold stays the only source of numbers.

## Approach

Add an agent panel to enabled modules, a small job API in the existing route layer, a durable
queue in QuantMeridian-owned tables, and a Python worker that runs QuantSmith workflows from a
pinned checkout. The worker reads data only through QuantMeridian's own series read path and
writes results as typed claims and chart references. QuantMeridian verifies every claim against
Gold before the panel shows it, and draws every chart with its own engine.

```text
Module page (MGC first)                          QuantMeridian Node / Vercel route layer
  AgentPanel ── POST /api/agent/jobs ─────────►  jobs route ── insert ──►  agent_job (queued)
     │  polls GET /api/agent/jobs?thread=…            │                        │
     │                                                │                        │ claim (thread lock,
     │                                   verifier ◄───┘ (verifying → succeeded) │  lease, fencing)
     │                                   GoldStore re-resolution                ▼
     │                                                         services/agent_worker (Python)
     │                                                           ├─ QuantSmith @ pin (code + packs)
     │                                                           ├─ workflow runners
     │                                                           ├─ reader ─► GET /api/chart/series
     │                                                           └─ LLM profile clients ─► providers /
     │                                                                                     gateways
     └── renders verified blocks; charts drawn by the chart engine from series references
```

Five invariants hold everywhere:

1. The browser talks only to `/api/agent/*`. It never sees a provider credential, a gateway URL,
   or the worker.
2. Node owns job creation, the queue schema, verification, and presentation contracts. Node never
   imports or runs QuantSmith.
3. The worker owns execution. It never reads Gold directly and never writes a verdict.
4. Numbers travel as claims; text refers to claims by placeholder.
5. Charts travel as series references; QuantMeridian resolves and draws the data.

## Baseline And Ownership

### QuantMeridian baseline

- Repository `thatquantguy44/QuantMeridian`, assessed `origin/main`
  `d9cb653d5f21f867146b5021ffc018f9c4296dc5` (2026-09-23).
- Vite 5, React 18, React Router 6, Tailwind. API: Web-standard `Request → Response` modules
  discovered from `src/app/api/**/route.ts` by `src/server/registry.ts`. Deploy: Vercel
  (`npm run build:vercel`, `vercel.json`) or a Node host (`docs/deployment/DEPLOY.md`, Option A).
- Modules: `src/lib/nav.ts` and `settings/modules.config.json` (`isModuleEnabled`). Provenance:
  `src/lib/provenance.ts` (`DB`, `ERR`, `SIM`, `SNAPSHOT`, …).
- Charting: `ChartSpec` / `SeriesRef` (`src/lib/charting/spec.ts`), `useChartSeries`
  (`src/lib/charting/resolver.ts`) over `/api/chart/series`, `ChartTemplate`
  (`src/lib/charting/templates.ts`), `ChartStudio.applyTemplate`
  (`src/components/charting/ChartStudio.tsx`). `encodeSpec`/`decodeSpec` exist, but no studio
  reads a chart from the URL yet.
- Gold: `src/lib/server/goldStore.ts`. App-owned state precedent:
  `src/lib/server/detectorStateStore.ts` (`mpub_detector_state`).
- Copilot: `src/app/api/copilot/route.ts` (`@anthropic-ai/sdk`, `model: "claude-opus-4-8"`,
  `max_tokens: 1500`, `source: "AI" | "LOCAL"`).
- Python service precedent: `services/inventory_optimizer_api` (Python ≥ 3.11, FastAPI, pinned
  git dependency, Dockerfile, capability manifest). Production gate precedent:
  `src/lib/server/inventoryOptimizerProxy.ts` (`IBAL_PRODUCTION_ENABLED`,
  `IBAL_TRUSTED_ACCESS_BOUNDARY`).
- CI (`.github/workflows/ci.yml`): typecheck, `npm test` (Vitest), build, Playwright smoke. There
  is no Python job today.

### QuantSmith baseline

- Repository `thatquantguy44/QuantSmith`, assessed `main`
  `0134d403d5a336ce20e7abd7fb7a0935d7917114` (2026-10-06). Package `quantsmith` `0.1.0`, Python
  ≥ 3.10, depends on `numpy`. No release tags.
- Runtime used (all under `src/quantsmith/`):
  - `pipelines/metrics_semantic_layer.py` — `SemanticLayer`, `MetricDefinition`, `Fact`
    (aggregations `sum`, `count`, `mean`, plus ratio metrics).
  - `nl_analytics/plan.py` — `QueryPlan`, `TimeWindow` (grains `day`, `week`, `month`,
    `quarter`, `year`; integer periods), `Clarification`, `validate_plan`, `describe_plan`.
  - `nl_analytics/interpret.py` — `Interpreter` protocol, `InterpretContext`,
    `KeywordInterpreter`, `register_interpreter`.
  - `nl_analytics/authorize.py` — `AccessPolicy`, `authorize_plan`.
  - `nl_analytics/execute.py` — `Reader = Callable[[QueryPlan], Sequence[Fact]]`, `execute`,
    `Result`.
  - `nl_analytics/chart.py` — `choose_chart` (scatter → table → bar → line → kpi precedence),
    `to_vega_lite`, `to_markdown_table`.
  - `nl_analytics/insights.py`, `narrate.py` (`ground`, `default_caveats`), `respond.py`
    (`answer`, `AnswerContext`, `ChatResponse`), `envelope.py` (`0070` evidence).
  - `visualization_packs/` — `load_catalog`, `Catalog.select`, `collect_evidence`,
    `build_story`, `render_json`, `dashboard_handoff`, and the evidence-bound `Claim`,
    `bind_claim`, `validate_claim`.
- Repository content used: `knowledge/analytics_packs/*.json`,
  `knowledge/visualization_packs/*.json`, `agents/analytics/{nl_analytics,data_visualization,
  data_storytelling}/`, `agents/economists/macro_backdrop_summarizer/`,
  `templates/docs/macro_backdrop_report.md`, `adapters/llm_runtime/adapter_contract.md`.
- Known state: `0080` T-019/T-021/T-022 open; analytics and visualization packs `draft`;
  `knowledge/` and `agents/` are not in the wheel.

### Pins

There is one QuantSmith pin for this repository: `docs/specs/spec005/QUANTSMITH_PIN.md`. T-001
re-reviews QuantSmith at the commit chosen for implementation, updates that record (adding
spec009's files to "Reviewed for"), and writes the same commit to
`services/agent_worker/quantsmith.lock`. `scripts/check-quantsmith-pin.sh` fails when the two
disagree. Never pin a branch.

## Architecture & Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Agent panel | `src/features/agent-panel/` | Thread, composer, job cards, result blocks, disclosure, polling |
| Agent API | `src/app/api/agent/**/route.ts`, `src/lib/server/agent/` | Config, gate, identity, job lifecycle, verification, health |
| Profile layer (Node) | `src/lib/server/llm/` | Profile registry, resolution, provider clients for the Copilot and Data Ops |
| Queue store | `agent_*` tables in `AGENT_QUEUE_DB_URL` | Durable jobs, events, heartbeats, usage, control flags, artifacts |
| Worker | `services/agent_worker/` | Readiness, claim loop, workflow runners, reader, LLM clients, budgets, envelopes |
| Shared contracts | `contracts/agent/` | JSON Schemas, generated metric registry, conformance fixtures |
| Configuration | `settings/agent_workflows.json`, `settings/llm_profiles.json`, `settings/agent_metric_synonyms.json` | Committed, secret-free configuration |

### Target file layout

```text
contracts/agent/
  README.md
  llm-profiles.schema.json
  agent-workflows.schema.json         # module enablement + workflow catalog
  job.schema.json                     # create/read envelopes and error body
  result.schema.json                  # blocks, claims, disclosure
  verification.schema.json
  metric-registry.schema.json
  generated/metric_registry.json      # generated, committed, drift-checked
  fixtures/llm-profiles/*.json        # conformance: profile + env → resolved call
  fixtures/results/*.json             # verifier and renderer fixtures

settings/
  agent_workflows.json
  llm_profiles.json
  agent_metric_synonyms.json          # curated phrases ("10-year" → DGS10)

scripts/
  export-agent-metric-registry.ts     # FRED_CATALOG + curated mapping → registry JSON
  agent-control.mjs                   # pause | resume | status (queue DB control row)
  check-quantsmith-pin.sh             # extended: worker lock must equal the pin record

src/lib/server/llm/
  profiles.ts  client.ts  anthropicMessages.ts  openaiChat.ts  redact.ts  *.test.ts
src/lib/server/agent/
  config.ts  gate.ts  identity.ts  queueStore.ts  verifier.ts  claims.ts  *.test.ts
src/lib/server/chartSeries.ts         # shared Gold series resolution (route + verifier)
src/app/api/agent/catalog/route.ts
src/app/api/agent/jobs/route.ts                 # POST create, GET thread list
src/app/api/agent/jobs/[id]/route.ts            # GET one
src/app/api/agent/jobs/[id]/cancel/route.ts
src/app/api/agent/jobs/[id]/retry/route.ts
src/app/api/agent/jobs/[id]/audit/route.ts
src/app/api/agent/health/route.ts
src/app/api/agent/profiles/[id]/probe/route.ts
src/features/agent-panel/
  AgentPanel.tsx  ThreadView.tsx  Composer.tsx  JobCard.tsx  ResultBlocks.tsx
  ChartBlock.tsx  ClaimText.tsx  VerificationSummary.tsx  ContextChip.tsx
  DisclosureDrawer.tsx  api.ts  types.ts  usePolling.ts  format.ts  *.test.tsx
src/components/charting/ChartStudio.tsx         # accepts ?agentChart=
src/app/api/copilot/route.ts, src/app/copilot/page.tsx  # profile migration
src/app/dataops/…                                # agent and profile cards

services/agent_worker/
  pyproject.toml  Dockerfile  README.md  quantsmith.lock
  src/agent_worker/
    main.py  readiness.py  queue.py  contracts.py  registry.py  periods.py
    reader.py  claims.py  splitter.py  envelope.py  telemetry.py  replay.py
    workflows/  chart_build.py  analysis_answer.py  story_build.py  brief_draft.py
    llm/        profiles.py  client.py  anthropic_messages.py  openai_chat.py
                budget.py  interpreter.py  narrator.py  drafter.py
                prompts/  interpreter.v1.md  narrator.v1.md  drafter.v1.md  manifest.json
  tests/        fixtures/  test_*.py

test/agent-panel.spec.ts              # Playwright: real worker, stub LLM, fixture Gold DB
```

The worker's Docker build context is the repository root, because it reads `contracts/` and
`settings/`. No file under `src/` imports from `services/`, and nothing under `services/` imports
from `src/`.

## Interfaces & Data Contracts

### Versioning and compatibility

Every contract carries `schema_version`: `agent-workflows/1`, `llm-profiles/1`, `agent-job/1`,
`agent-result/1`, `agent-verification/1`, `metric-registry/1`. A reader accepts its own major
version and ignores unknown additive fields. Node refuses a result of an unknown major version
and stores `RESULT_SCHEMA_INCOMPATIBLE`; the panel shows an incompatible-result state. TypeScript
types are generated from the schemas; the worker validates with models generated from the same
schemas. CI fails on an uncommitted generation diff.

### Agent workflow configuration (`settings/agent_workflows.json`)

```json
{
  "schema_version": "agent-workflows/1",
  "limits": {
    "max_queued_per_requester": 10,
    "max_running_per_requester": 1,
    "queue_ttl_hours": 24,
    "max_attempts": 2,
    "lease_seconds": 60,
    "heartbeat_seconds": 15,
    "max_context_bytes": 4096,
    "max_message_chars": 2000
  },
  "workflows": {
    "chart.build":     { "version": "1.0.0", "llm": "optional", "uses": ["interpreter"], "timeout_seconds": 60,
                         "data_classes": ["public_market_data", "module_context"], "enabled": true,
                         "requires_capabilities": ["chart_line_form"] },
    "analysis.answer": { "version": "1.0.0", "llm": "optional", "uses": ["interpreter", "narrator"], "timeout_seconds": 120,
                         "data_classes": ["public_market_data", "module_context"], "enabled": false,
                         "requires_capabilities": ["pit_level_semantics", "pack_rules_applied"] },
    "story.build":     { "version": "1.0.0", "llm": "none", "uses": [], "timeout_seconds": 90,
                         "data_classes": ["public_market_data", "module_context"], "enabled": false,
                         "requires_capabilities": ["story_recipes"] },
    "brief.draft":     { "version": "1.0.0", "llm": "required", "uses": ["drafter"], "timeout_seconds": 180,
                         "data_classes": ["public_market_data", "module_context"], "enabled": false,
                         "requires_capabilities": ["claim_bound_drafting"] }
  },
  "modules": {
    "MGC":  { "enabled": true,  "workflows": ["chart.build"], "default_profile": null,
              "profile_override": true, "domains": ["economics_macro", "rates_fixed_income"],
              "context_fields": ["series", "range", "transform", "chartType"] },
    "CURV": { "enabled": false, "workflows": ["chart.build", "story.build"], "default_profile": null,
              "profile_override": false, "domains": ["rates_fixed_income"],
              "context_fields": ["asOfDate", "tenors"] },
    "INFL": { "enabled": false, "workflows": ["chart.build"], "default_profile": null,
              "profile_override": false, "domains": ["economics_macro"],
              "context_fields": ["components", "range", "metric"] }
  }
}
```

Validation (`src/lib/server/agent/config.ts`, mirrored in the worker):

- A module key must be an existing nav code and must be in the reviewed eligible set
  `ELIGIBLE_AGENT_MODULES` (Gold-backed modules per `docs/gold-db/MODULE_DATA_AUDIT.md`). `SLAB`,
  `SQZ`, `PB`, `COLL`, `CASH`, `REINV`, `LIQ`, `SXU`, `OPT`, `IBAL`, `DESK`, `TASSIST`, and `AI`
  are not eligible; widening the set requires a spec change (REQ-029).
- A module may list only workflows that exist; a workflow's data classes must be a subset of its
  profile's classes at resolution time.
- `context_fields` are drawn from a per-module typed allowlist in code (for example `series` is
  a list of `SeriesRef` with `source` in `econ | fred | market`); free-form objects are rejected.

Readiness is evidence, not configuration: a workflow is offered only when it is `enabled` here
**and** a live worker reports every capability it requires (see Worker runtime).

### LLM profile registry (`settings/llm_profiles.json`)

```json
{
  "schema_version": "llm-profiles/1",
  "default_profile": "anthropic-direct",
  "default_profile_env": "LLM_PROFILE_DEFAULT",
  "profiles": {
    "anthropic-direct": {
      "enabled": true, "label": "Anthropic (direct)",
      "api_style": "anthropic_messages", "model": "claude-opus-4-8",
      "auth": { "scheme": "provider_default", "credential_env": "ANTHROPIC_API_KEY" },
      "limits": { "max_output_tokens": 1500, "timeout_ms": 60000, "max_retries": 2,
                  "per_job_token_cap": 20000, "daily_token_budget": 500000 },
      "data_classes": ["public_market_data", "module_context", "desk_simulated"],
      "uses": ["copilot", "interpreter", "narrator", "drafter"]
    },
    "openai-direct": {
      "enabled": false, "label": "OpenAI (direct)",
      "api_style": "openai_chat_completions", "model_env": "OPENAI_MODEL",
      "auth": { "scheme": "provider_default", "credential_env": "OPENAI_API_KEY" },
      "limits": { "max_output_tokens": 1500, "timeout_ms": 60000, "max_retries": 2,
                  "per_job_token_cap": 20000, "daily_token_budget": 500000 },
      "data_classes": ["public_market_data", "module_context"],
      "uses": ["interpreter", "narrator", "drafter"]
    },
    "gateway-openai": {
      "enabled": false, "label": "Gateway (OpenAI-compatible)",
      "api_style": "openai_chat_completions",
      "base_url_env": "LLM_GATEWAY_BASE_URL", "model_env": "LLM_GATEWAY_MODEL",
      "auth": { "scheme": "bearer", "credential_env": "LLM_GATEWAY_API_KEY" },
      "header_envs": {},
      "limits": { "max_output_tokens": 1500, "timeout_ms": 90000, "max_retries": 2,
                  "per_job_token_cap": 20000, "daily_token_budget": 500000 },
      "data_classes": ["public_market_data", "module_context"],
      "uses": ["interpreter", "narrator", "drafter"],
      "fallback_profile": null
    },
    "gateway-anthropic": {
      "enabled": false, "label": "Gateway (Anthropic-compatible)",
      "api_style": "anthropic_messages",
      "base_url_env": "ANTHROPIC_GATEWAY_BASE_URL", "model_env": "ANTHROPIC_GATEWAY_MODEL",
      "auth": { "scheme": "bearer", "credential_env": "ANTHROPIC_GATEWAY_API_KEY" },
      "limits": { "max_output_tokens": 1500, "timeout_ms": 90000, "max_retries": 2,
                  "per_job_token_cap": 20000, "daily_token_budget": 500000 },
      "data_classes": ["public_market_data", "module_context"],
      "uses": ["interpreter", "narrator", "drafter"]
    },
    "local-openai": {
      "enabled": false, "label": "Local server (OpenAI-compatible)",
      "api_style": "openai_chat_completions",
      "base_url_env": "LOCAL_LLM_BASE_URL", "model_env": "LOCAL_LLM_MODEL",
      "auth": { "scheme": "none" },
      "limits": { "max_output_tokens": 1500, "timeout_ms": 120000, "max_retries": 0,
                  "per_job_token_cap": 20000, "daily_token_budget": null },
      "data_classes": ["public_market_data", "module_context"],
      "uses": ["interpreter", "narrator"]
    },
    "deterministic": {
      "enabled": true, "label": "No LLM (deterministic)", "api_style": "none",
      "data_classes": ["public_market_data", "module_context", "desk_simulated"],
      "uses": ["interpreter", "narrator"]
    }
  }
}
```

Schema rules:

- Only `*_env` fields may reference secrets or endpoints; there is no field that can hold a
  credential or URL literally. A string that looks like a key or a URL in any other field fails
  validation (`AC-019`).
- `model` or `model_env` is required for enabled profiles with an API style other than `none`;
  `model_env` wins when set, so a gateway's model alias can change without a commit.
- `auth.scheme`: `provider_default` (SDK default header), `bearer` (`Authorization: Bearer`),
  `header` (with `header_name`, e.g. `api-key` for an Azure OpenAI v1 endpoint), or `none`.
- `header_envs` maps extra header names to environment variable names, for gateways that need
  routing or tenant headers. Header *values* never appear in the file.
- `data_classes`: `public_market_data` (Gold series and values derived from them),
  `module_context` (UI state, no values), `desk_simulated` (the Copilot's simulated desk
  snapshot). There is no class for confidential data in version one.
- `uses`: `copilot`, `interpreter`, `narrator`, `drafter`.

The shipped file enables only `anthropic-direct` (seeded with the Copilot's current model and
token limit, so migration changes nothing) and `deterministic`; the others are templates the owner
enables by setting their environment variables and flipping `enabled`.

### Profile resolution and provider clients

Resolution (identical on both sides, `src/lib/server/llm/profiles.ts` and
`agent_worker/llm/profiles.py`):

```text
candidate = job.profile (if the module allows override and the user picked one)
         ?? module.default_profile
         ?? env[default_profile_env]
         ?? registry.default_profile
check: exists → LLM_PROFILE_UNKNOWN
       enabled, use ∈ uses, workflow data classes ⊆ data_classes → LLM_PROFILE_NOT_ALLOWED
       credential/base URL/model env present (unless scheme none / api_style none) → LLM_PROFILE_UNAVAILABLE
optional workflows: LLM_PROFILE_UNAVAILABLE on the default (not user-picked) profile
       → resolve "deterministic" and record interpreter_mode = keyword/1
required workflows: any failure is terminal for the job
```

A user-picked profile never silently degrades: if it fails, the job fails with the code. A
`fallback_profile` (one hop) is used only for provider errors after retries, and the disclosure
records `fallback_from`.

Clients normalize every call to the shape of QuantSmith's `adapters/llm_runtime` contract:

```text
request:  workflow_id, run_id (= job id), model_profile, task_type (interpretation | narration | drafting | copilot),
          prompt_id + prompt_sha256, input_artifact_hashes, temperature, max_output_tokens,
          tools_allowed = [], privacy flags, correlation_id, dry_run, response_format (JSON Schema or none)
response: adapter_name, provider_style, model (as reported), status (completed | skipped | failed),
          output_text, usage { input_tokens, output_tokens, cost_estimate }, retryable,
          error_code, error_message_redacted, latency_ms
```

| API style | Node | Python | Notes |
| --- | --- | --- | --- |
| `anthropic_messages` | `@anthropic-ai/sdk` (already a dependency) with `baseURL`, `apiKey` or `authToken`, `defaultHeaders`, `timeout`, `maxRetries` | `anthropic` (pinned) with the same options | Gateways that proxy the Messages API work by base URL. |
| `openai_chat_completions` | `openai` (new, pinned) with `baseURL`, `apiKey`, `defaultHeaders`, `timeout`, `maxRetries` | `openai` (pinned) with the same options | OpenAI, Azure OpenAI v1 endpoints, LiteLLM, OpenRouter, vLLM, Ollama, and llama.cpp servers. |
| `none` | no client | no client | Deterministic interpreter and template narrative. |

Structured output: requests that need JSON send the JSON Schema of the expected object; where a
provider or gateway does not honor schema-constrained output, the client still parses and
validates locally. Validation failure is `LLM_OUTPUT_INVALID` — never repaired by guessing.
Streaming is not used. Errors map to `LLM_PROVIDER_ERROR` with `retryable` set for 408, 409,
429, 5xx, and timeouts.

Conformance fixtures (`contracts/agent/fixtures/llm-profiles/*.json`) each contain a profile, an
environment map, and the expected resolved call: endpoint URL, auth header name, extra header
names, model, limits, or the expected error code. Both test suites load the same files.

### Requester identity, production gate, kill switch

- **Identity.** Locally and in protected staging, `GET /api/agent/catalog` sets an `agent_sid`
  cookie (HttpOnly, SameSite=Lax, Secure when HTTPS; 128 random bits). The requester ID stored on
  jobs is `HMAC-SHA256(AGENT_SESSION_SECRET, sid)`. In production, the requester ID comes from
  the header named by `AGENT_TRUSTED_IDENTITY_HEADER`, honored only when the production gate
  passes. Every job read and write filters by requester ID.
- **Production gate** (`src/lib/server/agent/gate.ts`, same detection as IBAL:
  `NODE_ENV === "production" || VERCEL_ENV === "production"`): requires
  `AGENT_WORKFLOWS_PRODUCTION_ENABLED=true`, `AGENT_WORKFLOWS_TRUSTED_ACCESS_BOUNDARY`, and
  `AGENT_TRUSTED_IDENTITY_HEADER`; otherwise `AGENT_PRODUCTION_DISABLED` or
  `AGENT_TRUSTED_BOUNDARY_MISSING`, and the panel does not render.
- **Kill switch.** `AGENT_WORKFLOWS_DISABLED=1` is the deploy-level off switch (both runtimes). The
  run-time switch is the `agent_control` row `paused`, set by `node scripts/agent-control.mjs
  pause|resume`; job creation and worker claims check it on every request/poll, so it takes effect
  within one poll interval without a redeploy (Vercel environment changes otherwise need one).

### Job API

All routes return JSON, accept and echo `X-Correlation-ID`, and filter by requester.

| Route | Purpose |
| --- | --- |
| `GET /api/agent/catalog?module=MGC` | Panel bootstrap: module enablement, offered workflows (config ∩ worker capabilities), selectable profiles with availability (no secrets), context fields, limits, worker status, gate state. Sets `agent_sid`. |
| `POST /api/agent/jobs` | Create a job. Requires `Idempotency-Key`. |
| `GET /api/agent/jobs?module=MGC&thread=<uuid>` | Thread view. Runs pending verifications (bounded, idempotent) before returning. |
| `GET /api/agent/jobs/[id]` | One job, with result and verification when available. |
| `POST /api/agent/jobs/[id]/cancel` | `queued → cancelled` immediately; `running` sets `cancel_requested` and the worker stops at the next stage boundary. |
| `POST /api/agent/jobs/[id]/retry` | New job with `retry_of`, for `failed` or `expired` jobs. |
| `GET /api/agent/jobs/[id]/audit` | The REQ-028 audit record. |
| `GET /api/agent/health` | Data Ops metrics (metadata only). |
| `POST /api/agent/profiles/[id]/probe` | Live probe of one profile (one tiny completion); disabled when the production gate is closed. |

Create request:

```json
{
  "schema_version": "agent-job/1",
  "module": "MGC",
  "thread_id": "5d0c…",
  "workflow": "chart.build",
  "message": "chart the 2-year and 10-year Treasury yields",
  "context": { "series": [{ "source": "econ", "id": "DGS10" }], "range": "5Y", "transform": "none", "chartType": "line" },
  "profile": null,
  "parent_job_id": null
}
```

The workflow is always explicit (the panel's selector defaults to the module's first offered
workflow); there is no hidden routing step. Same key with the same body returns the existing job
(`200`); same key with a different body is `409 AGENT_IDEMPOTENCY_CONFLICT`.

Stable error codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `AGENT_DISABLED` | 503 | Deploy-level switch or `paused` control row |
| `AGENT_PRODUCTION_DISABLED`, `AGENT_TRUSTED_BOUNDARY_MISSING` | 503 | Production gate closed |
| `AGENT_QUEUE_NOT_CONFIGURED` | 503 | `AGENT_QUEUE_DB_URL` unset or unreachable |
| `AGENT_MODULE_DISABLED` | 403 | Module not enabled or not eligible |
| `AGENT_CONTEXT_INVALID` | 400 | Context outside the allowlist, too large, or carrying values |
| `AGENT_QUEUE_LIMIT` | 429 | Requester's queued limit reached |
| `AGENT_IDEMPOTENCY_CONFLICT` | 409 | Key reused with a different body |
| `WORKFLOW_UNKNOWN`, `WORKFLOW_NOT_READY` | 400, 409 | Unknown or not offered (names the missing capability) |
| `LLM_PROFILE_UNKNOWN`, `LLM_PROFILE_NOT_ALLOWED`, `LLM_PROFILE_UNAVAILABLE` | 400, 403, 409 | Profile resolution failures (create-time checks for user-picked profiles) |

Job-level outcomes recorded on the job (not HTTP errors): `LLM_BUDGET_EXCEEDED`,
`LLM_PROVIDER_ERROR`, `LLM_OUTPUT_INVALID`, `JOB_TIMEOUT`, `WORKER_LOST`, `QUEUE_TTL_EXPIRED`,
`DATA_UNAVAILABLE`, `UNSUPPORTED_CHART` (an outcome of a succeeded job, not a failure),
`RESULT_SCHEMA_INCOMPATIBLE`, `VERIFICATION_ERROR`.

### Queue store

DDL (portable across SQLite and Postgres; owned and migrated by Node, checked by the worker):

```sql
CREATE TABLE agent_schema_version (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE agent_control (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE agent_thread (
  requester TEXT NOT NULL, module TEXT NOT NULL, thread_id TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (requester, module, thread_id));
CREATE TABLE agent_job (
  id TEXT PRIMARY KEY, requester TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  module TEXT NOT NULL, thread_id TEXT NOT NULL, workflow TEXT NOT NULL, workflow_version TEXT NOT NULL,
  status TEXT NOT NULL,          -- queued | running | verifying | succeeded | needs_clarification | failed | cancelled | expired
  message TEXT,                  -- NULL after purge
  context_json TEXT NOT NULL, profile_requested TEXT, parent_job_id TEXT, retry_of TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
  lease_owner TEXT, lease_expires_at TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
  result_json TEXT, result_schema_version TEXT, verification_json TEXT, disclosure_json TEXT,
  usage_json TEXT, error_code TEXT, error_message TEXT, error_retryable INTEGER,
  correlation_id TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  expires_at TEXT NOT NULL, purge_after TEXT NOT NULL, delete_after TEXT NOT NULL,
  UNIQUE (requester, idempotency_key));
CREATE INDEX agent_job_thread ON agent_job (requester, module, thread_id, created_at);
CREATE INDEX agent_job_status ON agent_job (status, created_at);
CREATE TABLE agent_job_event (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, at TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
  actor TEXT NOT NULL,           -- api | worker:<id> | verifier | sweeper
  code TEXT, detail_json TEXT);
CREATE TABLE agent_job_artifact (
  job_id TEXT NOT NULL, kind TEXT NOT NULL,  -- evidence_rows | envelope | llm_transcript
  sha256 TEXT NOT NULL, content BLOB NOT NULL, purge_class TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, kind));
CREATE TABLE agent_worker_heartbeat (
  worker_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  quantsmith_commit TEXT NOT NULL, registry_version TEXT NOT NULL,
  capabilities_json TEXT NOT NULL, worker_version TEXT NOT NULL, ready INTEGER NOT NULL);
CREATE TABLE agent_usage_daily (
  profile_id TEXT NOT NULL, day TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (profile_id, day));
```

Timestamps are ISO-8601 UTC strings on both backends. `AGENT_QUEUE_DB_URL` is required — there is
no fallback to `MACRO_DB_URL`. It may point at the Gold Postgres instance (as spec006 does) with
write-capable credentials, or at a local SQLite file (`sqlite:./.data/agent_queue.db`, ignored by
Git). A permissions failure is an explicit error, never a silent no-op.

Claim protocol (Postgres; SQLite runs a single worker inside `BEGIN IMMEDIATE`):

1. In one transaction, lock one `agent_thread` row with `FOR UPDATE SKIP LOCKED` whose oldest
   non-terminal job is `queued`, unexpired, and not cancelled, and whose requester has fewer than
   `max_running_per_requester` running jobs.
2. Update that job: `status = running`, `lease_owner = worker_id`, `lease_expires_at = now +
   lease_seconds`, `attempt = attempt + 1`, `started_at` if unset; append an event.
3. The worker heartbeats every `heartbeat_seconds`, extending the lease while it runs (including
   during a long provider call).
4. Every write the worker makes is fenced: `WHERE id = $1 AND lease_owner = $2 AND attempt = $3
   AND status = 'running'`. A late write from a worker that lost its lease affects zero rows and
   is discarded, so at most one attempt's result is recorded (NFR-004).

Sweeps (worker, every minute): leases past expiry → `queued` (if `attempt < max_attempts`) or
`failed WORKER_LOST`; `queued` past `expires_at` → `expired QUEUE_TTL_EXPIRED`; daily retention
purge (see Audit record and retention).

### Worker runtime

Start-up readiness (`readiness.py`); any failure keeps `ready = 0` and claims nothing:

1. **Pin.** Read the installed QuantSmith commit from PEP 610 `direct_url.json`
   (`vcs_info.commit_id`); for an editable install, `git -C $QUANTSMITH_ROOT rev-parse HEAD` and
   assert the import path is under `QUANTSMITH_ROOT`. It must equal `quantsmith.lock`, else
   `QUANTSMITH_PIN_MISMATCH`.
2. **Schema.** `agent_schema_version` must be the version the worker was built for.
3. **Registry.** Load `contracts/agent/generated/metric_registry.json`, check its schema version,
   and build the `0008` `SemanticLayer` plus synonyms.
4. **Packs.** `visualization_packs.load_catalog(QUANTSMITH_ROOT)` in strict mode; record each
   pack's review status.
5. **Profiles.** Validate `settings/llm_profiles.json`; dry-run every enabled profile.
6. **Capabilities.** Run per-workflow golden self-tests against fixture data (no network) and
   publish the passing set in the heartbeat:

| Capability | Proven by | Unblocks |
| --- | --- | --- |
| `chart_line_form` | `choose_chart` returns `line` for a multi-period single-series plan; overlay composition fixtures | `chart.build` |
| `pit_level_semantics` | On a non-additive fixture metric, the `0080` level insight equals the latest observation, not a window mean or sum (Q-2) | `analysis.answer`, insight sections of `story.build` |
| `pack_rules_applied` | With `rates_fixed_income` applied, a yield change is reported in basis points, contributor/concentration insights are suppressed, and no insight sums across tenors (Q-1) | same |
| `story_recipes` | `policy_path` builds from fixture evidence | chart-only `story.build` |
| `claim_bound_drafting` | Drafter fixture transcripts pass the text rule and claim builder | `brief.draft` |

The catalog route offers a workflow only if config enables it and some ready worker heartbeat
within two heartbeat periods lists every capability it requires. When a QuantSmith pin bump makes
Q-1/Q-2 true, the capabilities appear without any QuantMeridian code change.

Main loop: check `agent_control.paused`; claim; run the workflow runner with a timer and a
cancellation check between stages; write the result and usage (fenced); append events; repeat.
Concurrency defaults to 2 (`AGENT_WORKER_CONCURRENCY`). Logs are structured and metadata-only
(job ID, workflow, status transitions, durations, token counts, error codes) — never message
text, context, prompts, or model output.

### Metric registry and reader

`scripts/export-agent-metric-registry.ts` generates `contracts/agent/generated/metric_registry.json`
from `FRED_CATALOG` (`src/data/econSeries.ts`) and a reviewed mapping table in the script:

```json
{
  "schema_version": "metric-registry/1",
  "registry_version": "sha256:…",
  "metrics": [
    {
      "name": "DGS10", "label": "10-Year Treasury Yield", "short": "UST 10Y",
      "series": { "source": "econ", "id": "DGS10", "units": "lin" },
      "unit": "pct", "decimals": 2, "grain": "day", "agg": "mean",
      "additivity": "non_additive", "dimensions": [],
      "domains": ["rates_fixed_income"], "synonyms": ["10-year", "10y", "ten year treasury"],
      "owner": "gold:fred_latest_observation"
    }
  ]
}
```

Mapping rules: `freq` D/W/M/Q → grain `day/week/month/quarter`; `EconCategory` `RATES` →
`rates_fixed_income`, `CREDIT` → `credit_markets`, `FX` → `fx_markets`, all others →
`economics_macro`; `unit` from a reviewed table (`%` → `pct`, index units → `index`, dollar
amounts → `currency`, counts → `count`); additivity defaults to `non_additive` and may be relaxed
only through the reviewed table with a rationale (`0081` REQ-003). Per-series metrics only in
version one; dimension families (for example yields by tenor) arrive with `story.build`'s curve
recipe. A Vitest test regenerates in memory and fails on any diff.

Reader (`reader.py`) implements `0080`'s `Reader`:

- Map the plan's metric to its series and call
  `GET {QM_API_BASE_URL}/api/chart/series?source=…&id=…&units=lin`, adding headers from the
  environment variables named in `QM_API_EXTRA_HEADERS_ENV` (for a protected deployment).
- Refuse any response whose `source` is not `DB` → `DATA_UNAVAILABLE` naming series and reason
  (REQ-010). Never substitute data.
- Convert observations to `Fact(period, dims={}, measures={metric: value})` using the period
  encoding below; drop nothing silently (a null value is skipped and counted in the evidence).
- Record the raw rows as an `evidence_rows` artifact with its SHA-256; the result's
  `content_hash` covers every artifact.

Period encoding (`periods.py`; `0080` window arithmetic is integer subtraction, so periods must be
contiguous ordinals): `day` → `date.toordinal()`; `week` → ISO-week ordinal (Monday of the week,
`toordinal() // 7`); `month` → `year * 12 + month - 1`; `quarter` → `year * 4 + quarter - 1`;
`year` → `year`. Round-trip tests cover every grain, year ends, and leap days.

`InterpretContext` is built per job: `today_period` from the job's creation date (UTC, passed
explicitly — never a clock read inside QuantSmith), `default_grain` from the metric, and
`default_window_periods` from the module context's range (`5Y` → 5 years in that grain); curated
synonyms come from `settings/agent_metric_synonyms.json`.

### Workflows

#### `chart.build` (data_visualization; buildable now)

```text
message + context
  -> splitter: explicit lists ("A and B", "A, B and C", "A vs B") become fragments
  -> per fragment: KeywordInterpreter, or one LlmInterpreter call returning a ChartRequest
  -> per series: QueryPlan(metric, window from range, grain) -> validate_plan -> authorize_plan
     -> execute(reader) -> choose_chart
  -> every plan must yield "line"; any other form -> outcome unsupported_chart (no numbers)
  -> overlay rule, transform and range vocabulary, pack conventions and caveats
  -> result: chart block + plan echo + caveats
```

- **Splitter** (`splitter.py`, deterministic): splits only on explicit list syntax; each fragment
  must match exactly one registry metric through the unchanged `KeywordInterpreter`, otherwise
  the job ends in a clarification listing the candidates (REQ-006). This exists because `0080`'s
  keyword interpreter returns a clarification when two metrics match (companion item Q-7).
- **LLM interpreter** (`llm/interpreter.py`): prompt `interpreter.v1.md` with the question, the
  module context, and the registry vocabulary (names, labels, units, grains, synonyms — no
  values). Output must validate against `ChartRequest`:
  `{ "kind": "chart_request", "series": [{"metric": "DGS2"}, …], "range": "5Y", "transform": "none" }`
  or `{ "kind": "clarification", "reason": …, "candidates": […] }`. The worker — not the model —
  builds each `QueryPlan`, so every plan still passes `validate_plan` and `authorize_plan`.
  `LlmInterpreter` also implements `0080`'s `Interpreter` protocol for single-plan use and is
  registered with `register_interpreter` under `llm:<profile-id>`.
- **Overlay rule:** all series must share unit and grain, or the request must name a
  normalizing transform (`index100`, `zscore`); otherwise clarification. This keeps
  `data_visualization`'s "no dual axes implying false correlation" rule.
- **Transforms** (vocabulary → chart engine transforms): "indexed to 100" → `index100`,
  "z-score" → `zscore`, "year-over-year" → `yoy`, "month-over-month" → `mom`, "percent change" →
  `pct_change`, "log" → `log`; default from context. Percent-change transforms on a `pct`-unit
  rate end in a clarification, per `rates_fixed_income` caveat `cv.pct_change`.
- **Ranges:** phrases map to the nearest covering preset (`1M` … `MAX`). When the preset differs
  from what was asked (for example "since 2000" → `MAX`), the plan echo says so.
- **Conventions and caveats:** `0081` pack caveats for the series' domains (for example
  `cv.revisions`) and `default_caveats` staleness/sample caveats from `execute`'s result; chart
  conventions that map to chart options (for example `ch.recession` → `showRecession: true` for
  long histories).
- The executed `Result` drives the form rule, staleness, and evidence hashes. Its values are
  never shown — the chart engine re-resolves the series.

#### `analysis.answer` (blocked until `pit_level_semantics` and `pack_rules_applied`)

Interpret (keyword or `LlmInterpreter`) → `answer(question, AnswerContext(…, interpreter=…,
envelope_dir=…, run_id=job_id, dataset_privacy={…}))` → map the `ChatResponse` to blocks:

- Insights become claims (see Claims): `level` → `level`; `change` → `delta` with basis from the
  unit (`bps` for `pct`, `pct` for `index`); `trend` → two `level` claims. Insight kinds with no
  claim mapping yet (`outlier`, `concentration`, `contributor`) are not shown; the block lists
  them as "computed, not displayed — no verification mapping".
- Text: insight statements are re-templated with placeholders from kind and claims; QuantSmith's
  pre-formatted statement text is not displayed. The narrative is a placeholder template by
  default. With an LLM narrator, `narrator.v1.md` receives insights and claim IDs and must return
  placeholder text; it is accepted only if it passes `ground()` against the insights and the text
  rule, else the template narrative is shown, flagged `ungrounded_text`.
- `clarification_needed`, `masked`, `empty`, and `stale` map to clarification or notice blocks
  with their reasons.

#### `story.build` (`policy_path` now; `curve_levels` after Q-1/Q-2)

`load_catalog(QUANTSMITH_ROOT)` → `catalog.select(module domains, intent)` → per section
`collect_evidence(QueryPlan, SemanticLayer, reader, citation, as_of, access policy)` →
`build_story(…)` → `render_json(story)` → blocks in recipe order. `trend` sections become chart
blocks; `breakdown` sections with `chart_rule: table` become claim-bound tables (each cell a
`level` claim) once the curve family metric exists; finding text uses placeholders. Values are
bound with `0093`'s own `bind_claim` (which ties each value to its evidence digest) and checked
with `validate_claim` in the worker, then translated to spec009 `level` claims (metric → series,
period → date) for QuantMeridian's independent Gold check. Packs in
`draft` add an "unreviewed pack" caveat naming the pack. `dashboard_handoff` output is stored as
an artifact only; rendering a `DashboardSpec` in `MGC`/`MKC` is out of scope (spec005 item 4's
general adapter stays a separate decision).

#### `brief.draft` (later phase)

The drafter prompt is built from `agents/economists/macro_backdrop_summarizer/prompt.md` and
`templates/docs/macro_backdrop_report.md` at the pin, plus evidence the worker fetched through the
reader for the series the template needs. The model returns
`{ "sections": [{ "heading", "text_template" }], "claims": [ … ] }`. The worker recomputes every
claim value from the evidence rows (a model-supplied value is kept only as `model_value` for the
mismatch report), applies the text rule, and the verifier then checks every claim against Gold.
spec005 Phase 2's injected-claim cases (an unsourced policy narrative, a fabricated Treasury
yield, an invented consensus figure) become permanent fixtures that must end `FLAGGED` or
`DROPPED`. Nothing is published or forwarded.

### Result payload, claims, and the text rule

```json
{
  "schema_version": "agent-result/1",
  "job_id": "…", "workflow": { "id": "chart.build", "version": "1.0.0" },
  "outcome": "answered",
  "blocks": [
    { "type": "chart", "chart": { "title": "UST 2Y and 10Y yields", "series": [
        { "source": "econ", "id": "DGS2" }, { "source": "econ", "id": "DGS10" } ],
      "range": "5Y", "transform": "none", "chartType": "line", "showRecession": true },
      "form_rule": "line", "alt_text": "…" },
    { "type": "plan_echo", "plans": [ { "metric": "DGS2", "label": "2-Year Treasury Yield",
        "grain": "day", "window": { "start": "2021-10-06", "end": "2026-10-06" },
        "defaults_applied": ["window"] } ] },
    { "type": "caveats", "items": [ { "id": "cv.revisions", "source": "pack:economics_macro", "text": "…" } ] }
  ],
  "claims": [],
  "disclosure": {
    "quantsmith_commit": "…", "registry_version": "sha256:…", "interpreter_mode": "keyword/1",
    "llm": [], "prompts": [], "plans_sha256": ["…"],
    "data": [ { "series": { "source": "econ", "id": "DGS2" }, "as_of": "2026-10-02", "rows": 1255, "provenance": "DB" } ],
    "content_hash": "sha256:…",
    "packs": [ { "id": "rates_fixed_income", "kind": "analytics", "review_status": "draft" } ]
  },
  "usage": { "input_tokens": 0, "output_tokens": 0 },
  "timings_ms": { "interpret": 4, "execute": 38, "chart": 1, "total": 61 }
}
```

Outcomes: `answered`, `clarification`, `unsupported_chart`, `data_unavailable`. Block types:
`chart`, `plan_echo`, `insights`, `narrative`, `table`, `clarification`, `caveats`, `notice`.

Claim vocabulary (version one; levels come from `units=lin`, everything else is recomputed):

| Kind | Fields | Verifier recomputation |
| --- | --- | --- |
| `level` | series, date, value, unit, decimals | Gold level at that date |
| `delta` | series, from, to, basis (`abs`, `bps`, `pct`), value | From the two Gold levels |
| `transform_point` | series, date, transform (`yoy`, `mom`, `pct_change`, `log`), value | `applyPointTransform` from `src/lib/charting/transforms.ts` over Gold levels |
| `window_stat` | series, from, to, stat (`min`, `max`, `mean`, `first`, `last`, `count`), value, at (for min/max) | Over Gold levels in the window |
| `latest_date` | series, date | Latest Gold observation date |

Text rule (applied by the worker and again by the verifier) for `headline`, `insights`,
`narrative`, and story text: allowed are words, punctuation, `{{c:<claim>}}` (formatted value),
`{{d:<claim>}}` (the claim's date), and numeric tokens from an allowlist derived from the
registry (series IDs, labels, tenor names such as "2-year" or "10Y", and quarter labels). Any
other digit sequence fails as `ungrounded_text`. `plan_echo`, `disclosure`, and chart titles built
by the worker from registry labels are structured fields rendered by the client, not free text.

### Verification

`src/lib/server/agent/verifier.ts` runs when the thread or job route sees a `verifying` job:

1. Validate the result against `result.schema.json`; unknown major version →
   `RESULT_SCHEMA_INCOMPATIBLE`.
2. Re-run the text rule over every text block. A failing LLM-authored block is replaced by its
   template sibling (the worker always includes one) and flagged; a failing template block is a
   bug and fails the job with `VERIFICATION_ERROR`.
3. For each chart block: every series must be in the registry, and
   `resolveChartSeries(source, id, "lin")` must return provenance `DB` with observations;
   otherwise the chart is `DROPPED` with a reason. The chart's series must equal the plans'
   metrics — no extra series.
4. For each claim: re-resolve with `resolveChartSeries` (the function `/api/chart/series` itself
   uses, extracted in T-011), recompute per the vocabulary, and assign:
   - `VERIFIED` — levels equal exactly; recomputed values equal after rounding to the claim's
     declared decimals;
   - `FLAGGED` — Gold has the observation but the value differs (reason `value_mismatch`, or
     `revised_since_job` when the evidence artifact proves the job saw an older value); the
     Gold value is recorded;
   - `DROPPED` — unknown series, non-`DB` provenance, or no observation on that date.
5. Store `verification_json`, move `verifying → succeeded` with a conditional update (concurrent
   verifications compute identical output; the second write affects zero rows), append an event.

Worker-supplied `verdict` fields do not exist in the schema and are rejected if present.

Finding recorded for this design: `/api/chart/series` reads non-`lin` units through
`store.history("fred_feature_transforms", { series_id })` and returns `value`, while
`/api/econ/series` selects `transformColumn(units)`. Because the two paths differ, version one
verifies only `lin` levels plus TypeScript recomputation. Reconciling the two routes is out of
scope and should get its own fix.

### Presentation

- **Panel.** A collapsible right-hand dock in the module page: header (module, workflow selector,
  profile selector when the module allows override, worker status), thread, composer. The
  composer never blocks on pending jobs — queueing is the point. Enter queues; Shift+Enter adds a
  line.
- **Context chip** shows exactly the snapshot that will be sent ("DGS10 · 5Y · none"), with a
  toggle to send none.
- **Job card.** Status as text plus icon (`Queued — 2 ahead`, `Queued — worker offline`,
  `Running`, `Verifying`, `Needs clarification`, `Failed: <code>`, `Cancelled`, `Expired`),
  elapsed time, cancel and retry actions, then result blocks.
- **Charts** render through a compact `ChartBlock` using `useChartSeries` (same resolver as the
  studios) with per-series provenance badges, plus "Open in Chart Studio".
- **Claims** render through `ClaimText`: verified values formatted by unit; dropped placeholders
  as "[removed — could not verify]"; flagged as the agent value struck through with the Gold
  value and reason. A `VerificationSummary` shows "n verified · n flagged · n dropped".
- **Disclosure drawer** ("How this was made") lists every REQ-017 field.
- **Polling** (`usePolling.ts`): every 2 s for 30 s while a job is non-terminal, then 5 s, then
  10 s; paused while the tab is hidden; stops when the thread is terminal.
- **Thread persistence.** The current thread ID per module is kept in `localStorage` (wrapped in
  try/catch; a missing value starts a new thread); "New thread" starts another. Jobs live
  server-side, so reloads restore the thread.
- **Studio hand-off.** "Open in Chart Studio" navigates to `/macro-chart?agentChart=<base64url>`
  (or `/market-chart` for `market`/`lens` sources). `ChartStudio` decodes, validates the shape
  (series refs with known sources, a valid range, transform, and chart type), calls
  `applyTemplate`, and removes the parameter with `history.replaceState`. An invalid payload
  shows a notice and changes nothing.

### Copilot migration

`src/app/api/copilot/route.ts` resolves `{ use: "copilot", module: "AI" }` with data class
`desk_simulated`. `deterministic` or an unavailable default returns `{ source: "LOCAL" }` exactly
as today. Otherwise it calls the profile client with the existing system prompt, the same user
content, and `max_output_tokens` from the profile (1500 in the seeded profile), keeps
`extractJson` and every fallback branch, and adds `profile` and `model` to the `AI` response. The
page's badge shows "AI · <profile label>". A test with a mocked SDK asserts the default request is
identical to today's (model, system, messages, max tokens). When the queue database is configured,
the Copilot records usage in `agent_usage_daily`; budget enforcement applies to agent workflows
only.

### Budgets and usage

Before each provider call the worker estimates the call (input characters / 4 plus
`max_output_tokens`). If `agent_usage_daily` for the profile and UTC day plus the estimate exceeds
`daily_token_budget`, or the job's running total would exceed `per_job_token_cap`, the call is not
made and the job fails `LLM_BUDGET_EXCEEDED`. After the call, actual usage from the provider
response is added atomically (`INSERT … ON CONFLICT DO UPDATE`). A provider that reports no usage
is charged the estimate and flagged in Data Ops.

### Audit record and retention

- The audit record is the job row, its events, and its artifacts: `evidence_rows`, an `envelope`
  (`analysis.answer` uses `AnswerContext(envelope_dir, run_id)`; the other workflows emit a
  `0070` envelope through `quantsmith.orchestration`, with the exact entry point confirmed at the
  pin in T-012), and `llm_transcript` (prompt and raw output) for LLM calls.
- `GET /api/agent/jobs/[id]/audit` returns it to the requester.
- `purge_after` (default 30 days, D-6) nulls `message` and deletes `llm_transcript` artifacts;
  `delete_after` (default 180 days) deletes the job, events, and remaining artifacts.
- Replay (`python -m agent_worker.replay <job_id>`) re-runs a deterministic job from its recorded
  inputs and evidence rows and compares payload bytes; an LLM job replays from its transcript or
  reports `non_reproducible` once the transcript is purged — never claimed equivalent (`0070`).

## State Model

```text
queued ──claim──► running ──result──► verifying ──verifier──► succeeded
  │                 │  │                                        (outcome: answered | clarification |
  │                 │  └─clarification──► needs_clarification     unsupported_chart | data_unavailable)
  │                 ├─error/timeout/budget──► failed ──retry──► (new job, retry_of)
  │                 ├─cancel_requested──► cancelled
  │                 └─lease expired──► queued (attempt < max) | failed WORKER_LOST
  ├─cancel──► cancelled
  └─TTL──► expired ──retry──► (new job, retry_of)
```

`needs_clarification` is terminal for its job; the reply creates a new job with `parent_job_id`.
Only `succeeded` jobs render result blocks. Every transition appends an `agent_job_event`.

## Constitution Check

| Principle | Upheld? | Notes |
| --- | --- | --- |
| P1 Spec is source of truth | yes | SPEC/PLAN/TASKS precede any code; QuantSmith companion items are named, not assumed. |
| P2 Traceability | yes | Every requirement and NFR maps below; every AC maps to tests in `TASKS.md`. |
| P3 Testable DoD | yes | Conformance fixtures, verifier verdict matrix, golden workflows, replay, e2e, benchmarks. |
| P4 Correct by construction | yes | Numbers only as claims; charts only as references; plans only over registry metrics; explicit as-of and period encoding; no hidden clock. |
| P5 Reversibility | yes | Per-module enablement, kill switch, production gate, isolated tables, pinned worker image, Copilot default unchanged. |
| P6 Observability | yes | Events, heartbeats, capabilities, Data Ops metrics, correlation IDs, audit records. |
| P7 Small changes | yes | Slices: contracts → profiles/Copilot → queue/API → worker → verification/UI → gated workflows → hardening. |
| P8 No silent trade-offs | yes | Overlay composition, unsupported forms, draft packs, level-only claims, and the series-route finding are explicit. |
| P9 Security and data | yes | Env-referenced secrets, requester scoping, data classes, eligible modules, metadata-only logs, retention. |
| P10 Honest reporting | yes | Verdict badges, interpreter mode, profile and model, fallbacks, and non-reproducible replays are always shown. |

## Traceability Matrix

| Requirement | Design element | Tasks |
| --- | --- | --- |
| REQ-001 | Module enablement in `agent_workflows.json`, eligible set, panel mount | T-003, T-010, T-018 |
| REQ-002 | `POST /api/agent/jobs`, idempotency, durable `agent_job` | T-008, T-010 |
| REQ-003 | Thread FIFO claim, lifecycle, cancel/retry, server-side threads | T-008, T-010, T-018 |
| REQ-004 | Limits, leases, fencing, sweeps | T-008, T-010, T-012 |
| REQ-005 | Context allowlist, size limit, context chip | T-003, T-010, T-018 |
| REQ-006 | Clarification outcome, splitter, linked reply | T-015, T-018 |
| REQ-007 | Catalog schema, config ∩ capabilities | T-002, T-003, T-010, T-016 |
| REQ-008 | Worker image from pinned checkout, PEP 610 readiness, pin check | T-001, T-012 |
| REQ-009 | Registry export, mapping table, drift test, `SemanticLayer` loader | T-004 |
| REQ-010 | Reader over the series route, `DB`-only rule, shared resolution | T-011, T-013 |
| REQ-011 | `chart.build` pipeline, overlay rule, unsupported forms | T-015 |
| REQ-012 | `analysis.answer`, capability gate | T-016, T-021, T-028 |
| REQ-013 | `story.build`, capability gate, draft-pack caveat | T-016, T-022, T-028 |
| REQ-014 | Claim-bound drafting, text rule, template fallback | T-017, T-021, T-023 |
| REQ-015 | Claim vocabulary, verifier, verdicts | T-011, T-017, T-021, T-023 |
| REQ-016 | `ClaimText`, `VerificationSummary` | T-017, T-018 |
| REQ-017 | Disclosure payload and drawer | T-015, T-018 |
| REQ-018 | Chart verification, `ChartBlock`, studio hand-off | T-018, T-019 |
| REQ-019 | Profile schema and registry | T-002, T-003, T-005 |
| REQ-020 | Resolution precedence and fail-closed codes | T-005, T-014 |
| REQ-021 | Shared conformance fixtures, both clients | T-005, T-014 |
| REQ-022 | Copilot migration | T-006 |
| REQ-023 | Dry-run states, probe route, Data Ops card | T-007 |
| REQ-024 | Typed outputs only, `validate_plan`/`authorize_plan`, no tools | T-005, T-015, T-025 |
| REQ-025 | Gate, identity, kill switch | T-009, T-010, T-027 |
| REQ-026 | Budgets and usage accounting | T-014 |
| REQ-027 | Heartbeats, health route, Data Ops card | T-010, T-012, T-020 |
| REQ-028 | Job record, events, artifacts, envelope, retention, replay | T-012, T-021, T-024 |
| REQ-029 | Eligible modules, data classes | T-003, T-025 |
| NFR-001 | Claims, text rule, verifier, rendering scan | T-017, T-018, T-023 |
| NFR-002 | Evidence artifacts, content hash, replay | T-013, T-015, T-024 |
| NFR-003 | Benchmarks on the reference runtime | T-026 |
| NFR-004 | Idempotency, thread locks, leases, fencing | T-008, T-012 |
| NFR-005 | Env references, redaction, scoping, log tests | T-003, T-005, T-007, T-009, T-012, T-025 |
| NFR-006 | One schema, two clients, conformance fixtures | T-005, T-014 |
| NFR-007 | Error code table, distinct states | T-010, T-018 |
| NFR-008 | Panel accessibility and viewports | T-018, T-026 |
| NFR-009 | Schema versions, generated types, incompatible state | T-001, T-002, T-018 |
| NFR-010 | Correlation IDs, health, CI jobs | T-010, T-020, T-026 |

## Trade-offs & Alternatives

| Decision | Chosen | Rejected alternative | Why |
| --- | --- | --- | --- |
| Execution boundary | Python worker from a pinned QuantSmith checkout | Claude Code / agent SDK sessions per request; a TypeScript port; Node spawning Python | Sessions cannot be queued from a module UI; a port duplicates QuantSmith; spawning breaks spec005's process boundary and does not run on Vercel. |
| Queue | Database-backed queue in app-owned tables | Redis/SQS; in-memory; worker HTTP API with its own queue (IBAL-style proxy) | No new infrastructure, survives restarts, accepts jobs while the worker is down, works from serverless handlers. |
| Worker data path | QuantMeridian's series route | Worker reads Gold directly (as QuantSmith `0045` does) | One read path: the chat, the chart, and the verifier see the same values and labels. |
| Verification | Node verifier over `GoldStore` | Worker self-verification | A component that produced a number must not certify it (spec005's borrowed-authority risk). |
| Numbers in text | Claim placeholders plus a text rule | Free text checked only by `0080`'s `ground()` | `ground()` matches values loosely; a placeholder binds each number to one claim and one verdict. |
| Chart rendering | QuantMeridian chart engine from references | Render QuantSmith's Vega-Lite | One renderer and one provenance system; no numbers from the worker. |
| Overlays | Per-series plans composed in the worker | A tenor/series dimension family; waiting for Q-7 | `choose_chart` draws one dimension as a bar over the whole window, and waiting would block the most common request. |
| LLM clients | Official SDKs on both sides behind one schema | Hand-rolled HTTP; gateway-only | SDKs already handle base URLs, headers, retries, and timeouts; gateway-only forces every user to run one. |
| Provider configuration | Committed registry plus environment references | Environment variables only; database-stored settings | Reviewable defaults per module without an admin UI; secrets stay in the environment. |
| Workflow choice | Explicit selector | LLM auto-routing | No hidden interpretation step before the governed one. |
| Result delivery | Polling with backoff | Server-sent events or WebSockets | Works on serverless; streaming is a follow-up. |
| Copilot | Move onto profiles, unchanged behavior | Rebuild the Copilot on the queue | Different data class (simulated) and latency needs. |
| Kill switch | Environment hard switch plus a database pause row | Environment only | Vercel environment changes need a redeploy. |
| Requester scoping | HMAC'd session cookie; boundary identity in production | No scoping | Threads would otherwise be readable by any viewer. |

## Validation Strategy

### Worker tests (`services/agent_worker/tests`, pytest, ruff)

- Readiness: pin mismatch, schema mismatch, strict pack load failure, editable install path check.
- Queue: claim fairness and thread FIFO, lease expiry, fencing of late writes, TTL expiry,
  cancellation at stage boundaries, retention purge.
- Reader and periods: provenance refusal for `ERR`/`SIM`/`SNAPSHOT`, period round trips, evidence
  hashing.
- `chart.build`: splitter cases, single and overlay requests, mixed-unit clarification,
  percent-change-on-rate clarification, unsupported forms, pack caveats, deterministic replay.
- LLM: conformance fixtures, stub OpenAI-compatible and Anthropic-compatible servers (success,
  429/5xx retry, timeout, schema-invalid output, SQL-looking output), fallback disclosure,
  budgets.
- Gated workflows: golden cases for Q-1/Q-2 behavior (skipped with an explicit reason until the
  capability exists), story recipes, drafter injected-claim fixtures.
- Security: no message, context, prompt, or output in captured logs; no credential in any
  artifact.

### TypeScript tests (Vitest)

- Config and profile schema validation, eligible modules, secret-shaped value rejection,
  precedence and fail-closed codes, conformance fixtures.
- Queue store on SQLite; route contract tests for every error code; gate and identity; kill
  switch.
- Verifier verdict matrix (`VERIFIED`/`FLAGGED`/`DROPPED`, revision case, chart refs, text rule,
  incompatible schema), and a test that `/api/chart/series` responses are unchanged after T-011.
- Panel components: lifecycle labels, cancel/retry, context chip, `ClaimText` rendering, a DOM
  scan that finds no unverified number in fixture results, disclosure fields, incompatible state.
- Copilot: identical default request; `LOCAL` fallback unchanged.
- Architecture test: no `quantsmith` import, `child_process` spawn of Python, or path into
  `services/` from `src/`.

### End-to-end (`test/agent-panel.spec.ts`, Playwright)

Real Node server, real worker, SQLite queue, a small fixture Gold SQLite database, and stub LLM
servers. Flows: queue three jobs and watch order; cancel and retry; worker offline then started;
clarification and reply; overlay chart rendered with provenance badges; "Open in Chart Studio";
production gate closed; incompatible result. Viewports 375×812, 768×1024, 1440×900 plus
keyboard-only. CI adds a Postgres service container for queue-store integration tests.

### Performance reference

Record runtime (CPU, memory, Python and Node versions, database backend) with p50/p95/max for job
creation, deterministic `chart.build` claim-to-result, and verification of 50 claims (AC-030).

## Rollout, Observability & Rollback

### Configuration

```text
settings/agent_workflows.json            MGC enabled; CURV and INFL disabled
settings/llm_profiles.json               anthropic-direct and deterministic enabled
AGENT_QUEUE_DB_URL                       required; sqlite:… locally, postgres://… in deploy
AGENT_SESSION_SECRET                     server-only HMAC key for requester IDs
AGENT_WORKFLOWS_DISABLED                 deploy-level off switch (both runtimes)
AGENT_WORKFLOWS_PRODUCTION_ENABLED       production gate
AGENT_WORKFLOWS_TRUSTED_ACCESS_BOUNDARY  opaque boundary reference
AGENT_TRUSTED_IDENTITY_HEADER            requester identity header behind the boundary
LLM_PROFILE_DEFAULT                      optional override of the default profile
ANTHROPIC_API_KEY                        existing
OPENAI_API_KEY, OPENAI_MODEL
LLM_GATEWAY_BASE_URL, LLM_GATEWAY_API_KEY, LLM_GATEWAY_MODEL
ANTHROPIC_GATEWAY_BASE_URL, ANTHROPIC_GATEWAY_API_KEY, ANTHROPIC_GATEWAY_MODEL
LOCAL_LLM_BASE_URL, LOCAL_LLM_MODEL
# worker only
QM_API_BASE_URL                          QuantMeridian base URL the reader calls
QM_API_EXTRA_HEADERS_ENV                 optional comma list of env vars holding headers for a protected deployment
AGENT_WORKER_ID, AGENT_WORKER_CONCURRENCY
QUANTSMITH_ROOT                          pinned checkout path (set by the image)
```

Placeholders only in `.env.example`; nothing with a `VITE_` prefix.

### Stages

1. **Local:** SQLite queue, worker on the host, `deterministic` plus optional
   `anthropic-direct`, fixture or local Gold. `MGC` only.
2. **Protected staging:** Postgres queue, worker container from the pinned image, small budgets,
   trusted staging boundary, stub-free provider calls with public data only.
3. **Internal pilot:** owner reviews `chart.build` quality on `MGC`, verification rates, and
   Data Ops; decides on `CURV` and `INFL`.
4. **Production:** separate owner sign-off on D-7 (hosting, identity boundary, budgets);
   production defaults stay off until then.

### Observability

Data Ops shows: worker heartbeats, readiness, QuantSmith commit and capabilities; queue depth and
oldest-queued age; outcomes and error codes by workflow; p50/p95 latency per stage; verification
verified/flagged/dropped rates; profile dry-run states and probe results; budget use per profile.
Initial alert thresholds: no ready heartbeat for 2 minutes; oldest queued job older than
5 minutes; any `QUANTSMITH_PIN_MISMATCH`; flagged-plus-dropped above 5% of LLM-workflow claims in a
day; a profile above 80% of its daily budget.

### Rollback

1. `node scripts/agent-control.mjs pause` (immediate) or `AGENT_WORKFLOWS_DISABLED=1`.
2. Disable a module in `agent_workflows.json` to remove its panel.
3. Redeploy the previous worker image to roll back a QuantSmith pin bump.
4. The Copilot's default profile reproduces today's request; reverting the route file restores the
   previous code path exactly.
5. For permanent removal, drop the `agent_*` tables; they are app-owned and untouched by Gold.

## Decisions And Remaining Gates

- Pending owner review: D-1 through D-9 in `SPEC.md`.
- Before implementation: choose the QuantSmith commit to pin (T-001) and confirm the worker host
  for staging.
- Production gate: worker hosting with CPU, memory, concurrency, and timeout budgets; the trusted
  boundary that supplies requester identity; per-profile budgets; reviewed packs for any
  pack-dependent workflow.
- Follow-ups needing their own specs: scheduled workflows, `MPUB` hand-off, a cross-module queue
  view, streaming, job chaining, `analysis.eda`, and a general `DashboardSpec` adapter.
