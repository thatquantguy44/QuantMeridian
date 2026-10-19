import { useEffect, useMemo, useReducer, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Copy, Download, Play, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { Waterfall } from "@/components/charts/Waterfall";
import { Treemap } from "@/components/charts/Treemap";
import { IbalShowcase } from "./Showcase";
import { Donut } from "@/components/charts/Radial";
import {
  DEFAULT_RUN_CONFIG,
  DEFAULT_SYNTHETIC_CONFIG,
  IbalRequestError,
  exportIbalBundle,
  generateSyntheticDataset,
  getIbalCapabilities,
  getIbalHealth,
  getIbalScenarioCatalog,
  orderedStressOutcomes,
  runIbal,
  runIbalScenarioStress,
  uploadIbalDataset,
  type DatasetEnvelope,
  type IbalAllocation,
  type IbalBalance,
  type IbalCapabilities,
  type IbalConstraint,
  type IbalCounterpartyLimitRow,
  type IbalDemand,
  type IbalDemandRow,
  type IbalEntityRelationshipRow,
  type IbalHealth,
  type IbalInventoryRow,
  type IbalResult,
  type IbalRouteRow,
  type IbalScenarioCatalogItem,
  type IbalScenarioStressResponse,
  type IbalUtilizationPolicyRow,
  type LocatedIssue,
  type RunConfig,
  type SyntheticConfig,
} from "@/lib/inventoryOptimizer";
import { SCENARIO_FAMILIES, buildScenarioParameters, defaultSizing, type SizingValues } from "@/lib/ibalScenarioSizing";
import { DEFAULT_WHAT_IF_IDS, WHAT_IF_SCENARIOS, knownScenarioIds, scenarioSyntheticConfig, type WhatIfScenario, type WhatIfScenarioId } from "@/lib/ibalWhatIfs";
import { compareBaseRuns, type BaseRunSnapshot, type DriverDelta, type DriverDimension } from "@/lib/ibalRunComparison";
import { ScenarioSizingForm } from "./ScenarioSizingForm";
import { StressSuitePanel } from "./StressSuitePanel";
import { InfeasibilityTab, MipProgressView, SensitivityTab } from "./WorkbenchDiagnostics";
import { ModelStatisticsView } from "./Diagnostics";
import { PresenterBar, type PresenterStepView } from "./PresenterBar";
import { PRESENTER_STEPS, currentStepIndex, warmUp } from "@/lib/ibalPresenter";
import { fmtAbbr, fmtInt, fmtPct, fmtUsdAbbr } from "@/lib/format";
import {
  engineBlockReason,
  featureBlockReason,
  formulationBlockReason,
  hasOutputSection,
  uploadAccept,
  uploadBlockReason,
} from "@/lib/ibalCapabilityGate";

// The service's SyntheticConfig bound (contracts.py `parent_group_count le=50`); above it the
// synthetic request is rejected, so the input stops there.
const MAX_SYNTHETIC_PARENT_GROUPS = 50;

type PendingAction = { kind: "synthetic" } | { kind: "upload"; file: File };

type ResultTab = "allocations" | "balances" | "demand" | "economics" | "constraints" | "sensitivity" | "infeasibility" | "diagnostics" | "raw";

// `section` is the capability-manifest output section a tab renders; the tab shows only when the
// pinned service advertises it (spec013 IBAL-002). Raw always shows the returned payload.
const RESULT_TABS: { value: ResultTab; label: string; section?: string }[] = [
  { value: "allocations", label: "Allocations", section: "allocations" },
  { value: "balances", label: "Balances", section: "balances" },
  { value: "demand", label: "Demand", section: "demand" },
  { value: "economics", label: "Economics", section: "economics" },
  { value: "constraints", label: "Constraints", section: "constraints" },
  { value: "sensitivity", label: "Sensitivity", section: "sensitivity" },
  { value: "infeasibility", label: "Infeasibility", section: "infeasibility_explanation" },
  { value: "diagnostics", label: "Diagnostics", section: "solver" },
  { value: "raw", label: "Raw" },
];

type DatasetTab = "inventory" | "routes" | "demand" | "limits" | "policies" | "entities" | "raw";

const DATASET_TABS: { value: DatasetTab; label: string }[] = [
  { value: "inventory", label: "Inventory" },
  { value: "routes", label: "Routes" },
  { value: "demand", label: "Demand" },
  { value: "limits", label: "Limits" },
  { value: "policies", label: "Policies" },
  { value: "entities", label: "Entities" },
  { value: "raw", label: "Raw" },
];

interface WhatIfResult {
  id: WhatIfScenarioId;
  label: string;
  status: "pending" | "running" | "optimal" | "failed";
  message?: string;
  requestHash?: string;
  runId?: string;
  totalDeltaUsd?: number;
  avgUtilization?: number;
  fillRatio?: number;
  bindingConstraints?: number;
  netAllocation?: number;
  dataset?: DatasetEnvelope;
  result?: IbalResult;
}

interface BaseRouteAnalyticsRow extends IbalAllocation {
  security_id: string;
  borrower_id: string;
  delta_shares: number;
  delta_notional_usd: number;
}

interface BaseInventoryAnalyticsRow extends IbalBalance {
  security_id: string;
  inventory_pool_id: string;
  delta_on_loan_shares: number;
  delta_available_shares: number;
  pre_utilization: number;
  utilization_delta: number;
}

interface BaseDemandAnalyticsRow extends IbalDemand {
  security_id: string;
  borrower_id: string;
  shortfall_shares: number;
}

interface ReasonCodeAnalyticsRow {
  reason_code: string;
  route_count: number;
  net_delta_shares: number;
  gross_delta_shares: number;
}

interface BeforeAfterAnalytics {
  preOnLoanShares: number;
  postOnLoanShares: number;
  deltaOnLoanShares: number;
  preAvailableShares: number;
  postAvailableShares: number;
  deltaAvailableShares: number;
  totalLendableShares: number;
  preUtilization: number;
  postUtilization: number;
  utilizationDelta: number;
  filledShares: number;
  unfilledShares: number;
  effectiveDemandShares: number;
  fillRatio: number;
  fillShortfallRatio: number;
  grossIncreaseShares: number;
  grossDecreaseShares: number;
  netAllocationShares: number;
  changedRouteCount: number;
  unchangedRouteCount: number;
  activeRouteCount: number;
  bindingConstraintCount: number;
  warningCount: number;
  routeMovers: BaseRouteAnalyticsRow[];
  inventoryMovers: BaseInventoryAnalyticsRow[];
  demandDrivers: BaseDemandAnalyticsRow[];
  reasonCodes: ReasonCodeAnalyticsRow[];
}

type WorkflowPhase = "idle" | "preparing" | "solving" | "exporting" | "scenario";

interface WorkflowState {
  phase: WorkflowPhase;
  dataset: DatasetEnvelope | null;
  result: IbalResult | null;
  message: string | null;
  actionIssues: LocatedIssue[];
  pendingAction: PendingAction | null;
  resultTab: ResultTab;
  selectedRouteId: string | null;
  datasetTab: DatasetTab;
  selectedScenarioIds: WhatIfScenarioId[];
  whatIfResults: WhatIfResult[];
  selectedWhatIfId: WhatIfScenarioId | null;
}

type WorkflowAction =
  | { type: "patch"; patch: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>) }
  | { type: "start"; phase: Exclude<WorkflowPhase, "idle"> }
  | { type: "finish" }
  | { type: "reset" };

const INITIAL_SELECTED_SCENARIOS: WhatIfScenarioId[] = DEFAULT_WHAT_IF_IDS;

const INITIAL_WORKFLOW_STATE: WorkflowState = {
  phase: "idle",
  dataset: null,
  result: null,
  message: null,
  actionIssues: [],
  pendingAction: null,
  resultTab: "allocations",
  selectedRouteId: null,
  datasetTab: "inventory",
  selectedScenarioIds: INITIAL_SELECTED_SCENARIOS,
  whatIfResults: [],
  selectedWhatIfId: null,
};

interface IbalSessionPrefs {
  synthetic?: SyntheticConfig;
  runConfig?: RunConfig;
  selectedScenarioIds?: WhatIfScenarioId[];
  customScenarios?: WhatIfScenario[];
}

const SESSION_PREFS_KEY = "ibal.workbench.session.v1";

function readSessionPrefs(): IbalSessionPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(SESSION_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as IbalSessionPrefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function initWorkflowState(prefs: IbalSessionPrefs): WorkflowState {
  return {
    ...INITIAL_WORKFLOW_STATE,
    selectedScenarioIds: knownScenarioIds(prefs.selectedScenarioIds, prefs.customScenarios),
  };
}

function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case "patch": {
      const patch = typeof action.patch === "function" ? action.patch(state) : action.patch;
      return { ...state, ...patch };
    }
    case "start":
      return { ...state, phase: action.phase, message: null, actionIssues: [] };
    case "finish":
      return { ...state, phase: "idle" };
    case "reset":
      return {
        ...state,
        phase: "idle",
        dataset: null,
        result: null,
        message: null,
        actionIssues: [],
        pendingAction: null,
        resultTab: "allocations",
        selectedRouteId: null,
        datasetTab: "inventory",
        whatIfResults: [],
        selectedWhatIfId: null,
      };
  }
}


function pctFromDecimal(value: number) {
  return fmtPct(value * 100, 2);
}

function sourceFor(dataset: DatasetEnvelope | null, health: IbalHealth | null) {
  if (health?.ready) return dataset?.source.mode === "synthetic" ? "SIM" : "LIVE";
  return "ERR";
}

function DevelopmentBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border border-term-amber/40 bg-term-amber/10 px-1.5 py-px text-3xs font-semibold text-term-amber"
      title="InventoryBallast is under active local development."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-term-amber" />
      In Development
    </span>
  );
}

/** Engine identity and readiness as the service reports them (spec013 IBAL-001/007). */
function EngineStatusStrip({
  health,
  capabilities,
  blockReason,
  checking,
  onRecheck,
}: {
  health: IbalHealth | null;
  capabilities: IbalCapabilities | null;
  blockReason: string | null;
  checking: boolean;
  onRecheck: () => void;
}) {
  const backend = capabilities?.backend ?? health?.backend;
  const formulations = capabilities?.formulations ?? health?.formulations ?? [];
  const items = [
    capabilities ? `v${capabilities.engine_package_version}` : null,
    capabilities ? `pin ${capabilities.engine_commit.slice(0, 7)}` : null,
    capabilities ? `fingerprint ${capabilities.engine_fingerprint.slice(0, 8)}` : null,
    capabilities?.engine_source ? `source ${capabilities.engine_source}` : null,
    backend?.name ? `solver ${backend.name}${backend.version ? ` ${backend.version}` : ""}` : null,
    formulations.length ? formulations.map((item) => item.toUpperCase()).join("/") : null,
  ].filter(Boolean);
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-term-border bg-term-panel px-3 py-1 text-2xs"
      role="status"
      aria-label="Optimizer engine status"
    >
      <span className="term-label">Engine</span>
      <Tag tone={!health ? "neutral" : blockReason ? "down" : "up"}>{!health ? "CHECKING" : blockReason ? "NOT READY" : "PIN VERIFIED"}</Tag>
      {items.length > 0 && <span className="min-w-0 truncate font-mono text-term-text-dim" title={items.join(" · ")}>{items.join(" · ")}</span>}
      {blockReason && health && <span className="min-w-0 text-term-down">{blockReason}</span>}
      <button className="term-btn ml-auto px-1.5 py-0 text-3xs" disabled={checking} title="Re-read service health and capabilities" onClick={onRecheck}>
        <RefreshCw size={11} className={checking ? "animate-spin" : undefined} /> {checking ? "Checking" : "Recheck"}
      </button>
    </div>
  );
}

function updateNumber<T extends object>(setter: (next: T) => void, current: T, key: keyof T, value: string) {
  setter({ ...current, [key]: Number(value) });
}

function utilization(onLoan: number, total: number) {
  return total > 0 ? onLoan / total : 0;
}

function buildBeforeAfterAnalytics(dataset: DatasetEnvelope | null, result: IbalResult | null): BeforeAfterAnalytics | null {
  if (!dataset || !result) return null;

  const inventoryById = new Map(dataset.request.inventory.map((row) => [row.inventory_id, row]));
  const routeById = new Map(dataset.request.routes.map((row) => [row.route_id, row]));
  const demandById = new Map(dataset.request.demand.map((row) => [row.demand_group_id, row]));
  const constraintTolerance = 1e-8;

  const totalLendableShares = result.balances.reduce((sum, row) => sum + row.pre_total_lendable_shares, 0);
  const preOnLoanShares = result.balances.reduce((sum, row) => sum + row.pre_on_loan_shares, 0);
  const postOnLoanShares = result.balances.reduce((sum, row) => sum + row.post_on_loan_shares, 0);
  const preAvailableShares = result.balances.reduce((sum, row) => sum + row.pre_available_to_lend_shares, 0);
  const postAvailableShares = result.balances.reduce((sum, row) => sum + row.post_available_shares, 0);
  const filledShares = result.demand.reduce((sum, row) => sum + row.filled_shares, 0);
  const unfilledShares = result.demand.reduce((sum, row) => sum + row.unfilled_shares, 0);
  const effectiveDemandShares = result.demand.reduce((sum, row) => sum + row.effective_cap_shares, 0);

  const routeMovers = result.allocations.map((row) => {
    const route = routeById.get(row.route_id);
    const inventory = inventoryById.get(row.inventory_id);
    const deltaShares = row.increase_shares - row.decrease_shares;
    return {
      ...row,
      security_id: route?.security_id ?? inventory?.security_id ?? "-",
      borrower_id: route?.borrower_id ?? "-",
      delta_shares: deltaShares,
      delta_notional_usd: deltaShares * (inventory?.price_usd ?? 0),
    };
  });

  const inventoryMovers = result.balances.map((row) => {
    const inventory = inventoryById.get(row.inventory_id);
    const preUtilization = utilization(row.pre_on_loan_shares, row.pre_total_lendable_shares);
    return {
      ...row,
      security_id: inventory?.security_id ?? "-",
      inventory_pool_id: inventory?.inventory_pool_id ?? "-",
      delta_on_loan_shares: row.post_on_loan_shares - row.pre_on_loan_shares,
      delta_available_shares: row.post_available_shares - row.pre_available_to_lend_shares,
      pre_utilization: preUtilization,
      utilization_delta: row.utilization - preUtilization,
    };
  });

  const demandDrivers = result.demand.map((row) => {
    const demand = demandById.get(row.demand_group_id);
    return {
      ...row,
      security_id: demand?.security_id ?? "-",
      borrower_id: demand?.borrower_id ?? "-",
      shortfall_shares: row.unfilled_shares,
    };
  });

  const reasonCodeMap = new Map<string, ReasonCodeAnalyticsRow>();
  for (const row of result.allocations) {
    const codes = row.reason_codes.length ? row.reason_codes : ["NO_REASON_CODE"];
    const netDelta = row.increase_shares - row.decrease_shares;
    for (const reasonCode of codes) {
      const current = reasonCodeMap.get(reasonCode) ?? {
        reason_code: reasonCode,
        route_count: 0,
        net_delta_shares: 0,
        gross_delta_shares: 0,
      };
      current.route_count += 1;
      current.net_delta_shares += netDelta;
      current.gross_delta_shares += Math.abs(netDelta);
      reasonCodeMap.set(reasonCode, current);
    }
  }

  return {
    preOnLoanShares,
    postOnLoanShares,
    deltaOnLoanShares: postOnLoanShares - preOnLoanShares,
    preAvailableShares,
    postAvailableShares,
    deltaAvailableShares: postAvailableShares - preAvailableShares,
    totalLendableShares,
    preUtilization: utilization(preOnLoanShares, totalLendableShares),
    postUtilization: utilization(postOnLoanShares, totalLendableShares),
    utilizationDelta: utilization(postOnLoanShares, totalLendableShares) - utilization(preOnLoanShares, totalLendableShares),
    filledShares,
    unfilledShares,
    effectiveDemandShares,
    fillRatio: effectiveDemandShares > 0 ? filledShares / effectiveDemandShares : 0,
    fillShortfallRatio: effectiveDemandShares > 0 ? unfilledShares / effectiveDemandShares : 0,
    grossIncreaseShares: result.allocations.reduce((sum, row) => sum + row.increase_shares, 0),
    grossDecreaseShares: result.allocations.reduce((sum, row) => sum + row.decrease_shares, 0),
    netAllocationShares: result.allocations.reduce((sum, row) => sum + row.increase_shares - row.decrease_shares, 0),
    changedRouteCount: result.allocations.filter((row) => Math.abs(row.increase_shares - row.decrease_shares) > 1e-8).length,
    unchangedRouteCount: result.allocations.filter((row) => Math.abs(row.increase_shares - row.decrease_shares) <= 1e-8).length,
    activeRouteCount: result.allocations.filter((row) => row.post_quantity_shares > 0).length,
    bindingConstraintCount: result.constraints.filter((row) => Math.abs(row.slack ?? 0) <= constraintTolerance).length,
    warningCount: result.warnings?.length ?? 0,
    routeMovers,
    inventoryMovers,
    demandDrivers,
    reasonCodes: Array.from(reasonCodeMap.values()),
  };
}

// Mirrors synthetic.py's PROFILE_PRESETS: the backend applies these on top of whatever the
// client sends, unconditionally, regardless of scale. Shown as a hint only -- the backend
// resolution is authoritative; this never blocks an edit, it just avoids surprising a user whose
// slider change silently had no effect server-side.
const PROFILE_OVERRIDES: Record<SyntheticConfig["profile"], Partial<SyntheticConfig>> = {
  balanced: {},
  scarce: { starting_utilization: 0.62, utilization_cap: 0.92, fee_rate_mean: 0.045, fee_rate_dispersion: 0.02 },
  concentrated: { borrower_concentration: 0.8, starting_utilization: 0.48 },
  specials: { fee_rate_mean: 0.085, fee_rate_dispersion: 0.04, elasticity_mean: 0.25, discrete_route_fraction: 0.1 },
};

const PERCENT_FIELDS = new Set<keyof SyntheticConfig>([
  "starting_utilization",
  "utilization_cap",
  "borrower_concentration",
  "reserve_fraction",
  "ineligible_fraction",
  "discrete_route_fraction",
]);

function formatFieldValue(field: keyof SyntheticConfig, value: number): string {
  if (PERCENT_FIELDS.has(field)) return `${(value * 100).toFixed(0)}%`;
  if (field === "fee_rate_mean" || field === "fee_rate_dispersion") return `${(value * 100).toFixed(2)}%`;
  if (field === "elasticity_mean") return value.toFixed(2);
  return String(value);
}

export default function InventoryOptimizerPage() {
  const [sessionPrefs] = useState<IbalSessionPrefs>(readSessionPrefs);
  const [health, setHealth] = useState<IbalHealth | null>(null);
  const [capabilities, setCapabilities] = useState<IbalCapabilities | null>(null);
  const [synthetic, setSynthetic] = useState<SyntheticConfig>(() => sessionPrefs.synthetic ?? DEFAULT_SYNTHETIC_CONFIG);
  const [showAdvancedSynthetic, setShowAdvancedSynthetic] = useState(false);
  // Saved preferences predate the diagnostics flags; defaults fill anything they do not set.
  const [runConfig, setRunConfig] = useState<RunConfig>(() => ({ ...DEFAULT_RUN_CONFIG, ...(sessionPrefs.runConfig ?? {}) }));
  const [workflow, dispatchWorkflow] = useReducer(workflowReducer, sessionPrefs, initWorkflowState);
  const [baseRunHistory, setBaseRunHistory] = useState<BaseRunSnapshot[]>([]);
  const [baselineRunId, setBaselineRunId] = useState<string | null>(null);
  const [comparisonRunId, setComparisonRunId] = useState<string | null>(null);
  const [customScenarios, setCustomScenarios] = useState<WhatIfScenario[]>(() => sessionPrefs.customScenarios ?? []);
  const [customShockLabel, setCustomShockLabel] = useState("");
  const [engineScenarioCatalog, setEngineScenarioCatalog] = useState<IbalScenarioCatalogItem[]>([]);
  const [engineScenarioType, setEngineScenarioType] = useState("borrower_default");
  const [presenting, setPresenting] = useState(false);
  const [presenterIndex, setPresenterIndex] = useState(0);
  const [suiteToken, setSuiteToken] = useState(0);
  const [suiteCount, setSuiteCount] = useState(0);
  const [warm, setWarm] = useState("Not warmed up yet");
  const [warmed, setWarmed] = useState(false);
  const [engineSizing, setEngineSizing] = useState<SizingValues>(() => defaultSizing("borrower_default"));
  const [engineScenarioParameters, setEngineScenarioParameters] = useState("");
  const [engineScenarioResponse, setEngineScenarioResponse] = useState<IbalScenarioStressResponse | null>(null);
  const [engineScenarioError, setEngineScenarioError] = useState<string | null>(null);
  const [engineScenarioBusy, setEngineScenarioBusy] = useState(false);
  const {
    dataset,
    result,
    message,
    actionIssues,
    pendingAction,
    resultTab,
    selectedRouteId,
    datasetTab,
    selectedScenarioIds,
    whatIfResults,
    selectedWhatIfId,
  } = workflow;
  const busy = workflow.phase !== "idle";
  const scenarioBusy = workflow.phase === "scenario";

  const patchWorkflow = (patch: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>)) => {
    dispatchWorkflow({ type: "patch", patch });
  };
  const setDataset = (next: DatasetEnvelope | null) => patchWorkflow({ dataset: next });
  const setResult = (next: IbalResult | null) => patchWorkflow({ result: next });
  const setMessage = (next: string | null) => patchWorkflow({ message: next });
  const setActionIssues = (next: LocatedIssue[]) => patchWorkflow({ actionIssues: next });
  const setPendingAction = (next: PendingAction | null) => patchWorkflow({ pendingAction: next });
  const setResultTab = (next: ResultTab) => patchWorkflow({ resultTab: next });
  const setSelectedRouteId = (next: string | null | ((current: string | null) => string | null)) => {
    patchWorkflow((state) => ({ selectedRouteId: typeof next === "function" ? next(state.selectedRouteId) : next }));
  };
  const setDatasetTab = (next: DatasetTab) => patchWorkflow({ datasetTab: next });
  const setSelectedWhatIfId = (next: WhatIfScenarioId | null) => patchWorkflow({ selectedWhatIfId: next });
  const setSelectedScenarioIds = (next: WhatIfScenarioId[] | ((current: WhatIfScenarioId[]) => WhatIfScenarioId[])) => {
    patchWorkflow((state) => ({ selectedScenarioIds: typeof next === "function" ? next(state.selectedScenarioIds) : next }));
  };
  const setWhatIfResults = (next: WhatIfResult[] | ((current: WhatIfResult[]) => WhatIfResult[])) => {
    patchWorkflow((state) => ({ whatIfResults: typeof next === "function" ? next(state.whatIfResults) : next }));
  };

  // Located issues surfaced from the most-recent failed action (upload/run/export rejection)
  // take priority since they explain what just went wrong; otherwise fall back to the prepared
  // dataset's own validation issues, if any.
  const issuesToShow = actionIssues.length > 0 ? actionIssues : dataset?.validation.issues ?? [];

  function syntheticField(
    label: string,
    field: keyof SyntheticConfig,
    opts: { min: number; max: number; step: number; integer?: boolean; disabledReason?: string | null }
  ) {
    const value = Number(synthetic[field]);
    const overrideValue = PROFILE_OVERRIDES[synthetic.profile][field];
    return (
      <label key={field} className="grid gap-1 text-term-text-dim">
        <span className="flex items-center justify-between gap-2">
          <span>{label}</span>
          <span className="flex items-center gap-1">
            {overrideValue !== undefined && (
              <span
                className="text-3xs text-term-amber"
                title={`Profile "${synthetic.profile}" overrides this to ${formatFieldValue(field, Number(overrideValue))} regardless of the value set here.`}
              >
                profile-set
              </span>
            )}
            <span className="tnum text-term-text">{formatFieldValue(field, value)}</span>
          </span>
        </span>
        <input
          type="range"
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={value}
          disabled={Boolean(opts.disabledReason)}
          title={opts.disabledReason ?? undefined}
          onChange={(event) => updateNumber(setSynthetic, synthetic, field, event.target.value)}
        />
        {opts.disabledReason && <span className="text-3xs text-term-text-mute">{opts.disabledReason}</span>}
      </label>
    );
  }

  function syntheticCountField(label: string, field: keyof SyntheticConfig, opts: { min: number; max: number }) {
    return (
      <label key={field} className="grid gap-1 text-term-text-dim">
        {label}
        <input
          className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text"
          type="number"
          min={opts.min}
          max={opts.max}
          step={1}
          value={Number(synthetic[field])}
          onChange={(event) => updateNumber(setSynthetic, synthetic, field, String(Math.min(opts.max, Math.max(opts.min, Number(event.target.value)))))}
        />
      </label>
    );
  }

  // Health and capabilities are re-read whenever they may have changed: on load, when the tab
  // regains focus, after any failed action, and on demand -- so a restarted or stopped service is
  // reflected without a page reload.
  const [engineChecking, setEngineChecking] = useState(false);
  function refreshEngineStatus() {
    setEngineChecking(true);
    return Promise.all([
      getIbalHealth().then(setHealth).catch((error) => setHealth({ status: "unavailable", ready: false, error: error.message })),
      getIbalCapabilities().then(setCapabilities).catch(() => setCapabilities(null)),
    ]).finally(() => setEngineChecking(false));
  }

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshEngineStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    void refreshEngineStatus();
    getIbalScenarioCatalog().then((response) => setEngineScenarioCatalog(response.scenarios)).catch(() => setEngineScenarioCatalog([]));
  }, []);

  useEffect(() => {
    setEngineSizing(defaultSizing(engineScenarioType));
  }, [engineScenarioType]);

  useEffect(() => {
    setEngineScenarioParameters(JSON.stringify(buildScenarioParameters(engineScenarioType, dataset, result, engineSizing), null, 2));
    setEngineScenarioResponse(null);
    setEngineScenarioError(null);
  }, [engineScenarioType, dataset, result?.run_id, engineSizing]);

  useEffect(() => {
    setEngineScenarioResponse(null);
  }, [dataset?.request_hash, result?.run_id, runConfig]);

  useEffect(() => {
    window.sessionStorage.setItem(
      SESSION_PREFS_KEY,
      JSON.stringify({
        synthetic,
        runConfig,
        selectedScenarioIds,
        customScenarios,
      } satisfies IbalSessionPrefs)
    );
  }, [synthetic, runConfig, selectedScenarioIds, customScenarios]);

  // Whichever result set is on screen right now: the plain Base Case Run by default, or -- once
  // the What If sweep has produced results -- whichever scenario is selected in that comparison
  // table (base case included, since it's one of the selectable scenarios). Every results panel
  // below reads from this single source so there is never more than one "current" result on screen.
  const baselineScenario = whatIfResults.find((row) => row.id === "base" && row.status === "optimal");
  const selectedWhatIf = useMemo(
    () => whatIfResults.find((row) => row.id === selectedWhatIfId) ?? whatIfResults.find((row) => row.status === "optimal") ?? null,
    [selectedWhatIfId, whatIfResults]
  );
  const activeView = useMemo(() => {
    if (whatIfResults.length > 0) {
      if (!selectedWhatIf?.result || !selectedWhatIf.dataset) return null;
      return { label: selectedWhatIf.label, isBase: selectedWhatIf.id === "base", dataset: selectedWhatIf.dataset, result: selectedWhatIf.result };
    }
    if (dataset && result) return { label: "Base Case", isBase: true, dataset, result };
    return null;
  }, [whatIfResults, selectedWhatIf, dataset, result]);
  const viewDataset = activeView?.dataset ?? null;
  const viewResult = activeView?.result ?? null;
  const viewLabel = activeView?.label ?? "Base Case";

  const baselineRun = baseRunHistory.find((run) => run.result.run_id === baselineRunId) ?? null;
  const comparisonRun = baseRunHistory.find((run) => run.result.run_id === comparisonRunId) ?? null;
  const baseRunComparison = useMemo(
    () => baselineRun && comparisonRun && baselineRun.result.run_id !== comparisonRun.result.run_id
      ? compareBaseRuns(baselineRun, comparisonRun)
      : null,
    [baselineRun, comparisonRun]
  );

  const selectedAllocation = useMemo(
    () => viewResult?.allocations.find((row) => row.route_id === selectedRouteId) ?? null,
    [viewResult, selectedRouteId]
  );

  const totals = useMemo(() => {
    const allocations = viewResult?.allocations ?? [];
    const balances = viewResult?.balances ?? [];
    return {
      allocationIncrease: allocations.reduce((sum, row) => sum + row.increase_shares, 0),
      allocationDecrease: allocations.reduce((sum, row) => sum + row.decrease_shares, 0),
      avgUtilization: balances.length ? balances.reduce((sum, row) => sum + row.utilization, 0) / balances.length : 0,
      bindingConstraints: (viewResult?.constraints ?? []).filter((row) => Math.abs(row.slack ?? 0) < 1e-8).length,
    };
  }, [viewResult]);
  const beforeAfterAnalytics = useMemo(() => buildBeforeAfterAnalytics(viewDataset, viewResult), [viewDataset, viewResult]);
  const onLoanBridgeSteps = useMemo(() => {
    if (!beforeAfterAnalytics) return [];
    return [
      { label: "Pre On-Loan", value: beforeAfterAnalytics.preOnLoanShares, total: true },
      { label: "Increases", value: beforeAfterAnalytics.grossIncreaseShares },
      { label: "Decreases", value: -beforeAfterAnalytics.grossDecreaseShares },
      { label: "Post On-Loan", value: beforeAfterAnalytics.postOnLoanShares, total: true },
    ];
  }, [beforeAfterAnalytics]);
  const demandFillSegments = useMemo(() => {
    if (!beforeAfterAnalytics) return [];
    return [
      { value: beforeAfterAnalytics.filledShares, color: "#2ECC71", label: "Filled" },
      { value: beforeAfterAnalytics.unfilledShares, color: "#FF3B3B", label: "Unfilled" },
    ];
  }, [beforeAfterAnalytics]);
  const inventoryTreemapCells = useMemo(() => {
    if (!beforeAfterAnalytics) return [];
    return beforeAfterAnalytics.inventoryMovers.map((row) => ({
      label: row.security_id,
      weight: row.pre_total_lendable_shares,
      value: row.utilization_delta * 100,
      group: row.inventory_pool_id,
    }));
  }, [beforeAfterAnalytics]);
  const datasetReady = Boolean(dataset?.validation.valid);
  const engineBlock = engineBlockReason(health, capabilities);
  // Before capabilities load (or if they fail) every tab stays available; Raw is always last.
  const visibleResultTabs = useMemo(
    () => (capabilities ? RESULT_TABS.filter((tab) => !tab.section || hasOutputSection(capabilities, tab.section)) : RESULT_TABS),
    [capabilities]
  );
  const shownResultTab = visibleResultTabs.some((tab) => tab.value === resultTab) ? resultTab : visibleResultTabs[0].value;
  const discreteRouteBlock = formulationBlockReason(capabilities, "mip") ?? featureBlockReason(capabilities, "all_or_none_routes");
  const engineScenarioBlock =
    engineBlock ??
    featureBlockReason(capabilities, "scenarios") ??
    (hasOutputSection(capabilities, "scenario_stress") ? null : "The pinned engine service does not return scenario stress results.");
  const runDisabledReason = engineBlock
    ? engineBlock
    : !dataset
    ? "Load synthetic data or upload a dataset before running."
    : !dataset.validation.valid
      ? "Resolve dataset validation issues before running."
      : busy
        ? "Another IBAL action is still running."
        : null;
  const runReady = datasetReady && !busy && !engineBlock;
  const runButtonLabel = engineBlock ? "Engine Not Ready" : !dataset ? "Load Data First" : !dataset.validation.valid ? "Fix Data Issues" : busy ? "Working..." : "Base Case Run";
  const scenarioSet = useMemo(() => new Set(selectedScenarioIds), [selectedScenarioIds]);
  const allScenarios = useMemo(() => [...WHAT_IF_SCENARIOS, ...customScenarios], [customScenarios]);
  const requestFamily = String((dataset?.request as Record<string, unknown> | undefined)?.problem_family ?? "");
  const engineScenarioOptions = useMemo(
    () => engineScenarioCatalog.filter((item) => !requestFamily || item.applicable_families.includes(requestFamily)),
    [engineScenarioCatalog, requestFamily]
  );
  const selectedEngineScenario = engineScenarioOptions.find((item) => item.scenario_type === engineScenarioType) ?? null;

  useEffect(() => {
    if (engineScenarioOptions.length && !engineScenarioOptions.some((item) => item.scenario_type === engineScenarioType)) {
      setEngineScenarioType(engineScenarioOptions[0].scenario_type);
    }
  }, [engineScenarioOptions, engineScenarioType]);

  // A custom shock is a full snapshot of whatever is currently dialed into the Dataset Intake
  // and Run Config forms -- reusing that form as the shock editor instead of building a second,
  // parallel field picker. The full config (not a partial override) is stored so the shock always
  // replays exactly what was captured, regardless of later edits to the live form.
  function addCustomShock() {
    const label = customShockLabel.trim();
    if (!label) return;
    const id = `custom-${Date.now()}`;
    setCustomScenarios((current) => [
      ...current,
      { id, label, desc: "Custom shock: snapshot of the form settings at the time it was saved.", synthetic: { ...synthetic }, runConfig: { ...runConfig }, isCustom: true },
    ]);
    setSelectedScenarioIds((current) => (current.includes(id) ? current : [...current, id]));
    setCustomShockLabel("");
  }

  function removeCustomShock(id: WhatIfScenarioId) {
    setCustomScenarios((current) => current.filter((scenario) => scenario.id !== id));
    setSelectedScenarioIds((current) => current.filter((value) => value !== id));
  }

  const inventoryPreviewColumns: Column<IbalInventoryRow>[] = [
    { key: "id", header: "Inventory", render: (row) => <span className="text-term-text">{row.inventory_id}</span>, sortVal: (row) => row.inventory_id },
    { key: "security", header: "Security", render: (row) => <span className="text-term-text-dim">{row.security_id}</span>, sortVal: (row) => row.security_id },
    { key: "pool", header: "Pool", render: (row) => <span className="text-term-text-mute">{row.inventory_pool_id}</span>, sortVal: (row) => row.inventory_pool_id },
    { key: "total", header: "Total", align: "right", render: (row) => fmtAbbr(row.total_lendable_shares), sortVal: (row) => row.total_lendable_shares },
    { key: "on_loan", header: "On Loan", align: "right", render: (row) => fmtAbbr(row.on_loan_shares), sortVal: (row) => row.on_loan_shares },
    { key: "available", header: "Available", align: "right", render: (row) => <span className={row.available_to_lend_shares < 0 ? "text-term-down" : "text-term-text"}>{fmtAbbr(row.available_to_lend_shares)}</span>, sortVal: (row) => row.available_to_lend_shares },
    { key: "price", header: "Price", align: "right", render: (row) => fmtUsdAbbr(row.price_usd), sortVal: (row) => row.price_usd },
    { key: "eligible", header: "Eligible", align: "center", render: (row) => <Tag tone={row.eligible ? "up" : "neutral"}>{row.eligible ? "YES" : "NO"}</Tag>, sortVal: (row) => (row.eligible ? 1 : 0) },
  ];

  const routePreviewColumns: Column<IbalRouteRow>[] = [
    { key: "route", header: "Route", render: (row) => <span className="text-term-text">{row.route_id}</span>, sortVal: (row) => row.route_id },
    { key: "inventory", header: "Inventory", render: (row) => <span className="text-term-text-dim">{row.inventory_id}</span>, sortVal: (row) => row.inventory_id },
    { key: "borrower", header: "Borrower", render: (row) => <span className="text-term-text-dim">{row.borrower_id}</span>, sortVal: (row) => row.borrower_id },
    { key: "current", header: "Current", align: "right", render: (row) => fmtAbbr(row.current_quantity_shares), sortVal: (row) => row.current_quantity_shares },
    { key: "max", header: "Max", align: "right", render: (row) => fmtAbbr(row.maximum_quantity_shares), sortVal: (row) => row.maximum_quantity_shares },
    { key: "fee", header: "Fee", align: "right", render: (row) => pctFromDecimal(row.fee_rate), sortVal: (row) => row.fee_rate },
    { key: "eligible", header: "Eligible", align: "center", render: (row) => <Tag tone={row.eligible ? "up" : "neutral"}>{row.eligible ? "YES" : "NO"}</Tag>, sortVal: (row) => (row.eligible ? 1 : 0) },
    { key: "discrete", header: "Lot Size", align: "right", render: (row) => (row.lot_size_shares != null ? fmtAbbr(row.lot_size_shares) : "-"), sortVal: (row) => row.lot_size_shares ?? 0 },
  ];

  const demandPreviewColumns: Column<IbalDemandRow>[] = [
    { key: "group", header: "Demand Group", render: (row) => <span className="text-term-text">{row.demand_group_id}</span>, sortVal: (row) => row.demand_group_id },
    { key: "security", header: "Security", render: (row) => <span className="text-term-text-dim">{row.security_id}</span>, sortVal: (row) => row.security_id },
    { key: "borrower", header: "Borrower", render: (row) => <span className="text-term-text-dim">{row.borrower_id}</span>, sortVal: (row) => row.borrower_id },
    { key: "reference", header: "Reference", align: "right", render: (row) => fmtAbbr(row.reference_quantity_shares), sortVal: (row) => row.reference_quantity_shares },
    { key: "fee", header: "Ref Fee", align: "right", render: (row) => pctFromDecimal(row.reference_fee_rate), sortVal: (row) => row.reference_fee_rate },
    { key: "elasticity", header: "Elasticity", align: "right", render: (row) => fmtAbbr(row.elasticity, 3), sortVal: (row) => row.elasticity },
  ];

  const limitPreviewColumns: Column<IbalCounterpartyLimitRow>[] = [
    { key: "id", header: "Limit", render: (row) => <span className="text-term-text">{row.limit_id}</span>, sortVal: (row) => row.limit_id },
    { key: "borrower", header: "Borrower", render: (row) => <span className="text-term-text-dim">{row.borrower_id}</span>, sortVal: (row) => row.borrower_id },
    { key: "parent", header: "Parent", render: (row) => <span className="text-term-text-mute">{row.ultimate_parent_id ?? "-"}</span>, sortVal: (row) => row.ultimate_parent_id ?? "" },
    { key: "max_qty", header: "Max Shares", align: "right", render: (row) => (row.maximum_quantity_shares != null ? fmtAbbr(row.maximum_quantity_shares) : "-"), sortVal: (row) => row.maximum_quantity_shares ?? 0 },
    { key: "max_notional", header: "Max Notional", align: "right", render: (row) => (row.maximum_notional_usd != null ? fmtUsdAbbr(row.maximum_notional_usd) : "-"), sortVal: (row) => row.maximum_notional_usd ?? 0 },
    { key: "hard", header: "Hard", align: "center", render: (row) => <Tag tone={row.hard ? "amber" : "neutral"}>{row.hard ? "YES" : "NO"}</Tag>, sortVal: (row) => (row.hard ? 1 : 0) },
  ];

  const policyPreviewColumns: Column<IbalUtilizationPolicyRow>[] = [
    { key: "id", header: "Policy", render: (row) => <span className="text-term-text">{row.policy_id}</span>, sortVal: (row) => row.policy_id },
    { key: "security", header: "Security", render: (row) => <span className="text-term-text-dim">{row.security_id ?? "-"}</span>, sortVal: (row) => row.security_id ?? "" },
    { key: "pool", header: "Pool", render: (row) => <span className="text-term-text-mute">{row.inventory_pool_id ?? "-"}</span>, sortVal: (row) => row.inventory_pool_id ?? "" },
    { key: "min", header: "Min Util", align: "right", render: (row) => (row.minimum_utilization != null ? pctFromDecimal(row.minimum_utilization) : "-"), sortVal: (row) => row.minimum_utilization ?? 0 },
    { key: "max", header: "Max Util", align: "right", render: (row) => (row.maximum_utilization != null ? pctFromDecimal(row.maximum_utilization) : "-"), sortVal: (row) => row.maximum_utilization ?? 0 },
    { key: "target", header: "Target Util", align: "right", render: (row) => (row.target_utilization != null ? pctFromDecimal(row.target_utilization) : "-"), sortVal: (row) => row.target_utilization ?? 0 },
  ];

  const entityPreviewColumns: Column<IbalEntityRelationshipRow>[] = [
    { key: "entity", header: "Entity", render: (row) => <span className="text-term-text">{row.value.entity_id}</span>, sortVal: (row) => row.value.entity_id },
    { key: "legal", header: "Legal Entity", render: (row) => <span className="text-term-text-dim">{row.value.legal_entity_id}</span>, sortVal: (row) => row.value.legal_entity_id },
    { key: "parent", header: "Ultimate Parent", render: (row) => <span className="text-term-text-dim">{row.value.ultimate_parent_id}</span>, sortVal: (row) => row.value.ultimate_parent_id },
    { key: "type", header: "Type", render: (row) => <span className="text-term-text-mute">{row.value.relationship_type}</span>, sortVal: (row) => row.value.relationship_type },
    { key: "confidence", header: "Confidence", align: "right", render: (row) => pctFromDecimal(row.value.ownership_confidence), sortVal: (row) => row.value.ownership_confidence },
    { key: "quality", header: "Quality", render: (row) => <span className="text-term-text-mute">{row.quality}</span>, sortVal: (row) => row.quality },
  ];

  const allocationColumns: Column<IbalAllocation>[] = [
    { key: "route", header: "Route", render: (row) => <span className="text-term-text">{row.route_id}</span>, sortVal: (row) => row.route_id },
    { key: "inventory", header: "Inventory", render: (row) => <span className="text-term-text-dim">{row.inventory_id}</span>, sortVal: (row) => row.inventory_id },
    { key: "current", header: "Current", align: "right", render: (row) => fmtAbbr(row.current_quantity_shares), sortVal: (row) => row.current_quantity_shares },
    { key: "post", header: "Post", align: "right", render: (row) => <span className="text-term-text">{fmtAbbr(row.post_quantity_shares)}</span>, sortVal: (row) => row.post_quantity_shares },
    { key: "delta", header: "Delta", align: "right", render: (row) => <span className={row.increase_shares > 0 ? "text-term-up" : row.decrease_shares > 0 ? "text-term-down" : "text-term-text-mute"}>{fmtAbbr(row.increase_shares - row.decrease_shares)}</span>, sortVal: (row) => row.increase_shares - row.decrease_shares },
    { key: "fee", header: "Fee", align: "right", render: (row) => pctFromDecimal(row.fee_rate), sortVal: (row) => row.fee_rate },
    { key: "reason", header: "Reason", render: (row) => <span className="text-term-text-mute">{row.reason_codes?.slice(0, 2).join(", ") || "-"}</span>, sortVal: (row) => row.reason_codes?.[0] ?? "" },
  ];

  const balanceColumns: Column<IbalBalance>[] = [
    { key: "inventory", header: "Inventory", render: (row) => <span className="text-term-text">{row.inventory_id}</span>, sortVal: (row) => row.inventory_id },
    { key: "pre_total", header: "Pre Total", align: "right", render: (row) => fmtAbbr(row.pre_total_lendable_shares), sortVal: (row) => row.pre_total_lendable_shares },
    { key: "pre_on_loan", header: "Pre On-Loan", align: "right", render: (row) => fmtAbbr(row.pre_on_loan_shares), sortVal: (row) => row.pre_on_loan_shares },
    { key: "pre_available", header: "Pre Available", align: "right", render: (row) => fmtAbbr(row.pre_available_to_lend_shares), sortVal: (row) => row.pre_available_to_lend_shares },
    { key: "post_on_loan", header: "Post On-Loan", align: "right", render: (row) => <span className="text-term-text">{fmtAbbr(row.post_on_loan_shares)}</span>, sortVal: (row) => row.post_on_loan_shares },
    { key: "post_available", header: "Post Available", align: "right", render: (row) => <span className="text-term-text">{fmtAbbr(row.post_available_shares)}</span>, sortVal: (row) => row.post_available_shares },
    { key: "utilization", header: "Utilization", align: "right", render: (row) => <span className={row.utilization >= 0.95 ? "text-term-down" : row.utilization >= 0.8 ? "text-term-amber" : "text-term-text"}>{pctFromDecimal(row.utilization)}</span>, sortVal: (row) => row.utilization },
  ];

  const demandColumns: Column<IbalDemand>[] = [
    { key: "group", header: "Demand Group", render: (row) => <span className="text-term-text">{row.demand_group_id}</span>, sortVal: (row) => row.demand_group_id },
    { key: "reference", header: "Reference", align: "right", render: (row) => fmtAbbr(row.reference_quantity_shares), sortVal: (row) => row.reference_quantity_shares },
    { key: "raw", header: "Raw Demand", align: "right", render: (row) => fmtAbbr(row.raw_demand_shares), sortVal: (row) => row.raw_demand_shares },
    { key: "cap", header: "Effective Cap", align: "right", render: (row) => fmtAbbr(row.effective_cap_shares), sortVal: (row) => row.effective_cap_shares },
    { key: "filled", header: "Filled", align: "right", render: (row) => <span className="text-term-text">{fmtAbbr(row.filled_shares)}</span>, sortVal: (row) => row.filled_shares },
    { key: "unfilled", header: "Unfilled", align: "right", render: (row) => <span className={row.unfilled_shares > 0 ? "text-term-amber" : "text-term-text-mute"}>{fmtAbbr(row.unfilled_shares)}</span>, sortVal: (row) => row.unfilled_shares },
    { key: "fill_ratio", header: "Fill Ratio", align: "right", render: (row) => pctFromDecimal(row.fill_ratio), sortVal: (row) => row.fill_ratio },
    { key: "reason", header: "Reason", render: (row) => <span className="text-term-text-mute">{row.reason_code ?? "-"}</span>, sortVal: (row) => row.reason_code ?? "" },
  ];

  const economicsColumns: Column<NonNullable<IbalResult["economics"]>["components"][number]>[] = [
    { key: "component", header: "Component", render: (row) => <span className="text-term-text">{row.component_name}</span>, sortVal: (row) => row.component_name },
    { key: "version", header: "Version", render: (row) => <span className="text-term-text-mute">{row.component_version}</span>, sortVal: (row) => row.component_version },
    { key: "unscaled", header: "Value", align: "right", render: (row) => fmtUsdAbbr(row.unscaled_value_usd), sortVal: (row) => row.unscaled_value_usd },
    { key: "baseline", header: "Baseline", align: "right", render: (row) => fmtUsdAbbr(row.baseline_value_usd), sortVal: (row) => row.baseline_value_usd },
    { key: "delta", header: "Delta", align: "right", render: (row) => <span className={row.delta_usd >= 0 ? "text-term-up" : "text-term-down"}>{fmtUsdAbbr(row.delta_usd)}</span>, sortVal: (row) => row.delta_usd },
  ];

  const issueColumns: Column<LocatedIssue>[] = [
    { key: "severity", header: "Severity", align: "center", render: (row) => <Tag tone={row.severity === "warning" ? "amber" : "down"}>{row.severity ?? "error"}</Tag>, sortVal: (row) => (row.severity === "warning" ? 0 : 1) },
    { key: "code", header: "Code", render: (row) => <span className="font-mono text-term-text">{row.code}</span>, sortVal: (row) => row.code },
    { key: "location", header: "Location", render: (row) => <span className="text-term-text-dim">{row.location}</span>, sortVal: (row) => row.location },
    { key: "message", header: "Message", render: (row) => <span className="text-term-text-mute">{row.message}</span>, sortVal: (row) => row.message },
  ];

  const constraintColumns: Column<IbalConstraint>[] = [
    { key: "kind", header: "Kind", render: (row) => <span className="text-term-text">{row.row.kind}</span>, sortVal: (row) => row.row.kind },
    { key: "scope", header: "Scope", render: (row) => <span className="text-term-text-dim">{row.row.scope_id}</span>, sortVal: (row) => row.row.scope_id },
    { key: "activity", header: "Activity", align: "right", render: (row) => fmtAbbr(row.activity), sortVal: (row) => row.activity },
    { key: "slack", header: "Slack", align: "right", render: (row) => <span className={Math.abs(row.slack ?? 0) < 1e-8 ? "text-term-amber" : "text-term-text-dim"}>{fmtAbbr(row.slack ?? 0)}</span>, sortVal: (row) => row.slack ?? 0 },
    { key: "dual", header: "Dual", align: "right", render: (row) => fmtAbbr(row.dual_value ?? 0), sortVal: (row) => row.dual_value ?? 0 },
  ];

  const baseRouteAnalyticsColumns: Column<BaseRouteAnalyticsRow>[] = [
    { key: "route", header: "Route", render: (row) => <span className="text-term-text">{row.route_id}</span>, sortVal: (row) => row.route_id, width: "120" },
    { key: "inventory", header: "Inventory", render: (row) => <span className="text-term-text-dim">{row.inventory_id}</span>, sortVal: (row) => row.inventory_id, width: "120" },
    { key: "security", header: "Security", render: (row) => <span className="text-term-text-dim">{row.security_id}</span>, sortVal: (row) => row.security_id },
    { key: "borrower", header: "Borrower", render: (row) => <span className="text-term-text-mute">{row.borrower_id}</span>, sortVal: (row) => row.borrower_id },
    { key: "current", header: "Before", align: "right", render: (row) => fmtAbbr(row.current_quantity_shares), sortVal: (row) => row.current_quantity_shares },
    { key: "post", header: "After", align: "right", render: (row) => <span className="text-term-text">{fmtAbbr(row.post_quantity_shares)}</span>, sortVal: (row) => row.post_quantity_shares },
    { key: "delta", header: "Delta", align: "right", render: (row) => <span className={row.delta_shares > 0 ? "text-term-up" : row.delta_shares < 0 ? "text-term-down" : "text-term-text-mute"}>{fmtAbbr(row.delta_shares)}</span>, sortVal: (row) => Math.abs(row.delta_shares) },
    { key: "notional", header: "Delta Notional", align: "right", render: (row) => <span className={row.delta_notional_usd >= 0 ? "text-term-up" : "text-term-down"}>{fmtUsdAbbr(row.delta_notional_usd)}</span>, sortVal: (row) => Math.abs(row.delta_notional_usd) },
    { key: "reason", header: "Reason", render: (row) => <span className="text-term-text-mute">{row.reason_codes.slice(0, 3).join(", ") || "-"}</span>, sortVal: (row) => row.reason_codes[0] ?? "" },
  ];

  const baseInventoryAnalyticsColumns: Column<BaseInventoryAnalyticsRow>[] = [
    { key: "inventory", header: "Inventory", render: (row) => <span className="text-term-text">{row.inventory_id}</span>, sortVal: (row) => row.inventory_id },
    { key: "security", header: "Security", render: (row) => <span className="text-term-text-dim">{row.security_id}</span>, sortVal: (row) => row.security_id },
    { key: "before_on_loan", header: "Before Loan", align: "right", render: (row) => fmtAbbr(row.pre_on_loan_shares), sortVal: (row) => row.pre_on_loan_shares },
    { key: "after_on_loan", header: "After Loan", align: "right", render: (row) => <span className="text-term-text">{fmtAbbr(row.post_on_loan_shares)}</span>, sortVal: (row) => row.post_on_loan_shares },
    { key: "loan_delta", header: "Loan Delta", align: "right", render: (row) => <span className={row.delta_on_loan_shares > 0 ? "text-term-up" : row.delta_on_loan_shares < 0 ? "text-term-down" : "text-term-text-mute"}>{fmtAbbr(row.delta_on_loan_shares)}</span>, sortVal: (row) => Math.abs(row.delta_on_loan_shares) },
    { key: "available_delta", header: "Avail Delta", align: "right", render: (row) => <span className={row.delta_available_shares >= 0 ? "text-term-up" : "text-term-down"}>{fmtAbbr(row.delta_available_shares)}</span>, sortVal: (row) => Math.abs(row.delta_available_shares) },
    { key: "util_before", header: "Before Util", align: "right", render: (row) => pctFromDecimal(row.pre_utilization), sortVal: (row) => row.pre_utilization },
    { key: "util_after", header: "After Util", align: "right", render: (row) => <span className={row.utilization >= 0.95 ? "text-term-down" : row.utilization >= 0.8 ? "text-term-amber" : "text-term-text"}>{pctFromDecimal(row.utilization)}</span>, sortVal: (row) => row.utilization },
    { key: "util_delta", header: "Util Delta", align: "right", render: (row) => <span className={row.utilization_delta >= 0 ? "text-term-up" : "text-term-down"}>{fmtPct(row.utilization_delta * 100, 2)}</span>, sortVal: (row) => Math.abs(row.utilization_delta) },
  ];

  const baseDemandAnalyticsColumns: Column<BaseDemandAnalyticsRow>[] = [
    { key: "demand", header: "Demand Group", render: (row) => <span className="text-term-text">{row.demand_group_id}</span>, sortVal: (row) => row.demand_group_id },
    { key: "security", header: "Security", render: (row) => <span className="text-term-text-dim">{row.security_id}</span>, sortVal: (row) => row.security_id },
    { key: "borrower", header: "Borrower", render: (row) => <span className="text-term-text-mute">{row.borrower_id}</span>, sortVal: (row) => row.borrower_id },
    { key: "cap", header: "Demand Cap", align: "right", render: (row) => fmtAbbr(row.effective_cap_shares), sortVal: (row) => row.effective_cap_shares },
    { key: "filled", header: "Filled", align: "right", render: (row) => <span className="text-term-text">{fmtAbbr(row.filled_shares)}</span>, sortVal: (row) => row.filled_shares },
    { key: "shortfall", header: "Shortfall", align: "right", render: (row) => <span className={row.shortfall_shares > 0 ? "text-term-amber" : "text-term-text-mute"}>{fmtAbbr(row.shortfall_shares)}</span>, sortVal: (row) => row.shortfall_shares },
    { key: "fill", header: "Fill", align: "right", render: (row) => pctFromDecimal(row.fill_ratio), sortVal: (row) => row.fill_ratio },
    { key: "reason", header: "Reason", render: (row) => <span className="text-term-text-mute">{row.reason_code ?? "-"}</span>, sortVal: (row) => row.reason_code ?? "" },
  ];

  const reasonCodeAnalyticsColumns: Column<ReasonCodeAnalyticsRow>[] = [
    { key: "reason", header: "Reason Code", render: (row) => <span className="text-term-text">{row.reason_code}</span>, sortVal: (row) => row.reason_code },
    { key: "routes", header: "Routes", align: "right", render: (row) => fmtInt(row.route_count), sortVal: (row) => row.route_count },
    { key: "net", header: "Net Delta", align: "right", render: (row) => <span className={row.net_delta_shares > 0 ? "text-term-up" : row.net_delta_shares < 0 ? "text-term-down" : "text-term-text-mute"}>{fmtAbbr(row.net_delta_shares)}</span>, sortVal: (row) => Math.abs(row.net_delta_shares) },
    { key: "gross", header: "Gross Delta", align: "right", render: (row) => fmtAbbr(row.gross_delta_shares), sortVal: (row) => row.gross_delta_shares },
  ];

  const whatIfColumns: Column<WhatIfResult>[] = [
    { key: "scenario", header: "Scenario", render: (row) => <span className="font-semibold text-term-text">{row.label}</span>, sortVal: (row) => row.label, width: "170" },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => (
        <Tag tone={row.status === "optimal" ? "up" : row.status === "failed" ? "down" : row.status === "running" ? "amber" : "neutral"}>
          {row.status}
        </Tag>
      ),
      sortVal: (row) => row.status,
      width: "90",
    },
    {
      key: "delta",
      header: "Delta Value",
      align: "right",
      render: (row) => row.totalDeltaUsd == null ? <span className="text-term-text-mute">-</span> : <span className={row.totalDeltaUsd >= 0 ? "text-term-up" : "text-term-down"}>{fmtUsdAbbr(row.totalDeltaUsd)}</span>,
      sortVal: (row) => row.totalDeltaUsd ?? Number.NEGATIVE_INFINITY,
    },
    {
      key: "vs_base",
      header: "Vs Base",
      align: "right",
      render: (row) => {
        const diff = row.totalDeltaUsd != null && baselineScenario?.totalDeltaUsd != null ? row.totalDeltaUsd - baselineScenario.totalDeltaUsd : null;
        return diff == null ? <span className="text-term-text-mute">-</span> : <span className={diff >= 0 ? "text-term-up" : "text-term-down"}>{fmtUsdAbbr(diff)}</span>;
      },
      sortVal: (row) => row.totalDeltaUsd != null && baselineScenario?.totalDeltaUsd != null ? row.totalDeltaUsd - baselineScenario.totalDeltaUsd : Number.NEGATIVE_INFINITY,
    },
    { key: "fill", header: "Fill", align: "right", render: (row) => row.fillRatio == null ? "-" : pctFromDecimal(row.fillRatio), sortVal: (row) => row.fillRatio ?? -1 },
    { key: "util", header: "Avg Util", align: "right", render: (row) => row.avgUtilization == null ? "-" : pctFromDecimal(row.avgUtilization), sortVal: (row) => row.avgUtilization ?? -1 },
    { key: "binding", header: "Binding", align: "right", render: (row) => row.bindingConstraints == null ? "-" : fmtInt(row.bindingConstraints), sortVal: (row) => row.bindingConstraints ?? -1 },
    { key: "net", header: "Net Allocation", align: "right", render: (row) => row.netAllocation == null ? "-" : fmtAbbr(row.netAllocation), sortVal: (row) => row.netAllocation ?? Number.NEGATIVE_INFINITY },
    { key: "message", header: "Message", render: (row) => <span className="text-term-text-mute">{row.message ?? row.requestHash?.slice(0, 12) ?? "-"}</span>, sortVal: (row) => row.message ?? row.requestHash ?? "" },
  ];

  const baseRunDriverColumns: Column<DriverDelta>[] = [
    { key: "entity", header: "Entity", render: (row) => <span className="text-term-text" title={row.entityId}>{row.label}</span>, sortVal: (row) => row.label },
    { key: "presence", header: "Presence", align: "center", render: (row) => <Tag tone={row.presence === "matched" ? "neutral" : row.presence === "new" ? "blue" : "amber"}>{row.presence}</Tag>, sortVal: (row) => row.presence },
    { key: "baseline", header: "Baseline", align: "right", render: (row) => row.baselineQuantityShares == null ? <span className="text-term-text-mute">N/A</span> : fmtAbbr(row.baselineQuantityShares), sortVal: (row) => row.baselineQuantityShares ?? Number.NEGATIVE_INFINITY },
    { key: "comparison", header: "Comparison", align: "right", render: (row) => row.comparisonQuantityShares == null ? <span className="text-term-text-mute">N/A</span> : fmtAbbr(row.comparisonQuantityShares), sortVal: (row) => row.comparisonQuantityShares ?? Number.NEGATIVE_INFINITY },
    { key: "delta", header: "Delta", align: "right", render: (row) => row.deltaShares == null ? <span className="text-term-text-mute">N/A</span> : <span className={row.deltaShares > 0 ? "text-term-up" : row.deltaShares < 0 ? "text-term-down" : "text-term-text-mute"}>{fmtAbbr(row.deltaShares)}</span>, sortVal: (row) => row.deltaShares == null ? Number.NEGATIVE_INFINITY : Math.abs(row.deltaShares) },
    { key: "coverage", header: "Coverage", align: "center", render: (row) => <Tag tone={row.coverage === "complete" ? "up" : row.coverage === "partial" ? "amber" : "neutral"}>{row.coverage}</Tag>, sortVal: (row) => row.coverage },
  ];

  async function doRefreshSynthetic() {
    dispatchWorkflow({ type: "start", phase: "preparing" });
    try {
      const next = await generateSyntheticDataset(synthetic);
      setDataset(next);
      setResult(null);
      setMessage(`Prepared ${next.source.mode} dataset ${next.request_hash.slice(0, 12)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Synthetic dataset failed.");
      void refreshEngineStatus();
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      dispatchWorkflow({ type: "finish" });
    }
  }

  async function doUploadFile(file: File) {
    dispatchWorkflow({ type: "start", phase: "preparing" });
    try {
      const next = await uploadIbalDataset(file);
      setDataset(next);
      setResult(null);
      setMessage(`Uploaded ${next.source.filename ?? file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
      void refreshEngineStatus();
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      dispatchWorkflow({ type: "finish" });
    }
  }

  // Preparing a new dataset always discards whatever is currently prepared/solved, so gate both
  // entry points behind a confirmation once there's something to lose.
  function refreshSynthetic() {
    if (dataset) {
      setPendingAction({ kind: "synthetic" });
      return;
    }
    void doRefreshSynthetic();
  }

  function uploadFile(file: File | null) {
    if (!file) return;
    const blocked = uploadBlockReason(capabilities, file);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    if (dataset) {
      setPendingAction({ kind: "upload", file });
      return;
    }
    void doUploadFile(file);
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === "synthetic") void doRefreshSynthetic();
    else void doUploadFile(action.file);
  }

  function resetAll() {
    dispatchWorkflow({ type: "reset" });
    setBaseRunHistory([]);
    setBaselineRunId(null);
    setComparisonRunId(null);
  }

  async function solveCurrent() {
    if (!dataset) return;
    dispatchWorkflow({ type: "start", phase: "solving" });
    setSelectedRouteId(null);
    try {
      const response = await runIbal(dataset, runConfig);
      setResult(response.result);
      // Spec013 decision 2: an infeasible solve opens its explanation.
      if (response.result.status === "infeasible") setResultTab("infeasibility");
      setBaseRunHistory((current) => current.some((run) => run.result.run_id === response.result.run_id)
        ? current
        : [...current, { dataset, result: response.result }]);
      setBaselineRunId((current) => current ?? response.result.run_id);
      setComparisonRunId(response.result.run_id);
      setMessage(`Run ${response.result.run_id} returned ${response.result.status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run failed.");
      void refreshEngineStatus();
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      dispatchWorkflow({ type: "finish" });
    }
  }

  // Exports whichever result is currently on screen (the plain Base Case Run, or the selected
  // What If scenario) rather than always the raw base run, so the download matches what the user
  // is actually looking at.
  async function exportBundle() {
    if (!viewDataset || !viewResult) return;
    dispatchWorkflow({ type: "start", phase: "exporting" });
    try {
      const blob = await exportIbalBundle(viewDataset, viewResult);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const slug = viewLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      anchor.download = `ibal-result-bundle-${slug || "base-case"}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`Export bundle created for ${viewLabel}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
      void refreshEngineStatus();
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      dispatchWorkflow({ type: "finish" });
    }
  }

  function exportScenarioComparisonCsv() {
    if (!whatIfResults.length) return;
    const header = ["Scenario", "Status", "Delta Value USD", "Vs Base USD", "Fill Ratio", "Avg Utilization", "Binding Constraints", "Net Allocation Shares", "Message"];
    const rows = whatIfResults.map((row) => {
      const vsBase = row.totalDeltaUsd != null && baselineScenario?.totalDeltaUsd != null ? row.totalDeltaUsd - baselineScenario.totalDeltaUsd : "";
      return [
        row.label,
        row.status,
        row.totalDeltaUsd ?? "",
        vsBase,
        row.fillRatio ?? "",
        row.avgUtilization ?? "",
        row.bindingConstraints ?? "",
        row.netAllocation ?? "",
        row.message ?? "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `ibal-scenario-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function toggleScenario(id: WhatIfScenarioId) {
    setSelectedScenarioIds((current) => {
      if (current.includes(id)) return current.length === 1 ? current : current.filter((value) => value !== id);
      return [...current, id];
    });
  }

  function summarizeScenarioResult(scenario: WhatIfScenario, nextDataset: DatasetEnvelope, nextResult: IbalResult): WhatIfResult {
    const filled = nextResult.demand.reduce((sum, row) => sum + row.filled_shares, 0);
    const effectiveCap = nextResult.demand.reduce((sum, row) => sum + row.effective_cap_shares, 0);
    const avgUtilization = nextResult.balances.length
      ? nextResult.balances.reduce((sum, row) => sum + row.utilization, 0) / nextResult.balances.length
      : 0;
    return {
      id: scenario.id,
      label: scenario.label,
      status: nextResult.status === "optimal" ? "optimal" : "failed",
      message: nextResult.status,
      requestHash: nextDataset.request_hash,
      runId: nextResult.run_id,
      totalDeltaUsd: nextResult.economics?.total_delta_usd ?? 0,
      avgUtilization,
      fillRatio: effectiveCap > 0 ? filled / effectiveCap : 0,
      bindingConstraints: nextResult.constraints.filter((row) => Math.abs(row.slack ?? 0) < 1e-8).length,
      netAllocation: nextResult.allocations.reduce((sum, row) => sum + row.increase_shares - row.decrease_shares, 0),
      dataset: nextDataset,
      result: nextResult,
    };
  }

  async function runWhatIfScenarios() {
    const scenarios = allScenarios.filter((scenario) => scenarioSet.has(scenario.id));
    if (!scenarios.length) return;
    dispatchWorkflow({ type: "start", phase: "scenario" });
    setSelectedWhatIfId(scenarios[0]?.id ?? null);
    setWhatIfResults(scenarios.map((scenario) => ({ id: scenario.id, label: scenario.label, status: "pending" })));
    try {
      for (const scenario of scenarios) {
        setWhatIfResults((rows) => rows.map((row) => row.id === scenario.id ? { ...row, status: "running", message: "Solving..." } : row));
        try {
          // Presets keep the live seed so only their shock differs; a custom shock replays its own seed.
          const scenarioSynthetic = scenarioSyntheticConfig(synthetic, scenario);
          const scenarioRunConfig = { ...runConfig, ...(scenario.runConfig ?? {}) };
          const nextDataset = await generateSyntheticDataset(scenarioSynthetic);
          if (!nextDataset.validation.valid) {
            setWhatIfResults((rows) => rows.map((row) => row.id === scenario.id ? {
              ...row,
              status: "failed",
              message: nextDataset.validation.issues[0]?.message ?? "Dataset validation failed.",
              requestHash: nextDataset.request_hash,
            } : row));
            continue;
          }
          const response = await runIbal(nextDataset, scenarioRunConfig);
          setWhatIfResults((rows) => rows.map((row) => row.id === scenario.id ? summarizeScenarioResult(scenario, nextDataset, response.result) : row));
        } catch (error) {
          setWhatIfResults((rows) => rows.map((row) => row.id === scenario.id ? {
            ...row,
            status: "failed",
            message: error instanceof Error ? error.message : "Scenario failed.",
          } : row));
          if (error instanceof IbalRequestError && error.issues.length) setActionIssues(error.issues);
        }
      }
      setMessage(`Completed ${scenarios.length} what-if ${scenarios.length === 1 ? "scenario" : "scenarios"}.`);
    } finally {
      dispatchWorkflow({ type: "finish" });
    }
  }

  async function runEngineScenarioStressTest() {
    if (!dataset || !result) return;
    setEngineScenarioBusy(true);
    setEngineScenarioError(null);
    setEngineScenarioResponse(null);
    try {
      const parameters = JSON.parse(engineScenarioParameters) as Record<string, unknown>;
      if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
        throw new Error("Scenario parameters must be a JSON object.");
      }
      const response = await runIbalScenarioStress(dataset, runConfig, result, engineScenarioType, parameters);
      setEngineScenarioResponse(response);
      setMessage(`Completed ${response.stress_report.scenario_count} InventoryBallast engine scenario${response.stress_report.scenario_count === 1 ? "" : "s"}.`);
    } catch (error) {
      setEngineScenarioError(error instanceof Error ? error.message : "Scenario stress run failed.");
      void refreshEngineStatus();
      if (error instanceof IbalRequestError && error.issues.length) setActionIssues(error.issues);
    } finally {
      setEngineScenarioBusy(false);
    }
  }

  function exportEngineScenarioCsv() {
    if (!engineScenarioResponse) return;
    const header = ["Baseline Run ID", "Input Hash", "Config Hash", "Scenario ID", "Scenario", "Scenario Type", "Scenario Version", "Scenario Parameters", "Scenario JSON", "Rank", "Status", "Verified", "Objective Delta USD", "Dimension", "Entity ID", "Presence", "Baseline Shares", "Scenario Shares", "Delta Shares", "Reconciliation Residual Shares"];
    const generatedById = new Map(engineScenarioResponse.generated_scenarios.map((scenario) => [String(scenario.scenario_id), scenario]));
    const rows = engineScenarioResponse.stress_report.outcomes.flatMap((outcome) => {
      const residuals = new Map(outcome.driver_reconciliations.map((item) => [item.dimension, item.residual_shares]));
      const generated = generatedById.get(outcome.scenario_id);
      const metadata = (generated?.metadata ?? {}) as Record<string, unknown>;
      return outcome.driver_deltas.map((delta) => [
        engineScenarioResponse.baseline_run_id,
        engineScenarioResponse.request_hash,
        engineScenarioResponse.baseline_config_hash,
        outcome.scenario_id,
        outcome.scenario_name,
        metadata.scenario_type ?? engineScenarioResponse.scenario_type,
        metadata.scenario_version ?? "",
        metadata.parameters_json ?? "",
        JSON.stringify(generated ?? {}),
        outcome.rank ?? "",
        outcome.status,
        outcome.verification_passed,
        outcome.objective_delta_usd ?? "",
        delta.dimension,
        delta.entity_id,
        delta.presence,
        delta.baseline_quantity_shares,
        delta.scenario_quantity_shares,
        delta.delta_shares,
        residuals.get(delta.dimension) ?? "",
      ]);
    });
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `ibal-engine-scenario-attribution-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  async function doWarmUp() {
    setWarm("Warming up…");
    const outcome = await warmUp();
    setWarmed(outcome.ok);
    setWarm(outcome.ok ? `Warm · ${outcome.ms} ms` : `Warm-up incomplete: ${outcome.failed.join(", ")}`);
    await refreshEngineStatus();
  }

  const needDataset = dataset?.validation.valid ? undefined : "Generate a book first.";
  const needBase = result ? undefined : "Solve the base case first.";
  const presenterSteps: PresenterStepView[] = [
    { ...PRESENTER_STEPS[0], done: warmed && Boolean(health?.ready) && !engineBlock, busy: engineChecking || warm === "Warming up…", run: () => void doWarmUp() },
    { ...PRESENTER_STEPS[1], done: Boolean(dataset?.validation.valid), busy: workflow.phase === "preparing", disabledReason: engineBlock ?? undefined, run: () => void doRefreshSynthetic() },
    { ...PRESENTER_STEPS[2], done: result?.status === "optimal", busy: workflow.phase === "solving", disabledReason: needDataset, run: () => void solveCurrent() },
    { ...PRESENTER_STEPS[3], done: Boolean(engineScenarioResponse), busy: engineScenarioBusy, disabledReason: needBase, run: () => void runEngineScenarioStressTest() },
    { ...PRESENTER_STEPS[4], done: suiteCount > 0, busy: false, disabledReason: needBase, run: () => setSuiteToken((token) => token + 1) },
    { ...PRESENTER_STEPS[5], done: whatIfResults.some((row) => row.status === "optimal"), busy: scenarioBusy, disabledReason: needDataset, run: () => void runWhatIfScenarios() },
  ];
  const presenterDone = presenterSteps.map((step) => step.done).join();
  useEffect(() => {
    if (presenting) setPresenterIndex(currentStepIndex(presenterDone.split(",").map((value) => value === "true")));
  }, [presenting, presenterDone]);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="IBAL"
        title="InventoryBallast"
        desc="Inventory optimizer · synthetic or uploaded datasets · pinned solver service"
        showStreaming={false}
        asOf={dataset?.summary.as_of ?? null}
        right={
          <span className="flex items-center gap-1">
            <button
              type="button"
              className={`term-btn px-2 py-0.5 text-3xs ${presenting ? "border-term-amber text-term-amber" : ""}`}
              aria-pressed={presenting}
              title="Guided demo: warms the engine up and walks through the story step by step"
              onClick={() => { const next = !presenting; setPresenting(next); if (next && !warmed) void doWarmUp(); }}
            >
              Present
            </button>
            {health?.ready ? (
              <>
                <ProvenanceBadge source={sourceFor(dataset, health)} />
                <Tag tone="up">READY</Tag>
              </>
            ) : (
              <DevelopmentBadge />
            )}
          </span>
        }
      />

      {presenting && <PresenterBar steps={presenterSteps} index={presenterIndex} onIndex={setPresenterIndex} warm={warm} onExit={() => setPresenting(false)} />}

      <KpiStrip>
        <Stat label="Securities" value={fmtInt(dataset?.summary.security_count ?? 0)} sub={`${fmtInt(dataset?.summary.borrower_count ?? 0)} borrowers`} />
        <Stat label="Available" value={fmtAbbr(dataset?.summary.total_available_shares ?? 0)} sub="shares" />
        <Stat label="Demand" value={fmtAbbr(dataset?.summary.total_demand_shares ?? 0)} sub="shares" />
        <Stat label="Run Status" value={result?.status?.toUpperCase() ?? "-"} tone={result?.status === "optimal" ? "up" : "neutral"} sub={result?.solver ? `${fmtInt((result.solver.runtime_seconds ?? 0) * 1000)}ms` : "not run"} />
        <Stat label="Delta Value" value={fmtUsdAbbr(result?.economics?.total_delta_usd ?? 0)} tone={(result?.economics?.total_delta_usd ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="Avg Utilization" value={pctFromDecimal(totals.avgUtilization)} sub={`${fmtInt(totals.bindingConstraints)} binding rows`} />
      </KpiStrip>

      <EngineStatusStrip health={health} capabilities={capabilities} blockReason={engineBlock} checking={engineChecking} onRecheck={() => void refreshEngineStatus()} />
      <IbalShowcase health={health} capabilities={capabilities} />

      {message && (
        <div className="border-b border-term-border bg-term-panel-2 px-3 py-1 text-2xs text-term-text-dim">
          {message}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-2">
          <Panel
            title="Dataset Intake"
            code="DATA"
            accent
            resizable={false}
            right={
              <Tag tone={!dataset ? "neutral" : dataset.validation.valid ? "up" : "down"}>
                {!dataset ? "NO DATA" : dataset.validation.valid ? "LOADED" : "INVALID"}
              </Tag>
            }
          >
            <div className="grid gap-2 p-2 text-2xs">
              <div className={`flex items-start gap-2 border px-2 py-1.5 ${datasetReady ? "border-term-up/30 bg-term-up/10 text-term-up" : dataset ? "border-term-down/30 bg-term-down/10 text-term-down" : "border-term-border bg-term-panel-2 text-term-text-dim"}`}>
                {datasetReady ? <CheckCircle2 className="mt-0.5 shrink-0" size={13} /> : <AlertCircle className="mt-0.5 shrink-0" size={13} />}
                <div className="min-w-0">
                  <div className="font-semibold uppercase tracking-wide">
                    {datasetReady ? "Dataset loaded successfully" : dataset ? "Dataset loaded with issues" : "No dataset loaded"}
                  </div>
                  <div className="truncate text-term-text-mute" title={dataset ? `${dataset.source.label} ${dataset.request_hash}` : "Generate synthetic data or upload a JSON/XLSX dataset before running."}>
                    {dataset
                      ? `${dataset.source.label} · ${dataset.request_hash.slice(0, 12)} · ${fmtInt(dataset.summary.row_counts.inventory)} inventory / ${fmtInt(dataset.summary.row_counts.routes)} routes`
                      : "Generate Synthetic or Upload JSON/XLSX before running."}
                  </div>
                </div>
              </div>
              <label className="grid gap-1 text-term-text-dim">
                Profile
                <select className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" value={synthetic.profile} onChange={(event) => setSynthetic({ ...synthetic, profile: event.target.value as SyntheticConfig["profile"] })}>
                  {["balanced", "scarce", "concentrated", "specials"].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-term-text-dim">
                Scale
                <select className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" value={synthetic.scale} onChange={(event) => setSynthetic({ ...synthetic, scale: event.target.value as SyntheticConfig["scale"] })}>
                  {["small", "medium", "large", "custom"].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-term-text-dim">
                Seed
                <input className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" type="number" value={synthetic.seed} onChange={(event) => updateNumber(setSynthetic, synthetic, "seed", event.target.value)} />
              </label>
              {syntheticField("Borrower concentration", "borrower_concentration", { min: 0, max: 1, step: 0.01 })}
              {syntheticField("Utilization cap", "utilization_cap", { min: 0.25, max: 1, step: 0.01 })}

              {synthetic.scale === "custom" && (
                <div className="grid gap-2 border-t border-term-border pt-2">
                  <span className="term-label">Custom shape</span>
                  {syntheticCountField("Securities", "security_count", { min: 1, max: 100 })}
                  {syntheticCountField("Inventory pools", "inventory_pool_count", { min: 1, max: 20 })}
                  {syntheticCountField("Borrowers", "borrower_count", { min: 1, max: 100 })}
                  {syntheticCountField("Parent groups", "parent_group_count", { min: 1, max: Math.min(synthetic.borrower_count, MAX_SYNTHETIC_PARENT_GROUPS) })}
                  {syntheticCountField("Routes per security", "routes_per_security", { min: 1, max: 20 })}
                </div>
              )}

              <button
                type="button"
                className="term-btn justify-between border-none bg-transparent px-0 text-term-text-dim hover:text-term-text"
                onClick={() => setShowAdvancedSynthetic((v) => !v)}
              >
                Advanced
                {showAdvancedSynthetic ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {showAdvancedSynthetic && (
                <div className="grid gap-2 border-t border-term-border pt-2">
                  {syntheticField("Starting utilization", "starting_utilization", { min: 0, max: 0.85, step: 0.01 })}
                  {syntheticField("Fee rate mean", "fee_rate_mean", { min: 0.0001, max: 0.25, step: 0.0001 })}
                  {syntheticField("Fee rate dispersion", "fee_rate_dispersion", { min: 0, max: 0.1, step: 0.001 })}
                  {syntheticField("Elasticity mean", "elasticity_mean", { min: 0, max: 5, step: 0.01 })}
                  {syntheticField("Reserve fraction", "reserve_fraction", { min: 0, max: 0.3, step: 0.01 })}
                  {syntheticField("Ineligible fraction", "ineligible_fraction", { min: 0, max: 0.5, step: 0.01 })}
                  {syntheticField("Discrete route fraction", "discrete_route_fraction", { min: 0, max: 0.5, step: 0.01, disabledReason: discreteRouteBlock })}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <a className="term-btn justify-center" href="/api/inventory-optimizer/templates/starter-xlsx">
                  <Download size={13} /> XLSX
                </a>
                <a className="term-btn justify-center" href="/api/inventory-optimizer/templates/request-json">
                  <Download size={13} /> JSON
                </a>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="term-btn justify-center" disabled={busy} onClick={refreshSynthetic}>
                  <RefreshCw size={13} /> Synthetic
                </button>
                <label className="term-btn cursor-pointer justify-center">
                  <Upload size={13} /> Upload
                  <input className="hidden" type="file" accept={uploadAccept(capabilities)} onChange={(event) => uploadFile(event.target.files?.[0] ?? null)} />
                </label>
              </div>
              <button className="term-btn justify-center" disabled={!dataset || busy} onClick={resetAll}>
                <RotateCcw size={13} /> Reset
              </button>
            </div>
          </Panel>

          <Panel title="Run Config" code="SOLVE" resizable={false}>
            <div className="grid gap-2 p-2 text-2xs">
              <div className="flex items-center justify-between gap-2 border border-term-border bg-term-panel-2 px-2 py-1.5">
                <div className="min-w-0">
                  <div className="term-label">Run readiness</div>
                  <div className="truncate text-term-text-mute" title={runDisabledReason ?? "Dataset is valid and ready to run."}>
                    {runDisabledReason ?? "Dataset is valid and ready to run."}
                  </div>
                </div>
                <Tag tone={runReady ? "up" : engineBlock ? "down" : dataset ? "amber" : "neutral"}>{runReady ? "READY" : engineBlock ? "BLOCKED" : "WAIT"}</Tag>
              </div>
              <label className="grid gap-1 text-term-text-dim">
                Time limit seconds
                <input className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" type="number" min={1} max={capabilities?.limits.solve_timeout_seconds ?? 60} value={runConfig.solver_time_limit_seconds} onChange={(event) => updateNumber(setRunConfig, runConfig, "solver_time_limit_seconds", event.target.value)} />
              </label>
              <button
                className="term-btn justify-center border-term-amber text-term-amber disabled:border-term-border disabled:text-term-text-mute"
                disabled={!runReady}
                title={runDisabledReason ?? "Run optimizer"}
                onClick={solveCurrent}
              >
                <Play size={13} /> {runButtonLabel}
              </button>
              <button className="term-btn justify-center" disabled={!viewDataset || !viewResult || busy} title={`Export ${viewLabel} result bundle`} onClick={exportBundle}>
                <Download size={13} /> Export {viewLabel}
              </button>
            </div>
          </Panel>

          <Panel
            title="What If Scenarios"
            code="WIF"
            resizable={false}
            right={<Tag tone={scenarioBusy ? "amber" : whatIfResults.some((row) => row.status === "optimal") ? "up" : "neutral"}>{scenarioBusy ? "RUNNING" : `${selectedScenarioIds.length} SELECTED`}</Tag>}
          >
            <div className="grid gap-2 p-2 text-2xs">
              <div className="border border-term-border bg-term-panel-2 px-2 py-1.5 text-term-text-mute">
                Scenario runs use the synthetic generator and current run config, then apply each selected shock.
              </div>
              <div className="grid gap-1">
                {allScenarios.map((scenario) => (
                  <label key={scenario.id} className="flex cursor-pointer items-start gap-2 border border-term-border bg-term-panel-2 px-2 py-1 hover:border-term-amber/50">
                    <input
                      className="mt-0.5"
                      type="checkbox"
                      checked={scenarioSet.has(scenario.id)}
                      disabled={scenarioBusy}
                      onChange={() => toggleScenario(scenario.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-term-text">{scenario.label}</span>
                      <span className="block truncate text-term-text-mute" title={scenario.desc}>{scenario.desc}</span>
                    </span>
                    {scenario.isCustom && (
                      <button
                        className="mt-0.5 text-term-text-mute hover:text-term-down"
                        disabled={scenarioBusy}
                        title="Remove this custom shock"
                        onClick={(event) => {
                          event.preventDefault();
                          removeCustomShock(scenario.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-1 border border-dashed border-term-border bg-term-panel-2 px-2 py-1">
                <input
                  className="min-w-0 flex-1 border border-term-border bg-term-panel px-2 py-1 text-term-text"
                  type="text"
                  placeholder="Custom shock name..."
                  value={customShockLabel}
                  disabled={scenarioBusy}
                  onChange={(event) => setCustomShockLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addCustomShock();
                  }}
                />
                <button
                  className="term-btn justify-center border-term-blue text-term-blue"
                  disabled={scenarioBusy || !customShockLabel.trim()}
                  title="Save the Dataset Intake and Run Config panels' current settings as a new selectable shock"
                  onClick={addCustomShock}
                >
                  Save as Shock
                </button>
              </div>
              <button
                className="term-btn justify-center border-term-blue text-term-blue"
                disabled={busy || scenarioBusy || selectedScenarioIds.length === 0 || Boolean(engineBlock)}
                title={engineBlock ?? "Run the selected what-if shocks"}
                onClick={runWhatIfScenarios}
              >
                <Play size={13} /> {scenarioBusy ? "Running Scenarios..." : "Run Scenarios"}
              </button>
            </div>
          </Panel>

          <Panel
            title="InventoryBallast Engine Scenario Studio"
            code="ENGINE"
            resizable={false}
            right={<Tag tone={engineScenarioBusy ? "amber" : engineScenarioResponse ? "up" : "neutral"}>{engineScenarioBusy ? "RUNNING" : engineScenarioResponse ? `${engineScenarioResponse.stress_report.scenario_count} COMPLETE` : "ENGINE"}</Tag>}
          >
            <div className="grid gap-2 p-2 text-2xs">
              <div className="border border-term-border bg-term-panel-2 px-2 py-1.5 text-term-text-mute">
                Runs InventoryBallast registry scenarios against this dataset and its verified base run. Parameters are explicit; omitted borrower recovery remains zero.
              </div>
              <label className="grid gap-1 text-term-text-dim">
                Scenario family
                <select
                  className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text"
                  value={engineScenarioType}
                  disabled={engineScenarioBusy || engineScenarioOptions.length === 0}
                  onChange={(event) => setEngineScenarioType(event.target.value)}
                >
                  {engineScenarioOptions.map((item) => <option key={item.scenario_type} value={item.scenario_type}>{item.scenario_type.replaceAll("_", " ")} · v{item.version}</option>)}
                </select>
              </label>
              {selectedEngineScenario && <div className="text-term-text-mute">{selectedEngineScenario.description}</div>}
              <ScenarioSizingForm family={SCENARIO_FAMILIES.find((item) => item.id === engineScenarioType)} values={engineSizing} disabled={engineScenarioBusy} onChange={setEngineSizing} />
              <details className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text-mute">
                <summary className="cursor-pointer">Advanced: explicit engine parameters (JSON)</summary>
                <label className="grid gap-1 text-term-text-dim">
                Validated scenario parameters (JSON)
                <textarea
                  className="min-h-40 border border-term-border bg-term-panel-2 px-2 py-1 font-mono text-3xs text-term-text"
                  spellCheck={false}
                  value={engineScenarioParameters}
                  disabled={engineScenarioBusy}
                  onChange={(event) => {
                    setEngineScenarioParameters(event.target.value);
                    setEngineScenarioResponse(null);
                    setEngineScenarioError(null);
                  }}
                />
              </label>
              </details>
              {selectedEngineScenario && (
                <details className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text-mute">
                  <summary className="cursor-pointer">Engine parameter schema</summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(selectedEngineScenario.parameters_schema, null, 2)}</pre>
                </details>
              )}
              {engineScenarioBlock ? (
                <div className="text-term-amber">{engineScenarioBlock}</div>
              ) : (
                !engineScenarioCatalog.length && <div className="text-term-amber">Scenario registry unavailable. Check that the pinned InventoryBallast engine is ready.</div>
              )}
              {engineScenarioError && <div className="border border-term-down/40 bg-term-down/10 px-2 py-1.5 text-term-down">{engineScenarioError}</div>}
              <button
                className="term-btn justify-center border-term-blue text-term-blue disabled:border-term-border disabled:text-term-text-mute"
                disabled={!dataset || !dataset.validation.valid || !result || !selectedEngineScenario || engineScenarioBusy || busy || Boolean(engineScenarioBlock)}
                title={engineScenarioBlock ?? (!result ? "Run and verify a base case first." : "Run the selected registered scenario against the current baseline.")}
                onClick={runEngineScenarioStressTest}
              >
                <Play size={13} /> {engineScenarioBusy ? "Running Engine Scenario..." : "Run Engine Scenario"}
              </button>
            </div>
          </Panel>
          <StressSuitePanel dataset={dataset} runConfig={runConfig} result={result} disabled={busy || engineScenarioBusy} runToken={suiteToken} onRanked={setSuiteCount} />
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <Panel
            title="Dataset Summary"
            code={dataset?.request_hash.slice(0, 10) ?? "EMPTY"}
            right={
              <Tag tone={!dataset ? "neutral" : dataset.validation.valid ? "up" : "down"}>
                {!dataset ? "NO DATA" : dataset.validation.valid ? "VALID" : "INVALID"}
              </Tag>
            }
          >
            <div className="grid grid-cols-2 divide-x divide-term-border md:grid-cols-4">
              <Stat label="Inventory Rows" value={fmtInt(dataset?.summary.row_counts.inventory ?? 0)} />
              <Stat label="Route Rows" value={fmtInt(dataset?.summary.row_counts.routes ?? 0)} />
              <Stat label="Entity Links" value={fmtInt(dataset?.summary.row_counts.entity_relationships ?? 0)} />
              <Stat label="Source" value={dataset?.source.mode.toUpperCase() ?? "-"} sub={dataset?.source.filename ?? (dataset?.source.seed != null ? `seed ${dataset.source.seed}` : undefined)} />
            </div>
          </Panel>

          {engineScenarioResponse && (
            <Panel
              title="Engine Stress Results · Driver Attribution"
              code="SCENARIO"
              right={
                <span className="flex items-center gap-1">
                  <Tag tone={engineScenarioResponse.stress_report.verification_failed_count ? "down" : "up"}>
                    {engineScenarioResponse.stress_report.feasible_count}/{engineScenarioResponse.stress_report.scenario_count} FEASIBLE
                  </Tag>
                  <button className="term-btn" onClick={exportEngineScenarioCsv} title="Export engine outcomes, entity driver deltas and reconciliation residuals as CSV">
                    <Download size={12} /> CSV
                  </button>
                </span>
              }
            >
              <div className="px-2 pt-2 text-3xs text-term-text-mute">
                Baseline {engineScenarioResponse.baseline_run_id} · input {engineScenarioResponse.request_hash.slice(0, 12)} · config {engineScenarioResponse.baseline_config_hash.slice(0, 12)}
              </div>
              <details className="mx-2 mt-2 border border-term-border bg-term-panel-2 px-2 py-1 text-3xs text-term-text-mute">
                <summary className="cursor-pointer">Generated scenario provenance</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(engineScenarioResponse.generated_scenarios, null, 2)}</pre>
              </details>
              <div className="overflow-auto p-2">
                <table className="w-full border-collapse text-2xs">
                  <thead><tr className="border-b border-term-border text-left text-term-text-mute"><th className="p-1">Rank</th><th className="p-1">Scenario</th><th className="p-1">Status</th><th className="p-1">Verified</th><th className="p-1 text-right">Objective Δ</th></tr></thead>
                  <tbody>{orderedStressOutcomes(engineScenarioResponse.stress_report.outcomes).map((outcome) => (
                    <tr key={outcome.scenario_id} className="border-b border-term-border/60 text-term-text">
                      <td className="p-1">{outcome.verification_passed && (outcome.status === "optimal" || outcome.status === "feasible_limit") ? outcome.rank ?? "—" : "—"}</td><td className="p-1">{outcome.scenario_name}</td><td className="p-1">{outcome.status}</td><td className="p-1">{outcome.verification_passed ? "YES" : "NO"}</td><td className="p-1 text-right">{outcome.verification_passed && (outcome.status === "optimal" || outcome.status === "feasible_limit") && outcome.objective_delta_usd != null ? fmtUsdAbbr(outcome.objective_delta_usd) : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="max-h-72 overflow-auto px-2 pb-2">
                <table className="w-full border-collapse text-2xs">
                  <thead><tr className="border-b border-term-border text-left text-term-text-mute"><th className="p-1">Scenario</th><th className="p-1">Dimension</th><th className="p-1">Entity</th><th className="p-1">Presence</th><th className="p-1 text-right">Baseline</th><th className="p-1 text-right">Scenario</th><th className="p-1 text-right">Δ Shares</th></tr></thead>
                  <tbody>{engineScenarioResponse.stress_report.outcomes.flatMap((outcome) => outcome.driver_deltas.map((delta, index) => (
                    <tr key={`${outcome.scenario_id}-${delta.dimension}-${delta.entity_id}-${index}`} className="border-b border-term-border/50 text-term-text-dim">
                      <td className="p-1">{outcome.scenario_id}</td><td className="p-1">{delta.dimension}</td><td className="p-1">{delta.entity_id}</td><td className="p-1">{delta.presence}</td><td className="p-1 text-right">{fmtAbbr(delta.baseline_quantity_shares)}</td><td className="p-1 text-right">{fmtAbbr(delta.scenario_quantity_shares)}</td><td className="p-1 text-right">{fmtAbbr(delta.delta_shares)}</td>
                    </tr>
                  )))}</tbody>
                </table>
              </div>
              <div className="grid gap-1 border-t border-term-border px-2 py-2 text-3xs text-term-text-mute">
                {engineScenarioResponse.stress_report.outcomes.flatMap((outcome) => outcome.driver_reconciliations.map((item) => (
                  <div key={`${outcome.scenario_id}-${item.dimension}`}>{outcome.scenario_id} · {item.dimension}: attributed {fmtAbbr(item.attributed_delta_shares)} / total {fmtAbbr(item.total_delta_shares)} / residual {fmtAbbr(item.residual_shares)}</div>
                )))}
              </div>
            </Panel>
          )}

          {baseRunHistory.length > 0 && (
            <Panel title="Base-Run Comparison" code="BASE RUNS" accent={Boolean(baseRunComparison?.partial)}>
              <div className="grid gap-2 p-2">
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-term-text-dim">
                    Baseline run
                    <select className="min-w-0 border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" value={baselineRunId ?? ""} onChange={(event) => setBaselineRunId(event.target.value || null)}>
                      {baseRunHistory.map((run) => <option key={run.result.run_id} value={run.result.run_id}>{run.result.created_at} · {run.result.run_id}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-term-text-dim">
                    Comparison run
                    <select className="min-w-0 border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" value={comparisonRunId ?? ""} onChange={(event) => setComparisonRunId(event.target.value || null)}>
                      {baseRunHistory.map((run) => <option key={run.result.run_id} value={run.result.run_id}>{run.result.created_at} · {run.result.run_id}</option>)}
                    </select>
                  </label>
                </div>

                {baseRunComparison && baselineRun && comparisonRun ? (
                  <>
                    <div className="grid gap-2 border-y border-term-border py-2 md:grid-cols-2">
                      {[{ label: "Baseline", identity: baseRunComparison.baseline }, { label: "Comparison", identity: baseRunComparison.comparison }].map(({ label, identity }) => (
                        <div key={label} className="min-w-0 text-3xs leading-5 text-term-text-mute">
                          <div className="mb-1 flex items-center gap-2 text-term-text"><span>{label}</span><Tag tone={identity.status === "optimal" ? "up" : "amber"}>{identity.status}</Tag><Tag>{identity.sourceMode.toUpperCase()}</Tag></div>
                          <div className="break-all">Run {identity.runId} · {identity.createdAt}</div>
                          <div className="break-all">Source {identity.sourceLabel}{identity.seed == null ? "" : ` · seed ${identity.seed}`}{identity.uploadHash ? ` · upload ${identity.uploadHash}` : ""}</div>
                          <div className="break-all">Input {identity.requestHash} · config {identity.configHash}</div>
                          <div className="break-all">Engine {identity.engineVersion} · backend {identity.backendVersion ?? "not reported"} · verification {identity === baseRunComparison.baseline ? (baseRunComparison.baselineMetrics.verificationPassed == null ? "not reported" : baseRunComparison.baselineMetrics.verificationPassed ? "passed" : "failed") : (baseRunComparison.comparisonMetrics.verificationPassed == null ? "not reported" : baseRunComparison.comparisonMetrics.verificationPassed ? "passed" : "failed")}</div>
                        </div>
                      ))}
                    </div>

                    {baseRunComparison.partial && (
                      <div className="border border-term-amber/40 bg-term-amber/10 px-2 py-1 text-2xs text-term-amber" role="status">
                        Partial comparison. {fmtInt(baseRunComparison.unmatchedEntityCount)} unmatched driver rows and {fmtInt(baseRunComparison.unresolvedEntityCount)} unresolved IDs are retained; unavailable deltas are not treated as zero.
                        {(baselineRun.dataset.api_schema_version !== comparisonRun.dataset.api_schema_version || baselineRun.dataset.template_schema_version !== comparisonRun.dataset.template_schema_version || baselineRun.dataset.request.problem_family !== comparisonRun.dataset.request.problem_family) && " Run schemas or problem families differ."}
                      </div>
                    )}

                    <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                      <Stat label="Objective Δ" value={baseRunComparison.portfolioDelta.objectiveDeltaUsd == null ? "N/A" : fmtUsdAbbr(baseRunComparison.portfolioDelta.objectiveDeltaUsd)} tone={baseRunComparison.portfolioDelta.objectiveDeltaUsd == null ? "neutral" : baseRunComparison.portfolioDelta.objectiveDeltaUsd >= 0 ? "up" : "down"} />
                      <Stat label="Allocation Δ" value={baseRunComparison.portfolioDelta.totalAllocationShares == null ? "N/A" : fmtAbbr(baseRunComparison.portfolioDelta.totalAllocationShares)} />
                      <Stat label="Filled Δ" value={baseRunComparison.portfolioDelta.filledShares == null ? "N/A" : fmtAbbr(baseRunComparison.portfolioDelta.filledShares)} />
                      <Stat label="Fill Rate Δ" value={baseRunComparison.portfolioDelta.fillRate == null ? "N/A" : fmtPct(baseRunComparison.portfolioDelta.fillRate * 100, 2)} />
                      <Stat label="Utilization Δ" value={baseRunComparison.portfolioDelta.utilization == null ? "N/A" : fmtPct(baseRunComparison.portfolioDelta.utilization * 100, 2)} />
                      <Stat label="Active Routes Δ" value={baseRunComparison.portfolioDelta.activeRoutes == null ? "N/A" : fmtInt(baseRunComparison.portfolioDelta.activeRoutes)} />
                      <Stat label="Binding Rows Δ" value={baseRunComparison.portfolioDelta.bindingConstraints == null ? "N/A" : fmtInt(baseRunComparison.portfolioDelta.bindingConstraints)} />
                      <Stat label="Warnings Δ" value={fmtInt(baseRunComparison.portfolioDelta.warningCount)} />
                    </div>

                    <div className="grid gap-2 xl:grid-cols-2">
                      {([
                        ["security", "Security Drivers"],
                        ["borrower_parent", "Borrower / Parent Drivers"],
                        ["inventory", "Inventory Drivers"],
                        ["inventory_pool", "Inventory Pool Drivers"],
                        ["route", "Route Drivers"],
                      ] as [DriverDimension, string][]).map(([dimension, title]) => (
                        <section key={dimension} className="min-w-0 border border-term-border">
                          <h3 className="border-b border-term-border px-2 py-1 text-2xs font-semibold text-term-text-dim">{title} · ABSOLUTE SHARE DELTA</h3>
                          <DataGrid columns={baseRunDriverColumns} rows={baseRunComparison.drivers[dimension]} rowKey={(row) => `${row.presence}-${row.entityId}`} maxHeight="220px" initialSort={{ key: "delta", dir: "desc" }} zebra />
                        </section>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="border-y border-term-border py-3 text-2xs text-term-text-mute" role="status">
                    {baseRunHistory.length < 2 ? "A second completed base-case run is needed for comparison." : "Select two different completed runs."}
                  </div>
                )}
              </div>
            </Panel>
          )}

          {whatIfResults.length > 0 && (
            <Panel
              title="Scenario Comparison"
              code="SCENARIO"
              right={
                <span className="flex items-center gap-1">
                  <Tag tone={scenarioBusy ? "amber" : whatIfResults.some((row) => row.status === "failed") ? "down" : "up"}>{scenarioBusy ? "RUNNING" : "COMPLETE"}</Tag>
                  <button className="term-btn" disabled={scenarioBusy} title="Export this comparison table as CSV" onClick={exportScenarioComparisonCsv}>
                    <Download size={12} /> CSV
                  </button>
                </span>
              }
            >
              <div className="px-2 pt-2 text-3xs text-term-text-mute">Select a row to view its full results and visuals below.</div>
              <DataGrid
                columns={whatIfColumns}
                rows={whatIfResults}
                rowKey={(row) => row.id}
                maxHeight="260px"
                initialSort={{ key: "delta", dir: "desc" }}
                zebra
                onRowClick={(row) => setSelectedWhatIfId(row.id)}
                selectedKey={selectedWhatIf?.id ?? undefined}
              />
            </Panel>
          )}

          {beforeAfterAnalytics && (
            <Panel
              title={`${viewLabel} Before / After`}
              code={viewResult?.run_id.slice(0, 10) ?? "ANALYTICS"}
              right={
                <span className="flex items-center gap-1">
                  {whatIfResults.length > 0 && <Tag tone={activeView?.isBase ? "neutral" : "blue"}>{activeView?.isBase ? "BASE CASE" : "SCENARIO"}</Tag>}
                  <Tag tone={viewResult?.verification?.passed ? "up" : "amber"}>
                    {viewResult?.verification?.passed ? "VERIFIED" : "CHECK"}
                  </Tag>
                  <Tag tone={beforeAfterAnalytics.warningCount > 0 ? "amber" : "neutral"}>
                    {fmtInt(beforeAfterAnalytics.warningCount)} WARN
                  </Tag>
                </span>
              }
            >
              <div className="grid gap-2 p-2">
                <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4 xl:grid-cols-6">
                  <Stat
                    label="On Loan"
                    value={fmtAbbr(beforeAfterAnalytics.postOnLoanShares)}
                    sub={`${fmtAbbr(beforeAfterAnalytics.preOnLoanShares)} before`}
                  />
                  <Stat
                    label="Loan Delta"
                    value={fmtAbbr(beforeAfterAnalytics.deltaOnLoanShares)}
                    tone={beforeAfterAnalytics.deltaOnLoanShares >= 0 ? "up" : "down"}
                    sub={`${fmtAbbr(beforeAfterAnalytics.netAllocationShares)} net route`}
                  />
                  <Stat
                    label="Available"
                    value={fmtAbbr(beforeAfterAnalytics.postAvailableShares)}
                    sub={`${fmtAbbr(beforeAfterAnalytics.preAvailableShares)} before`}
                  />
                  <Stat
                    label="Utilization"
                    value={pctFromDecimal(beforeAfterAnalytics.postUtilization)}
                    tone={beforeAfterAnalytics.postUtilization >= 0.95 ? "down" : beforeAfterAnalytics.postUtilization >= 0.8 ? "amber" : "neutral"}
                    sub={`${fmtPct(beforeAfterAnalytics.utilizationDelta * 100, 2)} delta`}
                  />
                  <Stat
                    label="Demand Fill"
                    value={pctFromDecimal(beforeAfterAnalytics.fillRatio)}
                    tone={beforeAfterAnalytics.fillShortfallRatio > 0.1 ? "amber" : "up"}
                    sub={`${fmtAbbr(beforeAfterAnalytics.unfilledShares)} unfilled`}
                  />
                  <Stat
                    label="Route Moves"
                    value={fmtInt(beforeAfterAnalytics.changedRouteCount)}
                    sub={`${fmtInt(beforeAfterAnalytics.unchangedRouteCount)} unchanged`}
                  />
                  <Stat
                    label="Gross Increase"
                    value={fmtAbbr(beforeAfterAnalytics.grossIncreaseShares)}
                    tone="up"
                  />
                  <Stat
                    label="Gross Decrease"
                    value={fmtAbbr(beforeAfterAnalytics.grossDecreaseShares)}
                    tone={beforeAfterAnalytics.grossDecreaseShares > 0 ? "down" : "neutral"}
                  />
                  <Stat
                    label="Active Routes"
                    value={fmtInt(beforeAfterAnalytics.activeRouteCount)}
                    sub={`${fmtInt(viewResult?.allocations.length ?? 0)} total`}
                  />
                  <Stat
                    label="Binding Rows"
                    value={fmtInt(beforeAfterAnalytics.bindingConstraintCount)}
                    tone={beforeAfterAnalytics.bindingConstraintCount > 0 ? "amber" : "neutral"}
                  />
                  <Stat
                    label="Total Delta"
                    value={fmtUsdAbbr(viewResult?.economics?.total_delta_usd ?? 0)}
                    tone={(viewResult?.economics?.total_delta_usd ?? 0) >= 0 ? "up" : "down"}
                  />
                  <Stat
                    label="Status"
                    value={viewResult?.status.toUpperCase() ?? "-"}
                    tone={viewResult?.status === "optimal" ? "up" : "amber"}
                  />
                </div>

                <div className="grid gap-2 xl:grid-cols-[1fr_22rem]">
                  <div>
                    <div className="term-label mb-1">On-Loan Bridge</div>
                    <div className="mx-auto max-w-lg border border-term-border bg-term-panel-2 p-2">
                      <Waterfall steps={onLoanBridgeSteps} height={180} />
                    </div>
                  </div>
                  <div>
                    <div className="term-label mb-1">Demand Fill</div>
                    <div className="flex items-center justify-center gap-4 border border-term-border bg-term-panel-2 p-2" style={{ height: 180 }}>
                      <Donut
                        segments={demandFillSegments}
                        size={110}
                        thickness={16}
                        center={pctFromDecimal(beforeAfterAnalytics.fillRatio)}
                        centerSub="filled"
                      />
                      <div className="flex flex-col gap-1.5 text-2xs">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0" style={{ background: "#2ECC71" }} />
                          <span className="text-term-text-dim">Filled</span>
                          <span className="tnum ml-auto text-term-text">{fmtAbbr(beforeAfterAnalytics.filledShares)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0" style={{ background: "#FF3B3B" }} />
                          <span className="text-term-text-dim">Unfilled</span>
                          <span className="tnum ml-auto text-term-text">{fmtAbbr(beforeAfterAnalytics.unfilledShares)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="term-label mb-1">Inventory Concentration</div>
                  <div className="border border-term-border bg-term-panel-2 p-2">
                    <Treemap cells={inventoryTreemapCells} height={220} maxAbs={15} />
                  </div>
                </div>

                <div className="grid gap-2 xl:grid-cols-2">
                  <div>
                    <div className="term-label mb-1">Top Route Movers</div>
                    <DataGrid
                      columns={baseRouteAnalyticsColumns}
                      rows={beforeAfterAnalytics.routeMovers}
                      rowKey={(row) => row.route_id}
                      maxHeight="260px"
                      initialSort={{ key: "delta", dir: "desc" }}
                      zebra
                      onRowClick={(row) => setSelectedRouteId((current) => (current === row.route_id ? null : row.route_id))}
                      selectedKey={selectedRouteId ?? undefined}
                    />
                  </div>
                  <div>
                    <div className="term-label mb-1">Inventory Impact</div>
                    <DataGrid
                      columns={baseInventoryAnalyticsColumns}
                      rows={beforeAfterAnalytics.inventoryMovers}
                      rowKey={(row) => row.inventory_id}
                      maxHeight="260px"
                      initialSort={{ key: "loan_delta", dir: "desc" }}
                      zebra
                    />
                  </div>
                </div>

                <div className="grid gap-2 xl:grid-cols-[1fr_22rem]">
                  <div>
                    <div className="term-label mb-1">Demand Shortfall</div>
                    <DataGrid
                      columns={baseDemandAnalyticsColumns}
                      rows={beforeAfterAnalytics.demandDrivers}
                      rowKey={(row) => row.demand_group_id}
                      maxHeight="220px"
                      initialSort={{ key: "shortfall", dir: "desc" }}
                      zebra
                    />
                  </div>
                  <div>
                    <div className="term-label mb-1">Reason Codes</div>
                    <DataGrid
                      columns={reasonCodeAnalyticsColumns}
                      rows={beforeAfterAnalytics.reasonCodes}
                      rowKey={(row) => row.reason_code}
                      maxHeight="220px"
                      initialSort={{ key: "gross", dir: "desc" }}
                      zebra
                    />
                  </div>
                </div>
              </div>
            </Panel>
          )}

          {dataset && (
            <Panel
              title="Dataset Preview"
              code="PREVIEW"
              toolbar={<TermToggleGroup value={datasetTab} onChange={setDatasetTab} options={DATASET_TABS} size="sm" />}
            >
              {datasetTab === "inventory" && (
                <DataGrid columns={inventoryPreviewColumns} rows={dataset.request.inventory} rowKey={(row) => row.inventory_id} maxHeight="280px" zebra />
              )}
              {datasetTab === "routes" && (
                <DataGrid columns={routePreviewColumns} rows={dataset.request.routes} rowKey={(row) => row.route_id} maxHeight="280px" zebra />
              )}
              {datasetTab === "demand" && (
                <DataGrid columns={demandPreviewColumns} rows={dataset.request.demand} rowKey={(row) => row.demand_group_id} maxHeight="280px" zebra />
              )}
              {datasetTab === "limits" && (
                dataset.request.counterparty_limits.length === 0 ? (
                  <div className="p-2 text-2xs text-term-text-mute">No counterparty limits in this dataset.</div>
                ) : (
                  <DataGrid columns={limitPreviewColumns} rows={dataset.request.counterparty_limits} rowKey={(row) => row.limit_id} maxHeight="280px" zebra />
                )
              )}
              {datasetTab === "policies" && (
                dataset.request.utilization_policies.length === 0 ? (
                  <div className="p-2 text-2xs text-term-text-mute">No utilization policies in this dataset.</div>
                ) : (
                  <DataGrid columns={policyPreviewColumns} rows={dataset.request.utilization_policies} rowKey={(row) => row.policy_id} maxHeight="280px" zebra />
                )
              )}
              {datasetTab === "entities" && (
                dataset.request.entity_relationships.length === 0 ? (
                  <div className="p-2 text-2xs text-term-text-mute">No entity relationships in this dataset.</div>
                ) : (
                  <DataGrid columns={entityPreviewColumns} rows={dataset.request.entity_relationships} rowKey={(row) => row.value.entity_id} maxHeight="280px" zebra />
                )
              )}
              {datasetTab === "raw" && (
                <div className="relative">
                  <button
                    className="term-btn absolute right-2 top-2 z-10"
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(dataset.request, null, 2))}
                  >
                    <Copy size={13} /> Copy
                  </button>
                  <pre className="analytics-scroll max-h-[320px] overflow-auto bg-term-panel-2 p-2 text-3xs text-term-text-dim">
                    {JSON.stringify(dataset.request, null, 2)}
                  </pre>
                </div>
              )}
            </Panel>
          )}

          {issuesToShow.length > 0 && (
            <Panel
              title="Issues"
              code="ISSUES"
              accent
              right={<Tag tone="down">{issuesToShow.length} {issuesToShow.length === 1 ? "issue" : "issues"}</Tag>}
            >
              <DataGrid columns={issueColumns} rows={issuesToShow} rowKey={(row, i) => `${row.code}-${row.location}-${i}`} maxHeight="200px" initialSort={{ key: "severity", dir: "desc" }} zebra />
            </Panel>
          )}

          <Panel
            title={`${viewLabel} Results`}
            code={viewResult?.run_id.slice(0, 12) ?? "NOT RUN"}
            toolbar={<TermToggleGroup value={shownResultTab} onChange={setResultTab} options={visibleResultTabs} size="sm" />}
            right={
              <span className="flex items-center gap-1">
                {whatIfResults.length > 0 && <Tag tone={activeView?.isBase ? "neutral" : "blue"}>{activeView?.isBase ? "BASE CASE" : "SCENARIO"}</Tag>}
                {shownResultTab === "allocations" ? (
                  <Tag tone={viewResult ? "up" : "neutral"}>{fmtAbbr(totals.allocationIncrease - totals.allocationDecrease)} net</Tag>
                ) : shownResultTab === "diagnostics" ? (
                  <Tag tone={viewResult?.verification?.passed ? "up" : viewResult ? "down" : "neutral"}>
                    {viewResult?.verification?.passed ? "VERIFIED" : viewResult ? "FAILED" : "-"}
                  </Tag>
                ) : undefined}
              </span>
            }
          >
            {shownResultTab === "allocations" && (
              <>
                <DataGrid
                  columns={allocationColumns}
                  rows={viewResult?.allocations ?? []}
                  rowKey={(row) => row.route_id}
                  maxHeight="320px"
                  initialSort={{ key: "delta", dir: "desc" }}
                  zebra
                  onRowClick={(row) => setSelectedRouteId((current) => (current === row.route_id ? null : row.route_id))}
                  selectedKey={selectedRouteId ?? undefined}
                />
                {selectedAllocation && (
                  <div className="border-t border-term-border p-2 text-2xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="term-label">Evidence — {selectedAllocation.route_id}</span>
                      <button className="text-term-text-mute hover:text-term-text" onClick={() => setSelectedRouteId(null)}>
                        Clear
                      </button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {selectedAllocation.reason_codes.length === 0 && <span className="text-term-text-mute">No reason codes.</span>}
                      {selectedAllocation.reason_codes.map((code) => (
                        <Tag key={code} tone="blue">{code}</Tag>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
                      {Object.entries(selectedAllocation.explanation_evidence).map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-2">
                          <span className="text-term-text-mute">{key}</span>
                          <span className="tnum text-term-text">{typeof value === "number" ? fmtAbbr(value) : value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {shownResultTab === "balances" && (
              <DataGrid columns={balanceColumns} rows={viewResult?.balances ?? []} rowKey={(row) => row.inventory_id} maxHeight="400px" initialSort={{ key: "utilization", dir: "desc" }} zebra />
            )}

            {shownResultTab === "demand" && (
              <DataGrid columns={demandColumns} rows={viewResult?.demand ?? []} rowKey={(row) => row.demand_group_id} maxHeight="400px" initialSort={{ key: "fill_ratio", dir: "asc" }} zebra />
            )}

            {shownResultTab === "economics" && (
              <div className="grid gap-2 p-2">
                <div className="grid grid-cols-2 divide-x divide-term-border border border-term-border">
                  <Stat label="Total Value" value={fmtUsdAbbr(viewResult?.economics?.total_value_usd ?? 0)} />
                  <Stat
                    label="Total Delta"
                    value={fmtUsdAbbr(viewResult?.economics?.total_delta_usd ?? 0)}
                    tone={(viewResult?.economics?.total_delta_usd ?? 0) >= 0 ? "up" : "down"}
                  />
                </div>
                <DataGrid columns={economicsColumns} rows={viewResult?.economics?.components ?? []} rowKey={(row) => row.component_name} maxHeight="300px" zebra />
              </div>
            )}

            {shownResultTab === "constraints" && (
              <DataGrid columns={constraintColumns} rows={viewResult?.constraints ?? []} rowKey={(row, i) => `${row.row.kind}-${row.row.scope_id}-${i}`} maxHeight="400px" initialSort={{ key: "slack", dir: "asc" }} zebra />
            )}

            {shownResultTab === "sensitivity" && <SensitivityTab result={viewResult ?? null} dataset={viewDataset} runConfig={runConfig} />}

            {shownResultTab === "infeasibility" && <InfeasibilityTab result={viewResult ?? null} dataset={viewDataset} runConfig={runConfig} />}

            {shownResultTab === "diagnostics" && (
              <div className="grid gap-2 p-2 text-2xs">
                <div>
                  <div className="term-label mb-1">Run</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Status" value={viewResult?.status?.toUpperCase() ?? "-"} tone={viewResult?.status === "optimal" ? "up" : viewResult ? "amber" : "neutral"} />
                    <Stat label="Native Status" value={viewResult?.native_status ?? "-"} />
                    <Stat label="Strict" value={viewResult ? (viewResult.strict ? "YES" : "NO") : "-"} />
                    <Stat label="Created" value={viewResult ? new Date(viewResult.created_at).toLocaleTimeString() : "-"} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Solver</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Backend" value={viewResult?.solver ? `${viewResult.solver.backend_name} ${viewResult.solver.backend_version}` : "-"} />
                    <Stat label="Runtime" value={viewResult?.solver ? `${fmtInt((viewResult.solver.runtime_seconds ?? 0) * 1000)}ms` : "-"} />
                    <Stat label="Iterations" value={fmtInt(viewResult?.solver?.iterations ?? 0)} />
                    <Stat label="Termination" value={viewResult?.solver?.termination_reason ?? viewResult?.termination_reason ?? "-"} />
                    <Stat label="Relative Gap" value={viewResult?.solver?.relative_gap != null ? fmtAbbr(viewResult.solver.relative_gap, 4) : "-"} />
                    <Stat label="Best Bound" value={viewResult?.solver?.best_bound != null ? fmtAbbr(viewResult.solver.best_bound) : "-"} />
                    <Stat label="Nodes" value={viewResult?.solver?.nodes != null ? fmtInt(viewResult.solver.nodes) : "-"} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Model</div>
                  <div className="border border-term-border p-2"><ModelStatisticsView result={viewResult ?? null} /></div>
                </div>
                <div>
                  <div className="term-label mb-1">MIP progress</div>
                  <div className="border border-term-border p-2"><MipProgressView result={viewResult ?? null} /></div>
                </div>
                <div>
                  <div className="term-label mb-1">Verification</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Passed" value={viewResult?.verification?.passed ? "YES" : viewResult ? "NO" : "-"} tone={viewResult?.verification?.passed ? "up" : viewResult ? "down" : "neutral"} />
                    <Stat label="Has Primal" value={viewResult?.verification ? (viewResult.verification.has_primal ? "YES" : "NO") : "-"} />
                    <Stat label="Row Violation" value={fmtAbbr(viewResult?.verification?.max_row_violation ?? 0, 4)} />
                    <Stat label="Bound Violation" value={fmtAbbr(viewResult?.verification?.max_variable_bound_violation ?? 0, 4)} />
                    <Stat label="Integrality Violation" value={fmtAbbr(viewResult?.verification?.max_integrality_violation ?? 0, 4)} />
                    <Stat label="Objective Delta" value={fmtAbbr(viewResult?.verification?.objective_reconstruction_delta ?? 0, 4)} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Provenance</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Config Hash" value={viewResult ? viewResult.config_hash.slice(0, 12) : "-"} />
                    <Stat label="Package Version" value={viewResult?.package_version ?? "-"} />
                    <Stat label="Problem Family" value={viewResult?.desk?.problem_family ?? viewResult?.platform?.problem_family ?? "-"} />
                    <Stat label="Correlation ID" value={viewResult?.platform ? viewResult.platform.correlation_id.slice(0, 12) : "-"} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Warnings</div>
                  {!viewResult?.warnings?.length ? (
                    <div className="border border-term-border px-2 py-1 text-term-text-mute">None.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {viewResult.warnings.map((warning, i) => (
                        <Tag key={`${warning}-${i}`} tone="amber">{warning}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {shownResultTab === "raw" && (
              <div className="relative">
                <button
                  className="term-btn absolute right-2 top-2 z-10"
                  disabled={!viewResult}
                  onClick={() => viewResult && navigator.clipboard?.writeText(JSON.stringify(viewResult, null, 2))}
                >
                  <Copy size={13} /> Copy
                </button>
                <pre className="analytics-scroll max-h-[420px] overflow-auto bg-term-panel-2 p-2 text-3xs text-term-text-dim">
                  {viewResult ? JSON.stringify(viewResult, null, 2) : "No run yet."}
                </pre>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title="Replace prepared dataset?"
        body={
          <>
            {result
              ? "There is a completed run that hasn't been exported yet. "
              : "There is a prepared dataset that hasn't been run yet. "}
            {pendingAction?.kind === "upload"
              ? `Uploading "${pendingAction.file.name}" will replace it.`
              : "Generating a new synthetic dataset will replace it."}
          </>
        }
        confirmLabel="Replace"
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
