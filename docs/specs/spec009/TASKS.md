# Tasks: Module Agent Workflows

- **Spec:** spec009-module-agent-workflows (`SPEC.md`, `PLAN.md`)
- **Last updated:** 2026-10-06

> Ordered, testable units of work in QuantMeridian. Every task cites the requirements it advances
> and carries the Definition of Done below. QuantSmith-repository work is tracked separately
> (companion items Q-1–Q-7, task T-028) and is never done from this repository.

## Status Note

spec009 is a draft pending owner review; no task may start until decisions D-1 through D-9 in
`SPEC.md` are approved. All tasks are `todo` except T-021 and the `curve_levels` half of T-022,
which are `blocked` on companion items Q-1 and Q-2 (proven at run time by the worker's
`pit_level_semantics` and `pack_rules_applied` capabilities). Implementation starts from the
latest QuantMeridian `main`.

## Definition of Done (applies to every task)

- Code matches `SPEC.md` and `PLAN.md`; material deviations are approved and recorded before
  merge.
- Every behavior traces to a requirement, and every completed acceptance criterion has the
  deterministic evidence named in the Test Coverage Map.
- No number reaches the panel except through a verified claim; no chart draws data from anywhere
  but QuantMeridian's resolver.
- No secret, credential-bearing URL, question text, context, prompt, or model output appears in
  the repository, logs, Data Ops output, or test snapshots.
- No QuantSmith code is imported, vendored, or spawned from Node; the worker installs QuantSmith
  only from the pinned checkout.
- New Node and Python dependencies are pinned and exercised in clean-checkout CI.
- Typecheck, unit, contract, worker, build, and applicable end-to-end tests pass.
- Configuration, Data Ops, environment examples, runbooks, and rollback steps are updated with
  the code they describe.
- UI changes are verified with Playwright at 375×812, 768×1024, and 1440×900 plus keyboard-only
  use, with no console errors.

## Task List

### Slice A - contracts, pins, and configuration

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-001 | Re-review QuantSmith at the commit chosen for implementation (`0008`, `0070`, `0080`, `0081`, `0093`, `adapters/llm_runtime`, the analytics, economists, and pack files cited in `PLAN.md`); update `docs/specs/spec005/QUANTSMITH_PIN.md` (commit, date, version, "Reviewed for" including spec009); write `services/agent_worker/quantsmith.lock`; extend `scripts/check-quantsmith-pin.sh` to fail when the lock and the record disagree and to accept a configurable sibling path (`QUANTSMITH_DIR`, defaulting to the current path, then `../QuantSmith`). | REQ-008, NFR-009 | todo | Assessed candidate: `0134d403d5a336ce20e7abd7fb7a0935d7917114` (2026-10-06). Never pin a branch. |
| T-002 | Write the JSON Schemas in `contracts/agent/` (`llm-profiles`, `agent-workflows`, `job`, `result`, `verification`, `metric-registry`) with `schema_version`; generate TypeScript types and Python models from them; add compatibility helpers on both sides and a CI check for uncommitted generation diffs. | REQ-007, REQ-019, NFR-009 | todo | The result schema has no verdict field; the verification schema is written only by Node. |
| T-003 | Add `settings/agent_workflows.json` (`MGC` enabled; `CURV`, `INFL` disabled; four workflows with `analysis.answer`, `story.build`, `brief.draft` disabled) and `settings/llm_profiles.json` (six profiles; only `anthropic-direct` and `deterministic` enabled); implement both validators, the reviewed `ELIGIBLE_AGENT_MODULES` set checked against `docs/gold-db/MODULE_DATA_AUDIT.md`, per-module context allowlists, and secret-shaped-value rejection; add `.env.example` placeholders. | REQ-001, REQ-005, REQ-007, REQ-019, REQ-029, NFR-005 | todo | `anthropic-direct` is seeded with today's Copilot model and 1500-token limit. |
| T-004 | Implement `scripts/export-agent-metric-registry.ts` (`FRED_CATALOG` plus a reviewed unit/additivity/domain mapping and `settings/agent_metric_synonyms.json`) generating `contracts/agent/generated/metric_registry.json`; add a Vitest drift check and the worker loader that builds the `0008` `SemanticLayer`. | REQ-009 | todo | Additivity defaults to `non_additive`; any relaxation needs a recorded rationale. Per-series metrics only in version one. |

### Slice B - LLM profiles and the Copilot

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-005 | Build `src/lib/server/llm/` — registry loading, precedence and fail-closed resolution, `anthropic_messages` (`@anthropic-ai/sdk` with `baseURL`, `apiKey`/`authToken`, `defaultHeaders`) and `openai_chat_completions` (new pinned `openai` dependency) clients normalized to the `llm_runtime` contract shape, redaction, dry-run validation — and the shared conformance fixtures in `contracts/agent/fixtures/llm-profiles/`. | REQ-019, REQ-020, REQ-021, REQ-024, NFR-005, NFR-006 | todo | No tools are ever sent. JSON outputs are schema-validated; invalid output is `LLM_OUTPUT_INVALID`, never repaired. |
| T-006 | Migrate `/api/copilot` to the profile layer: identical default request (model, system prompt, messages, token limit), unchanged `LOCAL` fallbacks, `profile` and `model` added to `AI` responses, badge updated on `/copilot`, usage recorded when the queue database is configured. | REQ-022 | todo | A mocked-SDK test proves the default request is byte-for-byte the same as today's. |
| T-007 | Add the Data Ops profile card (dry-run states) and `POST /api/agent/profiles/[id]/probe` (one tiny completion; closed while the production gate is closed); prove no secret or credential-bearing URL is ever returned. | REQ-023, NFR-005 | todo | Probe results are metadata: status, latency, model as reported, error code. |

### Slice C - queue and API

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-008 | Implement `src/lib/server/agent/queueStore.ts`: DDL and migrations for SQLite and Postgres (`agent_schema_version`, `agent_control`, `agent_thread`, `agent_job`, `agent_job_event`, `agent_job_artifact`, `agent_worker_heartbeat`, `agent_usage_daily`), idempotent create, thread listing, cancel, retry, events, and the control row; SQLite unit tests plus a Postgres integration suite. | REQ-002, REQ-003, REQ-004, NFR-004 | todo | `AGENT_QUEUE_DB_URL` is required — no fallback to `MACRO_DB_URL`. Permission failures are explicit errors. |
| T-009 | Implement `gate.ts` and `identity.ts`: production gate (same detection as IBAL), deploy-level switch, `agent_control.paused` checks, `agent_sid` cookie with HMAC requester IDs, boundary identity header honored only behind an open gate, and `scripts/agent-control.mjs`. | REQ-025, NFR-005 | todo | Requester A must never read or cancel requester B's jobs. |
| T-010 | Add the `/api/agent/*` routes (`catalog`, `jobs` POST/GET, `jobs/[id]`, `cancel`, `retry`, `audit`, `health`) with limits, context validation, idempotency, correlation IDs, every error code in `PLAN.md`, and the catalog's config ∩ worker-capability rule; route contract tests. | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-007, REQ-025, REQ-027, NFR-007, NFR-010 | todo | The thread GET runs pending verifications (bounded, idempotent) before returning. |
| T-011 | Extract `resolveChartSeries` from `src/app/api/chart/series/route.ts` into `src/lib/server/chartSeries.ts` without changing route behavior (snapshot tests pin current responses for `econ`, `fred`, `market`, `ERR`, and empty cases); the verifier uses the same function. | REQ-010, REQ-015 | todo | Behavior-preserving refactor. The non-`lin` units divergence from `/api/econ/series` is recorded, not fixed here. |

### Slice D - worker

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-012 | Scaffold `services/agent_worker` (pyproject with pinned dependencies, Dockerfile that clones QuantSmith at the lock commit and installs from that checkout, `QUANTSMITH_ROOT`), readiness (PEP 610 commit, schema version, registry, strict pack load, profile dry-runs), heartbeats, the fenced claim loop with leases and stage-boundary cancellation, sweeps (lease expiry, TTL, retention purge), metadata-only telemetry, and confirm the `0070` envelope entry point in `quantsmith.orchestration` at the pin. | REQ-004, REQ-008, REQ-027, REQ-028, NFR-004, NFR-005 | todo | Readiness failure means no claims, ever. Logs never contain message, context, prompt, or output text. |
| T-013 | Implement `reader.py` and `periods.py`: series-route client with optional headers, `DB`-only provenance rule, period encodings for every grain with round-trip tests, `Fact` construction, evidence-row artifacts, and content hashing. | REQ-010, NFR-002 | todo | A null observation is skipped and counted, never filled. |
| T-014 | Implement the Python profile clients (`anthropic`, `openai` SDKs) passing the shared conformance fixtures; retries and normalized errors; per-job caps and daily budgets with atomic usage accounting; declared fallback with disclosure. | REQ-020, REQ-021, REQ-026, NFR-006 | todo | A provider without usage data is charged the estimate and flagged. |
| T-015 | Implement `chart.build`: the deterministic splitter, `KeywordInterpreter` per fragment, `LlmInterpreter` (structured `ChartRequest`, also registered via `register_interpreter`), `validate_plan` → `authorize_plan` → `execute` → `choose_chart` per series, overlay and transform rules, range mapping with disclosure, pack caveats and chart conventions, `unsupported_chart` and clarification outcomes, result payload and disclosure; golden tests and deterministic replay. | REQ-006, REQ-011, REQ-017, REQ-024, NFR-002 | todo | The executed `Result` drives form, staleness, and hashes only; its values are never displayed. |
| T-016 | Implement start-up capability self-tests (`chart_line_form`, `pit_level_semantics`, `pack_rules_applied`, `story_recipes`, `claim_bound_drafting`) over fixture data, published in heartbeats and consumed by the catalog. | REQ-007, REQ-012, REQ-013 | todo | When a pin bump satisfies Q-1/Q-2, the gated workflows become offerable without code changes here. |

### Slice E - verification and presentation

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-017 | Implement the claim vocabulary and text rule (worker `claims.py`; Node `claims.ts`) and `verifier.ts`: schema check, text rule, chart reference checks, per-claim re-resolution and recomputation with `transforms.ts`, `VERIFIED`/`FLAGGED`/`DROPPED` with reasons (including `revised_since_job`), conditional `verifying → succeeded`; fixtures for every path. | REQ-014, REQ-015, REQ-016, NFR-001 | todo | The worker cannot write a verdict; any verdict-like field fails schema validation. |
| T-018 | Build `src/features/agent-panel/` and mount it in `MGC`: thread, non-blocking composer, job cards with lifecycle labels and cancel/retry, context chip, workflow and profile selectors, polling with visibility pause, result blocks (`ChartBlock`, `ClaimText`, caveats, clarification reply), `VerificationSummary`, disclosure drawer, incompatible-result state. | REQ-001, REQ-003, REQ-005, REQ-006, REQ-016, REQ-017, REQ-018, NFR-001, NFR-007, NFR-008, NFR-009 | todo | Status is never conveyed by color alone. `localStorage` access is wrapped in try/catch. |
| T-019 | Add the `agentChart` hand-off to `ChartStudio.tsx` (decode, validate, `applyTemplate`, `replaceState`), routing `econ`/`fred` to `MGC` and `market`/`lens` to `MKC`; invalid payloads show a notice and change nothing. | REQ-018 | todo | The studio re-resolves every series itself. |
| T-020 | Add the Data Ops agent card and finish `GET /api/agent/health`: heartbeats, readiness, commit and capabilities, queue depth, oldest-queued age, outcomes by code, stage latency percentiles, verification rates, profile states, budget use. | REQ-027, NFR-010 | todo | Metadata only; no question text. |

### Slice F - gated workflows

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-021 | Implement `analysis.answer`: `answer()` with keyword or LLM interpreter and the `0070` envelope, insight-to-claim mapping (`level`, `change`, `trend`; other kinds listed as not displayed), placeholder templates, optional LLM narrator checked by `ground()` and the text rule with template fallback; golden cases for AC-012. | REQ-012, REQ-014, REQ-015, REQ-028 | blocked | Blocked on Q-1 and Q-2. Enable in configuration only after the capabilities are reported. |
| T-022 | Implement `story.build`: `load_catalog` → `select` → `collect_evidence` → `build_story` → `render_json` → blocks; `0093` `bind_claim`/`validate_claim` then translation to `level` claims; draft-pack caveat; `policy_path` first; `curve_levels` (and enabling `CURV`) after Q-1/Q-2 and a tenor family in the registry. | REQ-013 | todo | `policy_path` part is `todo`; `curve_levels` part is `blocked`. `dashboard_handoff` output is stored only. |
| T-023 | Implement `brief.draft`: drafter prompt from the pinned `macro_backdrop_summarizer` contract and template, structured claims recomputed from evidence rows, unbound-numeral rejection with flagged template fallback, verification table block; spec005 Phase 2's injected claims as permanent fixtures. | REQ-014, REQ-015, NFR-001 | todo | Never published or forwarded. Requires T-017. |

### Slice G - hardening and rollout

| ID | Task | Covers | Status | Notes |
| --- | --- | --- | --- | --- |
| T-024 | Implement the audit route and `agent_worker.replay` (deterministic jobs replay to identical bytes; LLM jobs replay from transcripts or report `non_reproducible`), plus retention tests for purge and deletion. | REQ-028, NFR-002 | todo | A replay never claims equivalence it cannot show. |
| T-025 | Security suite: secret scan over `settings/` and `contracts/`, log capture across Node and worker, prompt-injection fixtures (requests for SQL, other modules, unregistered metrics, raw data), context fuzzing, data-class and eligible-module enforcement. | REQ-024, REQ-029, NFR-005 | todo | Failures here block release. |
| T-026 | CI: worker job (ruff, pytest, conformance), Postgres integration job, Playwright `test/agent-panel.spec.ts` with real worker, stub LLM servers, and fixture Gold SQLite, viewport and keyboard runs, and recorded benchmarks. | NFR-003, NFR-008, NFR-010 | todo | Benchmark artifacts record the runtime profile. |
| T-027 | Documentation and rollout: `services/agent_worker/README.md`, a worker section in `docs/deployment/DEPLOY.md`, `.env.example`, a Data Ops runbook (pause/resume, budgets, pin bumps, rollback), the dated spec005 note, and the post-pilot configuration change enabling `CURV`/`INFL` after owner sign-off. | REQ-025 | todo | Production stays off until D-7's gates are signed off. |
| T-028 | Track the QuantSmith companion items Q-1–Q-7 in the QuantSmith repository, record outcomes here, and bump the pin through T-001's process when they land. | REQ-012, REQ-013 | todo | Owner decides whether and how to file them; no QuantSmith edits from this repository. |

Status values: `todo` | `in-progress` | `blocked` | `done`.

## Test Coverage Map

| Acceptance criterion | Test(s) | Status |
| --- | --- | --- |
| AC-001 | `src/lib/server/agent/config.test.ts::module enablement`; `test/agent-panel.spec.ts::panel renders only on enabled modules` | todo |
| AC-002 | `queueStore.test.ts::idempotent create`; `agent-panel.spec.ts::worker offline then started` | todo |
| AC-003 | `queueStore.test.ts::thread FIFO`; `agent-panel.spec.ts::queue three, cancel, retry, reload` | todo |
| AC-004 | `queueStore.test.ts::queued limit`; `services/agent_worker/tests/test_queue.py::test_lease_expiry_requeues_then_fails` | todo |
| AC-005 | `jobs.route.test.ts::context allowlist and size`; `ContextChip.test.tsx::shows sent context` | todo |
| AC-006 | `test_chart_build.py::test_ambiguous_request_clarifies`; `agent-panel.spec.ts::clarification reply links jobs` | todo |
| AC-007 | `catalog.route.test.ts::blocked workflow hidden and rejected` | todo |
| AC-008 | `test_readiness.py::test_pin_mismatch_blocks_claims`; `architecture.test.ts::no quantsmith in node` | todo |
| AC-009 | `export-agent-metric-registry.test.ts::no drift`; `test_registry.py::test_plan_outside_registry_rejected` | todo |
| AC-010 | `test_reader.py::test_non_db_provenance_is_unavailable` | todo |
| AC-011 | `test_chart_build.py::test_overlay_dgs2_dgs10_keyword`, `::test_mixed_units_clarify`, `::test_kpi_form_unsupported`; `agent-panel.spec.ts::overlay chart renders with provenance` | todo |
| AC-012 | `catalog.route.test.ts::analysis.answer gated`; `test_analysis_answer.py::test_level_is_latest_and_change_in_bps` | blocked |
| AC-013 | `test_story_build.py::test_curve_levels_order_and_no_tenor_sum` | blocked |
| AC-014 | `test_brief_draft.py::test_unbound_numeral_rejected`; `verifier.test.ts::text rule` | todo |
| AC-015 | `verifier.test.ts::verdict matrix` | todo |
| AC-016 | `ClaimText.test.tsx`; `ResultBlocks.test.tsx::no unverified numbers in DOM` | todo |
| AC-017 | `DisclosureDrawer.test.tsx::all disclosure fields` | todo |
| AC-018 | `ChartStudio.agentChart.test.tsx`; `agent-panel.spec.ts::open in chart studio` | todo |
| AC-019 | `llm/profiles.test.ts::registry schema and secret scan` | todo |
| AC-020 | `llm/profiles.test.ts::precedence and fail-closed`; `test_profiles.py::test_precedence_and_fail_closed` | todo |
| AC-021 | `llm/conformance.test.ts`; `test_profiles_conformance.py`; stub gateway tests on both sides | todo |
| AC-022 | `copilot.route.test.ts::default profile request identical`; `::local fallback unchanged` | todo |
| AC-023 | `profiles.route.test.ts::dry-run states redacted` | todo |
| AC-024 | `test_interpreter.py::test_invalid_llm_outputs_never_execute` | todo |
| AC-025 | `gate.test.ts::production gate`, `::kill switch`, `::requester isolation` | todo |
| AC-026 | `test_budget.py::test_budget_exceeded_before_call`, `::test_per_job_cap`, `::test_usage_recorded` | todo |
| AC-027 | `health.route.test.ts::states`; Data Ops agent card component test | todo |
| AC-028 | `test_replay.py::test_deterministic_replay_identical`; `test_retention.py::test_purge_and_delete` | todo |
| AC-029 | `config.test.ts::ineligible modules rejected`; `test_profiles.py::test_data_class_enforcement` | todo |
| AC-030 | Benchmark suite with retained p50/p95/max and runtime manifest | todo |
| AC-031 | `agent-panel.spec.ts` viewport and keyboard runs with overlap and console assertions | todo |
| AC-032 | `ResultBlocks.test.tsx::incompatible schema version` | todo |
| AC-033 | Clean-checkout CI: typecheck, Vitest, build, worker job, Postgres job, end-to-end | todo |

## QuantSmith Companion Items

| ID | Item | Blocks | Status |
| --- | --- | --- | --- |
| Q-1 | Complete `0080` T-021/T-022: apply `0081` packs in the answer path; unreviewed-pack caveat. | `analysis.answer`; insight sections of `story.build` | open |
| Q-2 | Point-in-time level semantics for non-additive and semi-additive metrics (latest observation; no cross-dimension sums). | Same as Q-1 | open |
| Q-3 | Review `economics_macro` and `rates_fixed_income` analytics and visualization packs. | Production use of pack-dependent workflows | open |
| Q-4 | `quantsmith-version-check.sh` recognizes PEP 508 git-commit pins. | Nothing (optional) | open |
| Q-5 | Register QuantMeridian for `0047` release notifications (spec005 Phase 1 item). | Nothing (optional) | open |
| Q-6 | Gateway profile document in `adapters/llm_runtime/`. | Nothing (optional) | open |
| Q-7 | Multi-series time-series form in `0080`. | Nothing; retires spec009's overlay composition | open |

## Follow-ups

Deferred to their own specs:

- Scheduled agent workflows on QuantSmith `0055`/`0060`.
- Offering verified results to `MPUB`'s Chart Queue as `Candidate` items.
- A cross-module queue view, streaming responses, and job chaining.
- `analysis.eda` over Gold's lead-lag, correlation, and structural-break tables.
- A general `DashboardSpec` → `MGC`/`MKC` adapter (spec005 item 4 in full).
- Native cloud-IAM provider flows (Bedrock, Vertex, Entra ID) if gateways prove insufficient.
- Reconciling non-`lin` unit handling between `/api/chart/series` and `/api/econ/series`.
