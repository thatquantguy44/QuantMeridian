# Tasks: Borrower Default and Indemnification Risk (INDEM)

- **Spec:** spec017-indemnification-risk (SPEC.md, PLAN.md)
- **Status:** Draft — pending owner review; no implementation authorized yet

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| IND-T01 | Resolve SPEC decisions 1–8 and record them in the decision log. | IND-001–014 | blocked | Owner decisions recorded |
| IND-T02 | Rename "BlueCrest" in `econEnhancements.ts` and add it to the `REAL_FIRMS` pattern. | AC-007 | todo | Fictional-counterparty test fails before the rename and passes after |
| IND-T03 | Define versioned snapshot, result and model-card contracts. | IND-001, IND-014 | todo | JSON schemas with TS/Python parity fixtures |
| IND-T04 | Build the deterministic synthetic book: loans, collateral, margin and borrower credit inputs. | IND-002 | todo | Fixed-seed golden test; reconciles to SLAB if decision 8 is to extend it |
| IND-T05 | Implement factor market paths with jumps for hard-to-borrow names. | IND-003 | todo | Moment tests against analytic mean and variance; jump frequency test |
| IND-T06 | Implement copula default times with the wrong-way term and a ρ_W = 0 run on the same random numbers. | IND-004, IND-007 | todo | Marginal PD recovered within standard error; correlation monotonicity |
| IND-T07 | Implement close-out with margin lag, MPOR, liquidity costs and FX. | IND-005 | todo | Hand-computable single-path cases; zero-loss limit cases (AC-004) |
| IND-T08 | Implement EE, EPE, PFE, EL, VaR, expected shortfall, standard errors and the convergence check. | IND-006 | todo | Closed-form single-loan match (AC-002); determinism (AC-001) |
| IND-T09 | Implement Euler expected-shortfall allocation and per-owner loss attribution. | IND-008 | todo | Sum within 1% (AC-005); owner and borrower totals agree |
| IND-T10 | Implement the comprehensive approach cross-check. | IND-009 | todo | Hand cases including the FX haircut (AC-006) |
| IND-T11 | Implement the sensitivity grid and named stresses. | IND-010, IND-011 | todo | Monotonicity (AC-003); stress golden outputs |
| IND-T12 | Implement indemnification cost against fee, with flags. | IND-012 | todo | Hand-computed bps for a two-borrower fixture |
| IND-T13 | Add the service: auth, health, telemetry, and run records with hashes. | IND-001, IND-014 | todo | Health, auth and redaction tests |
| IND-T14 | Add terminal route composition and the INDEM UI with provenance labels. | IND-013 | todo | Missing inputs show as unavailable (AC-008); nav and route tests |
| IND-T15 | Write the validation report, demo-scale benchmark and handoff. | All | todo | Run times at 50k paths; limitations section states results are synthetic |

## Definition of Done

- The child spec is approved and decisions are logged before code.
- Every metric shows its seed, path count, standard error and data label.
- Wrong-way and no-wrong-way results use the same random numbers.
- The Monte Carlo output agrees with closed forms and the comprehensive approach bound on test cases.
- No real firm appears as a borrower or owner, and no real-world risk claim rests on synthetic data.
