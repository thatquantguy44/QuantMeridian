# Liquidity Forecasting, Shortfall, and Remediation

**Status:** Design draft — pending spec014 approval; not implemented.
**Parent:** InventoryBallast 0018 REQ-031–033, REQ-037–038, REQ-041.

## Application

This model gives a treasury analyst a forward view of cash buffers, identifies when a portfolio may breach policy, and ranks operationally available levers. It is an oversight and recommendation workflow; a person decides whether to act.

## Mechanics and theory

Scheduled flows are supplied separately from uncertain residual cash movement. Candidate residual models are evaluated walk-forward against seasonal naive; a candidate that does not beat the baseline is not served. Quantile forecasts are calibrated to P10/P50/P90 using held-out residual behavior. Cash paths combine known flows and sampled residuals to estimate breach probability, first breach, P90 shortfall, and survival horizon.

Lever remediation is a mixed-integer selection model with time-indexed lever actions. It covers the forecast P90 shortfall subject to capacity, settlement time, cutoff, cost, and buffer constraints. The optimization is independently verified; an infeasible result remains an explicit shortfall.

## Limitations and validation

The forecast depends on supplied schedules, history, and policy buffers. Synthetic fixtures can test leakage, coverage logic, and model selection but cannot establish real-world forecast performance. Recommendation quality depends on accurate lever timing/capacity and does not execute an action.
