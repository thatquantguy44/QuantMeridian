# Sources & Uses model service (spec012)

This package holds the versioned request contracts and canonical hashing for the Sources & Uses
optimizer (`docs/specs/spec012/`, task SU-002). The compatibility engine, LP, verifier and HTTP API
(SU-003 to SU-005 and SU-009) build on it; until then the package has no solver and no endpoint.

## Contracts

`src/sources_uses_api/contracts.py` defines strict Pydantic models: unknown fields are rejected,
no type coercion is done (`"1400"` is not a number), and the version fields are required.

- `ConfigurationContent`: everything a run depends on, at `schema_version` `1.0.0`. Sources,
  uses and compatibility rules, each carrying `provenance` (`user_input` or `sim`). Provenance
  comes from the browser record's explicit `provenance` field, which "Copy to workspace" sets to
  `sim`; it is never read from tags. A configuration's name, ID and timestamps are not part of it.
- `SolveRequest`: `api_schema_version` `1.0.0`, one run `currency`, the configuration and its
  `configuration_hash`.

Validation enforces the owner decisions recorded in `docs/specs/spec012/SPEC.md`:

| Decision | Rule |
|---|---|
| Question 1 | A rule may not `allow` a source to fund a use in another currency. Cross-entity pairs are fine with an explicit rule. |
| Question 2 | Amounts are native currency units and are never rounded, in the model or the hash. |
| Question 3 | Each source's `internality` (`internal`, `external`, `unclassified`) is set by the user, never inferred. |
| Question 4 | Every source and use in a request must be in the run currency; the error names the records that are not, and is reported before any other configuration error. A configuration that stores several currencies cannot be run as a whole. |

The terminal maps the browser's v1 configuration (`src/data/sourcesUses.ts`) onto this contract in
`src/lib/sourcesUsesContract.ts`.

## Hashes

- **Configuration hash:** SHA-256 of the canonical JSON of `ConfigurationContent`, with sources and
  uses sorted by `id` and rules by `(source_id, use_id)`. Reordering records, renaming or re-saving
  a configuration does not change it; changing any record field (a haircut, a label, a note, tag
  order) does, so the hash identifies the exact configuration that was run. The terminal drops
  `unspecified` rules with no note before hashing, as the workspace editor does, and states an
  omitted optional number as `null`.
- **Request (run) hash:** SHA-256 of the canonical request with the configuration replaced by its
  hash. Every future request option is covered automatically.

Canonical JSON (`canonical.py`) is `JSON.stringify` with sorted keys: no whitespace, numbers in
ECMAScript form, non-ASCII left raw. The terminal and the service produce identical bytes; both
test suites check `contracts/sources_uses/fixtures/canonical-vectors.json`. Record IDs are limited
to printable ASCII so that sort order is the same in both languages.

## Published schema

`contracts/sources_uses/solve-request.schema.json` is generated from `SolveRequest`. The terminal's
`src/lib/sourcesUsesContract.test.ts` fails if its TypeScript types drift from it. After an
intended contract change, regenerate it and re-run both suites:

```bash
cd services/sources_uses_api
SXU_UPDATE_CONTRACT_SCHEMA=1 pytest tests/test_contracts.py
```

## Tests

```bash
pip install -e ./services/sources_uses_api pytest ruff
cd services/sources_uses_api && ruff check . && pytest -q
```
