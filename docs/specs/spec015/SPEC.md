# Spec015: Pluggable Money Market and Collateral Optimization Center

- **ID:** spec015-pluggable-optimization-center
- **Module code / route:** `OPT` / `/optimization`
- **Status:** Draft — implementation subject to review of this spec and its integration contracts
- **Last updated:** 2026-10-18

> This file defines outcomes and acceptance criteria. Integration design and sequencing are in `PLAN.md` and `TASKS.md`.

## Implementation status — 2026-10-18

- The operating-shell foundation merged in PR #161: service health is separate from approved model binding state, and seeded Optimization Center results are labeled SIMULATION DATA.
- PR #163 delivered the separate Money Market Fund Optimizer workspace and local synthetic LP proof of concept. Follow-up Synthetic Demo Mode is an explicit opt-in and defaults off. When enabled, it uses a fixed eight-share-class fictional snapshot with gross/net 7-day yield, expense ratio, AUM, WAM/WAL, daily/weekly liquid assets, and portfolio mix. The LP distributes cash to maximize supplied net yield subject to reserve, same-day liquidity, prime exposure, and per-fund concentration limits. The API returns constraint checks; the UI reports estimates and model limitations.
- The POC is an explicit, temporary exception to the non-goal below. It is demo-only, uses synthetic inputs, has no independent verifier, and does not satisfy the approved external model binding, source lineage, or production recommendation requirements. Actual model mathematics will remain in its separate repository when identified and approved.
- Tracking and detailed implementation sequencing remain in PLAN.md and TASKS.md.

## Implementation status — 2026-10-19

- MMKT now runs end to end: `services/money_market_api` solves an independently verified continuous LP on named SIM rate sets (spec011), so its run endpoint no longer returns `501 MODEL_NOT_IMPLEMENTED`. Its Spec015 binding is still unregistered; the Optimization Center shows `BINDING UNCONFIGURED`.
- The Optimization Center and COLL read service results only: generated runs, duals, trades and the client-side collateral what-if estimate are removed from the connected path (spec016 COLL-007). OPT also reports IBAL, gated by its pinned engine (`ENGINE_PINNED`).
- No durable run registry, schedules, comparisons or audit trail exist yet; those remain the open Spec015 deliverables.
- OPT now shows a **session run log** (InventoryBallast 0018 T-015): metadata of each IBAL, MMKT and COLL run the terminal's server routes forwarded, held in server memory (newest 200) and lost on restart. It is labelled `NOT PERSISTED` and is not this spec's registry: identity, immutable storage, authorization and append-only audit remain open.

## Summary

Make QuantMeridian's Optimization Center the operating surface for independent money market and collateral model services. Each service can be connected to an approved existing model repository, whether supplied as a local checkout or a pinned Git repository, through a versioned adapter contract. Users can configure supported model inputs and policies, run each optimizer manually or on a schedule, inspect verified results and audit history, and compare baseline and changed configurations side by side. Provide a distinct Money Market Fund Optimizer workspace for fund allocation, separate from the CASH treasury funding view. Its current implementation is a synthetic proof of concept; the eventual fund model will be connected through its own approved repository binding. The UI must be useful before a model is connected, while clearly identifying setup, unavailable, simulated, failed, and verified states.

## Problem and current state

`services/money_market_api` already validates a versioned request and advertises `solver_enabled: false`; its run endpoint currently returns `501 MODEL_NOT_IMPLEMENTED`. Spec011 defines the money market model goals but has open decisions. `src/app/optimization/page.tsx` reads generated runs, duals, and trades from `src/data/optimization.ts`; `src/app/collateral/page.tsx` presents generated data and a client-side what-if estimate. Neither is an auditable source of real solve results. The existing `/cash-optimizer` page is a funding view, not a connected money market execution optimizer.

> **Update 2026-10-19:** the paragraph above records the state when this spec was written. MMKT and COLL now return verified service results and OPT and COLL no longer show generated data; see "Implementation status — 2026-10-19".

This spec adds the connection and operating layer for actual, separately owned models. It does not implement either mathematical model. [Spec016](../spec016/SPEC.md) identifies the InventoryBallast collateral package and proposes its exact initial pin and native contract; that binding still needs review and conformance evidence before activation. The money market model repository remains unresolved. Spec011 remains the source for MMKT financial requirements.

## Goals

1. Extend the existing money market service and add a distinct collateral service, with separate deployment, health, capabilities, adapter, and failure boundaries.
2. Support an operator-approved local checkout or immutable remote Git revision for each model, with a documented adapter that translates QuantMeridian contracts to that model's native API and back.
3. Expose versioned, validated configuration for each model without hard-coding its eventual parameter set into the browser. Preserve named profiles, provenance, units, limits, and an immutable effective configuration per run.
4. Provide meaningful money market and collateral UI slices for connection status, input review, configuration, manual runs, results, and failure diagnosis.
5. Let a user compare two or more runs of one model on the same input snapshot, and run a coordinated baseline/variant experiment for both models with separate, correctly labeled impacts.
6. Make `OPT` a durable GUI for every registered optimization: manual and automated runs, queue and schedule status, results, verification, lineage, audit events, and comparisons.
7. Replace seeded output in connected views with service-backed results. Demonstration data, if retained, remains explicitly marked `SIM` and cannot be mistaken for a verified recommendation.

## Non-goals

- Creating the production money market or collateral mathematical engines inside QuantMeridian, or replacing their own source repositories. A temporary synthetic LP is permitted only as the explicitly SIM-labeled Money Market Fund Optimizer proof of concept; it cannot produce production recommendations and must be replaced by the approved external fund model binding.
- Automatically importing arbitrary GitHub URLs, executable paths, or code supplied by a browser user. Connections are approved server-side deployments.
- Order routing, settlement, collateral movement, trade execution, or automatic application of proposed allocations.
- Combining money market yield and collateral savings into one total without an approved common objective and double-counting rule.
- Making production-readiness claims from synthetic fixtures or silently substituting SIM values for unavailable real inputs.
- Treating solver success as an independently verified result.

## Users and primary workflows

- **Operator:** register a model source and pinned revision, map an approved adapter, inspect health/capabilities, and activate or roll back a connection.
- **Analyst:** select an input snapshot, edit a named configuration within advertised limits, validate it, submit a run, and review result, constraints, diagnostics, and provenance.
- **Analyst:** clone a baseline into a variant, change parameters on either or both models, execute a comparison, and inspect signed deltas with the changed fields visible.
- **Scheduler owner:** create and manage automated jobs with explicit input policy, schedule, concurrency, and failure notification; inspect every attempt.
- **Reviewer/auditor:** trace who changed a profile, scheduled or submitted a run, which model and data were used, what verification found, and what was exported.

## Requirements

| ID | Requirement | Priority |
|---|---|---|
| OC-001 | Maintain two separately deployed model-facing services: extend `services/money_market_api` and create `services/collateral_optimizer_api`. One service can fail or be upgraded without changing the other's run state. | must |
| OC-002 | Each service accepts a reviewed `local_checkout` or `git_revision` model binding. A remote binding resolves to an immutable commit before build/deployment; a local binding records its path, Git commit when present, and content fingerprint. Runtime never tracks a moving branch. | must |
| OC-003 | Each binding names an approved adapter and declares API version, model identity, revision, capabilities, parameter schema, result schema, and verifier support. Health distinguishes `UNCONFIGURED`, `INCOMPATIBLE`, `UNAVAILABLE`, and `READY`. Unsupported features remain unavailable in the UI. | must |
| OC-004 | Both services accept versioned, fully validated requests and return typed run/results or typed errors. The browser uses same-origin QuantMeridian routes; credentials and model paths stay server-side. | must |
| OC-005 | Configuration supports named versioned profiles, validation, import/export, objective selection, model-specific policy fields, solver options, input mappings, units, defaults, and conditional controls only when the connected model advertises them. The UI shows the effective values and provenance before submission. | must |
| OC-006 | Each submitted run stores immutable input snapshot, effective profile, hashes, model/adapter revision, schema version, solver settings, seed when relevant, initiator, trigger, timestamps, status transitions, and result or error reference. Retries are new attempts linked to the original request. | must |
| OC-007 | A result is a recommendation only after independent verification of applicable bounds, constraints, integrality, and objective reconstruction. Infeasible, time-limited, failed, cancelled, and unverified outputs are labeled accurately and cannot populate savings or trade recommendation totals. | must |
| OC-008 | Money market UI covers rate/source status, forecast horizon, instrument and policy setup, allocation/blotter, maturity and liquidity views, baseline/frontier/scenarios when supported, and result lineage as defined by spec011. | must |
| OC-009 | Collateral UI covers inventory and obligation snapshots, agreement/eligibility/haircut/limit setup, allocation or substitution actions, cost and coverage, binding constraints, infeasibility, and model-provided sensitivity when supported. Calculations are supplied by the service, not a client estimate. | must |
| OC-010 | Comparison accepts baseline and variant runs within the same model, preserves changed configuration fields and unmatched rows, shows signed absolute/percentage deltas with units, and flags differences in input snapshot, model revision, objective, currency, or verification. | must |
| OC-011 | A coordinated experiment can hold one snapshot per model and run baseline/variant for both services. Its GUI places money market and collateral panels side by side, shows each model's separate effects and statuses, and never adds unlike metrics by default. | must |
| OC-012 | `OPT` lists all registered optimizer types and manual/automated attempts, with filters, run detail, verification, result drilldowns, compare selection, schedules, queue/worker health, failures, and an audit timeline. Existing IBAL/S&U runs appear only when they emit the common run contract; unsupported integrations are labeled pending. | must |
| OC-013 | Automated jobs support an explicit schedule/time zone, approved profile, input snapshot policy, missed-run policy, idempotency, bounded retries, concurrency limits, pause/resume, and accountable owner. A schedule cannot silently reuse stale data or an unapproved model revision. | must |
| OC-014 | Append-only audit events cover connection/profile changes, validation, submission, scheduling, lifecycle changes, verification, comparison creation, export, and administrative action. Authorized users can filter and export the audit trail with event time, actor, correlation ID, before/after references, and reason; secrets and raw sensitive payloads are excluded from event logs. | must |
| OC-015 | Input source and as-of state (`DB`, `SIM`, user supplied, stale, missing, error) are visible in each module, `OPT`, comparison, and export. No silent DB-to-SIM fallback is allowed. | must |
| OC-016 | Existing seeded OPT metrics, duals, and trades, and the collateral client-side savings formula, are removed from connected result paths. An unconnected model presents setup guidance and representative layout without invented run success. | must |
| OC-017 | Provide a Money Market Fund Optimizer workspace distinct from CASH treasury funding. It may run the explicitly synthetic local POC while unbound; all output stays labeled SIM and is excluded from verified recommendation totals. The approved fund model, eligibility rules, input/result schemas, and independent verifier must be connected before live recommendations are enabled. | must |
| OC-018 | Synthetic Demo Mode is explicit and defaults off. When on, the module uses a clearly identified, fixed fictional fund dataset and labels all outputs SIM; when off, the POC endpoint refuses to solve and no synthetic values are presented as live. Dataset metadata and assumptions are visible in results. | must |

## User interface slices

| Slice | Visible behavior and completion bar |
|---|---|
| Connection and capabilities | `OPT` service cards show source mode, pinned model/adapter revision, health, last check, supported features, and actionable mismatch/error messages. Operator-only connection details never expose secrets. |
| Configure and validate | MMKT and COLL workspaces show a profile picker, schema-driven grouped controls with units/help/limits, input coverage and provenance, validation issues at the affected field/row, and an effective-config diff before a run. |
| Run and inspect | Submit/progress/cancel where supported; status timeline; summary, result grids, binding constraints, diagnostics, verifier report, source hashes, and export links. Empty, unavailable, infeasible, and failed states have distinct copy and actions. |
| Compare | Baseline and variant columns, changed-parameter drawer, aligned metrics and entity-level rows, signed deltas, unmatched records, comparability warnings, and links to both immutable runs. A two-model experiment has separate MMKT and COLL sections. |
| Operate | `OPT` overview KPIs from real run records, filterable run table, schedule calendar/list, job and worker state, retry/attempt detail, and searchable audit timeline. Counts exclude demo records unless explicitly selected. |

All slices use the existing terminal navigation, dense table patterns, provenance badges, responsive layouts, keyboard and screen-reader labels, and UTC timestamp with user time-zone display.

## Acceptance criteria

1. A model checked out locally and the same model built from a pinned remote commit report the same manifest identity and can execute the same contract fixture; changing the underlying revision is detected and requires a new approved binding.
2. Either service can be absent or unhealthy while the other remains usable. Unconfigured MMKT still reports its current `501`/disabled capability honestly; no generated result is shown as a solve.
3. An unsupported parameter is rejected by the service and disabled in the GUI; profile export/import round-trips to the same canonical effective-config hash. The submitted run matches the preflight display.
4. Golden fixtures for each connected model reconcile inputs, objective, allocations, and independent verifier output. Tampered results are rejected; infeasible and time-limit states show no verified recommendation.
5. Same-snapshot A/B runs expose every changed field, compute signed deltas only for matched metrics/units, retain unmatched entities, and identify model or input drift. The two-model experiment reports separate family impacts without an unapproved combined total.
6. A scheduled job creates exactly one run per due occurrence under concurrent worker retries; skipped/stale/failed occurrences and pause/resume actions remain visible and auditable.
7. A reviewer can follow any result from `OPT` through its schedule or manual trigger, actor, input/config hashes, model revision, verifier decision, exports, and audit events. Audit entries cannot be edited through the product.
8. The MMKT, COLL, compare, and `OPT` slices work at desktop and narrow viewport, including loading, empty, invalid, running, verified, infeasible, and service-down states; automated UI checks cover the critical paths.
9. Connected `OPT` and COLL views contain no synthetic savings, duals, or recommendations presented as real results; SIM fixtures remain visibly labeled in API responses, UI, and exports.

## Decisions required before implementation

1. Identify the money market model repository and its first approved immutable revision. Spec016 identifies the collateral repository and a merged-main candidate commit; approve its binding only after build, ownership, license and conformance review.
2. Review spec016's native collateral input, policy, output, objective, units and verifier contract. The candidate supports multiple currencies and legal entities through explicit agreements; approve the QuantMeridian adapter and source policy before recommendations are enabled.
3. Resolve spec011's baseline, horizon/currency, and stale-rate decisions before enabling money market recommendations.
4. Select durable run/audit storage and worker deployment for local and hosted environments, retention periods, user identity/RBAC source, and schedule failure notification destination.
5. Define whether any combined economic metric across MMKT and COLL is valid; otherwise keep the two impact panels separate.

## Related documents

- `docs/specs/spec011/` — money market model requirements and existing `money_market_api` scaffold.
- `docs/specs/spec012/` — Sources & Uses, including its bounded setup-only approval.
- `docs/specs/spec013/` and `docs/specs/spec007/` — InventoryBallast capability/version and UI integration precedents.
- `docs/specs/spec016/` — specific InventoryBallast collateral package, candidate pin and update protocol.
- `docs/specs/spec014/` — liquidity forecast source dependency and proposed service port 8016.
- `services/optimization_core/` — current LP builder and independent verifier; MIP support is not yet implemented there.
- `src/app/optimization/page.tsx`, `src/app/collateral/page.tsx`, `src/app/cash-optimizer/page.tsx` — current product surfaces.
