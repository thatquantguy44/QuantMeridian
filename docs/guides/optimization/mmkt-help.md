# Money Market Optimizer (MMKT): help and FAQ

## Quick start

1. Open [Money Market Optimizer](/money-market). The header should read `MODEL READY`.
2. Pick a rate source in **Rate source**, for example the SIM base curve. (Selecting a scenario card also selects its rate set.)
3. Press **Run optimizer** in the **Policy** panel. Results appear below with a verified LP allocation.
4. Change something: switch **Cash forecast case** to *p10 downside*, raise a floor, or disable an instrument, then run again.
5. Press **Run all scenarios** at the bottom to compare all five scenarios side by side.

## Screen guide

### Header

| Element | Meaning |
|---|---|
| `MMKT` / Money Market Optimizer | Module code and name |
| **Guide** | Opens this help and the white paper |
| `SIM` / `DB` badge | Which rate source is loaded |
| `MODEL READY` / `CHECKING` / health | Service readiness. `MODEL READY` needs a healthy service and a binding. |

### LP relaxation notice

The amber `LP RELAXATION` note is always shown: allocations come from a verified continuous LP; tickets, lots, counts and cutoffs are not enforced, so results are not execution-ready.

### Model service panel (`ENGINE`)

| Field | Meaning |
|---|---|
| **Recheck** | Re-reads service status |
| Health | `READY`, `UNCONFIGURED`, `UNAVAILABLE` or `INCOMPATIBLE` |
| Binding | The model binding id (`local-mmkt-lp-v1`) or "none" |
| Model | Model family, `continuous lp relaxation` |
| Contract | API schema version |
| Terminal token | Whether the terminal has `MONEY_MARKET_API_TOKEN` |
| Setup steps | Shown when not ready: start the service, enable the binding, give the terminal the token, confirm authentication. Completed steps get a tick; open steps show the command. |

### Rate source panel (`RATES`)

| Element | Meaning |
|---|---|
| **Gold · MacroMedallion** | Real rates from `gold.mmkt_rate_snapshot`. Fails closed today with a message explaining it is not wired upstream. |
| **SIM base curve · 2026-10-16** | Named synthetic set with one stale and one unavailable row |
| **SIM 25bp cut priced · 2026-10-16** | The base set with a cut priced in |
| Subtitle | Snapshot as-of date and hash |
| Rate table | Instrument and label, quoted %, basis, normalized `mm yield %`, observation date (with staleness), status. Priced rows show `SIM` or `DB`; unpriced rows show `ERR · stale` or `ERR · unavailable`. |
| Normalized curve | Bar chart of priced yields |

Nothing loads until you choose a source. SIM is never selected silently and never substitutes for Gold.

### Scenario cards

Five cards: Base case, Rate cut priced, Prime fund fee & gate, Cash forecast miss, Counterparty downgrade. Each shows its kicker, its rate set (`SIM base` or `SIM cut`) and its story. Clicking one resets the inputs, applies the scenario, selects its rate set and runs it. Editing any input afterwards switches the title to "Custom inputs".

### Instrument universe panel (`CANDIDATES`)

| Column | Meaning |
|---|---|
| Use | Include or exclude the candidate. Disabled (and unchecked) when its rate is not priced. |
| Candidate | Name with a family color (blue government, green secured repo, gold bank, pink credit). "×9 · rolls daily" for overnight RRP and repo. |
| Rating · cpty | Rating and counterparty or issuer |
| Settle → mature | Dates, or "overnight" |
| Max $mm | Cap on outstanding holdings; blank means unlimited |
| Cost bp | Explicit cost charged once at purchase |
| Rate | Normalized yield, "awaiting rates", or the reason it is excluded |

**Reset inputs** restores the illustrative book.

Below it, the **forecast table** shows each account's known net flows per day ($mm, outflows in red), its opening cash and its p10/p50/p90 residual band.

### Policy panel (`POLICY`)

| Control | Meaning | Default |
|---|---|---|
| **Cash forecast case** | p10 downside, p50 base, p90 upside | p50 |
| Liquidity floors | Minimum cash per entity, daily and on Fridays ($mm, step 25) | QMS 400 / 550, QMP 120 / 160 |
| **Max WAM (days)** | Weighted-average days to maturity cap; blank for none | 60 |
| **Max WAL (days)** | Same proxy for weighted-average life | 90 |
| Exposure limits | Portfolio minimum rating (AAA to BBB); Fed RRP cap ($mm); DEALER-A share (%); ACME-FIN cap ($mm); PMMF-INST share (%) | A−, 900, 35%, 250, 25% |
| **Baseline for comparison** | Government MMF sweep (default), Uninvested cash, Overnight roll, Current allocation (needs a positions feed) | Government MMF sweep |
| **Run optimizer** | Solves the current inputs, then the baseline | |
| Status text | "Service not ready", "Select a rate source", "Loading rates…" or the chosen source | |

Changing the baseline after a run re-solves only the baseline.

### Result header and KPIs

The heading shows the scenario or "Custom inputs", the rate source and forecast case, and the run id and request hash.

| KPI | Meaning |
|---|---|
| Modeled net return | Return over the horizon, $k |
| Annualized on invested | Return ÷ average invested, annualized; average invested underneath |
| Uplift vs baseline | Extra return over the baseline, $k and bp; "baseline not computed" or "running baseline" otherwise |
| Held past horizon | Holdings maturing after the horizon, $mm |
| Min floor headroom | Smallest cash above a floor, $mm; number of entity-days exactly at a floor underneath (red if negative) |
| Verification | "Passed" with the worst row violation |

### Result panels

| Panel | Contents |
|---|---|
| **Balance composition by day** (`HOLDINGS`) | Stacked holdings by family plus uninvested cash, $mm |
| **Liquidity floors** (`FLOORS`) | One small chart per entity: cash against its floor |
| **LP allocation · continuous relaxation** (`ALLOC`) | Purchase date, candidate, account, maturity, amount ($mm), mm yield %, net return %. **CSV** exports every line. Not an execution blotter. |
| **Maturity ladder** (`LADDER`) | Holdings at horizon end by bucket: ≤7d, 8–30d, 31–90d, 91–180d, >180d |
| **Verification** (`CERT`) | Variable bounds, constraint rows, objective reconstruction: tick if within 1e-6, with the worst value |
| **Lineage** (`RUN`) | Run id, request hash, rate snapshot hash, rate source, rates as of, forecast case, model, solver and iterations, received time |
| **Baseline comparison** (`BASE`) | Uplift; optimized versus baseline return bars; mix of gross purchases by family ("all cash" for the cash baseline); both request hashes |
| **Model assumptions** (`ASSUME`) | The ten assumptions the service returned with this run |

### Scenario comparison panel (`CMP`)

**Run all scenarios** solves each scenario (and its baseline) as separate verified runs.

| Column | Meaning |
|---|---|
| Scenario | Title, rate set and request hash; the active scenario is highlighted |
| Modeled net return | $k over the horizon, as a bar |
| Avg invested | $mm, as a bar |
| Annualized | Return on invested |
| Uplift vs baseline | $k and bp, or "—" (hover for the reason) |
| Mix | Gross purchases by family |

A failed scenario shows its error instead.

## Assumptions and defaults

| Item | Value |
|---|---|
| Horizon | 2026-10-19 to 2026-10-30, 10 business days |
| Units | USD $mm in inputs; return in $k |
| Yield basis | Simple ACT/365 money-market yield |
| Verification tolerance | 1e-7 in the service; the page ticks values within 1e-6 |
| LP size limit | 50,000 variables |
| Defaults | See the policy table above; the full book is in the [white paper](/guides/MMKT/whitepaper) |

## FAQ

### Why are CP-3M-BETA and TB-52W-1014 greyed out?
Their rates are unusable: the 3-month nonfinancial CP series is unavailable and the 52-week bill is 6 days stale. MMKT never prices on bad data, so they are excluded. This is deliberate in the SIM base set.

### Why can't I use Gold rates?
`gold.mmkt_rate_snapshot` is not wired upstream yet (issue #149). Selecting Gold fails closed with a message; use a named SIM set.

### Why is the money not all in the highest-yielding instrument?
Floors, the WAM limit and exposure caps bind. Check **Min floor headroom** and the floor charts: on Friday 10-23 and month-end 10-30 the model must hold cash, and term paper would break the WAM limit or leave too little cash.

### Why does "Counterparty downgrade" change so much?
DEALER-A (all tri-party repo) and ACME-FIN (1-month CP) fall below the A− floor, so the model cannot buy them at all. Cash moves to Fed RRP and bills.

### Is the p10 case a worst case?
It is the 10th-percentile residual applied every day, which is conservative. The model plans against that one path; it does not optimize across cases.

### Why is the result "not execution-ready"?
The LP ignores minimum tickets, lots, ticket counts and cutoffs, so some purchases may be smaller than tradable or arrive after a cutoff. A mixed-integer slice (MM-006) will enforce them.

### Which baseline should I use?
The government MMF sweep is the honest comparison: it is what a treasury would do without a model. Uninvested cash makes the model look better than it is.

### Why does "Current allocation" say not computed?
It needs a feed of actual holdings, which is not connected.

### Can I save my inputs?
Not yet. Inputs reset on reload; export results with **CSV**.

## Troubleshooting

| Message | Meaning and fix |
|---|---|
| "The terminal has no service token" (`MMKT_TOKEN_MISSING`) | Set `MONEY_MARKET_API_TOKEN` in `.env.local` (same value as the service) and restart the terminal. |
| "The MMKT service is not reachable" (`MMKT_SERVICE_UNAVAILABLE`) | Start `services/money_market_api` on port 8014. |
| "The service has no model binding" (`MODEL_NOT_CONFIGURED`) | Start the service with `MONEY_MARKET_MODEL_BINDING=local-mmkt-lp-v1`. |
| "No feasible allocation" (`INFEASIBLE`) | Floors cannot be met with this forecast and universe. Lower a floor or use a milder forecast case. |
| "A candidate has no eligible rate" (`RATE_CANDIDATES_INELIGIBLE`) | A candidate references a rate that is not `ok`. Disable it, or choose a SIM set (Gold always fails this today). |
| `INSTRUMENT_CANDIDATES_INVALID` | No candidate is enabled and priced. Enable at least one. |
| "SIM set not registered" (`SIM_SET_UNAVAILABLE`) | Choose a listed SIM set. |
| "The model rejected an input" (`MODEL_INPUT_UNSUPPORTED`) | For example an unrecognized rating notation or nonpositive proceeds. The message says which. |
| `REQUEST_CONTRACT_INVALID` | The request failed validation; the issue list names the fields. |
| "The verifier rejected the solver output" (`VERIFICATION_FAILED`) | No allocation is shown. Report the request hash. |
| `MMKT_PRODUCTION_DISABLED` / `MMKT_TRUSTED_BOUNDARY_MISSING` | Production use is blocked by design. |
| **Run optimizer** greyed out | Service not ready, no rate source chosen, or rates still loading. |

## Glossary

| Term | Meaning |
|---|---|
| mm yield | Simple annualized money-market yield on ACT/365, used to compare all instruments |
| Discount basis | Quotation used for bills and CP: the discount from face value, annualized on 360 days |
| Fed RRP | The Federal Reserve's overnight reverse repo facility |
| Tri-party repo | Repo where a custodian agent holds the collateral |
| Government / prime MMF | Money-market funds investing in government paper / also in bank and corporate paper |
| WAM / WAL | Weighted-average maturity / life of holdings, in days |
| Liquidity floor | Minimum cash an entity must hold on a day |
| p10 / p50 / p90 | Downside / base / upside forecast quantiles |
| Baseline | A simple alternative strategy solved for comparison |
| Uplift | Optimized return minus baseline return |
| LP relaxation | The continuous version of a problem that ignores whole-ticket rules |

See also the [MMKT white paper](/guides/MMKT/whitepaper).
