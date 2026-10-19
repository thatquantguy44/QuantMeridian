# Optimization suite guides

Each optimization module has two documents, readable here and in the terminal (the **Guide** button
on the module's header, or `/guides`):

| Module | White paper / business guide | Help & FAQ | What it is today |
|---|---|---|---|
| OPT · Optimization Center | [opt-whitepaper.md](opt-whitepaper.md) | [opt-help.md](opt-help.md) | Live hub: model health and a verified collateral preview |
| COLL · Collateral Management | [coll-whitepaper.md](coll-whitepaper.md) | [coll-help.md](coll-help.md) | Pinned model, verified; synthetic and generated books |
| IBAL · InventoryBallast | [ibal-whitepaper.md](ibal-whitepaper.md) | [ibal-help.md](ibal-help.md) | Pinned engine, verified; synthetic or uploaded datasets |
| CASH · Cash Optimizer | [cash-whitepaper.md](cash-whitepaper.md) | [cash-help.md](cash-help.md) | Simulated dashboard; no model |
| MMKT · Money Market Optimizer | [mmkt-whitepaper.md](mmkt-whitepaper.md) | [mmkt-help.md](mmkt-help.md) | Verified continuous LP on SIM rates |
| SXU · Sources & Uses | [sxu-whitepaper.md](sxu-whitepaper.md) | [sxu-help.md](sxu-help.md) | Browser PoC optimizer plus a configuration workspace |
| MMFO · Money Market Fund Optimizer | [mmfo-whitepaper.md](mmfo-whitepaper.md) | [mmfo-help.md](mmfo-help.md) | Local POC LP, not independently verified |
| REINV · Cash Reinvestment | [reinv-whitepaper.md](reinv-whitepaper.md) | [reinv-help.md](reinv-help.md) | Simulated dashboard with live yields; no model |
| LIQ · Liquidity Stress | [liq-whitepaper.md](liq-whitepaper.md) | [liq-help.md](liq-help.md) | Simulated cockpit; real model is Spec014 |

## Writing rules

- Every white paper has: Executive summary, Business problem, How it works, Data and provenance,
  Assumptions, Outputs and how to read them, Validation, Limitations, Status and governance, References.
- Every help guide has: Quick start, Screen guide, Assumptions and defaults, FAQ (one `###` per
  question), Troubleshooting, Glossary.
- `src/lib/moduleGuides.test.ts` enforces those sections, checks every internal link and anchor, and
  rejects broken tables and stray markup. Use only the markdown the in-app renderer supports
  (`src/lib/markdown.ts`): headings, paragraphs, lists (one nested level), pipe tables, fenced code,
  blockquotes, rules, and inline code, bold, italic and links. Escape a literal pipe in a table cell as `\|`.
- Link to terminal routes (`/money-market`) and other guides (`/guides/MMKT/help`); write repository
  paths as code, not links.
- When code changes a control, default or formula, update the module's help in the same change.
