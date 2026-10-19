# Tasks: Money Market Execution Optimizer

- **Spec:** spec011-money-market-execution (`SPEC.md`, `PLAN.md`)
- **Status:** Approved 2026-10-18 — verified ticketed execution slice built; integration follow-ups open
- **Last updated:** 2026-10-18
- **Checkpoint:** See [HANDOFF.md](HANDOFF.md) for branch state, local run steps and ordered next steps
- **Parent requirements:** 0018 REQ-016–020, REQ-027–030, REQ-041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| MM-001 | Resolve owner questions; approve the spec, plan, task list, and white-paper design. | MM-001–010 | done | **2026-10-18:** questions 1–3 resolved and the full spec, plan, tasks and white-paper design approved; both recorded in the SPEC.md decision log. |
| MM-002 | Define versioned request/result contracts and capability manifest; add schema/TypeScript/Python parity checks. | MM-001, MM-002, MM-008–010 | in-progress | Python and TypeScript contracts carry ticketed MIP, blotter, cutoff, shadow-price and frontier fields; manifest advertises the execution binding. Generated TS/Python parity remains open. |
| MM-003 | Build the Gold/SIM rate snapshot route, status display, normalization, hash, and no-fallback gate. | MM-008, MM-009 | in-progress | Added `/api/econ/mmkt-rate-snapshot` and the Gold snapshot adapter, plus `POST /api/econ/mmkt-runs`, which attaches the server-read snapshot and hash and rejects non-OK candidate rates. **2026-10-18:** two named SIM sets are registered (`SIM-MMKT-2026-10-BASE`, `SIM-MMKT-2026-10-CUT25`, in `src/lib/server/mmktSimRateSets.ts`). Each is selectable only by explicit ID, and an unknown ID still fails closed. Each set has one stale and one unavailable row to exercise fail-closed pricing. Route tests cover the SIM path. Gold remains unwired upstream (XR-3). |
| MM-004 | Implement instrument/cash forecast validation and deterministic model input assembly. | MM-001, MM-002, MM-008 | done | Strict account cash-continuity and rate validation, p10/p50/p90 rebasing, dated settlement/cutoff eligibility and deterministic sparse model assembly. Golden execution tests cover decision-time and forecast changes. |
| MM-005 | Implement LP allocation and independent verification for cash continuity, liquidity, maturity, concentration, rating, and RRP constraints. | MM-002–004, MM-010 | done | Shared HiGHS backend solves LP or MIP; verifier independently checks bounds, model rows, integrality and objective. Non-optimal/unverified solves yield no blotter. Seven execution contract tests pass locally. Full constraint matrix/contract parity remains MM-002/MM-010. |
| MM-006 | Add ticket-count, min-ticket, lot-size, and activation MIP rules with formulation disclosure. | MM-003, MM-006 | done | Binary activation, integer lot count, amount identity, minimum and maximum ticket, aggregate ticket count, dated cutoff exclusion; SciPy HiGHS MIP is polished by a fixed-integer LP and verified against the original MIP. `test_execution.py` covers binding limits, missed cutoff, fractional tampering and infeasibility. |
| MM-007 | Build blotter, cutoff timeline, maturity ladder, CSV, baseline comparison, shadow-price labels, and yield/liquidity frontier. | MM-005–006 | done | UI renders service-ordered indicative blotter, matching CSV, cutoff timeline and verified frontier. LP marginals are labeled `LP_LOCAL`; MIP values are from a verified fixed-integer LP (`FIXED_INTEGER_LP`). The existing maturity ladder and separately verified baseline remain. Actual-current-allocation baseline waits on MM-011. |
| MM-008 | Add the four named scenarios and run history integration with OPT. | MM-007, REQ-029 | in-progress | Base, rate cut, fund fee/gate, cash forecast miss and downgrade are SIM service runs. Model-backed plan deltas appear in comparison. OPT persistence remains open. |
| MM-009 | Add service security, health, telemetry, and local launcher integration. | REQ-027 | in-progress | Bearer auth, ready health/capabilities, safe run-attempt logging and the local launcher are scaffolded. **2026-10-18:**<br>- `/api/econ/mmkt-service` reports health, binding and token state.<br>- Fixed two service bugs: the capability manifest now resolves when the service runs from source, and a null `maximum_amount` (uncapped) no longer crashes the LP builder.<br>- Fixed the terminal proxy dispatcher to honour `NO_PROXY` and bypass loopback, so local model services are reachable behind an outbound proxy.<br>- Added `services/money_market_api/tests` and a CI job.<br>Durable idempotency, telemetry and integration checks remain. |
| MM-011 | Current-positions input so the "current allocation" baseline can be computed. | MM-006 (baseline), REQ-019 | todo | Define the positions contract (holdings by candidate, account and maturity, with provenance). Evaluate the held allocation's modeled return under the same conventions and verifier. Until then the option is listed but fails closed. |
| MM-010 | Benchmark and validate the demo path; publish model card and as-built paper. | REQ-041 | in-progress | Local golden tests: 7/7; real SIM base with three independently verified frontier points and 12 tickets solved in 22.05s with 25mm lots. As-built execution paper updated. Full `pytest`, terminal typecheck/build, browser viewport and Gold path remain unverified (opt-in Playwright path added) in this workspace. |

## Definition of Done

- Child spec approved before code.
- Service, API, and UI consume one versioned contract and one hashed input snapshot.
- No rate with non-OK status is priced; SIM requires explicit selection and stays labeled.
- Every displayed recommendation passes independent verification.
- Full tests/build and demo-path viewport checks pass; documentation reflects the shipped model.
