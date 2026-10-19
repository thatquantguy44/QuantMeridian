# Optimization Center (OPT): white paper and business guide

> **Status:** live in local development. Model services run locally on synthetic or SIM data. There is no operational run registry yet, so nothing in OPT is a recommendation, a booked trade or an audited run.

## Executive summary

The Optimization Center is the front door to QuantMeridian's optimization suite. It answers three questions before anyone opens a model:

1. **Which optimizers exist, and where are they?** A launcher lists every optimization module in the same order as the sidebar.
2. **Which model services are reachable and trustworthy right now?** A connections panel shows each model service's live health and, separately, whether its model binding has been approved.
3. **Does a real model answer come back verified?** A one-click collateral preview solves the pinned collateral model on its synthetic book and shows the verified result with full lineage.

It deliberately does **not** total savings, yields or trades across models. Each optimizer has a different objective, and adding them together without an agreed common objective would double count.

## Business problem

A financing and treasury desk runs several optimization problems that touch the same balance sheet: securities-lending inventory allocation (IBAL), collateral posting (COLL), money-market cash deployment (MMKT), funding sources-and-uses matching (SXU), and fund allocation (MMFO). In practice these models are built by different teams, run on different services, and fail independently.

Without a common operating surface, three things go wrong:

- People cannot tell a **demonstration number** from a **verified model output**.
- A model that is **reachable** is mistaken for a model that is **approved** to make recommendations.
- Results from different models are **added together** even though they optimize different things.

OPT exists to keep those distinctions visible.

## How it works

### Two independent states per model

Every connected model has two separate states, and OPT never merges them:

| State | Question it answers | Where it comes from |
|---|---|---|
| **Service health** | Can the terminal reach the model service, and does the service say its model is ready? | A live probe of each service's `/health` endpoint, made server-side by the terminal. |
| **Binding status** | Has an owner approved this model, at this exact version, to be used through the Optimization Center? | The Spec015 model-binding registry. Today no bindings are registered, so MMKT and COLL show `UNCONFIGURED`. IBAL shows `ENGINE_PINNED` because it is gated by its own pinned engine check instead. |

A model can be `SERVICE READY` and `BINDING UNCONFIGURED` at the same time. That is the normal state today and it is not a fault: the service works, but no one has approved it for operational use.

### Health classification

The terminal classifies each service into one of four health states:

| Health | Meaning |
|---|---|
| `READY` | The service answered and reports its model is ready. |
| `UNCONFIGURED` | The service is reachable but has no enabled model (MMKT without its model binding variable), or the terminal is missing the service's token or production permission. |
| `INCOMPATIBLE` | The service answered, but its answer does not match the expected contract, or its pinned model does not match the reviewed version (for example an IBAL engine on the wrong commit). |
| `UNAVAILABLE` | The service could not be reached in time (2.5-second probe timeout) or returned an error. |

### The collateral preview

The preview sends one request to the collateral service: solve the upstream model's own synthetic book, scenario `baseline`. The service solves it with the pinned InventoryBallast collateral optimizer, then re-runs the model's independent verifier on the answer. OPT shows the target cost, modeled savings and coverage only if that verification passes.

### The session run log

The terminal's own server routes are the only path from the browser to a model service, so they record each model run they forward: IBAL runs, stress batches and showcase runs, MMKT runs and COLL runs. Each entry keeps the run id, the service's own status or error code, its verification verdict, the solve time it reports, the round trip measured by the terminal, the source label and the input hash. Nothing else from the request or result is kept. The log holds the newest 200 entries in server memory and is served at `GET /api/optimization/runs`. It satisfies "OPT lists the runs with their real status and timing" for a local demonstration; it is not the durable, audited registry Spec015 describes.

### The launcher

The model list is built from the same navigation registry as the sidebar, so a module switched off by configuration disappears from both places. Where a service has a live connection row, its card carries the same health tag as the connections panel.

## Data and provenance

| Item | Source | Label shown |
|---|---|---|
| Model list | Navigation registry (`src/lib/nav.ts`) | none (navigation only) |
| Health and binding | `/api/optimization/connections`, which probes MMKT, COLL and IBAL server-side | `SERVICE …`, `BINDING …` |
| Collateral preview | Pinned InventoryBallast collateral package, upstream synthetic book of 56 lots and 8 margin calls | `SIM` |

Service URLs and tokens stay on the terminal's server. The browser only calls same-origin `/api/...` routes.

## Assumptions

| Assumption | Detail |
|---|---|
| Services are local | Each model service runs on the local machine (MMKT `127.0.0.1:8014`, COLL `:8017`, IBAL `:8013`). Production access is blocked unless an operator sets each module's production gate. |
| Probe timeout | 2.5 seconds per service. A slower service is reported `UNAVAILABLE`. |
| No binding registry | Spec015's registry is not built, so binding status is fixed at `UNCONFIGURED` for MMKT and COLL. |
| Preview book | The collateral preview always uses the upstream synthetic book and the `baseline` scenario. It never uses a generated book or an uploaded snapshot. |
| No cross-model totals | OPT never adds results from different models. |

## Outputs and how to read them

- **SERVICE READY + BINDING UNCONFIGURED:** you can demonstrate the model, but it is not approved for operational use.
- **SERVICE INCOMPATIBLE:** do not trust any result. The model or its contract has drifted from the reviewed version.
- **Target cost:** the verified collateral cost over the modeled horizon, in USD.
- **Modeled savings:** target cost compared with the book's current posting. Shown as `Unavailable` when the current posting is itself invalid or there is no verified target.
- **Coverage:** the number of margin calls the verified answer covers.
- **Session run log:** a red status is a service refusal or failure with its own code; `—` under Verified means the service returned no verdict, never that verification passed.

## Validation

- The connections route is covered by tests of the IBAL mapping (ready, incompatible engine, missing token, unreachable).
- The collateral preview passes through the collateral service's adapter, which re-runs the model's own verifier and refuses to return a target or savings it cannot verify.
- Browser tests check that OPT shows only service data and never a fabricated result.

## Limitations

- The session run log is in memory, capped at 200 entries and lost on restart. Durable run history, schedules, queue, comparisons and audit trail are Spec015 deliverables.
- MMKT and COLL report no solve time, so only the measured round trip is shown for them.
- Health is a point-in-time probe. Press **Refresh status** to re-check.
- The preview's exported JSON is a local file, not an audited record.

## Status and governance

- **Spec:** Spec015 (draft). Collateral binding: Spec016 (draft). Both require owner approval before any binding is activated.
- **Open decisions:** the run registry's storage and access design, scheduling, and the Money Market model repository.
- **What would make it operational:** an approved binding per model, a durable run registry with append-only audit, and authorization.

## References

- Help & FAQ: [OPT help](/guides/OPT/help)
- Related guides: [COLL](/guides/COLL/whitepaper), [IBAL](/guides/IBAL/whitepaper), [MMKT](/guides/MMKT/whitepaper)
- Specs: `docs/specs/spec015/SPEC.md`, `docs/specs/spec016/SPEC.md`
- Code: `src/app/optimization/page.tsx`, `src/app/api/optimization/connections/route.ts`, `src/lib/server/ibalConnection.ts`
- Running the services: `docs/services.md`, `scripts/README.md`
