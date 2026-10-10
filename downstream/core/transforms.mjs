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
      delete doc.workflows["secfin.carry"];
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
];
