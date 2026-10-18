# Tasks: InventoryBallast Collateral Optimizer binding

- **Spec:** [SPEC.md](SPEC.md), [PLAN.md](PLAN.md)
- **Status:** Local SIM integration implemented; production activation blocked by spec015 and governed-source decisions
- **Last updated:** 2026-10-18

| ID | Task | Covers | Status | Completion evidence |
| --- | --- | --- | --- | --- |
| COLL-T001 | Record the upstream nested package, merged candidate SHA, native contracts, current mock gap and spec015 boundary. | COLL-001, COLL-004, COLL-007 | done | SPEC/PLAN name the exact repository/subdirectory, commit and v0.1.0 interface. |
| COLL-T002 | Review candidate release and build an exact-SHA wheel, lock, provenance and binding manifest; keep the IBAL root package pin independent. | COLL-001, COLL-002 | implemented; clean-checkout CI pending | Manifest names merged SHA `eb74850a0f972ca9e1f40558ecd7909d3e76e6b3`; local builder produced reviewed wheel SHA `84a163c2…fbc5e`; identity drift and rollback checks pass. CI exercises `--require-git` with the private checkout. |
| COLL-T003 | Define service request/result, capability, health, validation and error schemas with parity fixtures and ingress source modes. | COLL-003, COLL-004, COLL-010 | implemented | Native 1.0 schemas and baseline/infeasible fixtures are checked against pinned package; strict native validation rejects seven invalid input cases. |
| COLL-T004 | Implement the separate Python adapter and same-origin proxy with explicit auth, limits, correlation and typed errors. | COLL-001, COLL-003, COLL-004 | implemented | Python direct/service parity and auth/size tests pass; proxy tests cover unconfigured, unavailable, incompatible, and production gates (CI pending). |
| COLL-T005 | Invoke native `verify.assess` again at the adapter boundary and reconcile objective, coverage, reserve, movement and statuses. | COLL-005, COLL-009 | implemented | Allocation, objective, component and flag tamper tests pass; adapter strips unverified target and costs; margin spike suppresses incumbent savings. |
| COLL-T006 | Expose the five upstream SIM scenarios and validated JSON upload, preserving base and scenario hashes. | COLL-004, COLL-008, COLL-010 | implemented | Python five-scenario repeatability tests pass; upload uses native strict Snapshot and distinct USER_UPLOAD source mode. |
| COLL-T007 | Replace connected COLL calculations and grids with service-backed calls, assets, costs, constraints, movements and error states. | COLL-006–010 | implemented; browser check blocked | COLL and OPT use service result only; old mock COLL/OPT data removed. Real-service Playwright covers five scenarios and narrow viewport, but first PR CI failed before any job steps ran. |
| COLL-T008 | Add exact-SHA upstream release detection and a reviewable pin-update PR workflow; prove rollback. | COLL-002, COLL-011 | implemented; future release trigger pending | Daily/manual workflow prepares a draft pin PR with SHA/version/digest/diff/check evidence or blockers. Identity test proves restored exact pin becomes ready. No newer release exists to exercise a real update PR yet. |
| COLL-T009 | Integrate with spec015 immutable run records, comparison and OPT audit without changing model math. | COLL-003, COLL-009–010 | blocked by spec015 registry decisions | Preview carries hashes, full SHA, version and changed fields; differing inputs/pins are marked non-comparable. Durable identity, idempotency, immutable storage, authorization and audit are not defined/available. |
| COLL-T010 | Gate production book mode on governed sources, shared asset availability, authorization, audit and operational approval. | COLL-012 | gate implemented; activation blocked | Service and proxy reject PRODUCTION_BOOK and production terminal requests; tests pass. Governed source, global reservations and operations approval remain absent. |

## Acceptance evidence map

| Criterion | Planned evidence |
| --- | --- |
| AC-001 | Builder/manifest/identity tests pass locally; clean exact-SHA checkout CI requires `INVENTORYBALLAST_READ_TOKEN`. |
| AC-002 | Python direct native solve equals service result and canonical input hash. |
| AC-003 | Python 7-case invalid snapshot test and service error envelope; proxy contract CI pending. |
| AC-004 | Python five-scenario deterministic tests and infeasible fixture pass. |
| AC-005 | Python allocation/objective/component/flag tamper tests pass. |
| AC-006 | Python incumbent, reserve and MIP dual tests pass; browser CI pending. |
| AC-007 | Connected UI/OPT implementation and proxy/browser tests added; npm/Playwright CI failed before steps and requires platform log or rerun. |
| AC-008 | Automated draft update workflow and rollback identity drill added; future candidate PR pending. |
| AC-009 | Local comparison marks drift non-comparable; historical durable comparisons blocked by spec015 registry. |
| AC-010 | Service/proxy production gates and no-execution design tested; live activation blocked. |

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
