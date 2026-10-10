# QuantMeridian-Core

A Bloomberg-style terminal for **macro and market intelligence**: Treasury curve and rates analytics,
inflation, credit, policy rates, an economic calendar, statistical and regime analysis, market
snapshots and charting studios, volatility, news and sentiment, prediction markets, and an AI
Copilot over the latest macro data. Data comes from a Gold macro database (Postgres or SQLite) fed by
the FRED pipeline.

> **This repository is generated.** It is a subset of a private upstream project (QuantMeridian)
> with the securities-finance modules removed, and a bot syncs it from upstream whenever upstream
> changes. Please do not open pull requests here: edits to synced files are overwritten on the next
> sync. Open an issue instead.

## Run it

```bash
npm ci
npm run dev        # http://localhost:3001
```

Without a database the pages show explicit empty or `ERR` states rather than invented numbers. To
point it at data:

```bash
MACRO_DB_URL=sqlite:./data/fred_local.db npm run dev
# or a Postgres Gold database:
MACRO_DB_URL=postgres://user:password@host/db npm run dev
```

Copy `.env.example` to `.env` for the full list of settings. The AI Copilot and ECOIQ need an LLM
profile (see `settings/llm_profiles.json`; for example `ANTHROPIC_API_KEY`, or a local
OpenAI-compatible server through `LOCAL_LLM_BASE_URL` and `LOCAL_LLM_MODEL`). Without one they fall
back to deterministic answers.

## Checks

```bash
npm run typecheck && npm test && npm run build
cd services/agent_worker && pip install -e ".[dev]" && ruff check . && pytest -m "not needs_quantsmith"
```

## What is not here

The securities-finance desk modules (securities lending, prime finance, collateral, cash and
liquidity optimization, the inventory optimizer, the trading desk and assistant) and their data,
APIs, and services are excluded. The agent contract schemas still mention a disabled `secfin.carry`
workflow as inert vocabulary.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE). Third-party
dependencies are licensed separately by their authors.
