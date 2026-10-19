import { describe, expect, it } from "vitest";
import type { DatasetEnvelope, IbalResult } from "@/lib/inventoryOptimizer";
import { compareBaseRuns, type BaseRunSnapshot } from "./ibalRunComparison";

function snapshot(options: { runId: string; routes?: { route_id: string; security_id: string; borrower_id: string; inventory_id: string }[]; pools?: Record<string, string>; allocations?: { route_id: string; inventory_id: string; post_quantity_shares: number }[]; balances?: { inventory_id: string; pre_total_lendable_shares: number; post_on_loan_shares: number }[]; hasPrimal?: boolean }): BaseRunSnapshot {
  const routes = options.routes ?? [{ route_id: "R1", security_id: "SEC-1", borrower_id: "BOR-1", inventory_id: "INV-1" }];
  const inventories = [...new Set(routes.map((route) => route.inventory_id))].map((inventory_id) => ({
    inventory_id,
    inventory_pool_id: options.pools?.[inventory_id] ?? "POOL-1",
  }));
  const dataset = {
    api_schema_version: "1.0",
    template_schema_version: "1.0",
    request_hash: `hash-${options.runId}`,
    source: { mode: "synthetic", label: "SIM", seed: 42 },
    request: {
      as_of: "2026-10-01T12:00:00Z",
      problem_family: "inventory",
      routes,
      inventory: inventories,
      demand: [],
      entity_relationships: [{
        value: { entity_id: "BOR-1", ultimate_parent_id: "PARENT-1" },
        effective_from: "2026-01-01T00:00:00Z",
        effective_to: null,
      }],
    },
  } as unknown as DatasetEnvelope;
  const allocations = options.allocations ?? routes.map((route) => ({ route_id: route.route_id, inventory_id: route.inventory_id, post_quantity_shares: 100 }));
  const balances = options.balances ?? inventories.map((inventory) => ({ inventory_id: inventory.inventory_id, pre_total_lendable_shares: 1000, post_on_loan_shares: 100 }));
  const result = {
    run_id: options.runId,
    status: "optimal",
    created_at: "2026-10-01T12:00:00Z",
    input_hash: dataset.request_hash,
    config_hash: `config-${options.runId}`,
    package_version: "0.1.0",
    backend_version: "1.7.0",
    allocations,
    balances,
    demand: [],
    constraints: [],
    economics: { total_delta_usd: 12 },
    verification: { has_primal: options.hasPrimal ?? true, passed: true },
  } as unknown as IbalResult;
  return { dataset, result };
}

describe("compareBaseRuns", () => {
  it("aggregates matched driver changes and preserves newly added entities", () => {
    const baseline = snapshot({ runId: "run-1", allocations: [{ route_id: "R1", inventory_id: "INV-1", post_quantity_shares: 100 }] });
    const comparison = snapshot({
      runId: "run-2",
      routes: [
        { route_id: "R1", security_id: "SEC-1", borrower_id: "BOR-1", inventory_id: "INV-1" },
        { route_id: "R2", security_id: "SEC-2", borrower_id: "BOR-2", inventory_id: "INV-2" },
      ],
      pools: { "INV-2": "POOL-2" },
      allocations: [
        { route_id: "R1", inventory_id: "INV-1", post_quantity_shares: 130 },
        { route_id: "R2", inventory_id: "INV-2", post_quantity_shares: 20 },
      ],
      balances: [
        { inventory_id: "INV-1", pre_total_lendable_shares: 1000, post_on_loan_shares: 120 },
        { inventory_id: "INV-2", pre_total_lendable_shares: 500, post_on_loan_shares: 20 },
      ],
    });

    const result = compareBaseRuns(baseline, comparison);

    expect(result.drivers.route.find((row) => row.entityId === "R1")).toMatchObject({ presence: "matched", deltaShares: 30 });
    expect(result.drivers.route.find((row) => row.entityId === "R2")).toMatchObject({ presence: "new", deltaShares: null });
    expect(result.drivers.security.find((row) => row.entityId === "SEC-1")).toMatchObject({ baselineQuantityShares: 100, comparisonQuantityShares: 130, deltaShares: 30 });
    expect(result.drivers.borrower_parent.find((row) => row.entityId === "parent:PARENT-1")).toMatchObject({ deltaShares: 30 });
    expect(result.drivers.inventory.find((row) => row.entityId === "INV-1")).toMatchObject({ baselineQuantityShares: 100, comparisonQuantityShares: 120, deltaShares: 20 });
    expect(result.drivers.inventory_pool.find((row) => row.entityId === "POOL-1")).toMatchObject({ baselineQuantityShares: 100, comparisonQuantityShares: 120, deltaShares: 20 });
    expect(result.partial).toBe(true);
    expect(result.unmatchedEntityCount).toBeGreaterThan(0);
  });

  it("marks missing result rows as partial instead of treating them as zero", () => {
    const baseline = snapshot({ runId: "run-1" });
    const comparison = snapshot({ runId: "run-2", allocations: [], balances: [] });

    const result = compareBaseRuns(baseline, comparison);
    const route = result.drivers.route.find((row) => row.entityId === "R1");
    const inventory = result.drivers.inventory.find((row) => row.entityId === "INV-1");
    const pool = result.drivers.inventory_pool.find((row) => row.entityId === "POOL-1");

    expect(route).toMatchObject({ baselineQuantityShares: 100, comparisonQuantityShares: null, deltaShares: null, coverage: "partial" });
    expect(inventory).toMatchObject({ baselineQuantityShares: 100, comparisonQuantityShares: null, deltaShares: null, coverage: "partial" });
    expect(pool).toMatchObject({ baselineQuantityShares: 100, comparisonQuantityShares: null, deltaShares: null, coverage: "partial" });
    expect(result.partial).toBe(true);
  });

  it("does not report quantity metrics when a result has no primal", () => {
    const result = compareBaseRuns(snapshot({ runId: "run-1", hasPrimal: false }), snapshot({ runId: "run-2" }));

    expect(result.drivers.route[0]).toMatchObject({ baselineQuantityShares: null, deltaShares: null, coverage: "unavailable" });
    expect(result.baselineMetrics.totalAllocationShares).toBeNull();
    expect(result.partial).toBe(true);
  });

  it("returns run identity and directly sourced portfolio deltas", () => {
    const result = compareBaseRuns(snapshot({ runId: "run-1" }), snapshot({ runId: "run-2" }));

    expect(result.baseline).toMatchObject({ runId: "run-1", requestHash: "hash-run-1", configHash: "config-run-1", sourceMode: "synthetic", seed: 42, engineVersion: "0.1.0", backendVersion: "1.7.0" });
    expect(result.portfolioDelta.objectiveDeltaUsd).toBe(0);
    expect(result.comparison.createdAt).toBe("2026-10-01T12:00:00Z");
  });
});