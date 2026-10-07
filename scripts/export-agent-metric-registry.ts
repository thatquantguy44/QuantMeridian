/**
 * Generate contracts/agent/generated/metric_registry.json (spec009 T-004).
 *
 *   npm run export:agent-metric-registry          # write
 *   npm run check:agent-metric-registry           # fail when the committed file is stale
 */
import fs from "node:fs";
import path from "node:path";
import { buildMetricRegistry, serializeRegistry } from "@/lib/server/agent/metricRegistry";
import { validateContract } from "@/lib/agent/validate";

const OUT = path.resolve(process.cwd(), "contracts/agent/generated/metric_registry.json");
const check = process.argv.includes("--check");

const registry = buildMetricRegistry();
const verdict = validateContract("registry", registry);
if (!verdict.ok) {
  console.error("Generated registry does not match its schema:");
  for (const issue of verdict.issues) console.error(`  ${issue.path}: ${issue.message}`);
  process.exit(1);
}

const next = serializeRegistry(registry);
if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== next) {
    console.error("contracts/agent/generated/metric_registry.json is out of date. Run `npm run export:agent-metric-registry`.");
    process.exit(1);
  }
  console.log(`Metric registry is up to date (${registry.metrics.length} metrics, ${registry.excluded.length} excluded).`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, next);
  console.log(`Wrote ${registry.metrics.length} metrics (${registry.excluded.length} excluded) to ${path.relative(process.cwd(), OUT)}.`);
}
