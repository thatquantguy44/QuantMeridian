# Cash Optimizer (CASH): white paper and business guide

> **Status:** illustrative dashboard on simulated data. CASH is **not connected to an optimization model**. Its "optimized" figures, "OPTIMAL" path and liquidity ratios are generated placeholders that show the intended layout. Do not quote them as results. The verified optimizers for funding questions are [Sources & Uses](/guides/SXU/whitepaper) (proof of concept) and [Money Market](/guides/MMKT/whitepaper).

## Executive summary

CASH is a treasury funding view. It lays out, on one screen, the funding **sources** a desk can draw on (operating cash, repo, securities-lending cash collateral, internal treasury funding, FX swaps, commercial paper), the **uses** that need cash today (margin calls, settlements, client financing draws, investments, redemptions), the gap between them, a liquidity stress panel, and a matching of uses to sources.

It is useful for explaining the funding problem and the shape of a funding dashboard. It is not a source of numbers: every amount is generated from a fixed random seed, and the "optimized" values are not produced by any solver.

## Business problem

A treasury or financing desk has to fund the day's obligations from a mix of sources that differ in cost, tenor and availability. The questions are always the same:

- Do we have enough cash and funding capacity to meet today's obligations? (the **funding gap**)
- What does our current mix cost? (the **blended rate**)
- Which obligations must be met first? (priority and due time)
- Which sources should fund which uses to minimize cost while meeting every deadline?
- Do we stay above our liquidity policy while doing so? (LCR, NSFR, intraday peak, buffer)

The *right* answer to the matching question is an optimization problem: a transport model of sources to uses with capacity, priority, tenor and cost. That model is being built as [Sources & Uses](/guides/SXU/whitepaper) (Spec012). CASH shows the dashboard around the question; SXU answers it.

## How it works

### What is real and what is generated

| Item | How it is produced | Real or generated |
|---|---|---|
| Source names, types, base rates and tenors | Fixed table in code | Fixed illustrative inputs |
| Source available and used amounts | Seeded random draw: available $0.8–12bn, used 20–85% of available | Generated |
| Some source rates | Replaced by the latest FRED value when the terminal can read it: Operating Cash ← Fed funds (`DFF`); GC Repo, Reverse Repo ← `SOFR`; Term Repo (1W) ← `SOFR` + 7 bp; Commercial Paper ← 3-month AA financial CP (`DCPF3M`) | Real market rates when available |
| Use names, types, rates, due times, priority | Fixed table in code | Fixed illustrative inputs |
| Use amounts | Seeded random draw, $0.2–6bn | Generated |
| Blended rate | Usage-weighted average of source rates: Σ(used × rate) ÷ Σ used | Computed from the above |
| Optimized rate | Blended rate minus a random 3.5–7 bp | **Placeholder, not optimized** |
| Savings | (min(total sources, total uses) × (blended − optimized)) ÷ 10,000 | **Follows from the placeholder** |
| Cheapest funding path | Sources sorted by rate; uses ordered with HIGH priority first; each use assigned to the next source in turn; amount 70–100% of the use (random); "saved" 2–9 bp (random) | **Heuristic with random values, not optimal** |
| LCR, NSFR | Random draws, 122–138% and 108–119% | **Placeholder** |
| Intraday peak, liquidity buffer | 60–85% of total uses; 15–25% of total sources (random) | **Placeholder** |
| Projected need curve | Seeded random walk of 48 quarter-hour points starting at half of total uses | **Placeholder** |
| Recommendations | Text built from the numbers above (cheapest versus dearest source, HIGH-priority total, path savings, gap, buffer) | Derived from placeholders |

The random generator is seeded, so the page shows the same numbers on every load.

### Formulas used on the page

- **Funding gap** = total available across sources − total use amounts. Positive is a surplus, negative a deficit.
- **Blended rate** = Σ(used × rate) ÷ Σ used, in basis points.
- **Savings (USD)** = min(total sources, total uses) × savings bp ÷ 10,000.
- **Path savings** in the recommendations = Σ(path amount × saved bp ÷ 10,000).

## Data and provenance

| Data | Source | Badge |
|---|---|---|
| All amounts, ratios and path values | Seeded simulation (`src/data/cash.ts`, labeled `SIM` in code) | `SIM` |
| Up to five source rates | FRED series `DFF`, `SOFR`, `DCPF3M` through the terminal's market-data layer | `FRED` when any of the three is live |

When the badge reads `FRED`, only those source rates are real. Everything else on the page is still simulated.

The same simulated funding data also feeds the AI Copilot's desk context, labeled SIM.

## Assumptions

### Funding sources (base rates before any FRED overlay)

| Source | Type | Base rate | Tenor |
|---|---|---|---|
| Operating Cash (USD) | Cash | 455 bp | O/N |
| GC Repo | Repo | 461 bp | O/N |
| Term Repo (1W) | Repo | 468 bp | 1W |
| SecLending Cash Collateral | Sec-lending cash | 442 bp | O/N |
| Internal Funding (Treasury) | Internal | 450 bp | O/N |
| FX Swap (EUR/USD) | FX swap | 472 bp | 1W |
| Commercial Paper | CP | 479 bp | 1M |
| Reverse Repo Investment | Repo | 458 bp | O/N |

### Funding uses

| Use | Type | Rate | Due | Priority |
|---|---|---|---|---|
| LCH IM Posting | Margin call | 490 bp | 11:00 ET | HIGH |
| DTC Settlement Net | Settlement | — | 15:30 ET | HIGH |
| Client Financing Draw (client A) | Client financing | 540 bp | Intraday | HIGH |
| Prime Margin Call (client B) | Margin call | 495 bp | 14:00 ET | HIGH |
| Money Market Investment | Treasury invest | 474 bp | EOD | LOW |
| Fund Redemption Payout | Redemption | — | 16:00 ET | MED |
| Triparty Collateral Sub | Settlement | — | 13:00 ET | MED |
| Client Financing Draw (client C) | Client financing | 525 bp | Intraday | MED |

The code labels the client draws and the prime margin call with the names of real firms. They are fictional amounts; no relationship is implied.

## Outputs and how to read them

Read CASH as a **layout and vocabulary**, not as numbers:

- **Funding gap** shows whether total capacity exceeds total obligations, using simulated amounts.
- **Blended rate** is the one KPI computed honestly from the inputs shown (and from live rates when the badge says `FRED`).
- **Optimized rate, savings, the path's `OPTIMAL` tag and "saved" values, LCR, NSFR, peak and buffer** are placeholders.

## Validation

There is no model to validate. The data module is deterministic (same seed, same numbers), and the agent desk-data route requires it to be labeled `SIM`.

## Limitations

- No optimization: the "Cheapest Funding Path" ignores capacity, tenor, due time and cost trade-offs, and its savings are random.
- The `OPTIMAL` tag on the path panel is misleading and should be read as "illustrative".
- LCR and NSFR are not computed from any balance sheet. The gauge colors turn amber at 130% and red at 150%, which is the reverse of how these ratios work (higher is safer; the regulatory minimum is 100%).
- The funding gap compares total available capacity (not unused capacity) with total uses.
- Real firm names appear in simulated data.

## Status and governance

- **Spec:** none of its own. Spec015 describes `/cash-optimizer` as "a funding view, not a connected money market execution optimizer".
- **Intended evolution:** source-to-use matching belongs to [SXU](/guides/SXU/whitepaper) once its production solver exists (Spec012); liquidity forecasting and stress belong to [LIQ](/guides/LIQ/whitepaper) (Spec014). CASH could then display their verified outputs instead of placeholders.
- **Recommended fixes before any external demo:** relabel the path tag and "Optimized Rate" as illustrative, replace real firm names, and correct the LCR/NSFR gauge colors.

## References

- Help & FAQ: [CASH help](/guides/CASH/help)
- Code: `src/app/cash-optimizer/page.tsx`, `src/data/cash.ts`
- Related: [SXU](/guides/SXU/whitepaper), [MMKT](/guides/MMKT/whitepaper), [LIQ](/guides/LIQ/whitepaper), [REINV](/guides/REINV/whitepaper)
