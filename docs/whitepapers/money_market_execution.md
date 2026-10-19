# Money Market Execution Optimization

**Status:** As-built for the verified local LP/MIP execution slice, 2026-10-18. Gold rates, OPT history, and current positions remain open under spec011.
**Parent:** InventoryBallast 0018 REQ-016–020 and REQ-041.

## Application

The module helps a treasury analyst compare feasible cash deployments over a dated horizon. It returns an indicative execution sequence after independent verification. A person reviews and decides; the system does not route orders or present SIM output as a live trade recommendation.

## Model and conventions

For each candidate, account, and purchase date, an amount variable earns its normalized annual `mm_yield_pct` over the holding interval using simple ACT/365, less an explicit cost charged once. Cash balances carry forecast flows and maturities between periods. Policy rows impose entity cash floors, issuer/fund/counterparty caps, rating eligibility, RRP capacity, and WAM/WAL days-to-maturity proxies. Rate rows with a non-OK status cannot enter the model.

In ticketed mode, a binary variable activates each purchase, an integer variable counts lots, and amount equals lot size times lot count. Active purchases meet the minimum ticket; an upper bound and maximum ticket count constrain the plan. Purchases after a dated cutoff are excluded. Indicative plan time is 09:00 in the decision timestamp's local offset, or the later decision time. This is an operational planning convention, not order routing.

The service records the request and rate-snapshot hashes, source status and as-of dates, SIM set, selected cash forecast case, solver version, verification, and assumptions. A failed or infeasible solve returns no recommended blotter.

## Worked example

The golden execution case in `services/money_market_api/tests/test_execution.py` starts with $100mm, a $35mm day-one cash floor, 10mm lots, a $30mm minimum ticket, and one permitted ticket. Two bills mature two days later. With annualized normalized yields of 3.65% and 3.00%, the MIP buys $60mm of the higher-yield bill and retains $40mm cash. Its modeled net return is `60 × 0.0365 × 2 / 365 = $0.012mm` (rounded). Cutting that bill's yield to 2.00% switches the verified ticket to the other bill and lowers return. A p10 forecast miss lowers the feasible ticket to $50mm. Moving the decision after the first bill's 11:00 cutoff removes it from eligibility. The independent verifier checks each result; the test also injects a fractional integer solution and confirms rejection.

The UI shows the service-ordered blotter and matching CSV, cutoff timeline, verified scenario deltas, and separately solved yield/liquidity frontier. LP marginals use the maximization convention: objective USD change per extra $1mm of row right-hand side. MIP runs show only fixed-integer LP marginals. Those values are local; they are not MIP duals or a global repricing of the integer plan.

## Limits

The p10/p50/p90 forecast cases are supplied quantiles, not calibrated probabilities. Reproducibility is scoped to the same configuration, rate snapshot, solver, and version, excluding timing metadata. Scenarios are deterministic what-ifs, not forecasts. Gold rates and current positions are not connected; the SIM book and user-entered policy remain visibly illustrative. The idempotency key is logged but durable replay protection and OPT run history remain open.
