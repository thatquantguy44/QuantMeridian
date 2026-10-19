# Cash Collateral Reinvestment (REINV): white paper and business guide

> **Status:** analytics dashboard on simulated positions, with live market yields when available. REINV is **not connected to an optimization model**. Its positions, limit usage, scenario impacts and recommended actions are illustrative. Treat it as a picture of the problem, not a source of numbers.

## Executive summary

When a securities-lending desk lends securities against cash collateral, it owes the borrower a **rebate** on that cash and earns whatever it can by **reinvesting** the cash. The desk's profit on the cash leg is the **net spread** between the reinvestment yield and the rebate.

REINV shows that reinvestment book on one page: the ladder of positions (overnight repo, bills, agency notes, commercial paper, bank deposits, an ultra-short credit proxy), its yield, maturity and liquidity, the policy limits it must respect, how a Fed rate move would hit the spread, and a short list of suggested ladder actions.

## Business problem

Cash collateral can be recalled at short notice when borrowers return securities, so the reinvestment book must stay liquid. At the same time the rebate is usually set close to overnight rates, so earning a positive spread means reaching for some term or credit. The desk balances:

| Pressure | Example |
|---|---|
| Liquidity | Enough overnight (T+0) cash to meet returns without selling assets |
| Maturity | A cap on weighted-average maturity (WAM) |
| Credit and concentration | Caps on bank deposits, commercial paper and credit exposure |
| Rate sensitivity | When the Fed cuts, yields fall faster than some rebates reprice; the **Fed beta** of each asset measures how much of a rate move it passes through |
| Spread | The net of all the above must stay positive |

A real optimizer would choose the ladder subject to these limits. REINV does not optimize; it monitors.

## How it works

### Positions

Seven fixed instruments, each with a liquidity bucket, credit bucket, base allocation, base yield, WAM, WAL and Fed beta. Allocations and yields are drawn around their base values from a seeded random generator, so the numbers repeat on every load.

### Live yields

When the terminal can read FRED data, instrument yields are replaced by market rates plus a fixed spread:

| Instrument | Live series | Spread |
|---|---|---|
| O/N Reverse Repo - UST | `SOFR` | 0 |
| Tri-Party GC Repo | `SOFR` | 0 |
| T-Bills 1-3M | `DGS3MO` | 0 |
| Agency Discount Notes | `DGS3MO` | −5 bp |
| A1/P1 Commercial Paper | `DCPF3M` | +15 bp |
| Bank Time Deposits | `DGS6MO` | 0 |
| Ultra-Short Credit ETF Proxy | `DGS1` | +28 bp |

### Formulas

| Measure | Formula |
|---|---|
| Cash collateral | Σ allocations |
| Reinvest yield | Allocation-weighted average yield |
| Rebate cost | Fixed 388 bp |
| Net spread | Reinvest yield − rebate |
| WAM | Allocation-weighted average WAM |
| T+0 liquidity | Σ allocations in the T+0 bucket |
| Monthly carry | Cash × net spread ÷ 10,000 ÷ 12 (same yields as the KPI strip) |
| Weighted Fed beta | Allocation-weighted average beta, % |
| Stressed spread | Net spread + shock × beta ÷ 100 × 0.42 |
| Shock impact /mo | Cash × shock × beta ÷ 100 × 0.42 ÷ 10,000 ÷ 12 (monthly, to match monthly carry) |
| Scenario income impact | Cash × move × 0.82 × 0.42 ÷ 10,000 (annual; fixed beta 0.82) |
| Limit use | Allocation ÷ (limit % × $36bn reference) × a random factor 0.88–1.04, capped at 99% |

The 0.42 and 0.82 factors are uncalibrated constants carried over from the original dashboard; the code now says so where they are used. Replacing them with an explicit rebate-beta assumption is planned (Pass 2).

### Constraints

Computed from the simulated positions against fixed limits:

| Constraint | Limit | Status rule |
|---|---|---|
| Minimum T+0 liquidity | 40% of cash | OK at or above, otherwise WATCH |
| WAM limit | 45 days | OK at or below, otherwise WATCH |
| Credit ETF proxy cap | 8% | OK at or below, otherwise BREACH |
| Bank deposit cap | 15% | OK at or below, otherwise WATCH |
| CP concentration cap | 14% | OK at or below, otherwise WATCH |

### Recommended actions

Four fixed suggestions (roll CP into bills, add 1–3 month bills, trim the credit proxy, hedge Fed beta). Their dollar impacts are fixed fractions of the cash pool (0.042%, 0.028%, 0.018%) and, for the hedge, the annual carry lost to a 25 bp cut. They are not the output of any model.

## Data and provenance

| Data | Source | Badge |
|---|---|---|
| Positions, limits, recommendations | Seeded simulation (`src/data/reinvestment.ts`) | `SIM` |
| Instrument yields | FRED `SOFR`, `DGS3MO`, `DCPF3M`, `DGS6MO`, `DGS1` when available | `FRED` |

When the badge is `SIM`, an amber `FRED READY` tag means live yields would be used if the data were reachable.

## Assumptions

### Positions (base values before random variation)

| Instrument | Liquidity | Credit | Base allocation | Base yield | WAM / WAL | Fed beta | Limit |
|---|---|---|---|---|---|---|---|
| O/N Reverse Repo - UST | T+0 | HQLA | $7.8bn | 432 bp | 1 / 1 d | 100% | 40% |
| Tri-Party GC Repo | T+0 | HQLA | $6.1bn | 434 bp | 3 / 3 d | 96% | 40% |
| T-Bills 1-3M | T+1 | HQLA | $5.4bn | 424 bp | 46 / 44 d | 82% | 40% |
| Agency Discount Notes | T+1 | Agency | $3.2bn | 429 bp | 32 / 30 d | 78% | 40% |
| A1/P1 Commercial Paper | T+7 | A1/P1 | $2.6bn | 449 bp | 39 / 35 d | 62% | 40% |
| Bank Time Deposits | Term | Bank | $2.1bn | 441 bp | 21 / 19 d | 70% | 12% |
| Ultra-Short Credit ETF Proxy | T+1 | Credit | $1.4bn | 462 bp | 55 / 48 d | 48% | 8% |

Allocations vary ±8% and yields −6 to +7 bp around these values.

### Scenarios

| Scenario | Policy move |
|---|---|
| Hold | 0 bp |
| 25bp Cut | −25 bp |
| 100bp Cut | −100 bp |
| Repo Squeeze | +35 bp |
| Bills Rally | −15 bp |

Income impact depends only on the move: cuts reduce income and the "Repo Squeeze" (a rise) increases it. The scenario names are illustrative labels for rate moves, not modeled market events.

## Outputs and how to read them

- **Net spread** and **monthly carry** describe the simulated book's economics (with live yields when the badge reads `FRED`).
- **Fed beta** says how much of a policy move flows into the book's yield; a higher beta means a cut hurts more.
- **Constraints** show which policy limits the simulated book is near.
- **Shock impact**, scenario impacts and recommended-action dollars are illustrative.

## Validation

No model to validate. The data module is deterministic.

## Limitations

- Positions and limit usage are simulated; nothing comes from a real book.
- No optimization: recommendations are fixed text with fixed-fraction impacts.
- Rebate cost is a fixed 388 bp and does not reprice with a rate shock.
- Scenario names label rate moves only; the page tags them `RATE MOVES ONLY`. Modeling them as market events (separate repo, bill, CP and rebate shifts) is planned (Pass 2).
- The credit ETF proxy is priced off the 1-year Treasury plus a fixed spread.

## Status and governance

- **Spec:** none of its own.
- **Natural successor:** cash-collateral reinvestment fits the money-market deployment model of [MMKT](/guides/MMKT/whitepaper) (instrument universe, maturity limits, liquidity floors, exposure caps). A connected version would reuse that model with the rebate as a cost.

## References

- Help & FAQ: [REINV help](/guides/REINV/help)
- Code: `src/app/reinvestment/page.tsx`, `src/data/reinvestment.ts`
- Related: [MMKT](/guides/MMKT/whitepaper), [CASH](/guides/CASH/whitepaper), [IBAL](/guides/IBAL/whitepaper)
