# Money Market Fund Optimizer (MMFO): help and FAQ

## Quick start

1. Open [Money Market Fund Optimizer](/money-market-fund-optimizer).
2. Turn on **Synthetic Demo Mode**. It loads the fictional fund snapshot and runs a sample allocation immediately.
3. Read **Allocation Result**: weighted net yield, income, same-day liquidity and the fund table.
4. Change a limit in **Portfolio Constraints** (for example raise **Maximum prime exposure** to 60%) and press **Run demo optimization**.

## Screen guide

### Header and notice

| Element | Meaning |
|---|---|
| `MMFO` / Money Market Fund Optimizer | Module code and name ("Fund Allocation · Local POC Model") |
| **Guide** | Opens this help and the white paper |
| `POC` | Proof of concept |
| `SIM` / `UNAVAILABLE` badge | `SIM` while demo mode is on; otherwise no data |
| Amber notice | "Proof of concept · synthetic inputs": separate from CASH; illustrative funds; not offers, forecasts or recommendations |

### Synthetic Demo Mode switch

Off by default. Turning it on loads the fixed fictional snapshot and runs one allocation. Turning it off clears the result and cancels any run in progress.

### Portfolio Constraints panel (`INPUT`)

| Input | Meaning | Range | Default |
|---|---|---|---|
| Total cash to allocate | Dollars to place | at least $100 | $10,000,000 |
| Cash reserve | Share kept uninvested | 0–99% | 10% |
| Minimum same-day liquidity | Share that must be in same-day funds | 0–100% | 30% |
| Maximum prime exposure | Cap on the share in prime funds | 0–100% | 40% |
| Maximum per fund | Cap on the share in any one fund | 0–100% | 25% |
| **Run demo optimization** | Solves with these limits. Reads "Turn on demo mode to run" while demo mode is off. | | |

Editing any input clears the previous result until you run again.

### Future Model Repository panel (`BINDING`)

| Element | Meaning |
|---|---|
| `SERVICE <state>` | Health of an optional external fund model service (`MM_FUND_OPTIMIZER_API_URL`): `UNCONFIGURED` when no URL is set |
| `BINDING UNCONFIGURED` | No approved external model binding exists |
| Detail, Revision, API | The service's message, model revision and API version if reachable |
| **Refresh** | Re-checks the service |
| Note | The POC runs locally; once an external model is approved, this workspace will call it instead |

### Allocation Result panel (`RESULT`)

| Element | Meaning |
|---|---|
| `POC_OPTIMAL` / `SIM · 2026-10-16` | Model status and snapshot date |
| Investable | Cash after the reserve; reserve underneath |
| Weighted Net Yield | Dollar-weighted net 7-day yield |
| Annualized Income | Simple run-rate income |
| Same-Day Liquidity | Share in same-day funds, dollars underneath |
| Dataset line | Dataset id and snapshot; mix fields are descriptive only |

Fund table columns:

| Column | Meaning |
|---|---|
| Fund | Fictional share class name |
| Type | GOVERNMENT (blue) or PRIME (amber) |
| Liquidity | SAME DAY or NEXT DAY |
| Gross 7D / Expense / Net 7D | Gross yield, expense ratio and net yield (the LP uses net) |
| AUM ($bn) | Fund size (descriptive) |
| WAM / WAL | Weighted-average maturity and life, days (descriptive) |
| DLA / WLA | Daily and weekly liquid assets, % (descriptive) |
| UST / Repo / Agency / Other | Asset mix, % (descriptive) |
| Allocation / Weight | Dollars and share of investable |
| Est. Annual Income | Allocation × net yield |

Below the table: **POC constraint checks** (full investment, same-day minimum, prime maximum, single-fund maximum), tagged `NOT INDEPENDENTLY VERIFIED`, and **Model limitations** (expand to read).

## Assumptions and defaults

| Item | Value |
|---|---|
| Universe | 8 fictional share classes: 5 government, 3 prime; 5 same-day, 3 next-day |
| Net yields | 4.64% to 4.96% |
| Objective | Maximize weighted net 7-day yield |
| Solver | Exact vertex enumeration (suitable only for this small universe) |
| Check tolerance | $0.01 |
| Income | Run-rate, no compounding |
| Default result | 4.778% weighted net yield, $430,020 income on $9mm invested |

## FAQ

### Why is nothing shown when I open the page?
Synthetic Demo Mode is off by default, so no synthetic data is loaded until you choose it.

### Why does the allocation always max out prime?
Prime funds have the highest net yields (4.90–4.96%), so the model fills them up to the prime cap and the per-fund cap. Lower the prime cap to see a more conservative mix.

### Why are AUM, WAM, WAL and asset mix not used?
The POC only uses net yield, fund type and liquidity. The other fields describe the funds; a production model could add constraints on them.

### What does "These limits cannot be satisfied together" mean?
No allocation meets every limit. For example a 90% same-day minimum with a 10% per-fund cap cannot work, because only five funds are same-day (at most 50%). Lower the same-day minimum or prime cap, or raise the per-fund cap.

### Why does the same input give a slightly different fund split than I expected?
Several government funds share a 4.66% net yield. Swapping between them earns exactly the same, and the POC returns one optimum deterministically.

### Is this verified like MMKT and IBAL?
No. The checks run inside the same code. There is no independent verifier, so results are tagged as not independently verified.

### How is this different from MMKT?
MMKT plans a two-week, multi-instrument deployment against a cash forecast and floors, with independent verification. MMFO splits one block of cash across funds at a point in time.

## Troubleshooting

| Message | Meaning and fix |
|---|---|
| "Total cash must be at least $100." | Enter a larger amount. |
| "<limit> must be between 0% and 100%." | Fix the named percentage. |
| "Cash reserve must leave an amount to invest." | The reserve must be below 100%. |
| "These limits cannot be satisfied together…" | See the FAQ above. |
| "POC allocation failed a constraint check." | An internal check failed; report the inputs. |
| `SERVICE UNCONFIGURED` | Expected: no external fund model URL is set. |
| "Configured model service URL is invalid." | `MM_FUND_OPTIMIZER_API_URL` is malformed. |
| "Model service is reachable. Its binding still requires Spec015 approval." | A service answered, but it is not approved for use. |

## Glossary

| Term | Meaning |
|---|---|
| Money-market fund | A fund holding short-term, high-quality debt, aiming for a stable value |
| Government / prime fund | Invests in government paper and repo / also in bank and corporate paper |
| Same-day / next-day liquidity | Redemption proceeds the same / next business day |
| 7-day yield | The fund's annualized yield over the last seven days |
| Expense ratio | Annual fund fee, deducted to get net yield |
| DLA / WLA | Share of assets maturing or liquid within one day / one week |
| WAM / WAL | Weighted-average maturity / life of the fund's holdings |
| Vertex enumeration | Solving a small LP by checking every corner of the feasible region |

See also the [MMFO white paper](/guides/MMFO/whitepaper).
