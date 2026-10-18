# Tasks: Configurable Sources and Uses Optimizer

- **Spec:** spec012-configurable-sources-uses (`SPEC.md`, `PLAN.md`)
- **Status:** Bounded setup-only phase approved; solver/service behavior remains gated on open decisions
- **Checkpoint:** See [HANDOFF.md](HANDOFF.md) for branch state and pickup instructions
- **Parent requirements:** 0018 REQ-021–029, REQ-041

| ID | Task | Covers | Status | Evidence / definition of done |
|---|---|---|---|---|
| SU-001 | Resolve compatibility, units, internalization, and currency questions; approve child docs. | SU-001–009 | blocked | Decisions and approval recorded in SPEC.md |
| SU-002 | Define versioned contracts, config schema, canonical hash, and CSV/JSON round-trip. | SU-001, SU-009 | in-progress | Schema, generated types/models, parity and round-trip fixtures; current browser schema is a setup-only draft without a canonical run hash |
| SU-003 | Implement compatibility rules and editable matrix with explicit override state. | SU-002 | in-progress | Rule-by-rule and override golden tests; current UI records explicit pair states only and does not solve |
| SU-004 | Implement LP with hard/soft uses and lexicographic tiers. | SU-003, SU-004 | todo | Hand-derived cases include large lower-tier economics |
| SU-005 | Add independent verifier, binding rows, duals, and infeasibility explanation. | SU-006, SU-007 | todo | Tamper tests; MIP dual caveat fixture |
| SU-006 | Add optional MIP rules and formulation disclosure. | SU-005 | todo | Per-rule binding/invalid cases |
| SU-007 | Build editor, compatibility matrix, results/Sankey, and CSV/JSON import/export. | SU-001–006, SU-009 | in-progress | Setup-only editor and CSV/JSON import/export implemented; solver result views and tests remain |
| SU-008 | Remove random matches and add verified OPT run history. | SU-008 | todo | No random source remains on page; run hashes shown |
| SU-009 | Add service auth/health/telemetry and local launcher integration. | 0018 REQ-027 | todo | Service/API parity, redaction, health evidence |
| SU-010 | Benchmark and document the as-built model and demo path. | REQ-041 | todo | Approved worked example, model card, validation record |
| SU-012 | Synthetic PoC showcase mode (SU-SIM): deterministic dataset, scenarios, penalised balanced transport LP, configurable penalties, verifier and LP certificate, and visual front end. | SIM-001–010 | done | `src/data/sourcesUsesSynthetic.ts`, `src/lib/optimization/simplex.ts`, `src/app/sources-uses/synthetic/`; unit tests cover hand-computable LPs, every penalty, both priority modes, verifier and certificate tamper, and infeasibility |
| SU-011 | Pin and apply upstream Agent Skills for production engineering, testing, and independent validation. | SU-002–010 | done | `thatquantguy44/agent-skills` snapshot pinned by commit, SHA-256, and Git blob IDs; repository guidance and hosted pin check |

## Definition of Done

- Child spec is owner-approved before implementation.
- Results are independently verified and reconcile to source configuration.
- SIM/user inputs and derived values are visibly labeled and traceable.
- Full unit, service, route, and relevant demo checks pass before closure.
- SXU service/model changes follow the pinned Agent Skills; CI fails on unreviewed skill drift.
