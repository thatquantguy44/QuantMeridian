import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRED_CATALOG, resolveFred } from "@/data/econSeries";
import { validateContract } from "@/lib/agent/validate";
import { DESK_DATASETS, type DeskDatasetDef } from "./deskDatasets";
import { buildMetricRegistry, canonicalJson, RegistryBuildError, registryVersion, serializeRegistry } from "./metricRegistry";
import { CATALOG_UNITS, levelLabel, REVIEWED_LIN_UNITS } from "./metricUnits";

const ROOT = path.resolve(__dirname, "../../../..");
const COMMITTED = path.join(ROOT, "contracts/agent/generated/metric_registry.json");
const built = buildMetricRegistry();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe("generated registry (AC-009)", () => {
  it("matches the committed file — run `npm run export:agent-metric-registry` after a catalog change", () => {
    expect(fs.readFileSync(COMMITTED, "utf8")).toBe(serializeRegistry(built));
  });

  it("validates against its schema", () => {
    expect(validateContract("registry", built)).toEqual({ ok: true });
    expect(validateContract("registry", JSON.parse(fs.readFileSync(COMMITTED, "utf8")))).toEqual({ ok: true });
  });

  it("has a version that is the hash of everything else", () => {
    const { registry_version, ...body } = built;
    expect(registry_version).toBe(registryVersion(body));
    const changed = clone(body);
    changed.metrics[0].decimals += 1;
    expect(registryVersion(changed)).not.toBe(registry_version);
  });

  it("accounts for every catalog series: registered, or excluded with a reason", () => {
    const registered = new Set(built.metrics.map((m) => m.name));
    const excluded = new Map(built.excluded.map((e) => [e.name, e.reason]));
    for (const s of FRED_CATALOG) {
      expect(registered.has(s.id) !== excluded.has(s.id), `${s.id} must be registered xor excluded`).toBe(true);
    }
    expect(built.metrics.filter((m) => m.source.kind === "gold_series").length + excluded.size).toBe(FRED_CATALOG.length);
  });

  it("excludes only simulation-only series; a new unusual series must get a reviewed unit", () => {
    const reasons = new Set(built.excluded.map((e) => e.reason));
    expect([...reasons]).toEqual(["sim_only"]);
    for (const e of built.excluded) expect(resolveFred(e.name).simOnly).toBe(true);
  });

  it("declares unit, additivity, grain, source, data class and domains on every metric", () => {
    for (const m of built.metrics) {
      expect(m.unit, m.name).toBeTruthy();
      expect(m.additivity, m.name).toBeTruthy();
      expect(m.grain, m.name).toBeTruthy();
      expect(m.source.kind, m.name).toBeTruthy();
      expect(m.data_class, m.name).toBeTruthy();
      expect(m.domains.length, m.name).toBeGreaterThan(0);
    }
  });

  it("has unique names and globally unique synonyms", () => {
    const names = built.metrics.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    const owner = new Map<string, string>();
    for (const m of built.metrics) {
      for (const syn of m.synonyms) {
        expect(syn, `${m.name} synonym is normalized`).toBe(syn.trim().toLowerCase());
        expect(owner.get(syn) ?? m.name, `synonym "${syn}"`).toBe(m.name);
        owner.set(syn, m.name);
      }
    }
  });

  it("keeps every Gold series non-additive, with no relaxation (0081 REQ-003)", () => {
    for (const m of built.metrics.filter((x) => x.source.kind === "gold_series")) {
      expect(m.additivity, m.name).toBe("non_additive");
      expect(m.data_class).toBe("public_market_data");
      expect(m.source).toMatchObject({ source: "econ", units: "lin" });
    }
  });

  it("registers the five initial SLAB desk metrics, all simulated", () => {
    const desk = built.metrics.filter((m) => m.source.kind === "desk_dataset");
    expect(desk.map((m) => m.name).sort()).toEqual(["sl_daily_revenue", "sl_inventory_value", "sl_on_loan_notional", "sl_utilization", "sl_weighted_fee_bps"]);
    for (const m of desk) {
      expect(m.data_class).toBe("desk_simulated");
      expect(m.snapshot).toBe(true);
      expect(m.domains).toEqual(["securities_financing_prime"]);
      expect(m.additivity_rationale, m.name).toBeTruthy();
    }
    for (const m of desk) expect(m.synonyms.length, `${m.name} synonyms`).toBeGreaterThan(1);
    const byName = Object.fromEntries(desk.map((m) => [m.name, m]));
    expect(byName.sl_daily_revenue.synonyms).toEqual(expect.arrayContaining(["lending revenue", "revenue", "daily revenue"]));
    expect(byName.sl_daily_revenue.additivity).toBe("additive");
    expect(byName.sl_on_loan_notional.additivity).toBe("semi_additive");
    expect(byName.sl_inventory_value.additivity).toBe("semi_additive");
    expect(byName.sl_weighted_fee_bps.additivity).toBe("ratio");
    expect(byName.sl_utilization.additivity).toBe("ratio");
  });

  it("publishes the desk datasets the worker needs to read rows", () => {
    expect(built.desk_datasets.map((d) => d.id)).toEqual(["sl_inventory", "sl_loans", "sl_borrow_demand"]);
    for (const d of built.desk_datasets) {
      for (const field of Object.values(d.dimensions)) expect(d.fields[field], `${d.id}.${field}`).toBeDefined();
    }
  });

  it("tags funding and money-market series for the funding pack as well as rates", () => {
    const get = (n: string) => built.metrics.find((m) => m.name === n)!;
    for (const id of ["SOFR", "IORB", "OBFR", "BGCR", "RRPONTSYD", "DTB3", "WRESBAL"]) {
      expect(get(id).domains, id).toContain("short_term_markets_funding");
    }
    expect(get("DGS10").domains).toEqual(["rates_fixed_income"]);
    expect(get("BAMLH0A0HYM2").domains).toEqual(["credit_markets"]);
    expect(get("CPIAUCSL").domains).toEqual(["economics_macro"]);
  });
});

describe("units describe the Gold level, not the display value", () => {
  const get = (n: string) => built.metrics.find((m) => m.name === n)!;

  it("lists in the reviewed table only series whose resolver is not plain", () => {
    const ids = new Set(FRED_CATALOG.map((s) => s.id));
    for (const id of Object.keys(REVIEWED_LIN_UNITS)) {
      expect(ids.has(id), `${id} exists in the catalog`).toBe(true);
      const r = resolveFred(id);
      expect(r.units !== "lin" || r.scale !== 1, `${id} is transformed or rescaled`).toBe(true);
    }
  });

  it("reviews every transformed or rescaled series", () => {
    for (const s of FRED_CATALOG) {
      const r = resolveFred(s.id);
      if (r.simOnly) continue;
      if (r.units !== "lin" || r.scale !== 1) expect(REVIEWED_LIN_UNITS[s.id], `${s.id} needs a reviewed lin unit`).toBeDefined();
    }
  });

  it("gives transformed series the level's unit, a level label, and the chart's unit separately", () => {
    const cpi = get("CPIAUCSL");
    expect(cpi).toMatchObject({ unit: "index", unit_review: "reviewed", chart_unit: "pct", chart_display_unit: "% y/y" });
    expect(cpi.label).not.toMatch(/YoY|MoM/);
    expect(cpi.label).toMatch(/level$/);
    expect(get("PAYEMS")).toMatchObject({ unit: "count", chart_unit: "count", chart_display_unit: "k m/m" });
  });

  it("omits the chart unit when the chart shows the level itself", () => {
    expect(get("DGS10").chart_unit).toBeUndefined();
    expect(get("T10Y2Y")).toMatchObject({ unit: "pp", unit_review: "reviewed" });
    expect(get("T10Y2Y").chart_unit).toBeUndefined();
    expect(get("DGS10")).toMatchObject({ unit: "pct", unit_review: "catalog", decimals: 2 });
  });

  it("only chart-annotates series the resolver transforms", () => {
    for (const m of built.metrics.filter((x) => x.source.kind === "gold_series")) {
      expect(m.chart_unit !== undefined, m.name).toBe(resolveFred(m.name).units !== "lin");
    }
  });

  it("covers every plain catalog unit", () => {
    for (const s of FRED_CATALOG) {
      const r = resolveFred(s.id);
      if (!r.simOnly && r.units === "lin" && r.scale === 1) expect(CATALOG_UNITS[s.unit], `${s.id} unit "${s.unit}"`).toBeDefined();
    }
  });

  it("writes a level label without transform words", () => {
    expect(levelLabel("CPI (headline, YoY)")).toBe("CPI (headline) level");
    expect(levelLabel("Nonfarm Payrolls (chg)")).toBe("Nonfarm Payrolls level");
    expect(levelLabel("Retail Sales")).toBe("Retail Sales level");
    expect(levelLabel("PCE: Goods")).toBe("PCE: Goods level");
  });
});

describe("builder safeguards", () => {
  it("refuses curated synonyms that two metrics would share", () => {
    expect(() => buildMetricRegistry({ curatedSynonyms: { DGS10: ["ten"], DGS2: ["ten"] } })).toThrow(RegistryBuildError);
  });

  it("refuses curated synonyms for a metric that does not exist", () => {
    expect(() => buildMetricRegistry({ curatedSynonyms: { NOPE: ["x"] } })).toThrow(/unknown metric/);
  });

  it("refuses a desk dataset whose declared source is not simulated (REQ-029)", () => {
    const bad: DeskDatasetDef[] = [{ ...clone(DESK_DATASETS[0]), declaredSource: "REAL" }];
    expect(() => buildMetricRegistry({ datasets: bad })).toThrow(/DATA_CLASS_NOT_APPROVED/);
  });

  it("is deterministic", () => {
    expect(serializeRegistry(buildMetricRegistry())).toBe(serializeRegistry(buildMetricRegistry()));
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: undefined }], c: "é" } })).toBe('{"a":{"c":"é","d":[3,{"y":1}]},"b":1}');
  });
});
