# Cash Collateral Reinvestment (REINV): help and FAQ

> Positions, limits, scenario impacts and actions on this page are simulated. Read the [white paper](/guides/REINV/whitepaper) before quoting a number.

## Quick start

1. Open [Cash Reinvestment](/reinvestment).
2. Check the badge: `SIM` means simulated yields; `FRED` means live market yields are applied.
3. Read the KPI strip for net spread, WAM and T+0 liquidity.
4. Drag the **Policy Shock** slider in **Fed Path Shock** to see how a rate move changes the spread.
5. Scan **Liquidity And Investment Constraints** for anything on WATCH or BREACH.

## Screen guide

### Header

| Element | Meaning |
|---|---|
| `REINV` / Cash Collateral Reinvestment | Module code and name ("Yield ladder, Fed beta, liquidity and constraints") |
| **Guide** | Opens this help and the white paper |
| `SIM` / `FRED` badge | `FRED` when any of the five yield series is live |
| `FRED/YAHOO READY` | Shown with `SIM`: live yields would be used if available |

### KPI strip

| Stat | Meaning |
|---|---|
| Cash Collateral | Size of the reinvestment pool |
| Reinvest Yield | Allocation-weighted yield, bp |
| Rebate Cost | Rebate owed to borrowers, fixed 388 bp |
| Net Spread | Yield − rebate |
| WAM | Weighted-average maturity, days |
| T+0 Liquidity | Overnight-available cash, with its share of the pool |

### Reinvestment Ladder panel (`LADR`)

| Column | Meaning |
|---|---|
| Instrument | Position name |
| Liq | Liquidity bucket: T+0, T+1, T+7, TERM |
| Credit | HQLA, AGENCY, A1/P1, BANK, CREDIT |
| Allocation | Dollars |
| Yield | bp (live when FRED is available) |
| WAM / WAL | Days |
| Limit Use | Share of the position's limit in use: green, amber above 70%, red above 85% (illustrative) |

### Allocation Mix panel (`MIX`)

Donut of allocations, total in the middle, six largest listed.

### Fed Path Shock panel (`BETA`)

| Element | Meaning | Range / default |
|---|---|---|
| **Policy Shock** slider | A change in policy rates | −150 to +75 bp in 25 bp steps; −25 bp |
| Fed Beta | Allocation-weighted pass-through of a rate move, % | |
| Stressed Spread | Net spread after the shock (simulated yields) | |
| Monthly Carry | Cash × net spread ÷ 12 (simulated yields) | |
| Shock Impact | **Annual** change in carry from the shock | |
| Monthly Income chart | Monthly income under each scenario | |
| Scenario tiles | Annual income impact of each scenario | |

### Scenario Income Impact panel (`SCEN`)

Horizontal bars of each scenario's annual income impact: Hold, 25bp Cut, 100bp Cut, Repo Squeeze, Bills Rally.

### Liquidity And Investment Constraints panel (`CSTR`)

| Column | Meaning |
|---|---|
| Constraint | Minimum T+0 liquidity (40%), WAM limit (45 days), Credit ETF proxy cap (8%), Bank deposit cap (15%), CP concentration cap (14%) |
| Current / Limit | Value and limit |
| Usage | Bar of current against limit |
| Status | OK (green), WATCH (amber), BREACH (red; only the credit cap can breach) |

### Recommended Ladder Actions panel (`ACTN`)

| Column | Meaning |
|---|---|
| Action | ROLL, ADD, TRIM or HEDGE |
| Target | Instrument or exposure |
| Rationale | Fixed explanation |
| Impact | Illustrative dollars (a fixed fraction of the pool) |
| Pri | HIGH, MED, LOW; the header counts HIGH actions |

## Assumptions and defaults

| Item | Value |
|---|---|
| Rebate | 388 bp, fixed |
| Shock pass-through | Weighted beta × 0.42 (fixed constant) |
| Scenario pass-through | 0.82 × 0.42 (fixed constants) |
| Live yield map | Repo ← SOFR; bills and agency ← 3-month Treasury (agency −5 bp); CP ← 3-month AA financial CP +15 bp; bank deposits ← 6-month Treasury; credit proxy ← 1-year Treasury +28 bp |
| Inputs you can change | Only the policy shock slider |

## FAQ

### Is the ladder optimized?
No. Positions are simulated and the actions are fixed suggestions. See [MMKT](/money-market) for a verified deployment model.

### Why does "Repo Squeeze" increase income?
The scenario impact depends only on the rate move, and Repo Squeeze is modeled as a +35 bp rise, which raises reinvestment yield. The scenario names are labels for rate moves.

### Is "Shock Impact" monthly?
No, it is annual, although it sits next to monthly carry.

### When FRED is live, is everything live?
Only instrument yields. Allocations, limits and actions remain simulated, and monthly carry, stressed spread and scenarios still use the simulated yields.

### Why does a cut hurt so much?
Overnight repo has a beta near 100%, so a cut flows straight into yield while the rebate here stays fixed at 388 bp.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| Badge stays `SIM` | Yield series could not be read; simulated yields are shown |
| Numbers never change | Expected: the simulation uses a fixed seed |
| KPI yield changes between visits | A live FRED rate changed |

## Glossary

| Term | Meaning |
|---|---|
| Cash collateral | Cash received from borrowers against lent securities |
| Rebate | Interest owed back to the borrower on that cash |
| Net spread | Reinvestment yield minus rebate |
| Fed beta | Share of a policy rate move passed through to an asset's yield |
| HQLA | High-quality liquid assets |
| A1/P1 | Top short-term credit ratings for commercial paper |
| WAM / WAL | Weighted-average maturity / life |
| T+0 / T+1 / T+7 | Cash available same day / next day / within a week |

See also the [REINV white paper](/guides/REINV/whitepaper).
