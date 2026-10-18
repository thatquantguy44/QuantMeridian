# Tasks: InventoryBallast Collateral Optimizer binding

- **Spec:** [SPEC.md](SPEC.md), [PLAN.md](PLAN.md)
- **Status:** Spec drafted; model integration and activation not implemented
- **Last updated:** 2026-10-18

| ID | Task | Covers | Status | Completion evidence |
| --- | --- | --- | --- | --- |
| COLL-T001 | Record the upstream nested package, merged candidate SHA, native contracts, current mock gap and spec015 boundary. | COLL-001, COLL-004, COLL-007 | done | SPEC/PLAN name the exact repository/subdirectory, commit and v0.1.0 interface. |
| COLL-T002 | Review candidate release and build an exact-SHA wheel, lock, provenance and binding manifest; keep the IBAL root package pin independent. | COLL-001, COLL-002 | todo | Clean build and startup identity check; drifted commit/version/digest fails. |
| COLL-T003 | Define service request/result, capability, health, validation and error schemas with parity fixtures and ingress source modes. | COLL-003, COLL-004, COLL-010 | todo | Python/TS shape checks; invalid and stale snapshots rejected; no source string can assert governed provenance. |
| COLL-T004 | Implement the separate Python adapter and same-origin proxy with explicit auth, limits, correlation and typed errors. | COLL-001, COLL-003, COLL-004 | todo | Direct-versus-service golden request matches; service-down and unconfigured states are distinct. |
| COLL-T005 | Invoke native `verify.assess` again at the adapter boundary and reconcile objective, coverage, reserve, movement and statuses. | COLL-005, COLL-009 | todo | Tampered target/cost/flag tests fail; invalid incumbent suppresses savings. |
| COLL-T006 | Expose the five upstream SIM scenarios and validated JSON upload, preserving base and scenario hashes. | COLL-004, COLL-008, COLL-010 | todo | Offline repeatability and named overlay tests; user upload is separately labeled. |
| COLL-T007 | Replace connected COLL calculations and grids with service-backed calls, assets, costs, constraints, movements and error states. | COLL-006–010 | todo | No mock savings, allocation, shadow price or uplift enters connected results or OPT totals; responsive UI checks. |
| COLL-T008 | Add exact-SHA upstream release detection and a reviewable pin-update PR workflow; prove rollback. | COLL-002, COLL-011 | todo | Candidate PR contains source diff, artifacts and contract evidence; rollback retains run lineage. |
| COLL-T009 | Integrate with spec015 immutable run records, comparison and OPT audit without changing model math. | COLL-003, COLL-009–010 | blocked by spec015 registry decisions | Same-snapshot and drifted comparisons, idempotent runs and source/version provenance pass. |
| COLL-T010 | Gate production book mode on governed sources, shared asset availability, authorization, audit and operational approval. | COLL-012 | blocked by source/policy ownership | Unapproved live mode cannot run; no settlement action exists. |

## Acceptance evidence map

| Criterion | Planned evidence |
| --- | --- |
| AC-001 | COLL-T002 exact-SHA build/startup and independent IBAL-pin check |
| AC-002 | COLL-T003/T004 direct-versus-service golden fixture |
| AC-003 | COLL-T003/T004 strict validation and error fixtures |
| AC-004 | COLL-T006 five-scenario repeatability and infeasible fixtures |
| AC-005 | COLL-T005 objective/allocation/flag tamper cases |
| AC-006 | COLL-T005/T007 incumbent, reserve, LP/MIP and UI tests |
| AC-007 | COLL-T004/T007 connected-path and unavailable-state UI tests |
| AC-008 | COLL-T008 automated candidate, review and rollback drill |
| AC-009 | COLL-T009 matched/drifted comparison tests |
| AC-010 | COLL-T010 production gate and no-execution tests |

## Delivery order

1. Review SPEC/PLAN, the candidate upstream release and the two open local-mode choices
   (validated upload and adapter verification tolerance).
2. Build the package pin and contract/service tests (T002–T005). `READY` remains false until
   the manifest and verifier are approved.
3. Connect the SIM demo and COLL result UI (T006–T007); treat it as a demo preview until spec015
   run/audit storage is ready.
4. Add pin-update automation and the spec015 operating records (T008–T009).
5. Activate a governed book only after T010's separate source and operational review.

No implementation task is complete solely because its behavior is specified here.
