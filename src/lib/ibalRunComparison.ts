import type { DatasetEnvelope, IbalInventoryRow, IbalResult, IbalRouteRow } from "@/lib/inventoryOptimizer";

export interface BaseRunSnapshot {
  dataset: DatasetEnvelope;
  result: IbalResult;
}

export type DriverDimension = "security" | "borrower_parent" | "inventory" | "inventory_pool" | "route";
export type DriverPresence = "matched" | "unmatched" | "new";
export type DriverCoverage = "complete" | "partial" | "unavailable";

export interface RunIdentity {
  runId: string;
  status: string;
  createdAt: string;
  sourceMode: DatasetEnvelope["source"]["mode"];
  sourceLabel: string;
  seed: number | null;
  uploadHash: string | null;
  requestHash: string;
  configHash: string;
  engineVersion: string;
  backendVersion: string | null;
}

export interface PortfolioMetrics {
  objectiveDeltaUsd: number | null;
  totalAllocationShares: number | null;
  filledShares: number | null;
  fillRate: number | null;
  utilization: number | null;
  activeRoutes: number | null;
  bindingConstraints: number | null;
  warningCount: number;
  verificationPassed: boolean | null;
}

export interface DriverDelta {
  entityId: string;
  label: string;
  presence: DriverPresence;
  baselineQuantityShares: number | null;
  comparisonQuantityShares: number | null;
  deltaShares: number | null;
  coverage: DriverCoverage;
  unresolved: boolean;
}

export interface BaseRunComparison {
  baseline: RunIdentity;
  comparison: RunIdentity;
  baselineMetrics: PortfolioMetrics;
  comparisonMetrics: PortfolioMetrics;
  portfolioDelta: Omit<PortfolioMetrics, "verificationPassed">;
  drivers: Record<DriverDimension, DriverDelta[]>;
  partial: boolean;
  unmatchedEntityCount: number;
  unresolvedEntityCount: number;
}

interface GroupValue {
  entityId: string;
  label: string;
  inputIds: Set<string>;
  resultIds: Set<string>;
  quantity: number;
  unresolved: boolean;
}

interface GroupSnapshot {
  groups: Map<string, GroupValue>;
  hasPrimal: boolean;
}

function hasPrimal(result: IbalResult): boolean {
  if (result.verification?.has_primal != null) return result.verification.has_primal;
  return result.allocations.length + result.balances.length + result.demand.length > 0;
}

function activeParentByBorrower(snapshot: BaseRunSnapshot): Map<string, string> {
  const asOf = Date.parse(snapshot.dataset.request.as_of);
  const relationships = snapshot.dataset.request.entity_relationships ?? [];
  const active = relationships
    .filter((row) => {
      const start = Date.parse(row.effective_from);
      const end = row.effective_to == null ? Number.POSITIVE_INFINITY : Date.parse(row.effective_to);
      return Number.isFinite(asOf) && start <= asOf && asOf < end;
    })
    .sort((left, right) => Date.parse(right.effective_from) - Date.parse(left.effective_from));
  const parentByBorrower = new Map<string, string>();
  for (const relationship of active) {
    const borrowerId = relationship.value.entity_id;
    if (!parentByBorrower.has(borrowerId)) parentByBorrower.set(borrowerId, relationship.value.ultimate_parent_id);
  }
  return parentByBorrower;
}

function emptyGroup(entityId: string, label: string, unresolved: boolean): GroupValue {
  return { entityId, label, inputIds: new Set(), resultIds: new Set(), quantity: 0, unresolved };
}

function routeDescriptor(
  dimension: Exclude<DriverDimension, "inventory_pool">,
  route: IbalRouteRow | undefined,
  routeId: string,
  parentByBorrower: Map<string, string>
): { entityId: string; label: string; unresolved: boolean } {
  if (!route) {
    if (dimension === "route") return { entityId: routeId, label: routeId, unresolved: true };
    return { entityId: `unmapped:${routeId}`, label: `Unmapped route ${routeId}`, unresolved: true };
  }
  if (dimension === "route") return { entityId: route.route_id, label: route.route_id, unresolved: false };
  if (dimension === "security") return { entityId: route.security_id, label: route.security_id, unresolved: false };
  const parentId = parentByBorrower.get(route.borrower_id);
  return parentId
    ? { entityId: `parent:${parentId}`, label: `Parent ${parentId}`, unresolved: false }
    : { entityId: `borrower:${route.borrower_id}`, label: `Borrower ${route.borrower_id}`, unresolved: false };
}

function routeGroups(snapshot: BaseRunSnapshot, dimension: Exclude<DriverDimension, "inventory_pool">): GroupSnapshot {
  const routes = snapshot.dataset.request.routes ?? [];
  const routesById = new Map(routes.map((route) => [route.route_id, route]));
  const parentByBorrower = activeParentByBorrower(snapshot);
  const groups = new Map<string, GroupValue>();
  const groupForRoute = (route: IbalRouteRow | undefined, routeId: string) => {
    const descriptor = routeDescriptor(dimension, route, routeId, parentByBorrower);
    const key = `${dimension}:${descriptor.entityId}`;
    let group = groups.get(key);
    if (!group) {
      group = emptyGroup(descriptor.entityId, descriptor.label, descriptor.unresolved);
      groups.set(key, group);
    }
    group.unresolved ||= descriptor.unresolved;
    return group;
  };

  for (const route of routes) groupForRoute(route, route.route_id).inputIds.add(route.route_id);
  for (const allocation of snapshot.result.allocations) {
    const group = groupForRoute(routesById.get(allocation.route_id), allocation.route_id);
    group.resultIds.add(allocation.route_id);
    group.quantity += allocation.post_quantity_shares;
  }
  return { groups, hasPrimal: hasPrimal(snapshot.result) };
}

function inventoryPoolGroups(snapshot: BaseRunSnapshot): GroupSnapshot {
  const inventories = snapshot.dataset.request.inventory ?? [];
  const inventoryById = new Map(inventories.map((inventory) => [inventory.inventory_id, inventory]));
  const groups = new Map<string, GroupValue>();
  const groupForInventory = (inventory: IbalInventoryRow | undefined, inventoryId: string) => {
    const poolId = inventory?.inventory_pool_id;
    const entityId = poolId ?? `unmapped:${inventoryId}`;
    const label = poolId ? `Pool ${poolId}` : `Unmapped inventory ${inventoryId}`;
    const key = `inventory_pool:${entityId}`;
    let group = groups.get(key);
    if (!group) {
      group = emptyGroup(entityId, label, poolId == null);
      groups.set(key, group);
    }
    group.unresolved ||= poolId == null;
    return group;
  };

  for (const inventory of inventories) groupForInventory(inventory, inventory.inventory_id).inputIds.add(inventory.inventory_id);
  for (const balance of snapshot.result.balances) {
    const group = groupForInventory(inventoryById.get(balance.inventory_id), balance.inventory_id);
    group.resultIds.add(balance.inventory_id);
    group.quantity += balance.post_on_loan_shares;
  }
  return { groups, hasPrimal: hasPrimal(snapshot.result) };
}

function inventoryGroups(snapshot: BaseRunSnapshot): GroupSnapshot {
  const inventories = snapshot.dataset.request.inventory ?? [];
  const groups = new Map<string, GroupValue>();
  const groupForInventory = (inventory: IbalInventoryRow | undefined, inventoryId: string) => {
    const entityId = inventory?.inventory_id ?? `unmapped:${inventoryId}`;
    const label = inventory ? `Inventory ${inventory.inventory_id}` : `Unmapped inventory ${inventoryId}`;
    const key = `inventory:${entityId}`;
    let group = groups.get(key);
    if (!group) {
      group = emptyGroup(entityId, label, inventory == null);
      groups.set(key, group);
    }
    group.unresolved ||= inventory == null;
    return group;
  };

  for (const inventory of inventories) groupForInventory(inventory, inventory.inventory_id).inputIds.add(inventory.inventory_id);
  for (const balance of snapshot.result.balances) {
    const group = groupForInventory(inventories.find((inventory) => inventory.inventory_id === balance.inventory_id), balance.inventory_id);
    group.resultIds.add(balance.inventory_id);
    group.quantity += balance.post_on_loan_shares;
  }
  return { groups, hasPrimal: hasPrimal(snapshot.result) };
}

function groupQuantity(group: GroupValue | undefined, hasPrimalValue: boolean): { quantity: number | null; coverage: DriverCoverage } {
  if (!hasPrimalValue) return { quantity: null, coverage: "unavailable" };
  if (!group || group.inputIds.size === 0 || [...group.inputIds].some((id) => !group.resultIds.has(id))) {
    return { quantity: null, coverage: "partial" };
  }
  return { quantity: group.quantity, coverage: "complete" };
}

function compareGroups(baseline: GroupSnapshot, comparison: GroupSnapshot): DriverDelta[] {
  const keys = new Set([...baseline.groups.keys(), ...comparison.groups.keys()]);
  return [...keys].map((key) => {
    const baselineGroup = baseline.groups.get(key);
    const comparisonGroup = comparison.groups.get(key);
    const baselineValue = groupQuantity(baselineGroup, baseline.hasPrimal);
    const comparisonValue = groupQuantity(comparisonGroup, comparison.hasPrimal);
    const presence: DriverPresence = baselineGroup && comparisonGroup ? "matched" : comparisonGroup ? "new" : "unmatched";
    const baselineQuantityShares = baselineValue.quantity;
    const comparisonQuantityShares = comparisonValue.quantity;
    return {
      entityId: baselineGroup?.entityId ?? comparisonGroup!.entityId,
      label: baselineGroup?.label ?? comparisonGroup!.label,
      presence,
      baselineQuantityShares,
      comparisonQuantityShares,
      deltaShares: baselineQuantityShares == null || comparisonQuantityShares == null
        ? null
        : comparisonQuantityShares - baselineQuantityShares,
      coverage: baselineValue.coverage === "unavailable" || comparisonValue.coverage === "unavailable"
        ? "unavailable"
        : baselineValue.coverage === "complete" && comparisonValue.coverage === "complete" ? "complete" : "partial",
      unresolved: Boolean(baselineGroup?.unresolved || comparisonGroup?.unresolved),
    };
  });
}

function identity(snapshot: BaseRunSnapshot): RunIdentity {
  return {
    runId: snapshot.result.run_id,
    status: snapshot.result.status,
    createdAt: snapshot.result.created_at,
    sourceMode: snapshot.dataset.source.mode,
    sourceLabel: snapshot.dataset.source.label,
    seed: snapshot.dataset.source.seed ?? null,
    uploadHash: snapshot.dataset.source.upload_hash ?? null,
    requestHash: snapshot.dataset.request_hash,
    configHash: snapshot.result.config_hash,
    engineVersion: snapshot.result.package_version,
    backendVersion: snapshot.result.backend_version,
  };
}

function portfolioMetrics(snapshot: BaseRunSnapshot): PortfolioMetrics {
  const result = snapshot.result;
  const primal = hasPrimal(result);
  const effectiveDemand = result.demand.reduce((sum, row) => sum + row.effective_cap_shares, 0);
  const lendable = result.balances.reduce((sum, row) => sum + row.pre_total_lendable_shares, 0);
  const postOnLoan = result.balances.reduce((sum, row) => sum + row.post_on_loan_shares, 0);
  return {
    objectiveDeltaUsd: result.economics?.total_delta_usd ?? null,
    totalAllocationShares: primal ? result.allocations.reduce((sum, row) => sum + row.post_quantity_shares, 0) : null,
    filledShares: primal && result.demand.length ? result.demand.reduce((sum, row) => sum + row.filled_shares, 0) : null,
    fillRate: primal && effectiveDemand > 0 ? result.demand.reduce((sum, row) => sum + row.filled_shares, 0) / effectiveDemand : null,
    utilization: primal && lendable > 0 ? postOnLoan / lendable : null,
    activeRoutes: primal ? result.allocations.filter((row) => row.post_quantity_shares > 0).length : null,
    bindingConstraints: primal ? result.constraints.filter((row) => Math.abs(row.slack) < 1e-8).length : null,
    warningCount: result.warnings?.length ?? 0,
    verificationPassed: result.verification?.passed ?? null,
  };
}

function difference(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : right - left;
}

export function compareBaseRuns(baseline: BaseRunSnapshot, comparison: BaseRunSnapshot): BaseRunComparison {
  const baselineMetrics = portfolioMetrics(baseline);
  const comparisonMetrics = portfolioMetrics(comparison);
  const drivers: BaseRunComparison["drivers"] = {
    security: compareGroups(routeGroups(baseline, "security"), routeGroups(comparison, "security")),
    borrower_parent: compareGroups(routeGroups(baseline, "borrower_parent"), routeGroups(comparison, "borrower_parent")),
    inventory: compareGroups(inventoryGroups(baseline), inventoryGroups(comparison)),
    inventory_pool: compareGroups(inventoryPoolGroups(baseline), inventoryPoolGroups(comparison)),
    route: compareGroups(routeGroups(baseline, "route"), routeGroups(comparison, "route")),
  };
  const rows = Object.values(drivers).flat();
  const unmatchedEntityCount = rows.filter((row) => row.presence !== "matched").length;
  const unresolvedEntityCount = rows.filter((row) => row.unresolved).length;
  const schemaMismatch = baseline.dataset.api_schema_version !== comparison.dataset.api_schema_version
    || baseline.dataset.template_schema_version !== comparison.dataset.template_schema_version
    || baseline.dataset.request.problem_family !== comparison.dataset.request.problem_family;
  const partial = schemaMismatch || unmatchedEntityCount > 0 || unresolvedEntityCount > 0 || rows.some((row) => row.coverage !== "complete");

  return {
    baseline: identity(baseline),
    comparison: identity(comparison),
    baselineMetrics,
    comparisonMetrics,
    portfolioDelta: {
      objectiveDeltaUsd: difference(baselineMetrics.objectiveDeltaUsd, comparisonMetrics.objectiveDeltaUsd),
      totalAllocationShares: difference(baselineMetrics.totalAllocationShares, comparisonMetrics.totalAllocationShares),
      filledShares: difference(baselineMetrics.filledShares, comparisonMetrics.filledShares),
      fillRate: difference(baselineMetrics.fillRate, comparisonMetrics.fillRate),
      utilization: difference(baselineMetrics.utilization, comparisonMetrics.utilization),
      activeRoutes: difference(baselineMetrics.activeRoutes, comparisonMetrics.activeRoutes),
      bindingConstraints: difference(baselineMetrics.bindingConstraints, comparisonMetrics.bindingConstraints),
      warningCount: difference(baselineMetrics.warningCount, comparisonMetrics.warningCount) ?? 0,
    },
    drivers,
    partial,
    unmatchedEntityCount,
    unresolvedEntityCount,
  };
}