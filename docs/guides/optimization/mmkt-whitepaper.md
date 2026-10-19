# Money Market Optimizer (MMKT): white paper and business guide

> **Status:** live in local development. The MMKT service solves a verified **continuous linear program (LP relaxation)** on SIM rate sets and illustrative cash forecasts. Minimum tickets, lot sizes, ticket counts and cutoffs are not enforced yet, so results are **not execution-ready** and are not trade recommendations.

## Executive summary

MMKT answers a treasury question: **given a cash forecast for the next two weeks and a set of eligible short-term instruments, how should surplus cash be deployed to earn the most, without ever breaching a liquidity floor, a maturity limit or an exposure limit?**

- **Inputs:** a cash forecast per account (opening cash, known flows and an uncertainty band), a universe of money-market instruments (Fed reverse repo, tri-party repo, Treasury bills, commercial paper, CDs, government and prime money-market funds, bank deposits), a rate snapshot, and a treasury policy.
- **Model:** a multi-period LP that buys instruments on each day of the horizon, carries cash forward exactly, and maximizes modeled net return.
- **Outputs:** day-by-day purchases, cash balances against floors, a maturity ladder, the return over the horizon, and the uplift over a chosen baseline (for example "sweep everything into the government fund"), each side independently verified.
- **Fail-closed rules:** rates are compared only on one normalized yield basis; a stale or unavailable rate is never priced; SIM rates never stand in for real (Gold) rates.

## Business problem

A corporate or broker-dealer treasury holds operating cash across legal entities. Some of it is needed for payroll, tax, settlements and month-end; the rest can earn a return. Leaving surplus in a bank account earns little; locking it into a six-month bill earns more but may leave the entity short on a heavy outflow day.

The trade-off involves many rules at once:

- **Liquidity floors:** each entity must keep minimum cash every day, more on Fridays.
- **Maturity limits:** weighted-average maturity (WAM) and life (WAL) caps keep the portfolio short.
- **Credit and concentration:** a minimum rating, a cap on Fed reverse repo usage, caps on one dealer, one issuer and one fund.
- **Instrument terms:** settlement and maturity dates, capacity, explicit costs.
- **Uncertainty:** forecasts are wrong; the downside case matters.

Ranking instruments by headline rate does not work, because rates are quoted on different conventions (discount versus simple, 360 versus 365 days) and because an attractive instrument may break a floor in a week. MMKT solves the whole horizon at once.

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

- **Buy** amount for each account, each eligible candidate and each day on which it can be bought (between its settlement and maturity dates).
- **Cash** balance for each account and day (never negative).

### 3. Objective

Each purchase earns a modeled net return:

`net return = mm_yield × holding days ÷ 365 − explicit cost bp ÷ 10,000`

where holding days run from the purchase date to the earlier of maturity and the horizon end. The LP maximizes Σ net return × amount. Cash earns zero.

### 4. Constraints

| Row | Rule |
|---|---|
| Cash continuity | Each account's cash today = cash yesterday + known flow + forecast residual − purchases today + maturities returning today (principal × (1 + net return)). The first day starts from opening cash. Exact equality. |
| Liquidity floor | Sum of an entity's account cash ≥ its floor for that day (daily or Friday floor) |
| Candidate maximum | Outstanding holdings of a candidate on any day ≤ its maximum amount |
| WAM proxy | Weighted-average days to maturity of holdings on each day ≤ maximum WAM |
| WAL proxy | Same with the WAL limit (identical to WAM here because no reset or amortization data exists) |
| Exposure amount | Holdings matching an issuer, counterparty, fund or Fed RRP limit ≤ its dollar cap |
| Exposure fraction | Holdings matching a limit ≤ its share of all holdings that day |
| Rating floor | A candidate rated below a floor (for example A−) cannot be bought at all |

### 5. Uncertainty case

The selected forecast case (`p10` downside, `p50` base, `p90` upside) chooses which residual band is used, and opening cash is rebased consistently through the horizon. The LP then plans against that single path; it does not optimize across cases at once.

### 6. Solving and verification

The LP is built with the shared `optimization_core` sparse builder and solved with HiGHS. An independent verifier checks variable bounds, every row and the reconstructed objective (tolerance 1e-7). If the solver is not optimal or the verifier rejects the answer, no allocation is returned. Each currency is solved separately and results are never summed across currencies. The LP may have at most 50,000 variables.

### 7. Baselines

To show what optimization adds, MMKT solves a second, separately verified run with the same forecast, floors and policy but a restricted instrument set:

| Baseline | Instrument set | Notes |
|---|---|---|
| **Government MMF sweep** (default) | Government money-market fund only | The realistic "do the simple thing" alternative |
| Uninvested cash | One candidate capped at zero | Easy to beat; overstates value |
| Overnight roll | Fed RRP and repo with tenor of 4 days or less | Rolling overnight |
| Current allocation | — | Not computed: needs a current-positions feed |

**Uplift** = optimized return − baseline return over the horizon, also shown annualized on the average total balance (cash plus invested).

## Data and provenance

| Item | Source | Label |
|---|---|---|
| Rates | A named SIM rate set selected explicitly by the user. Gold (`gold.mmkt_rate_snapshot` in the MacroMedallion database) is selectable but fails closed until it is wired upstream (issue #149). | `SIM` (cyan) or `DB` |
| Cash forecast, instrument universe, policy | Illustrative user inputs in the page (`src/data/mmkt.ts`), editable | "illustrative" |
| Allocations, balances, verification | MMKT service result | `optimal_verified` |

Every run records its run id, request hash, rate snapshot hash, rate source and SIM set id, rates as-of date, forecast case, model family, solver and version, and receipt time. The CSV export carries the run id, snapshot hash, source and `execution_ready=false` on every line.

## Assumptions

### Model assumptions (returned with every run)

1. Residual cash uses the selected forecast quantile; opening cash is rebased consistently.
2. Normalized yields are annualized and held constant through the horizon; simple ACT/365 holding-period return.
3. Explicit cost is charged once at each purchase.
4. Cash earns zero and carries forward through the continuity equations.
5. WAM and WAL use days-to-maturity proxies (no reset or amortization data).
6. Rating floors use a simplified common long-term notch map (S&P and Moody's notations); unrecognized notches are excluded when a floor applies.
7. Minimum ticket, lot size, ticket count and cutoff constraints are **not** enforced.
8. Currencies are optimized independently and never summed.
9. Currencies outside a selected objective currency are listed as excluded.
10. Only normalized rates with status `ok` are accepted.

### Illustrative book

| Item | Value |
|---|---|
| Horizon | 10 business days, 2026-10-19 to 2026-10-30 (11 calendar days) |
| Entities and accounts | QM Securities LLC (`QMS-OPER-USD`, opening $2,400mm); QM Prime Services (`QMP-SWEEP-USD`, opening $900mm) |
| Known flows, QMS ($mm/day) | +120, −60, −40, +80, −650 (Fri payroll and tax), +200, −90, +60, −30, −420 (month-end) |
| Known flows, QMP ($mm/day) | +40, −20, +10, −150, +30, +20, −10, −60, +15, −120 |
| Residual band per day | QMS −80 / 0 / +60; QMP −40 / 0 / +25 (p10 / p50 / p90) |
| Liquidity floors | QMS $400mm daily, $550mm Fridays; QMP $120mm daily, $160mm Fridays |
| Maximum WAM / WAL | 60 / 90 days |
| Exposure limits | Portfolio minimum rating A−; Fed RRP ≤ $900mm; DEALER-A ≤ 35% of holdings; ACME-FIN ≤ $250mm; PMMF-INST ≤ 25% of holdings |

### Instrument universe

| Candidate | Type | Rate series | Rating · party | Term | Max $mm | Cost bp |
|---|---|---|---|---|---|---|
| RRP-<day> ×9 | Fed RRP | `RRPONTSYAWARD` | AAA · FRBNY | Overnight, daily | none | 0 |
| TPR-<day> ×9 | Tri-party repo | `SOFR` | A+ · DEALER-A | Overnight, daily | none | 0.1 |
| TB-4W-1117 | T-bill | `DTB4WK` | AAA · UST | 10-20 → 11-17 | none | 0.2 |
| TB-3M-0121 | T-bill | `DTB3` | AAA · UST | 10-22 → 2027-01-21 | none | 0.2 |
| TB-6M-0422 | T-bill | `DTB6` | AAA · UST | 10-22 → 2027-04-22 | none | 0.2 |
| TB-52W-1014 | T-bill | `DTB1YR` | AAA · UST | 10-22 → 2027-10-14 | none | 0.2 |
| CP-1M-ACME | Commercial paper | `DCPF1M` | A+ · ACME-FIN | 10-19 → 11-18 | 250 | 1.0 |
| CP-3M-BETA | Commercial paper | `DCPN3M` | AA− · BETA-IND | 10-19 → 2027-01-19 | 200 | 1.0 |
| CD-3M-BANKA | Bank CD | `CD.3M` | AA− · BANK-A | 10-19 → 2027-01-19 | 300 | 0.5 |
| GMMF-USG | Government MMF | `MMF.GOVT.7D` | AAA | to 10-30 | none | 0 |
| PMMF-INST | Prime MMF | `MMF.PRIME.7D` | A | to 10-30 | 400 | 0 |
| DEP-BANKB | Bank deposit | `DEP.ON` | A · BANK-B | to 10-30 | none | 0 |

All candidates carry a $5mm minimum ticket and a $1mm lot size in the data; the LP does not enforce them.

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

The stale and unavailable rows are deliberate: they show that `CP-3M-BETA` and `TB-52W-1014` are excluded rather than priced on bad data. Fund, CD and deposit rates are illustrative because no licensed source exists yet.

### Named scenarios

| Scenario | Change | Rate set |
|---|---|---|
| Base case | None | Base |
| Rate cut priced | None to the book | 25 bp cut |
| Prime fund fee and gate | Prime MMF cost +25 bp and maximum $100mm | Base |
| Cash forecast miss | Forecast case p10 | Base |
| Counterparty downgrade | DEALER-A to BBB, ACME-FIN to BBB+ (both below A−, so excluded) | Base |

## Outputs and how to read them

| Output | How to read it |
|---|---|
| **Modeled net return** | LP objective over the horizon, in $ thousands. It accrues only inside the horizon. |
| **Annualized on invested** | Return ÷ average invested balance, scaled to 365 days |
| **Uplift vs baseline** | Extra return over the selected baseline, $k and bp annualized on the average total balance |
| **Held past horizon** | Holdings that mature after 10-30 (see the maturity ladder) |
| **Min floor headroom** | Smallest cash above any floor; the count of entity-days exactly at the floor shows where liquidity binds |
| **Verification** | Bounds, rows and objective reconstruction all within tolerance |
| **Balance composition** | Holdings by family (government, secured repo, bank, credit) plus uninvested cash for each day |
| **Liquidity floors** | Each entity's cash path against its floor |
| **LP allocation** | Purchases by day, account and candidate, with yield and net return |
| **Maturity ladder** | Holdings outstanding at the horizon end by time to maturity (≤7d, 8–30d, 31–90d, 91–180d, >180d) |

A floor that is exactly met on a heavy outflow day (Friday 10-23, month-end 10-30) usually explains why the model holds cash rather than buying term paper.

## Validation

- The service's verifier checks every solution before returning it; a failed verification returns no allocation.
- The service rejects a forecast whose opening cash does not continue the prior day's path, and any request outside the v1.0.0 contract.
- The run route's tests cover the pricing gate: a candidate on a stale rate row is rejected with `RATE_CANDIDATES_INELIGIBLE`. Live, the Gold path fails closed the same way while upstream rates are missing.
- End-to-end, the base case solves `SOLVE_COMPLETE` with verification passed and `execution_ready: false`.

## Limitations

- Continuous LP only: no minimum tickets, lots, ticket counts or cutoffs (Spec011 MM-006 adds them as a MIP).
- No execution blotter, settlement sequencing or order routing.
- One forecast path per run; no stochastic or robust optimization across cases.
- WAM and WAL are maturity-date proxies; fund holdings are treated as maturing on 10-30.
- Constant rates through the horizon; no forward curve.
- Real Gold rates are not yet available.

## Status and governance

- **Spec:** Spec011, approved 2026-10-18 (MM-001). In progress: contracts (MM-002), rate snapshot (MM-003), input assembly (MM-004), LP and verification (MM-005), UI (MM-007). Next: the MIP slice (MM-006).
- **Model binding:** the service runs with the local binding `local-mmkt-lp-v1`. The external money-market model repository is still an open Spec015 decision, so the Optimization Center shows its binding as unconfigured.
- **Production:** blocked unless `MMKT_PRODUCTION_ENABLED` and a trusted access boundary are set.

## References

- Help & FAQ: [MMKT help](/guides/MMKT/help)
- Design paper: `docs/whitepapers/money_market_execution.md`
- Specs: `docs/specs/spec011/SPEC.md`, `docs/specs/spec011/HANDOFF.md`
- Code: `src/app/money-market/`, `src/data/mmkt.ts`, `src/lib/server/mmktSimRateSets.ts`, `services/money_market_api/src/money_market_api/optimizer.py`
- Related: [MMFO](/guides/MMFO/whitepaper), [CASH](/guides/CASH/whitepaper), [Optimization Center](/guides/OPT/whitepaper)
