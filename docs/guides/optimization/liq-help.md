# Liquidity & Funding Stress (LIQ): help and FAQ

> The ladder, facilities, scenarios and survival figures on this page are simulated. Only two early-warning signals can be live. Read the [white paper](/guides/LIQ/whitepaper) before quoting a number.

## Quick start

1. Open [Liquidity Stress](/liquidity).
2. Check the badge: `FRED` means at least one live early-warning signal; `SIM` means none.
3. Read the KPI strip: net liquidity, stress buffer and survival.
4. In **Stress Scenarios**, use the **Severity** filter to compare scenarios and read **Post-Shock Buffer** and **Survival**.
5. Scan **Early Warning Signals** for WATCH or RISK.

## Screen guide

### Header

| Element | Meaning |
|---|---|
| `LIQ` / Liquidity & Funding Stress | Module code and name ("Margin shocks, funding capacity and early warning signals") |
| **Guide** | Opens this help and the white paper |
| `SIM` / `FRED` badge | `FRED` when `SOFR`, `EFFR` or the high-yield spread series is live |
| Amber tag | Shown with `SIM`: live signals would be used if available |

### KPI strip

| Stat | Meaning |
|---|---|
| Liquid Assets | Today's opening cash plus undrawn facility capacity |
| Outflows Today | T+0 outflows plus margin calls; high-priority call count underneath (fixed at 4) |
| Net Liquidity | T+0 closing liquidity minus the T+0 buffer |
| Stress Buffer | Tightest (closing − buffer) across all horizons |
| Survival | Liquid assets ÷ today's outflows, days |
| Funding Cost | Drawn-weighted facility cost, bp; contingency capacity underneath |

### Liquidity Ladder panel (`LADR`)

| Column | Meaning |
|---|---|
| Horizon | T+0, T+1, T+2, 1W, 1M |
| Opening | Cash at the start of the horizon |
| Inflows / Outflows | Cash in (green) and out (red) |
| Margin Calls | Collateral calls to pay |
| Secured Funding | Repo and other secured cash raised |
| Closing Liq | Opening + inflows + secured − outflows − margin calls; red when below the buffer |
| Buffer Use | Minimum buffer as a share of closing liquidity (red if closing is below the buffer) |

### Net Liquidity Path panel (`PATH`)

Closing liquidity (green area) against the minimum buffer (red dashed line) by horizon.

### Funding Facilities panel (`SRC`)

| Column | Meaning |
|---|---|
| Facility / Type | Name; Cash, Repo, CP, FX Swap, Internal or Contingent |
| Capacity / Drawn | Total line and amount used |
| Cost | bp |
| Reliability | Simulated confidence the line performs under stress: red below 82%, amber below 90% |
| Time | How fast it delivers cash |

### Undrawn Capacity panel (`CAP`)

Bars of capacity minus drawn per facility (contingent in violet).

### Stress Scenarios panel (`STRESS`)

| Element | Meaning |
|---|---|
| **Severity** filter | All, Base, Watch, Stress, Severe |
| Scenario / Severity | Name and tag |
| Margin Shock / Collat Shock | Fixed shock amounts |
| Funding Cost | Funding cost plus the scenario's shock |
| Post-Shock Buffer | Stress buffer − margin shock − collateral shock (red when negative) |
| Survival | Post-shock buffer ÷ stressed daily burn; red below 3 days |

Sorted by post-shock buffer, smallest first.

### Post-Shock Buffers panel (`BUF`)

Bars of post-shock buffer per filtered scenario (red when negative).

### Early Warning Signals panel (`EWS`)

| Column | Meaning |
|---|---|
| Signal | SOFR − EFFR spread, HY OAS 5d move, Equity drawdown proxy, HYG volume z-score, Available intraday cash, Contingent line usage |
| Source | `FRED` when the value came from live data this load; `SIM` otherwise. The header counts live signals. |
| Latest / Threshold | Current value and its alert threshold |
| Status | OK, WATCH or RISK; the header counts signals not OK |
| Desk Impact | Why the signal matters |

Only the first two signals can update from live data; each row's Source says whether it did.

## Assumptions and defaults

| Item | Value |
|---|---|
| Opening cash | $18.4bn |
| Minimum buffer | $7.5bn at T+0, +$0.9bn per horizon |
| Stressed daily burn | Larger of $0.8bn and 32% of today's outflows |
| SOFR − EFFR thresholds | WATCH ≥ 14 bp, RISK ≥ 20 bp |
| HY OAS 5-day move thresholds | WATCH ≥ 35 bp, RISK ≥ 50 bp |
| Inputs you can change | Only the severity filter |

## FAQ

### Is this a liquidity model?
No. It is a simulated cockpit. The real liquidity model (forecasts, breach probabilities, anomaly review, lever optimization) is defined in Spec014 and will replace this page at `/cash-optimizer/liquidity`.

### Why are there two different survival numbers?
The KPI divides all liquid assets by today's outflows. The scenario column divides the buffer left after a shock by a stressed daily burn. They answer different questions.

### Which signals are live?
Only the SOFR − EFFR spread and the high-yield spread move, and only when FRED is reachable; they then show `FRED`. Every other signal is a fixed simulated value and shows `SIM`. Earlier versions labeled some fixed signals "YAHOO" or "LOCAL".

### Why is reliability below 90% for the contingent line?
Reliability is simulated, and the contingent line is deliberately given a lower range (78–88%) to show that backstop lines are less certain under stress.

### Will this page disappear?
When the Spec014 view ships, `/liquidity` will redirect to it and this page's simulated data will be removed.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| Badge stays `SIM` | The FRED series could not be read; the two signals show their default values |
| Numbers never change | Expected: the simulation uses a fixed seed |
| A signal changed status between visits | A live FRED value changed |

## Glossary

| Term | Meaning |
|---|---|
| Liquidity ladder | Cash position projected over successive horizons |
| Minimum buffer | Cash the firm must keep at all times |
| Margin call | Demand for collateral from a counterparty or CCP |
| Secured funding | Cash raised against collateral, such as repo |
| Contingent line | A committed facility drawn only in stress |
| Survival days | How long the firm can meet outflows from available liquidity |
| SOFR − EFFR | Spread between secured and unsecured overnight rates; widening signals repo stress |
| HY OAS | High-yield option-adjusted spread; a fast rise signals credit stress |

See also the [LIQ white paper](/guides/LIQ/whitepaper).
