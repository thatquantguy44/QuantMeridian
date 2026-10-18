# Tasks: Pluggable Money Market and Collateral Optimization Center

- **Spec:** spec015-pluggable-optimization-center (`SPEC.md`, `PLAN.md`)
- **Status:** Draft — implementation in progress; no model binding approved yet
- **Last updated:** 2026-10-17

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| OC-T001 | Identify both model repositories or local checkouts, owners, entry points, licenses, approved revisions, verifier approach, and collateral semantics; resolve spec011 and spec015 decisions. | OC-001–005, OC-007–009 | blocked | Reviewed binding and contract decisions recorded; no guessed repository or policy default. |
| OC-T002 | Define common capability, configuration, snapshot, run, result, error, comparison, and audit schemas; generate TS/Python contract types. | OC-003–007, OC-010–015 | todo | Versioned schemas, canonical hash rules, parity fixtures, compatibility policy. |
| OC-T003 | Implement deployment-approved local and pinned Git binding workflow and adapter conformance suite for both services. | OC-001–003 | todo | Local/remote golden fixtures match; revision drift and invalid adapter fail closed; rollback tested. |
| OC-T004 | Extend `money_market_api` scaffold to adapt the approved MMKT model and approved verifier, keeping spec011 provenance and source rules. | OC-001, OC-004, OC-007, OC-008, OC-015 | blocked | Service contract and financial fixtures pass; `solver_enabled` becomes true only for approved binding. |
| OC-T005 | Add independent `collateral_optimizer_api`, collateral snapshot/config adapter, capabilities, and approved verifier. | OC-001–005, OC-007, OC-009 | blocked | Agreement, eligibility, haircut, limits, coverage, cost, infeasible, and tamper fixtures pass. |
| OC-T006 | Build durable profile/snapshot/run/result registry and append-only audit store, with auth, lineage, idempotency, and paginated APIs. | OC-005–007, OC-012, OC-014–015 | todo | Replayed run matches hashes; unauthorized access denied; immutable history and concurrent idempotency proven. |
| OC-T007 | Implement queue, worker, scheduler, occurrence policy, health, pause/resume, and attempt tracking. | OC-006, OC-012–014 | todo | Crash/concurrency, DST, missed-run, stale-input, paused, and model-drift cases pass. |
| OC-T008 | Build MMKT connection/input/configuration/run/result UI slices and source-state handling. | OC-003–005, OC-008, OC-015–016 | in-progress | Added the initial OPT connection panel and `/api/optimization/connections` health probe. It separates service health from approved binding status; model binding remains UNCONFIGURED. Configuration, run, and verified result screens remain. |
| OC-T009 | Build COLL connection/input/configuration/run/result UI slices; remove connected-path client what-if estimate. | OC-003–005, OC-009, OC-015–016 | todo | Real result drilldown, infeasible/error states, provenance and verifier labels, narrow-screen path. |
| OC-T010 | Replace `OPT` generated operational data with registry-backed Runs, Connections, Schedules, and Audit views. | OC-012–016 | in-progress | Added live service health and a prominent SIMULATION DATA notice for the existing generated run, savings, dual, and trade panels. Registry-backed records, schedules, audit, and demo exclusion remain. |
| OC-T011 | Build same-model A/B comparison and two-model coordinated experiment UI/API. | OC-010–011 | todo | Same-snapshot delta, non-comparable warning, unmatched rows, partial experiment, and separate-family metrics tested. |
| OC-T012 | Complete end-to-end validation, usability, security, documentation, and staged activation for each service. | OC-001–016 | todo | Contract, adapter, verifier, scheduler, audit, and UI evidence linked; no synthetic result claimed as live. |
| OC-T013 | Add a separate Money Market Fund Optimizer workspace and connect it to the externally hosted model service through the terminal server. | OC-001, OC-003–008, OC-015–016 | in-progress | Standalone module and server-side health probe added; run controls stay gated until the model repository, immutable revision, schemas, and verifier are approved. |

## Delivery slices

1. **Foundation:** OC-T001–T003 establish approved model bindings and typed contracts. Publish service health/capabilities even while solving is disabled.
2. **Operating shell:** OC-T006, T008–T010 deliver useful configuration, connection, run-history, schedule, and audit screens with honest unconnected states. This can be reviewed without either model.
3. **Model activation:** OC-T004 and T005 connect MMKT and COLL separately. Each family can be released only when its own verifier and fixtures pass.
4. **Automation and comparison:** OC-T007 and T011 add durable scheduled runs and side-by-side experiments after the registry and result contracts are stable.
5. **Closeout:** OC-T012 validates full workflows and records which bindings and environments are activated.

## Definition of done

- Both independently deployed services can execute an approved local or pinned-repository adapter, or report clearly that no model is connected.
- Every displayed recommendation is backed by an immutable run and independent verification; all source modes and limitations remain visible.
- `OPT` shows actual manual and automated attempts, schedules, results, health, and append-only audit history, with no seeded operational totals.
- Same-model A/B and coordinated two-model experiments show config changes and correct per-family deltas without silently combining objectives.
- Failure, staleness, infeasibility, cancellation, time limits, and service absence are distinguishable in APIs and all relevant UI views.
