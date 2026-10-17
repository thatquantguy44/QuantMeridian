# Cash Anomaly Detection and Human Review

**Status:** Design draft — pending spec014 approval; not implemented.
**Parent:** InventoryBallast 0018 REQ-034–035, REQ-039–040, REQ-041.

## Application

The anomaly workflow helps an operations or treasury analyst triage unusual cash flows and balances. It supplies evidence and a review queue; it does not label a transaction fraudulent or change a forecast automatically.

## Mechanics

An ensemble combines rolling median/MAD deviations, forecast-band exceedances, and Isolation Forest scores over explicit flow features. Each alert records the detectors that fired, score, feature contributions, input window, model version, and data hash. A reviewer confirms or dismisses with a reason. Review may adjust published thresholds after an explicit action; it never silently retrains a model.

## Theory, limits, and validation

Robust statistics reduce sensitivity to outliers in the reference window; forecast-band checks compare observations to the conditional forecast; Isolation Forest adds multivariate isolation scoring but is not a causal explanation. Alerts are not proof of misconduct. Seeded anomalies support pipeline evaluation only. Validation reports precision/recall against injected labels and includes negative controls; the held-out evaluation must not leak future data.
