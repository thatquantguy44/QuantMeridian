# Plan: Pluggable Money Market and Collateral Optimization Center

- **Spec:** spec015-pluggable-optimization-center (`SPEC.md`)
- **Status:** Draft — implementation in progress; model binding approval pending
- **Last updated:** 2026-10-17

## Architecture

```text
MMKT / COLL / OPT React workspaces
            |
            | same-origin /api/optimization/*
            v
QuantMeridian route layer -- authorization, snapshot composition,
            |                profile/run/experiment/audit reads
            v
Durable optimization registry + queue/scheduler/worker
            |                               |
            | versioned service requests    | append-only lifecycle events
            +---------------+---------------+
                            |
                 +----------+----------+
                 |                     |
        money_market_api       collateral_optimizer_api
        existing scaffold       new separate service
                 |                     |
        approved MMKT adapter   approved COLL adapter
                 |                     |
        pinned model repo       pinned model repo
```

The model services are isolated deployments and retain their own `/health`, `/v1/capabilities`, `/v1/validate`, and `/v1/runs` boundaries. Extend `services/money_market_api` rather than creating a second MMKT service. Add `services/collateral_optimizer_api` on a configurable URL (8017 is the proposed local port; confirm no collision at implementation). The browser never contacts a Python service directly. The registry and worker own history, scheduling, comparisons, and audits; a model service never needs to read QuantMeridian's database or other services. Model source data is composed by QuantMeridian and passed as an explicit snapshot.

The current `optimization_core` can verify continuous LPs, not MIPs. Use its verifier where it is mathematically sufficient; for other model forms, the adapter must provide an approved independent verifier or the result remains `UNVERIFIED`. Do not silently describe service self-checks as independent verification.

## Current implementation checkpoint

The first Spec015 code slice runs on the `spec015/optimization-center-foundation` branch. It adds a same-origin connection health route and an Optimization Center connection panel. Service health is shown separately from Spec015 binding status, which remains `UNCONFIGURED` until an approved model binding is registered. Legacy generated run, savings, dual, and trade panels remain available only with a prominent SIMULATION DATA notice. This does not approve the local MMKT prototype as a Spec015 model binding.

## Money Market Fund Optimizer module

A separate `/money-market-fund-optimizer` workspace is being added for fund allocation. It is distinct from the existing `CASH` treasury funding optimizer. The workspace probes a deployment-configured model service through a same-origin server route, with the model logic remaining in its own repository. The repository identity and approved immutable revision, request/result schemas, input mapping, and independent verifier remain open Spec015 decisions; service reachability alone never enables a run.

## Money Market Fund Optimizer proof of concept

The separate `/money-market-fund-optimizer` module runs a small deterministic LP locally through `POST /api/mm-fund-optimizer/optimize`. Synthetic Demo Mode is an explicit opt-in and defaults off; the API also requires `synthetic_mode: true`. When enabled, it uses the fixed `mmfo-demo-us-institutional-2026-10-16` fictional dataset with eight government and prime share classes and descriptive yield, expense, AUM, maturity, liquidity, and portfolio-mix fields. It maximizes illustrative net 7-day yield subject to cash reserve, minimum same-day liquidity, maximum prime exposure, and per-fund concentration constraints. A bounded vertex-enumeration solver returns the highest-yield feasible point for this small LP and checks the stated constraints before returning it. Results expose the dataset ID/as-of date and remain labeled `SIM`; when the toggle is off, the POC run is disabled and produces no synthetic result.

This is a replaceable POC adapter, not the eventual model integration. The future service remains a separate deployment built from the approved model repository. Keep the POC explicitly separated from production bindings; do not use its synthetic universe as a live recommendation source. The model repository, immutable revision, approved input/result schemas, sponsor/vehicle eligibility, fee and tax treatment, liquidity mapping, and independent verifier remain unresolved.

## Repository connection contract

Connection setup is an operator/deployment action. The UI may display approved bindings and request activation of a reviewed binding, but cannot accept and execute arbitrary paths, URLs, code, or shell commands. Each service has exactly one active binding per deployment, with historical bindings retained for run replay. A binding can use:

| Source | Preparation | Identity recorded |
|---|---|---|
| `local_checkout` | Mount an operator-approved, read-only checkout into the service build/runtime. Validate its package metadata, declared entry point, and file allowlist. | Absolute mount alias, Git commit and dirty state if available, plus deterministic content digest of packaged model files. A dirty/unversioned tree is allowed only in local development and cannot be marked production-ready. |
| `git_revision` | Fetch an approved repository at build time; resolve and install an immutable full commit SHA and lock dependencies. Runtime has no Git credentials or fetch step. | Repository identity, full commit SHA, package/version, build artifact digest, dependency lock digest. |

Each binding chooses a reviewed adapter implementation shipped with its service, not a dynamic import name provided by the UI. The adapter implements `capabilities()`, `validate(snapshot, config)`, `solve(snapshot, config, context)`, `normalize_result(native)`, and `verify(snapshot, config, result)`. A subprocess or HTTP-native model may be supported through a reviewed adapter if the model's actual interface requires it; timeouts, payload size, and cancellation semantics are then explicit in its manifest. A new model repository must pass adapter conformance fixtures before activation. The connection registry stores `binding_id`, source type, source identity, revision/digest, adapter version, approval/activation event, status, and prior binding. Rollback activates a previously validated binding without rewriting historical runs.

Startup probes confirm that the installed model identity and adapter match the approved binding. A drifted local checkout is `INCOMPATIBLE`; it cannot execute a recommendation until revalidated. Remote branch names may be retained for traceability but never define the executable version. Secrets stay in deployment configuration, are never in a profile/export/audit payload, and are redacted from errors.

## Capability and configuration contract

The service's capability response is the single source for which controls and results the UI enables. Version it independently from the model and adapter. It includes:

```json
{
  "api_schema_version": "1.0.0",
  "family": "money_market | collateral",
  "binding_id": "approved-binding-id",
  "model_revision": "immutable-revision-or-digest",
  "adapter_version": "semver",
  "readiness": "READY | UNCONFIGURED | INCOMPATIBLE | UNAVAILABLE",
  "formulations": ["LP"],
  "features": {"solve": true, "cancel": false, "sensitivities": false},
  "config_schema_version": "1.0.0",
  "config_schema": "reference-to-reviewed-JSON-Schema",
  "result_schema_version": "1.0.0",
  "verifier": {"kind": "independent", "forms": ["LP"]}
}
```

The `config_schema` is a reviewed, machine-readable JSON Schema subset with field ID, type, units, bounds, enumerations, required/conditional rules, display group/help, and safe default provenance. Product policy cannot be invented by a UI form generator. The service validates every value again. The UI stores named profile versions containing the explicit user values and original schema version; the service returns a canonical `effective_config` with all applied defaults and a SHA-256 hash. Unknown fields, incompatible schema majors, nonfinite numbers, unit mismatches, and unsupported features fail validation. Import/export uses the same canonical schema and includes no credential or local path.

MMKT starts from spec011's forecast, instrument, normalized-rate snapshot, and policy contract. Preserve the existing `money_market_api` rate snapshot hash and explicit SIM selection. COLL needs a newly approved, typed snapshot with inventory asset IDs/quantities/availability, obligations, agreements, eligibility, haircuts, concentration/counterparty rules, currency/legal entity, costs, and as-of/source fields. Actual schema details are finalized against the identified collateral engine; no eligibility, haircut, or legal-authority default is inferred. Each adapter maps stable IDs in and out and reports rejected/unmapped fields. Both services must expose unavailable fields honestly when a model cannot support them.

## Run lifecycle and API

The registry allocates a run ID before dispatch. A run envelope contains `family`, `binding_id`, `model_revision`, `adapter_version`, `api/config/result_schema_versions`, `input_snapshot_ref/hash`, `effective_config_ref/hash`, `source_mode`, `requested_by`, `trigger` (manual/schedule/experiment), `correlation_id`, `idempotency_key`, `created_at`, and optional `experiment_id`, `schedule_id`, and `parent_run_id`. References point to immutable, access-controlled payloads. Hashes use canonical JSON with explicit UTC date/time and numeric/unit normalization; a versioned canonicalization rule is part of the contract. Store exact request and response payloads for authorized replay within the agreed retention period.

`POST /api/optimization/validate` returns located issues and effective config without dispatch. `POST /api/optimization/runs` creates an idempotent request; `GET /api/optimization/runs` lists; `GET /api/optimization/runs/{id}` returns detail; `POST /api/optimization/runs/{id}/cancel` is available only if the service advertises cancellation. Service-level `/v1/runs` receives the immutable snapshot and effective config, with bearer auth, `X-Correlation-ID`, and `Idempotency-Key` as in the existing MMKT scaffold. The terminal proxy enforces authentication/authorization, request limits, rate limits, timeout, and response schema; it does not rewrite domain status or conceal errors. Browser identity comes from the terminal auth layer; a service bearer token alone is not end-user authorization.

Lifecycle states: `QUEUED` -> `VALIDATING` -> `RUNNING` -> one of `SUCCEEDED_VERIFIED`, `SUCCEEDED_UNVERIFIED`, `INFEASIBLE`, `TIME_LIMIT`, `FAILED`, `CANCELLED`, or `EXPIRED`. Preserve a native solver status separately. A worker lease and compare-and-swap transition prevent duplicate completion. Retries of transport/worker failure create linked attempts but share an occurrence idempotency key; model infeasibility is not retried automatically. Results persist verifier status, tolerances, checked rows, objective reconstruction, and failed checks. Recommendation and savings comparisons use only eligible verified outcomes. A time-limited feasible solution may be inspected after an explicit verifier pass, but remains labeled time-limited and is excluded from recommendation and savings totals.

The registry can initially use a local durable SQL backend for development and a hosted SQL backend for deployment; the exact backend is an open decision. In either case, define transactional tables for `bindings`, `profiles` and versions, `snapshots`, `runs`, `run_attempts`, `results`, `experiments`, `schedules`, `schedule_occurrences`, and append-only `audit_events`. Index by family, time, status, schedule, experiment, and actor; enforce tenant/access scope if multi-user deployment is enabled. UI lists are paginated and never scan result payloads. Large or sensitive payloads are kept outside audit events. Retention and deletion follow an approved policy while retaining legally required event references and tombstones.

## Scheduling and automation

The scheduler stores a validated recurrence, IANA time zone, owner, profile version policy (`pinned` or explicit reviewed latest), approved binding policy, input snapshot policy (`fresh_at_run` or fixed snapshot for test/replay), max age, concurrency key, retries/backoff, timeout, missed-run behavior, and enabled state. Preview the next occurrences, including daylight-saving transitions, before enabling. Default missed-run behavior is `skip_and_record`; catch-up requires an explicit bounded count. A schedule must not run against stale/missing sources, a changed unapproved model binding, or a disabled capability. Such occurrences become `SKIPPED` or `BLOCKED` with a reason and audit event. Pausing stops future dispatch, not history. For each occurrence, a unique key guarantees at most one logical run despite worker restarts; every attempt remains visible.

Worker and schedule health appear in `OPT`: due, queued, running, blocked, failed, last success, next due, and lag. Alert/notification destination is a deployment decision; the GUI remains complete without outbound notifications. Automated runs never execute trades or collateral movements.

## Comparison semantics

An A/B comparison stores immutable run IDs and an explicit comparison basis. The preferred basis is the same input snapshot and model revision, with configuration as the only changed variable. The UI permits historical comparisons with changed snapshots or revisions but badges them `NON-COMPARABLE` for causal impact and shows what changed. A metric catalog defines stable ID, label, family, unit, currency, sign convention, aggregation, and whether higher/lower is favorable. Signed delta is `variant - baseline`; percentage delta is shown only when the baseline is nonzero and semantics match. Match entity-level rows by stable IDs and preserve baseline-only/variant-only records. Never silently drop unmatched rows or turn missing into zero.

For a coordinated experiment, create four run requests: MMKT baseline/variant and COLL baseline/variant. The experiment pins one snapshot per family and records the exact config delta in each. Dispatch independently so one service's failure does not erase the other's results. The compare page has two separate columns/panels, with per-family metrics, status, entity diffs, and a common experiment timeline. It does not aggregate unlike objectives or infer a cross-model net benefit. If dependencies later require sequential execution or shared capacity, that becomes a separately approved orchestration contract.

## UI composition

- **`/optimization` (`OPT`):** replace seeded `getOptimizationRuns`, `getDualValues`, and `getRecommendedTrades` as operational data sources. Provide overview, Runs, Experiments, Schedules, Connections, and Audit tabs. A details drawer links directly to the relevant model workspace. A disabled service is shown with its true status rather than a fake zero or a random run.
- **Money market workspace:** add an explicit MMKT route/module rather than relabeling the existing funding `CASH` page. Reuse terminal panels, grids, provenance, and navigation. Show input/readiness, profile form, validation, run status, and supported spec011 result tabs; a disabled solver gives connection guidance. The existing `CASH` funding page can link to MMKT without implying it is the same model.
- **`/collateral` (`COLL`):** add configuration and run/result sections to the existing page, preserving useful inventory/margin context. Replace its client-side what-if savings calculation in the connected workflow. The page reports source mode and verification at each result, and makes unavailable model fields explicit.
- **Comparison page/drawer:** allow selection from a run table or creation from a baseline profile. Show synchronized metric cards, field-level config diff, input/model comparability strip, reconciled row tables, and side-by-side charts when useful. A two-model experiment uses separate MMKT and COLL sections.

Use a capability-driven UI state machine: `UNCONFIGURED`, `LOADING`, `READY`, `INVALID_INPUT`, `QUEUED/RUNNING`, terminal result states, `ERROR`, and `STALE`. Button availability follows service capabilities and authorization. Forms preserve edits across validation failures, identify specific invalid fields, and do not silently apply a default when a user changes source mode. On narrow screens, side-by-side comparison becomes stacked panels with persistent baseline/variant labels. Accessible labels, keyboard table selection, and status announcements are required.

## Validation and rollout

1. **Contract:** JSON Schema/OpenAPI parity and backward-compatibility fixtures for each service and generated TypeScript types. Verify health/capability responses against installed model revisions.
2. **Adapter:** the same golden request against local and pinned-remote builds; invalid mappings, unsupported feature, timeout, solver error, and revision drift tests. Test no network/database access from a model service unless its reviewed adapter contract explicitly needs an internal model endpoint.
3. **Financial/verifier:** hand-computable MMKT cases from spec011; collateral fixtures approved with the engine owner; corrupted allocation/objective/integrality cases must fail independent verification. Preserve LP versus MIP dual semantics.
4. **Registry/scheduler:** transactional idempotency under concurrent workers, crash/retry, daylight-saving and missed runs, stale inputs, paused jobs, partial two-model experiment, immutable snapshots, and append-only audit events.
5. **UI:** tests for capability gating, config round-trip/diff, status/error/provenance, same-snapshot and drifted comparisons, unmatched records, schedule controls, and audit navigation at desktop and narrow widths.
6. **Rollout:** ship unconnected UI slices behind module/config flags; activate each model only after its binding and verifier are approved. Migrate `OPT` from seeded to registry-backed records and clearly label any retained demo fixture. Do not backfill generated runs into audit history.

## File-level implementation map

Likely changes include `services/money_market_api/` (adapter and real solve), new `services/collateral_optimizer_api/`, shared versioned contracts under `contracts/optimization/`, server registry/worker and `/api/optimization/*` routes, a new MMKT workspace, `src/app/collateral/page.tsx`, `src/app/optimization/page.tsx`, and navigation/module configuration. Keep model-specific math in its upstream repository and presentation-only deltas in the browser. The precise folders and storage backend follow repository conventions at implementation time.

## Dependencies and unresolved decisions

Resolve the five decisions in `SPEC.md` before connecting a model. Spec011 and spec012 approval boundaries remain in force; this plan does not grant solving authority to Sources & Uses. Confirm collateral engine input/output semantics and obtain legal/policy ownership for eligibility and reuse. Choose a worker/storage deployment that survives serverless request lifetime and supports audit retention. Record any production activation separately from local proof of concept.
