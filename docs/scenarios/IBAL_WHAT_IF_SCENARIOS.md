# IBAL What-If Scenario Essence

**Updated:** 2026-09-17
**Source:** `src/app/inventory-optimizer/page.tsx`

## Purpose

IBAL what-if scenarios are lightweight, repeatable stress cases for the InventoryBallast workbench.
They do not replace the optimizer, change the mathematical formulation, or introduce a second solve
authority. Each selected scenario creates a synthetic dataset, sends it to the real IBAL service,
and compares the engine-owned result against the same reporting frame.

The current scenarios are meant to answer practical desk questions:

- What happens when lendable supply gets tighter?
- What happens when borrow demand shifts toward high-fee special names?
- What happens when demand concentrates into fewer borrower parent groups?
- What happens when entity-confidence standards are stricter?
- What happens when utilization and reserve constraints are relaxed?

## Scenario Mechanics

The preset scenarios start from the current Dataset Intake and Run Config form values, then apply a
small set of scenario-specific overrides. Presets also add deterministic seed offsets so the runs
are repeatable while still differing from the base case. Custom shocks are different: when a user
saves one, IBAL stores a snapshot of the current synthetic and run-config form settings in browser
session storage and replays that snapshot during the scenario sweep.

All scenarios are solved through the IBAL API. Market Terminal summarizes the returned result; it
does not recompute allocation economics, constraints, validation, or verification.

## Preset Scenarios

| Scenario | Runtime lever | Business meaning | What to watch |
| --- | --- | --- | --- |
| Base Case | Current synthetic settings and run config | The current operating view; comparison anchor for the rest of the sweep. | Total delta value, fill rate, average utilization, binding constraints. |
| Scarce Supply | Synthetic `scarce` profile | Simulates tighter lendable inventory and higher starting utilization. | Whether value falls, fill ratio drops, or inventory-balance constraints bind more often. |
| Specials Squeeze | Synthetic `specials` profile | Simulates richer fee dispersion and more special-borrow demand. | Whether the optimizer can capture higher-value demand without creating concentration or eligibility pressure. |
| Borrower Concentration | Synthetic `concentrated` profile | Simulates demand concentrated into fewer parent groups. | Parent/entity caps, allocation concentration, rejected or partially filled demand. |
| Strict Entity Confidence | `minimum_entity_confidence = 0.95` | Raises the standard for entity-confidence eligibility. | Demand lost to entity-confidence filtering and any change in constraint slack. |
| More Balance Sheet | `utilization_cap = 0.98`, `reserve_fraction = 0.02` | Relaxes two balance-sheet style constraints: higher allowed utilization and lower reserve buffer. | Incremental value, higher utilization, and whether loosened limits create more binding route or balance rows elsewhere. |

## Reported Comparison Fields

The comparison table is intentionally concise:

- `Delta Value`: IBAL result economics `total_delta_usd`.
- `Vs Base`: difference between a scenario's `Delta Value` and the base scenario's value.
- `Fill Rate`: filled shares divided by effective demand-cap shares from IBAL demand rows.
- `Avg Utilization`: average utilization across IBAL balance rows.
- `Binding`: count of constraint rows with near-zero slack.
- `Net Allocation`: sum of allocation increases minus decreases across route allocations.
- `Status`: normalized scenario solve status from the IBAL result path.

These fields are directional diagnostics, not approval controls. A scenario with higher value can
still be less desirable if it creates excess concentration, weaker eligibility quality, or tighter
constraint slack.

## Interpretation Rules

Use Base Case as the anchor, then read each scenario as an explanation of tradeoffs. A good scenario
is not simply the highest `Delta Value`; it is a result that improves economics while keeping fill,
utilization, constraint pressure, and eligibility quality inside an acceptable operating envelope.
The scenario detail view should be used to inspect which inventory balances and route allocations
drove the summary movement.

The current scenario suite is synthetic-only unless a future approved workflow adds governed book
feeds. It is best used for pilot review, model understanding, workflow demos, and regression checks
around IBAL behavior under recognizable desk conditions.
