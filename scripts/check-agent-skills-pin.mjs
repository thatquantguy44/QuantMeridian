import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const pinPath = "contracts/agent/agent-skills.pin.json";
const expectedRepository = "thatquantguy44/agent-skills";
const expectedSkills = [
  "using-agent-skills",
  "incremental-implementation",
  "test-driven-development",
  "doubt-driven-development",
  "code-review-and-quality",
  "frontend-ui-engineering",
];

function fail(message) {
  console.error(`Agent Skills pin check FAILED — ${message}`);
  process.exitCode = 1;
}

const pin = JSON.parse(await readFile(pinPath, "utf8"));
if (pin.schema_version !== "agent-skills-pin/2") fail("unsupported pin schema");
if (pin.source?.repository !== expectedRepository) fail("unexpected source repository");
if (!/^[0-9a-f]{40}$/.test(pin.source?.commit ?? "")) fail("source commit must be a full immutable SHA");
if (JSON.stringify(pin.skills) !== JSON.stringify(expectedSkills)) fail("required skill set changed");
if (!Array.isArray(pin.files) || pin.files.length < expectedSkills.length) fail("pinned file list is incomplete");

for (const file of pin.files ?? []) {
  const localPath = file.local_path;
  if (typeof localPath !== "string" || path.isAbsolute(localPath) || localPath.split(/[\\/]/).includes("..")) {
    fail(`unsafe local path: ${localPath}`);
    continue;
  }

  let bytes;
  try {
    bytes = await readFile(localPath);
  } catch {
    fail(`missing pinned file: ${localPath}`);
    continue;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const gitBlobSha = createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest("hex");
  if (file.sha256 !== `sha256:${sha256}`) fail(`SHA-256 mismatch: ${localPath}`);
  if (file.git_blob_sha !== gitBlobSha) fail(`source Git blob mismatch: ${localPath}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(
  `Agent Skills pin PASSED — ${pin.source.repository}@${pin.source.commit.slice(0, 12)} (${pin.files.length} files).`,
);
