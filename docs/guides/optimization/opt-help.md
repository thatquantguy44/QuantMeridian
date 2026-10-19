# Optimization Center (OPT): help and FAQ

## Quick start

1. Start everything with `npm run dev:all` and open [the Optimization Center](/optimization).
2. Read the **Connections** panel. MMKT, COLL and IBAL should all show `SERVICE READY`.
3. Press **Solve baseline preview** in the **Collateral model preview** panel. A verified run appears with its target cost.
4. Click any card in **Optimization models** to open that module, or use the **Guides** row to open its help.

## Screen guide

### Header

| Element | What it means |
|---|---|
| `OPT` / Optimization Center | Module code and name. Type `OPT` in the command bar to jump here. |
| **Guide** button | Opens this help and the white paper in a side drawer. |
| `NO OPERATIONAL RUN REGISTRY` tag | There is no durable, audited store of runs yet. Nothing on this page is an operational record. |

### Notice line

"Model services have separate health. No generated runs, duals, trades, or savings enter operational totals." This is a standing statement of policy: OPT never sums results across models and never shows generated numbers as if they were real.

### Optimization models panel (`MODELS`)

| Element | What it is |
|---|---|
| Model cards | One card per optimization module, in sidebar order: COLL, IBAL, CASH, MMKT, SXU, MMFO, REINV, LIQ. Click a card to open the module. |
| Card title | Module code and name. |
| Card description | One line on what the module does. |
| `SERVICE READY` / `SERVICE …` tag | Shown only for modules with a live model service (COLL, IBAL, MMKT). Same value as the Connections panel. |
| **Guides** row | Links to all guides and to each module's Help & FAQ. |

### Connections panel (`CONN`)

| Element | What it is |
|---|---|
| **Refresh status** | Re-probes every service now. |
| Row title | Service family (`MMKT`, `COLL`, `IBAL`) and name. |
| `SERVICE <state>` tag | Live health: `READY`, `UNCONFIGURED`, `INCOMPATIBLE` or `UNAVAILABLE`. Green only for `READY`. |
| `BINDING <state>` tag | Approval state. `UNCONFIGURED` (amber) for MMKT and COLL means no approved Spec015 binding. `ENGINE_PINNED` (green) for IBAL means it is gated by its own pinned engine check. |
| Detail line | The service's own explanation, for example "Reviewed model artifact matches the exact pin." |
| Model line | The model's declared state, for example `continuous_lp_relaxation` (MMKT) or `SIM_ONLY` (COLL). |
| Footer line | The registry's approval note: "No Spec015 model bindings are registered in the optimization registry yet." |

### Collateral model preview panel (`COLL`)

| Element | What it is |
|---|---|
| `SIM` badge | The book is the upstream model's own synthetic book. |
| **Solve baseline preview** | Solves the upstream synthetic book (56 lots, 8 calls), scenario `baseline`. Disabled unless COLL is `SERVICE READY`. |
| **Open collateral workspace** | Opens [Collateral Management](/collateral). |
| Run line | Run id, lifecycle status, source mode (`SIM`), horizon in days, currency (USD). |
| **Target cost** | Verified cost of the optimized posting over the horizon, USD. `Unavailable` if not verified. |
| **Modeled savings** | Saving versus the current posting, USD. `Unavailable` when the current posting is invalid or there is no verified target. |
| **Coverage** | How many margin calls the verified answer covers, or `No target`. |
| Model line | Model package version and full commit, adapter version, and the input hash. |
| **Export preview JSON** | Downloads the full run, snapshot, lineage and verifier result as a local file. |

### Operational runs and audit panel (`RUNS`)

A placeholder. It will list runs, schedules and audit events once Spec015's registry exists.

## Assumptions and defaults

| Item | Value |
|---|---|
| Probe timeout | 2.5 seconds per service |
| MMKT default URL | `http://127.0.0.1:8014` (override with `MONEY_MARKET_API_URL`) |
| COLL URL | `COLLATERAL_OPTIMIZER_API_URL` (no default) |
| IBAL default URL | `http://127.0.0.1:8013` (override with `INVENTORY_OPTIMIZER_API_URL`) |
| Preview scenario | Upstream `baseline`, horizon 30 days, USD |
| Binding registry | Not built; MMKT and COLL fixed at `UNCONFIGURED` |

## FAQ

### Why does a model say `SERVICE READY` but `BINDING UNCONFIGURED`?
The service works, but no owner has approved this model and version for operational use through the Optimization Center. You can demonstrate it; you should not treat its output as a recommendation.

### Why is IBAL's binding `ENGINE_PINNED` instead of `UNCONFIGURED`?
IBAL is gated by its own check: the service hashes the installed InventoryBallast engine and refuses to report ready unless it matches the reviewed commit. It is not part of the Spec015 binding registry.

### Why doesn't OPT show one total saving across all models?
Each model optimizes something different (lending value, collateral cost, money-market yield). Adding them would double count and has no agreed basis.

### The preview shows "Modeled savings: Unavailable". Is something broken?
No. Savings are only shown against a valid current posting with a verified target. On the upstream baseline book you should see a saving; on a stressed book the current posting may be invalid.

### Is the exported JSON an audit record?
No. It is a local preview file. There is no audited run store yet.

### Why are CASH, SXU, MMFO, REINV and LIQ cards missing a service tag?
They have no separate model service connected to OPT. Each module's guide explains where its numbers come from.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Every row says "Connection status is unavailable. Retry." | The terminal's API is not running. Start it with `npm run dev` or `npm run dev:all`. |
| `SERVICE UNAVAILABLE` | That service is not running or is on another port. Start it (see `docs/services.md`). |
| `SERVICE UNCONFIGURED` for MMKT | The service started without `MONEY_MARKET_MODEL_BINDING` (use `local-mmkt-execution-v2`), or the terminal lacks `MONEY_MARKET_API_TOKEN`. |
| `SERVICE UNCONFIGURED` for IBAL | The terminal lacks `INVENTORY_OPTIMIZER_API_TOKEN`. Add it to `.env.local` and restart the terminal. |
| `SERVICE INCOMPATIBLE` for IBAL | The installed engine is not the pinned commit. Start IBAL against the pinned engine (`scripts/dev-all.sh` does this). |
| `SERVICE INCOMPATIBLE` for COLL | The collateral wheel, lock or schema drifted from `binding-manifest.json`. Rebuild with `scripts/build-collateral-wheel.py`. |
| **Solve baseline preview** is greyed out | COLL is not `SERVICE READY`. |
| Changed `.env.local` but nothing changed | The terminal reads environment files only at startup. Restart it. |

## Glossary

| Term | Meaning |
|---|---|
| Binding | An owner-approved connection between the terminal and one model at one exact version. |
| Service health | Whether a model service is reachable and reports its model ready, right now. |
| Pin | The exact reviewed commit of a model. A service refuses to report ready on any other commit. |
| SIM | Synthetic data deliberately labeled as such. Never a real book. |
| Verified | The model's independent verifier re-checked the answer and it passed. |
| Target cost | The cost of the optimized collateral posting over the modeled horizon. |
| Run registry | A durable, audited store of every run (not built yet). |

See also the [OPT white paper](/guides/OPT/whitepaper).
