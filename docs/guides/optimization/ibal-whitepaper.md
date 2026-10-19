# InventoryBallast (IBAL): white paper and business guide

> **Status:** live in local development. The pinned InventoryBallast engine solves every run and independently verifies it. Data is synthetic or user-uploaded; production access is disabled. Results are decision support, not trades.

## Executive summary

IBAL decides **where a securities-lending desk's lendable inventory should go**. For every eligible route from an inventory position to a borrower, it chooses how many shares should be on loan after optimization, so that lending value is as high as possible while respecting inventory balances, borrower demand, utilization policy, reserves, counterparty limits and the cost of changing existing loans.

The result is not a ranked list. It is one feasible, verified allocation for the whole book, with balances, economics, unfilled demand, the constraints that bound the answer, and a reason code for every route that moved.

On top of a single solve, IBAL adds:

- **What-if scenarios:** re-generate the book under different market conditions and compare.
- **Engine stress scenarios:** apply registered shocks (recalls, fee squeezes, defaults, limit cuts, supply shocks, rate ladders) to a verified base run, sized with plain controls, and see the driver attribution.
- **A ranked stress suite:** run every supported shock at once and rank them by impact.
- **Base-run comparison:** compare two completed runs entity by entity.
- **A guided demo ("Present"):** warms the engine up and walks the story in six steps.

## Business problem

The naive rule in securities lending is "lend scarce shares to whoever pays the most." It fails because a desk has to satisfy many conditions at once:

- How many shares are truly lendable after existing loans, reserves and commitments?
- How much borrower demand is real at the quoted fee, given that higher fees reduce demand?
- Which borrowers are close to a counterparty or parent-group limit?
- Which inventory pools are near their utilization policy cap?
- Is moving an existing loan worth the transition cost?
- Which rules become binding if the desk fills the most attractive demand?

IBAL treats this as one allocation problem across all routes, so a high-fee borrower near its parent limit, a cheaper borrower with spare capacity and an existing loan that is costly to recall are traded off together.

## How it works

### The pipeline

Every run follows a fixed path inside the pinned engine:

1. **Validate** the request. Ambiguous or unsafe data fails closed with located errors instead of being silently repaired.
2. **Build the model context:** inventory, routes, demand groups, policies and limits in one shape.
3. **Compile** the optimization problem (LP, MIP or QP depending on the features in use).
4. **Solve** with HiGHS behind a solver-neutral adapter.
5. **Verify** independently of the solver: bounds, balances, every row, integer rules and the reconstructed objective.
6. **Assemble** the result: allocations, balances, demand, economics, constraints, reason codes, hashes.

### Inventory state

For each inventory position `i`, the available supply is

`available = lendable − on loan − reserved − committed elsewhere`

where *lendable* includes shares already on loan. The engine conserves shares exactly: it never creates or loses inventory.

### Demand and elasticity

Borrower demand is grouped (a **demand group** is one borrower's demand in one security). Demand responds to fees through a **constant elasticity** curve:

`raw demand = reference quantity × (fee ÷ reference fee) ^ (−elasticity)`

so if a route's fee is above the reference fee, demand falls. An optional uncertainty haircut removes one standard deviation of forecast error, and an optional hard maximum caps it. The result is the **effective cap** for the group. Elasticity is evaluated once before solving; inside the optimization the cap is a constant.

### The objective

The value of putting one more share on route `j` over the horizon is the **net fee coefficient**:

`c = price × (horizon days ÷ day-count year) × (fee rate × revenue share − variable cost rate)`

The optimizer maximizes

`Σ c × post-quantity − Σ transition costs on increases and decreases`

Transition costs are one-time amounts, not scaled by the horizon.

### The constraints (the baseline LP)

| Row kind (as shown in the Constraints tab) | Rule |
|---|---|
| `inventory_balance` | Shares placed on all routes from a position + shares left available = lendable − reserved − committed |
| `transition_identity` | Post-quantity − increase + decrease = current quantity (records each route's change) |
| `demand_cap` | Shares on a demand group's routes ≤ its effective cap |
| `utilization_max` / `utilization_min` | Shares on loan from a position ≤ (or ≥) the policy's utilization limit × lendable |
| `counterparty_quantity` / `counterparty_notional` | Shares (or USD value) lent to a borrower, legal entity or parent group ≤ its limit |
| Bounds | Each route's hard minimum and maximum; a reserve buffer of shares kept available |

When routes have all-or-none or lot-size rules (the **discrete route fraction** in the synthetic generator), the problem becomes a **mixed-integer program (MIP)**. A positive allocation-stability penalty adds a quadratic term (QP). Exact mixed-integer quadratic problems are rejected rather than approximated.

### Solver statuses

| Status | Meaning |
|---|---|
| `optimal` | Proven optimal (for MIP, within the configured relative gap) |
| `feasible_limit` | A time or iteration limit was hit with a feasible answer. Never promoted to optimal. |
| `infeasible` | No allocation satisfies every rule |
| `solver_error`, `invalid_model`, `interrupted` | The solve did not complete |

### Independent verification

The verifier trusts neither the solver's status nor its objective. With an absolute tolerance of 1e-6 it measures the worst bound violation, the worst row violation, the worst integrality violation (MIP), and the difference between the solver's objective and the objective recomputed from the solution. The result is marked verified only if all pass. These four numbers appear in the Diagnostics tab.

### Reason codes

Every allocation carries reason codes explaining why it moved or did not. The most common on synthetic books are `higher_net_fee` (shares moved toward a better-paying route) and `demand_cap_binding` (the route filled its group's demand). Others include `inventory_scarce`, `utilization_cap_binding`, `reserve_binding`, `counterparty_limit_binding`, `ineligible_route`, `transition_cost_exceeds_uplift`, `trade_reduced_supply` and `elasticity_reduced_demand`.

### Scenarios at three levels

| Feature | What changes | How it compares |
|---|---|---|
| **What If Scenarios** | The synthetic generator is re-run with one change (profile or setting) on the same seed | Each scenario is solved separately and compared with the Base Case on delta value, fill, utilization and binding rows |
| **Engine Scenario Studio** | A registered engine shock is applied to the **same** dataset and its verified base run | The engine re-solves the shocked book and attributes the change to securities, borrowers, pools and routes |
| **Ranked Stress Suite** | One default-sized shock per supported family | Outcomes ranked by objective change, worst first |

Engine shocks are sized against the base run's actual allocation (for example a recall of 50% of what the optimizer placed on the three largest routes). A shock sized against the pre-optimization book can miss the routes the optimizer actually uses and show no effect.

### Guided showcase

Besides the synthetic books, the pinned engine ships three checked-in SIM books with a deterministic `run_demo` sequence: **base → shock → diagnose → repair → compare**. The terminal only renders what the engine returns; it does not compute an objective, allocation, binding status or repair itself.

| Book | What it shows |
|---|---|
| Principal | A supply shock makes the `INV-AAA` inventory-balance row bind at 40 shares (100 in base). The verified repair raises value and adds a new entity driver; matched and new entities stay separate. |
| Agency | Owner economics, bound mandates and indemnification disclosures |
| Prime | A deliberately infeasible shock (no allocation), then a verified repair; the diagnosis shows coverage and excluded-source evidence |

The showcase books are LPs. The base step shows the engine's LP sensitivity ranges for the principal book, and the prime book's planned infeasibility carries the engine's elastic explanation (`no_relaxable_rows`: the book has no utilization limit to relax, so the cause is the hard coverage requirement). The terminal never estimates a shadow price or range itself. The as-built note is `docs/whitepapers/ibal_showcase.md`.

### Solver diagnostics (engine spec0020)

| Where | What the engine returns |
|---|---|
| **Diagnostics tab** | Model statistics on every run: variable, row, nonzero and integer counts, the value ranges of the constraint matrix, objective, bounds and row limits (as HiGHS prints them), a warning when any range spans more than 10⁶, and compile, solve and verify timings. For a MIP, the incumbent and bound trace. |
| **Sensitivity tab** | For an optimal LP, the interval each route coefficient and each row limit can move over with the current solution still optimal, and the objective at each end. A one-parameter sweep (route fee, demand elasticity, minimum or maximum utilization) gives the local range from the same ranging, or re-solves a grid of up to 25 values, refining where the binding rows change, and verifies every point. |
| **Infeasibility tab** | For an infeasible run, opened automatically: the engine solves a separate model in which only utilization limits may stretch and reports which limits must move and how far, or why no such move restores feasibility. Nothing is applied to the request. |

When a diagnostic does not apply, the engine says why with a stable reason code (for example `formulation_not_continuous_lp`, `formulation_has_no_integer_variables`, `parameter_moves_more_than_one_model_entry`); the terminal shows the code with a plain-language gloss.

## Data and provenance

| Source | What it is | Badge |
|---|---|---|
| **Synthetic** | Generated by the IBAL service from a profile, a scale and a seed. Fully reproducible from the seed. Entity mappings are marked synthetic-only. | `SIM` |
| **Upload** | A JSON or XLSX dataset in the service's template format (download the templates from Dataset Intake). Validated strictly. | `LIVE` label means user-supplied, not production |

Every result carries the request hash (dataset), config hash (run settings), run id, correlation id, engine package version and pinned commit, and solver backend and version. The **Export** button produces a zip bundle of result tables for the run on screen.

The service refuses to report ready unless the installed engine's source fingerprint matches the reviewed commit (`ENGINE_PINNED` in the Optimization Center).

## Assumptions

### Model assumptions

| Assumption | Detail |
|---|---|
| Single point in time | One snapshot; only information known at the as-of time. Multi-period settlement exists in the engine but is not exposed in this page. |
| USD only | Inventory must be USD-denominated; foreign positions must be converted upstream |
| Linear economics | Fee revenue is linear in shares at a fixed fee per route; demand response is handled by the elasticity cap, not inside the objective |
| Horizon | 1 day, actual/360, unless the run config changes it (not exposed in this page) |
| Fractional shares | Allowed unless a route has a lot size |
| Reinvestment income | Not implemented: reinvestment rate and collateral factor fields are accepted but unused |
| Entity aggregation | Borrowers are rolled up to legal entities and parent groups for counterparty limits only when the relationship carries an approval reference. The vendor ownership-confidence score does not authorize aggregation. |
| Minimum entity confidence | Accepted in the run config (default 0.80) and included in the config hash, but the pinned engine does not read it, so the page no longer offers it |
| Point-in-time freshness | Inventory and demand stamped more than 24 hours before the request's as-of time, or after it, fail validation with `STALE_OR_FUTURE_AS_OF` |

### Synthetic generator defaults

| Setting | Default | Allowed range |
|---|---|---|
| Profile | balanced | balanced, scarce, concentrated, specials |
| Scale | small (8 securities, 2 pools, 6 borrowers, 3 parent groups, 3 routes per security) | small, medium (30/4/15/5/5), large (100/8/40/10/8), custom |
| Seed | 1701 | 0 to 4,294,967,295 |
| As of / effective date | 2026-09-14 12:00 UTC / 2026-09-14 | fixed |
| Starting utilization | 35% | 0–85% |
| Utilization cap | 90% | 25–100% |
| Borrower concentration | 35% | 0–100% |
| Fee rate mean / dispersion | 2.50% / 1.20% | 0.01–25% / 0–10% |
| Elasticity mean | 0.10 | 0–5 |
| Reserve fraction | 5% | 0–30% |
| Ineligible fraction | 3% | 0–50% |
| Discrete route fraction | 0% | 0–50% (needs MIP support) |

**Profiles override fields regardless of the sliders:** *scarce* sets starting utilization 62%, cap 92%, fee mean 4.5%, dispersion 2.0%; *concentrated* sets borrower concentration 80% and starting utilization 48%; *specials* sets fee mean 8.5%, dispersion 4.0%, elasticity 0.25 and discrete routes 10%. The page marks affected sliders "profile-set".

### Reference run

On the default synthetic book (balanced, small, seed 1701) the base case solves `optimal` in under a millisecond as an LP with 80 variables and 67 rows. Fee revenue rises from $1,458 to $3,889 over the one-day horizon, a **total delta of about $2,431**. The ranked stress suite on that book gives, worst first: borrower default −$1,319, borrower limit cut −$784, recall wave −$356, supply shock −$117, then rate-shock steps (+$85, +$169, +$335) and specials squeeze (+$335).

## Outputs and how to read them

| Output | How to read it |
|---|---|
| **Delta value** | Change in total horizon value versus the pre-optimization book, USD. The headline economic result. |
| **Economics components** | Where the value came from: fee revenue, transition cost, expected costs, indemnification cost, owner fairness. On synthetic books only fee revenue is non-zero. |
| **Allocations** | Current versus post quantity per route, the fee and reason codes. Click a route for its evidence (for example how much demand-cap slack remains). |
| **Balances** | Per position: lendable, reserved, committed, on loan before and after, available after, utilization. |
| **Demand** | Per group: reference, raw (after elasticity) and effective cap, filled, unfilled and fill ratio. |
| **Constraints** | Every row with its activity, slack and dual value. Slack of zero means binding. |
| **Sensitivity range** | For an LP, how far a coefficient or limit can move before the solution changes. A narrow range on a route fee means a small repricing would move shares. |
| **Dual value** | For an LP, the change in objective per unit of the row's limit. A binding counterparty limit with a large dual is worth renegotiating. |
| **Before / After panel** | The same result as a story: on-loan bridge, demand fill, inventory concentration treemap, top route movers, inventory impact, demand shortfall and reason-code totals. |
| **Engine stress results** | For each shock: status, verification, objective change and entity-level driver deltas, with a reconciliation residual per dimension. |
| **Base-run comparison** | Two completed runs side by side with portfolio deltas and driver tables. A partial comparison keeps unmatched rows and never treats a missing delta as zero. |

## Validation

- The engine's own test suite covers balance conservation, verification, attribution, statuses and the scenario registry.
- The service checks request contracts strictly and returns located issues (for example a field above its allowed maximum).
- Terminal tests cover the capability gate (which controls appear for the pinned engine), the result contract, the sizing logic (22 tests) and the guided demo (8 tests), plus Playwright walkthroughs at 1440, 1280 and 820 pixels wide.
- Generated stress parameters were checked against the real engine: all six supported families are accepted, solve optimal and verify.

## Limitations

- Synthetic books are illustrative. They establish that the pipeline works, not that the economics match any real desk.
- Quote-expiry and balance-sheet-haircut shocks are unsupported for the securities-lending family and are hidden.
- Reinvestment income, dynamic reserve buffers, richer collateral schedules, agency and prime variants, robust optimization and exact mixed-integer quadratic solving are not implemented in the pinned engine.
- Dual values and sensitivity ranges are meaningful for LP runs only; for a MIP the engine returns a reason code instead.
- The infeasibility explanation relaxes only utilization limits. It is not an irreducible infeasible subsystem (IIS): when the cause is another rule, such as hard client coverage, it says no utilization change helps rather than naming the rule.
- There is no durable run registry: results live in the browser session and in exported files. OPT's session run log lists each run's id, status, verification and timing (metadata only) until the terminal server restarts.

## Status and governance

- **Spec:** Spec013 (approved 2026-10-17). Done: decisions, engine pin (IBAL-002), contract parity, diagnostic tabs (IBAL-004), Scenario Studio (IBAL-005) and provenance and gates (IBAL-007). In progress: presenter mode and guided showcase (IBAL-006) and the as-built evidence (IBAL-008).
- **Engine pin:** InventoryBallast commit `a42dad30dc3ebb80d2790fd8701e621af0a35fcb` (InventoryBallast PR #40, solver diagnostics), package 0.1.0, checked at readiness against a source fingerprint. The pin is a commit, never a branch name.
- **Gates:** no G2D, G2E or G3 governance gate is granted; every showcase response says so.
- **Production:** disabled unless an operator sets `IBAL_PRODUCTION_ENABLED` and a trusted access boundary.

## References

- Help & FAQ: [IBAL help](/guides/IBAL/help)
- Engine documents (InventoryBallast repository): `docs/model_overview.md` (plain English), `docs/whitepaper.md` (mathematical reference)
- Specs: `docs/specs/spec013/SPEC.md`, `docs/specs/spec013/TASKS.md`
- As-built showcase note: `docs/whitepapers/ibal_showcase.md`
- Code: `src/app/inventory-optimizer/` (including `Showcase.tsx`), `src/lib/inventoryOptimizer.ts`, `src/lib/ibalScenarioSizing.ts`, `src/lib/ibalPresenter.ts`, `services/inventory_optimizer_api/`
- Related: [Optimization Center](/guides/OPT/whitepaper), [Collateral](/guides/COLL/whitepaper)
