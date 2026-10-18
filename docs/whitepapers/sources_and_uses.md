# Sources and Uses Network Optimization

**Status:** Design draft — approved as design direction with spec012 on 2026-10-18 (it stands in for the child design documents); production model not implemented. Becomes as-built under spec012 SU-010.
**Parent:** InventoryBallast 0018 REQ-021–029 and REQ-041.

## Application

A treasury or financing analyst configures available funding sources and required uses, then reviews a recommended matching and its binding constraints. The model does not initiate settlement or infer authority.

## Mechanics and theory

A compatible source/use pair has a non-negative flow variable. Source capacity bounds outflow; each use receives haircut-adjusted eligible coverage. Hard uses require full coverage; soft uses can have explicit residual at a configured penalty. Priority tiers are handled lexicographically, so economics cannot trade away a higher-priority obligation. Optional binary variables support all-or-none, activation cost, ticket-count, lot-size, and exclusive-pair rules.

## Interpretation

A source shadow price estimates the marginal value of additional capacity for the LP. A use shadow price estimates the marginal cost of its coverage requirement. With integer rules, reported dual values come from a disclosed fixed-integer LP and are not global MIP sensitivity. The flow graph and table reconcile to the verified solve.

## Limitations

Compatibility and costs are only as reliable as the user-supplied configuration. Haircuts, legal entity permissions, and internal/external classification must be explicit. A scenario is only a deterministic what-if. Any worked example and formula must be pinned to a golden test before this design paper becomes as-built.
