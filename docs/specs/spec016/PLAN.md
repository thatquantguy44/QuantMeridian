# Plan: InventoryBallast Collateral Optimizer binding

- **Spec:** [SPEC.md](SPEC.md)
- **Status:** Proposed implementation design; no model binding is active
- **Last updated:** 2026-10-18

## Architecture and ownership

```text
InventoryBallast main, projects/collateral_optimizer, reviewed SHA
       -> build-time wheel + lock + artifact digest
       -> services/collateral_optimizer_api (Python, proposed local port 8017)
       -> authenticated same-origin /api/optimization/* or /api/collateral-optimizer/*
       -> COLL page, with spec015 run registry and OPT history when available
```

Keep the collateral service separate from `services/inventory_optimizer_api` and
`services/money_market_api`. It imports the nested `collateral_optimizer` distribution and never
imports `inventory_optimizer` or calls another model service. Model math and domain validation
remain in InventoryBallast. QuantMeridian supplies ingress provenance, adapter checks, identity,
authorization, persistence and presentation. The service has no database or Git dependency at
runtime; spec015 owns persistent runs, schedules and audit events.

## Immutable package binding

Proposed first dependency, for a build environment authorized to read the private repository:

```text
collateral-optimizer @ git+https://github.com/thatquantguy44/InventoryBallast.git@eb74850a0f972ca9e1f40558ecd7909d3e76e6b3#subdirectory=projects/collateral_optimizer
```

The candidate SHA is the merged-main commit containing upstream PR #36 and package `0.1.0`.
Reviewers approve it only after the build and contract fixtures pass. Build a wheel at that exact
SHA, resolve dependencies into a lock, and record the wheel digest. Private-repository credentials
exist only during build and are absent from images, browser bundles, logs and run payloads.
An approved local checkout can be used for development with a recorded commit and packaged-file
digest; a dirty tree is never a production binding. A manifest under
`services/collateral_optimizer_api/` records the canonical repository/subdirectory, full commit,
distribution/version, native `1.0` snapshot/result schemas, adapter version, wheel/dependency
digests and supported features. Digests are populated from the actual build, not hard-coded in
this spec. Startup checks the installed artifact and its trusted build provenance against this
manifest before advertising `READY`. The existing IBAL pin is independent.

### Update and rollback protocol

1. A scheduled read-only checker inspects new InventoryBallast releases or merged `main` commits
   that change `projects/collateral_optimizer/`. It verifies the commit is on `main` and that the
   package version was advanced for a release. It reports changes; it does not deploy them.
2. Automation opens a QuantMeridian pin-update PR with upstream PR/commit, release notes,
   old/new full SHA and version, generated wheel and dependency digests, native schema/capability
   diff, migration notes and golden-fixture outcomes. A missing version bump or breaking schema
   change blocks automatic promotion and requests human review.
3. CI builds both old and candidate wheels at exact SHAs and runs native model tests, adapter
   conformance, local-versus-pinned parity, tamper/infeasibility cases, and UI contract tests.
   The owner reviews financial behavior and source/policy implications before merging the pin PR.
4. Staging checks service startup identity and runs the five SIM scenarios. Promotion activates
   only that built artifact/manifest pair. Rollback selects the previous pair; historical runs
   retain their original SHA and result payload. Runtime never follows `main`, a tag, or a
   browser-supplied URL.

No scheduled checker or update PR is implemented merely by writing this plan. Build access and
the release-detection mechanism are implementation tasks.

## Native request and response contract

The service validates a complete native `Snapshot` through
`collateral_optimizer.domain.Snapshot.model_validate`; it does not translate the existing eight
display aggregates into lots or infer legal agreements. The first connected mode gets its book
from the pinned package's `build_demo_book()` and named `apply_demo_scenario()`. A JSON upload
path may accept the same strict schema, subject to size and access limits. The platform sets
`source_mode=SIM` or `USER_UPLOAD` from the ingress path; it retains the snapshot's declared
`source` as a distinct native field. A user-controlled source string alone cannot declare a
governed database source.

| Native field / result | Service and UI treatment |
| --- | --- |
| `as_of`, `max_input_age_minutes`, record `observed_at` | Preserve timezone-aware timestamps and native freshness validation; show age and errors. |
| `assets[].allocatable_value`, `current_pledges[].market_value`, `calls[].required_value` | Amounts are in each record's native currency. Preserve asset and call IDs; never reuse `available`/`currentAlloc` mock aggregates. |
| `fx[].usd_per_unit`, agreement `classes[].haircut` | FX is USD per native unit; haircut is a decimal fraction. Show the quote and rule used; do not substitute display percentages. |
| `minimum_liquidity_reserve_usd`, `liquidity_credit` | Supplied local policy and remaining liquidity in USD, explicitly not LCR/NSFR. |
| `horizon_days`, `annual_carry_bps`, movement bps/fees | `cost` and `savings_usd` are modeled USD over that horizon. Compare only like horizons. |
| `input_hash`, `parent_hash`, `scenario_id`, `engine_version` | Preserve native lineage. Store platform raw-payload hash separately if canonicalization differs. |
| `allocations`, `movements`, `coverage`, `cost`, `diagnostics` | Return source IDs and components without client recomputation; render missing fields as unavailable. |

The adapter invokes `optimize(snapshot)`, then for any claimed optimum constructs the target
asset/call map from the returned allocations and calls `verify.assess(snapshot, target)` afresh.
It reconciles coverage, residual liquidity and every cost component against the native response,
including releases and fixed fees, within a declared absolute/relative tolerance. It also
checks the native hash, `status=optimal`, `verified=true`, schema versions and source IDs. A
native success flag without this second assessment is insufficient. The model verifier reads
domain objects independently of its compiled LP/MIP rows; the adapter does not implement a
second optimizer in TypeScript. Tamper fixtures must show the adapter check can fail even when a
response falsely claims `verified=true`.

The service retains native status and a separate platform lifecycle status: verified optimum ->
`SUCCEEDED_VERIFIED`; native infeasible -> `INFEASIBLE`; unverified candidate ->
`SUCCEEDED_UNVERIFIED` with no recommendation; validation/solver/transport failure -> typed
failure. Do not infer a time-limit result from a free-text message. LP duals are displayed only
for a native LP with named units; MIP has no duals. `savings_usd=null` stays null when the
incumbent is infeasible.

`/v1/capabilities` advertises only the actual v0.1.0 features: post-trade allocation,
LP/MIP, native independent source-domain check, named SIM scenarios and LP-only duals.
Pre-trade IM, compression, bank-level LCR/NSFR, stochastic planning, execution and shared
reservation are false/unavailable. `/health` separates reachable service, pinned artifact
identity and approved binding state. `/v1/validate` returns native located errors plus source
mode. `/v1/runs` returns a typed result envelope with the full native result and verifier
assessment; the terminal route checks it again before persistence or display.

## COLL and OPT presentation

Use the model's one book for all connected demo cards. Present calls with required and
haircut-adjusted covered USD, lots with native market values and target pledges, movements,
cost components, reserve, binding constraints, and source/identity badges. The current-margin
view may use the model assessor's incumbent coverage and violations; it must not combine native
rows with `getMarginBook()`'s unrelated random counterparties. A newly connected result view
uses no `getCollateralSummary()` 0.82 factor, fabricated optimized allocations, random shadow
prices or client `rerun()` uplift. If the model is absent, show the true unconfigured/unavailable
state; any legacy mock layout stays clearly separated as SIM and excluded from OPT run totals.

Offer the named sequence baseline -> margin spike -> liquidity scarcity -> cutoff/fees ->
infeasible stress with plain explanations. A user edit creates a new validated snapshot and
actual solve, not a scaled metric. Compare runs only when input book, model SHA, contract version,
cost currency and horizon match; otherwise show the changed fields and a non-comparable warning.
An infeasible case shows call shortfall as a diagnostic, not a proposed allocation. The local
SIM flow can be demonstrated before the spec015 durable registry is ready, but it is labeled a
demo preview and does not claim operational run/audit readiness or production activation.

## Verification and activation gates

| Gate | Evidence before activation |
| --- | --- |
| Package and pin | Exact-SHA nested wheel from private repo; manifest/version/digest/startup check; root IBAL unchanged. |
| Contract | Native `1.0` JSON fixtures, Python/TypeScript shape parity, same-snapshot direct/service equality, error mapping. |
| Financial | Hand-computable haircut, issuer, entity, currency, deadline, reserve, fee/lot and incumbent cases plus the five upstream SIM scenarios. |
| Independent check | Altered allocation/objective/cost/verification flag rejected by adapter; no unverified target exposed. |
| UI | Service-down, invalid, verified, infeasible and SIM states; no mock economics in connected path; desktop/narrow viewport checks. |
| Promotion | Pin-update PR and rollback drill; spec015 registry/authorization/audit evidence before operational activation; governed sources and shared reservation before production book mode. |

## Trade-offs and dependencies

An exact commit and built artifact make updates reviewable while still allowing a bot to bring
new versions promptly as PRs. A floating `main` dependency would make historical runs
unreproducible. Reusing the model's source-domain verifier avoids duplicate financial policy in
QuantMeridian; the adapter's second invocation and tamper checks provide a separate acceptance
boundary. The initial SIM book is credible for demonstration but cannot stand in for governed
holdings, calls or bank-wide regulatory data. Spec015 owns the wider optimization registry;
Spec016 binds one real collateral model to it.
