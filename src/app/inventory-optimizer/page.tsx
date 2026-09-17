import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Download, Play, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import {
  DEFAULT_RUN_CONFIG,
  DEFAULT_SYNTHETIC_CONFIG,
  IbalRequestError,
  exportIbalBundle,
  generateSyntheticDataset,
  getIbalHealth,
  runIbal,
  uploadIbalDataset,
  type DatasetEnvelope,
  type IbalAllocation,
  type IbalBalance,
  type IbalConstraint,
  type IbalDemand,
  type IbalHealth,
  type IbalResult,
  type LocatedIssue,
  type RunConfig,
  type SyntheticConfig,
} from "@/lib/inventoryOptimizer";
import { fmtAbbr, fmtInt, fmtPct, fmtUsdAbbr } from "@/lib/format";

type PendingAction = { kind: "synthetic" } | { kind: "upload"; file: File };

type ResultTab = "allocations" | "balances" | "demand" | "economics" | "constraints" | "diagnostics" | "raw";

const RESULT_TABS: { value: ResultTab; label: string }[] = [
  { value: "allocations", label: "Allocations" },
  { value: "balances", label: "Balances" },
  { value: "demand", label: "Demand" },
  { value: "economics", label: "Economics" },
  { value: "constraints", label: "Constraints" },
  { value: "diagnostics", label: "Diagnostics" },
  { value: "raw", label: "Raw" },
];

function pctFromDecimal(value: number) {
  return fmtPct(value * 100, 2);
}

function sourceFor(dataset: DatasetEnvelope | null, health: IbalHealth | null) {
  if (health?.ready) return dataset?.source.mode === "synthetic" ? "SIM" : "LIVE";
  return "ERR";
}

function updateNumber<T extends object>(setter: (next: T) => void, current: T, key: keyof T, value: string) {
  setter({ ...current, [key]: Number(value) });
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
  const [health, setHealth] = useState<IbalHealth | null>(null);
  const [dataset, setDataset] = useState<DatasetEnvelope | null>(null);
  const [result, setResult] = useState<IbalResult | null>(null);
  const [synthetic, setSynthetic] = useState<SyntheticConfig>(DEFAULT_SYNTHETIC_CONFIG);
  const [showAdvancedSynthetic, setShowAdvancedSynthetic] = useState(false);
  const [runConfig, setRunConfig] = useState<RunConfig>(DEFAULT_RUN_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionIssues, setActionIssues] = useState<LocatedIssue[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("allocations");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Located issues surfaced from the most-recent failed action (upload/run/export rejection)
  // take priority since they explain what just went wrong; otherwise fall back to the prepared
  // dataset's own validation issues, if any.
  const issuesToShow = actionIssues.length > 0 ? actionIssues : dataset?.validation.issues ?? [];

  function syntheticField(
    label: string,
    field: keyof SyntheticConfig,
    opts: { min: number; max: number; step: number; integer?: boolean }
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
          onChange={(event) => updateNumber(setSynthetic, synthetic, field, event.target.value)}
        />
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
          onChange={(event) => updateNumber(setSynthetic, synthetic, field, event.target.value)}
        />
      </label>
    );
  }

  useEffect(() => {
    getIbalHealth().then(setHealth).catch((error) => setHealth({ status: "unavailable", ready: false, error: error.message }));
  }, []);

  const selectedAllocation = useMemo(
    () => result?.allocations.find((row) => row.route_id === selectedRouteId) ?? null,
    [result, selectedRouteId]
  );

  const totals = useMemo(() => {
    const allocations = result?.allocations ?? [];
    const balances = result?.balances ?? [];
    return {
      allocationIncrease: allocations.reduce((sum, row) => sum + row.increase_shares, 0),
      allocationDecrease: allocations.reduce((sum, row) => sum + row.decrease_shares, 0),
      avgUtilization: balances.length ? balances.reduce((sum, row) => sum + row.utilization, 0) / balances.length : 0,
      bindingConstraints: (result?.constraints ?? []).filter((row) => Math.abs(row.slack ?? 0) < 1e-8).length,
    };
  }, [result]);

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

  async function doRefreshSynthetic() {
    setBusy(true);
    setMessage(null);
    setActionIssues([]);
    try {
      const next = await generateSyntheticDataset(synthetic);
      setDataset(next);
      setResult(null);
      setMessage(`Prepared ${next.source.mode} dataset ${next.request_hash.slice(0, 12)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Synthetic dataset failed.");
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      setBusy(false);
    }
  }

  async function doUploadFile(file: File) {
    setBusy(true);
    setMessage(null);
    setActionIssues([]);
    try {
      const next = await uploadIbalDataset(file);
      setDataset(next);
      setResult(null);
      setMessage(`Uploaded ${next.source.filename ?? file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      setBusy(false);
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
    setDataset(null);
    setResult(null);
    setMessage(null);
    setActionIssues([]);
    setSelectedRouteId(null);
    setResultTab("allocations");
  }

  async function solveCurrent() {
    if (!dataset) return;
    setBusy(true);
    setMessage(null);
    setActionIssues([]);
    setSelectedRouteId(null);
    try {
      const response = await runIbal(dataset, runConfig);
      setResult(response.result);
      setMessage(`Run ${response.result.run_id} returned ${response.result.status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run failed.");
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      setBusy(false);
    }
  }

  async function exportBundle() {
    if (!dataset || !result) return;
    setBusy(true);
    setMessage(null);
    setActionIssues([]);
    try {
      const blob = await exportIbalBundle(dataset, result);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ibal-result-bundle.zip";
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Export bundle created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
      if (error instanceof IbalRequestError) setActionIssues(error.issues);
    } finally {
      setBusy(false);
    }
  }

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
            <ProvenanceBadge source={sourceFor(dataset, health)} />
            <Tag tone={health?.ready ? "up" : "down"}>{health?.ready ? "READY" : "SERVICE"}</Tag>
          </span>
        }
      />

      <KpiStrip>
        <Stat label="Securities" value={fmtInt(dataset?.summary.security_count ?? 0)} sub={`${fmtInt(dataset?.summary.borrower_count ?? 0)} borrowers`} />
        <Stat label="Available" value={fmtAbbr(dataset?.summary.total_available_shares ?? 0)} sub="shares" />
        <Stat label="Demand" value={fmtAbbr(dataset?.summary.total_demand_shares ?? 0)} sub="shares" />
        <Stat label="Run Status" value={result?.status?.toUpperCase() ?? "-"} tone={result?.status === "optimal" ? "up" : "neutral"} sub={result?.solver ? `${fmtInt((result.solver.runtime_seconds ?? 0) * 1000)}ms` : "not run"} />
        <Stat label="Delta Value" value={fmtUsdAbbr(result?.economics?.total_delta_usd ?? 0)} tone={(result?.economics?.total_delta_usd ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="Avg Utilization" value={pctFromDecimal(totals.avgUtilization)} sub={`${fmtInt(totals.bindingConstraints)} binding rows`} />
      </KpiStrip>

      {message && (
        <div className="border-b border-term-border bg-term-panel-2 px-3 py-1 text-2xs text-term-text-dim">
          {message}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-[24rem_1fr]">
        <div className="flex min-h-0 flex-col gap-2">
          <Panel title="Dataset Intake" code="DATA" accent resizable={false}>
            <div className="grid gap-2 p-2 text-2xs">
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
                  {syntheticCountField("Parent groups", "parent_group_count", { min: 1, max: synthetic.borrower_count })}
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
                  {syntheticField("Discrete route fraction", "discrete_route_fraction", { min: 0, max: 0.5, step: 0.01 })}
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
                  <input className="hidden" type="file" accept=".json,.xlsx" onChange={(event) => uploadFile(event.target.files?.[0] ?? null)} />
                </label>
              </div>
              <button className="term-btn justify-center" disabled={!dataset || busy} onClick={resetAll}>
                <RotateCcw size={13} /> Reset
              </button>
            </div>
          </Panel>

          <Panel title="Run Config" code="SOLVE" resizable={false}>
            <div className="grid gap-2 p-2 text-2xs">
              <label className="grid gap-1 text-term-text-dim">
                Time limit seconds
                <input className="border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" type="number" min={1} max={60} value={runConfig.solver_time_limit_seconds} onChange={(event) => updateNumber(setRunConfig, runConfig, "solver_time_limit_seconds", event.target.value)} />
              </label>
              <label className="grid gap-1 text-term-text-dim">
                Minimum entity confidence
                <input type="range" min={0} max={1} step={0.01} value={runConfig.minimum_entity_confidence} onChange={(event) => updateNumber(setRunConfig, runConfig, "minimum_entity_confidence", event.target.value)} />
              </label>
              <button className="term-btn justify-center border-term-amber text-term-amber" disabled={!dataset || !dataset.validation.valid || busy} onClick={solveCurrent}>
                <Play size={13} /> Run
              </button>
              <button className="term-btn justify-center" disabled={!dataset || !result || busy} onClick={exportBundle}>
                <Download size={13} /> Export
              </button>
            </div>
          </Panel>
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
            title="Results"
            code={result?.run_id.slice(0, 12) ?? "NOT RUN"}
            toolbar={<TermToggleGroup value={resultTab} onChange={setResultTab} options={RESULT_TABS} size="sm" />}
            right={
              resultTab === "allocations" ? (
                <Tag tone={result ? "up" : "neutral"}>{fmtAbbr(totals.allocationIncrease - totals.allocationDecrease)} net</Tag>
              ) : resultTab === "diagnostics" ? (
                <Tag tone={result?.verification?.passed ? "up" : result ? "down" : "neutral"}>
                  {result?.verification?.passed ? "VERIFIED" : result ? "FAILED" : "-"}
                </Tag>
              ) : undefined
            }
          >
            {resultTab === "allocations" && (
              <>
                <DataGrid
                  columns={allocationColumns}
                  rows={result?.allocations ?? []}
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

            {resultTab === "balances" && (
              <DataGrid columns={balanceColumns} rows={result?.balances ?? []} rowKey={(row) => row.inventory_id} maxHeight="400px" initialSort={{ key: "utilization", dir: "desc" }} zebra />
            )}

            {resultTab === "demand" && (
              <DataGrid columns={demandColumns} rows={result?.demand ?? []} rowKey={(row) => row.demand_group_id} maxHeight="400px" initialSort={{ key: "fill_ratio", dir: "asc" }} zebra />
            )}

            {resultTab === "economics" && (
              <div className="grid gap-2 p-2">
                <div className="grid grid-cols-2 divide-x divide-term-border border border-term-border">
                  <Stat label="Total Value" value={fmtUsdAbbr(result?.economics?.total_value_usd ?? 0)} />
                  <Stat
                    label="Total Delta"
                    value={fmtUsdAbbr(result?.economics?.total_delta_usd ?? 0)}
                    tone={(result?.economics?.total_delta_usd ?? 0) >= 0 ? "up" : "down"}
                  />
                </div>
                <DataGrid columns={economicsColumns} rows={result?.economics?.components ?? []} rowKey={(row) => row.component_name} maxHeight="300px" zebra />
              </div>
            )}

            {resultTab === "constraints" && (
              <DataGrid columns={constraintColumns} rows={result?.constraints ?? []} rowKey={(row, i) => `${row.row.kind}-${row.row.scope_id}-${i}`} maxHeight="400px" initialSort={{ key: "slack", dir: "asc" }} zebra />
            )}

            {resultTab === "diagnostics" && (
              <div className="grid gap-2 p-2 text-2xs">
                <div>
                  <div className="term-label mb-1">Run</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Status" value={result?.status?.toUpperCase() ?? "-"} tone={result?.status === "optimal" ? "up" : result ? "amber" : "neutral"} />
                    <Stat label="Native Status" value={result?.native_status ?? "-"} />
                    <Stat label="Strict" value={result ? (result.strict ? "YES" : "NO") : "-"} />
                    <Stat label="Created" value={result ? new Date(result.created_at).toLocaleTimeString() : "-"} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Solver</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Backend" value={result?.solver ? `${result.solver.backend_name} ${result.solver.backend_version}` : "-"} />
                    <Stat label="Runtime" value={result?.solver ? `${fmtInt((result.solver.runtime_seconds ?? 0) * 1000)}ms` : "-"} />
                    <Stat label="Iterations" value={fmtInt(result?.solver?.iterations ?? 0)} />
                    <Stat label="Termination" value={result?.solver?.termination_reason ?? result?.termination_reason ?? "-"} />
                    <Stat label="Relative Gap" value={result?.solver?.relative_gap != null ? fmtAbbr(result.solver.relative_gap, 4) : "-"} />
                    <Stat label="Best Bound" value={result?.solver?.best_bound != null ? fmtAbbr(result.solver.best_bound) : "-"} />
                    <Stat label="Nodes" value={result?.solver?.nodes != null ? fmtInt(result.solver.nodes) : "-"} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Verification</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Passed" value={result?.verification?.passed ? "YES" : result ? "NO" : "-"} tone={result?.verification?.passed ? "up" : result ? "down" : "neutral"} />
                    <Stat label="Has Primal" value={result?.verification ? (result.verification.has_primal ? "YES" : "NO") : "-"} />
                    <Stat label="Row Violation" value={fmtAbbr(result?.verification?.max_row_violation ?? 0, 4)} />
                    <Stat label="Bound Violation" value={fmtAbbr(result?.verification?.max_variable_bound_violation ?? 0, 4)} />
                    <Stat label="Integrality Violation" value={fmtAbbr(result?.verification?.max_integrality_violation ?? 0, 4)} />
                    <Stat label="Objective Delta" value={fmtAbbr(result?.verification?.objective_reconstruction_delta ?? 0, 4)} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Provenance</div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-term-border border border-term-border md:grid-cols-4">
                    <Stat label="Config Hash" value={result ? result.config_hash.slice(0, 12) : "-"} />
                    <Stat label="Package Version" value={result?.package_version ?? "-"} />
                    <Stat label="Problem Family" value={result?.desk?.problem_family ?? result?.platform?.problem_family ?? "-"} />
                    <Stat label="Correlation ID" value={result?.platform ? result.platform.correlation_id.slice(0, 12) : "-"} />
                  </div>
                </div>
                <div>
                  <div className="term-label mb-1">Warnings</div>
                  {!result?.warnings?.length ? (
                    <div className="border border-term-border px-2 py-1 text-term-text-mute">None.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {result.warnings.map((warning, i) => (
                        <Tag key={`${warning}-${i}`} tone="amber">{warning}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {resultTab === "raw" && (
              <div className="relative">
                <button
                  className="term-btn absolute right-2 top-2 z-10"
                  disabled={!result}
                  onClick={() => result && navigator.clipboard?.writeText(JSON.stringify(result, null, 2))}
                >
                  <Copy size={13} /> Copy
                </button>
                <pre className="analytics-scroll max-h-[420px] overflow-auto bg-term-panel-2 p-2 text-3xs text-term-text-dim">
                  {result ? JSON.stringify(result, null, 2) : "No run yet."}
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
