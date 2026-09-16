import { useEffect, useMemo, useState } from "react";
import { Download, Play, RefreshCw, Upload } from "lucide-react";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import {
  DEFAULT_RUN_CONFIG,
  DEFAULT_SYNTHETIC_CONFIG,
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
  type RunConfig,
  type SyntheticConfig,
} from "@/lib/inventoryOptimizer";
import { fmtAbbr, fmtInt, fmtPct, fmtUsdAbbr } from "@/lib/format";

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

export default function InventoryOptimizerPage() {
  const [health, setHealth] = useState<IbalHealth | null>(null);
  const [dataset, setDataset] = useState<DatasetEnvelope | null>(null);
  const [result, setResult] = useState<IbalResult | null>(null);
  const [synthetic, setSynthetic] = useState<SyntheticConfig>(DEFAULT_SYNTHETIC_CONFIG);
  const [runConfig, setRunConfig] = useState<RunConfig>(DEFAULT_RUN_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const constraintColumns: Column<IbalConstraint>[] = [
    { key: "kind", header: "Kind", render: (row) => <span className="text-term-text">{row.row.kind}</span>, sortVal: (row) => row.row.kind },
    { key: "scope", header: "Scope", render: (row) => <span className="text-term-text-dim">{row.row.scope_id}</span>, sortVal: (row) => row.row.scope_id },
    { key: "activity", header: "Activity", align: "right", render: (row) => fmtAbbr(row.activity), sortVal: (row) => row.activity },
    { key: "slack", header: "Slack", align: "right", render: (row) => <span className={Math.abs(row.slack ?? 0) < 1e-8 ? "text-term-amber" : "text-term-text-dim"}>{fmtAbbr(row.slack ?? 0)}</span>, sortVal: (row) => row.slack ?? 0 },
    { key: "dual", header: "Dual", align: "right", render: (row) => fmtAbbr(row.dual_value ?? 0), sortVal: (row) => row.dual_value ?? 0 },
  ];

  async function refreshSynthetic() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await generateSyntheticDataset(synthetic);
      setDataset(next);
      setResult(null);
      setMessage(`Prepared ${next.source.mode} dataset ${next.request_hash.slice(0, 12)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Synthetic dataset failed.");
    } finally {
      setBusy(false);
    }
  }

  async function solveCurrent() {
    if (!dataset) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await runIbal(dataset, runConfig);
      setResult(response.result);
      setMessage(`Run ${response.result.run_id} returned ${response.result.status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run failed.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await uploadIbalDataset(file);
      setDataset(next);
      setResult(null);
      setMessage(`Uploaded ${next.source.filename ?? file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBundle() {
    if (!dataset || !result) return;
    setBusy(true);
    setMessage(null);
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
              <label className="grid gap-1 text-term-text-dim">
                Borrower concentration
                <input type="range" min={0} max={1} step={0.01} value={synthetic.borrower_concentration} onChange={(event) => updateNumber(setSynthetic, synthetic, "borrower_concentration", event.target.value)} />
              </label>
              <label className="grid gap-1 text-term-text-dim">
                Utilization cap
                <input type="range" min={0.25} max={1} step={0.01} value={synthetic.utilization_cap} onChange={(event) => updateNumber(setSynthetic, synthetic, "utilization_cap", event.target.value)} />
              </label>
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
              <button className="term-btn justify-center border-term-amber text-term-amber" disabled={!dataset || busy} onClick={solveCurrent}>
                <Play size={13} /> Run
              </button>
              <button className="term-btn justify-center" disabled={!dataset || !result || busy} onClick={exportBundle}>
                <Download size={13} /> Export
              </button>
            </div>
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <Panel title="Dataset Summary" code={dataset?.request_hash.slice(0, 10) ?? "EMPTY"} right={<Tag tone={dataset?.validation.valid ? "up" : "neutral"}>{dataset?.validation.valid ? "VALID" : "NO DATA"}</Tag>}>
            <div className="grid grid-cols-2 divide-x divide-term-border md:grid-cols-4">
              <Stat label="Inventory Rows" value={fmtInt(dataset?.summary.row_counts.inventory ?? 0)} />
              <Stat label="Route Rows" value={fmtInt(dataset?.summary.row_counts.routes ?? 0)} />
              <Stat label="Entity Links" value={fmtInt(dataset?.summary.row_counts.entity_relationships ?? 0)} />
              <Stat label="Source" value={dataset?.source.mode.toUpperCase() ?? "-"} sub={dataset?.source.filename ?? (dataset?.source.seed != null ? `seed ${dataset.source.seed}` : undefined)} />
            </div>
          </Panel>

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
    </div>
  );
}
