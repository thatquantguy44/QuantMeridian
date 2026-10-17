# Tasks: Configurable Sources and Uses Optimizer

- **Spec:** spec012-configurable-sources-uses (`SPEC.md`, `PLAN.md`)
- **Status:** Draft — pending owner review; no implementation authorized yet
- **Parent requirements:** 0018 REQ-021–029, REQ-041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| SU-001 | Resolve compatibility, units, internalization, and currency questions; approve child docs. | SU-001–009 | blocked | Decisions and approval recorded in SPEC.md |
| SU-002 | Define versioned contracts, config schema, canonical hash, and CSV/JSON round-trip. | SU-001, SU-009 | todo | Schema, generated types/models, parity and round-trip fixtures |
| SU-003 | Implement compatibility rules and editable matrix with explicit override state. | SU-002 | todo | Rule-by-rule and override golden tests |
| SU-004 | Implement LP with hard/soft uses and lexicographic tiers. | SU-003, SU-004 | todo | Hand-derived cases include large lower-tier economics |
| SU-005 | Add independent verifier, binding rows, duals, and infeasibility explanation. | SU-006, SU-007 | todo | Tamper tests; MIP dual caveat fixture |
| SU-006 | Add optional MIP rules and formulation disclosure. | SU-005 | todo | Per-rule binding/invalid cases |
| SU-007 | Build editor, compatibility matrix, results/Sankey, and CSV/JSON import/export. | SU-001–006, SU-009 | todo | UI and contract tests; displayed totals reconcile |
| SU-008 | Remove random matches and add verified OPT run history. | SU-008 | todo | No random source remains on page; run hashes shown |
| SU-009 | Add service auth/health/telemetry and local launcher integration. | 0018 REQ-027 | todo | Service/API parity, redaction, health evidence |
| SU-010 | Benchmark and document the as-built model and demo path. | REQ-041 | todo | Approved worked example, model card, validation record |

## Definition of Done

- Child spec is owner-approved before implementation.
- Results are independently verified and reconcile to source configuration.
- SIM/user inputs and derived values are visibly labeled and traceable.
- Full unit, service, route, and relevant demo checks pass before closure.
