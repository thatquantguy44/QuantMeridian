# Spec014: Liquidity Forecasting, Shortfall, and Anomaly Oversight

- **ID:** spec014-liquidity-oversight
- **Parent:** InventoryBallast specs/0018-live-poc-showcase/spec.md, REQ-031–040, REQ-027–030, REQ-041
- **Status:** Draft — pending owner review; not approved for implementation. Q6 and Q7 resolved 2026-10-18; questions 3–4 remain open.
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** — (pending owner review)
- **Last updated:** 2026-10-18

> WHAT and WHY only. Model architecture belongs in PLAN.md; task ordering belongs in TASKS.md.

## Summary

Create a local liquidity oversight workflow that forecasts cash, detects shortfalls and unusual flows, routes alerts through human review, and recommends feasible liquidity levers. It combines known scheduled flows with an evaluated residual forecast and makes model performance, uncertainty, data lineage, and limitations visible.

## Problem & Context

The current liquidity view is seeded with generated values rather than forecasting or detecting from an inspectable history. Treasury needs a view across legal entity, currency, account, and instrument, with a traceable route from forecast to alert to reviewed remediation. The 0018 requirements prohibit unsupported estimates and require that models which fail to beat a seasonal-naive baseline are not served.

This module depends on the MMKT and Sources & Uses contracts for holdings, maturities, positions, and scheduled flows. The terminal composes data between services; the liquidity service itself has no database dependency.

## Goals

- Generate labeled synthetic histories for deterministic development and evaluation.
- Forecast daily cash by account, separating known flows and model-estimated residual, with P10/P50/P90 bands.
- Gate served forecast models against a walk-forward seasonal-naive baseline.
- Measure buffer breach risk, shortfall, first breach, and survival horizon.
- Detect anomalies with named statistical and ML detectors; explain alert score and features.
- Support human confirm/dismiss review, threshold-only recalibration, and audit history.
- Consolidate cash portfolios and recommend feasible liquidity levers for the P90 shortfall.
- Version each model and expose training, validation, drift, and coverage evidence.

## Non-goals

- Bank/TMS connectivity, payment initiation, automatic facility draws, or trade execution.
- Deep learning, LLM-based forecasting, or opaque unreviewed production models.
- Silent training on reviewer decisions or automatic threshold changes.
- Cross-currency netting without explicit FX conversion and policy.
- Treating synthetic ground truth as evidence of real-world performance.

## Requirements

| ID | Requirement | Parent | Priority |
|---|---|---|---|
| LIQ-001 | Generate deterministic cash histories with calendar regimes, injected shortfalls, labeled anomalies, and drift episodes. | REQ-040 | must |
| LIQ-002 | Forecast daily net flow and closing balance per legal entity, currency, account, default 10 business days; separate known scheduled flows and residual with P10/P50/P90. | REQ-031 | must |
| LIQ-003 | Walk-forward evaluate against seasonal naive; serve the baseline if a candidate does not beat it and disclose substitution. | REQ-032 | must |
| LIQ-004 | Project balance paths and report daily buffer-breach probability, first breach, P90 shortfall, survival horizon, and WATCH/STRESS/SEVERE alerts. | REQ-033 | must |
| LIQ-005 | Score anomalies with rolling median/MAD, forecast-band exceedance, and Isolation Forest; identify fired detectors and top features. | REQ-034 | must |
| LIQ-006 | Put alerts in a review queue; persist confirm/dismiss reason and audit trail; recalibration changes thresholds only and is never silent. | REQ-035 | must |
| LIQ-007 | Reconcile portfolio positions across legal entity, currency, account, and instrument to module inputs; replace fabricated Liquidity data. | REQ-036 | must |
| LIQ-008 | Show each lever with capacity, time-to-cash, cutoff, cost, usage, and provenance. | REQ-037 | must |
| LIQ-009 | Select levers via a verified MIP covering daily P90 shortfall subject to capacity, timing, cutoffs, and buffer floors; infeasibility includes an explanation. | REQ-038, REQ-028 | must |
| LIQ-010 | Store model cards, versions, training-data hashes, seeds, PSI, and interval-coverage drift metrics. | REQ-039 | must |
| LIQ-011 | Run in its own Python service and accept positions/flows from terminal composition; service has no database dependency. | REQ-027 | must |
| LIQ-012 | Label all Gold/SIM/user inputs and never present unverified values as recommendations. | REQ-030 | must |

## Acceptance Criteria

- **AC-001:** Synthetic generator is deterministic; injected events and labels are reproducible and time-indexed.
- **AC-002:** Forecast split is exact: known flows are passed through, only residual is estimated, and bands pass coverage checks on a held-out walk-forward window.
- **AC-003:** A candidate that fails the baseline gate is replaced with seasonal naive and the substitution is visible.
- **AC-004:** Shortfall metrics match a hand-computable path and the seeded data's event labels.
- **AC-005:** Every alert names fired detectors and features; no reviewer action retrains a model.
- **AC-006:** Portfolio views reconcile to upstream positions and cash flows; missing inputs show unavailable/error rather than synthetic substitution.
- **AC-007:** Lever recommendation passes independent verification; infeasible shortfall is reported without a partial “success.”
- **AC-008:** Model card and drift outputs include version/data hash and do not claim real-world performance from synthetic tests.

## Decisions required before implementation

1. ~~**Q6 / stack:** confirm allowed ML stack and dependency versions for boosted quantile regression and Isolation Forest.~~ **Resolved 2026-10-18:** scikit-learn. See the decision log.
2. ~~**Q7 / placement:** confirm whether the cockpit replaces /liquidity or lives under /cash-optimizer.~~ **Resolved 2026-10-18:** under `/cash-optimizer/`. See the decision log.
3. Define currency scoping and which account/instrument dimensions have approved source contracts.
4. Confirm forecast history window, conformal coverage target, breach-alert thresholds, and review-queue retention.

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-10-18 | **Q6 resolved — ML stack is scikit-learn.** It supplies the residual-model ladder's ridge and boosted quantile regression (gradient boosting with quantile loss) and the Isolation Forest detector. The exact version is pinned in `services/liquidity_api` when the service is created. scikit-learn has no conformal-prediction API: split-conformal calibration (PLAN step 4) is written in the service on NumPy, and any further ML library (for example MAPIE) needs its own owner decision. | Owner (accepted recommendation) |
| 2026-10-18 | **Q7 resolved — the new liquidity view lives under `/cash-optimizer/`,** as its lever view, rather than replacing `/liquidity` in place. Not yet decided: the exact sub-route, and whether the existing `/liquidity` page is retired, redirected or kept once the new view ships. Until then `/liquidity` stays as it is (seeded synthetic data). | Owner (accepted recommendation) |

## Related documents

- Parent: InventoryBallast specs/0018-live-poc-showcase/
- Shared model library: services/optimization_core/
- Treasury sources: spec011 and spec012 (passed into this service by terminal routes)
- Existing synthetic liquidity module to replace: src/data/liquidity.ts
