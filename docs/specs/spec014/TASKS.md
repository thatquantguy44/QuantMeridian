# Tasks: Liquidity Forecasting, Shortfall, and Anomaly Oversight

- **Spec:** spec014-liquidity-oversight (SPEC.md, PLAN.md)
- **Status:** Draft — pending owner review; no implementation authorized yet
- **Parent:** 0018 REQ-027–030, REQ-031–041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| LIQ-001 | Resolve Q6/Q7, source contracts, currency grain, forecast window, thresholds, and retention; approve child docs. | LIQ-001–012 | blocked | Owner decisions recorded. Q6 (scikit-learn) and Q7 (under `/cash-optimizer/`) resolved 2026-10-18; questions 3–4 and approval remain |
| LIQ-002 | Define versioned cash-history, forecast, alert, review, lever, and model-card contracts. | LIQ-001–012 | todo | Schema and TS/Python parity fixtures |
| LIQ-003 | Build deterministic synthetic generator and event labels. | LIQ-001 | todo | Fixed-seed/calendar/shortfall/anomaly/drift golden tests |
| LIQ-004 | Implement residual forecast ladder, walk-forward evaluation, baseline gate, and conformal bands. | LIQ-002/003/010 | todo | Leakage tests, score gate, coverage evidence |
| LIQ-005 | Implement cash balance paths, breach probability, first breach, P90 shortfall, survival horizon and alerts. | LIQ-004 | todo | Hand-computable paths and threshold cases |
| LIQ-006 | Implement anomaly ensemble and per-alert detector/feature explanations. | LIQ-005 | todo | Injected signal precision/recall and negative controls |
| LIQ-007 | Implement review queue, audit trail, and threshold-only recalibration. | LIQ-006 | todo | Confirm/dismiss reason persisted; no retraining side effect |
| LIQ-008 | Implement portfolio cockpit, reconciliation, and lever board with provenance. | LIQ-007/008/012 | todo | Source totals reconcile, stale/missing inputs explicit |
| LIQ-009 | Implement lever-remediation MIP on optimization_core and independent verification. | LIQ-009 | todo | Feasible/binding/delayed/infeasible golden cases |
| LIQ-010 | Add service auth, health, telemetry, run history, and terminal route composition. | LIQ-011 | todo | Contract parity, redaction and source-boundary tests |
| LIQ-011 | Add model cards, drift monitoring, demo-scale benchmark, and as-built papers. | LIQ-010, REQ-041 | todo | Hash/version/PSI/coverage evidence and validation report |

## Definition of Done

- Child spec and model design drafts are approved before code.
- Known cash flows and estimated residual remain separate.
- A model that fails the seasonal-naive gate is not served.
- Alerts retain human decisions without silently retraining.
- Remediation is independently verified; infeasibility is explicit.
- No production readiness or forecast efficacy claim is based only on synthetic fixtures.
