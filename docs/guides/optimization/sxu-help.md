# Sources & Uses (SXU): help and FAQ

## Quick start

**See the optimizer work (Synthetic PoC):**

1. Open [Sources & Uses](/sources-uses). With SIM on (the default) it opens on **Synthetic PoC**.
2. Click a scenario card, for example **Margin-call surge**. Every panel re-solves instantly in the browser.
3. Drag a **Stress control** slider and watch the network, KPIs and solve sequence change.
4. Switch **Priority handling** between *Lexicographic tiers* and *Weighted penalties* to see why strict priority matters.
5. Click **Funding cascade** to see an infeasible book and its diagnostic.

**Set up your own book (Workspace):**

1. Click **Workspace**, then **New configuration** (or **Import** a JSON or CSV file).
2. Add sources and uses, then mark each pair **allowed** or **denied** in **Compatibility**.
3. Watch the **Readiness** panel until it says "Inputs ready". The workspace stores configuration only; it does not solve.

## Screen guide

### Header

| Element | Meaning |
|---|---|
| `SXU` / Sources & Uses | Module code and name; the subtitle names the mode |
| **Guide** | Opens this help and the white paper |
| **Workspace** / **Synthetic PoC** | Switch mode. Synthetic PoC is disabled while SIM is off. The URL ends `#workspace` or `#synthetic`. |
| **SIM ON / SIM OFF** switch | On: synthetic data and the PoC solver are available. Off: only your own configurations; no synthetic data or results. Remembered in this browser. |
| `SIM` / `UNAVAILABLE` badge | Data source for the current mode |
| `SETUP ONLY` | Shown in Workspace: configuration only, no solving |

### Synthetic PoC

#### SIM notice and scenario cards

The cyan `SIM` note says the book is synthetic and hand-built. Six cards: Balanced book, Repo market squeeze, Haircut shock, Margin-call surge, Unsecured rate shock, Funding cascade. Each card shows its coverage (or `INFEASIBLE`) and its story.

#### KPIs

| KPI | Meaning |
|---|---|
| Objective | Total annual cost, $mm/yr; underneath, the change from the balanced baseline |
| Funding cost | Pure funding cost, with the weighted cost in bp on total nominal |
| Penalties | All penalty components and their share of the objective |
| Coverage | Haircut-adjusted coverage ÷ demand; "every use whole" or the unmet amount |
| Idle capacity | Unused source capacity; haircut drag underneath |
| Optimality | "Certified" when all eleven checks pass; pivots and solve time underneath |

#### Transport network (`FLOW`)

Sources on the left, uses on the right. Ribbon width shows dollars; the taper shows the haircut; hatched nodes are the dummy idle sink and dummy shortfall source; a dashed line is an eligible lane carrying nothing. Colors: blue internal, orange secured repo, green unsecured and committed. Nodes can be focused with the keyboard and read out their figures.

#### Stress controls (`LIVE`)

Layered on the selected scenario; every change re-solves the full model.

| Slider | Range | Default | Effect |
|---|---|---|---|
| Internal capacity | 0–150% | 100% | Scales internal sources |
| Secured repo capacity | 0–150% | 100% | Scales secured sources |
| Unsecured & committed capacity | 0–150% | 100% | Scales CP and revolver |
| Haircut shift (secured + SBL) | +0 to +20 pp | +0 | Adds to secured and sec-lending haircuts (capped at 95%) |
| Demand scale (all uses) | 60–140% | 100% | Scales every use |
| Unsecured cost shift | −50 to +300 bp | 0 | Adds to CP and revolver cost |

A list of denied lanes appears when you deny lanes in the tableau. **Reset** returns every slider to neutral.

#### Solve sequence (`LEX`)

The tier ladder: each tier's weighted shortfall, then the final cost stage. The note explains the active priority mode. On an infeasible book it says the hard demand rows cannot all hold.

#### Funding mix (`MIX`)

Funding drawn by source family.

#### Penalty configuration (`PEN`)

| Control | Range | Default | Meaning |
|---|---|---|---|
| Priority handling | Lexicographic tiers / Weighted penalties | Lexicographic | Strict tier order, or one combined solve (comparison only) |
| Cross-entity transfer | 0–60 bp | 10 bp | Added to lanes between legal entities |
| Tenor mismatch / 30d | 0–6 bp | 1.5 bp | Per 30 days the use's tenor exceeds the source's |
| Haircut capital charge | 0–300 bp × h | 40 | Charge on the haircut portion |
| Concentration penalty | on/off | on | Extra cost above a share of a use's demand |
| Lane threshold (% of use) | 20–100% | 70% | Where the concentration charge starts |
| Penalty above threshold | 0–60 bp | 12 bp | The concentration charge |
| Idle capacity penalty | on/off | on | Price unused capacity at each source's idle rate |
| Minimum-draw penalty | on/off | on | Penalize draws below program floors |
| Source table | per source | see white paper | Tenor, idle bp (editable), minimum draw and its penalty |
| Use table | per use | see white paper | Tenor and shortfall bp (editable for soft uses; hard uses show "hard ◆") |

#### Transportation tableau (`MODI`)

Rows are sources and columns uses. Each eligible cell shows the flow ($mm) and lane cost (bp), with reduced cost for unused lanes; ineligible cells are blank and hatched. The margins show source shadow prices (`u_i`) and use marginal costs (`v_j`). **Click a cell** to open the **lane inspector**:

| Lane inspector item | Meaning |
|---|---|
| Entities, tenor | Same or cross-entity; source and use tenors |
| Flow | Nominal flow, "denied" or "—" |
| Above threshold | Flow charged the concentration penalty |
| Reduced cost | How much cheaper the lane must get to carry flow |
| Cost bars | Source cost, pair penalty, cross-entity, tenor and haircut charges, plus the concentration add-on |
| **Pair penalty (bp)** | Override this lane's penalty; "reset to …" restores the default |
| **Deny lane** / **Allow lane** | Remove or restore the lane |
| **Close** | Close the inspector |

#### Objective decomposition (`OBJ`)

The objective split into funding cost, pair penalties, cross-entity, tenor mismatch, haircut charge, concentration, idle capacity, minimum-draw breach and shortfall, each in $mm/yr.

#### Source utilisation & shadow price (`CAP`)

Each source's use of capacity, with its shadow price in bp and a flag when it is drawn below its minimum.

#### Use coverage by tier (`COV`) and Marginal cost of coverage (`vⱼ`)

Coverage per use grouped by tier (◆ marks hard uses), and the cost of one more dollar of coverage for each use.

#### Scenario comparison (`CMP`)

All six scenarios under the current penalties (without stress controls). Click a row to select it.

#### Independent verification (`CERT`)

The eleven checks, each with a tick or cross and a detail line. Infeasible books have nothing to verify.

#### Formulation disclosure (`LP`)

The exact problem size and structure (variables, rows, stages, pivots) and the formulation used.

#### Copy to workspace

Copies the current book, including stress settings and penalty overrides, into the workspace as an editable configuration named "SIM · <scenario>". Copying does not enable solving there.

### Configuration workspace

#### Toolbar

| Control | Meaning |
|---|---|
| **New configuration** | Create a blank configuration |
| **Import** | Load a JSON or CSV file; validated before it becomes active |
| **JSON** / **CSV** | Export the active configuration. JSON keeps everything; CSV has one row per source, use and rule. |

#### Active configuration bar

Choose a configuration, rename it, add a description. "Auto-saved in this browser"; the bin deletes the browser copy (after confirming). Counters show sources, uses and explicit rules.

#### Sources tab

Columns: source (name and id), category, capacity, cost (bp), haircut (%), currency, legal entity, asset class, tenor, priority tier, min / max ticket, lot, internal/external class, tags. **Add source** opens the editor; **Edit** and the bin manage rows; the filter box searches names, categories, currencies, entities, ids and tags.

#### Uses tab

Columns: use, category, requirement, bid (bp), currency, policy (hard red, soft amber), shortfall penalty, legal entity, asset class, tenor, priority, min / max, lot, tags.

#### Compatibility tab

A matrix of every source against every use. Click a cell to cycle **unspecified → allowed → denied**. Unspecified pairs are unavailable: no eligibility is ever inferred. Select a cell and type a **rule note** to record why. The tab count shows explicit rules out of all pairs.

#### Record editor

| Field | Meaning |
|---|---|
| Display name, Category / type | Required text |
| Available / Required amount | Required, ≥ 0 |
| Currency | Required ISO code |
| Source cost / Use bid (bp) | Cost of funding, or the use's bid |
| Source haircut (%) | Sources: 0–100, applied to every flow from this source |
| Use policy | Uses: hard (full cover or infeasible) or soft (shortfall permitted) |
| Internal / external | Sources: internal, external or unclassified |
| Shortfall penalty (bp) | Uses: cost of each unmet dollar |
| Legal entity, Asset class | Optional |
| Tenor (days) | Optional |
| Priority tier | Lower number = higher priority |
| Minimum / Maximum ticket, Lot size | Optional; minimum cannot exceed maximum |
| Tags | Comma-separated labels |

#### Side panels

**Readiness** (checks and the first issues to fix), **Configuration controls** (schema v1, browser-only storage, explicit compatibility, per-source haircut, solver not enabled), **Haircut convention** (eligible coverage = flow × (1 − haircut)), **Data handling** (JSON versus CSV, validation, back up before clearing browser data).

## Assumptions and defaults

| Item | Value |
|---|---|
| PoC units | USD $mm; costs in bp per year; objective in $mm per year |
| Default penalties | Cross-entity 10 bp; tenor 1.5 bp/30d; haircut charge 40 bp × h; concentration +12 bp above 70%; idle and minimum-draw penalties on |
| Priority | Lexicographic tiers 1 to 4 |
| Tier tolerance | 1e-7 absolute (plus 1e-9 relative) when fixing a tier's optimum |
| Workspace storage | This browser only (`localStorage`); schema version 1 |
| Production rules (approved) | One currency per run; currency mismatch is a hard block; cross-entity only by explicit rule; no rounding in the model |

## FAQ

### Is the Synthetic PoC a real optimizer?
Yes. It solves the full penalized transportation problem and certifies the answer; it was also re-solved independently with HiGHS. What is synthetic is the book and its penalty values, not the math.

### Why does the workspace not produce allocations?
The production solver and service (SU-004, SU-005, SU-009) are not built. The workspace is the configuration half of the final product.

### Why is the matched book shed first in the repo squeeze?
It is tier 4 with the lowest shortfall penalty (45 bp). Lexicographic priority funds tiers 1 to 3 first.

### What is the difference between lexicographic and weighted?
Lexicographic never lets a lower tier take funding from a higher one. Weighted trades shortfall against cost in one solve, so a cheap-to-shed use is dropped when funding is dearer than its penalty, even in a high tier. Lexicographic is the approved method; weighted is for comparison.

### Why is "Funding cascade" infeasible?
The revolver is withdrawn, CP rolls only 20% and CCP margin rises 2.5×. Hard uses exceed every eligible dollar by $279mm. The model reports that gap instead of inventing a plan.

### What do the shadow prices tell me?
A source's shadow price is the saving per extra dollar of its capacity; a use's marginal cost is the cost of one more dollar of coverage. They show where extra capacity or a smaller requirement would matter most.

### Why must every pair be explicitly allowed?
Eligibility is a legal and policy decision. The model never assumes a source can fund a use.

### Can a source in EUR fund a USD use?
Never. Currency mismatch is a hard block, and a run must contain one currency.

### Where are my configurations stored?
In this browser only. Export JSON to keep a copy or move it to another machine.

### Turning SIM off hid everything. Is my work gone?
No. SIM off hides synthetic content only. Your own configurations stay in the workspace.

## Troubleshooting

| Symptom | Meaning and fix |
|---|---|
| Synthetic PoC tab is greyed out | SIM is off. Turn SIM on. |
| "Saved configurations could not be read" | Browser storage was unreadable. Import a backup file. |
| "Browser storage is full" | Export the configuration and remove old ones. |
| Import error naming a field | The file failed validation, for example "Expected schema version 1.", "Rule references an unknown source." or "Minimum amount cannot exceed maximum amount." Fix the file and import again. |
| Readiness says "N to review" | The listed fields need attention; the first four are shown. |
| Optimality shows "Check failed" | A certification check failed. Read the Independent verification panel. |

## Glossary

| Term | Meaning |
|---|---|
| Source / use | A funding supply / an obligation that needs funding |
| Lane | An allowed source-to-use pair |
| Haircut | Share of nominal that does not count as coverage |
| Hard / soft use | Must be covered in full / may be partly unmet at a penalty |
| Tier | Priority level; tier 1 is funded first |
| Lexicographic | Solving tiers strictly in order, then cost |
| Dummy idle sink / shortfall source | Balancing nodes that price unused capacity and unmet demand |
| Shadow price / marginal cost | Value of one more unit of capacity / cost of one more unit of coverage |
| Reduced cost | How much a lane's cost must fall before it is used |
| Elastic diagnostic | The calculation that sizes the gap on an infeasible book |
| Internalization rate | Share of coverage delivered by internal sources |

See also the [SXU white paper](/guides/SXU/whitepaper).
