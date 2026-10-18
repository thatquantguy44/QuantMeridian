# market_lens_studio (dormant)

The original Python/Flask analytics engine behind the `/market-lens` page: configurable market
views (all-time-high forward returns, drawdowns, VIX event studies, credit, rates, cross-asset)
with lineage tracking and generated narratives.

## Status: not used at runtime

The terminal no longer calls this package. `src/app/api/market-lens/route.ts` computes the
analysis in TypeScript (`src/data/marketLens.ts`) over Gold DB data, and `MARKET_LENS_URL` was
removed in the Gold DB migration (Phase 4). Nothing in this repository imports it, no port is
reserved for it, and `scripts/dev-all.sh` does not start it.

It is kept as the reference implementation of the analytics. Known gaps are tracked in
`docs/gaps/GOLD_DB_MIGRATION_REMAINING_GAPS.md` (G2 and G11).

## Layout

```
src/market_lens_studio/   package (imports are absolute: `from market_lens_studio...`)
```

There is no `pyproject.toml` yet. To import it, put `src/` on the path:

```bash
PYTHONPATH=services/market_lens_studio/src python -c "import market_lens_studio"
```

Design brief: `docs/features/completed/Feature Addition - Market Lens Studio.md`.
