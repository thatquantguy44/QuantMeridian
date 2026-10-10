#!/usr/bin/env node
/**
 * Builds QuantMeridian-Core: this repository's tracked files at <ref>, minus the securities-finance
 * components named in downstream/core/manifest.json, plus the downstream's own transforms, patches,
 * and overlay files. Deterministic: the same ref and manifest produce the same tree.
 *
 *   node scripts/downstream/build-core.mjs --out <dir> [--ref HEAD] [--report <file>]
 *
 * Steps: export tracked files -> exclude -> transforms (registry-shaped files) -> patches (semantic
 * edits) -> overlay files -> leak scan. Exit 1 when a transform or patch cannot apply; the leak scan
 * findings are written to the report (needs_review) for the sync workflow to act on.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scanForSecrets } from "./secret-scan.mjs";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const out = arg("--out"); const ref = arg("--ref") ?? "HEAD"; const reportPath = arg("--report");
if (!out) { console.error("usage: build-core.mjs --out <dir> [--ref HEAD] [--report <file>]"); process.exit(2); }

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const coreDir = path.join(root, "downstream/core");
const manifest = JSON.parse(fs.readFileSync(path.join(coreDir, "manifest.json"), "utf8"));
const outDir = path.resolve(out);
const report = { ref, source_commit: "", excluded_files: 0, transforms: [], patches: [], overlay_files: 0, errors: [], needs_review: [] };

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}
function walk(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files;
}

// 1. Export the tracked files at <ref>.
report.source_commit = execFileSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" }).trim();
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
const archive = execFileSync("git", ["archive", "--format=tar", ref], { cwd: root, maxBuffer: 1 << 30 });
execFileSync("tar", ["-x", "-C", outDir], { input: archive });

// 2. Exclude.
const excludes = manifest.exclude.map(globToRegExp);
for (const file of walk(outDir)) {
  if (excludes.some((re) => re.test(file))) { fs.rmSync(path.join(outDir, file)); report.excluded_files++; }
}

// Remove directories emptied by the exclusions (git does not track them, but they confuse diffs of the tree).
(function pruneEmpty(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) pruneEmpty(path.join(dir, entry.name));
  if (dir !== outDir && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
})(outDir);

// 3. Transforms: small, declarative edits for registry-shaped files (routes, nav entries, JSON settings).
const transforms = (await import(pathToFileURL(path.join(coreDir, "transforms.mjs")).href)).default;
const ctx = { manifest, outDir, excludedModules: new Set(manifest.excluded_modules) };
for (const t of transforms) {
  const file = path.join(outDir, t.file);
  if (!fs.existsSync(file)) { report.errors.push(`transform target missing: ${t.file}`); continue; }
  const before = fs.readFileSync(file, "utf8");
  let after;
  try { after = t.apply(before, ctx); } catch (error) { report.errors.push(`transform ${t.file}: ${error.message}`); continue; }
  if (after !== before) fs.writeFileSync(file, after);
  report.transforms.push({ file: t.file, changed: after !== before });
}

// 4. Patches: semantic edits that keep the rest of the file flowing from upstream.
const patchDir = path.join(coreDir, "patches");
for (const name of fs.existsSync(patchDir) ? fs.readdirSync(patchDir).filter((f) => f.endsWith(".patch")).sort() : []) {
  const patch = path.join(patchDir, name);
  try {
    execFileSync("git", ["apply", "--whitespace=nowarn", patch], { cwd: outDir, stdio: "pipe" });
    report.patches.push({ name, applied: true });
  } catch (error) {
    report.patches.push({ name, applied: false });
    report.errors.push(`patch ${name} no longer applies: ${String(error.stderr ?? error.message).trim().split("\n")[0]}`);
  }
}

// 5. Overlay: files that only exist downstream (README, CI workflow, replacements).
const filesDir = path.join(coreDir, "files");
if (fs.existsSync(filesDir)) {
  for (const rel of walk(filesDir)) {
    const dest = path.join(outDir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(filesDir, rel), dest); report.overlay_files++;
  }
}
const manifestHash = createHash("sha256").update(fs.readFileSync(path.join(coreDir, "manifest.json"))).digest("hex").slice(0, 16);
fs.writeFileSync(path.join(outDir, ".downstream-sync.json"), JSON.stringify({ source_repo: "thatquantguy44/QuantMeridian", source_commit: report.source_commit, manifest: manifestHash }, null, 2) + "\n");

// 6. Leak scan: component identifiers that must not survive in the downstream.
const scan = manifest.leak_scan; const patterns = scan.patterns.map((p) => new RegExp(p));
for (const dir of scan.paths) {
  const base = path.join(outDir, dir); if (!fs.existsSync(base)) continue;
  for (const rel of walk(base)) {
    const full = `${dir}/${rel}`;
    if (!/\.(ts|tsx|js|mjs|json|py|sh|md|yml|yaml)$/.test(rel) || /\.generated\.|generated\/|fixtures\//.test(full) || (scan.allow ?? []).includes(full) || (scan.allow_globs ?? []).some((g) => globToRegExp(g).test(full))) continue;
    const lines = fs.readFileSync(path.join(base, rel), "utf8").split("\n");
    lines.forEach((line, i) => { for (const re of patterns) if (re.test(line)) report.needs_review.push(`${full}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
}

// 7. Secret scan: hard failure, because the downstream is public.
for (const finding of scanForSecrets(outDir, manifest.secret_scan)) report.errors.push(`secret scan: ${finding}`);

if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`core build @ ${report.source_commit.slice(0, 8)}: ${report.excluded_files} files excluded, ${report.transforms.filter((t) => t.changed).length} transforms, ${report.patches.filter((p) => p.applied).length}/${report.patches.length} patches, ${report.overlay_files} overlay files`);
for (const e of report.errors) console.error(`ERROR ${e}`);
for (const l of report.needs_review.slice(0, 40)) console.error(`LEAK  ${l}`);
if (report.needs_review.length > 40) console.error(`LEAK  ... ${report.needs_review.length - 40} more`);
process.exit(report.errors.length ? 1 : 0);
