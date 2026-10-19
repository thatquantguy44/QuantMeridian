# Optimization suite demo script

A repeatable walkthrough of the optimization suite on synthetic data. Every number below was
produced by the services on this branch (IBAL seed 1701, default settings). If yours differ, the
seed, the settings or the pinned model changed.

## Before you start

```bash
npm run dev:all        # terminal + IBAL + MMKT + COLL + news_nlp + agent worker
```

- Wait for the script to print `Up`. It confirms IBAL, MMKT and COLL report `ready`.
- Check `/optimization`: the **Connections** panel should show MMKT, COLL and IBAL as `SERVICE READY`.
- `.env.local` needs the service tokens and `MACRO_DB_URL` (see `scripts/README.md`).
- Every module has a **Guide** button (top right) with its help, FAQ and white paper; `/guides`
  lists them all. Keep it handy for audience questions.
- Browser at 1440 px wide or more. Leave the **SIM** switches as the pages set them.

## Ground rules to say out loud

- Everything here is **synthetic or SIM**. Nothing is a recommendation or an execution.
- Each result is **independently verified** by a second solver pass before it is shown.
- Money Market and Sources & Uses results are labelled **not execution-ready**.

## Order

The sidebar order is the demo order: **OPT, COLL, IBAL, CASH, MMKT, SXU, MMFO**.

### 1. Optimization Center (`/optimization`), 1 minute
- **Do:** open the page. Point at the **Optimization models** launcher and the **Connections** panel.
- **Say:** one front door to every optimizer, with live service health.
- **Expect:** MMKT, COLL and IBAL `SERVICE READY`. MMKT and COLL show `BINDING UNCONFIGURED`;
  that is an owner approval still pending (Spec015), not a fault. IBAL shows `ENGINE_PINNED`.
- **Do not claim:** an operational run history. The panel says there is none.

### 2. Collateral (`/collateral`), 4 minutes
Two parts. Start with the upstream book, then show the generated books.

**Upstream SIM book (the five named scenarios).**
- **Do:** run each of the five scenarios in turn.
- **Expect** (verified target cost, USD): baseline 155,625, margin spike 165,778,
  liquidity scarcity 167,925, cutoff and fees 215,917, and **infeasible stress**, which shows the
  shortfall and no target cost.
- **Say:** when the answer does not exist, the model says so instead of inventing a plan.

**Generated demo books (the "Generated demo books" panel).** These are more realistic synthetic
books built in the terminal and solved through the upload path, so the header reads
**GENERATED DEMO BOOK · SYNTHETIC**, never SIM.
- **Do:** pick **Dealer book**, press **Solve generated book**.
- **Expect:** verified, target cost about **$161K** against an incumbent costing about **$431K**
  (saving about **$270K**). Issuer caps bind on eight calls, a US dollar lot covers the EUR call
  through the FX quote, and the issuers the agreements deny are never used.
- **Do:** choose a stress, drag its sizing control, press **Solve this stress**. The page lists
  the input that changed and marks the comparison non-comparable for a savings claim.
- **Do:** press **Run ranked stress suite**. On the dealer book, worst first:

  | Rank | Stress | Change in verified target cost |
  |---|---|---|
  | 1 | Settlement cost spike (10x) | +$254,188 |
  | 2 | Liquidity reserve squeeze (4x) | +$73,144 |
  | 3 | Issuer denied (largest issuer) | +$29,096 |
  | 4 | Tighter cutoffs (30% of time) | +$17,269 |
  | 5 | Margin call spike (+35%, largest call) | +$8,550 |
  | 6 | Haircut shock (+5 pp) | +$4,850 |

  Savings show `n/a` where the stress leaves the incumbent invalid (reserve squeeze, call spike,
  haircut shock). That is correct: no saving is claimed against an invalid incumbent.
- **Do (the memorable moment):** set **Liquidity reserve squeeze** to 500% and solve. The model
  returns **INFEASIBLE** with no target cost. The dealer book absorbs 400% but not 450%; the
  asset-manager book absorbs 250% but not 300%.
- **Do not claim:** that the agreement terms, issuers or counterparties are real. They are fictional
  and carry no legal authority.

### 3. InventoryBallast (`/inventory-optimizer`), 6 minutes
Use **Present** (top right). It warms the engine and walks the story; press **Run** on each step.

1. **Confirm the engine:** the strip shows the pinned engine commit and `PIN VERIFIED`.
2. **Generate a book:** synthetic securities-lending book, hashed so it can be reproduced.
3. **Solve the base case:** status `optimal`, verified. Total delta value about **$2.4K** on this seed.
4. **Stress one scenario:** open **Scenario Studio**, pick a family, drag the sizing controls.
   Size a recall at 20% then 80% to show the impact scale with severity.
5. **Rank every stress:** the ranked table. On this seed, worst first:

   | Rank | Scenario | Change in objective |
   |---|---|---|
   | 1 | Borrower default (largest borrower) | -$1,319 |
   | 2 | Borrower limit cut (50%) | -$784 |
   | 3 | Recall wave (3 routes, 50%) | -$356 |
   | 4 | Supply shock (30% of available) | -$117 |
   | 5-7 | Rate shock ladder, 25 / 50 / 100 bp | +$85 / +$169 / +$335 |
   | 8 | Specials squeeze (+100 bp, 3 routes) | +$335 |

6. **Compare what-ifs:** four alternative market conditions solved against the base case.

Keyboard in guided mode: Right and Left arrows move between steps, Esc leaves.

### 4. Cash Optimizer (`/cash-optimizer`)
Treasury funding view. It is not a connected model service; present it as a funding view only.

### 5. Money Market (`/money-market`), 4 minutes
- **Do:** use a **SIM rate set** (Base or Cut 25). Edit a candidate or the policy, then solve.
- **Expect:** a verified continuous LP, flagged **not execution-ready**.
- **Do not claim:** real rates. The real-rate (Gold) path is deliberately blocked until
  `gold.mmkt_rate_snapshot` is wired (issue #149). If you try it, it fails closed with
  `RATE_CANDIDATES_INELIGIBLE`; that is the intended behavior.

### 6. Sources & Uses (`/sources-uses`), 4 minutes
- **Do:** **Synthetic PoC** tab. Step through the six scenarios; toggle **Lexicographic tiers** and
  **Weighted penalties**.
- **Expect:** the funding cascade is **infeasible** and names a gap of 279 instead of a plan.
  Every other scenario is optimal. The solver was cross-checked against HiGHS for all scenarios.
- **Do not claim:** a backend. The production solver, verifier and API (SU-004, SU-005, SU-009)
  are not built; this is a browser proof of concept.

### 7. Money Market Fund Optimizer (`/money-market-fund-optimizer`)
Local SIM proof of concept. The separately deployed model service is not yet approved (Spec015).

## Resetting between demos

- IBAL: **Reset**, then **Synthetic**. The default seed is fixed, so results repeat.
- MMKT: **Reset** in the book panel.
- SXU: Workspace tab, or toggle **SIM** off and on.
- Restart everything: stop `dev:all` with Ctrl-C and start it again.

## Known limits to be upfront about

- The three services are SIM only. Spec015 binding approval (MMKT, COLL) is open.
- Generated collateral books are built in the terminal (spec016 COLL-013); settled profiles are
  meant to move upstream into the model repository later (COLL-T015).
- Liquidity (`/liquidity`) has no model service; spec014 is blocked on decisions.
- The agent worker cannot run jobs until an LLM profile is set in `.env.local`.
- With the global **SIM OFF** switch, some SIM badges show `ERR` by design (fail-closed labelling).
