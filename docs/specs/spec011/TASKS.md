# Tasks: Money Market Execution Optimizer

- **Spec:** spec011-money-market-execution (`SPEC.md`, `PLAN.md`)
- **Status:** Draft — implementation in progress; owner review pending
- **Parent requirements:** 0018 REQ-016–020, REQ-027–030, REQ-041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| MM-001 | Resolve owner questions; approve the spec, plan, task list, and white-paper design. | MM-001–010 | blocked | Decisions recorded; approval in SPEC.md |
| MM-002 | Define versioned request/result contracts and capability manifest; add schema/TypeScript/Python parity checks. | MM-001, MM-002, MM-008–010 | in-progress | Strict request and verified LP result contracts are defined; schema parity and service contract checks remain. |
| MM-003 | Build the Gold/SIM rate snapshot route, status display, normalization, hash, and no-fallback gate. | MM-008, MM-009 | in-progress | Added `/api/econ/mmkt-rate-snapshot` and the Gold snapshot adapter. Added `POST /api/econ/mmkt-runs` to attach the server-read snapshot/hash and reject non-OK candidate rates. Named SIM fails closed at the terminal until a set is registered. Gold table is not yet live-wired upstream; route parity/status checks remain. |
| MM-004 | Implement instrument/cash forecast validation and deterministic model input assembly. | MM-001, MM-002, MM-008 | in-progress | Added account-level cash continuity, p50 flow selection, settlement eligibility, normalized-yield ACT/365 returns, and deterministic LP variable/row assembly. Validation and contract coverage remain. |
| MM-005 | Implement LP allocation and independent verification for cash continuity, liquidity, maturity, concentration, rating, and RRP constraints. | MM-002–004, MM-010 | in-progress | MMKT builds the shared sparse LP, solves with HiGHS, and returns allocations only after independent bounds/row/objective verification. Supports cash continuity, daily/weekly liquidity, amount/fraction exposure, rating floors, and maturity-day WAM/WAL proxies. Infeasible solves return no allocation. The result is explicitly not execution-ready; the MIP/ticket/cutoff slice remains. Golden cases, constraint coverage, and tampering checks remain. |
| MM-006 | Add ticket-count, min-ticket, lot-size, and activation MIP rules with formulation disclosure. | MM-003, MM-006 | todo | Binding and non-binding rule cases; verified integer result |
| MM-007 | Build blotter, cutoff timeline, maturity ladder, CSV, baseline comparison, shadow-price labels, and yield/liquidity frontier. | MM-005–006 | todo | UI/API totals reconcile to the verified run |
| MM-008 | Add the four named scenarios and run history integration with OPT. | MM-007, REQ-029 | todo | Each scenario has a verified comparison and lineage |
| MM-009 | Add service security, health, telemetry, and local launcher integration. | REQ-027 | in-progress | Bearer auth, ready health/capabilities, safe run-attempt logging, and local launcher are scaffolded; durable idempotency, telemetry, and integration checks remain. |
| MM-010 | Benchmark and validate the demo path; publish model card and as-built paper. | REQ-041 | todo | Parent 0018 M1/M5 evidence and no fabricated values |

## Definition of Done

- Child spec approved before code.
- Service, API, and UI consume one versioned contract and one hashed input snapshot.
- No rate with non-OK status is priced; SIM requires explicit selection and stays labeled.
- Every displayed recommendation passes independent verification.
- Full tests/build and demo-path viewport checks pass; documentation reflects the shipped model.
