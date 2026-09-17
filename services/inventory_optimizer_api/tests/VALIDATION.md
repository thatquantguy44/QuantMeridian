# IBAL API test & validation master document

Living index of what is tested, how it is organized, and what has been found and fixed along the
way. Update this file in the same change that adds or moves tests -- it should never drift from
`tests/` on disk. Source of truth for scope/acceptance criteria is the InventoryBallast repo at
`specs/0013-market-terminal-integration/tasks.md`; this document tracks how that maps onto the
actual test suite in this repo.

Run everything: `cd services/inventory_optimizer_api && .venv/bin/python -m pytest -q`
Lint: `.venv/bin/python -m ruff check tests/`
Current state: **122 passed**, 0 failed, 0 xfail/skip.

## How the suite is organized

One file per concern, named after what it protects, not after which code module happens to
implement it -- so a reader can find "the auth tests" or "the upload tests" without knowing the
source layout first.

| File | Tests | Protects |
| --- | --- | --- |
| `test_service.py` | 5 | Original end-to-end smoke: synthetic -> solve -> export, template round-trip, one upload rejection each for JSON/XLSX, full authenticated HTTP happy path. |
| `test_synthetic.py` | 15 | Synthetic generation determinism, seed variance, profile/scale shape, a 100-example Hypothesis property test that every generated request passes domain validation. |
| `test_upload_validation.py` | 17 | Upload rejection matrix (type/size/encoding/syntax/root-type/duplicate-key/contract/sheet/column/cell/formula/archive-safety/row-limit), multi-issue aggregation, XLSX<->JSON template hash parity. |
| `test_contract_parity.py` | 1 | Service path vs. calling the `InventoryOptimizer` facade directly with the same request/config match on every deterministic result field. |
| `test_status_matrix.py` | 16 | Every `SolverStatus` passes through the HTTP layer unmodified (never promoted to `optimal`); a real infeasible solve returns HTTP 200, not a transport error; each exception path maps to its documented status code. |
| `test_auth.py` | 25 | Production kill switch (`IBAL_ENV`/`IBAL_PRODUCTION_ENABLED`), bearer-token validation, correlation-ID validation -- both as direct unit calls to `require_service_auth()` and as real HTTP round trips. |
| `test_run_config.py` | 9 | `RunConfig` -> engine overrides allowlist mapping completeness; real (not monkeypatched) MIP/QP conflict triggers, one per trigger condition; unknown run_config fields rejected by the API. |
| `test_request_validation.py` | 5 | The generic `RequestValidationError` handler itself, across multiple endpoints and malformed-body shapes -- see "Bugs found" below. |
| `test_security.py` | 2 | Confidential values in a request never reach service logs on upload or solve rejection (only codes/counts are logged). |
| `test_edge_cases.py` | 9 | Boundary-value sweep using the shared edge-case framework (see below) plus a pinned regression for the joint reserve/utilization bug. |
| `test_economics.py` | 18 | Every `economics` total reconstructed from raw allocation/route/inventory data and checked against a real solved result -- not just internal component-sum bookkeeping, but that `fee_revenue`/`transition_cost` actually reconcile to the notional math, across day-count bases and at boundary configs. |

Shared infrastructure (not test files themselves, collected as 0 tests):

- `conftest.py` -- `auth_headers()` helper; `api_client` fixture (TestClient with a working token
  and `IBAL_ENV=local` pre-set); `raw_client` fixture (TestClient with nothing pre-set, for tests
  that need to control env vars themselves, e.g. auth/kill-switch tests).
- `edge_cases.py` -- the edge-case framework, described next.

## The edge-case framework (`edge_cases.py`)

Purpose: give every test file a single place to pull *named, reusable* boundary conditions from,
instead of hand-rolling one-off "small edge case" configs inline (which is how the same bug can
end up invisible in five files and undiscovered in a sixth).

What it provides:

- `BOUNDARY_SYNTHETIC_CONFIGS` -- a tuple of named `SyntheticConfig` instances, each pushing one or
  more fields to their documented `ge`/`le` limit, in combinations the `profile`/`scale` presets
  never reach (presets keep every field comfortably mid-range). Use
  `@pytest.mark.parametrize("config", BOUNDARY_SYNTHETIC_CONFIGS)` to sweep all of them, or import
  one by name (`EDGE_MAX_EVERYTHING`, `EDGE_SINGLE_ROUTE_FORCED_ELIGIBLE`,
  `EDGE_PARENT_GROUP_EQUALS_BORROWER_COUNT`, `EDGE_TIGHT_UTILIZATION_CAP`,
  `EDGE_MAX_DISCRETE_ROUTES`, `EDGE_MIN_EVERYTHING`) when a test cares about one specific boundary.
- `conflicting_pool_dataset(seed=...)` -- a contract-valid but genuinely LP-infeasible dataset
  (two independently-valid utilization policies on one pool that compile into mutually exclusive
  LP rows). Shared by `test_status_matrix.py` and available to any future test that needs a real
  infeasible result without hand-building one.
- `solve_dataset(dataset, run_config=...)` -- solves a prepared dataset with fresh
  correlation/idempotency identifiers, so call sites don't repeat that boilerplate.

**When you find a new edge case** (a boundary combination that broke something, or one you're
adding pre-emptively): add a named constant to `edge_cases.py` with a one-line comment on *which*
code branch or invariant it exercises, add it to `BOUNDARY_SYNTHETIC_CONFIGS` if it's a general
validity sweep candidate, and write the specific regression assertion in `test_edge_cases.py` (or
the most relevant existing file if the case is about one specific feature, e.g. a new
`test_run_config.py` MIP trigger). Do not duplicate the dataset-construction logic inline in a new
file -- extend `edge_cases.py` instead.

**Field-boundary Hypothesis strategy**: `test_edge_cases.py::test_reserve_and_utilization_combinations_never_go_negative`
is the pattern to copy for a broad, unbiased sweep of a specific cross-field combination (as
opposed to the curated, one-off named configs above): a `@given(...)` over the exact `ge`/`le`
range of each suspect field, `scale="custom"`, small counts to keep it fast, asserting
`dataset.validation.valid`. Reach for this whenever two or more fields jointly bound a physical
quantity (shares, a fraction of 1.0, a rate) -- that is where per-field bounds checks miss things.

## Bugs found and fixed via this suite

Kept here (not just in commit messages) because these are exactly the failure modes the "next"
feature's tests should also check for -- patterns, not just instances.

1. **XLSX/JSON template hash mismatch** (found while writing `test_upload_validation.py`,
   2026-09-17). `fee_rate`/`elasticity` were generated unrounded in `synthetic.py`, losing
   precision through XLSX's float serialization; a redundant `metadata.source_mode`/
   `generator_version` pair had no XLSX sheet to round-trip through. Fixed by rounding those two
   fields to 6dp (matching every other synthetic field) and dropping the redundant metadata key.
   Pattern: **any field that skips the project's "round to 6dp" convention is a latent XLSX
   round-trip bug** -- check new synthetic fields against this.

2. **Negative `available_to_lend_shares` at joint parameter extremes** (found by
   `edge_cases.EDGE_MAX_EVERYTHING`, 2026-09-17). `starting_utilization` was clamped against
   `utilization_cap` alone; with `reserve_fraction` also near its independent maximum,
   `on_loan + reserve` could exceed `total`, producing negative available shares and routes with
   `current_quantity_shares > maximum_quantity_shares`. Both fields were individually in-bounds --
   the bug only existed in combination. Fixed by also capping `starting_utilization` against the
   room `reserve_fraction` leaves behind. Pattern: **`SyntheticConfig` has one explicit
   cross-field validator (`parent_group_count <= borrower_count`); every other pair of fields that
   jointly bound a share/fraction quantity has no such check** -- swept broadly with a Hypothesis
   strategy in `test_edge_cases.py` rather than trusting the one instance found.

3. **`RequestValidationError` handler crashed on every malformed request body** (found by
   `test_run_config.py::test_unknown_run_config_field_is_rejected_by_the_api`, 2026-09-17).
   `app.py`'s handler called `exc.errors(include_url=False, include_context=False,
   include_input=False)`, assuming pydantic's `ValidationError.errors()` signature. FastAPI's own
   `RequestValidationError` (a `ValidationException` subclass, not a pydantic `ValidationError`)
   has `errors(self) -> Sequence[Any]` -- no keyword arguments -- in the pinned FastAPI 0.116.1.
   Every request body that failed FastAPI's own Pydantic parsing (wrong type, extra field, missing
   field, malformed JSON) raised `TypeError` inside the handler itself, which the catch-all
   `Exception` handler silently converted to a generic `500 INTERNAL_ERROR` instead of the
   intended `422 REQUEST_CONTRACT_INVALID`. Invisible until now because no prior test sent a body
   that failed FastAPI's own request-parsing layer (as opposed to `upload.py`'s separate parsing,
   which correctly uses a real pydantic `ValidationError` and was never affected). Fixed by calling
   `exc.errors()` with no arguments. Regression-pinned broadly across endpoints and malformed-body
   shapes in `test_request_validation.py`, not just the one call site that surfaced it. Pattern:
   **library exception classes that share a name/lineage with a well-known type (here, "looks like
   a pydantic error") can silently have a different method signature -- verify against the
   installed version, don't assume by name.**

No new bug surfaced while building `test_economics.py` (AC-014, 2026-09-17), but the formulas
themselves were not documented anywhere and had to be reverse-engineered empirically against a
real solved result before any assertion could be written with confidence (see the module
docstring in `test_economics.py` for the exact formulas and how they were derived). Worth noting
as its own pattern: **for engine-owned computed fields with no public formula documentation,
verify the relationship empirically against several real solved results before writing a
"reconciliation" assertion -- a plausible-looking guess (e.g. `shares * fee_rate` without price or
day-count) will pass a shallow eyeball check and then fail immediately against real data, or worse,
silently encode the wrong formula as "passing".**

## Acceptance-criteria coverage map

Cross-referenced against `specs/0013-market-terminal-integration/tasks.md` in the InventoryBallast
repo. `DONE` means real, passing, non-monkeypatched-only coverage exists here; `PARTIAL` means some
real coverage exists but the criterion has scope this repo hasn't reached yet; `TODO` means no
coverage. The spec's own `tasks.md` still marks all of T-001-T-015 as `todo` and is not kept in
sync with this table -- trust this table for backend Python scope, not that file.

| AC | Target | Status | Covering test(s) |
| --- | --- | --- | --- |
| AC-001 | IBAL route independently gated, OPT unchanged | TODO | Frontend/nav scope; not started. |
| AC-002 | Service and direct-facade match on deterministic fields | DONE | `test_contract_parity.py` |
| AC-003 | Invalid upload never falls back to synthetic or solves | PARTIAL | Backend never silently falls back (no fallback code path exists to test); frontend reducer-level assertion not started. |
| AC-004 | Same complete config is byte-identical | DONE | `test_synthetic.py::test_same_complete_config_is_byte_identical` |
| AC-005 | Seed change changes observations, not schema | DONE | `test_synthetic.py::test_seed_change_changes_observations_not_schema`, `::test_profile_and_scale_presets_resolve_expected_shape` |
| AC-006 | Generated requests pass domain/reconciliation validation | DONE | `test_synthetic.py::test_generated_requests_pass_domain_and_reconciliation_validation` (100-example property test), `test_edge_cases.py` (boundary sweep) |
| AC-007 | Templates are registry-complete; starter artifacts validate | DONE | `test_service.py::test_templates_round_trip_through_upload_parser`, `test_upload_validation.py::test_equivalent_xlsx_and_json_hash_match` |
| AC-008 | Equivalent XLSX/JSON hash match; parser rejection matrix | DONE | `test_upload_validation.py` (full rejection matrix + hash match) |
| AC-009 | Located issues aggregate without repair/row-drop | DONE | `test_upload_validation.py::test_upload_aggregates_located_independent_errors_without_repair_or_row_drop` |
| AC-010 | Dataset envelope summary matches normalized request | PARTIAL | Implicit in every `generate_dataset`/`envelope_from_request` test (summary is always derived from the same request); no dedicated adversarial test yet. |
| AC-011 | RunConfig allowlist maps 1:1; unknown-setting/MIP-QP conflict tests | DONE | `test_run_config.py` |
| AC-012 | Run revalidates after prepare | PARTIAL | `test_security.py`/`test_status_matrix.py` cover the stale-hash rejection path; proxy/UI solve-readiness (frontend) not started. |
| AC-013 | Status/error matrix: optimal/feasible-limit/infeasible/timeout/numerical/internal | DONE | `test_status_matrix.py` |
| AC-014 | Result-field lineage; economics reconciles to total | DONE (economics); PARTIAL (lineage) | `test_economics.py` reconciles `fee_revenue`/`transition_cost`/totals to raw allocation data. Result-field *lineage presentation* (source/version/status badges) is a frontend concern, not started. |
| AC-015 | Allocations evidence, binding-constraint inspection, no invented trade fields | TODO | Frontend scope; not started. |
| AC-016 | All exports round-trip and tables match engine | PARTIAL | `test_service.py` checks the export bundle contains the right files; no byte/content parity check against `reporting.tables.result_tables()` yet. |
| AC-017 | Dirty-confirmation/session-reset; no server retrieval endpoint | PARTIAL | No server retrieval endpoint exists (nothing to test); frontend reducer state not started. |
| AC-018 | Capability omission; disabled-feature rejection; altered-client-state | PARTIAL | `upload.py::_unsupported_feature_issues` exists and is exercised implicitly; no dedicated capability-omission test yet. |
| AC-019 | Health response/service matrix; outage behavior | PARTIAL | `test_auth.py::test_end_to_end_health_endpoint_is_unauthenticated_even_when_disabled` covers one case; no matrix over engine-identity mismatch / unready states yet. |
| AC-020 | Module-disabled build/runtime; unauthenticated proxy; kill-switch smoke | DONE (backend) | `test_auth.py` full kill-switch + auth matrix. Frontend module-disabled build test not started. |
| AC-021 | Generation/parsing/solve benchmark suite | TODO | No test yet. |
| AC-022 | Confidential sentinels absent from service logs | DONE | `test_security.py` |
| AC-023 | Playwright keyboard/screenshot suite | TODO | Frontend/E2E scope; not started. |
| AC-024 | Clean-checkout CI job | TODO | Explicitly out of scope per current local-only-work directive; see project memory. |

## Next up

Backend items with no test coverage yet, roughly in order of value:

1. **AC-016**: full export round-trip parity -- compare exported CSV content byte-for-byte against
   `reporting.tables.result_tables()` output for a real solved result, not just "the right files
   exist in the zip".
2. **AC-019**: health-endpoint matrix -- engine-identity mismatch (wrong version/commit/backend),
   each surfaced independently, plus the `ready=False`/`error_category="incompatible_engine"` path.
3. **AC-021**: a small benchmark harness (p50/p95/max generation+solve time across the boundary
   configs already defined in `edge_cases.py`) with a retained artifact, per the spec's intent.
4. **AC-010**: a dedicated adversarial test that a tampered/mismatched `DatasetSummary` is actually
   caught somewhere (currently only implicitly true because summaries are always self-generated).

Beyond backend test coverage, the largest untouched piece of the spec remains the frontend
workbench (T-010-T-012: reducer/state machine, result tabs, dirty confirmation) -- see
`docs/handoff.md` for the full remaining-priorities list.
