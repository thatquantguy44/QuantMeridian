# Plan: Liquidity Forecasting, Shortfall, and Anomaly Oversight

- **Spec:** spec014-liquidity-oversight (SPEC.md)
- **Status:** Draft — pending owner review
- **Last updated:** 2026-10-18

## Approach

The terminal composes a versioned, hashed input snapshot from MMKT, Sources & Uses, approved funding facilities, and seeded synthetic cash history. It passes that snapshot into the liquidity service; the service has no database connection and cannot substitute local data. Outputs carry source/as-of/provenance and model version.

Forecast known flows are summed from supplied schedules. A residual model ladder predicts only the unexplained remainder. Walk-forward scoring and a seasonal-naive gate choose the served residual model. Quantile/conformal bands feed bootstrapped balance paths and shortfall metrics. Separate detectors generate anomaly evidence. Human review is persisted with a reason; review can recalibrate thresholds but cannot retrain the model.

A verified lever MIP chooses recommendations for each projected P90 shortfall, observing capacity, arrival time, cutoff and buffer constraints. A failed verification or infeasible model is shown as such.

## Model pipeline

1. Deterministic generator supplies evaluation history with calendar regimes, injected shortfalls/anomalies, and drift labels.
2. Known scheduled flows are separated from residual by source contract.
3. Candidate residual models (seasonal naive, ridge, boosted quantile) are trained/evaluated walk-forward; the serving gate selects baseline unless a candidate beats it.
4. Conformalized quantile regression (CQR, NumPy in the service, rolling calibration window) supplies P10/P50/P90 residual bands.
5. Balance paths estimate buffer breaches and survival; outputs include first breach and P90 shortfall.
6. MAD, band-exceedance, and Isolation Forest detectors produce alert scores, detector names, and feature explanations.
7. Review queue records human decisions and threshold adjustments only.
8. Lever board and MIP recommend remediation; verifier checks every row and integrality.
9. Model cards and drift monitors persist versions, hashes, PSI, and coverage.

## Service and terminal boundary

- Python service: services/liquidity_api, port 8016, using optimization_core only for lever selection.
- QuantMeridian server routes compose source inputs and pass a hashed, explicit snapshot; the service does not read Gold or call MMKT/S&U.
- ML stack: scikit-learn (Q6, resolved 2026-10-18); CQR bands are implemented in the service on NumPy, with no MAPIE.
- Cockpit location: `/cash-optimizer/liquidity`, behind the `CASH` module toggle (Q7, resolved 2026-10-18). `/liquidity` stays until that view ships; the same PR redirects it, removes the `LIQ` nav entry and deletes `src/data/liquidity.ts`, carrying the two live FRED early-warning signals over as labeled market indicators.
- Local development uses labeled synthetic fixtures only; production remains disabled.

## Validation strategy

Use synthetic known ground truth only for pipeline checks, never as evidence of production efficacy. Walk-forward splits test leakage prevention. The baseline gate is tested with a candidate that wins and one that loses. Conformal bands are checked for empirical coverage on held-out data. Detection tests measure precision/recall against injected events and include irrelevant-signal negatives. Review queue tests prove no model retraining. Lever MIP gets binding, delayed, and infeasible hand cases plus verifier tampering.

## Sequence

1. ~~Resolve Q6/Q7, currency scope, source contracts and Q4 parameters~~ (done 2026-10-18; see the SPEC decision log); approve child docs and whitepapers.
2. Add deterministic history generator and schema.
3. Build forecast and baseline gate; add bands and model cards.
4. Add shortfall and anomaly paths with review queue.
5. Add portfolio cockpit and lever board.
6. Add verified remediation MIP and terminal composition.
7. Validate demo-scale performance, update as-built papers and handoff.
