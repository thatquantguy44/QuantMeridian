# Tasks: Module Agent Workflows

- **Spec:** spec009-module-agent-workflows (`SPEC.md`, `PLAN.md`)
- **Last updated:** 2026-10-08 (validated against the code on `vix_vol_forecaster`)

> Ordered, testable units of work in QuantMeridian. Every task cites the requirements it advances
> and carries the Definition of Done below. QuantSmith-repository work is tracked separately
> (companion items Q-1–Q-8, task T-028) and is never done from this repository.

## Status Note

spec009 is a draft. The owner authorized Slice A (T-001–T-004) to start on 2026-10-07; decisions
D-1 through D-12 and D-14 in `SPEC.md` are not otherwise recorded as approved, so later slices
should confirm them first (D-13 — QuantSmith as the owner's local checkout, with the worker
beside it — is already decided). T-001 through T-004 are `done` (see "Slice A implementation
notes"); every other task is `todo` or `in-progress` — the ECOIQ slice (see "ECOIQ slice" below) built
partial, ECOIQ-only versions of T-005, T-008, T-009, T-010, T-012, and T-029, so those are
`in-progress`, not `done` — except that the yield and other non-additive parts of
T-021 and the `curve_levels` part of T-022 are `blocked` on companion items Q-1 and Q-2 (proven at
run time by the worker's `pit_level_semantics` and `pack_rules_applied` capabilities).
Implementation starts from the latest QuantMeridian `main`.

## Definition of Done (applies to every task)

- Code matches `SPEC.md` and `PLAN.md`; material deviations are approved and recorded before
  merge.
- Every behavior traces to a requirement, and every completed acceptance criterion has the
  deterministic evidence named in the Test Coverage Map.
- No number reaches the panel except through a verified claim; no chart draws data from anywhere
  but QuantMeridian's resolver; every simulated value carries its SIM label.
- No secret, credential-bearing URL, question text, inputs, context, prompt, desk row, or model
  output appears in the repository, logs, Data Ops output, or test snapshots.
- No QuantSmith code is imported, vendored, or spawned from Node. The worker loads QuantSmith only
  from a locally supplied copy (repository path or installed package) and never fetches it over
  the network.
- New Node and Python dependencies are pinned and exercised in clean-checkout CI.
- Typecheck, unit, contract, worker, build, and applicable end-to-end tests pass. Hosted CI
  reports the `needs_quantsmith` suites as not run, never as passed; they pass in
  `npm run verify:agent` on the owner's machine, and a pull request touching the worker,
  contracts, or formulas includes that run's report summary (pass counts and fingerprints).
- Configuration, Data Ops, environment examples, runbooks, and rollback steps are updated with
  the code they describe.
- UI changes are verified with Playwright at 375×812, 768×1024, and 1440×900 plus keyboard-only
  use, with no console errors.

## Task List

### Slice A - contracts, pins, and configuration

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-001 | Review the QuantSmith copy chosen for implementation (`0008`, `0028`, `0063`, `0070`, `0080`, `0081`, `0093`, `adapters/llm_runtime`, and the analytics, economists, securities-financing, and pack files cited in `PLAN.md`); implement the standard-library fingerprint tool `services/agent_worker/src/agent_worker/pin.py`; write `contracts/agent/quantsmith-pin.json`; update `docs/specs/spec005/QUANTSMITH_PIN.md` (code and assets digests, pointer to the JSON, "Reviewed for" including spec009); extend `scripts/check-quantsmith-pin.sh` (blocking record ↔ JSON agreement; advisory drift for a local copy at `QUANTSMITH_ROOT`, the current default path, or `../QuantSmith`; no network). | REQ-008, REQ-030, NFR-009 | done | Assessed copy: local checkout at `0134d403d5a336ce20e7abd7fb7a0935d7917114` (2026-10-06), recorded as information only. Nothing fetches QuantSmith. |
| T-002 | Write the JSON Schemas in `contracts/agent/` (`llm-profiles`, `agent-workflows`, `job`, `result`, `verification`, `metric-registry`, `quantsmith-pin`, `formula-vectors`) with `schema_version`; generate TypeScript types and Python models from them; add compatibility helpers on both sides and a CI check for uncommitted generation diffs. | REQ-007, REQ-019, NFR-009 | done | The result schema has no verdict field; the verification schema is written only by Node. |
| T-003 | Add `settings/agent_workflows.json` (`MGC`, `FUND`, `SLAB` enabled; `CURV`, `INFL` disabled; `chart.build`, `analysis.answer`, `secfin.carry` enabled; `story.build` and `brief.draft` with its three kinds disabled) and `settings/llm_profiles.json` (six profiles; only `anthropic-direct` and `deterministic` enabled); implement both validators, the reviewed `ELIGIBLE_AGENT_MODULES` set checked against `docs/gold-db/MODULE_DATA_AUDIT.md` (`IBAL`, `OPT`, `DESK`, `TASSIST`, `AI` never eligible), per-module context allowlists, and secret-shaped-value rejection; add `.env.example` placeholders. | REQ-001, REQ-005, REQ-007, REQ-019, REQ-029, NFR-005 | done | `anthropic-direct` is seeded with today's Copilot model and 1500-token limit. `SLAB` starts with no context fields. |
| T-004 | Implement `scripts/export-agent-metric-registry.ts` (`FRED_CATALOG`, the desk dataset registry from T-029, a reviewed unit/additivity/domain mapping, and `settings/agent_metric_synonyms.json`) generating `contracts/agent/generated/metric_registry.json`; add a Vitest drift check and the worker loader that builds the `0008` `SemanticLayer`. | REQ-009 | done | Funding and money-market series map to `short_term_markets_funding` as well as `rates_fixed_income`. Additivity defaults to `non_additive`; any relaxation needs a recorded rationale. |

#### Slice A implementation notes

Deviations and additions made while building Slice A (all recorded here per the Definition of
Done; none changes a requirement):

1. **Shared module policy.** Module eligibility, per-module context allowlists, known domain
   packs, and forbidden header names live in `contracts/agent/module-policy.json`, read by both
   the Node validator (`src/lib/server/agent/modulePolicy.ts`) and the worker
   (`agent_worker/settings.py`), instead of two copies of a code constant. A test checks every
   eligible module exists in `settings/modules.config.json` and has a section in
   `docs/gold-db/MODULE_DATA_AUDIT.md`. `IBAL` is not in that audit (it postdates it); it is
   checked only for existing as a module. Eligible: Gold-backed `MGC MKC ECON CURV INFL GCPI GPOL
   CRDT STAT REGIME SFE FUND BMRK BRA YCURV RVOL FCOST MOTN`; desk `SLAB PB COLL CASH` (PB, COLL,
   and CASH have no registered datasets yet).
2. **Plan correction: `sl_utilization`.** `getInventory().available` already excludes on-loan and
   restricted shares, so `sum(onLoan) / sum(available)` is not utilization. The denominator is
   `sum(available + onLoan + restricted)`, matching the page's per-row `utilization`. `PLAN.md`
   is updated; desk expressions are now `{fn, terms}` (a sum of products of fields).
3. **Registry units describe the Gold level.** Verified claims report raw `lin` levels, but the
   catalog `unit` describes the displayed, transformed value (CPI "% y/y" is an index level in
   Gold). The registry's `unit`/`display_unit` are the level's; for the 25 series the resolver
   transforms, `chart_unit`/`chart_display_unit` give what the chart shows, and the label drops
   "YoY/MoM/chg" and says "level". The 46 transformed or rescaled series are listed in
   `metricUnits.ts` with a rationale and need the owner's review of the FRED units. A new unusual
   series with no reviewed unit would be excluded (`lin_unit_unreviewed`); a test requires none.
4. **Registry additions.** `desk_datasets` (fields and dimensions, which the worker's readers
   need) and a domain override for `BAMLH0A0HYM2` (the catalog files high-yield OAS under RATES;
   it takes `credit_markets`). Curated synonyms must be globally unique (the keyword interpreter
   clarifies on ties); automatic ones (label, short name, id) never override them.
5. **Pulled forward from T-029.** The desk dataset registry declarations
   (`src/lib/server/agent/deskDatasets.ts`) and `DATA_SOURCE = "SIM"` on `securitiesLending.ts`,
   `collateral.ts`, and `cash.ts`, because T-004 needs them. The desk-data route, the worker
   token check, the shared loader, and the verifier use stay in T-029.
6. **Contract tooling.** `ajv` and `ajv-formats` (runtime), `json-schema-to-typescript` (dev);
   worker `jsonschema`, `pydantic`, and dev `datamodel-code-generator` with `black` and `isort`
   pinned so the drift check cannot flap. Generated: `src/lib/agent/contracts/*.generated.ts` and
   `agent_worker/contracts_generated/*.py`. Hand-written: `src/lib/agent/{compat,validate,
   secretShape}.ts`, `agent_worker/{contracts,settings,registry}.py` (`settings.py` is added to
   the planned layout). Readers ignore unknown additive fields; a worker `verdict`/`status` is
   rejected by the result schema.
7. **Fingerprint bytes.** The pin hashes file bytes as stored (no newline normalization), as the
   plan says; a copy checked out with different line endings reads as drift.
8. **CI seeded early.** `.github/workflows/ci.yml` now runs the pin record check and the
   registry check in `verify`, and a new `agent-worker` job (contract drift, ruff, hosted pytest
   with `needs_quantsmith` skipped). T-026 extends this rather than creating it.
9. **Worker project file.** `services/agent_worker/pyproject.toml` is minimal (T-012 completes
   it); `quantsmith` is deliberately not a dependency.

### ECOIQ slice (outside this spec's task list)

`ECOIQ.md` records an Economics & Macro module built on spec009's queue, profile, and verification
shape. Neither `SPEC.md` nor `PLAN.md` mentions it, so none of its work maps to a requirement ID
and none of it counts as completing a task above. Validated 2026-10-08 as built:

- Module `ECOIQ` (workflows `economics.explain`, `economics.transmission`, `economics.scenario`)
  added to `settings/modules.config.json`, `settings/agent_workflows.json` (enabled), and
  `contracts/agent/module-policy.json`; `src/lib/ecoiq`, `src/lib/server/ecoiq`, and the page.
- `agent/ecoiqExecutor.ts` (five LLM stages over a Gold evidence envelope, JSON/evidence-id
  validation, deterministic fallback), `agent/ecoiqVerification.ts` (ECOIQ-only checks), and the
  worker's `ecoiq.py` directive.
- `ECOIQ_VERIFICATION_MODE=permissive` exists for local testing.

Deviations from the spec to resolve before treating this as done (each needs a decision recorded in
`SPEC.md` or a change to the code):

1. **Pilot scope.** `SPEC.md` enables `MGC`, `FUND`, and `SLAB` only; `ECOIQ` is enabled and is not
   in the approved decisions. The test "enables MGC, FUND and SLAB; CURV and INFL stay off" does
   not assert that nothing else is on.
2. **Execution path.** The spec has the worker run QuantSmith agents; the ECOIQ stages run inside
   the Node `execute` route, which calls the LLM directly. `ECOIQ.md` says the worker uses the
   pinned QuantSmith chain, but `worker.py` only forwards the job to Node. The Definition of Done
   rule that no QuantSmith code runs from Node is not violated (no QuantSmith import), but the
   stages are Node prompts, not the pinned agents.
3. **Verification.** `verifyEcoIq` checks source and evidence-id references; it is not the claim
   vocabulary, text rule, or per-provenance verifier (T-017). Numeric prose from the LLM is not
   blocked in strict mode, and nothing reruns values against `resolveChartSeries`.
4. **Profile layer.** Resolved by T-005 (2026-10-08): stage calls go through the profile layer's
   resolution, client, retries, and redaction; `think: false` and `format` are passed as the call's
   `extra_body`. Budgets and usage accounting remain T-014.
5. **Gating.** Resolved by T-009 (2026-10-08): `execute` is behind the gate and requires the job's
   own requester or the worker token. Leases are still missing (T-012).
6. **CI hygiene.** `ruff check` reports 13 findings in `worker.py`, `ecoiq.py`, and
   `tests/test_worker.py` (line length, `datetime.UTC`); the `agent-worker` CI job runs ruff.

### Slice B - LLM profiles and the Copilot

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-005 | Build `src/lib/server/llm/` — registry loading, precedence and fail-closed resolution, `anthropic_messages` (`@anthropic-ai/sdk` with `baseURL`, `apiKey`/`authToken`, `defaultHeaders`) and `openai_chat_completions` (new pinned `openai` dependency) clients normalized to the `llm_runtime` contract shape, redaction, dry-run validation — and the shared conformance fixtures in `contracts/agent/fixtures/llm-profiles/`. | REQ-019, REQ-020, REQ-021, REQ-024, NFR-005, NFR-006 | done | No tools are ever sent. JSON outputs are schema-validated; invalid output is `LLM_OUTPUT_INVALID`, never repaired. **Done 2026-10-08:** `src/lib/server/llm/profiles.ts` (precedence, fail-closed `LLM_PROFILE_UNKNOWN`/`NOT_ALLOWED`/`UNAVAILABLE`, optional-workflow degrade to `deterministic` with `degraded_from`, per-profile dry-run states), `client.ts` (`callLlm`/`callLlmJson` normalized to the `llm_runtime` shape, retries, timeouts, `retryable`), `redact.ts`, and 21 conformance fixtures in `contracts/agent/fixtures/llm-profiles/` run by `conformance.test.ts`. **Deviation:** `openai_chat_completions` uses built-in `fetch`, not the `openai` package, so no new dependency is added (owner: the OpenAI SDK should not be a hard requirement); `anthropic_messages` uses `@anthropic-ai/sdk`. `agent/profileResolver.ts` is now a thin ECOIQ view over this layer (ECOIQ still calls a model only for OpenAI-compatible profiles, so the `anthropic-direct` default makes no calls). The worker's Python clients and the same fixtures on that side are T-014. |
| T-006 | Migrate `/api/copilot` to the profile layer: identical default request (model, system prompt, messages, token limit), unchanged `LOCAL` fallbacks, `profile` and `model` added to `AI` responses, badge updated on `/copilot`, usage recorded when the queue database is configured. | REQ-022 | todo | A mocked-SDK test proves the default request is byte-for-byte the same as today's. Validated 2026-10-08: `/api/copilot` is unchanged (no profile layer). |
| T-007 | Add the Data Ops profile card (dry-run states) and `POST /api/agent/profiles/[id]/probe` (one tiny completion; closed while the production gate is closed); prove no secret or credential-bearing URL is ever returned. | REQ-023, NFR-005 | todo | Probe results are metadata: status, latency, model as reported, error code. |

### Slice C - queue and API

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-008 | Implement `src/lib/server/agent/queueStore.ts`: DDL and migrations for SQLite and Postgres (`agent_schema_version`, `agent_control`, `agent_thread`, `agent_job` with `kind` and `inputs_json`, `agent_job_event`, `agent_job_artifact`, `agent_worker_heartbeat` with sourcing mode and fingerprints, `agent_usage_daily`), idempotent create, thread listing, cancel, retry, events, and the control row; SQLite unit tests plus a Postgres integration suite. | REQ-002, REQ-003, REQ-004, NFR-004 | done | `AGENT_QUEUE_DB_URL` is required — no fallback to `MACRO_DB_URL`. Permission failures are explicit errors. **Done 2026-10-08:** `queueStore.ts` implements the full DDL (`agent_schema_version`, `agent_control` key/value, `agent_thread`, `agent_job` with `kind`/`inputs_json`/lease/retention columns, `agent_job_event`, `agent_job_artifact`, `agent_worker_heartbeat`, `agent_usage_daily`), a cached idempotent migration that renames pre-T-008 tables to `*_legacy_v0` instead of dropping them, idempotent create (same key and body → existing job; different body → conflict) with the queued limit checked in the same transaction, thread listing, cancel (queued now / running flagged), retry as a new job with `retry_of`, events, control row, stats, and live worker capabilities. `queueStore.test.ts` runs on SQLite and, when `AGENT_TEST_POSTGRES_URL` is set, on Postgres in a throwaway schema (21 tests pass against the local Postgres 16). Lease claims, fencing, and sweeps belong to T-012; artifact and usage writes to T-014/T-024. |
| T-009 | Implement `gate.ts` and `identity.ts`: production gate (same detection as IBAL), deploy-level switch, `agent_control.paused` checks, `agent_sid` cookie with HMAC requester IDs, boundary identity header honored only behind an open gate, the `AGENT_WORKER_TOKEN` check (constant-time), and `scripts/agent-control.mjs`. | REQ-025, NFR-005 | done | Requester A must never read or cancel requester B's jobs. Browsers never receive the worker token. **Done 2026-10-08:** `gate.ts` (deploy switch, production gate, constant-time worker token), `identity.ts` (128-bit `agent_sid`, HMAC requester IDs, production boundary header only behind an open gate), `guard.ts`, `agent_control` pause (`queueStore`, worker claims, `scripts/agent-control.mjs`); all `/api/agent/jobs*` routes guarded. `execute` accepts the job's own requester or the worker bearer token. Dev outside production falls back to a fixed non-secret HMAC key; existing local jobs created under the old unsigned cookie ids are orphaned. Tests: `gate.test.ts`, `jobs/isolation.test.ts`, `queueStore.test.ts`, `test_worker.py`. |
| T-010 | Add the panel routes (`catalog`, `jobs` POST/GET, `jobs/[id]`, `cancel`, `retry`, `audit`, `health`) with limits, context and structured-input validation, idempotency, correlation IDs, every error code in `PLAN.md`, and the catalog's config ∩ worker-capability rule for workflows and kinds; route contract tests. | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-007, REQ-025, REQ-027, NFR-007, NFR-010 | in-progress | The thread GET runs pending verifications (bounded, idempotent) before returning. **Built 2026-10-08:** `catalog`, `jobs` POST (required `Idempotency-Key`, correlation IDs, module/workflow/context-allowlist/size/profile checks, queued limit, capability readiness, pause) and GET (thread view), `jobs/[id]`, `cancel`, `retry` (new job), `audit` (metadata only), `health`, and the `execute` route; error codes follow `PLAN.md` (`JOB_NOT_FOUND`, `JOB_NOT_QUEUED`, `JOB_NOT_RETRYABLE` are job-level extras). **Missing:** running pending verifications on thread GET (needs T-017); `AGENT_INPUTS_INVALID` checks beyond the schema (carry term validation lands with T-031); the audit record's fingerprints and replay fields (T-024); health's latency percentiles, verification rates, profile states, and budget use (T-020). The ECOIQ workflows now declare no required capabilities because the attended executor runs in Node and needs no worker. |
| T-011 | Extract `resolveChartSeries` from `src/app/api/chart/series/route.ts` into `src/lib/server/chartSeries.ts` without changing route behavior (snapshot tests pin current responses for `econ`, `fred`, `market`, `ERR`, and empty cases); the verifier uses the same function. | REQ-010, REQ-015 | done | Behavior-preserving refactor. The non-`lin` units divergence from `/api/econ/series` is recorded, not fixed here. **Done 2026-10-08:** `src/lib/server/chartSeries.ts` exports `resolveChartSeries(source, id, units?)`; the route is now a thin wrapper. `src/app/api/chart/series/route.test.ts` (12 characterization tests, written and passing against the old route before the extraction) pins `econ`, `fred`/transform, `market`/`lens`/`book`, `ERR`, empty, thrown-read, unconfigured-Gold, and missing-id responses. |

### Slice D - worker

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-012 | Scaffold `services/agent_worker` (pyproject with pinned dependencies and no `quantsmith` entry; no Dockerfile in version one; `scripts/agent-worker.sh` as `npm run agent:worker`, loading the repository's `.env`), sourcing (`QUANTSMITH_ROOT` path mode with the shadowing check, installed mode with `QUANTSMITH_ASSETS_ROOT`), readiness (fingerprints, schema version, registry, profile dry-runs, `QUANTSMITH_NOT_FOUND`), heartbeats with sourcing mode and fingerprints, the fenced claim loop with leases and stage-boundary cancellation, sweeps (lease expiry, TTL, retention purge), metadata-only telemetry, and confirm the `0070` envelope entry point in `quantsmith.orchestration` on the pinned copy. | REQ-004, REQ-008, REQ-027, REQ-028, REQ-030, NFR-004, NFR-005 | in-progress | Readiness failure means no claims, ever. A start-up test with outbound network blocked must pass in both modes. **Built so far (ECOIQ):** `worker.py` claims only `ECOIQ` jobs (Postgres `SKIP LOCKED` or SQLite) and calls the Node `execute` route. **Missing:** `pyproject` completion, `agent:worker` script, sourcing modes and shadowing check, readiness and fingerprints, heartbeats, leases and fencing, stage-boundary cancellation, sweeps, telemetry, the `0070` entry point. A claimed job whose call fails is marked `WORKER_LOST` and not retried; nothing re-queues it. |
| T-013 | Implement `readers.py` and `periods.py`: Gold series reader with optional headers and the `DB`-only rule; desk reader over the worker-only route with the bearer token and the `SIM` requirement; period encodings for every grain with round-trip tests; `Fact` construction; `evidence_rows` and `desk_rows` artifacts; content hashing. | REQ-010, REQ-033, NFR-002 | todo | A null observation is skipped and counted, never filled. |
| T-014 | Implement the Python profile clients (`anthropic`, `openai` SDKs) passing the shared conformance fixtures; retries and normalized errors; per-job caps and daily budgets with atomic usage accounting; declared fallback with disclosure. | REQ-020, REQ-021, REQ-026, NFR-006 | todo | A provider without usage data is charged the estimate and flagged. |
| T-015 | Implement `chart.build`: the deterministic splitter, `KeywordInterpreter` per fragment, `LlmInterpreter` (structured `ChartRequest`, also registered via `register_interpreter`), `validate_plan` → `authorize_plan` → `execute` → `choose_chart` per series, overlay and transform rules, range mapping with disclosure, pack caveats (or the no-packs notice) and chart conventions, `unsupported_chart` and clarification outcomes, result payload and disclosure; golden tests including `FUND` funding overlays, and deterministic replay. | REQ-006, REQ-011, REQ-017, REQ-024, NFR-002 | todo | The executed `Result` drives form, staleness, and hashes only; its values are never displayed. |
| T-016 | Implement start-up capability self-tests (`chart_line_form`, `domain_packs`, `pit_level_semantics`, `pack_rules_applied`, `desk_registry`, `carry_runtime`, `stm_pack`, `story_recipes`, `agent_contracts`, `claim_bound_drafting`) over fixture data, published in heartbeats and consumed by the catalog. | REQ-007, REQ-012, REQ-013, REQ-030 | todo | When a new QuantSmith copy satisfies Q-1/Q-2, or assets become available, the gated workflows become offerable without code changes here. |

### Slice D2 - securities finance

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-029 | Build the desk dataset registry (`src/lib/server/agent/deskDatasets.ts`) for `sl_inventory`, `sl_loans`, and `sl_borrow_demand` with the five initial `SLAB` metrics; add `DATA_SOURCE = "SIM"` to `securitiesLending.ts`, `collateral.ts`, and `cash.ts`; add the worker-only `GET /api/agent/desk-data/[dataset]` (bearer token, production gate, declared fields only, `DATA_CLASS_NOT_APPROVED` for any non-`SIM` source); share the dataset loader with the verifier. | REQ-009, REQ-010, REQ-015, REQ-029, REQ-033 | in-progress | `PB`, `COLL`, and `CASH` datasets are registered only when those modules are enabled after the pilot. **Built so far:** `deskDatasets.ts` registry and `DATA_SOURCE = "SIM"` (pulled forward under T-004). **Missing:** the worker-only `GET /api/agent/desk-data/[dataset]` route with token and gate, `DATA_CLASS_NOT_APPROVED`, the shared loader, and the verifier's use. |
| T-030 | Implement the formula set (`src/lib/server/agent/formulas.ts`: `days_act`, `leg_cost`, `net_financing_cost`, `funding_rate_bps`, `shocked_net_cost`, `pct_to_bps`, `spread_bps`, `share`, `aggregate`) and the shared vectors in `contracts/agent/fixtures/formulas/`; the worker's tests run spec `0028` and spec `0008` on the same vectors. | REQ-015, REQ-032, NFR-010 | todo | Vectors cover ACT/360, the zero floor on shocked rates, absent legs, and every aggregation. |
| T-031 | Implement `secfin.carry`: `CarryRequest` schema and `carry_request.v1.md` interpreter prompt, term validation, benchmark selection (historical start vs. future start), optional `SLAB` weighted-fee input as a `SIM` claim, spec `0028` `decompose`/`spread_sensitivity`/`check_point_in_time`, assumption, level, aggregate, and calculated claims, the carry table, flat-rate and look-ahead notices, `0063` and pack caveats; plus the panel's carry form with "edit and re-run". | REQ-017, REQ-024, REQ-031, REQ-032, NFR-002 | todo | The form path needs no LLM. Every user term is an `assumption` claim checked against the stored inputs. |
| T-032 | Implement simulated-data labeling: `ProvenanceBadge` (`GOLD`, `SIM`, `ASSUMPTION`, `CALC` with input provenances), the non-dismissable `SimDataBanner`, and text-not-color cues; component tests and an e2e check on a `SLAB` result. | REQ-034, NFR-008 | todo | Simulated values are never described as market data anywhere in the UI. |

### Slice E - verification and presentation

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-017 | Implement the claim vocabulary and text rule (worker `claims.py`; Node `claims.ts`) and `verifier.ts`: schema check, text rule, chart reference checks, per-provenance verification (`DB` via `resolveChartSeries` and `transforms.ts`, `SIM` via the desk loader, `USER` against stored inputs, calculated via the formula set with the `params` rule), `VERIFIED`/`FLAGGED`/`DROPPED` with reasons (including `revised_since_job`), conditional `verifying → succeeded`; fixtures for every path. | REQ-014, REQ-015, REQ-016, REQ-033, NFR-001 | todo | The worker cannot write a verdict; any verdict-like field fails schema validation. |
| T-018 | Build `src/features/agent-panel/` and mount it in `MGC`, `FUND`, and `SLAB`: thread, non-blocking composer, job cards with lifecycle labels and cancel/retry, context chip, workflow and profile selectors, polling with visibility pause, result blocks (`ChartBlock`, `ClaimTable`, `ClaimText`, caveats, clarification reply), `VerificationSummary`, disclosure drawer, incompatible-result state. | REQ-001, REQ-003, REQ-005, REQ-006, REQ-016, REQ-017, REQ-018, REQ-034, NFR-001, NFR-007, NFR-008, NFR-009 | todo | Status and provenance are never conveyed by color alone. `localStorage` access is wrapped in try/catch. |
| T-019 | Add the `agentChart` hand-off to `ChartStudio.tsx` (decode, validate, `applyTemplate`, `replaceState`), routing `econ`/`fred` to `MGC` and `market`/`lens` to `MKC`; invalid payloads show a notice and change nothing. | REQ-018 | todo | The studio re-resolves every series itself. |
| T-020 | Add the Data Ops agent card and finish `GET /api/agent/health`: heartbeats, readiness, sourcing mode, fingerprints and capabilities, queue depth, oldest-queued age, outcomes by code, stage latency percentiles, verification rates by provenance, profile states, budget use. | REQ-027, NFR-010 | todo | Metadata only; no question text. |

### Slice F - analysis and drafting workflows

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-021 | Implement `analysis.answer`: the plan gate, `answer()` with keyword or LLM interpreter and the `0070` envelope, insight-to-claim mapping (`level`, `concentration`, `change`, `trend`; other kinds listed as not displayed), claim-bound tables for breakdowns, placeholder templates, optional LLM narrator checked by `ground()` and the text rule with template fallback; golden cases for AC-012. | REQ-012, REQ-014, REQ-015, REQ-028, REQ-031 | todo | Desk metrics (`SLAB`) are `todo` now; the yield and other non-additive cases are `blocked` on Q-1 and Q-2. |
| T-022 | Implement `story.build`: `load_catalog` → `select` → `collect_evidence` → `build_story` → `render_json` → blocks; `0093` `bind_claim`/`validate_claim` then translation to `level` claims; draft-pack caveat; `policy_path` first; `curve_levels` (and enabling `CURV`) after Q-1/Q-2 and a tenor family in the registry. | REQ-013 | todo | `policy_path` part is `todo`; `curve_levels` part is `blocked`. `dashboard_handoff` output is stored only. |
| T-023 | Implement `brief.draft` with the kinds `macro_backdrop`, `funding_conditions`, and `desk_review`: drafter prompts from the pinned agent contracts and templates, `0063` conventions for funding, structured claims recomputed from evidence rows, unbound-numeral rejection with flagged template fallback, verification table block, simulated-data banner for `desk_review`; spec005 Phase 2's injected claims as permanent fixtures for every kind. | REQ-014, REQ-015, REQ-031, NFR-001 | todo | Never published or forwarded. Requires T-017, T-029, and T-030. |

### Slice G - hardening and rollout

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-024 | Implement the audit route and `agent_worker.replay` (deterministic jobs replay to identical bytes on a copy with the same fingerprints; LLM jobs replay from transcripts or report `non_reproducible`), plus retention tests for purge and deletion. | REQ-028, NFR-002 | todo | A replay never claims equivalence it cannot show. |
| T-025 | Security suite: secret scan over `settings/` and `contracts/`, log capture across Node and worker, prompt-injection fixtures (requests for SQL, other modules, unregistered metrics, raw data), context and input fuzzing, data-class and eligible-module enforcement, desk route token and `DATA_CLASS_NOT_APPROVED` tests, a source scan proving the worker never imports the spec `0023`, `0035`, or `0067` runtimes. | REQ-024, REQ-029, REQ-031, NFR-005 | todo | Failures here block release. |
| T-026 | Split verification per D-14. Hosted CI: a worker job (ruff, `pytest -m "not needs_quantsmith"`, conformance fixtures) whose summary lists the `needs_quantsmith` suites as not run, plus a Postgres queue-store job. Local: `scripts/verify-agent.sh` as `npm run verify:agent` — the full worker suite, formula vectors against spec `0028`, capability self-tests, then Playwright `test/agent-panel.spec.ts` (real worker, stub LLM servers, fixture Gold SQLite, viewport and keyboard runs) and recorded benchmarks — writing `.data/verify-agent/report.json` with pass counts, QuantSmith fingerprints, and the QuantMeridian commit. | NFR-003, NFR-008, NFR-010 | todo | Hosted CI never fetches QuantSmith. QuantSmith imports stay confined to `sourcing.py` and `workflows/` so the rest of the worker tests run in hosted CI. |
| T-027 | Documentation and rollout: `services/agent_worker/README.md` (setting up the worker on the owner's machine — virtual environment, `QUANTSMITH_ROOT` pointing at the local checkout, `npm run agent:worker`, pointing it at the local dev server or a deployed app's queue database and API; the installed-package alternative; no network fetch), a worker section in `docs/deployment/DEPLOY.md`, `.env.example`, a Data Ops runbook (worker offline, pause/resume, budgets, reviewing and re-pinning after updating the QuantSmith checkout, rollback), and the post-pilot configuration change enabling further modules after owner sign-off. | REQ-025, REQ-030 | todo | Production stays off until D-7's gates are signed off. The spec005 note pointing to spec009 already exists. |
| T-028 | Track the QuantSmith companion items Q-1–Q-8 in the QuantSmith repository, record outcomes here, and re-pin through T-001's process when they land. | REQ-012, REQ-013 | in-progress | Owner decides whether and how to file them; no QuantSmith edits from this repository. 2026-10-07: Q-1 and Q-2 done, Q-5 partly, Q-6 planned (see the companion table); re-pinned to QuantSmith `main` `c234119` (code `…e7df1930`, assets `…669596f9`; a wheel built from it has the same code digest). Q-3, Q-4, Q-7, and Q-8 remain open. |

Status values: `todo` | `in-progress` | `blocked` | `done`.

## Test Coverage Map

| Acceptance criterion | Test(s) | Status |
| --- | --- | --- |
| AC-001 | `src/lib/server/agent/config.test.ts::module enablement`; `test/agent-panel.spec.ts::panel renders only on enabled modules` | partial — `config.test.ts` enablement checks pass; the e2e panel test does not exist |
| AC-002 | `queueStore.test.ts::idempotent create`; `agent-panel.spec.ts::worker offline then started` | partial — idempotent create passes on SQLite and Postgres; the worker-offline e2e is not written |
| AC-003 | `queueStore.test.ts::thread FIFO`; `agent-panel.spec.ts::queue three, cancel, retry, reload` | partial — thread order, cancel, and retry pass in `queueStore.test.ts`; the e2e is not written |
| AC-004 | `queueStore.test.ts::queued limit`; `services/agent_worker/tests/test_queue.py::test_lease_expiry_requeues_then_fails` | partial — `queueStore.test.ts` queued limit passes; the lease-expiry test is T-012 |
| AC-005 | `jobs.route.test.ts::context allowlist and size`; `ContextChip.test.tsx::shows sent context` | todo |
| AC-006 | `test_chart_build.py::test_ambiguous_request_clarifies`; `agent-panel.spec.ts::clarification reply links jobs` | todo |
| AC-007 | `catalog.route.test.ts::workflow without capability hidden and rejected` | done — `catalog/route.test.ts` (hidden) and `jobs/route.test.ts` (rejected as `WORKFLOW_NOT_READY`) pass |
| AC-008 | `test_readiness.py::test_code_fingerprint_mismatch_blocks_claims`, `::test_assets_fingerprint_mismatch_blocks_claims`; `architecture.test.ts::no quantsmith in node` | todo |
| AC-009 | `export-agent-metric-registry.test.ts::no drift`; `test_registry.py::test_plan_outside_registry_rejected` | partial — `metricRegistry.test.ts` (no drift) and `test_registry.py::test_plans_may_only_name_registry_metrics` pass; test names differ from the map |
| AC-010 | `test_readers.py::test_non_db_provenance_is_unavailable` | todo |
| AC-011 | `test_chart_build.py::test_overlay_dgs2_dgs10_keyword`, `::test_mixed_units_clarify`, `::test_kpi_form_unsupported`; `agent-panel.spec.ts::overlay chart renders with provenance` | todo |
| AC-012 | `test_analysis_answer.py::test_desk_revenue_by_borrower`, `::test_nonadditive_plan_unsupported_metric`, `::test_level_is_latest_and_change_in_bps` | todo (yield case blocked) |
| AC-013 | `test_story_build.py::test_curve_levels_order_and_no_tenor_sum` | blocked |
| AC-014 | `test_brief_draft.py::test_unbound_numeral_rejected`, `::test_claim_bound_output[macro_backdrop, funding_conditions, desk_review]`; `verifier.test.ts::text rule` | todo |
| AC-015 | `verifier.test.ts::verdict matrix across DB, SIM, USER, and calculated claims` | todo |
| AC-016 | `ClaimText.test.tsx`; `ResultBlocks.test.tsx::no unverified numbers in DOM` | todo |
| AC-017 | `DisclosureDrawer.test.tsx::all disclosure fields` | todo |
| AC-018 | `ChartStudio.agentChart.test.tsx`; `agent-panel.spec.ts::open in chart studio` | todo |
| AC-019 | `llm/profiles.test.ts::registry schema and secret scan` | done — `llm/profileConfig.test.ts` (registry schema and secret scan) and `config.test.ts::secrets` pass |
| AC-020 | `llm/profiles.test.ts::precedence and fail-closed`; `test_profiles.py::test_precedence_and_fail_closed` | partial — Node `conformance.test.ts` passes (precedence and fail-closed); `test_profiles.py` is T-014 |
| AC-021 | `llm/conformance.test.ts`; `test_profiles_conformance.py`; stub gateway tests on both sides | partial — Node `conformance.test.ts` and `client.test.ts` (stub fetch) pass; worker side is T-014 |
| AC-022 | `copilot.route.test.ts::default profile request identical`; `::local fallback unchanged` | todo |
| AC-023 | `profiles.route.test.ts::dry-run states redacted` | todo |
| AC-024 | `test_interpreter.py::test_invalid_llm_outputs_never_execute`; `test_secfin_carry.py::test_unknown_benchmark_rejected` | todo |
| AC-025 | `gate.test.ts::production gate`, `::kill switch`, `::requester isolation` | done — `gate.test.ts` and `jobs/isolation.test.ts` pass (names differ from the map) |
| AC-026 | `test_budget.py::test_budget_exceeded_before_call`, `::test_per_job_cap`, `::test_usage_recorded` | todo |
| AC-027 | `health.route.test.ts::states including missing assets`; Data Ops agent card component test | todo |
| AC-028 | `test_replay.py::test_deterministic_replay_identical`; `test_retention.py::test_purge_and_delete` | todo |
| AC-029 | `config.test.ts::ineligible modules rejected`; `test_profiles.py::test_data_class_enforcement` | partial — `config.test.ts::module eligibility` passes; `test_profiles.py::test_data_class_enforcement` does not exist |
| AC-030 | Benchmark suite with retained p50/p95/max and runtime manifest | todo |
| AC-031 | `agent-panel.spec.ts` viewport and keyboard runs (including the carry form) with overlap and console assertions | todo |
| AC-032 | `ResultBlocks.test.tsx::incompatible schema version` | todo |
| AC-033 | Hosted CI: typecheck, Vitest (with TypeScript formula vectors), build, worker job (`not needs_quantsmith`, not-run summary), Postgres job. Local: `npm run verify:agent` report with full worker suite, `0028` vectors, end-to-end, and fingerprints | todo |
| AC-034 | `test_sourcing.py::test_path_mode_not_shadowed`, `::test_installed_mode_without_assets`, `::test_startup_with_network_blocked`; `catalog.route.test.ts::offered workflows without assets` | todo |
| AC-035 | `catalog.route.test.ts::pilot modules offer securities-finance workflows`; `test_security.py::test_no_excluded_runtime_imports` | todo |
| AC-036 | `test_secfin_carry.py::test_sofr_plus_spread_carry`, `::test_lookahead_flag`, `::test_flat_rate_notice`; `verifier.test.ts::calculated claims` | todo |
| AC-037 | `deskData.route.test.ts::token and SIM requirement`; `deskDatasets.test.ts::non-SIM source refused`; `verifier.test.ts::desk aggregate` | todo |
| AC-038 | `SimDataBanner.test.tsx`; `ProvenanceBadge.test.tsx::mixed provenance`; `agent-panel.spec.ts::SLAB answer shows simulated-data banner` | todo |

## QuantSmith Companion Items

| ID | Item | Blocks | Status |
| --- | --- | --- | --- |
| Q-1 | Complete `0080` T-021/T-022: apply `0081` packs in the answer path; unreviewed-pack caveat. | Non-additive plans in `analysis.answer`; insight sections of `story.build` | done — QuantSmith `eb45d66` (`0080` T-021–T-023, PR #108); in the current pin |
| Q-2 | Point-in-time level semantics for non-additive and semi-additive metrics (latest observation; no cross-dimension sums). | Same as Q-1 | done — same commit: levels of stock and rate metrics read the latest period; groups of non-additive metrics are never summed; `pct`/`bps` changes in basis points |
| Q-3 | Review the `economics_macro`, `rates_fixed_income`, `securities_financing_prime`, and `short_term_markets_funding` packs. | Production use of pack-dependent workflows | open |
| Q-4 | Versioned QuantSmith releases whose version changes with content. | Nothing (optional; fingerprints remain the check) | open |
| Q-5 | Ship knowledge packs, agent contracts, and templates with the package or as a versioned assets bundle. | Nothing (optional; installed mode otherwise needs `QUANTSMITH_ASSETS_ROOT`) | partly done — QuantSmith `aaf62de` bundles the `0081` analytics packs in the wheel (`quantsmith/_bundled/analytics_packs/`); visualization and short-term-markets packs, agent contracts, and templates still need an assets root |
| Q-6 | Gateway profile document in `adapters/llm_runtime/`. | Nothing (optional) | planned — QuantSmith `0080` REQ-019/T-024 adds provider-neutral LLM backends and is being aligned to read this repository's `llm-profiles/1` format, so one `settings/llm_profiles.json` serves both |
| Q-7 | Multi-series time-series form in `0080`. | Nothing; retires spec009's overlay composition | open |
| Q-8 | Securities-financing visualization pack (`0093`). | `story.build` in `FUND` and `SLAB` | open |

## Follow-ups

Deferred to their own specs:

- Scheduled agent workflows on QuantSmith `0055`/`0060`.
- Offering verified results to `MPUB`'s Chart Queue as `Candidate` items.
- A cross-module queue view, streaming responses, and job chaining.
- IBAL run review by the securities-financing agents (settling spec007's session-only rule for
  generated runs and spec005 item 6's dispatcher path).
- Real or confidential desk-book data: retention, provider approval, and possibly local-only
  profiles.
- A worker on a host other than the owner's machine (for example a container), with its own
  reviewed QuantSmith copy supplied without a network fetch.
- `analysis.eda` over Gold's lead-lag, correlation, and structural-break tables.
- A general `DashboardSpec` → `MGC`/`MKC` adapter (spec005 item 4 in full).
- Native cloud-IAM provider flows (Bedrock, Vertex, Entra ID) if gateways prove insufficient.
- Reconciling non-`lin` unit handling between `/api/chart/series` and `/api/econ/series`.
