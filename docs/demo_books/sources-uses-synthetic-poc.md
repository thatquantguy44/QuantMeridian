# Demo book: Sources & Uses optimizer (Synthetic PoC)

- **Module:** SXU · Sources & Uses → **Synthetic PoC** tab
- **Spec:** `docs/specs/spec012/SPEC.md` § SU-SIM
- **Audience:** treasury and funding desks, risk and regulatory, quants and model validation, executives
- **Run time:** 5, 15 or 30 minutes (see [Demo runs](#demo-runs))
- **Last verified:** 2026-10-18. Every number below was produced by the model at default settings.

## What you are showing

The page solves a **penalised classic transportation problem** on a synthetic broker-dealer
funding book. Eight funding sources supply ten funding needs across four priority tiers. Every
allowed source-to-use pair has a unit cost built from configurable penalties. Two dummy nodes
balance the problem: "unmet demand" and "idle capacity". The solve runs in the browser on every
click. An independent verifier then certifies that the answer is optimal.

Say this clearly at the start, every time:

> "This is SIM data: a hand-built book in USD. It shows how the model behaves. It is not a funding
> recommendation and it uses no live or customer data."

## Before you present

1. Run `npm ci` and `npm run dev`, then open `http://localhost:5173/sources-uses#synthetic`.
   No backend, database or API key is needed, and it works offline.
2. Check that the header switch reads **SIM ON**, **Synthetic PoC** is selected, and the badge
   reads **SIM**. The page opens this way by default. If someone turned SIM off in this browser,
   click the switch to turn it back on. The terminal-wide SIM setting in the top bar does not
   affect this page.
3. Check that the **Optimality** tile reads **Certified** and the verification panel shows **12/12**.
4. Zoom the browser to about 90% on a 1440p or larger screen so the network and controls fit
   side by side.
5. Know your three reset paths:
   - Selecting a scenario card resets the stress controls.
   - **Defaults** in the penalty panel resets every penalty.
   - Reloading the page resets everything.

Nothing you do here is saved. The only exception is **Copy to workspace**, which saves into this
browser's local storage.

## The 60-second pitch

> "Every treasury has the same puzzle every morning: many funding sources, many needs, and rules
> about which source may fund which need. This is the classic transportation problem from
> operations research, with the real-world frictions a funding desk lives with: haircuts,
> intercompany transfers, tenor mismatch, concentration limits, programme floors and the cost of
> leaving money idle.
>
> The model respects priority. Regulatory and CCP obligations are protected before cheaper
> economics are considered. When the book can't be funded, it says so and names the gap instead
> of inventing a plan. Every answer comes with an optimality certificate and shadow prices that
> tell you what one more dollar of each source is worth."

## Screen map: what each panel proves

| Panel | What to point at | Capability it proves |
|---|---|---|
| Scenario cards | Six presets, coverage % in each corner | Stress scenarios run in milliseconds |
| KPI strip | Objective, funding cost, penalties, coverage, idle, **Certified** | One objective, decomposed, with a verified answer |
| Transport network | Ribbon width = $; taper = haircut; hatched nodes = dummies | The classic transportation picture, balanced |
| Stress controls | Capacity per family, haircut shift, demand, unsecured cost | Live re-solve on every change |
| Solve sequence | Tier stages, then economics | Lexicographic priority (spec SU-004) |
| Penalty configuration | Global sliders, idle and floor table, shortfall table | Every term of the cost is configurable |
| Transportation tableau | Corner = unit cost; cell = flow; uᵢ / vⱼ margins; dummy row and column | The textbook tableau with MODI-style dual potentials |
| Lane inspector (click a cell) | Cost stack, pair-penalty override, deny/allow | A transparent cost for every pairing |
| Objective decomposition | Funding vs each penalty | Where the money goes |
| Utilisation, coverage, marginal cost | BIND / FLOOR chips, uᵢ and vⱼ bars | Shadow prices as decision signals |
| Scenario comparison | Objective and coverage across presets | Side-by-side what-if |
| Independent verification | 12 checks including strong duality | Results are certified, not trusted |
| Formulation disclosure | The LP written out, with solve stats | Full transparency about the model |

## Core talking points

1. **It is the textbook model, extended for funding.** It is a balanced transportation problem.
   Dummy nodes price unmet demand and idle capacity, so supply always equals demand.
2. **The cost of every pairing is explainable.** It is the source cost plus a pair penalty,
   cross-entity transfer, tenor mismatch and a haircut capital charge. Click any tableau cell to
   see the stack.
3. **Haircuts are modelled correctly.** Nominal flow consumes source capacity. Only
   `(1 − haircut)` counts toward the need. Ribbons narrow from source to use to show this.
4. **Priority comes before price.** In lexicographic mode, a lower tier can never outbid a higher
   tier, however large its penalty. Weighted mode is available to show the difference.
5. **It refuses to fake an answer.** If hard obligations can't be met, it runs an elastic
   diagnostic and names the gap. No plan is shown.
6. **Shadow prices are decision signals.**
   - uᵢ is what one more dollar of a source saves.
   - vⱼ is what one more dollar of coverage for a use costs.
   - A negative uᵢ means spare capacity is only adding idle cost.
7. **Every answer is independently certified.** Business checks are recomputed from the
   configuration. A generic primal/dual certificate on the exact LP proves optimality, with a
   duality gap around 1e-11.
8. **It is fast and transparent.** About 600 simplex pivots in a few milliseconds. The
   formulation is shown on screen and there is no black box.

## Demo runs

### 5 minutes: flash

1. Give the pitch on **Balanced book** (see [Scenario 1](#1-balanced-book-base-case)).
2. Click **Margin-call surge** to show that priority protects Tier 1 (Scenario 4).
3. Click **Funding cascade** to show the model refusing to fake an answer (Scenario 6).
4. Return to base, click the **Cash pool → CCP IM** cell and press **Deny lane**. Watch the
   re-route and the certificate (Live moment A).

### 15 minutes: standard

1. Pitch and screen map on **Balanced book**.
2. **Repo market squeeze**, then **Haircut shock**, then **Margin-call surge**.
3. Live moment A (deny a lane) and Live moment C (tenor mismatch).
4. Live moment H: switch to **Weighted penalties** and back. This shows why lexicographic tiers
   matter.
5. **Funding cascade**, then Live moment J (drag a slider until the book is infeasible).
6. Close on the verification panel and the formulation disclosure.

### 30 minutes: deep dive (quants, validation, risk)

Run the standard flow, then:

- Every live moment, B to L.
- The tableau as a MODI table. An unused cell's number is its reduced cost: how much cheaper
  that pairing must get before it enters the solution.
- The certificate: dual feasibility, complementary slackness and strong duality. Mention the
  tamper tests in `src/data/sourcesUsesSynthetic.test.ts`.
- [Anticipated questions](#anticipated-questions) and [What not to claim](#what-not-to-claim).

## Scenario playbook

All figures use default penalties and lexicographic priority. Costs are annualised in **$mm/yr**.

### 1. Balanced book (base case)

- **Click:** the **Balanced book** card.
- **Expect:**
  - Objective **$26.01mm**: funding $22.52mm plus penalties $3.49mm (13%).
  - Coverage **100%**. Status **Certified**.
  - Idle capacity **$1,175mm**: CP $175mm and the full $1,000mm revolver.
- **Point at:**
  - Cash pool, the repo lines and the internal sources show **BINDING**. The cheap money is used
    first.
  - The hatched **Idle capacity** dummy node at the bottom right.
  - The Liq buffer (365-day need) draws CP (60-day) and cash. The tenor-mismatch penalty is
    visible in its cost stack.
- **Say:**

  > "A normal day. Cheap internal cash and collateral-matched repo do the work. The expensive
  > committed revolver stays undrawn. That idle line is the safety margin, and the model shows
  > exactly how much there is."

### 2. Repo market squeeze

- **Click:** **Repo market squeeze**. Repo capacity falls 45%.
- **Expect:**
  - Objective **$36.42mm** (+$10.4mm). Coverage **96.7%**.
  - **Matched book short $216mm**.
  - The revolver is fully drawn ($1,000mm), with $505mm of it going to the Liq buffer.
- **Point at:** the red hatched **Unmet demand** dummy node feeding only the Tier 4 matched
  book. Tiers 1 to 3 stay whole.
- **Say:**

  > "Government inventory is a hard obligation, so it pulls firm cash away from everything
  > else. The model sheds the lowest tier first and only to the extent needed."

### 3. Haircut shock

- **Click:** **Haircut shock**. Secured haircuts +8pp, sec-lending +4pp.
- **Expect:**
  - Objective **$30.15mm**. Coverage **100%**.
  - The haircut-charge line in the objective decomposition rises from $0.54mm to **$1.67mm**.
  - The revolver is drawn $108mm to refinance the drag.
- **Point at:** the repo ribbons narrow more sharply from source to use, and the haircut drag in
  the Idle capacity tile's subtitle.
- **Say:**

  > "Same capacity, less usable money. The model sees that each repo dollar now covers less,
  > charges for the locked-up collateral, and backfills with the next-cheapest line."

### 4. Margin-call surge

- **Click:** **Margin-call surge**. CCP initial margin rises 2.6×.
- **Expect:**
  - Objective **$42.96mm**. Coverage **97.1%**. **Matched book short $233mm**.
  - CCP IM receives $1,181mm from the cash pool. The revolver is fully drawn.
- **Point at:** the **Solve sequence** shows the tier stages: Tier 1 is solved and locked first.
- **Say:**

  > "The margin call is met in full even though it forces the most expensive line. Priority is
  > enforced before economics. Lower tiers absorb the displacement."

### 5. Unsecured rate shock

- **Click:** **Unsecured rate shock**. CP and revolver cost +150bp.
- **Expect:**
  - Objective **$36.13mm**. Coverage **100%**.
  - The allocation is identical to base. Funding cost is $32.64mm.
  - Cash pool's shadow price rises from **87bp to 237bp**.
- **Then:** switch **Priority handling** to **Weighted penalties**.
  - Objective **$25.07mm**. Coverage **89.8%**.
  - SN hedges are short $75mm and the matched book is short $600mm.
  - CP falls to zero and **breaches its $350mm floor**. The FLOOR chip and the min-draw line
    appear.
- **Say:**

  > "With priority locked, nothing moves. Only the price of staying whole changes, and the
  > shadow prices tell you how much internal cash is now worth. Switch to a purely
  > penalty-weighted view and the model would rather shed business and break the CP programme
  > floor. That is exactly why lexicographic tiers are the default."

### 6. Funding cascade (infeasible)

- **Click:** **Funding cascade**. The revolver is pulled, CP rolls only 20%, and IM jumps 2.5×.
- **Expect:**
  - A red banner: **"Infeasible: hard obligations exceed every eligible dollar by $279.0mm."**
  - Govt & agency inventory is named as short.
  - Exhausted sources: Cash pool, TP repo UST, TP repo MBS, CP.
  - The verification panel says there is no candidate to verify.
- **Point at:** the network shows no flows. Exhausted sources have amber outlines and the short
  use has a red outline.
- **Say:**

  > "This is the most important screen. The model doesn't relax a hard rule or invent a plan.
  > It tells you the size of the hole and which sources are already exhausted. That's the
  > conversation the treasurer needs to have."
- **Honest note:** the **total gap** of $279mm is exact. Which hard use is shown carrying it is one
  of possibly several equivalent answers.

## Live moments (interactive)

Each moment starts from **Balanced book** with default penalties unless stated. After each one,
point out that the **Certified** tile stays green.

| # | Do this | You'll see | Talking point |
|---|---|---|---|
| A | Tableau: click **Cash pool × CCP IM**, then **Deny lane** | Objective $26.01mm → **$26.47mm**. CCP IM is refinanced entirely by TP repo UST: $368mm → **$898mm**, and the freed cash flows elsewhere. CCP IM's vⱼ goes 100 → **115bp**. | Compatibility is explicit. Remove a lane and the optimum re-routes and re-prices instantly. |
| B | Tableau: click **Free credits × Prime margin**, set **Pair penalty = 60** | Objective → **$29.37mm**. Free credits re-route: Prime margin $820mm → **$390mm**, Sec borrow $0 → **$430mm**. Free credits' uᵢ falls 73 → **25bp**. | Pair penalties price one specific pairing. The model moves what it can to the source's other eligible use, and the shadow price shows the source is now worth less. |
| C | Penalty panel: **Tenor mismatch / 30d** from 1.5 → **5** | Objective → **$29.98mm**. The revolver (365d) is drawn **$325mm** into the Liq buffer. CP drops to its **$350mm floor**. Liq buffer's vⱼ goes 113 → **145bp**. | Term needs move to term funding once rollover risk is priced. |
| D | **Tenor mismatch** → **0** | Objective → **$24.24mm**. | The tenor penalty was worth $1.77mm/yr of protection. |
| E | **Cross-entity transfer** 10 → **40** | Objective → **$28.03mm**. Allocation unchanged. Every uᵢ rises by about 30bp. | When capacity binds, frictions reprice the book rather than re-route it. Shadow prices show the cost. |
| F | Untick **Concentration penalty** | Objective → **$25.80mm**. Cash pool → CCP IM grows 519 → **609**. CP → Liq buffer grows 289 → **445**. | The concentration penalty deliberately spreads funding. Here is what diversification costs: $0.21mm/yr. |
| G | Concentration **threshold 40%**, **penalty 30bp** | Objective → **$29.47mm**. The revolver is drawn ($55mm) and $250mm of bilateral repo sits idle. Concentration line: **$2.33mm**. | Tighter diversification forces new lines into play. It is convex, so it is still an LP. |
| H | **Priority handling → Weighted penalties** | Objective **$24.25mm**. Coverage **90.9%**. Matched book shed ($600mm) because its 45bp penalty is below its ~92bp marginal funding cost. | Weighted is cheaper but drops business. Lexicographic guarantees the tier order. That is a policy choice, and the model makes it visible. |
| I | Stay on Weighted. Set **Matched book shortfall bp = 200** | Coverage back to **100%**. Objective **$26.01mm**, the same as lexicographic. | Shortfall penalties are the "value of funding this need". Price it above its marginal cost and the model funds it. (In lexicographic mode, shortfall penalties only rank uses within a tier.) |
| J | Stress: **Secured repo capacity → 0%** | **Infeasible, gap $130mm** on Govt & agency inventory. At **10%** it is feasible again at 75.7% coverage. | You can find the breaking point live. |
| K | Stress: **Demand scale → 130%** | Coverage **90.6%**. Matched book short $780mm and SN hedges short $31mm. All hard uses whole. Every source binding. | Growth stress: the model tells you which business gets squeezed first. |
| L | Penalty panel: **Haircut capital charge** 40 → **200** | Objective → **$28.17mm**. Haircut line $0.54mm → **$2.70mm**. Bilateral repo's uᵢ falls 19 → 6bp. | The cost of encumbered collateral is explicit and tunable. |
| M | Stress: **Demand scale → 60%**, then toggle **Idle capacity penalty** off and on | With idle **on**, SBL cash is used **$451mm** and its uᵢ is **−10bp**. With it **off**, SBL cash use drops to $350mm. | Idle money has a cost (negative carry, reserve lock-up). The dummy sink prices it, and a negative shadow price means "this capacity is a burden". |
| N | Footer: **Copy to workspace** | Switches to the Workspace tab with a "SIM · …" configuration, tagged SIM. | Bridge to the configurable workspace. Solving there is still gated by spec. |

## Tailor it to the audience

- **Treasury and funding desk:** Scenarios 2, 4 and 6, then moments A, C and J. Emphasise
  priority, BINDING sources, idle headroom and the infeasibility message.
- **Risk and regulatory:** Scenarios 4 and 6, then moments H and J. Emphasise hard obligations,
  lexicographic tiers, the elastic diagnostic and that results are never relaxed silently.
- **Quants and model validation:** the tableau (reduced costs, uᵢ/vⱼ), the certificate, the
  formulation panel, moments B, F, G and M, and the test suite.
- **Executives:** the pitch, then Scenarios 1 → 4 → 6, then the scenario comparison table. Keep
  it under 7 minutes.

## Anticipated questions

**Is this real data?**
No. It is a handwritten synthetic book, identical on every load, with no randomness. Say "SIM"
early and often.

**Is this the production optimizer?**
No. It is a bounded proof of concept approved in spec012 (SU-SIM). The production service,
contract and run history are still gated on open decisions.

**How is currency handled? What if a portfolio holds several currencies?**
Today it isn't normalised: the showcase is deliberately single-currency (USD). Whether one solve
may mix currencies is **open decision 4** in spec012, so the model doesn't assume an answer. The
workspace stores a currency on each record but does not convert. See
[Multi-currency: options for the open decision](#multi-currency-options-for-the-open-decision).

**Why an LP and not a MIP?**
Every penalty here is linear or convex, so an LP solves it exactly and gives true shadow prices.
Discrete rules (minimum tickets, all-or-none, lot sizes) are spec item SU-005 and are not in this
showcase.

**What is a negative shadow price?**
Spare capacity that only adds idle cost. Using one more dollar of it would *save* money.

**Why does one of the cascade's hard uses carry the whole gap?**
The total gap is unique. How it splits across hard uses can have several equally valid answers.
The banner also names the exhausted sources, which is the actionable part.

**How fast is it? Will it scale?**
The showcase solves 86 variables and 58 rows in about 600 pivots in a few milliseconds, in the
browser. The production design uses the shared `services/optimization_core` (SciPy HiGHS) for
larger books.

**Are the penalty values calibrated?**
No. They are illustrative SIM economics. The point is the mechanism, and every value is
configurable.

## What not to claim

- That it uses live, customer or production data.
- That outputs are funding recommendations or execution-ready.
- That it handles multiple currencies, FX or cross-currency funding.
- That discrete (MIP) rules, minimum tickets or lot sizes are applied.
- That the penalty values are calibrated.
- That the Money Market Fund Optimizer (MMFO) runs a verified or production model. Its local
  PoC is SIM-only and unverified (see the note below).

## Multi-currency: options for the open decision

There is no FX normalisation anywhere in the Sources & Uses code today. Two related modules
behave as follows:

- **SXU (this module):** single currency. Records carry a `currency` field, but no conversion,
  FX rate or cross-currency lane exists.
- **MMKT LP service (`services/money_market_api`):** optimises **each currency independently**
  (`solve_currency` runs one LP per currency) and never nets across currencies.

When the owner resolves open decision 4, the usual designs are:

1. **One currency per run (simplest, safest).** Reject mixed configurations and solve each
   currency separately, as MMKT does. No FX assumptions are needed, but surplus in one currency
   can't fund a deficit in another.
2. **Base-currency normalisation.** Convert every amount to a reporting currency with a dated FX
   snapshot carrying provenance and a hash in the run envelope. This is good for reporting
   totals. On its own it is **wrong for funding**, because it treats EUR and USD cash as
   interchangeable.
3. **FX conversion lanes (recommended if mixing is allowed).** Keep amounts in native currency.
   Add explicit FX lanes from a source in currency A to uses in currency B. Each lane converts at
   the snapshot rate and carries:
   - an FX haircut (the same mechanics as the source haircut);
   - an FX transaction or basis cost (another lane penalty);
   - optionally, a cap on the FX swap line.

   Same-currency lanes stay at rate 1. This keeps the transportation structure, prices
   cross-currency funding honestly and fits the existing penalty framework. The FX rate and its
   provenance would become part of the canonical run hash (SU-009).

Whichever option is chosen, rounding and the internalisation definition (open decisions 2 and 3)
should be settled at the same time, because both interact with converted amounts.

## Note on the money-market modules (MMFO and MMKT)

These are separate modules from SXU. Neither is part of this demo.

- **Money Market Fund Optimizer (MMFO, spec015):**
  - Has a local proof-of-concept model (`src/lib/mmfo/pocModel.ts`, merged in PRs #163–#165).
  - It is a small vertex-enumeration LP over a fixed, fictional eight-share-class dataset, which
    runs only when **Synthetic Demo Mode** is switched on.
  - Outputs are labelled SIM and **not independently verified**.
  - The external model binding (`MM_FUND_OPTIMIZER_API_URL`) is still gated by spec015 (task
    OC-T013).
  - You can demo it as a SIM proof of concept, not as a verified or production model.
- **Money Market Optimizer (MMKT, spec011, `/money-market`):**
  - Drives the separate `services/money_market_api` service: a HiGHS LP with an independent
    verifier.
  - Runs only when an operator starts the service with
    `MONEY_MARKET_MODEL_BINDING=local-mmkt-lp-v1` and the terminal holds the matching token.
  - Spec015 says it is **not** the MMFO binding.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The Synthetic PoC tab is missing | Check that `settings/modules.config.json` has `"SXU"` enabled, and use `/sources-uses#synthetic`. |
| Numbers differ from this guide | Press **Defaults** in the penalty panel, reselect the scenario card, and check that priority is **Lexicographic**. |
| The Optimality tile reads "Check failed" | This shouldn't happen. Note the slider settings and the failed check, then raise it; the stress-grid test is meant to prevent it. |
| The layout is cramped | Zoom to 80–90%, or collapse the terminal sidebar. |
