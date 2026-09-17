import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download, Play, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
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
  type IbalConstraint,
  type IbalHealth,
  type IbalResult,
  type LocatedIssue,
  type RunConfig,
  type SyntheticConfig,
} from "@/lib/inventoryOptimizer";
import { fmtAbbr, fmtInt, fmtPct, fmtUsdAbbr } from "@/lib/format";

type PendingAction = { kind: "synthetic" } | { kind: "upload"; file: File };

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
  }

  async function solveCurrent() {
    if (!dataset) return;
    setBusy(true);
    setMessage(null);
    setActionIssues([]);
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

          <Panel title="Allocations" code="ALLOC" right={<Tag tone={result ? "up" : "neutral"}>{fmtAbbr(totals.allocationIncrease - totals.allocationDecrease)} net</Tag>}>
            <DataGrid columns={allocationColumns} rows={result?.allocations ?? []} rowKey={(row) => row.route_id} maxHeight="360px" initialSort={{ key: "delta", dir: "desc" }} zebra />
          </Panel>

          <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-2">
            <Panel title="Constraints" code="DUAL">
              <DataGrid columns={constraintColumns} rows={result?.constraints ?? []} rowKey={(row, i) => `${row.row.kind}-${row.row.scope_id}-${i}`} maxHeight="260px" initialSort={{ key: "slack", dir: "asc" }} zebra />
            </Panel>
            <Panel title="Verification" code="CHECK">
              <div className="grid grid-cols-2 divide-x divide-y divide-term-border border-term-border">
                <Stat label="Passed" value={result?.verification?.passed ? "YES" : result ? "NO" : "-"} tone={result?.verification?.passed ? "up" : result ? "down" : "neutral"} />
                <Stat label="Termination" value={result?.solver?.termination_reason ?? "-"} />
                <Stat label="Row Violation" value={fmtAbbr(result?.verification?.max_row_violation ?? 0, 3)} />
                <Stat label="Objective Delta" value={fmtAbbr(result?.verification?.objective_reconstruction_delta ?? 0, 3)} />
              </div>
            </Panel>
          </div>
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
