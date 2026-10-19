# InventoryBallast guided showcase

**Status:** As-built local SIM presenter path for QuantMeridian spec013, 2026-10-18.

The QuantMeridian service loads InventoryBallast package `0.1.0` from reviewed main commit `bb425cac10d1da29e74fe8f854fd41b31f460773` (InventoryBallast PR #39) and checks source fingerprint `349923fff7c03a1ce57cb237fc64697e847ff695145fdf3019c86769a60a9f1b` at readiness. The source is pinned, not followed by branch name. A separate QuantMeridian pin PR can be reverted independently of the showcase UI.

The new service endpoints enumerate three checked-in SIM books and run InventoryBallast's own deterministic `run_demo`. The terminal renders the engine's results and diagnostics in the guided base → shock → diagnose → repair → compare sequence. It does not calculate its own objective, allocation, binding status, ranking, or repair. The principal book's supply shock makes the `INV-AAA` inventory-balance row bind at 40 shares, versus 100 in base. The verified repair increases value and adds a new entity driver; matched and new entities stay distinct. The agency book shows owner economics and mandate disclosures. The prime book deliberately produces an infeasible shock, with no allocation, then a verified repair; the diagnosis exposes coverage and excluded-source evidence.

Every result exposes solve and verification status, objective when verified, termination reason, run and input hashes, and engine pin. Solver/formulation, binding rows, economic attribution, demand/flow, agency and prime disclosures are rendered from service artifacts. Stress outcomes preserve engine ranks only when status and independent verification permit a valid outcome. Production remains disabled by default; no G2D, G2E, or G3 gate is granted. The presenter banner and catalog label all data `SIM`.

The pinned mixed-integer engine returns no LP ranging or sensitivity intervals, and upstream InventoryBallast spec0020 has not yet delivered an IIS or feasibility relaxation for infeasible runs. The terminal shows unavailable states for those diagnostics and never invents shadow prices for a MIP. This is decision-support demonstration data, not a live recommendation.

Local golden service tests cover pin identity, the verified principal shock/repair, matched/new drivers, prime planned infeasibility, unknown books, auth and production gate. Browser viewport and keyboard walkthroughs still require a complete terminal checkout with npm dependencies and CI capacity.
