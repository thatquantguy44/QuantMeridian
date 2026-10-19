# Money Market Optimizer (MMKT): white paper and business guide

> **Status:** live in local development. With the `local-mmkt-execution-v2` binding the MMKT service solves an independently verified **ticketed mixed-integer plan** (minimum tickets, integer lots, a ticket-count cap and dated cutoffs) on SIM rate sets and illustrative cash forecasts, and returns an **indicative** execution blotter. No orders are routed, and SIM output is not a live trade recommendation. A continuous LP preview remains available.

## Executive summary

MMKT answers a treasury question: **given a cash forecast for the next two weeks and a set of eligible short-term instruments, how should surplus cash be deployed, in tradable tickets, to earn the most without breaching a liquidity floor, a maturity limit, an exposure limit or a cutoff?**

- **Inputs:** a cash forecast per account (opening cash, known flows and an uncertainty band), a universe of money-market instruments (Fed reverse repo, tri-party repo, Treasury bills, commercial paper, a CD, government and prime money-market funds, a bank deposit), a rate snapshot, and a treasury policy including ticket rules and a decision time.
- **Model:** a multi-period optimization that buys instruments on each day of the horizon, carries cash forward exactly and maximizes modeled net return. In ticketed mode each purchase is a whole number of lots above a minimum ticket, the number of tickets is capped, and nothing is bought after its cutoff.
- **Outputs:** an ordered, indicative blotter with planned times and cutoffs; a cutoff timeline; cash balances against floors; a maturity ladder; return and uplift over a chosen baseline; shadow prices; a yield/liquidity frontier across floor levels; and verified plan changes under rate-cut and forecast-miss scenarios.
- **Fail-closed rules:** rates are compared on one normalized yield basis; stale or unavailable rates are never priced; SIM rates never stand in for real (Gold) rates; an infeasible or unverified solve returns no blotter.

## Business problem

A corporate or broker-dealer treasury holds operating cash across legal entities. Some of it is needed for payroll, tax, settlements and month-end; the rest can earn a return. The plan must also be **tradable**: dealers deal in round lots above a minimum size, desks limit how many tickets they write, and every instrument has a cutoff after which it cannot settle that day.

The trade-off involves many rules at once:

- **Liquidity floors:** each entity keeps minimum cash every day, more on Fridays.
- **Maturity limits:** weighted-average maturity (WAM) and life (WAL) caps keep the portfolio short.
- **Credit and concentration:** a minimum rating, a cap on Fed reverse repo, caps on one dealer, one issuer and one fund.
- **Execution:** minimum ticket, lot size, ticket count and cutoff times.
- **Uncertainty:** forecasts are wrong; the downside case matters.

Ranking instruments by headline rate fails because rates are quoted on different conventions and because an attractive instrument may break a floor in a week, a lot rule or a cutoff today. MMKT solves the whole horizon at once.

## How it works

### 1. A comparable yield for every instrument

Each rate row is converted to a simple annualized **money-market yield** (`mm_yield_pct`, ACT/365) before any comparison:

| Quoted basis | Used for | Conversion |
|---|---|---|
| Simple ACT/360 | SOFR, repo, Fed RRP, deposits, CDs | r × 365 ÷ 360 |
| Discount ACT/360 | Treasury bills, commercial paper | d ÷ (1 − d × days ÷ 360) × 365 ÷ 360 |
| Bond-equivalent, SEC 7-day | Fund yields | already annual on 365 days |

Only rows with status `ok` and a normalized yield are priced. A `stale` or `unavailable` row stays visible but never enters the model, and any candidate that depends on it is left out of the request.

### 2. Decision variables

- **Buy** amount for each account, eligible candidate and day on which it can be bought (between settlement and maturity, and before its cutoff).
- **Cash** balance for each account and day (never negative).
- In ticketed mode, for each possible purchase: a **binary** "ticket is written" variable and an **integer** lot count, with amount = lot size × lot count.

### 3. Objective

Each purchase earns a modeled net return:

`net return = mm_yield × holding days ÷ 365 − explicit cost bp ÷ 10,000`

where holding days run from the purchase date to the earlier of maturity and the horizon end. The model maximizes Σ net return × amount. Cash earns zero.

### 4. Constraints

| Row | Rule |
|---|---|
| Cash continuity | Each account's cash today = cash yesterday + known flow + forecast residual − purchases today + maturities returning today (principal × (1 + net return)). Exact equality. |
| Liquidity floor | Sum of an entity's account cash ≥ its floor for that day (daily or Friday floor) |
| Candidate maximum | Outstanding holdings of a candidate on any day ≤ its maximum amount |
| WAM / WAL proxy | Weighted-average days to maturity of holdings on each day ≤ the WAM (or WAL) limit |
| Exposure amount / fraction | Holdings matching an issuer, counterparty, fund or Fed RRP limit ≤ its dollar cap or its share of holdings |
| Rating floor | A candidate rated below a floor (for example A−) cannot be bought |
| **Ticketed:** minimum ticket | An active purchase is at least the candidate's minimum ticket |
| **Ticketed:** lots | Amount = lot size × integer lot count |
| **Ticketed:** ticket count | Number of active purchases ≤ the maximum tickets per currency |
| **Ticketed:** cutoff | A purchase whose cutoff falls before the decision time is excluded |

### 5. Uncertainty case

The selected forecast case (`p10` downside, `p50` base, `p90` upside) chooses which residual band is used, and opening cash is rebased consistently. The model plans against that single path; the quantiles are supplied inputs, not calibrated probabilities.

### 6. Solving and verification

The problem is built with the shared `optimization_core` sparse builder and solved with SciPy's HiGHS. A ticketed MIP is then **polished**: all integer decisions are fixed and an LP is re-solved. An independent verifier checks variable bounds, every row, integrality and the reconstructed objective against the original problem (tolerance 1e-7). If the solver is not optimal or the verifier rejects the answer, no allocation or blotter is returned. Each currency is solved separately; results are never summed across currencies.

### 7. Indicative blotter and cutoffs

The verified tickets are ordered by the service into an **indicative** sequence. The planned time is 09:00 in the decision timestamp's local offset, or the decision time if later. This is a planning convention, not order routing. A cutoff timeline marks each candidate as `planned` (a ticket is placed before its cutoff), `available` or `missed`.

### 8. Shadow prices

Shadow prices are the change in objective, in USD, per extra $1mm on a row's limit. In LP mode they are local LP marginals (`LP_LOCAL`). In ticketed mode MIP duals are undefined, so they come from the LP with all integer choices fixed (`FIXED_INTEGER_LP`) and apply only to that fixed plan. No sensitivity ranges are claimed.

### 9. Yield / liquidity frontier

The policy can ask for the plan to be re-solved at several multiples of the liquidity floors (default 80%, 100% and 120%). Each point is a separate verified solve with its own input hash; an infeasible point has no objective. It shows what tighter or looser liquidity costs or earns.

### 10. Baselines

A second, separately verified run with the same forecast, floors and policy but a restricted instrument set shows what optimization adds:

| Baseline | Instrument set | Notes |
|---|---|---|
| **Government MMF sweep** (default) | Government money-market fund only | The realistic "do the simple thing" alternative |
| Uninvested cash | One candidate capped at zero | Easy to beat; overstates value |
| Overnight roll | Fed RRP and repo with tenor of 4 days or less | Rolling overnight |
| Current allocation | — | Not computed: needs a current-positions feed (MM-011) |

**Uplift** = optimized return − baseline return, also shown annualized on the average total balance.

## Data and provenance

| Item | Source | Label |
|---|---|---|
| Rates | A named SIM rate set chosen explicitly. Gold (`gold.mmkt_rate_snapshot`) is selectable but fails closed until it is wired upstream (issue #149). | `SIM` or `DB` |
| Cash forecast, universe, policy | Illustrative user inputs in the page (`src/data/mmkt.ts`), editable | "illustrative" |
| Plan, blotter, balances, verification | MMKT service result | `optimal_verified`, `execution_ready` |

Every run records its run id, request hash, rate snapshot hash, rate source and SIM set, rates as-of date, forecast case, model family (`ticketed_mip` or `continuous_lp_relaxation`), solver and version, and receipt time. The blotter CSV carries the run id, hashes, source and `execution_ready` on every line.

## Assumptions

### Model assumptions (returned with every ticketed run)

1. Residual cash uses the selected forecast quantile; opening cash is rebased consistently.
2. Normalized yields are annualized and held constant; simple ACT/365 holding-period return.
3. Explicit cost is charged once at each purchase.
4. Cash earns zero and carries forward through the continuity equations.
5. WAM and WAL use days-to-maturity proxies (no reset or amortization data).
6. Rating floors use a simplified common long-term notch map; unrecognized notches are excluded when a floor applies.
7. Ticket minimums, integer lots, the ticket-count cap and dated cutoffs are enforced by the verified MIP; planned times are indicative and do not route orders.
8. Shadow prices are local marginals per extra $1mm; MIP values come from an LP with integer decisions fixed.
9. Currencies are optimized independently and never summed.
10. Currencies outside a selected objective currency are listed as excluded.
11. Only normalized rates with status `ok` are accepted.

### Illustrative book

| Item | Value |
|---|---|
| Horizon | 10 business days, 2026-10-19 to 2026-10-30 |
| Entities and accounts | QM Securities LLC (`QMS-OPER-USD`, opening $2,400mm); QM Prime Services (`QMP-SWEEP-USD`, opening $900mm) |
| Known flows, QMS ($mm/day) | +120, −60, −40, +80, −650 (Fri payroll and tax), +200, −90, +60, −30, −420 (month-end) |
| Known flows, QMP ($mm/day) | +40, −20, +10, −150, +30, +20, −10, −60, +15, −120 |
| Residual band per day | QMS −80 / 0 / +60; QMP −40 / 0 / +25 (p10 / p50 / p90) |
| Liquidity floors | QMS $400mm daily, $550mm Fridays; QMP $120mm daily, $160mm Fridays |
| Maximum WAM / WAL | 60 / 90 days |
| Exposure limits | Portfolio minimum rating A−; Fed RRP ≤ $900mm; DEALER-A ≤ 35% of holdings; ACME-FIN ≤ $250mm; PMMF-INST ≤ 25% of holdings |
| Execution mode | Ticketed MIP plan |
| Ticket rules | $25mm minimum ticket and $25mm lots on every candidate; at most 12 tickets per currency |
| Decision time | 2026-10-19 09:00 ET |
| Frontier | Floors at 80%, 100% and 120% of base |

### Instrument universe

| Candidate | Type | Rate series | Rating · party | Term | Max $mm | Cost bp | Cutoff |
|---|---|---|---|---|---|---|---|
| RRP-<day> ×9 | Fed RRP | `RRPONTSYAWARD` | AAA · FRBNY | Overnight, daily | none | 0 | 13:15 ET |
| TPR-<day> ×9 | Tri-party repo | `SOFR` | A+ · DEALER-A | Overnight, daily | none | 0.1 | 15:00 ET |
| TB-4W-1117 | T-bill | `DTB4WK` | AAA · UST | 10-20 → 11-17 | none | 0.2 | 10-20 15:00 |
| TB-3M-0121 | T-bill | `DTB3` | AAA · UST | 10-22 → 2027-01-21 | none | 0.2 | 10-22 15:00 |
| TB-6M-0422 | T-bill | `DTB6` | AAA · UST | 10-22 → 2027-04-22 | none | 0.2 | 10-22 15:00 |
| TB-52W-1014 | T-bill | `DTB1YR` | AAA · UST | 10-22 → 2027-10-14 | none | 0.2 | 10-22 15:00 |
| CP-1M-ACME | Commercial paper | `DCPF1M` | A+ · ACME-FIN | 10-19 → 11-18 | 250 | 1.0 | 10-19 15:00 |
| CP-3M-BETA | Commercial paper | `DCPN3M` | AA− · BETA-IND | 10-19 → 2027-01-19 | 200 | 1.0 | 10-19 15:00 |
| CD-3M-BANKA | Bank CD | `CD.3M` | AA− · BANK-A | 10-19 → 2027-01-19 | 300 | 0.5 | 10-19 15:00 |
| GMMF-USG | Government MMF | `MMF.GOVT.7D` | AAA | to 10-30 | none | 0 | 10-19 15:00 |
| PMMF-INST | Prime MMF | `MMF.PRIME.7D` | A | to 10-30 | 400 | 0 | 10-19 15:00 |
| DEP-BANKB | Bank deposit | `DEP.ON` | A · BANK-B | to 10-30 | none | 0 | 10-19 15:00 |

### SIM rate sets (as of 2026-10-16)

| Instrument | Base quoted | Basis | 25 bp cut set |
|---|---|---|---|
| Fed ON RRP award (`RRPONTSYAWARD`) | 3.75% | simple ACT/360 | −25 bp |
| SOFR | 3.86% | simple ACT/360 | −25 bp |
| 4-week bill (`DTB4WK`) | 3.78% | discount, 28 days | −18 bp |
| 3-month bill (`DTB3`) | 3.72% | discount, 91 days | −9 bp |
| 6-month bill (`DTB6`) | 3.62% | discount, 182 days | −5 bp |
| 1-month AA financial CP (`DCPF1M`) | 3.94% | discount, 30 days | −17 bp |
| 3-month AA nonfinancial CP (`DCPN3M`) | unavailable | — | — |
| 52-week bill (`DTB1YR`) | 3.41%, **stale 6 days** | discount, 364 days | −3 bp |
| Government MMF 7-day | 3.70% | SEC 7-day | −22 bp |
| Prime MMF 7-day | 3.88% | SEC 7-day | −22 bp |
| 3-month CD | 3.92% | simple ACT/360 | −10 bp |
| Bank deposit | 3.40% | simple ACT/360 | −25 bp |

The stale and unavailable rows are deliberate: `CP-3M-BETA` and `TB-52W-1014` are excluded rather than priced on bad data. Fund, CD and deposit rates are illustrative because no licensed source exists yet.

### Named scenarios

| Scenario | Change | Rate set |
|---|---|---|
| Base case | None | Base |
| Rate cut priced | None to the book | 25 bp cut |
| Prime fund fee and gate | Prime MMF cost +25 bp and maximum $100mm | Base |
| Cash forecast miss | Forecast case p10 | Base |
| Counterparty downgrade | DEALER-A to BBB, ACME-FIN to BBB+ (both below A−, so excluded) | Base |

### Reference run (base case, ticketed)

The base case solves in about 16 seconds locally as `ticketed_mip`, `execution_ready: true`, with integrality, bound and row violations at zero. It writes all **12 tickets**, mostly Fed RRP from the QM Securities account plus the government fund, the prime fund (at its $400mm cap), tri-party repo and the 4-week bill. Modeled net return is about **$2,629k** over the horizon. The frontier: floors at 80% of base earn about $2,756k, at 100% $2,629k, at 120% $2,498k.

## Outputs and how to read them

| Output | How to read it |
|---|---|
| **Modeled net return** | Objective over the horizon, $ thousands |
| **Annualized on invested** | Return ÷ average invested, scaled to 365 days |
| **Uplift vs baseline** | Extra return over the baseline, $k and bp annualized on the average total balance |
| **Held past horizon** | Holdings maturing after 10-30 |
| **Min floor headroom** | Smallest cash above any floor; entity-days exactly at a floor show where liquidity binds |
| **Verification** | Bounds, rows, objective reconstruction and (ticketed) integrality within tolerance |
| **Verified execution blotter** | Sequence, planned time, cutoff, candidate, account, ticket and lot. Indicative; no routing. |
| **Cutoff timeline** | Each candidate's cutoff and whether a ticket is planned before it |
| **Shadow prices** | Which limits are worth money at the margin, with their convention |
| **Yield / liquidity frontier** | What looser or tighter floors earn or cost |
| **Base → rate cut → forecast miss** | Verified changes in return, yield, headroom, average cash and the largest ticket moves |

When the ticket cap binds (all 12 used), relaxing it may raise return; when a floor is exactly met on a heavy-outflow day, liquidity is what limits the plan.

## Validation

- The service's verifier checks every solution before returning it, including integrality for ticketed plans; a failed verification returns no plan.
- Golden execution tests (`services/money_market_api/tests/test_execution.py`) cover ticket rules, lots, cutoffs, the fixed-integer polish and a hand-computable case; see `docs/whitepapers/money_market_execution.md`.
- The pricing gate is tested: a candidate on a stale rate row is rejected with `RATE_CANDIDATES_INELIGIBLE`; the Gold path fails closed the same way while upstream rates are missing.
- End to end on the base case: `SOLVE_COMPLETE`, 12 verified tickets, `execution_ready: true`.

## Limitations

- Indicative blotter only: no order routing, settlement sequencing or confirmation.
- One forecast path per run; quantiles are supplied, not calibrated; no stochastic or robust optimization.
- WAM and WAL are maturity-date proxies; fund holdings are treated as maturing on 10-30.
- Constant rates through the horizon; no forward curve.
- Ticketed solves take seconds, not milliseconds (about 16 s for the base case).
- Real Gold rates and current positions are not connected; there is no durable run history (OPT).

## Status and governance

- **Spec:** Spec011, approved 2026-10-18. Done: decisions (MM-001), input assembly (MM-004), LP/MIP solve and verification (MM-005), ticketed MIP rules (MM-006), blotter and execution views (MM-007). In progress: contract parity (MM-002), rate snapshot and Gold path (MM-003), scenarios and OPT persistence (MM-008), service hardening (MM-009), as-built evidence (MM-010). To do: current-positions baseline (MM-011).
- **Model binding:** `local-mmkt-execution-v2` locally (`npm run dev:all` sets it). The external money-market model repository is still an open Spec015 decision, so the Optimization Center shows its binding as unconfigured.
- **Production:** blocked unless `MMKT_PRODUCTION_ENABLED` and a trusted access boundary are set.

## References

- Help & FAQ: [MMKT help](/guides/MMKT/help)
- As-built execution paper: `docs/whitepapers/money_market_execution.md`
- Specs: `docs/specs/spec011/SPEC.md`, `docs/specs/spec011/HANDOFF.md`, `docs/specs/spec011/TASKS.md`
- Code: `src/app/money-market/`, `src/data/mmkt.ts`, `src/lib/server/mmktSimRateSets.ts`, `services/money_market_api/`
- Related: [MMFO](/guides/MMFO/whitepaper), [CASH](/guides/CASH/whitepaper), [Optimization Center](/guides/OPT/whitepaper)
