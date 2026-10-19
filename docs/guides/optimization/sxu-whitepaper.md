# Sources & Uses (SXU): white paper and business guide

> **Status:** two parts. The **Configuration workspace** stores a desk's own sources, uses and compatibility rules and never solves. The **Synthetic PoC** is a working optimizer that runs in the browser on a hand-built synthetic book, so the method can be seen and tested. The production solver, independent service verifier and API (Spec012 SU-003 to SU-005, SU-009) are not built yet. Nothing here is a funding recommendation.

## Executive summary

SXU matches a financing desk's **funding sources** (firm cash, customer free credits, securities-lending cash, repo, commercial paper, a committed revolver) to its **uses** (CCP margin, liquidity buffers, inventory financing, prime margin lending, matched-book repo) at the lowest all-in cost, while:

- meeting every **hard** obligation in full,
- covering **soft** demand in strict **priority order** (regulatory first, opportunistic last),
- counting each source's **haircut** (a dollar of repo funds less than a dollar of use),
- using only explicitly **allowed** source-to-use pairs,
- and naming the shortfall, rather than inventing a plan, when the book cannot be funded.

The Synthetic PoC solves this as a penalized **transportation problem** with a lexicographic tier sequence, then certifies the answer with primal, dual and complementary-slackness checks. Its results were cross-checked independently against SciPy/HiGHS for every scenario.

## Business problem

Funding desks fragment: treasury owns the cash pool, the repo desk owns secured funding, prime services owns customer credits, and the holding company owns unsecured issuance. Each funds "its" uses, so the firm pays revolver rates in one entity while cheap cash sits idle in another.

A sources-and-uses view asks one question across the whole balance sheet: *which dollar should fund which obligation?* The answer must respect:

| Rule | Why it matters |
|---|---|
| Priority | A CCP margin call must be met before an opportunistic matched-book trade, whatever their economics |
| Hard versus soft | Some uses must be covered in full; others can be partly left unfunded at a known cost |
| Haircuts | Secured funding delivers less than its nominal amount |
| Eligibility | Customer credits may only fund customer debits; some reuse is restricted |
| Legal entity | Moving cash between entities has a cost; it is allowed only where a rule permits it |
| Currency | A source in one currency can never fund a use in another |
| Tenor | Funding a 90-day use with overnight money creates rollover risk |
| Concentration and minimum draws | Over-reliance on one lane is risky; some programs penalize under-use |

## How it works

### The network

Sources sit on one side, uses on the other, and each **allowed lane** carries a flow. Two dummy nodes balance the network:

- a **dummy idle sink** absorbs a source's unused capacity, at the source's idle penalty;
- a **dummy shortfall source** supplies a soft use's unmet demand, at the use's shortfall penalty. Hard uses have no shortfall variable.

### Flow and coverage

For a nominal flow `x` from source `i` to use `j`:

- source capacity used = `x`
- coverage credited to the use = `x × (1 − haircut_i)`

Supply rows: Σ flows from a source + idle = capacity. Demand rows: Σ haircut-adjusted coverage + shortfall = demand.

### The cost of a lane

Each lane's unit cost, in basis points per year, is the sum of:

| Component | Default | Meaning |
|---|---|---|
| Source cost | per source | The source's own funding cost |
| Pair penalty | per lane | Operational transfer cost, reuse restriction or wrong-way risk |
| Cross-entity charge | 10 bp | Added when source and use are in different legal entities |
| Tenor mismatch | 1.5 bp per 30 days | Charged for each 30 days the use's tenor exceeds the source's |
| Haircut capital charge | 40 bp × haircut | Cost of the encumbered over-collateral |
| Concentration | +12 bp above 70% | Extra cost on the part of a lane above 70% of the use's demand |

Plus the dummy-node costs: idle capacity, minimum-draw shortfalls (a program drawn below its floor) and soft-use shortfall.

### Priority: lexicographic tiers

In the default **lexicographic** mode the model solves in stages:

1. For tier 1, minimize weighted shortfall of that tier's soft uses; fix that optimum (with a tiny tolerance).
2. Repeat for tiers 2, 3 and 4, each time keeping the earlier tiers fixed.
3. With every tier's shortfall fixed, minimize total cost.

So a lower tier can never take funding from a higher tier, however large its penalty. **Weighted** mode, shown for comparison only, puts shortfall and cost in one objective, so cheap-to-shed uses are dropped whenever funding costs more than their penalty.

### Solving and certification

The PoC uses a dependency-free dense two-phase simplex with Bland's rule. After solving it certifies the final-stage LP with eleven checks: non-negative flows, only allowed lanes carry flow, supply balance, demand balance after haircuts, hard uses fully covered, concentration charged only above the threshold, objective recomputes from its penalties, primal feasibility, dual feasibility (reduced costs non-negative), complementary slackness and strong duality (zero gap), and that the LP certificate matches the reported flows.

### When the book cannot be funded

If the hard uses cannot all be covered, the model runs an **elastic diagnostic**: it minimizes the total uncovered hard demand and reports each short use, the total gap and the exhausted sources. No allocation is shown.

### Shadow prices

- **Source shadow price** (`u_i`): the change in total cost per extra dollar of that source's capacity. Negative when idle capacity is penalized.
- **Use marginal cost** (`v_j`): the change in total cost per extra dollar of coverage required.
- **Reduced cost** of a lane: how much its cost would have to fall before it carries flow.

## Data and provenance

| Part | Data | Label |
|---|---|---|
| Synthetic PoC | A hand-built, deterministic broker-dealer book in USD $mm: 8 sources, 10 uses, 35 allowed lanes, 3 legal entities | `SIM` |
| Configuration workspace | Only what the user creates or imports; nothing is prefilled | `SETUP ONLY` |
| Copied PoC book | A PoC scenario copied into the workspace | Named "SIM · …" and tagged SIM |

The module **SIM switch** (on by default) controls whether any synthetic content appears. Off shows only the user's own configurations.

## Assumptions

### Approved model decisions (Spec012, 2026-10-18)

| Question | Decision |
|---|---|
| 1. Mismatches | A currency mismatch is always a hard block. A legal-entity mismatch is allowed only through an explicit compatibility rule. |
| 2. Rounding | The model does no rounding; values are rounded only for display |
| 3. Internalization | Internalization rate = haircut-adjusted coverage from internal sources ÷ total haircut-adjusted coverage delivered (shown "n/a" if any contributing source is unclassified). Not yet computed in the PoC. |
| 4. Currency | Exactly one currency per run; a multi-currency configuration is rejected before solving |

### Synthetic book: sources

| Id | Source | Family | Entity | Capacity $mm | Cost bp | Haircut | Tenor | Extra |
|---|---|---|---|---|---|---|---|---|
| S1 | Firm cash pool | Internal | QM Securities | 1,400 | 8 | 0% | 1d | idle 5 bp |
| S2 | Prime free credits | Internal | QM Prime | 820 | 18 | 0% | 1d | idle 8 bp |
| S3 | Sec-lending cash collateral | Internal | QM Securities | 640 | 34 | 1% | 1d | idle 10 bp |
| S4 | Tri-party repo · UST | Secured | QM Securities | 1,700 | 26 | 2% | 1d | min draw 600 at 15 bp |
| S5 | Tri-party repo · Agency MBS | Secured | QM Securities | 900 | 38 | 5% | 30d | |
| S6 | Bilateral repo · IG credit | Secured | QM Securities | 620 | 64 | 8% | 90d | |
| S7 | Commercial paper | Unsecured | QM Holdings | 850 | 88 | 0% | 60d | min draw 350 at 25 bp |
| S8 | Committed revolver | Unsecured | QM Holdings | 1,000 | 135 | 0% | 365d | |

### Synthetic book: uses

| Id | Use | Tier | Policy | Demand $mm | Shortfall bp | Tenor |
|---|---|---|---|---|---|---|
| U1 | CCP initial margin | 1 Regulatory & CCP | hard | 880 | — | 90d |
| U2 | Liquidity buffer top-up | 1 | hard | 520 | — | 365d |
| U3 | Intraday settlement buffer | 1 | hard | 300 | — | 1d |
| U4 | Govt & agency inventory | 2 Core franchise | hard | 1,350 | — | 1d |
| U5 | Prime margin lending | 2 | soft | 1,050 | 320 | 30d |
| U6 | Equity inventory | 2 | soft | 640 | 260 | 30d |
| U7 | Credit inventory | 3 Trading inventory | soft | 520 | 210 | 90d |
| U8 | Securities borrow collateral | 3 | soft | 430 | 180 | 30d |
| U9 | Structured note hedges | 3 | soft | 330 | 150 | 180d |
| U10 | Matched-book reverse repo | 4 Opportunistic | soft | 600 | 45 | 1d |

**Lanes:** firm cash (S1) can fund every use; customer credits (S2) fund prime margin and, at 4 bp, securities borrows; sec-lending cash (S3) reinvests into prime, equity, borrows and (at 8 bp) the matched book; UST repo (S4) funds government inventory and the matched book, plus CCP margin (3 bp) and intraday (2 bp); MBS repo (S5) funds government inventory and the matched book; IG repo (S6) funds credit inventory and (5 bp) hedges; CP (S7) is downstreamed from Holdings to the buffer, equity, credit and hedges, and to prime at 6 bp; the revolver (S8) is downstreamed to CCP margin, buffer, intraday, equity, credit and hedges.

### Scenarios

| Scenario | Change | Result (lexicographic) |
|---|---|---|
| Balanced book | none | 100% coverage; revolver undrawn |
| Repo market squeeze | Secured capacity × 0.55 | 97% coverage; the matched book is shed first |
| Haircut shock | Secured haircuts +8 pp, sec-lending +4 pp | 100% coverage at higher cost |
| Margin-call surge | CCP margin × 2.6 | 97% coverage; tier 1 met in full, the revolver is drawn |
| Unsecured rate shock | CP and revolver +150 bp | Allocation holds; cost and shadow prices reprice |
| Funding cascade | Revolver withdrawn, CP × 0.2, CCP margin × 2.5 | **Infeasible**; elastic diagnostic names a $279mm gap |

## Outputs and how to read them

| Output | Meaning |
|---|---|
| Objective | Total annual cost of the plan, $mm/yr: funding plus every penalty |
| Funding cost / Penalties | Pure funding versus penalty share of the objective |
| Coverage | Haircut-adjusted coverage ÷ demand; "every use whole" when nothing is unmet |
| Idle capacity / haircut drag | Unused source capacity; nominal lost to haircuts |
| Solve sequence | Each tier's weighted shortfall, then the final cost stage |
| Transportation tableau | Flows by lane with costs, reduced costs and the shadow prices on the margins |
| Objective decomposition | The objective split into its nine components |
| Source utilization / use coverage | How full each source is, and how covered each use is by tier |

A rising use marginal cost tells you which obligation is expensive to fund at the margin; a large source shadow price tells you which extra capacity would save the most.

## Validation

- 34 unit tests of the synthetic solver plus 49 contract and workspace tests, and 70 Python tests of the service contracts and canonical hashes (identical hashing in TypeScript and Python, checked against shared vectors).
- Independent cross-check: all twelve solves (six scenarios in two priority modes) were re-solved with SciPy/HiGHS and match to six decimal places; the lexicographic tiers match stage by stage; the cascade's 279 gap equals the independently computed minimum.
- The eleven certification checks run on every solve in the page.

## Limitations

- The solver runs in the browser on the synthetic book only. The workspace does not solve.
- No mixed-integer rules (all-or-none, lot sizes, ticket counts) yet: SU-006.
- No internalization rate in the PoC.
- Single period, single currency; no forecast of uses or sources.
- Penalty values in the synthetic book are illustrative economics, not decisions about any real desk.

## Status and governance

- **Spec:** Spec012, owner-approved 2026-10-18 (questions 1–4 resolved).
- **Done:** SU-001 decisions, SU-002 contracts and canonical hashes, SU-011 pinned engineering skills, SU-012 synthetic PoC, SU-013 SIM switch and provenance badge.
- **In progress:** SU-003 compatibility engine, SU-007 editor and results views.
- **Next:** the production LP on `optimization_core` with an independent verifier (SU-004, SU-005), then MIP rules (SU-006), OPT run history (SU-008), service hardening (SU-009) and the as-built model card (SU-010).

## References

- Help & FAQ: [SXU help](/guides/SXU/help)
- Design paper: `docs/whitepapers/sources_and_uses.md`
- Specs: `docs/specs/spec012/SPEC.md`, `docs/specs/spec012/HANDOFF.md`, `docs/specs/spec012/TASKS.md`
- Code: `src/app/sources-uses/`, `src/data/sourcesUsesSynthetic.ts`, `src/data/sourcesUses.ts`, `services/sources_uses_api/`
- Related: [CASH](/guides/CASH/whitepaper), [Optimization Center](/guides/OPT/whitepaper)
