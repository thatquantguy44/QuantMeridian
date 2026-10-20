# Indemnification contracts (spec020)

JSON Schemas (draft 2020-12) for the INDEM service boundary. They are the source of truth;
`src/lib/indemnificationContract.ts` holds the TypeScript types and hash helpers, and
`src/lib/indemnificationContract.test.ts` checks both. The Python service (task IND-T13) will load the
same schemas and fixtures.

| File | Contract |
|---|---|
| `snapshot-1.0.schema.json` | Run request: book, borrowers, credit inputs, pool, run and model settings, pricing, embedded close-out profile. |
| `result-1.0.schema.json` | Run output: metrics by channel with standard errors, with and without wrong-way risk, Euler allocation, owners, cross-check, sensitivities, stresses. |
| `model-card-1.0.schema.json` | Per-run model card (version, input and profile hashes, seed, paths, convergence, validation, limitations). |
| `closeout-profile-1.0.schema.json` | Close-out profile (decision 4). |
| `rating-pd-table-1.0.schema.json` | Illustrative rating to 1-year default probability table (decision 2); embedded in every snapshot so results never depend on a hidden file. |
| `rating-pd-table.default.json` | Shipped default table, labelled ILLUSTRATIVE. |
| `closeout-profile.default.json` | Shipped default profile: the decision 4 values, with every extra setting neutral. |
| `fixtures/snapshot.example.json` | Small valid snapshot (two borrowers, three loans). Labelled SIM; names are fictional. |
| `fixtures/result.example.json` | Valid result. **Shape example only: its numbers are not model output.** |
| `fixtures/hash-vectors.json` | SHA-256 vectors both languages must reproduce. |

Rules the schemas cannot state (`rho_w^2 <= rho_d`, unique ids, references between records, pool owner shares
summing to 1, profile override keys naming real borrowers, positions, asset classes and buckets, a cost cap not
below the half-spread floor) are checked by `snapshotIssues` in the TypeScript module. The service (IND-T13)
must reject a snapshot with any issue before simulating.
