# QuantMeridian-Core build definition

`QuantMeridian-Core` is this repository minus its securities-finance components. This directory
defines the subset; `scripts/downstream/build-core.mjs` builds it from the tracked files at a git ref:

```bash
node scripts/downstream/build-core.mjs --out /tmp/core --ref HEAD --report /tmp/core-report.json
```

| Piece | What it does |
| --- | --- |
| `manifest.json` | Excluded modules, routes, and paths; the leak scan; the downstream repository name. |
| `transforms.mjs` | Line-oriented edits to registry-shaped files (router, nav, module config, agent settings). Keyed by module code, so an upstream change elsewhere in these files cannot break the build. Text replacements fail loudly when upstream changes the target. |
| `patches/*.patch` | Semantic edits to individual files (`git apply`, applied in name order). A patch that no longer applies fails the build and must be refreshed. |
| `files/` | Files that exist only downstream, or replace an upstream file (for example the macro Copilot and an empty desk dataset registry). |

## Boundary

Excluded: securities-finance modules, pages, API routes, data files, services, and runnable agent
code (desk datasets, the carry workflow runtime). Kept as inert vocabulary: contract schemas and
generated types that mention `secfin.carry`, because the workflow config schema requires it.
Desk-lens wording inside macro pages (for example the rate-vol playbook) is content and stays.

## Adding an exclusion

Add the path to `exclude` in `manifest.json`, and the module code to `excluded_modules` and its
route to `excluded_routes` if it is a module. Build, then run the type-check, tests, and build in
the output directory. The build's leak scan lists any reference to an excluded component that
survived; fix it with a transform (registry-shaped lines) or a patch (anything else).

## Refreshing a patch

Build without the patch, edit the file in the output tree, then
`git diff --no-index` it against the upstream copy (or `git init` the output, commit it, edit, and
`git diff -- <file>`), and replace the patch file.

## Sync

`.github/workflows/sync-core.yml` runs on every push to `main`: build the subset, install and
regenerate the metric registry in it, copy it into a checkout of `QuantMeridian-Core`
(`scripts/downstream/sync-core.sh`), push `sync/upstream`, open or update one PR, and merge it once
the downstream's CI is green. An identical build produces no commit, so pushes that touch only
excluded files do nothing. The PR is not auto-merged when the leak scan reports a surviving reference
to an excluded component, and a failed build (a patch that no longer applies, a transform target
that changed, or a secret-scan finding) opens an issue in this repository.

Setup: create a fine-grained personal access token with **Contents** and **Pull requests**
(read and write) on `QuantMeridian-Core` only, and add it to this repository as the
`CORE_SYNC_TOKEN` Actions secret. Without it the workflow skips itself.

## Public-safety scan

The downstream is public, so the build fails on provider keys, tokens, private keys, database URLs
with non-placeholder passwords, and any env file other than `.env.example`
(`scripts/downstream/secret-scan.mjs`, rules under `secret_scan` in the manifest).
