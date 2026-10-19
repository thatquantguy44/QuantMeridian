# Collateral Management (COLL): help and FAQ

## Quick start

1. Open [Collateral Management](/collateral). When the service is ready, the upstream **Baseline** solves automatically.
2. Read the **Model result** panel: lifecycle `SUCCEEDED_VERIFIED`, a target cost and a modeled saving.
3. Try the other upstream scenarios (**Margin spike**, **Liquidity scarcity**, **Cutoff + fees**, **Infeasible stress**).
4. For a more realistic book, use **Generated demo books**: pick **Dealer book**, press **Solve generated book**, then size a stress and press **Solve this stress**.
5. Press **Run ranked stress suite** to rank all six stresses by how much they raise cost.

## Screen guide

### Header and notice

| Element | Meaning |
|---|---|
| `COLL` / Collateral Management | Module code and name. |
| **Guide** | Opens this help and the white paper. |
| `SIM` badge + `SIM / NO LIVE RECOMMENDATION` | The current result is from the upstream synthetic book. |
| `GENERATED DEMO BOOK · SYNTHETIC` | The current result is from a terminal-generated book, sent through the upload path. Never labeled SIM. |
| `UPLOADED SNAPSHOT` | The current result is from a snapshot pasted into the editor. |
| `NO LIVE RECOMMENDATION` | Always true: results are local previews. |
| Amber notice | "This is a deterministic synthetic book solved by the pinned model…" A standing reminder that no result is governed inventory, a recommendation, a booked movement or an audited run. |

### Binding and scenario panel (`BIND`)

| Element | What it does |
|---|---|
| **Service** line | Collateral service readiness (`READY`, `UNCONFIGURED`, `INCOMPATIBLE`, `UNAVAILABLE`) and the service's detail message. |
| **Model state** | The model's declared state; `SIM_ONLY` today. |
| **Baseline** | Solve the upstream book as is. Its result becomes the comparison baseline. |
| **Margin spike** | US-CCP-1 call rises 35%. |
| **Liquidity scarcity** | Reserve raised to 84% of the book's liquidity credit. |
| **Cutoff + fees** | Every call due in 25 minutes; activation fees $2,400. |
| **Infeasible stress** | US-CCP-1 call $2.5bn and IG haircuts 20%; no valid answer exists. |
| Highlighted button | The scenario currently shown. |
| **Copy current native snapshot into editor** | Puts the current run's full native snapshot in the editor so you can edit it. |
| **Validated JSON upload or edited native snapshot** | Text area for a native `1.0` snapshot (JSON). Maximum 2 MB. |
| **Validate and solve upload** | Validates the snapshot strictly, then solves it as `USER_UPLOAD`. Errors list the exact field location. |

### Generated demo books panel (`BOOKS`)

| Element | What it does |
|---|---|
| `GENERATED · SYNTHETIC · NOT SIM` tag | Reminder of the source label these books carry. |
| **Book: Dealer book** | 3 entities, 8 calls from intraday CCP to next-day bilateral, binding issuer caps, a denied issuer and a cross-currency CSA. |
| **Book: Asset manager book** | 2 entities, 5 calls, more equity, IG and gold, less cash. |
| **Solve generated book** | Solves the selected book. Its result becomes the comparison baseline. |
| **Stress** selector | Which stress to apply (table below). Changing it resets the sizing to that stress's default for the selected book. |
| Story line | One sentence describing the stress. |
| Sliders and number boxes | Size the stress. Typed values are clamped to the allowed range. |
| **Changes input: …** | Which top-level input the stress changes (`calls`, `agreements`, `assets` or `minimum_liquidity_reserve_usd`) and the scenario id, which encodes the sizing. |
| **Solve this stress** | Solves the stressed snapshot and compares it with the generated baseline. |
| **Run ranked stress suite** | Solves the baseline and one default-sized scenario per stress, then ranks them. Shows progress while running. |
| Suite table: **#** | Rank. Infeasible or unverified outcomes rank first. |
| Suite table: **Stress** | Stress name. A red note "`INFEASIBLE` · no target" appears when no valid answer exists. |
| Suite table: **Δ target cost** | Verified target cost minus the baseline's, USD. Red means cost rose. `n/a` when there is no verified target. |
| Suite table: **Savings** | Saving against the stressed book's current posting, or `n/a` when that posting is invalid. |

### Stress controls

| Stress | Control | Range | Default | What it changes |
|---|---|---|---|---|
| Margin call spike | Calls affected | 1–8 | 1 | The largest calls by USD value |
| | Call increase | 5–150% (step 5) | 35% | Required value × (1 + increase) |
| Haircut shock | Haircut increase | 1–15 pp | 5 pp | Adds to every non-cash haircut in every agreement, capped at 95% |
| Liquidity reserve squeeze | Reserve as share of today's | 100–500% (step 25) | Dealer 400%, asset manager 250% | Multiplies the minimum liquidity reserve |
| Tighter cutoffs | Time allowed | 10–100% of today's (step 5) | Dealer 30%, asset manager 20% | Multiplies every deadline, rounded, never below 5 minutes |
| Settlement cost spike | Cost multiple | 1–20× | 10× | Multiplies move cost (bp) and activation fees on every lot |
| Issuer denied | Issuers denied | 1–3 | 1 | Adds the largest free-inventory issuers (by USD value) to every agreement's denied list |

The reserve and cutoff defaults differ by book because each book has a different cliff. The dealer book absorbs 400% reserve but goes infeasible at 450%. The asset-manager book absorbs 250% but goes infeasible at 300%.

### Model result panel (`RESULT`)

| Element | Meaning |
|---|---|
| Lifecycle tag | `SUCCEEDED_VERIFIED` (green), or `SUCCEEDED_UNVERIFIED`, `INFEASIBLE`, `FAILED` (red). |
| **Target cost** | Verified cost of the target posting over the horizon, USD. `Unavailable` when not verified. |
| **Modeled savings** | Current cost − target cost. "vs verified incumbent · USD" when valid; "Incumbent invalid or no verified target" otherwise. |
| **Remaining liquidity** | Liquidity credit left after the target, USD ("supplied local policy"). |
| **Input** | Source mode and native source label (`SIM`, or `USER_UPLOAD / native GENERATED-DEMO:dealer`) and as-of time. |
| **Input age** | Age of the oldest lot observation at the snapshot's as-of time, in minutes (5 for the synthetic books). It is not wall-clock age. |
| **Model / Adapter** | Package version and commit; adapter version; schema versions; formulation (`LP` or `MIP`). |
| **Input hash / Parent hash** | Canonical hash of the snapshot; parent hash for an upstream scenario overlay. |
| **Scenario** | Scenario id (`margin_spike`, `qm-call_spike-breadth1-increasePct35`, …) or "Uploaded snapshot". |
| **Verifier** | "fresh assessment passed" or "no approved target". |
| **Export preview JSON** | Downloads the run with full provenance, classified `LOCAL_MODEL_PREVIEW`. |

### Baseline comparison panel (`COMPARE`)

Appears when the shown run is not the baseline. It says whether the pair is comparable (same snapshot and model) or **NON-COMPARABLE for a causal savings claim**, lists the changed fields, and shows both input hashes.

### Cost panel (`COST`)

Carry, movement, activation fees and current cost, USD over the horizon. Shown only for verified runs.

### Calls and haircut-adjusted coverage (`CALLS`)

| Column | Meaning |
|---|---|
| Call / agreement | Call id with its agreement underneath |
| Type | `IM`, `VM`, `CCP` or `REPO` |
| Required USD | Call amount converted to USD |
| Covered USD | Haircut-adjusted coverage in the target |
| Shortfall USD | On an infeasible run, the minimum uncovered amount for that call |

### Lots · native market values (`LOTS`)

| Column | Meaning |
|---|---|
| Lot | Lot id (`GEN-HELD-…` are the legacy holdings in a generated book) |
| Class / Currency | Asset class and native currency |
| Available | Allocatable value, native currency |
| Current | Total currently pledged from this lot |
| Target | Total allocated in the verified target (`—` if not verified) |

### Target allocation routes (`ALLOC`)

Each lot–call route in the verified target: native market value, FX (USD per unit), haircut and covered USD. A route whose lot currency differs from the call currency is cross-currency.

### Movements · no execution (`MOVE`)

Previous, target and delta per route, in the lot's currency. A proposal only; nothing is sent anywhere.

### Constraints and diagnostics (`ROWS`)

| Item | Meaning |
|---|---|
| Minimum supplied liquidity reserve / remaining | The reserve policy and what is left after the target |
| Binding rows | Constraints at their limit: `coverage:<call>`, `supply:<lot>`, `issuer:<call>:<issuer>`, `reserve:liquidity` |
| Incumbent violations | Why today's posting is invalid, for example `undercovered:US-CCP-1` |
| Solver | HiGHS status and message |
| Model LP duals | LP runs only: cost change per unit of each row |
| "LP duals unavailable for MIP" | Shown for MIP runs |

## Assumptions and defaults

| Item | Value |
|---|---|
| Horizon | 30 days |
| Maximum input age | 60 minutes before the as-of time |
| Cost currency | USD; snapshot amounts are native currency |
| Solver | SciPy HiGHS, 20-second limit, MIP gap 1e-8 |
| Verifier tolerance | Cost within max($0.01, 1e-6 × cost); coverage within max(1e-5, 1e-8 × required) |
| Request limit | 2 MB |
| Upstream book | 56 lots, 8 calls, reserve $550m, issuer cap 70%, all deadlines 180 minutes |
| Generated books | Dealer: 8 calls, caps 60/70%, reserve $550m. Asset manager: 5 calls, caps 60/65%, reserve $400m |
| Haircuts (both) | Cash 0%, sovereign 2%, agency 5%, IG 8%, equity 18%, gold 15% |
| Settlement minutes | Cash 10, sovereign 30, agency 60, IG 75, equity 120, gold 150 |
| Liquidity credit | Cash 1.0, sovereign 0.9, agency 0.65, IG 0.15, equity and gold 0 |

The full list of model assumptions is in the [white paper](/guides/COLL/whitepaper).

## FAQ

### Why is "Modeled savings" unavailable?
Savings are measured against today's posting only when that posting is valid. After a margin spike, haircut shock or reserve squeeze, the old posting may no longer cover a call or may breach the reserve, so there is nothing valid to compare against. The **Incumbent violations** line says why.

### Why does a stress make cost go up but show no saving?
Both can be true: the new target costs more than the baseline target, and the stressed book's own current posting is invalid. The **Δ target cost** column compares targets; **Savings** compares against today's posting.

### What does "NON-COMPARABLE for a causal savings claim" mean?
The two runs used different snapshots or model versions, so the cost difference is not attributable to one cause. Every stress is non-comparable to its baseline by design; the changed-fields list tells you what differs.

### Why is the result `INFEASIBLE`?
No allocation covers every call within the rules. The **Shortfall USD** column shows the minimum gap per call. Typical causes: a call larger than eligible capacity, a deadline shorter than every eligible lot's settlement time, or a reserve that leaves too little liquid collateral.

### Why does a lot I expected never get used?
Check eligibility: entity, custodian, currency (unless the agreement allows cross-currency), class in the haircut schedule, issuer not denied, and settlement minutes within the deadline. Then check the issuer cap: a cheap issuer may already be at its limit (see binding `issuer:` rows).

### Why are LP duals sometimes missing?
They exist only for LP runs. A book with activation fees or minimum lots is a MIP, where duals are not meaningful.

### Is the generated dealer book real?
No. It is synthetic, with fictional counterparties and issuers and illustrative terms with no legal authority. It is built to exercise rules the upstream book never triggers: binding issuer caps, mixed deadlines, cross-currency collateral and denied issuers.

### Why are the generated books not labeled SIM?
SIM is reserved for the model's own named scenarios. Generated books go through the validated-upload path, so they are labeled as generated and synthetic (spec016 COLL-013).

### Can I paste my own book?
Yes, as a native snapshot in the editor. It must pass strict validation (every field known, USD rate 1, agreements effective at the as-of time, observations no older than the maximum input age, no lot over-pledged). Do not paste real client data: this is a local demonstration environment.

### Does anything get sent to a counterparty or custodian?
No. Movements are proposals. Execution is disabled.

## Troubleshooting

| Message or symptom | Meaning and fix |
|---|---|
| Service `UNAVAILABLE` | The collateral service is not running. Start it (`npm run dev:all`). |
| `BINDING_UNCONFIGURED` | The service has no binding attestation. Start it with `COLLATERAL_BINDING_ATTESTATION`. |
| `BINDING_INCOMPATIBLE` / `INCOMPATIBLE` | The installed wheel, lock, commit or schema differs from `binding-manifest.json`. Rebuild the wheel from the pinned commit. |
| `AUTH_REQUIRED` / `AUTH_UNCONFIGURED` | Token mismatch or missing. Set `COLLATERAL_OPTIMIZER_API_TOKEN` identically for the terminal and the service, then restart both. |
| `SNAPSHOT_INVALID` / `REQUEST_INVALID` | The snapshot failed validation. The message lists each failing field location. |
| `INVALID_PLEDGE_ROUTE` | A current pledge breaks an agreement rule: wrong legal entity, wrong custodian, cross-currency not allowed, or an ineligible class or denied issuer. Fix the pledge or the agreement. |
| `REQUEST_TOO_LARGE` | The snapshot is over 2 MB. |
| `PRODUCTION_DISABLED` / `PRODUCTION_BOOK_DISABLED` | Production access and production books are blocked by design. |
| `SOLVER_FAILED` / `FAILED` | The solver stopped without an answer (for example the time limit). Try a smaller book. |
| `RESPONSE_INVALID` / `RESPONSE_INCOMPATIBLE` | The service's answer failed the terminal's contract check. Treat the run as untrusted. |
| "Terminal result contract failed." | Same as above, detected in the browser. |
| Suite shows a red error line | That stress's snapshot was rejected or the service failed. Other rows still ran. |

## Glossary

| Term | Meaning |
|---|---|
| Agreement | Legal terms (CSA, CCP rulebook, repo agreement) setting eligible classes, haircuts, custodians, issuer caps and currency rules |
| Allocatable value | How much of a lot may be used, in its native currency |
| Binding row | A constraint at its limit in the target |
| Carry | Annual opportunity cost of posting an asset, in basis points |
| CCP | Central counterparty (clearing house) |
| CSA | Credit Support Annex: the collateral terms of a bilateral derivatives agreement |
| Cross-currency | Posting a lot in a currency different from the call's |
| Haircut | Discount applied to a lot's value when counting coverage |
| IM / VM | Initial margin / variation margin |
| Incumbent | Today's posting |
| Issuer cap | Maximum share of a call one issuer may cover |
| Liquidity credit | How liquid a lot is, 0 to 1; used for the reserve rule |
| LP / MIP | Linear program / mixed-integer program |
| Shortfall | The uncovered amount of a call on an infeasible run |
| Tri-party | A custodian agent that holds collateral for both sides |

See also the [COLL white paper](/guides/COLL/whitepaper).
