# Spec016 implementation evidence

2026-10-18. The local collateral preview binds InventoryBallast's standalone
`projects/collateral_optimizer` distribution at merged commit
`eb74850a0f972ca9e1f40558ecd7909d3e76e6b3` (upstream PR #36), version
`0.1.0`. The deterministic wheel SHA-256 is
`84a163c2137a367d06af506b5e6b6c970126c4ade36e103031aee0159b7fbc5e`.
The manifest records source files, wheel, lock, package and native schema
identity. The root InventoryBallast optimizer remains independently pinned.
No runtime branch checkout or Git installation occurs.

## Local checks

| Check | Result |
| --- | --- |
| Reviewed-source wheel build | Pass; rebuilt digest matches manifest. Source bytes came from the reviewed GitHub commit export; local export lacks `.git`, so clean-checkout `--require-git` is delegated to CI. |
| Standalone upstream native suite | 8 tests passed. |
| Adapter contract and integration suite | 8 tests passed: exact pin drift, schema/fixture parity, direct/service solve parity, five scenarios, seven invalid snapshot cases, allocation/cost/flag tamper rejection, unverified target stripping, auth/size/production gates. |
| Python compile | Pass for adapter, tests, wheel builder and update preparer. |
| Local SIM export runtime contract | Pass under Node 24 for the pinned verified and infeasible Python fixtures: full run preserved, lineage matched, and a forged recommendation flag rejected. |
| Terminal typecheck, Vitest and Playwright | Added to the pinned integration workflow; not run locally because the workspace has no `node_modules` and its npm proxy was unreachable. The first PR CI run failed before any job step executed; no job log was available through GitHub. Terminal checks remain unverified. |

For the pinned synthetic baseline, direct model and service return a verified
155,625.454892 USD target cost and 275,582.028182 USD savings over the
model's 30-day horizon. Margin spike has a verified target but no savings
because the incumbent is undercovered. Liquidity scarcity reports the reserve
binding row. Cutoff and fees returns a verified target; infeasible stress
returns no target allocation or cost. These figures are synthetic SIM results,
not operational recommendations.

## Remaining gates

The service, proxy and UI expose local SIM and strict validated JSON uploads
only. They do not persist runs, authorize a governed book, reserve assets,
execute movements, or export an operational recommendation. Spec015 still
needs decisions and implementation for stable run identity, immutable result
storage, authorization, idempotency and append-only audit. The source and
policy owners must supply governed positions, calls, agreements, FX, shared
availability/reservation, and operational approval before production book mode
can be considered. These external inputs have no approved interface here.

COLL and OPT now let a user export the current local preview as JSON. The
export repeats the complete service snapshot/result envelope without
recalculating economics, and adds an explicit local-preview notice, cost/horizon
units, and a provenance block with source mode, timestamps, hashes, run and
correlation IDs, exact model pin, artifact digest, schema versions and adapter
verification state. The same path exports an infeasible result with no target
or cost. Contract and real-service browser assertions cover the payload; the
browser assertions remain pending because CI still fails before job steps.

The CI workflows need the repository secret `INVENTORYBALLAST_READ_TOKEN` to
read the private upstream commit. The daily updater opens a draft review PR
for changed merged-main package source, including failed check evidence; no
newer upstream release was available to exercise a real update PR. A rejected
pin remains on the old manifest; restoring a drifted attestation to the exact
pin restores READY in the identity test. Historical rollback lineage depends
on spec015's durable registry.

The first PR run of both general CI and pinned integration reported failure
within seconds. GitHub returned zero job steps and no downloadable job logs
for those runs, so the cause cannot yet be assigned to code, credentials, or
runner configuration. The Vercel status also reported failure without a build
log in the available connection. These checks must be rerun or their platform
logs inspected before merge.
