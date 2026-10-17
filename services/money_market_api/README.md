# QuantMeridian Money Market API

This package provides the private model-service boundary for MMKT on port `8014`. The
terminal remains responsible for Gold DB reads, SIM selection, rate snapshot construction, and
the rate snapshot hash. This service has no database or market-data client.

`POST /v1/runs` now builds a sparse continuous LP with the shared
`services/optimization_core` package, solves through SciPy HiGHS, and independently verifies
variable bounds, every model row, and the reconstructed objective before returning allocations.
Only `status=ok` rate rows with normalized `mm_yield_pct` can be priced. Infeasible runs return
no allocation. Run metadata includes the request and rate-snapshot hashes, source, as-of date,
and explicit SIM set ID where applicable. Run history is not yet persisted.

The result is a **continuous LP relaxation**, not an execution-ready blotter. It does not enforce
minimum tickets, lot sizes, ticket-count limits, or cutoffs; `execution_ready` is always false.
WAM/WAL use candidate days-to-maturity as a disclosed proxy because v1.0.0 has no reset or
amortization schedule. Rating floors use a simplified common long-term notch map; candidates with
unrecognized ratings are excluded when a floor applies. Cash forecast residuals use the selected `policy.cash_forecast_case` quantile (`p10` downside, `p50` base, or `p90` upside); each run records the selected case, and callers can submit one run per case for comparison. Account opening cash is rebased across periods using the selected flows. The p10/p50/p90 labels are supplied forecast quantiles, not calibrated probabilities;
supplied rates are held constant across the horizon; cash earns zero yield; holding return uses
simple ACT/365 on normalized annual yield; explicit costs are charged once per purchase; and
currencies are optimized independently. Unsupported or inconsistent account cash-continuity
inputs fail closed. These conventions are returned with every solve.

By default, `GET /health` and `/v1/capabilities` report `UNCONFIGURED`, solving is disabled,
and `POST /v1/runs` returns `501 MODEL_NOT_CONFIGURED`. An operator can explicitly select the
local prototype with `MONEY_MARKET_MODEL_BINDING=local-mmkt-lp-v1`; health and capabilities then
identify the binding, and the run endpoint enables the LP. This is a deployment choice, not a
browser-controlled setting. The capability endpoint and run endpoint also require a bearer token
in `MONEY_MARKET_API_TOKEN`, a UUID `X-Correlation-ID`, and runs require `Idempotency-Key`.
Production proxy access is separately gated by terminal configuration.

The shared optimization core is installed with the API. The idempotency key is logged as a hash
but not enforced against durable storage. No order is placed and the service does not make a trade
recommendation.

## Local boundary

Install both packages in a Python 3.12 environment and run:

```bash
pip install ./services/optimization_core ./services/money_market_api
cd services/money_market_api
MONEY_MARKET_API_TOKEN=local-token uvicorn money_market_api.app:app --app-dir src --port 8014
```

Health is available at `http://127.0.0.1:8014/health`.
