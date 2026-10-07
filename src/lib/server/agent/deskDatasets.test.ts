import { describe, expect, it } from "vitest";
import * as cash from "@/data/cash";
import * as collateral from "@/data/collateral";
import * as securitiesLending from "@/data/securitiesLending";
import { DESK_DATASETS, DESK_DATASET_IDS, validateDeskDatasets, type DeskDatasetDef } from "./deskDatasets";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe("desk dataset registry", () => {
  it("is internally consistent and entirely simulated", () => {
    expect(validateDeskDatasets()).toEqual([]);
  });

  it("registers the three SLAB datasets", () => {
    expect([...DESK_DATASET_IDS].sort()).toEqual(["sl_borrow_demand", "sl_inventory", "sl_loans"]);
    for (const d of DESK_DATASETS) expect(d.module).toBe("SLAB");
  });

  it("declares SIM on the desk data files", () => {
    expect(securitiesLending.DATA_SOURCE).toBe("SIM");
    expect(collateral.DATA_SOURCE).toBe("SIM");
    expect(cash.DATA_SOURCE).toBe("SIM");
  });

  it("names getters and fields that really exist", () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      getInventory: securitiesLending.getInventory() as unknown as Record<string, unknown>[],
      getLoanBook: securitiesLending.getLoanBook() as unknown as Record<string, unknown>[],
      getBorrowDemand: securitiesLending.getBorrowDemand() as unknown as Record<string, unknown>[],
    };
    for (const d of DESK_DATASETS) {
      const sample = rows[d.getter]?.[0];
      expect(sample, `${d.id} getter ${d.getter}`).toBeDefined();
      for (const [field, type] of Object.entries(d.fields)) {
        expect(typeof sample[field], `${d.id}.${field}`).toBe(type);
      }
    }
  });

  it("computes utilization over total lendable shares (available excludes on-loan and restricted)", () => {
    const rows = securitiesLending.getInventory();
    const metric = DESK_DATASETS.flatMap((d) => d.metrics).find((m) => m.name === "sl_utilization")!;
    if (!("numerator" in metric.measure)) throw new Error("sl_utilization must be a ratio");
    expect(metric.measure.denominator.terms).toEqual([["available"], ["onLoan"], ["restricted"]]);
    const onLoan = rows.reduce((a, r) => a + r.onLoan, 0);
    const lendable = rows.reduce((a, r) => a + r.available + r.onLoan + r.restricted, 0);
    const ratio = onLoan / lendable;
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    // Agrees with the page's own per-row definition (utilization = onLoan / base, in percent).
    const row = rows[0];
    expect(row.utilization / 100).toBeCloseTo(row.onLoan / (row.available + row.onLoan + row.restricted), 6);
  });

  it("flags a dataset whose declared source is not simulated", () => {
    const bad: DeskDatasetDef[] = [{ ...clone(DESK_DATASETS[0]), declaredSource: "PROD" }];
    expect(validateDeskDatasets(bad).map((p) => p.message).join()).toMatch(/DATA_CLASS_NOT_APPROVED/);
  });

  it("flags dimensions and measures over undeclared or non-numeric fields", () => {
    const dim = clone(DESK_DATASETS[0]);
    dim.dimensions.bogus = "nope";
    expect(validateDeskDatasets([dim]).map((p) => p.message).join()).toMatch(/undeclared field "nope"/);
    const measure = clone(DESK_DATASETS[1]);
    measure.metrics[0].measure = { fn: "sum", terms: [["borrower"]] };
    expect(validateDeskDatasets([measure]).map((p) => p.message).join()).toMatch(/not a declared numeric field/);
  });

  it("flags a ratio that does not declare itself as one, and duplicate names", () => {
    const ds = clone(DESK_DATASETS[1]);
    ds.metrics[2].agg = "sum";
    expect(validateDeskDatasets([ds]).map((p) => p.message).join()).toMatch(/must declare agg and additivity "ratio"/);
    const dup = clone(DESK_DATASETS[1]);
    dup.metrics.push({ ...dup.metrics[0] });
    expect(validateDeskDatasets([dup]).map((p) => p.message).join()).toMatch(/duplicate metric name/);
  });
});
