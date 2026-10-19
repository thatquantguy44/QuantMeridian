# InventoryBallast (IBAL): help and FAQ

## Quick start

1. Open [InventoryBallast](/inventory-optimizer). Wait for the engine strip to show `PIN VERIFIED`.
2. In **Dataset Intake**, keep the defaults and press **Synthetic**. The status box turns green: "Dataset loaded successfully".
3. In **Run Config**, press **Base Case Run**. The KPI strip shows `OPTIMAL` and a delta value (about $2.4K on the default book).
4. Read the **Base Case Before / After** panel and the **Base Case Results** tabs.
5. Stress it: in **Engine Scenario Studio**, pick a family, drag the sizing controls, press **Run Engine Scenario**. Or press **Run ranked stress suite** to rank every shock.
6. Compare markets: in **What If Scenarios**, tick scenarios and press **Run Scenarios**.

For a live audience, press **Present** in the header instead: it warms the engine up and walks the same steps one button at a time.

## Screen guide

### Header

| Element | Meaning |
|---|---|
| `IBAL` / InventoryBallast | Module code and name |
| `DATA AS OF …` | The dataset's as-of time (synthetic books: 2026-09-14 12:00 UTC) |
| **Guide** | Opens this help and the white paper |
| **Present** | Turns the guided demo on or off. Turning it on warms the engine up. |
| Source badge | `SIM` for a synthetic dataset, `LIVE` for an uploaded one (user-supplied, not production). It may read `ERR` when the engine is not ready, or when the terminal's global SIM switch is off (fail-closed labelling). |
| `READY` | The engine service is ready |
| `In Development` | Shown instead when the service is not ready |

### Guided demo bar (when Present is on)

| Element | Meaning |
|---|---|
| Step buttons 1–6 | Confirm the engine, Generate a book, Solve the base case, Stress one scenario, Rank every stress, Compare what-ifs. A tick means done; a spinner means running. Click any step to jump to it. |
| Narration | What to say on this step |
| **Run: <step>** | Performs the step. "Run again" once done. Disabled with a reason when a prerequisite is missing. |
| ‹ › | Previous and next step (also the Left and Right arrow keys) |
| `Warm · N ms` | The warm-up touched health, capabilities and the scenario catalog in N milliseconds |
| **Exit** | Leaves guided mode (also Esc) |

The bar moves to the first unfinished step automatically after each step completes.

### KPI strip

| Stat | Meaning |
|---|---|
| Securities | Securities in the dataset; borrowers underneath |
| Available | Shares available to lend before optimization |
| Demand | Total borrower demand, shares |
| Run Status | Base run status and solve time in milliseconds |
| Delta Value | Change in horizon value from the base run, USD |
| Avg Utilization | Simple average of each position's post-optimization utilization; binding row count underneath |

### Engine status strip

| Element | Meaning |
|---|---|
| `PIN VERIFIED` | The installed engine matches the reviewed commit and the service is ready |
| `NOT READY` / `CHECKING` | Not ready, with the reason in red; or still checking |
| Details | Engine version, pin (short commit), source fingerprint, engine source, solver and version, supported formulations (LP/MIP/QP) |
| **Recheck** | Re-reads health and capabilities. Also happens automatically when the tab regains focus and after any failed action. |

The grey line below the strip shows the latest action's message, for example "Run inv-opt-… returned optimal."

### Dataset Intake panel (`DATA`)

| Control | What it does | Range and default |
|---|---|---|
| Status box | Green: valid dataset loaded. Red: loaded with issues. Grey: none. Shows source, request hash, row counts. | |
| **Profile** | Market shape for the synthetic book. *scarce*, *concentrated* and *specials* override some sliders (marked "profile-set"). | balanced (default), scarce, concentrated, specials |
| **Scale** | Book size. *custom* reveals the shape fields. | small (default), medium, large, custom |
| **Seed** | Random seed. Same seed and settings, same book. | 1701 |
| **Borrower concentration** | How much demand is concentrated in the largest borrowers | 0–100%, default 35% |
| **Utilization cap** | Maximum share of lendable inventory that may be on loan | 25–100%, default 90% |
| Custom shape: Securities | | 1–100 |
| Custom shape: Inventory pools | | 1–20 |
| Custom shape: Borrowers | | 1–100 |
| Custom shape: Parent groups | Cannot exceed borrowers or 50 | 1–50 |
| Custom shape: Routes per security | | 1–20 |
| **Advanced** | Shows the fields below | |
| Starting utilization | Share on loan before optimization | 0–85%, default 35% |
| Fee rate mean | Average annual lending fee | 0.01–25%, default 2.50% |
| Fee rate dispersion | Spread of fees across routes | 0–10%, default 1.20% |
| Elasticity mean | How strongly demand falls as fees rise | 0–5, default 0.10 |
| Reserve fraction | Share of inventory held back as a reserve | 0–30%, default 5% |
| Ineligible fraction | Share of routes marked ineligible | 0–50%, default 3% |
| Discrete route fraction | Share of routes with all-or-none or lot rules (needs MIP; disabled with a reason if unsupported) | 0–50%, default 0% |
| **XLSX** / **JSON** | Download the upload templates | |
| **Synthetic** | Generate a synthetic book from these settings | |
| **Upload** | Upload a JSON or XLSX dataset. Type and size are checked before sending. | Formats and size limit come from the service |
| **Reset** | Clear the dataset, results, what-ifs and run history | |

Replacing a prepared dataset asks first: **Replace prepared dataset?** warns if a completed run has not been exported.

Profile overrides: *scarce* → starting utilization 62%, cap 92%, fee mean 4.5%, dispersion 2.0%. *concentrated* → concentration 80%, starting utilization 48%. *specials* → fee mean 8.5%, dispersion 4.0%, elasticity 0.25, discrete routes 10%.

Scale presets (securities / pools / borrowers / parent groups / routes per security): small 8/2/6/3/3, medium 30/4/15/5/5, large 100/8/40/10/8.

### Run Config panel (`SOLVE`)

| Control | What it does |
|---|---|
| Run readiness | `READY`, `WAIT` (data missing or invalid, or another action running) or `BLOCKED` (engine not ready), with the reason |
| **Time limit seconds** | Solver time limit, 1 to the service's maximum (60). Default 30. |
| **Minimum entity confidence** | 0–1, default 0.80. Recorded in the config hash; the pinned engine does not use it to change the allocation (see FAQ). |
| Run button | **Base Case Run** when ready. Otherwise reads Engine Not Ready, Load Data First, Fix Data Issues or Working…. |
| **Export <view>** | Downloads a zip of result tables for whichever result is on screen (base case or selected what-if) |

Settings in Dataset Intake and Run Config persist for the browser tab session.

### What If Scenarios panel (`WIF`)

Each ticked scenario re-generates a synthetic book from the current Dataset Intake settings plus the scenario's change, then solves it with the current Run Config.

| Scenario | Change | Seed |
|---|---|---|
| Base Case | none | seed |
| Scarce Supply | profile *scarce* | seed + 11 |
| Specials Squeeze | profile *specials* | seed + 23 |
| Borrower Concentration | profile *concentrated* | seed + 37 |
| Strict Entity Confidence | minimum entity confidence 0.95 | seed + 41 |
| More Balance Sheet | utilization cap 98%, reserve fraction 2% | seed + 53 |

Base Case, Scarce Supply, Specials Squeeze and Borrower Concentration are ticked by default. At least one must stay ticked.

| Control | What it does |
|---|---|
| Checkboxes | Choose scenarios |
| **Custom shock name…** + **Save as Shock** | Saves the current Dataset Intake and Run Config settings, including the seed, as a new scenario. Remove it with ×. |
| **Run Scenarios** | Solves every ticked scenario in turn |
| Header tag | `N SELECTED`, `RUNNING` |

### Engine Scenario Studio panel (`ENGINE`)

Applies a registered engine shock to the **current** dataset and its verified base run.

| Control | What it does |
|---|---|
| **Scenario family** | The shock type and its registry version. Only families valid for this dataset's problem family are listed. |
| Description | The registry's one-line description |
| Sizing form | A story line and sliders (table below). Typed values are clamped. |
| **Advanced: explicit engine parameters (JSON)** | The exact parameters the sizing produced. You can edit them; moving a slider overwrites your edits. |
| **Engine parameter schema** | The registry's JSON schema for this family |
| **Run Engine Scenario** | Runs the shock. Needs a valid dataset and a base run. |
| Header tag | `ENGINE`, `RUNNING` or `N COMPLETE` |

Sizing controls (all sized against the base run's allocation; with no base run, the current book):

| Family | Control | Range | Default | Becomes |
|---|---|---|---|---|
| Recall wave | Number of routes | 1–10 | 3 | The routes holding the most shares |
| | Share of each route recalled | 5–100% | 50% | Recall quantity, capped at the route's removable capacity |
| Specials squeeze | Number of routes | 1–10 | 3 | Largest routes |
| | Fee widening | 5–500 bp | 100 bp | Spread widening on those routes |
| Borrower limit cut | Number of limits | 1–5 | 1 | Limits in force at the as-of time |
| | Limit reduction | 5–100% | 50% | Reduction fraction |
| Borrower default | Number of borrowers | 1–5 | 1 | Borrowers with the most shares |
| | Capacity recovered | 0–100% | 0% | Recovery fraction; 0 means none |
| Supply shock | Available shares removed | 1–100% | 30% | Sale from the position with the most available shares |
| Rate shock ladder | Number of routes | 1–10 | 3 | Largest routes |
| | Largest step | 10–300 bp | 100 bp | Three steps: a quarter, a half and all of it (25, 50, 100 bp) |

Quote expiry and balance-sheet haircut are registered but unsupported for the securities-lending family, so they do not appear.

### Ranked Stress Suite panel (`SUITE`)

| Element | Meaning |
|---|---|
| **Run ranked stress suite** | Runs one default-sized shock per supported family against the base run, then ranks them |
| Worst case | The most damaging outcome in one line |
| Table: # | Rank. Infeasible or unverified outcomes come first. |
| Table: Scenario | Family and the engine's scenario name (rate ladders show one row per step) |
| Table: Δ objective | Change in objective versus the base run, USD (red negative, green positive) |
| Table: Status / Verified | Solver status and whether the engine verified it |

### Dataset Summary panel

Inventory rows, route rows, entity links and source (`SYNTHETIC` with its seed, or `UPLOAD` with the file name). The panel code is the first 10 characters of the request hash; the tag is `VALID` or `INVALID`.

### Engine Stress Results · Driver Attribution panel

| Element | Meaning |
|---|---|
| `N/M FEASIBLE` | Feasible outcomes out of scenarios run (red if any failed verification) |
| **CSV** | Exports outcomes, driver deltas and reconciliation residuals |
| Baseline line | Baseline run id, input hash, config hash |
| Generated scenario provenance | The exact scenarios the engine built |
| Outcomes table | Rank, scenario, status, verified, objective change |
| Driver table | Per scenario: dimension (security, borrower, pool, route), entity, presence, baseline and scenario shares, change |
| Reconciliation lines | Attributed versus total change per dimension, and the residual. A small residual means the drivers explain the change. |

### Base-Run Comparison panel (`BASE RUNS`)

Appears once a base case has run. Every base case run is kept for the session.

| Element | Meaning |
|---|---|
| **Baseline run** / **Comparison run** | Pick two completed runs (time and run id) |
| Identity blocks | For each run: status, source, run id and time, source label and seed or upload hash, input and config hashes, engine and backend versions, verification |
| Partial comparison warning | Some driver rows exist in only one run or IDs could not be resolved. They are kept and never counted as zero. Also warns if schemas or problem families differ. |
| Portfolio deltas | Objective, allocation, filled shares, fill rate, utilization, active routes, binding rows and warnings, comparison minus baseline. `N/A` when not computable. |
| Driver tables | Security, borrower / parent, inventory, inventory pool and route drivers, sorted by absolute share change. **Presence**: matched, new or unmatched. **Coverage**: complete, partial or unavailable. |

"A second completed base-case run is needed for comparison" means only one run exists so far.

### Scenario Comparison panel

One row per what-if scenario. Click a row to show its full results in every panel below.

| Column | Meaning |
|---|---|
| Scenario / Status | Name; `pending`, `running`, `optimal` or `failed` |
| Delta Value | That scenario's total delta, USD |
| Vs Base | Delta value minus the Base Case's |
| Fill | Filled ÷ effective demand |
| Avg Util | Average position utilization |
| Binding | Rows with zero slack |
| Net Allocation | Net shares moved across routes |
| Message | Status message or request hash |

**CSV** exports the table.

### Before / After panel

Titled with the result on screen ("Base Case Before / After" or a scenario's name). Tags: `BASE CASE` or `SCENARIO`, `VERIFIED` or `CHECK`, and warning count.

| Stat | Meaning |
|---|---|
| On Loan | Shares on loan after (before underneath) |
| Loan Delta | Change in shares on loan (net route change underneath) |
| Available | Shares available after (before underneath) |
| Utilization | Total on loan ÷ total lendable after; change underneath. Amber at 80%, red at 95%. |
| Demand Fill | Filled ÷ effective demand; unfilled underneath. Amber if more than 10% is unfilled. |
| Route Moves | Routes whose quantity changed (unchanged underneath) |
| Gross Increase / Decrease | Shares added to and removed from routes |
| Active Routes | Routes holding shares after (total routes underneath) |
| Binding Rows | Constraints with zero slack |
| Total Delta / Status | Delta value and solver status |

| Chart or table | Meaning |
|---|---|
| On-Loan Bridge | Pre on-loan, plus increases, minus decreases, equals post on-loan |
| Demand Fill donut | Filled versus unfilled shares |
| Inventory Concentration | One cell per position, sized by lendable shares, colored by change in utilization (scale ±15 points), grouped by pool |
| Top Route Movers | Route, inventory, security, borrower, before, after, change in shares and in USD, reason codes. Click a row to select it. |
| Inventory Impact | Per position: loan before and after, change in loan and in available, utilization before, after and change |
| Demand Shortfall | Per group: security, borrower, demand cap, filled, shortfall, fill, reason |
| Reason Codes | Per reason code: routes, net and gross change in shares |

### Dataset Preview panel

Tabs: **Inventory** (total, on loan, available, price, eligible), **Routes** (current, maximum, fee, eligible, lot size), **Demand** (reference quantity and fee, elasticity), **Limits** (maximum shares or notional, hard), **Policies** (minimum, maximum and target utilization), **Entities** (entity, legal entity, ultimate parent, relationship type, confidence, quality) and **Raw** (the request JSON, with **Copy**).

### Issues panel

Located issues from the latest failed action or from the dataset's own validation: severity, code, location (for example `$.body.starting_utilization`) and message.

### Results panel

Titled "<view> Results", with the run id. Tabs appear only if the pinned engine returns that section.

| Tab | Contents |
|---|---|
| **Allocations** | Route, inventory, current, post, change, fee, reason. Click a route for **Evidence**: its reason codes and evidence values. Tag: net shares moved. |
| **Balances** | Per position: pre total, pre on loan, pre available, post on loan, post available, utilization |
| **Demand** | Reference, raw (after elasticity), effective cap, filled, unfilled, fill ratio, reason. Sorted by fill, lowest first. |
| **Economics** | Total value and total delta; components (fee revenue, transition cost, expected costs, indemnification cost, owner fairness) with value, baseline and change |
| **Constraints** | Kind, scope, activity, slack (amber when zero), dual value. Sorted by slack. |
| **Diagnostics** | Run (status, native status, strict, created); Solver (backend, runtime, iterations, termination, relative gap, best bound, nodes); Verification (passed, has primal, row, bound and integrality violations, objective delta); Provenance (config hash, package version, problem family, correlation id); Warnings |
| **Raw** | The full result JSON, with **Copy** |

## Assumptions and defaults

| Item | Value |
|---|---|
| Synthetic as of | 2026-09-14 12:00 UTC |
| Horizon | 1 day, actual/360 (not editable on this page) |
| Currency | USD only |
| Solver | HiGHS; time limit 30 s in this page (service maximum 60 s); relative gap 0.0001; 1 thread; solver seed 1701 |
| Verification tolerance | 1e-6 absolute |
| Freshness | Inventory and demand no more than 24 hours older than the as-of time |
| Binding test in the page | Slack within 1e-8 |
| Minimum entity confidence | 0.80; recorded but not used by the pinned engine |
| Allocation stability penalty | 0 (no quadratic term) |

The model's full assumptions are in the [IBAL white paper](/guides/IBAL/whitepaper).

## FAQ

### Why did a stress show $0 change?
The shock did not touch anything the optimizer relies on. The sizing controls already size shocks against the base run's allocation; if you edited the JSON by hand or chose a tiny size, try a larger share or more routes.

### What is the difference between What If Scenarios and the Engine Scenario Studio?
What-ifs generate a **different synthetic book** (different profile, seed or settings) and solve it from scratch. Engine scenarios shock the **same** book and its verified base run, and attribute the change to specific securities, borrowers, pools and routes.

### Does "Strict Entity Confidence" test entity confidence?
Not on its own. The pinned engine does not read the minimum entity confidence setting, and like every preset this scenario also changes the seed (+41), so it solves a different synthetic book. Any difference you see comes from the different book, not from the confidence level.

### Why do two utilization numbers differ?
The KPI strip's **Avg Utilization** is a simple average across positions. The Before / After **Utilization** is total on loan ÷ total lendable, so large positions count more.

### What does "profile-set" next to a slider mean?
The selected profile overrides that field on the service, whatever the slider says. Switch the profile to *balanced* to control it yourself.

### Why is Discrete route fraction disabled?
The installed solver or engine does not support mixed-integer routes. The reason is shown under the slider.

### Can I trust a `feasible_limit` result?
It is feasible but not proven optimal: the solver hit its time limit. Raise **Time limit seconds** and run again.

### What do the dual values mean?
For an LP, the change in objective per extra unit of a row's limit. A large dual on a counterparty limit means extra headroom with that borrower is valuable. Duals are not meaningful for MIP runs.

### Why did my upload fail before it was sent?
Its file type or size is outside what the service accepts. The message names the accepted formats and the limit.

### Is the uploaded data production data?
No. Upload is for user-supplied test datasets. Production access is disabled, and you should not upload real client data to a local demonstration environment.

### Where do my settings go when I leave?
Dataset Intake and Run Config settings, selected scenarios and custom shocks persist for the browser tab session. Results and run history do not persist; export what you need.

## Troubleshooting

| Message | Meaning and fix |
|---|---|
| "Optimizer service is unavailable. Start services/inventory_optimizer_api and reload." | The IBAL service is not running. Start it (`npm run dev:all`). |
| "Installed engine does not match the pin (…)" | The engine's version, fingerprint or commit differs from the reviewed pin. Start IBAL against the pinned engine. |
| "No solver backend is installed in the optimizer service." | Install the service with its HiGHS extra. |
| "Engine capabilities are unavailable." | Capabilities could not be read. Press **Recheck**. |
| `REQUEST_CONTRACT_INVALID` | A request field is outside its allowed range; the Issues panel names the field. |
| `STALE_OR_FUTURE_AS_OF` | An uploaded record's as-of time is more than 24 hours before, or after, the request's. |
| `SCENARIO_RUN_REJECTED` / `SCENARIO_PARAMETERS_INVALID` | The engine refused the shock: an unsupported family or invalid parameters (often after hand-editing the JSON). |
| "Scenario parameters must be a JSON object." | The Advanced JSON is not valid. Move a slider to regenerate it. |
| "Scenario registry unavailable." | The scenario catalog could not be loaded. Check the engine is ready. |
| "The pinned engine service does not return scenario stress results." | The pinned engine lacks scenario stress. |
| "Not supported by the pinned engine (all or none routes)." / "MIP is not available with the installed solver" | Mixed-integer features are unavailable. |
| A what-if row is `failed` | Its book failed validation or the solve failed; the message column says why. |
| Settings change had no effect | The profile may be overriding that field ("profile-set"). |

## Glossary

| Term | Meaning |
|---|---|
| Route | A path from an inventory position to a borrower in one security |
| Demand group | One borrower's demand in one security |
| Effective cap | Demand after elasticity, the uncertainty haircut and any hard cap |
| Elasticity | How strongly demand falls as the fee rises above the reference fee |
| Utilization | Shares on loan ÷ lendable shares |
| Reserve | Shares deliberately held back from lending |
| Transition cost | One-time cost of increasing or decreasing a loan |
| Net fee coefficient | Value of one more share on a route over the horizon: price × horizon fraction × (fee × revenue share − variable cost) |
| Binding constraint | A rule at its limit (zero slack) |
| Dual value | Marginal value of relaxing a binding rule (LP only) |
| Reason code | Why an allocation moved or did not |
| Request hash / config hash | Fingerprints of the dataset and of the run settings |
| Pin | The exact reviewed engine commit |
| SIM / LIVE | Synthetic dataset / user-uploaded dataset (not production) |

See also the [IBAL white paper](/guides/IBAL/whitepaper).
