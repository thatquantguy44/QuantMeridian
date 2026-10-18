# Spec014: Liquidity Forecasting, Shortfall, and Anomaly Oversight

- **ID:** spec014-liquidity-oversight
- **Parent:** InventoryBallast specs/0018-live-poc-showcase/spec.md, REQ-031–040, REQ-027–030, REQ-041
- **Status:** Draft — pending owner review; not approved for implementation. All owner questions (Q6, Q7, 3 and 4) resolved 2026-10-18; awaiting owner approval of the full spec, plan and tasks.
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
3. ~~Define currency scoping and which account/instrument dimensions have approved source contracts.~~ **Resolved 2026-10-18.** See the decision log.
4. ~~Confirm forecast history window, conformal coverage target, breach-alert thresholds, and review-queue retention.~~ **Resolved 2026-10-18.** See the decision log.

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-10-18 | **Q6 resolved — ML stack is scikit-learn.** It supplies the residual-model ladder's ridge and boosted quantile regression (gradient boosting with quantile loss) and the Isolation Forest detector. The exact version is pinned in `services/liquidity_api` when the service is created. scikit-learn has no conformal-prediction API; see the next entry for how bands are calibrated. Any further ML library needs its own owner decision. | Owner (accepted recommendation) |
| 2026-10-18 | **Q7 resolved — the new liquidity view lives under `/cash-optimizer/`,** as its lever view, rather than replacing `/liquidity` in place. The sub-route and the fate of `/liquidity` are decided in the entries below. | Owner (accepted recommendation) |
| 2026-10-18 | **Forecast bands — conformalized quantile regression (CQR), written in the service on NumPy; no MAPIE.** The P10/P90 scikit-learn quantile models are widened by their nonconformity scores on a held-out calibration window. Because cash flows are not exchangeable, the calibration window rolls forward with the walk-forward evaluation, and empirical coverage on held-out data (AC-002) is the test of record. If coverage misses its target, the model card says so and does not claim the theoretical guarantee. | Owner (accepted recommendation) |
| 2026-10-18 | **Route — `/cash-optimizer/liquidity`.** A child route of the cash optimizer in `src/App.tsx`, behind the same `on("CASH")` module toggle, with a tab on the cash optimizer page linking the two views. | Owner (accepted recommendation) |
| 2026-10-18 | **Existing `/liquidity` page — keep until the new view ships, then redirect.** Until then `/liquidity` stays as it is (seeded synthetic data, provenance badge). The PR that ships `/cash-optimizer/liquidity` also redirects `/liquidity` to it, removes the `LIQ` nav entry (`src/lib/nav.ts` and `src/lib/nav.test.ts`), and deletes the seeded data in `src/data/liquidity.ts` (LIQ-007). The two live FRED early-warning signals (SOFR–EFFR spread, 5-day HY OAS move) move into the new view as labeled market indicators, kept separate from the cash-flow anomaly detectors (LIQ-005). | Owner (accepted recommendation) |
| 2026-10-18 | **Question 3 resolved — currency scope.** Each forecast, shortfall calculation and lever solve covers exactly one currency, matching spec012 questions 1 and 4 and spec011 question 2. Buffers stay in each legal entity's native currency. A base-currency total is allowed for display only, from a dated, labelled FX snapshot. The first release is USD only; contracts carry a `currency` field so other currencies can be added without a contract change. | Owner (accepted recommendation) |
| 2026-10-18 | **Question 3 resolved — forecast grain and approved sources.** Forecasts are made per legal entity × currency × account. Instruments appear only in holdings and levers, not as a forecasting dimension. Approved sources: (a) cash history from the deterministic synthetic generator (LIQ-001), labelled `SIM`; (b) known scheduled flows and holding maturities from **one positions contract shared with spec011 (MM-011)**, shown as unavailable until that feed exists; (c) funding facilities and levers entered by the user with provenance, like spec012 sources; (d) FRED market indicators (SOFR–EFFR spread, HY OAS), display only. Any other input is shown as unavailable, never synthesized (AC-006). Bank or treasury-system connectivity stays a non-goal. | Owner (accepted recommendation) |
| 2026-10-18 | **Question 4 resolved — history and evaluation windows.** The synthetic generator produces 3 years of business days, covering month-, quarter- and year-ends and injected drift episodes. Training uses an expanding window with a minimum of 252 business days. Walk-forward test folds are 10 business days, matching the default horizon. CQR calibration uses a rolling window of the most recent 60 business days. | Owner (accepted recommendation) |
| 2026-10-18 | **Question 4 resolved — coverage target.** The P10–P90 band targets 80% empirical coverage on held-out data over the rolling window. 75–85% passes; below 75% fails and flags drift on the model card; above 90% is flagged as too wide. The lower tail is also checked on its own: the residual should fall below P10 no more than about 10% of the time, because shortfall metrics depend on that tail. | Owner (accepted recommendation) |
| 2026-10-18 | **Question 4 resolved — alert thresholds.** Breach probability is the probability that closing balance falls below the buffer floor on any day in the horizon. WATCH at ≥ 10%; STRESS at ≥ 25%; SEVERE at ≥ 50%, or when the first breach is within 2 business days and the P90 shortfall exceeds the lever capacity that can deliver cash by then. Anomaly detectors: rolling median/MAD flags at a robust z-score ≥ 3.5; band exceedance flags values outside P10–P90; the Isolation Forest score threshold is set on synthetic data and recorded on the model card. All thresholds are configurable and labelled illustrative until real data exists; changing one is the logged, never-silent threshold-only recalibration path (LIQ-006). | Owner (accepted recommendation) |
| 2026-10-18 | **Question 4 resolved — retention.** Review decisions and the audit trail are append-only and never deleted automatically. Run records (hashes, model versions, outputs) are kept indefinitely. Raw input snapshots are kept 90 days locally, since they can be rebuilt from their hashed sources. The formal retention period is confirmed with compliance before any production use. | Owner (accepted recommendation) |

## Related documents

- Parent: InventoryBallast specs/0018-live-poc-showcase/
- Shared model library: services/optimization_core/
- Treasury sources: spec011 and spec012 (passed into this service by terminal routes)
- Existing synthetic liquidity module to replace: src/data/liquidity.ts
