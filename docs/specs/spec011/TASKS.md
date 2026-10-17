# Tasks: Money Market Execution Optimizer

- **Spec:** spec011-money-market-execution (`SPEC.md`, `PLAN.md`)
- **Status:** Draft — pending owner review; no implementation authorized yet
- **Parent requirements:** 0018 REQ-016–020, REQ-027–030, REQ-041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| MM-001 | Resolve owner questions; approve the spec, plan, task list, and white-paper design. | MM-001–010 | blocked | Decisions recorded; approval in SPEC.md |
| MM-002 | Define versioned request/result contracts and capability manifest; add schema/TypeScript/Python parity checks. | MM-001, MM-002, MM-008–010 | in-progress | Python request/capability contracts and service response are scaffolded; parity checks remain |
| MM-003 | Build the Gold/SIM rate snapshot route, status display, normalization, hash, and no-fallback gate. | MM-008, MM-009 | in-progress | Added `/api/econ/mmkt-rate-snapshot` and the Gold snapshot adapter: explicit projection of all EcoMedallion columns, normalized-yield preservation, status/lineage retention, stable content hash, and candidate eligibility checks that reject LOADING/ERR/STALE, missing rows, and non-`ok` statuses. Gold table is not yet live-wired upstream; no approved SIM set is registered, so named SIM selection fails closed. Route parity and status matrix tests remain to be written. |
| MM-004 | Implement instrument/cash forecast validation and deterministic model input assembly. | MM-001, MM-002, MM-008 | todo | Invalid basis, cutoff, tenor, or missing lineage fails closed |
| MM-005 | Implement LP allocation and independent verification for cash continuity, liquidity, maturity, concentration, rating, and RRP constraints. | MM-002–004, MM-010 | todo | Hand-computable feasible and infeasible golden cases |
| MM-006 | Add ticket-count, min-ticket, lot-size, and activation MIP rules with formulation disclosure. | MM-003, MM-006 | todo | Binding and non-binding rule cases; verified integer result |
| MM-007 | Build blotter, cutoff timeline, maturity ladder, CSV, baseline comparison, shadow-price labels, and yield/liquidity frontier. | MM-005–006 | todo | UI/API totals reconcile to the verified run |
| MM-008 | Add the four named scenarios and run history integration with OPT. | MM-007, REQ-029 | todo | Each scenario has a verified comparison and lineage |
| MM-009 | Add service security, health, telemetry, and local launcher integration. | REQ-027 | in-progress | Bearer auth, health, safe run-attempt logging, and local launcher are scaffolded; telemetry and integration checks remain |
| MM-010 | Benchmark and validate the demo path; publish model card and as-built paper. | REQ-041 | todo | Parent 0018 M1/M5 evidence and no fabricated values |

## Definition of Done

- Child spec approved before code.
- Service, API, and UI consume one versioned contract and one hashed input snapshot.
- No rate with non-OK status is priced; SIM requires explicit selection and stays labeled.
- Every displayed recommendation passes independent verification.
- Full tests/build and demo-path viewport checks pass; documentation reflects the shipped model.
