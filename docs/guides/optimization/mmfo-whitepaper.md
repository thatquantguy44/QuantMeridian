# Money Market Fund Optimizer (MMFO): white paper and business guide

> **Status:** proof of concept on synthetic inputs. A small local LP allocates cash across eight fictional money-market fund share classes. It has **no independent verifier**, its fund data is illustrative, and its output is not an offer, forecast or investment recommendation. The approved production fund model will live in a separate repository (Spec015).

## Executive summary

MMFO answers a narrow, common question: **how should a block of operating cash be split across money-market funds to earn the most net yield while keeping enough same-day liquidity, limiting prime-fund exposure and not over-concentrating in one fund?**

- **Inputs:** total cash, a cash reserve to keep uninvested, a minimum share in same-day-liquidity funds, a maximum share in prime funds, and a maximum share per fund.
- **Universe:** eight fictional institutional share classes (five government, three prime) with gross and net 7-day yields, expense ratios, AUM, WAM/WAL, liquid-asset ratios and asset mix.
- **Model:** a linear program that maximizes weighted net yield, solved exactly by enumerating the corners of the feasible region.
- **Outputs:** the allocation by fund, weighted net yield, annualized income, same-day liquidity and prime exposure, with constraint checks.

It is deliberately separate from the Cash Optimizer (treasury funding) and from the Money Market Optimizer (multi-period instrument deployment).

## Business problem

Corporate treasurers and broker-dealer sweep desks keep large balances in money-market funds. The fund choice involves a few hard trade-offs:

- **Yield versus safety:** prime funds pay more but carry credit risk and can impose liquidity fees or gates under stress; government funds pay less but are the conservative default.
- **Liquidity timing:** same-day funds release cash the same day; next-day funds release it a day later.
- **Concentration:** treasury policy usually caps the share in any one fund.
- **Net, not gross:** expense ratios differ, so the comparison must be on net yield.

Picking the top-yielding fund ignores these rules; MMFO solves for the best split that satisfies all of them.

## How it works

### Variables and objective

`x_f` = dollars allocated to fund `f`. The model maximizes weighted net yield:

`maximize Σ x_f × net 7-day yield_f ÷ investable`

where **investable = total cash × (1 − cash reserve %)**.

### Constraints

| Constraint | Rule |
|---|---|
| Full investment | Σ x_f = investable |
| Per-fund cap | x_f ≤ investable × maximum per fund % |
| Non-negative | x_f ≥ 0 |
| Prime cap | Σ x over prime funds ≤ investable × maximum prime % |
| Same-day minimum | Σ x over same-day funds ≥ investable × minimum same-day % |

### Solving

With eight funds the LP is tiny, so the POC finds the exact optimum by **vertex enumeration**: it solves every combination of seven binding constraints with the full-investment row, keeps the feasible corners and picks the highest yield. This is exact for this size but does not scale; the production model will use a proper solver.

### Checks

After solving, the POC checks full investment, the same-day minimum, the prime cap and the per-fund cap (tolerance $0.01). These are self-checks inside the same code, **not** an independent verifier, which is why results are tagged `NOT INDEPENDENTLY VERIFIED`.

### Income

Annualized income = weighted net yield × investable, a simple run-rate: the current 7-day yield held for a year with no compounding.

## Data and provenance

| Item | Source | Label |
|---|---|---|
| Fund universe | Fixed fictional snapshot `mmfo-demo-us-institutional-2026-10-16` in `src/lib/mmfo/pocModel.ts` | `SIM` |
| Constraints | User inputs on the page | |
| Allocation | The local POC LP in the terminal's own API (`/api/mm-fund-optimizer/optimize`) | `POC_OPTIMAL` |
| External model service | Optional `MM_FUND_OPTIMIZER_API_URL`; health is probed but no run is sent to it | `SERVICE …`, `BINDING UNCONFIGURED` |

Synthetic Demo Mode is **off by default**. Nothing is computed until a user turns it on.

## Assumptions

### Fund universe (snapshot 2026-10-16, fictional)

| Id | Fund | Type | Liquidity | Gross 7D | Expense | Net 7D | AUM $bn | WAM / WAL | DLA / WLA | UST / Repo / Agency / Other |
|---|---|---|---|---|---|---|---|---|---|---|
| GOV-TRE-01 | Treasury Select Institutional | Gov | Same day | 4.72% | 0.08% | 4.64% | 38.4 | 24 / 41 | 63 / 82 | 94 / 6 / 0 / 0 |
| GOV-INS-02 | Government Liquidity Institutional | Gov | Same day | 4.79% | 0.13% | 4.66% | 52.7 | 31 / 57 | 58 / 76 | 71 / 25 / 4 / 0 |
| GOV-SD-03 | Government Short Duration Institutional | Gov | Next day | 4.77% | 0.10% | 4.67% | 21.6 | 39 / 72 | 45 / 68 | 64 / 28 / 8 / 0 |
| GOV-TRE-04 | Treasury Liquidity Portfolio Institutional | Gov | Next day | 4.73% | 0.07% | 4.66% | 16.9 | 28 / 49 | 52 / 78 | 89 / 11 / 0 / 0 |
| PRM-INS-01 | Prime Institutional Cash Class A | Prime | Same day | 5.08% | 0.18% | 4.90% | 34.2 | 36 / 79 | 52 / 71 | 3 / 31 / 10 / 56 |
| PRM-DLY-02 | Prime Daily Liquidity Institutional | Prime | Same day | 5.13% | 0.20% | 4.93% | 27.8 | 32 / 66 | 57 / 74 | 5 / 45 / 8 / 42 |
| PRM-CASH-03 | Prime Cash Portfolio Institutional | Prime | Next day | 5.18% | 0.22% | 4.96% | 18.3 | 43 / 91 | 39 / 63 | 0 / 36 / 12 / 52 |
| GOV-SWEEP-04 | Treasury Government Sweep Institutional | Gov | Same day | 4.74% | 0.08% | 4.66% | 9.8 | 19 / 33 | 71 / 88 | 96 / 4 / 0 / 0 |

Only **net 7-day yield, fund type and liquidity bucket** enter the LP. AUM, WAM/WAL, daily and weekly liquid assets (DLA/WLA) and asset mix are descriptive.

### Default constraints

| Input | Default |
|---|---|
| Total cash | $10,000,000 |
| Cash reserve | 10% |
| Minimum same-day liquidity | 30% |
| Maximum prime exposure | 40% |
| Maximum per fund | 25% |

### Reference result (defaults)

Investable $9,000,000, reserve $1,000,000. Allocation: PRM-CASH-03 $2.25mm, PRM-DLY-02 $1.35mm (prime at its 40% cap), GOV-SD-03 $2.25mm, GOV-INS-02 $2.25mm, GOV-SWEEP-04 $0.90mm. **Weighted net yield 4.778%**, annualized income **$430,020**, same-day liquidity 50%, prime exposure 40%.

Several government funds share a 4.66% net yield, so other allocations can earn exactly the same; the POC returns one of them deterministically.

## Outputs and how to read them

| Output | Meaning |
|---|---|
| Investable | Cash after the reserve; reserve amount underneath |
| Weighted Net Yield | Dollar-weighted net 7-day yield of the allocation (illustrative) |
| Annualized Income | Simple run-rate income |
| Same-Day Liquidity | Share and dollars in same-day funds |
| Allocation table | Each fund's data, allocation, weight and estimated income |
| POC constraint checks | Four self-checks |
| Model limitations | Four standing limitations returned with every result |

Reading the result: when the prime cap binds (prime exposure equals the cap), loosening it raises yield; when the same-day minimum binds, it is costing yield; when a fund sits at the per-fund cap, concentration policy is binding.

## Validation

- Deterministic: the same inputs always give the same allocation.
- Self-checks on every result; infeasible combinations return a clear message instead of a partial answer.
- No independent verifier and no external model binding. This is the main reason it remains a POC.

## Limitations

- Illustrative synthetic yields and liquidity labels; not live market data.
- The objective is a simple annualized net-yield proxy; it does not model fees beyond the supplied net yield.
- No sponsor eligibility, NAV, credit, tax, regulatory, settlement or investor-specific restrictions.
- No liquidity fees, gates or stress behavior of prime funds.
- Single period; no forecast of yields or cash needs.
- Vertex enumeration only suits a very small universe.

## Status and governance

- **Spec:** Spec015 records the POC as an explicit, temporary, demo-only exception to its non-goal of building fund models inside QuantMeridian.
- **Next:** identify and approve the external fund model repository and contract; then this workspace will call that binding instead of the local POC.

## References

- Help & FAQ: [MMFO help](/guides/MMFO/help)
- Spec: `docs/specs/spec015/SPEC.md`
- Code: `src/app/money-market-fund-optimizer/page.tsx`, `src/lib/mmfo/pocModel.ts`, `src/app/api/mm-fund-optimizer/`
- Related: [MMKT](/guides/MMKT/whitepaper), [CASH](/guides/CASH/whitepaper), [Optimization Center](/guides/OPT/whitepaper)
