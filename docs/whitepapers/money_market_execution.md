# Money Market Execution Optimization

**Status:** Design draft — pending spec011 approval; not implemented.
**Parent:** InventoryBallast 0018 REQ-016–020 and REQ-041.

## Application

The module helps a treasury analyst compare permissible cash deployments under forecast needs and desk policy. It returns a recommendation and execution sequence. A person reviews and decides; the system does not route orders.

## Theory

The core allocation is a linear optimization model when allocations are continuous. Ticket activation, all-or-none, lot-size, and ticket-count rules create mixed-integer structure. Linear programming dual values describe local marginal trade-offs in the LP; in a MIP, any reported value is from a fixed-integer LP and is labeled as such.

## Mechanics

For instrument (i) and period (t), (x_{i,t}) is the allocated amount. The objective accumulates normalized yield less explicit cost over the holding interval. Cash balance equations carry principal and maturities between periods. Policy rows enforce liquidity floors, maturity limits, issuer/fund/counterparty concentrations, rating constraints, RRP capacity, and operational cutoffs. Binary variables activate discrete ticket choices. All market yields are compared on the normalized `mm_yield_pct` basis and retain the quoted value and basis for display and audit.

A recommended run records the request version, input configuration, rate snapshot hash, source status/as-of dates, solver version, result, verification outcome, and SIM/Gold provenance.

## Worked example

A small golden portfolio should compare two dated instruments with unlike quoted-rate conventions after normalizing both to comparable money-market yields, subject to a cash floor and a maturity cap. The approved child spec must pin the exact values, day-count, costs, and expected allocation in a hand-computable test before the paper is marked as-built.

## Guarantees and limitations

The verifier checks model rows, bounds, integrality, and reconstructed objective before a recommendation is shown. Reproducibility is scoped to the same configuration, snapshot, solver, and version, excluding timing metadata. Scenarios are deterministic what-ifs, not forecasts. Missing source coverage must remain visible; user policy inputs labeled illustrative do not become observed market data.
