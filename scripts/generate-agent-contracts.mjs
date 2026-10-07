#!/usr/bin/env node
/**
 * Generate TypeScript types and Python (pydantic v2) models from contracts/agent/*.schema.json.
 *
 *   node scripts/generate-agent-contracts.mjs          # write the generated files
 *   node scripts/generate-agent-contracts.mjs --check  # fail when committed output is stale
 *   node scripts/generate-agent-contracts.mjs --ts-only   # skip Python (local convenience)
 *
 * Outputs (committed, never edited by hand):
 *   src/lib/agent/contracts/<name>.generated.ts
 *   services/agent_worker/src/agent_worker/contracts_generated/<name>.py
 *
 * The Python generator is datamodel-code-generator, run as `$AGENT_PYTHON -m
 * datamodel_code_generator` (default python3; the worker's dev dependencies install it).
 * --check without --ts-only requires it, so CI cannot silently skip the Python half.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_DIR = path.join(ROOT, "contracts", "agent");
const TS_DIR = path.join(ROOT, "src", "lib", "agent", "contracts");
const PY_DIR = path.join(ROOT, "services", "agent_worker", "src", "agent_worker", "contracts_generated");
const PYTHON = process.env.AGENT_PYTHON || "python3";

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const tsOnly = args.has("--ts-only");

const schemas = fs
  .readdirSync(SCHEMA_DIR)
  .filter((f) => f.endsWith(".schema.json"))
  .sort()
  .map((f) => f.replace(/\.schema\.json$/, ""));

const pyModule = (name) => name.replace(/-/g, "_");
const BANNER = (name) =>
  `/* eslint-disable */\n/**\n * GENERATED from contracts/agent/${name}.schema.json by scripts/generate-agent-contracts.mjs.\n * Do not edit by hand; run \`npm run generate:agent-contracts\`.\n */`;

async function generateTs(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of schemas) {
    const ts = await compileFromFile(path.join(SCHEMA_DIR, `${name}.schema.json`), {
      bannerComment: BANNER(name),
      additionalProperties: false,
      unreachableDefinitions: true,
      cwd: SCHEMA_DIR,
      format: true,
    });
    // The "referenced by `undefined`" notes carry no information (the root has no name here).
    const cleaned = ts.replace(
      /\/\*\*\n \* This interface was referenced by `undefined`'s JSON-Schema\n \* via the `definition` "[^"]+"\.\n \*\/\n/g,
      "",
    );
    fs.writeFileSync(path.join(outDir, `${name}.generated.ts`), cleaned);
  }
}

function pythonAvailable() {
  try {
    execFileSync(PYTHON, ["-m", "datamodel_code_generator", "--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function generatePy(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "__init__.py"),
    '"""Pydantic models generated from contracts/agent/*.schema.json. Do not edit by hand."""\n',
  );
  for (const name of schemas) {
    execFileSync(
      PYTHON,
      [
        "-m", "datamodel_code_generator",
        "--input", path.join(SCHEMA_DIR, `${name}.schema.json`),
        "--input-file-type", "jsonschema",
        "--output", path.join(outDir, `${pyModule(name)}.py`),
        "--output-model-type", "pydantic_v2.BaseModel",
        "--target-python-version", "3.12",
        "--use-annotated",
        "--field-constraints",
        "--use-standard-collections",
        "--use-union-operator",
        "--disable-timestamp",
        "--custom-file-header", `# GENERATED from contracts/agent/${name}.schema.json by scripts/generate-agent-contracts.mjs.\n# Do not edit by hand; run \`npm run generate:agent-contracts\`.`,
      ],
      { stdio: "pipe" },
    );
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.startsWith("__pycache__")).sort();
}

function diffDirs(committed, fresh) {
  const problems = [];
  const names = new Set([...listFiles(committed), ...listFiles(fresh)]);
  for (const f of names) {
    const a = path.join(committed, f);
    const b = path.join(fresh, f);
    if (!fs.existsSync(a)) problems.push(`missing: ${path.relative(ROOT, a)}`);
    else if (!fs.existsSync(b)) problems.push(`stale (no schema): ${path.relative(ROOT, a)}`);
    else if (fs.readFileSync(a, "utf8") !== fs.readFileSync(b, "utf8")) problems.push(`out of date: ${path.relative(ROOT, a)}`);
  }
  return problems;
}

if (!tsOnly && !pythonAvailable()) {
  console.error(
    `${PYTHON} -m datamodel_code_generator is not available. Install the worker dev dependencies ` +
      "(pip install -e 'services/agent_worker[dev]'), set AGENT_PYTHON, or pass --ts-only.",
  );
  process.exit(2);
}

if (!check) {
  await generateTs(TS_DIR);
  if (!tsOnly) generatePy(PY_DIR);
  console.log(`Generated ${schemas.length} contract(s)${tsOnly ? " (TypeScript only)" : ""}.`);
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-contracts-"));
try {
  const problems = [];
  await generateTs(path.join(tmp, "ts"));
  problems.push(...diffDirs(TS_DIR, path.join(tmp, "ts")));
  if (!tsOnly) {
    generatePy(path.join(tmp, "py"));
    problems.push(...diffDirs(PY_DIR, path.join(tmp, "py")));
  }
  if (problems.length) {
    console.error("Agent contract generation drift:\n  " + problems.join("\n  "));
    console.error("Run `npm run generate:agent-contracts` and commit the result.");
    process.exit(1);
  }
  console.log("Agent contracts are up to date.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
