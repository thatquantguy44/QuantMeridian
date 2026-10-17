# QuantMeridian Money Market API

This package scaffolds the private model-service boundary for MMKT on port `8014`. The
terminal remains responsible for Gold DB reads, SIM selection, rate snapshot construction, and
the rate snapshot hash. This service has no database or market-data client.

The versioned request contract validates the full rate snapshot, preserves each row's status and
normalized `mm_yield_pct`, and requires an explicit `sim_set_id` when the caller selects `SIM`.
It also requires dated cash forecast points, candidate instruments linked to snapshot rows, a
declared horizon, and explicit policy fields (including explicit nulls for undecided limits and
currency aggregation). No policy defaults are inferred. Non-OK rows remain visible as evidence;
the current scaffold does not price or filter instruments because no optimizer model is implemented.

`GET /health` is unauthenticated and reports that the service is not ready for solves. The
capability endpoint and run endpoint require a bearer token in `MONEY_MARKET_API_TOKEN`, a UUID
`X-Correlation-ID`, and the run endpoint also requires `Idempotency-Key`. In production, protected
routes fail closed unless `MMKT_ENV=production` and `MMKT_PRODUCTION_ENABLED=true` are both set.

`POST /v1/runs` validates the typed request and emits a run-attempt metadata record, then returns
`501 MODEL_NOT_IMPLEMENTED`. The metadata is not durable run history and an idempotency key is not
yet enforced against storage. `solver_adapter.py` provides the model-neutral bridge to
`optimization_core` and its independent verifier; the MMKT model is not wired to it yet. This
boundary deliberately does not claim a solve or recommendation.

## Local boundary

Install this package in a Python 3.12 environment and run:

```bash
pip install ./services/optimization_core ./services/money_market_api
cd services/money_market_api
MONEY_MARKET_API_TOKEN=local-token uvicorn money_market_api.app:app --app-dir src --port 8014
```

Health is available at `http://127.0.0.1:8014/health`.
