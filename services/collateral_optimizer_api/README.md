# Collateral Optimizer API

Local SIM adapter for InventoryBallast's separately packaged collateral optimizer. The
reviewed source is `thatquantguy44/InventoryBallast`,
`projects/collateral_optimizer`, commit
`eb74850a0f972ca9e1f40558ecd7909d3e76e6b3` (upstream PR #36).
The root `inventory-optimizer` package and IBAL service pin are independent.

The [binding manifest](binding-manifest.json) records the full commit, the SHA-256 of
each reviewed package file, canonical source digest, deterministic wheel digest,
dependency lock digest, package/adapter versions, native contract versions, and
capabilities. [The builder](../../scripts/build-collateral-wheel.py) checks source
bytes and, with `--require-git`, demands a clean checkout at that exact commit.
The [Dockerfile](Dockerfile) checks out that commit using a BuildKit secret, builds
the wheel, installs exact locked dependencies, and copies only the installed
environment and attestation into the runtime image. No runtime Git fetch occurs.
`/health` reports `UNCONFIGURED` without attestation and `INCOMPATIBLE` on
commit, version, wheel, lock, installed-file, or schema drift; `/v1/runs` then
fails closed.

Run locally after obtaining an authorized checkout at the pinned commit:

```sh
python scripts/build-collateral-wheel.py /path/to/InventoryBallast/projects/collateral_optimizer --output /tmp/collateral-wheel --require-git
python -m venv /tmp/collateral-venv
/tmp/collateral-venv/bin/pip install -r services/collateral_optimizer_api/requirements.lock
/tmp/collateral-venv/bin/pip install --no-deps /tmp/collateral-wheel/collateral_optimizer-0.1.0-py3-none-any.whl
PYTHONPATH=services/collateral_optimizer_api/src COLLATERAL_BINDING_ATTESTATION=/tmp/collateral-wheel/binding-attestation.json COLLATERAL_OPTIMIZER_API_TOKEN=local-secret /tmp/collateral-venv/bin/uvicorn collateral_optimizer_api.app:app --port 8017
```

Set `COLLATERAL_OPTIMIZER_API_URL=http://127.0.0.1:8017` and the same
`COLLATERAL_OPTIMIZER_API_TOKEN` for the terminal. The browser reaches only
same-origin `/api/collateral-optimizer/*`. POST bodies are capped at 2 MiB;
the terminal forwards a service token and correlation ID. Production terminal
requests and `PRODUCTION_BOOK` are blocked while spec015 identity, immutable
storage, audit, source ownership, and shared reservation decisions remain open.
The five model scenarios and validated native JSON uploads are local previews
only. No movement can be executed by this service.

The adapter reruns `verify.assess` against returned target values and checks
allocation metadata, haircut coverage, movements, reserve, all cost components,
incumbent savings eligibility, binding rows, schema and hash lineage, and MIP
dual suppression. Tolerance is 0.01 USD absolute or 1e-6 relative. Infeasible
and rejected candidates expose no allocation or savings.

Run the service tests with
`PYTHONPATH=services/collateral_optimizer_api/src python -m unittest discover -s services/collateral_optimizer_api/tests -v`
in an environment with the pinned wheel, locked dependencies, `httpx`, and a
fresh `COLLATERAL_BINDING_ATTESTATION`. The upstream package tests run separately.
