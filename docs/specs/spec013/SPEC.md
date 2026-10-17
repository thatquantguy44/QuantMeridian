# Spec013: IBAL Showcase

- **ID:** spec013-ibal-showcase
- **Parent:** InventoryBallast specs/0018-live-poc-showcase/spec.md, REQ-011–015, REQ-029–030, REQ-041
- **Status:** Approved — owner decisions recorded 2026-10-17; implementation authorized
- **Author:** Joshua Lutkemuller, CFA
- **Approver:** Joshua Lutkemuller, CFA (2026-10-17)
- **Last updated:** 2026-10-17

> WHAT and WHY only. Integration architecture belongs in PLAN.md and ordered work in TASKS.md.

## Summary

Bring the InventoryBallast workspace in QuantMeridian up to the current engine contract and make the terminal's IBAL module demonstrate verified diagnostics, prime/agency results, deterministic scenario comparison, and a guided presenter flow.

## Problem & Context

The existing service integration pins an older engine revision and exposes only part of the engine's current capabilities. The 0018 program requires an explicit engine pin, feature gating from the capability manifest, and a live workflow that shows the actual solve and verification output. Controls must never appear enabled if the pinned service cannot execute the capability.

## Goals

- Re-pin the local engine service through an explicit, reviewed revision update.
- Gate controls and result sections on the pinned engine's advertised capabilities.
- Add solver, sensitivity, attribution, flow, infeasibility, agency, and prime diagnostic views.
- Provide Scenario Studio for named scenarios, ranked stress, and run-to-run comparison.
- Provide a local presenter mode with service health and a guided sequence.
- Preserve SIM/source provenance, request/result hashes, and independent verification status.

## Non-goals

- Production activation or granting G2D, G2E, or G3.
- Changing the InventoryBallast optimizer or duplicating its mathematics in TypeScript.
- Hiding unsupported capabilities or presenting a failed/unchecked result as valid.
- New external market-data or real-book feeds.

## Requirements

| ID | Requirement | Parent | Priority |
|---|---|---|---|
| IBAL-001 | Pin a reviewed InventoryBallast engine version and expose its manifest; pin changes are explicit and reversible. | REQ-011 | must |
| IBAL-002 | Gate all controls, tabs, and result interpretations on the manifest; unavailable features explain why. | REQ-011/012 | must |
| IBAL-003 | Expose family, MIP, stability/concentration, fee-tier, and economics controls only when supported by the manifest. | REQ-012 | must |
| IBAL-004 | Show solver diagnostics, binding constraints/shadow prices, attribution, flow, infeasibility explanation, and agency/prime disclosures from engine responses. | REQ-013 | must |
| IBAL-005 | Scenario Studio selects named library scenarios, runs batch stress, ranks verified impacts, and compares runs by matched/unmatched entities. | REQ-014 | must |
| IBAL-006 | Presenter mode guides base → shock → diagnose → repair → compare, with health status and local/SIM disclosure. | REQ-015 | should |
| IBAL-007 | Every result identifies request/run hash, engine pin, solve status, verification status, and provenance. | REQ-030 | must |
| IBAL-008 | Production remains disabled and governance gates remain ungranted. | Parent non-goals | must |

## Acceptance Criteria

- **AC-001:** A service health response shows the exact engine revision and capabilities; a pin bump changes only through reviewed config.
- **AC-002:** Unsupported capabilities hide or disable controls with an explanation; no client guard substitutes for engine capabilities.
- **AC-003:** Diagnostic totals and bindings reproduce the service result; no UI-side reconstruction changes semantics.
- **AC-004:** Scenario results display verified status and signed delta; failed/unverified outcomes are not ranked as valid.
- **AC-005:** Comparison preserves unmatched entities and reconciles matched values.
- **AC-006:** Presenter mode completes at required viewports and reports service failure honestly.
- **AC-007:** Production stays disabled and no governance gate is modified.

## Decisions (owner, 2026-10-17)

1. **Pin review and release identity.** An accepted engine release is identified by three
   values: the full commit SHA, the package version, and `engine_fingerprint` (the service's
   existing readiness check compares the loaded engine against both the fingerprint and the
   commit). The pin may only name a commit already merged to InventoryBallast `main`; branch
   pins are not accepted. A pin bump is its own QuantMeridian PR that changes only
   `engine_package_version`, `engine_commit`, `engine_fingerprint` and any contract-parity fixes,
   passes the service test suite, and links the engine PR it adopts. Rollback is a revert of that
   PR; nothing else changes.
2. **Default versus expandable diagnostics.**
   - Always visible: solve status, verification status, objective, termination reason, engine
     pin, and request/run hash (the IBAL-007 trust signals; never collapsed).
   - Shown by default when present: the top binding constraints with their shadow prices.
   - Expandable panels: full sensitivity ranges, attribution, flow, agency/prime disclosures,
     and raw output.
   - Infeasibility explanation opens automatically only when the solve is infeasible.
3. **Presenter "repair" semantics.** The guided base → shock → diagnose → repair → compare
   sequence applies a named corrective scenario from the pinned engine's scenario library, so
   the demo is deterministic, repeatable, and its result is verified in advance. After the guided
   sequence the presenter may still edit the request by hand; that run is labeled
   "user-edited" and compared the same way.

## Related documents

- Parent: InventoryBallast specs/0018-live-poc-showcase/
- Existing integration: docs/specs/spec007/
- Engine scenario contract: InventoryBallast specs/0019-desk-scenarios-stress/
- Engine service: services/inventory_optimizer_api/
