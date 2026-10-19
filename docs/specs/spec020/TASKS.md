# Tasks: Borrower Default and Indemnification Risk (INDEM)

- **Spec:** spec020-indemnification-risk (SPEC.md, PLAN.md)
- **Status:** Draft — pending owner review; no implementation authorized yet

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| IND-T01 | Resolve SPEC decisions 1–8 and record them in the decision log. | IND-001–021 | blocked | Decisions 1–6 recorded 2026-10-19; decisions 7–8 open |
| IND-T02 | Rename "BlueCrest" in `econEnhancements.ts` and add it to the `REAL_FIRMS` pattern. | AC-007 | todo | Fictional-counterparty test fails before the rename and passes after |
| IND-T03 | Define versioned snapshot, result and model-card contracts. | IND-001, IND-014 | todo | JSON schemas with TS/Python parity fixtures |
| IND-T04 | Build the deterministic synthetic book: loans, collateral, margin and borrower credit inputs. | IND-002 | todo | Fixed-seed golden test; reconciles to SLAB if decision 8 is to extend it |
| IND-T04a | Add the versioned illustrative rating-to-PD table and the per-borrower spread override, with source labels. | IND-018 | todo | Hand-computed hazard and PD for both sources; fallback when the override is removed (AC-011) |
| IND-T04b | Implement the run modes: desk view on the actual book, annual view with constant-book rolling, time grids, path settings and limits. | IND-021 | todo | Term-loan maturity and roll-date tests; shared random draws; limit rejection (AC-014) |
| IND-T05 | Implement factor market paths with jumps for hard-to-borrow names. | IND-003 | todo | Moment tests against analytic mean and variance; jump frequency test |
| IND-T06 | Implement Gaussian copula default times with the wrong-way term, a ρ_W = 0 run, and the Student-t sensitivity, all on the same random numbers. | IND-004, IND-007, IND-019 | todo | Marginal PD recovered within standard error; correlation monotonicity; Student-t checks (AC-012) |
| IND-T06a | Implement the reinvestment pool: position revaluation, issuer default, return hazard, payment waterfall and forced sales. | IND-015 | todo | All-overnight pool has zero loss; single-asset hand case (AC-009) |
| IND-T06b | Define the close-out profile schema, defaults, validation and override resolution, returning effective values per position. | IND-020 | todo | Default profile reproduces decision 4 values; precedence, range and unknown-setting tests (AC-013) |
| IND-T07 | Implement close-out with margin lag, MPOR, liquidity costs, FX, and cash collateral at realizable pool value. | IND-005, IND-016 | todo | Hand-computable single-path cases; zero-loss limit cases (AC-004) |
| IND-T08 | Implement EE, EPE, PFE, EL, VaR, expected shortfall, standard errors and the convergence check. | IND-006 | todo | Closed-form single-loan match (AC-002); determinism (AC-001) |
| IND-T09 | Implement Euler expected-shortfall allocation, per-owner loss attribution and the channel split. | IND-008, IND-017 | todo | Sum within 1% (AC-005); owner, borrower and channel totals agree (AC-010) |
| IND-T10 | Implement the comprehensive approach cross-check. | IND-009 | todo | Hand cases including the FX haircut (AC-006) |
| IND-T11 | Implement the sensitivity grid (including any close-out profile setting), named stresses and per-scenario profile overrides. | IND-010, IND-011, IND-020 | todo | Monotonicity (AC-003); stress golden outputs |
| IND-T12 | Implement economic capital allocation, the regulatory proxy, indemnification cost against fee, and flags. | IND-012 | todo | Capital sums to the program total; hand-computed bps under both measures for a two-borrower fixture (AC-015) |
| IND-T13 | Add the service: auth, health, telemetry, and run records with hashes. | IND-001, IND-014 | todo | Health, auth and redaction tests |
| IND-T14 | Add terminal route composition and the INDEM UI with provenance labels, including the close-out profile editor and effective-settings view. | IND-013, IND-020 | todo | Missing inputs show as unavailable (AC-008); nav and route tests |
| IND-T15 | Write the validation report, demo-scale benchmark and handoff. | All | todo | Run times at 50k paths; limitations section states results are synthetic |

## Definition of Done

- The child spec is approved and decisions are logged before code.
- Every metric shows its seed, path count, standard error and data label.
- Wrong-way and no-wrong-way results use the same random numbers.
- The Monte Carlo output agrees with closed forms and the comprehensive approach bound on test cases.
- No real firm appears as a borrower or owner, and no real-world risk claim rests on synthetic data.
