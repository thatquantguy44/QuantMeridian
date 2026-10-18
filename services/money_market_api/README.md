# QuantMeridian Money Market API

The private MMKT model service listens on port `8014`. The terminal owns Gold reads,
explicit SIM selection, normalized rate snapshots, and snapshot hashes. The service has
no database connection or market-data client.

`POST /v1/runs` solves a multi-period cash allocation with SciPy HiGHS and independent
verification of bounds, rows, integrality, and objective reconstruction. The default
binding is disabled. `local-mmkt-lp-v1` permits only the continuous LP preview;
`local-mmkt-execution-v2` permits the verified ticketed MIP. The latter enforces
minimum ticket, integer lot, maximum ticket count, and dated cutoff constraints.
The returned blotter is an indicative, cutoff-ordered plan. No orders are routed.
An infeasible or unverified solve returns no allocation or blotter.

Every run retains the request and rate-snapshot hashes, source and as-of date, SIM set,
forecast case, model family, and assumptions. Only `status=ok` rates with normalized
`mm_yield_pct` are priced. Cash continuity uses the selected p10/p50/p90 residual case;
forecast quantiles are supplied inputs, not calibrated probabilities. Returns use
simple ACT/365 on normalized annual yield, explicit costs are charged once, cash earns
zero, and currencies solve independently. WAM/WAL use days-to-maturity proxies.

LP shadow prices are local objective changes in USD per extra $1mm of a row RHS.
MIP duals are undefined: ticketed runs report marginals from a separately verified LP
with all integer decisions fixed, labeled `FIXED_INTEGER_LP`. Liquidity frontier points
are separately solved and verified at the requested floor multipliers. An infeasible
point has no objective. The service does not claim sensitivity ranges.

`/health` is public. `/v1/capabilities` and `/v1/runs` require the configured bearer
token and UUID correlation ID; runs also require `Idempotency-Key`. Production is off
unless explicitly enabled. Idempotency keys are hashed in logs but do not provide a
durable replay cache. Run history is not yet persisted.

## Local run

```bash
pip install ./services/optimization_core -e ./services/money_market_api
MONEY_MARKET_API_TOKEN=local-token MONEY_MARKET_MODEL_BINDING=local-mmkt-execution-v2 \
  uvicorn money_market_api.app:app --app-dir services/money_market_api/src --port 8014
```

Set the same `MONEY_MARKET_API_TOKEN` in the terminal's `.env.local`, restart the
terminal, and open `/money-market`. Run `pytest services/money_market_api/tests` after
installing the service's test dependencies.
