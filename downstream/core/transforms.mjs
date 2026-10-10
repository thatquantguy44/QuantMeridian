/**
 * Declarative edits for the registry-shaped files whose lines are keyed by module code or route:
 * the router, the navigation list, and the JSON settings. Line-oriented on purpose so an upstream
 * change elsewhere in these files cannot break the downstream build. Semantic edits live in patches/.
 */
import fs from "node:fs";
import path from "node:path";

const dropLines = (text, test) => text.split("\n").filter((line) => !test(line)).join("\n");
const jsonEdit = (text, edit) => { const doc = JSON.parse(text); edit(doc); return `${JSON.stringify(doc, null, 2)}\n`; };

/** Removes `import X from "./relative/path"` lines whose target no longer exists in the output tree. */
function dropDanglingImports(text, file, ctx) {
  return dropLines(text, (line) => {
    const match = line.match(/^import\s.+\sfrom\s+"(\.{1,2}\/[^"]+)";?\s*$/);
    if (!match) return false;
    const base = path.resolve(ctx.outDir, path.dirname(file), match[1]);
    return ![".tsx", ".ts", "/index.tsx", "/index.ts", ""].some((ext) => fs.existsSync(base + ext) && fs.statSync(base + ext).isFile());
  });
}

/** Exact-text replacement that fails loudly when upstream has changed the target. */
function replaceOnce(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`expected text not found in ${file}: ${from.slice(0, 60)}`);
  return text.replace(from, to);
}
const codesOf = (ctx) => [...ctx.excludedModules];
const routesOf = (ctx) => ctx.manifest.excluded_routes;
/** Removes quoted excluded module codes from one-line array literals such as ["HOME", "SLAB", "PB"]. */
const stripCodesInArrays = (text, ctx) => text.split("\n").map((line) => {
  if (!/\[[^\]]*"[A-Z]+"/.test(line)) return line;
  let out = line;
  for (const code of codesOf(ctx)) out = out.replace(new RegExp(`"${code}",\\s*`, "g"), "").replace(new RegExp(`,\\s*"${code}"(?=\\s*\\])`, "g"), "");
  return out;
}).join("\n");

export default [
  {
    file: "src/App.tsx",
    apply: (text, ctx) => dropDanglingImports(dropLines(text, (line) => [...ctx.excludedModules].some((code) => line.includes(`on("${code}") &&`))), "src/App.tsx", ctx),
  },
  { file: "src/lib/nav.ts", apply: (text, ctx) => dropLines(text, (line) => [...ctx.excludedModules].some((code) => line.includes(`code: "${code}"`))) },
  { file: "settings/modules.config.json", apply: (text, ctx) => dropLines(text, (line) => [...ctx.excludedModules].some((code) => new RegExp(`^\\s*"${code}"\\s*:`).test(line))) },
  {
    file: "settings/agent_workflows.json",
    apply: (text, ctx) => jsonEdit(text, (doc) => {
      for (const code of ctx.excludedModules) delete doc.modules[code];
      // The contract schema requires the secfin.carry workflow entry; keep it as an inert, disabled definition.
      if (doc.workflows["secfin.carry"]) doc.workflows["secfin.carry"].enabled = false;
      for (const mod of Object.values(doc.modules)) { mod.workflows = mod.workflows.filter((w) => w !== "secfin.carry"); delete mod.desk_datasets; }
    }),
  },
  {
    file: "contracts/agent/module-policy.json",
    apply: (text, ctx) => jsonEdit(text, (doc) => {
      doc.eligible_modules.gold = doc.eligible_modules.gold.filter((c) => !ctx.excludedModules.has(c));
      doc.eligible_modules.desk = [];
      doc.never_eligible = doc.never_eligible.filter((c) => !ctx.excludedModules.has(c));
      for (const code of ctx.excludedModules) delete doc.context_field_allowlist[code];
      doc.known_domains = doc.known_domains.filter((d) => d !== "securities_financing_prime");
    }),
  },
  {
    file: "src/lib/nav.test.ts",
    apply: (text, ctx) => dropLines(text, (line) => codesOf(ctx).some((c) => new RegExp(`^\\s*${c}:\\s*\\[`).test(line)) || routesOf(ctx).some((r) => line.trim() === `"${r}",`)),
  },
  {
    file: "test/smoke.spec.ts",
    apply: (text, ctx) => dropLines(text, (line) => codesOf(ctx).some((c) => line.includes(`code: "${c}"`))).replace(/, "\/trading-desk"/g, ""),
  },
  {
    file: "src/data/dataOps.ts",
    apply: (text, ctx) => stripCodesInArrays(dropLines(text, (line) => codesOf(ctx).some((c) => line.includes(`{ module: "${c}"`)) || /^\s*\["LOCAL_BOOK", "desk_books_fixture"/.test(line)), ctx),
  },
  { file: "src/lib/server/marketManifest.ts", apply: (text, ctx) => stripCodesInArrays(text, ctx) },
  {
    file: "vite-plugins/dev-api.ts",
    apply: (text) => replaceOnce(text, 'const trace = process.env.IBAL_DEV_API_TRACE === "1" && url.pathname.startsWith("/api/inventory-optimizer/");', 'const trace = process.env.DEV_API_TRACE === "1";', "vite-plugins/dev-api.ts"),
  },
  {
    file: "src/data/econEnhancements.ts",
    apply: (text, ctx) => replaceOnce(dropLines(text, (line) => codesOf(ctx).some((c) => line.includes(`{ module: "${c}"`))), 'module: "REINV" | "CASH" | "COLL" | "OPT";', "module: string;", "src/data/econEnhancements.ts"),
  },
  {
    file: "test/TESTING_HANDOFF.md",
    apply: (text, ctx) => dropLines(text, (line) => routesOf(ctx).some((r) => line.includes(`\`${r}\``))).replace(", /trading-desk)", ")"),
  },
];
