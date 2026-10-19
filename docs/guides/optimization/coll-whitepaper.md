# Collateral Management (COLL): white paper and business guide

> **Status:** live in local development as a synthetic preview. The pinned InventoryBallast collateral optimizer solves every run and an independent verifier re-checks it. Production books and execution are disabled. Nothing here is a live recommendation, a booked movement or a settlement instruction.

## Executive summary

COLL decides **which collateral to post against which margin call** so every call is covered at the lowest cost, within every eligibility rule, issuer limit, delivery cutoff and liquidity buffer.

It answers the question a collateral desk asks every morning: *given what we hold and what we owe, what is the cheapest valid way to cover all of today's calls, and how much would that save against what is posted now?*

- **Model:** the separately packaged `collateral-optimizer` from InventoryBallast, pinned to one reviewed commit. COLL never computes collateral economics in the browser.
- **Inputs:** a native snapshot of lots, margin calls, agreements, FX and current pledges. Three sources: the model's own synthetic book (`SIM`), more realistic generated demo books, or a validated JSON upload.
- **Outputs:** a target allocation, the movements needed to reach it, per-call coverage, cost over the horizon, savings against the current posting, binding constraints, and an explicit shortfall when the calls cannot be covered.
- **Safety rule:** a result is shown as a target only if the model reports `optimal` **and** both the model's verifier and the adapter's fresh verifier pass.

## Business problem

Collateral is expensive. Every security posted against a margin call is a security that cannot be lent, repo'd or sold, and cheap, liquid assets such as cash and government bonds are exactly the ones treasury also needs as a liquidity buffer. A desk therefore balances:

- **Cost of carry:** the opportunity cost of tying up each asset, expressed in basis points a year.
- **Eligibility:** each agreement (CSA, CCP rulebook, repo agreement) lists which asset classes it accepts and at what haircut, which custodians it can receive from, and whether it accepts collateral in another currency.
- **Concentration:** most agreements cap how much of a call one issuer can cover.
- **Timing:** a call due in an hour cannot be met with an asset that takes two hours to settle.
- **Operational cost:** every movement costs something, and opening a new route can carry a fixed fee or a minimum lot size.
- **Liquidity policy:** treasury requires a minimum buffer of liquid assets to remain unencumbered.

Doing this by hand leads to *cheapest-to-deliver by habit*: a desk keeps posting what it posted yesterday. COLL quantifies how much that habit costs and what the cheapest valid alternative is.

## How it works

### Inputs: the native snapshot

| Object | What it represents | Key fields |
|---|---|---|
| **Asset lot** | A block of collateral the desk holds | class, issuer, legal entity, custodian, currency, allocatable value (native), annual carry (bp), liquidity credit (0–1), settlement minutes, minimum lot value, fixed activation fee (USD), variable move cost (bp) |
| **Margin call** | An amount owed to a counterparty | agreement, type (`IM`, `VM`, `CCP`, `REPO`), counterparty, legal entity, currency, required value (native), deadline minutes |
| **Agreement** | The legal terms for a set of calls | legal entity, effective dates, allowed custodians, cross-currency allowed, maximum issuer fraction, class haircuts, denied issuers |
| **FX quote** | Conversion to USD | currency, USD per unit (USD must equal 1) |
| **Current pledge** | What is posted today | lot, call, market value |
| **Book settings** | Policy for the run | horizon days, maximum input age, minimum liquidity reserve (USD) |

### Which lot can cover which call (eligibility)

A lot can be allocated to a call only if **all** of these hold:

1. The lot and the call belong to the same legal entity.
2. The lot's custodian is on the agreement's allowed list.
3. The currencies match, or the agreement allows cross-currency collateral.
4. The lot's asset class is in the agreement's haircut schedule, and its issuer is not denied.
5. The lot settles in time: if its settlement minutes exceed the call's deadline, an existing pledge may stay but cannot grow.

### The optimization

For every eligible lot–call route the model chooses an amount `x` in the lot's native currency. It minimizes total USD cost over the horizon:

- **Carry:** `x × FX × carry_bp ÷ 10,000 × horizon_days ÷ 365`
- **Movement:** `|x − current| × FX × move_bp ÷ 10,000`, charged on any change from today's pledge
- **Activation:** the lot's fixed fee, charged once when a route that had no pledge is opened

subject to:

| Constraint | Rule |
|---|---|
| Supply | Total allocated from a lot ≤ its allocatable value |
| Coverage | For each call: Σ `x × FX × (1 − haircut)` ≥ required value × FX |
| Issuer cap | For each call and issuer: covered value from that issuer ≤ required × maximum issuer fraction |
| Liquidity reserve | Liquidity credit consumed by the allocation ≤ initial credit − minimum reserve |
| Minimum lot | If a route is used, its amount ≥ the lot's minimum lot value |
| Cutoff | A late-settling lot cannot increase beyond its existing pledge |

**Liquidity credit** measures how liquid a lot is (cash 1.0, sovereigns 0.9, agencies 0.65, investment grade 0.15, equities and gold 0). The book's initial credit is the sum of value × FX × credit across all lots; posting liquid assets uses it up, and the reserve row stops the model from posting so much cash and government paper that the treasury buffer falls below policy.

When no lot has a minimum size or activation fee the problem is a **linear program (LP)**. Activation fees and minimum lots add on/off decisions, which makes it a **mixed-integer program (MIP)**. Both are solved with SciPy's HiGHS (20-second limit; MIP relative gap 1e-8).

### Verification: two independent checks

1. **Model verifier.** After solving, the model re-assesses the target directly from the source data: every route eligible, no lot over capacity, every call covered, no issuer over its cap, reserve respected, minimum lots respected, and the recomputed cost equal to the solver's objective within max($0.01, 1e-6 × cost). Any failure turns the result into `unverified` with no target.
2. **Adapter verifier.** QuantMeridian's service runs the model's verifier again on the returned target and reconciles objective, coverage, reserve, movements and statuses. A tampered allocation, cost component or flag cannot pass.

### Savings

The same assessment is applied to **today's posting**. If today's posting is itself valid (every call covered, every rule met), its cost becomes the **current cost** and **savings = current cost − target cost**. If today's posting breaks a rule, for example a call has grown so the old posting no longer covers it, the model reports the violations and **no saving is claimed**.

### When calls cannot be covered

If no valid allocation exists, the model returns `infeasible` and runs a separate diagnostic that measures each call's minimum **shortfall in USD**. No target, cost or saving is shown.

## Data and provenance

| Source | What it is | Header label |
|---|---|---|
| **Upstream SIM book** | The model's own deterministic synthetic book: 56 lots, 8 calls, 7 agreements, 3 entities (US, EU, UK), dated 2026-10-15. Five named scenario overlays. | `SIM` |
| **Generated demo books** | More realistic synthetic books built in the terminal (dealer and asset-manager profiles), sent through the validated-upload path. | `GENERATED DEMO BOOK · SYNTHETIC` |
| **Validated upload** | A native snapshot pasted into the editor. Strictly validated by the service. | `UPLOADED SNAPSHOT` |

Every run records: run id, correlation id, source mode, native source label, as-of time, input age, input hash, parent hash, scenario id, model commit, package version, wheel digest, adapter version, schema versions and verifier result. The **Export preview JSON** button writes all of it to a local file classified `LOCAL_MODEL_PREVIEW`.

## Assumptions

### Model assumptions (apply to every book)

| Assumption | Detail | Effect |
|---|---|---|
| Single snapshot | One point in time; no forecast of future calls or prices | Answers "what is cheapest now", not "over the next week" |
| Linear carry | Carry accrues pro rata over the horizon at a constant annual rate | Longer horizons scale carry linearly |
| Movement cost is linear | Charged per unit changed, in both directions | Discourages churn away from today's posting |
| Haircuts are fixed per agreement and class | No price-volatility or wrong-way-risk adjustment | Coverage is value × FX × (1 − haircut) |
| FX at the snapshot rate | No FX haircut is added for cross-currency collateral | Cross-currency lots count at full converted value less the class haircut |
| Fractional allocation | Lots can be split to any amount (subject to minimum lot) | Real settlement rounding is not modeled |
| No thresholds, minimum transfer amounts or independent amounts | The `Agreement` object does not carry them | Calls are covered to the exact required value |
| No re-use (rehypothecation) and no reservation across desks | Shared asset reservation is not supported | A lot may be promised elsewhere in reality |

### Upstream SIM book values

| Item | Value |
|---|---|
| As of | 2026-10-15 10:00 UTC; inputs observed 5 minutes earlier; maximum input age 60 minutes |
| Horizon | 30 days |
| Liquidity reserve | $550,000,000 |
| FX | USD 1.00, EUR 1.09, GBP 1.31 |
| Calls | US-CSA-1 IM $68m, US-CSA-2 VM $55m, US-CCP-1 CCP $72m, US-REPO-1 REPO $46m, EU-CSA-1 IM €42m, EU-CCP-1 CCP €39m, UK-CSA-1 VM £51m, UK-REPO-1 REPO £36m; all due in 180 minutes |
| Haircuts | Cash 0%, sovereign 2%, agency 5%, investment grade 8%, equity 18%, gold 15% |
| Eligibility by agreement type | CSA: all six classes. CCP: cash, sovereign, agency, IG. Repo: cash, sovereign, IG |
| Issuer cap | 70% of a call per issuer; no cross-currency; custodians: the entity's own and a tri-party agent |
| Current posting | Two expensive legacy holdings per call (IG at 128 bp carry, sovereign at 82 bp) covering 105% after haircuts |
| Free inventory | 40 lots across the six classes, $48–72m each; carry cash 39, sovereign 25, agency 42, IG 55, equity 90, gold 72 bp (+0–6 bp variation) |
| Settlement minutes | Cash 10, sovereign 30, agency 60, IG 75, equity 120, gold 150; legacy holdings 90 |
| Liquidity credit | Cash 1.0, sovereign 0.9, agency 0.65, IG 0.15, equity 0, gold 0 |
| Fees and minimums | Every 5th free lot: $750 activation fee. Every 7th: $5m minimum lot. Move cost 0.6 bp (legacy 0.4 bp) |

### Upstream named scenarios

| Scenario | Change to the base book | What it shows |
|---|---|---|
| Baseline | None | Savings from re-optimizing an expensive posting |
| Margin spike | US-CCP-1 call × 1.35 | The old posting no longer covers the call, so no saving is claimed |
| Liquidity scarcity | Reserve raised to 84% of the book's total liquidity credit | The reserve binds and preserves liquid assets |
| Cutoff and fees | Every deadline 25 minutes; every activation fee $2,400 | Slow lots drop out; fees change the mix |
| Infeasible stress | US-CCP-1 call $2.5bn; IG haircut 20% everywhere | Coverage is impossible; shortfall only |

### Generated demo books (terminal-built)

These follow spec016 COLL-013. Names are fictional and terms are illustrative with no legal authority.

| | Dealer book | Asset manager book |
|---|---|---|
| Entities and calls | US, EU, UK; 8 calls | US, EU; 5 calls |
| Deadlines | 60 min (CCP), 120 (repo), 240 (VM), 1,440 (IM) | same pattern |
| Issuer caps | CSA 60%, CCP and repo 70% | CSA 60%, CCP and repo 65% |
| Cross-currency | CSA-EU allows it; the EU entity holds cheaper US dollar sovereigns | same |
| Denied issuers | CSA-US denies `CORP-IG-04`; CSA-UK denies `CORP-IG-03` | CSA-US denies `CORP-IG-04` |
| Reserve | $550m | $400m |
| Sovereign pools | One issuer per currency, so the issuer cap binds | same |

Six sized stresses can be applied to a generated book: margin call spike, haircut shock, liquidity reserve squeeze, tighter cutoffs, settlement cost spike and issuer denial. See the [COLL help](/guides/COLL/help) for each control's range and default.

## Outputs and how to read them

| Output | How to read it |
|---|---|
| **Lifecycle** | `SUCCEEDED_VERIFIED` is the only state that shows a target. `SUCCEEDED_UNVERIFIED`, `INFEASIBLE` and `FAILED` show diagnostics only. |
| **Target cost** | USD cost of the optimized posting over the horizon: carry + movement + activation fees. |
| **Modeled savings** | Current cost − target cost, only against a valid current posting. |
| **Remaining liquidity** | Liquidity credit left after the target allocation; always at or above the reserve when verified. |
| **Coverage table** | Required and covered USD per call; shortfall per call on an infeasible run. |
| **Target allocation** | Each lot–call route with its native amount, FX, haircut and covered USD. |
| **Movements** | Previous, target and change per route. A proposal only; nothing is executed. |
| **Binding rows** | Constraints at their limit, for example `issuer:US-CSA-1:SOV-US` (an issuer cap), `supply:<lot>` (a lot fully used), `coverage:<call>`, `reserve:liquidity`. These tell you what to relax to lower cost. |
| **LP duals** | For LP runs only: the change in cost per unit of each binding row. Not shown for MIP runs, where duals are not meaningful. |
| **Baseline comparison** | Lists the input fields that differ from the baseline and flags the pair non-comparable for a causal savings claim when the snapshot or model differs. |

A useful habit: when the target cost rises under a stress, look at the binding rows. They name the rule that forced the more expensive choice.

## Validation

- **Deterministic:** the same snapshot always gives the same input hash and result.
- **Native-to-service parity:** a direct solve of the native model and a service solve of the same snapshot give the same hash, allocation, coverage, movements, cost and verifier decision.
- **Tamper tests:** an altered allocation, objective, cost component or verification flag cannot pass the adapter.
- **Invalid input tests:** missing FX, stale inputs, an ineffective agreement, a wrong entity or currency, an over-pledged lot and unknown fields are rejected with located errors.
- **Generated books:** both profiles pass the service's strict validation and solve verified; caps bind, FX is used and denied issuers are honored (29 unit tests plus real-service checks). The stress suite has 18 unit tests and a Playwright walkthrough at three screen sizes.

## Limitations

- Single-period snapshot; no intraday sequencing of deliveries, no forecasting of calls.
- No pre-trade initial margin, portfolio compression, LCR/NSFR liquidity ratios, stochastic planning, shared reservation across desks or execution. The service's capability list marks all of these as unsupported.
- No CSA thresholds, minimum transfer amounts, independent amounts, FX haircuts or wrong-way risk.
- Synthetic books only. Production books are blocked until governed sources for inventory, pledges, agreements, calls, FX, costs and custody exist.
- Savings are modeled over the horizon at constant carry. They are not realized P&L.

## Status and governance

- **Specs:** Spec016 (binding, draft), Spec015 (Optimization Center, draft). Generated books and stresses: Spec016 COLL-013 and COLL-014, owner direction of 2026-10-18.
- **Pin:** InventoryBallast commit `eb74850a0f972ca9e1f40558ecd7909d3e76e6b3`, package 0.1.0, snapshot and result schema 1.0. A daily workflow prepares a reviewable pin-update PR when upstream changes; nothing deploys from a moving branch.
- **Open gates:** owner review of the validated-upload policy, run registry and audit (Spec015), and production source ownership.
- **Next:** propose the settled generated-book profiles upstream as named books (COLL-T015).

## References

- Help & FAQ: [COLL help](/guides/COLL/help)
- Upstream model paper: `projects/collateral_optimizer/WHITEPAPER.md` in InventoryBallast
- Specs: `docs/specs/spec016/SPEC.md`, `docs/specs/spec016/TASKS.md`, `docs/specs/spec015/SPEC.md`
- Code: `src/app/collateral/page.tsx`, `src/app/collateral/GeneratedBooks.tsx`, `src/lib/collateralBooks.ts`, `src/lib/collateralStress.ts`, `services/collateral_optimizer_api/`
- Related: [Optimization Center](/guides/OPT/whitepaper), [IBAL](/guides/IBAL/whitepaper)
