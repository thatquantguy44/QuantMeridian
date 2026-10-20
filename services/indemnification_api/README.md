# INDEM service (spec020)

Borrower-default and reinvestment indemnification risk for an agency lender. A Monte Carlo of markets and
borrower defaults, closed out under a configurable close-out profile. It has no database; it simulates the
snapshot it is given and substitutes nothing. Everything it produces from the SIM book is labelled `SIM`.

Specification: `docs/specs/spec020/` (start with `HANDOFF.md`). Wire contract: `contracts/indemnification/`.

**Status: the model core is built (no HTTP API yet).** See the handoff for what remains.

## Run the tests

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e "services/indemnification_api[dev]" ruff
cd services/indemnification_api
ruff check . && pytest -q          # about 35 s; CI runs the same on Python 3.12
```

## Try it on the simulated book

```python
import json
from indemnification_api.contracts import seal
from indemnification_api.engine import simulate

book = json.load(open("contracts/indemnification/fixtures/sim-book.example.json"))
book["run"].update(mode="desk", horizon_days=21, step="daily", paths=5000)
out = simulate(seal(book))          # validates schema, cross-field rules and hash first
out.variants["gaussian_ww"].cond.sum(axis=1).mean()   # expected loss, default channel
```

`seal` recomputes `snapshot_hash` after you edit a snapshot. The book is built by
`src/data/indemnificationBook.ts` (`buildSimSnapshot`) from the SLAB loan book.

## Modules

| Module | Role |
|---|---|
| `canonical.py`, `contracts.py` | Canonical JSON and the snapshot and profile hashes; byte-identical to `src/lib/indemnificationContract.ts`. |
| `schema.py`, `validation.py` | Reject a snapshot before any simulation: JSON Schema, cross-field rules (mirrors `snapshotIssues`), hash. |
| `credit.py` | Rating table or user spread, to a constant hazard rate per borrower. |
| `profile.py` | Resolve every close-out setting per position (position, borrower, asset class or pool bucket, default). |
| `grid.py` | Desk and annual run modes and the event grid. |
| `market.py` | Four correlated factors, security prices (daily), squeeze jumps, martingale drifts. |
| `defaults.py` | One-factor copula with a signed wrong-way link, Student-t variant, conditional step probabilities. |
| `book.py` | Loans and collateral as arrays and legs; wrong-way signs. |
| `closeout.py` | Shortfall if a borrower defaults at each event step, and margin-period-of-risk exposure. |
| `metrics.py` | EL, EPE, PFE, VaR, ES with standard errors; Euler allocation. |
| `engine.py` | Chunked runs with per-chunk seed streams; three default variants on shared draws. |

## Memory and speed

Exposures are stored as `paths x borrowers x (event days + 1)` float32; runs over 2 GB are refused. On the SIM
book (16 borrowers) 5,000 paths take about 2.5 s for the desk view and 14 s for the annual view with weekly
steps, so a 50,000-path annual run is roughly 2.5 minutes. Prices are simulated daily to the horizon plus the
longest close-out period, in chunks of 5,000 paths.
