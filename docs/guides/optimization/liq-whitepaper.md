# Liquidity & Funding Stress (LIQ): white paper and business guide

> **Status:** stress cockpit on simulated data, with two live market early-warning signals. LIQ is **not connected to a model**. Its ladder, facilities, scenarios and survival figures are generated. Spec014 defines the real liquidity oversight model; it is drafted and awaiting owner approval, and it will replace this page.

## Executive summary

LIQ is a funding-stress cockpit for a broker-dealer treasury. On one page it shows:

- a **liquidity ladder** from today out to one month: opening cash, inflows, outflows, margin calls, secured funding, closing liquidity against a minimum buffer;
- the **funding facilities** the firm can draw, with capacity, cost, reliability and time to fund;
- **stress scenarios** that hit margin and collateral and report the buffer left and the days the firm survives;
- **early-warning signals** from markets (repo spreads, high-yield spreads, equity and credit stress).

It explains the vocabulary and layout of liquidity stress testing. Its numbers are simulated.

## Business problem

A dealer can be solvent and still fail if it runs out of cash. Liquidity stress testing asks:

- Will closing liquidity stay above the minimum buffer each day and week ahead?
- If margin calls jump and collateral values fall, how much buffer is left?
- How many days could the firm survive at a stressed burn rate?
- Which funding lines can be drawn, how fast, at what cost and how reliably?
- Which market signals are flashing before a stress arrives?

## How it works

### Liquidity ladder

Five horizons: T+0, T+1, T+2, 1 week and 1 month. Starting from $18.4bn opening cash, each horizon draws inflows, outflows, margin calls and secured funding from a seeded random generator (later horizons scaled up), and:

`closing liquidity = opening + inflows + secured funding − outflows − margin calls`

The next horizon opens with the previous closing balance. The minimum buffer rises from $7.5bn at T+0 by $0.9bn per horizon.

### Funding facilities

Seven facilities with fixed base capacity, base cost and time to fund; drawn amounts, costs (±6–8 bp) and reliability scores vary around them.

### Summary measures

| Measure | Formula |
|---|---|
| Liquid assets | Today's opening cash + undrawn capacity across facilities |
| Outflows today | T+0 outflows + T+0 margin calls |
| Net liquidity | T+0 closing liquidity − T+0 buffer |
| Stress buffer | The smallest (closing − buffer) across all horizons |
| Survival | Liquid assets ÷ today's outflows, in days |
| Funding cost | Drawn-weighted facility cost |
| Contingency | Undrawn contingent and internal capacity |
| High-priority calls | Fixed at 4 |

### Stress scenarios

Each scenario subtracts a margin shock and a collateral shock from the stress buffer and adds a funding-cost shock:

- **post-shock buffer** = stress buffer − margin shock − collateral shock
- **survival** = post-shock buffer ÷ daily burn, where daily burn = the larger of $0.8bn and 32% of today's outflows (never below 0)

### Early-warning signals

| Signal | Source | Live? | Status rule |
|---|---|---|---|
| SOFR − EFFR spread | FRED `SOFR`, `EFFR` | Yes, when available | RISK when the absolute spread is ≥ 20 bp; WATCH at ≥ 14 bp |
| HY OAS 5-day move | FRED `BAMLH0A0HYM2` (change over the last 6 observations) | Yes, when available | RISK when the absolute move is ≥ 50 bp; WATCH at ≥ 35 bp |
| Equity drawdown proxy | labeled Yahoo | No: fixed −3.8% | fixed |
| HYG volume z-score | labeled Yahoo | No: fixed 1.9 | fixed |
| Available intraday cash | local | No: fixed $11.2bn | fixed |
| Contingent line usage | local | No: fixed 68% | fixed |

## Data and provenance

| Data | Source | Badge |
|---|---|---|
| Ladder, facilities, scenarios, summary | Seeded simulation (`src/data/liquidity.ts`) | `SIM` |
| Two early-warning signals | FRED `SOFR`, `EFFR`, `BAMLH0A0HYM2` | `FRED` when any is live |

## Assumptions

### Funding facilities (base values)

| Facility | Type | Capacity | Cost | Time to fund |
|---|---|---|---|---|
| Operating Cash | Cash | $9.5bn | 0 bp | Now |
| GC Repo Lines | Repo | $14.0bn | 461 bp | 15 min |
| Term Repo Capacity | Repo | $8.0bn | 474 bp | 2 hr |
| Commercial Paper | CP | $5.2bn | 486 bp | Same day |
| FX Swap Liquidity | FX swap | $4.8bn | 492 bp | 1 hr |
| Internal Treasury Backstop | Internal | $6.5bn | 455 bp | 30 min |
| Committed Contingent Line | Contingent | $7.0bn | 525 bp | T+1 |

Reliability is drawn from 86–99% (contingent line 78–88%).

### Stress scenarios

| Scenario | Severity | Margin shock | Collateral shock | Funding cost shock |
|---|---|---|---|---|
| Base Case | Base | $0 | $0 | 0 bp |
| CPI Rates Shock | Watch | $2.2bn | $1.4bn | +18 bp |
| Credit Spread Gap | Stress | $4.8bn | $3.1bn | +42 bp |
| Prime Client Draw | Stress | $6.0bn | $2.3bn | +35 bp |
| Repo Market Squeeze | Severe | $7.5bn | $4.5bn | +78 bp |

## Outputs and how to read them

- **Closing liquidity versus buffer** (red when below) shows where the ladder is tight.
- **Stress buffer** is the tightest point across horizons; scenarios start from it.
- **Survival** comes in two flavors: the KPI (liquid assets ÷ today's outflows) and the scenario column (post-shock buffer ÷ stressed burn). They answer different questions.
- **Early-warning statuses** are live only for the two FRED signals.

## Validation

No model to validate. The data module is deterministic.

## Limitations

- All ladder, facility and scenario numbers are simulated.
- No forecast model, uncertainty bands, breach probabilities or anomaly detection.
- Scenario shocks are fixed amounts, not derived from market moves or positions.
- Signals labeled Yahoo are static values.
- Facility reliability scores are random.

## Status and governance

- **Spec:** Spec014, Liquidity Forecasting, Shortfall and Anomaly Oversight. Drafted; all owner questions resolved on 2026-10-18; awaiting approval of the full spec, plan and tasks.
- **What it will build:** cash forecasts per entity, currency and account with conformalized P10/P50/P90 bands gated against a seasonal-naive baseline; breach probability, first breach, P90 shortfall and survival horizon; an anomaly ensemble with human review; and a lever optimizer for the P90 shortfall. Decided alert thresholds: WATCH at ≥ 10% breach probability, STRESS at ≥ 25%, SEVERE at ≥ 50% (or a near breach beyond deliverable lever capacity).
- **Placement:** the new view will live at `/cash-optimizer/liquidity`. Until it ships `/liquidity` stays as it is; the shipping change redirects `/liquidity`, removes this nav entry and deletes the seeded data (LIQ-007). Its model service (`liquidity_api`) has port 8016 reserved.
- **Design papers:** `docs/whitepapers/liquidity_forecast_shortfall.md`, `docs/whitepapers/cash_anomaly_detection.md`.

## References

- Help & FAQ: [LIQ help](/guides/LIQ/help)
- Spec: `docs/specs/spec014/SPEC.md`, `docs/specs/spec014/TASKS.md`
- Code: `src/app/liquidity/page.tsx`, `src/data/liquidity.ts`
- Related: [CASH](/guides/CASH/whitepaper), [SXU](/guides/SXU/whitepaper), [MMKT](/guides/MMKT/whitepaper)
