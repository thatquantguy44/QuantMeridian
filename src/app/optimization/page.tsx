"use client";

import { useEffect, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import Link from "@/components/Link";
import { NAV } from "@/lib/nav";
import { guideHref, hasGuide } from "@/lib/moduleGuides";
import { fmtUsdAbbr } from "@/lib/format";
import { downloadCollateralRun, isCollateralRun, type CollateralRun } from "@/lib/collateralOptimizer";

type Connection = { family: "MMKT" | "COLL" | "IBAL"; label: string; binding_status: string;
  service_health: string; detail: string; model_status: string | null };
type Connections = { approval: string; connections: Connection[] };
type RunLogEntry = { model: "IBAL" | "MMKT" | "COLL"; kind: "run" | "stress" | "showcase"; recorded_at: string;
  http_status: number; run_id: string | null; status: string; verified: boolean | null; solve_ms: number | null;
  round_trip_ms: number; source: string | null; input_hash: string | null; model_version: string | null };
type RunLog = { started_at: string; capacity: number; runs: RunLogEntry[] };

const millis = (value: number | null) => value == null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} ms`;

/** Every other optimization model in the sidebar group; derived from NAV so it follows module gating. */
const MODELS = NAV.filter(item => item.group === "OPTIMIZATION" && item.code !== "OPT");

export default function OptimizationCenter() {
  const [connections, setConnections] = useState<Connections | null>(null);
  const [preview, setPreview] = useState<CollateralRun | null>(null);
  const [message, setMessage] = useState("Checking services…");
  const [busy, setBusy] = useState(false);
  const [runLog, setRunLog] = useState<RunLog | null>(null);
  const [runLogError, setRunLogError] = useState("");

  async function refresh() {
    try {
      const response = await fetch("/api/optimization/connections", { cache: "no-store" });
      const body = await response.json() as Connections;
      if (!response.ok || !Array.isArray(body.connections)) throw Error("Connection check failed.");
      setConnections(body);
      setMessage("");
    } catch { setMessage("Connection status is unavailable. Retry."); }
  }
  async function refreshRunLog() {
    try {
      const response = await fetch("/api/optimization/runs", { cache: "no-store" });
      const body = await response.json() as RunLog;
      if (!response.ok || !Array.isArray(body.runs)) throw Error("Run log unavailable.");
      setRunLog(body);
      setRunLogError("");
    } catch { setRunLogError("The session run log is unavailable. Retry."); }
  }
  useEffect(() => { void refresh(); void refreshRunLog(); }, []);

  async function solveBaseline() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/collateral-optimizer/runs", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_mode: "SIM", scenario_id: "baseline" }) });
      const body = await response.json() as unknown;
      if (!response.ok) {
        const err = body as { code?: string; message?: string };
        throw Error([err.code, err.message].filter(Boolean).join(": ") || "Model unavailable.");
      }
      if (!isCollateralRun(body)) throw Error("Service result failed the terminal contract.");
      setPreview(body);
      void refreshRunLog();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Model unavailable."); setPreview(null); }
    finally { setBusy(false); }
  }

  const collateral = connections?.connections.find(item => item.family === "COLL");
  const verified = preview?.lifecycle_status === "SUCCEEDED_VERIFIED" && preview.adapter_verification.passed;
  const cost = verified ? preview?.result.cost : null;

  return <div className="flex min-h-full flex-col">
    <PageHeader code="OPT" title="Optimization Center" desc="Model connections and verified local previews"
      right={<Tag tone="amber">NO OPERATIONAL RUN REGISTRY</Tag>} />
    <div className="p-2 text-xs text-term-text-dim">
      Model services have separate health. No generated runs, duals, trades, or savings enter operational totals.
      The collateral solve below uses a fictional SIM book and has no persistent audit record.
    </div>
    <div className="px-2">
      <Panel title="Optimization models" code="MODELS">
        <nav aria-label="Optimization models" className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODELS.map(item => {
            const link = connections?.connections.find(c => c.family === item.code);
            return <Link key={item.code} href={item.href}
              className="flex items-start gap-2 border border-term-border p-2 text-xs hover:border-term-amber">
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-term-amber" aria-hidden />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{item.code} · {item.label}</strong>
                  {link && <Tag tone={link.service_health === "READY" ? "up" : "amber"}>SERVICE {link.service_health}</Tag>}
                </span>
                <span className="block text-term-text-dim">{item.desc}</span>
              </span>
            </Link>;
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-term-border px-3 py-2 text-2xs" data-testid="opt-guides">
          <span className="text-term-text-mute">Guides:</span>
          <Link href="/guides" className="text-term-blue underline">All white papers and help</Link>
          {[{ code: "OPT" }, ...MODELS].filter((item) => hasGuide(item.code)).map((item) =>
            <Link key={item.code} href={guideHref(item.code)} className="text-term-blue underline">{item.code}</Link>)}
        </div>
      </Panel>
    </div>
    <div className="grid gap-2 p-2 lg:grid-cols-2">
      <Panel title="Connections" code="CONN">
        <div className="space-y-2 p-3">
          <button type="button" onClick={() => void refresh()} className="border border-term-border px-2 py-1 text-xs">
            Refresh status
          </button>
          {connections?.connections.map(item => <div key={item.family} className="border border-term-border p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{item.family} · {item.label}</strong>
              <Tag tone={item.service_health === "READY" ? "up" : "amber"}>SERVICE {item.service_health}</Tag>
              <Tag tone={item.binding_status === "ENGINE_PINNED" ? "up" : "amber"}>BINDING {item.binding_status}</Tag>
            </div>
            <p className="mt-1 text-term-text-dim">{item.detail}</p>
            {item.model_status && <p className="text-term-text-mute">Model: {item.model_status}</p>}
          </div>)}
          {message && <p role="status" className="text-term-text-dim">{message}</p>}
          <p className="text-xs text-term-text-mute">{connections?.approval}</p>
        </div>
      </Panel>
      <Panel title="Collateral model preview" code="COLL" right={<ProvenanceBadge source="SIM" simSelected />}>
        <div className="space-y-3 p-3 text-xs text-term-text-dim">
          <p>56 synthetic lots and eight calls from one pinned InventoryBallast book. The service performs a fresh verifier pass.</p>
          <button type="button" onClick={() => void solveBaseline()} disabled={busy || collateral?.service_health !== "READY"}
            className="border border-term-amber px-3 py-1 text-term-amber disabled:opacity-40">
            {busy ? "Solving…" : "Solve baseline preview"}
          </button>
          <a href="/collateral" className="ml-3 text-term-amber underline">Open collateral workspace</a>
          {!collateral || collateral.service_health !== "READY" ? <p>Service state: {collateral?.service_health ?? "loading"}.
            No result is generated while the binding is unavailable.</p> : null}
          {preview && <>
            <p>Run {preview.run_id} · {preview.lifecycle_status} · {preview.source_mode} · {preview.snapshot.horizon_days} days · USD</p>
            <KpiStrip>
              <Stat label="Target cost" value={cost ? fmtUsdAbbr(cost.total_usd) : "Unavailable"} />
              <Stat label="Modeled savings" value={cost?.savings_usd == null ? "Unavailable" : fmtUsdAbbr(cost.savings_usd)} />
              <Stat label="Coverage" value={verified ? String(preview.result.coverage.length) + " calls" : "No target"} />
            </KpiStrip>
            <p>Model {preview.package_version} @ {preview.model_commit} · adapter {preview.adapter_version} · input {preview.input_hash}</p>
            <p>Preview only. Verification: {preview.adapter_verification.passed ? "passed" : "no verified target"}.
              No live recommendation, booked movement, or operational savings total.</p>
            <button type="button" disabled={busy} onClick={() => downloadCollateralRun(preview)}
              className="border border-term-amber px-3 py-1 text-term-amber disabled:opacity-40">
              Export preview JSON
            </button>
          </>}
        </div>
      </Panel>
    </div>
    <Panel title="Session run log" code="RUNS" right={<Tag tone="amber">NOT PERSISTED</Tag>}>
      <div className="space-y-2 p-3 text-xs text-term-text-dim">
        <p>
          Model runs this terminal server forwarded to IBAL, MMKT and COLL since it started
          {runLog ? ` (${new Date(runLog.started_at).toLocaleString()})` : ""}, newest first, last {runLog?.capacity ?? 200}.
          Status, verification and solve time are each service&apos;s own; round trip is measured here. Held in server
          memory only and lost on restart. This is not an operational audit record: Spec015 must establish identity,
          immutable storage, authorization and append-only audit first. S&amp;U and liquidity runs appear once those
          services exist.
        </p>
        <button type="button" onClick={() => void refreshRunLog()} className="border border-term-border px-2 py-1 text-xs">
          Refresh runs
        </button>
        {runLogError && <p role="status">{runLogError}</p>}
        {runLog && runLog.runs.length === 0 && <p data-testid="opt-run-log-empty">No model run has gone through this server yet.</p>}
        {runLog && runLog.runs.length > 0 && <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-2xs [&_td]:pr-3 [&_th]:pr-3" data-testid="opt-run-log">
            <thead><tr className="text-term-text-mute">
              <th scope="col">Time</th><th scope="col">Model</th><th scope="col">Kind</th><th scope="col">Run</th>
              <th scope="col">Status</th><th scope="col">Verified</th><th scope="col" className="text-right">Solve</th>
              <th scope="col" className="text-right">Round trip</th><th scope="col">Source</th><th scope="col">Input hash</th>
            </tr></thead>
            <tbody>
              {runLog.runs.map((run, index) => <tr key={`${run.recorded_at}-${index}`} className="border-t border-term-border">
                <td className="py-1 font-mono">{new Date(run.recorded_at).toLocaleTimeString()}</td>
                <td>{run.model}</td>
                <td>{run.kind}</td>
                <td className="max-w-[12rem] truncate font-mono" title={run.run_id ?? undefined}>{run.run_id ?? "—"}</td>
                <td className={run.http_status >= 400 ? "text-term-down" : "text-term-text"}>{run.status}{run.http_status >= 400 ? ` (HTTP ${run.http_status})` : ""}</td>
                <td>{run.verified == null ? "—" : run.verified ? "yes" : "no"}</td>
                <td className="text-right font-mono">{millis(run.solve_ms)}</td>
                <td className="text-right font-mono">{millis(run.round_trip_ms)}</td>
                <td>{run.source ?? "—"}</td>
                <td className="max-w-[9rem] truncate font-mono" title={run.input_hash ?? undefined}>{run.input_hash ?? "—"}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      </div>
    </Panel>
  </div>;
}
