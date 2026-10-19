# Cash Optimizer (CASH): help and FAQ

> Everything on this page except the blended rate is simulated or a placeholder. Read the [white paper](/guides/CASH/whitepaper) before quoting any number.

## Quick start

1. Open [Cash Optimizer](/cash-optimizer). There is nothing to configure; the page loads the simulated book.
2. Check the badge: `SIM` means all values are simulated; `FRED` means some source rates are live.
3. Read the KPI strip for the funding gap and blended rate.
4. Scan **Funding Sources** and **Funding Uses**, then the **Funding Flow** diagram for how uses are matched to sources.
5. For a real, verified matching, use [Sources & Uses](/sources-uses) instead.

## Screen guide

### Header

| Element | Meaning |
|---|---|
| `CASH` / Cash Optimizer | Module code and name ("Treasury Funding Optimization") |
| **Guide** | Opens this help and the white paper |
| `SIM` / `FRED` badge | `FRED` when at least one of `SOFR`, `DFF` or `DCPF3M` was read live; otherwise `SIM` |

### KPI strip

| Stat | Meaning |
|---|---|
| Total Sources | Sum of available amounts across the 8 facilities |
| Total Uses | Sum of the 8 obligations |
| Funding Gap | Total sources − total uses; green "surplus" or red "deficit" |
| Blended Rate | Usage-weighted cost of funds, bp |
| Optimized Rate · illustrative | **Placeholder** ("placeholder · not solved"): blended rate minus a random 3.5–7 bp |
| Savings · illustrative | **Placeholder** that follows from the optimized rate |

### Funding Sources panel (`SRC`)

| Column | Meaning |
|---|---|
| Source | Facility name |
| Type | Cash, Repo, SecLending Cash, Internal, FX Swap, CP |
| Available | Capacity, USD (simulated) |
| Used | Drawn amount, USD (simulated) |
| Utilization | Used ÷ available, as a bar |
| Rate | Cost of funds, bp (live for five sources when FRED is available) |
| Tenor | O/N, 1W or 1M |

Click a column header to sort. Sorted by available, largest first.

### Source Mix panel (`MIX`)

A donut of available capacity by source, with the total in the middle and the six largest listed.

### Funding Uses panel (`USE`)

| Column | Meaning |
|---|---|
| Use | Obligation name |
| Type | Margin call, Settlement, Client financing, Treasury invest, Redemption |
| Amount | USD (simulated) |
| Rate | Return earned or cost avoided, bp; "—" for settlements and redemptions |
| Due By | Cut-off time (ET) or Intraday / EOD |
| Pri | HIGH (red), MED (amber), LOW |

### Liquidity Stress panel (`LIQ`)

| Element | Meaning |
|---|---|
| Projected Need | **Placeholder** random-walk curve, 48 quarter-hour points from 09:00 |
| LCR % · illus. gauge | **Placeholder** value 122–138%. Red below the 100% regulatory minimum, amber from 100% to 110%, green above. |
| NSFR % · illus. gauge | **Placeholder** value 108–119%, same colors |
| Intraday Peak | **Placeholder:** 60–85% of total uses |
| Liquidity Buffer | **Placeholder:** 15–25% of total sources |

### Illustrative Funding Path panel (`PATH`)

| Column | Meaning |
|---|---|
| Use ← Matched Source | Each use and the source assigned to it |
| Amount | 70–100% of the use (random) |
| Rate | The assigned source's base rate (simulated rates, not the live overlay) |
| Saved (illus.) | **Random** 2–9 bp |

The panel is tagged `ILLUSTRATIVE · NOT OPTIMIZED` and says so in its note. Uses are assigned to sources in turn, cheapest source first, with HIGH-priority uses first; amounts and savings are placeholders.

### Funding Recommendations panel (`REC`)

Five sentences generated from the numbers above:

1. Shift funding to the cheapest source away from the dearest (tag: the rate difference).
2. Cover the HIGH-priority uses first (tag: how many).
3. The illustrative path (tag: its placeholder "savings", marked illus.).
4. Deploy a surplus or raise term repo for a deficit (tag: the gap).
5. Keep the buffer above the intraday peak (tag: the LCR placeholder).

### Funding Flow panel (`FLOW`)

A Sankey diagram of the path: sources on the left, uses on the right, link width by amount. Long names are shortened to 20 characters.

## Assumptions and defaults

| Item | Value |
|---|---|
| Sources | 8 fixed facilities; base rates 442–479 bp; see the white paper table |
| Uses | 8 fixed obligations; 4 HIGH, 3 MED, 1 LOW priority |
| Random seed | Fixed, so values repeat on every load |
| FRED overlay | `DFF` → Operating Cash; `SOFR` → GC Repo, Reverse Repo, Term Repo (+7 bp); `DCPF3M` → Commercial Paper |
| Inputs you can change | None on this page |

## FAQ

### Is the "Illustrative Funding Path" optimal?
No, and the page says so. It assigns uses to sources in turn, cheapest first, and its amounts and savings include random values. It ignores capacity, tenor and deadlines. Use [Sources & Uses](/sources-uses) for a verified matching.

### Where does the "Optimized Rate" come from?
It is the blended rate minus a random 3.5–7 bp, labeled "illustrative" and "placeholder · not solved" on the page. A verified solve is planned (Pass 2: CASH solved with the Sources & Uses model).

### How do the LCR and NSFR gauge colors work?
For LCR and NSFR higher is safer, so the gauges are red below the 100% regulatory minimum, amber from 100% to 110% and green above. The values themselves are placeholders; no balance sheet is connected.

### When the badge says FRED, is everything live?
No. Only up to five source rates are live. Amounts, ratios and the path are still simulated, and the path still uses the simulated rates.

### Are the clients in the uses table real firms?
No. The client draws and the prime margin call are labeled "Client A (hedge fund)", "Client B (hedge fund)" and "Client C (multi-manager)". The amounts are fictional.

### Can I change the inputs?
Not on this page. Money Market and Sources & Uses have editable inputs.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| Badge stays `SIM` | The terminal could not read `SOFR`, `DFF` or `DCPF3M` (for example the Gold database is not connected). All rates are the simulated base rates. |
| Numbers never change | Expected: the simulation uses a fixed seed. |
| Blended rate changes between visits | A live FRED rate changed. |

## Glossary

| Term | Meaning |
|---|---|
| Funding source | A facility the desk can draw cash from |
| Funding use | An obligation that needs cash |
| Funding gap | Sources minus uses |
| Blended rate | Average cost of funds weighted by usage |
| GC repo | General-collateral repurchase agreement |
| CP | Commercial paper |
| LCR | Liquidity Coverage Ratio: high-quality liquid assets ÷ 30-day stressed outflows; minimum 100% |
| NSFR | Net Stable Funding Ratio: available ÷ required stable funding; minimum 100% |
| bp | Basis point, 0.01% |
| SIM | Simulated data |

See also the [CASH white paper](/guides/CASH/whitepaper).
