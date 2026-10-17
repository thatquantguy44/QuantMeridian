"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { BarChart } from "@/components/charts/BarChart";
import { ProgressBar } from "@/components/charts/Radial";
import {
  getOptimizationRuns,
  getDualValues,
  getRecommendedTrades,
  getBeforeAfter,
  type OptimizationRun,
  type DualValue,
  type RecommendedTrade,
  type OptType,
  type SolverStatus,
} from "@/data/optimization";
import { fmtAbbr, fmtUsdAbbr, fmtBps, fmtPct, fmtInt } from "@/lib/format";

type ConnectionStatus = "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";

interface OptimizationConnection {
  family: "MMKT" | "COLL";
  label: string;
  binding_status: ConnectionStatus;
  service_health: ConnectionStatus;
  detail: string;
  model_status: string | null;
  api_schema_version: string | null;
}

interface ConnectionsResponse {
  approval: string;
  connections: OptimizationConnection[];
}

function connectionTone(status: ConnectionStatus): "up" | "down" | "amber" | "blue" {
  if (status === "READY") return "up";
  if (status === "UNAVAILABLE") return "down";
  if (status === "INCOMPATIBLE") return "blue";
  return "amber";
}

const TYPE_TABS: { key: OptType | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "COLLATERAL", label: "Collateral" },
  { key: "CASH", label: "Cash" },
  { key: "SEC_LENDING", label: "Sec Lending" },
  { key: "DELTA_NEUTRAL", label: "Delta-Neutral" },
];

function statusTone(s: SolverStatus): "up" | "down" | "amber" | "neutral" | "blue" {
  if (s === "OPTIMAL") return "up";
  if (s === "RUNNING") return "amber";
  if (s === "INFEASIBLE") return "down";
  if (s === "FEASIBLE") return "blue";
  return "neutral"; // TIME_LIMIT
}

export default function OptimizationCenter() {
  const allRuns = getOptimizationRuns();
  const duals = getDualValues();
  const trades = getRecommendedTrades();
  const beforeAfter = getBeforeAfter();

  const [tab, setTab] = useState<OptType | "ALL">("ALL");

  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  const refreshConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const response = await fetch("/api/optimization/connections", { cache: "no-store" });
      const body = (await response.json()) as ConnectionsResponse;
      if (!response.ok || !Array.isArray(body.connections)) {
        throw new Error("Connection status unavailable.");
      }
      setConnections(body);
    } catch {
      setConnectionsError("Connection status could not be loaded. Retry to check service health.");
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConnections();
  }, [refreshConnections]);

  const firstOptimal = allRuns.find((r) => r.status === "OPTIMAL") ?? allRuns[0];
  const [selectedId, setSelectedId] = useState<string>(firstOptimal.id);

  const runs = tab === "ALL" ? allRuns : allRuns.filter((r) => r.type === tab);
  const selected = allRuns.find((r) => r.id === selectedId) ?? firstOptimal;

  // KPIs
  const activeRuns = allRuns.filter((r) => r.status === "RUNNING").length;
  const totalSavings = allRuns.reduce((a, r) => a + r.savings, 0);
  const avgRuntime = allRuns.reduce((a, r) => a + r.runtimeMs, 0) / allRuns.length;
  const optimalRate = (allRuns.filter((r) => r.status === "OPTIMAL").length / allRuns.length) * 100;
  const latest = allRuns[0];

  const bindingDuals = duals.filter((d) => d.binding).sort((a, b) => b.shadowPrice - a.shadowPrice);
  const totalImpact = trades.reduce((a, t) => a + t.impact, 0);

  const runCols: Column<OptimizationRun>[] = [
    { key: "id", header: "Run ID", render: (r) => <span className="font-semibold text-term-text">{r.id}</span>, sortVal: (r) => r.id },
    { key: "type", header: "Type", render: (r) => <Tag tone="blue">{r.type.replace("_", " ")}</Tag>, sortVal: (r) => r.type },
    { key: "solver", header: "Solver", render: (r) => <Tag tone="violet">{r.solver}</Tag>, sortVal: (r) => r.solver },
    { key: "status", header: "Status", render: (r) => <Tag tone={statusTone(r.status)}>{r.status}</Tag>, sortVal: (r) => r.status },
    { key: "objective", header: "Objective", align: "right", render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.objective)}</span>, sortVal: (r) => r.objective },
    { key: "savings", header: "Savings", align: "right", render: (r) => <span className="text-term-up">{fmtUsdAbbr(r.savings)}</span>, sortVal: (r) => r.savings },
    { key: "runtimeMs", header: "Runtime", align: "right", render: (r) => <span className="text-term-text-dim">{fmtInt(r.runtimeMs)}ms</span>, sortVal: (r) => r.runtimeMs },
    { key: "iterations", header: "Iters", align: "right", render: (r) => <span className="text-term-text-dim">{fmtInt(r.iterations)}</span>, sortVal: (r) => r.iterations },
    { key: "variables", header: "Vars", align: "right", render: (r) => <span className="text-term-text-dim">{fmtInt(r.variables)}</span>, sortVal: (r) => r.variables },
    { key: "constraints", header: "Constr", align: "right", render: (r) => <span className="text-term-text-dim">{fmtInt(r.constraints)}</span>, sortVal: (r) => r.constraints },
    { key: "gap", header: "Gap", align: "right", render: (r) => <span className={r.gap > 0 ? "text-term-amber" : "text-term-text-mute"}>{fmtPct(r.gap)}</span>, sortVal: (r) => r.gap },
  ];

  const dualCols: Column<DualValue>[] = [
    { key: "constraint", header: "Constraint", render: (d) => <span className="text-term-text">{d.constraint}</span>, sortVal: (d) => d.constraint },
    { key: "shadowPrice", header: "Shadow Price", align: "right", render: (d) => <span className={d.binding ? "text-term-amber" : "text-term-text-mute"}>{d.shadowPrice > 0 ? fmtUsdAbbr(d.shadowPrice) : "—"}</span>, sortVal: (d) => d.shadowPrice },
    { key: "slack", header: "Slack", align: "right", render: (d) => <span className="text-term-text-dim">{d.binding ? "0.0" : fmtAbbr(d.slack)}</span>, sortVal: (d) => d.slack },
    { key: "binding", header: "Status", align: "right", render: (d) => <Tag tone={d.binding ? "down" : "neutral"}>{d.binding ? "BINDING" : "SLACK"}</Tag>, sortVal: (d) => (d.binding ? 1 : 0) },
  ];

  const tradeCols: Column<RecommendedTrade>[] = [
    {
      key: "action",
      header: "Action",
      render: (t) => (
        <Tag tone={t.action === "UNWIND" || t.action === "RECALL" ? "down" : t.action === "PLEDGE" ? "blue" : "amber"}>{t.action}</Tag>
      ),
      sortVal: (t) => t.action,
    },
    { key: "from", header: "From", render: (t) => <span className="text-term-text-dim">{t.from}</span>, sortVal: (t) => t.from },
    { key: "to", header: "To", render: (t) => <span className="text-term-text-dim">{t.to}</span>, sortVal: (t) => t.to },
    { key: "asset", header: "Asset", render: (t) => <span className="text-term-text">{t.asset}</span>, sortVal: (t) => t.asset },
    { key: "notional", header: "Notional", align: "right", render: (t) => <span className="text-term-text">{fmtUsdAbbr(t.notional)}</span>, sortVal: (t) => t.notional },
    { key: "impact", header: "Impact", align: "right", render: (t) => <span className="text-term-up">{fmtUsdAbbr(t.impact)}</span>, sortVal: (t) => t.impact },
  ];

  const baFmt = (n: number, fmt: "usd" | "bps" | "pct") =>
    fmt === "usd" ? fmtUsdAbbr(n) : fmt === "bps" ? fmtBps(n) : fmtPct(n);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="OPT"
        title="Optimization Center"
        desc="Solver Runs · Duals · Impact Analysis"
        right={<span className="flex items-center gap-1"><ProvenanceBadge source="SIM" /><Tag tone="amber">{activeRuns} RUNNING</Tag></span>}
      />

      <div className="mx-2 mt-2 border border-term-amber/40 bg-term-amber/5 px-3 py-2 text-xs text-term-text-dim">
        <span className="mr-2 font-bold text-term-amber">SIMULATION DATA</span>
        The legacy run, savings, dual, and trade panels below are illustrative demo data. They are not live optimizer results or recommendations.
      </div>

      <Panel
        title="Model Connections"
        code="BINDINGS"
        right={
          <button
            type="button"
            onClick={() => void refreshConnections()}
            disabled={connectionsLoading}
            className="border border-term-border px-2 py-1 text-3xs font-semibold uppercase text-term-text-dim hover:bg-term-panel-2 disabled:opacity-50"
          >
            {connectionsLoading ? "Checking…" : "Refresh status"}
          </button>
        }
      >
        <div className="p-2">
          <p className="mb-2 text-xs text-term-text-dim">
            {connections?.approval ?? "Checking approved model bindings…"}
          </p>
          {connectionsError && (
            <div role="alert" className="mb-2 border border-term-down/40 bg-term-down/5 px-2 py-1.5 text-xs text-term-down">
              ${connectionsError}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {(connections?.connections ?? []).map((connection) => (
              <div key={connection.family} className="border border-term-border bg-term-panel px-3 py-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-term-text">{connection.family} · {connection.label}</span>
                  <div className="flex gap-1">
                    <Tag tone={connectionTone(connection.binding_status)}>BINDING {connection.binding_status}</Tag>
                    <Tag tone={connectionTone(connection.service_health)}>SERVICE {connection.service_health}</Tag>
                  </div>
                </div>
                <p className="text-xs text-term-text-dim">{connection.detail}</p>
                {connection.model_status && (
                  <p className="mt-1 text-3xs text-term-text-mute">Service model status: {connection.model_status}</p>
                )}
              </div>
            ))}
            {connectionsLoading && !connections && (
              <div className="border border-term-border bg-term-panel px-3 py-3 text-xs text-term-text-mute">Checking MMKT and collateral service health…</div>
            )}
          </div>
        </div>
      </Panel>

      <KpiStrip>
        <Stat label="Active Runs" value={fmtInt(activeRuns)} sub={`${allRuns.length} total today`} />
        <Stat label="Total Savings (Day)" value={fmtUsdAbbr(totalSavings)} sub="across all solvers" tone="amber" />
        <Stat label="Avg Runtime" value={`${fmtInt(avgRuntime)}ms`} sub="per solve" />
        <Stat label="Optimal Rate" value={fmtPct(optimalRate, 0)} sub="runs at optimality" tone="up" />
        <Stat label="Variables" value={fmtAbbr(latest.variables)} sub={`run ${latest.id}`} />
        <Stat label="Constraints Hit" value={fmtInt(latest.constraintsHit)} sub={`of ${fmtAbbr(latest.constraints)}`} />
      </KpiStrip>

      <div className="flex flex-1 flex-col gap-2 p-2">
        {/* Control bar */}
        <Panel title="Portfolio Optimization" code="SOLVE" accent>
          <div className="flex flex-wrap items-center justify-between gap-2 p-2">
            <div className="flex flex-wrap gap-px bg-term-border">
              {TYPE_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide transition-colors ${
                    tab === t.key ? "bg-term-amber/15 text-term-amber" : "bg-term-panel text-term-text-dim hover:bg-term-panel-2"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button className="rounded-sm border border-term-amber bg-term-amber/15 px-4 py-1.5 text-2xs font-bold uppercase tracking-wider text-term-amber hover:bg-term-amber/25">
              ▶ Run Optimization
            </button>
          </div>
        </Panel>

        {/* Solver runs grid */}
        <Panel title="Solver Runs" code="RUNS" right={<span className="text-3xs text-term-text-mute">{runs.length} shown · click to inspect</span>}>
          <DataGrid
            columns={runCols}
            rows={runs}
            rowKey={(r) => r.id}
            maxHeight="320px"
            onRowClick={(r) => setSelectedId(r.id)}
            selectedKey={selectedId}
            initialSort={{ key: "savings", dir: "desc" }}
            zebra
          />
        </Panel>

        {/* Selected run detail */}
        <Panel title={`Run Detail — ${selected.id}`} code="DETAIL" right={<Tag tone={statusTone(selected.status)}>{selected.status}</Tag>}>
          <div className="grid grid-cols-2 divide-x divide-term-border md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Objective Value" value={fmtUsdAbbr(selected.objective)} sub={`${selected.type.replace("_", " ")}`} tone="amber" />
            <Stat label="Savings" value={fmtUsdAbbr(selected.savings)} sub="vs baseline" tone="up" />
            <Stat label="Runtime" value={`${fmtInt(selected.runtimeMs)}ms`} sub={`${fmtInt(selected.iterations)} iters`} />
            <Stat label="Solver" value={selected.solver} sub={`${fmtAbbr(selected.variables)} vars`} />
            <Stat label="Constraints Hit" value={fmtInt(selected.constraintsHit)} sub={`of ${fmtAbbr(selected.constraints)}`} tone={selected.constraintsHit > 8 ? "down" : "neutral"} />
            <Stat label="MIP Gap" value={fmtPct(selected.gap)} sub={selected.gap > 0 ? "sub-optimal" : "proven optimal"} tone={selected.gap > 0 ? "amber" : "up"} />
          </div>
        </Panel>

        {/* Duals + Before/After + Trades grid layout */}
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Panel title="Dual Values / Shadow Prices" code="DUAL" right={<Tag tone="down">{bindingDuals.length} binding</Tag>}>
            <DataGrid columns={dualCols} rows={duals} rowKey={(d) => d.constraint} maxHeight="240px" initialSort={{ key: "shadowPrice", dir: "desc" }} zebra />
            <div className="border-t border-term-border p-2">
              <div className="term-label mb-1.5">Binding Shadow Prices ($ / unit)</div>
              <BarChart
                horizontal
                data={bindingDuals.map((d) => ({ label: d.constraint, value: d.shadowPrice, color: "#FF8C00" }))}
                fmt={(n) => fmtUsdAbbr(n)}
              />
            </div>
          </Panel>

          <Panel title="Before / After Portfolio" code="IMPACT" accent>
            <div className="divide-y divide-term-border-soft">
              {beforeAfter.map((b) => {
                const improved = b.better === "lower" ? b.after < b.before : b.after > b.before;
                return (
                  <div key={b.metric} className="grid grid-cols-[1.4fr_1fr_auto_1fr] items-center gap-2 px-2 py-1.5 text-xs">
                    <span className="text-term-text-dim">{b.metric}</span>
                    <span className="tnum text-right text-term-text-mute">{baFmt(b.before, b.fmt)}</span>
                    <span className={`tnum text-center text-sm ${improved ? "text-term-up" : "text-term-down"}`}>{improved ? "▸" : "▸"}</span>
                    <span className={`tnum text-right font-semibold ${improved ? "text-term-up" : "text-term-down"}`}>{baFmt(b.after, b.fmt)}</span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-term-border p-2">
              <div className="term-label mb-1.5">Before vs After</div>
              <BarChart
                horizontal
                data={beforeAfter.flatMap((b) => [
                  { label: `${b.metric} (B)`, value: Math.abs(b.before), color: "#5E5E66" },
                  { label: `${b.metric} (A)`, value: Math.abs(b.after), color: "#FF8C00" },
                ])}
                fmt={(n) => fmtAbbr(n)}
              />
            </div>
          </Panel>
        </div>

        {/* Recommended trades */}
        <Panel
          title="Recommended Trades"
          code="REBAL"
          right={<Stat label="Total Impact" value={fmtUsdAbbr(totalImpact)} tone="up" className="!py-0" />}
        >
          <DataGrid columns={tradeCols} rows={trades} rowKey={(t, i) => `${t.action}-${t.asset}-${i}`} maxHeight="320px" initialSort={{ key: "impact", dir: "desc" }} zebra />
          <div className="border-t border-term-border px-2 py-1.5">
            <ProgressBar value={totalImpact} max={totalImpact} color="#2ECC71" height={5} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
