# Spec016: InventoryBallast Collateral Optimizer binding

- **ID:** spec016-inventoryballast-collateral-binding
- **Parent:** [Spec015](../spec015/SPEC.md), especially OC-001–007, OC-009, OC-015–016
- **Model authority:** [InventoryBallast spec 0023](https://github.com/thatquantguy44/InventoryBallast/tree/main/specs/0023-standalone-collateral-optimizer)
- **Status:** Draft for review. The owner identified the model repository on 2026-10-18; no QuantMeridian model binding or production activation is approved by this document.
- **Last updated:** 2026-10-18

## Purpose and current state

Connect the independently packaged `collateral-optimizer` from InventoryBallast to QuantMeridian's
`COLL` module through the separate `collateral_optimizer_api` service proposed by spec015. A
reviewed, immutable model pin lets QuantMeridian adopt future upstream releases through explicit
pin-update PRs. The browser must never install Python packages or calculate collateral economics.

Today `src/data/collateral.ts` generates separate SIM margin, asset, savings and constraint values;
`src/app/collateral/page.tsx` also estimates what-if savings in the client. Those values do not
reconcile to one collateral book or a solver. Spec015 has a generic connection shell but leaves the
collateral model repository, native contracts, and verification fixtures unresolved. InventoryBallast
now supplies a standalone Python package, native `Snapshot` and `OptimizationResult` contracts,
LP/MIP solve, source-domain verifier, and five deterministic SIM scenarios.

## Resolved model identity and proposed first pin

| Field | Value |
| --- | --- |
| Canonical repository | `thatquantguy44/InventoryBallast` |
| Package directory | `projects/collateral_optimizer/` (separate from root `inventory-optimizer`) |
| Distribution / import | `collateral-optimizer` / `collateral_optimizer` |
| Native entry points | `collateral_optimizer.engine.optimize`, `verify.assess`, and `demo.build_demo_book` / `apply_demo_scenario` |
| Candidate immutable commit | `eb74850a0f972ca9e1f40558ecd7909d3e76e6b3`, the merged-main commit containing [PR #36](https://github.com/thatquantguy44/InventoryBallast/pull/36) |
| Candidate package / contract versions | `0.1.0` / snapshot `1.0` / result `1.0` |

This identifies the first **candidate**, not an active production binding. The implementation
records the full SHA, version, artifact digest, adapter version and contract versions in a reviewed
manifest. It must confirm the candidate still matches the upstream package before activation.
The existing IBAL service keeps its own independent InventoryBallast root-package pin.

## Scope and boundaries

- First connected slice: local/offline SIM scenario selection from the model's single coherent
  56-lot, eight-call book, plus a separately labeled validated JSON snapshot upload path. Each
  selection invokes the pinned model and displays the actual verified result and source lineage.
- QuantMeridian supplies a same-origin route and a separate Python service. Spec015 owns the
  durable run registry, access control, scheduling, audit history and multi-model comparison.
- The model owns eligibility, haircut, issuer, coverage, liquidity-reserve, cutoff, objective,
  solve and native verification logic. QuantMeridian owns source assembly, authorized access,
  pin approval, request/result transport, display and run records.
- Production book mode remains disabled until authoritative inventory, pledges, agreements,
  calls, FX, costs, custody and reservation sources have owners and freshness controls.

This release does **not** compute initial margin, LCR/NSFR, or a bank-wide liquidity ratio; it
does not compress positions, forecast stochastically, book movements, or coordinate asset
reservations with IBAL. Those remain in the [upstream roadmap](https://github.com/thatquantguy44/InventoryBallast/blob/main/specs/0023-standalone-collateral-optimizer/roadmap.md).

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| COLL-001 | Build a separate `services/collateral_optimizer_api` adapter for the nested distribution at an exact reviewed merged-main commit, without importing or repinning `inventory_optimizer`. | must |
| COLL-002 | Maintain a machine-readable binding manifest containing repository, subdirectory, full SHA, distribution/version, build artifact and dependency digests, adapter version, and native request/result versions. Startup and health fail closed on drift. | must |
| COLL-003 | Provide server-only `/health`, `/v1/capabilities`, `/v1/validate`, and `/v1/runs` contracts and a same-origin terminal proxy with typed errors, auth, limits, correlation ID and provenance. | must |
| COLL-004 | Preserve all native `Snapshot` fields and units: dated lots, calls, effective agreements, FX, current pledges, horizon, freshness and supplied local reserve. Reject missing/unknown fields; do not infer legal authority, haircuts or costs from display aggregates. | must |
| COLL-005 | Re-run the model's source-domain `verify.assess` on the returned target and reconcile objective, coverage and liquidity in the adapter. A native `verified` flag alone cannot approve a recommendation. | must |
| COLL-006 | Show target allocations, movements, per-call coverage, USD horizon cost, valid-incumbent savings, reserve, binding rows, infeasibility and qualified LP-only duals directly from service results. Never fabricate a missing value. | must |
| COLL-007 | Replace `src/data/collateral.ts` mock savings, allocations and shadow prices, and the page's client what-if estimate, in the connected result path. Retained illustrative layout is explicitly SIM and cannot populate run or recommendation totals. | must |
| COLL-008 | Offer the five upstream named demo overlays without altering the base book. Any editable what-if submits a new validated snapshot and solve; the UI shows changed inputs and baseline comparability. | must |
| COLL-009 | Gate all recommendations on native `optimal` plus native and adapter verification; suppress savings when the current posting is invalid, and return no target on infeasible, error or unverified results. | must |
| COLL-010 | Surface source mode (`SIM`, validated upload, future governed book), as-of/freshness, input/parent hashes, package SHA/version, adapter version and result schema on each run and export. No silent source fallback. | must |
| COLL-011 | Detect a newer merged upstream package release and prepare a QuantMeridian pin-update PR; never deploy from a moving branch. Promotion requires contract tests, source review and approval; rollback restores the prior exact binding. | must |
| COLL-012 | Keep production book and execution actions disabled until spec015 governance plus source ownership, shared asset reservation and operational controls are separately approved. | must |

## Acceptance criteria

| ID | Observable result |
| --- | --- |
| AC-001 | A clean service build installs only the nested collateral package at the manifest's full SHA; startup rejects a different commit, package version, digest or incompatible schema. The root IBAL pin is unchanged. |
| AC-002 | Direct native solve and service solve of the same validated baseline snapshot yield the same input hash, status, allocation, coverage, movement, cost and verifier decision within declared numeric tolerance. |
| AC-003 | Missing FX, stale input, invalid agreement, wrong entity/currency, overpledge and extra fields return located validation errors and create no successful run. |
| AC-004 | The baseline, margin spike, liquidity scarcity, cutoff/fees and infeasible stress use the upstream book and produce deterministic, correctly labeled SIM results. No candidate allocation or savings appears for the infeasible case. |
| AC-005 | A tampered allocation, objective, cost component or reported verification flag cannot pass the adapter check or enter a recommendation/savings total. |
| AC-006 | A margin spike with undercovered current pledges displays target cost but no savings; the liquidity reserve stress shows its binding row. MIP displays no LP dual, and no LCR/NSFR claim appears. |
| AC-007 | The connected COLL page and OPT summary show service data only; a service-down, incompatible or unconfigured binding displays its true state and no generated result masquerades as a solve. |
| AC-008 | A proposed upstream update opens a reviewable pin PR with old/new SHA, version, digest, contract diff and test evidence; no runtime branch fetch occurs. A rejected or rolled-back pin leaves historical runs tied to the old version. |
| AC-009 | Same-snapshot comparisons carry hashes, changed fields, USD/horizon units and model version; differing snapshot or pin is flagged as non-comparable for a causal savings claim. |
| AC-010 | A production-mode request is blocked until separately approved source, reservation, access, audit and execution boundaries are evidenced; local SIM remains plainly marked. |

## Open approval gates

The upstream repository and candidate commit are identified. Before activating a connected
QuantMeridian binding, the owner must review the native `1.0` schema, the adapter's independent
check and tolerance, artifact provenance, and the validated-upload policy. Production activation
also needs the source and operational gates in COLL-012. The separate money market repository and
the broader spec015 storage/worker decisions remain open.
