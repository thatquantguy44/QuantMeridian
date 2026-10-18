# Spec011 build handoff: Money Market Optimizer

**Updated:** 2026-10-18. The approved spec is in `SPEC.md`; task evidence is in `TASKS.md`.

## Current slice

PR #179 carries this slice. The MMKT local service now has two explicit bindings. `local-mmkt-lp-v1` remains a continuous preview. `local-mmkt-execution-v2` solves the ticketed MIP and returns a verified indicative blotter, cutoff timeline, fixed-integer shadow-price labels, and independently verified floor frontier points. The terminal defaults to the ticketed SIM book, requires the v2 binding for that mode, and shows rate-cut/forecast-miss changes using service results. It does not route orders or claim that SIM results are live recommendations.

The SIM book uses dated offers and $25mm lots so its execution plan is operationally legible and responds within the terminal request timeout. The five named scenarios retain explicit SIM rate selection and fail-closed non-OK pricing. Frontiers are computed on the selected run; batch comparison and baselines omit frontier re-solves to keep the demo responsive. Each returned allocation remains independently verified.

## Local run

```bash
pip install ./services/optimization_core -e ./services/money_market_api
MONEY_MARKET_API_TOKEN=local-dev-token MONEY_MARKET_MODEL_BINDING=local-mmkt-execution-v2 \
  uvicorn money_market_api.app:app --app-dir services/money_market_api/src --port 8014
# Set MONEY_MARKET_API_TOKEN=local-dev-token in the terminal .env.local, then restart it.
```

Open `/money-market` and select a SIM set. The service must be READY with binding `local-mmkt-execution-v2`. The terminal does not silently fall back to the LP or Gold data.

## Verified locally in this slice

- `python3 -m unittest discover -s services/money_market_api/tests -p test_execution.py -v`: 7/7 passed. Tests cover min ticket, lots, ticket count, cutoffs, frontier, rate cut, p10 miss, infeasibility, tampered integrality, and the run boundary.
- The real terminal SIM base request, constructed from `src/data/mmkt.ts` and `src/lib/server/mmktSimRateSets.ts`, returned a verified 12-ticket plan and three verified frontier points with modeled returns of $2.756mm, $2.629mm, and $2.498mm at floor multipliers 0.8, 1.0, and 1.2. Runtime was 22.05s in this workspace.
- The same SIM book with frontier re-solves disabled for batch comparison produced five verified scenarios: base $2.629mm, rate cut $2.474mm, fee/gate $2.622mm, p10 miss $1.831mm, downgrade $2.627mm. The cut moved the 4-week bill from $225mm to $900mm and reduced government MMF from $1,300mm to $625mm. The p10 miss reduced government MMF to $850mm and prime MMF to $275mm, and increased first-day tri-party repo from $400mm to $775mm. All five used 12 verified tickets.
- GitHub Actions have no available runner minutes in this session; this workspace has no `pytest`, npm dependencies, or full local repository checkout, so the existing broad suites, typecheck, build, and browser viewports were not run here; an opt-in real-service Playwright path is in `test/optimization-demos.spec.ts`.

## Open integration work

1. Connect Gold `gold.mmkt_rate_snapshot` and reconcile instrument IDs once EcoMedallion coverage is available. Until then the Gold option fails closed.
2. Define a current-positions feed and compute the actual-current-allocation baseline (MM-011).
3. Persist OPT run history and enforce durable idempotency (MM-008/009).
4. Generate cross-language contract parity and run full constraint matrix, typecheck/build, and browser viewport checks in a complete environment (MM-002/010).

WAM/WAL remain days-to-maturity proxies; fund fee/gate and rate assumptions are illustrative SIM inputs. The as-built execution conventions are in `docs/whitepapers/money_market_execution.md`.
