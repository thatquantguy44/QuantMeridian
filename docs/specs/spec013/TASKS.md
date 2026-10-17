# Tasks: IBAL Showcase

- **Spec:** spec013-ibal-showcase (SPEC.md, PLAN.md)
- **Status:** Approved 2026-10-17 — IBAL-001 done; implementation authorized
- **Parent:** 0018 REQ-011–015, REQ-029–030, REQ-041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| IBAL-001 | Resolve pin, diagnostics-default, and presenter repair decisions; approve child docs. | IBAL-001–008 | done | Decisions and approval recorded in SPEC.md, "Decisions (owner, 2026-10-17)" |
| IBAL-002 | Review and bump engine pin to reviewed main revision; expose manifest through service health. | IBAL-001/002 | todo | Health and pin contract tests |
| IBAL-003 | Update proxy/request/result contract parity and manifest-driven controls. | IBAL-002/003/007 | in-progress | Manifest-driven controls done: `input_features`/`output_sections` live in `capability-manifest.json`, upload rejections follow it (`tests/test_capability_manifest.py`), and the workbench gates Run, uploads, MIP-only inputs and Scenario Studio on `/health` + `/v1/capabilities` with an engine status strip (`src/lib/ibalCapabilityGate.test.ts`, `test/ibal.spec.ts`). Request/result contract parity review remains |
| IBAL-004 | Add diagnostic tabs for solver, sensitivity, attribution, flow, infeasibility, agency, and prime. | IBAL-004 | todo | Each view reconciles to engine output; empty/unavailable states tested |
| IBAL-005 | Add Scenario Studio for named scenarios, ranked stress, and matched/unmatched comparisons. | IBAL-005 | todo | Verified golden scenario and comparison path |
| IBAL-006 | Add presenter mode, health banner, warm-up, and guided sequence. | IBAL-006 | todo | Playwright walkthrough at parent viewports |
| IBAL-007 | Verify SIM/source provenance, hashes, production-disabled state, and governance gates. | IBAL-007/008 | todo | Audit tests and visible state |
| IBAL-008 | Update white paper, validation evidence, and handoff. | REQ-041 | todo | As-built paper and all acceptance criteria evidence |

## Definition of Done

- Child spec approved before code and engine pin reviewed separately.
- Service owns optimization and verification; UI renders returned evidence.
- All displayed numbers are traceable; no governance gate is granted.
- Demo path passes required viewport and keyboard checks.
