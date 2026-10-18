"use client";

import { useEffect, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import Link from "@/components/Link";
import { NAV } from "@/lib/nav";
import { fmtUsdAbbr } from "@/lib/format";
import { downloadCollateralRun, isCollateralRun, type CollateralRun } from "@/lib/collateralOptimizer";

type Connection = { family: "MMKT" | "COLL"; label: string; binding_status: string;
  service_health: string; detail: string; model_status: string | null };
type Connections = { approval: string; connections: Connection[] };

/** Every other optimization model in the sidebar group; derived from NAV so it follows module gating. */
const MODELS = NAV.filter(item => item.group === "OPTIMIZATION" && item.code !== "OPT");

export default function OptimizationCenter() {
  const [connections, setConnections] = useState<Connections | null>(null);
  const [preview, setPreview] = useState<CollateralRun | null>(null);
  const [message, setMessage] = useState("Checking services…");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const response = await fetch("/api/optimization/connections", { cache: "no-store" });
      const body = await response.json() as Connections;
      if (!response.ok || !Array.isArray(body.connections)) throw Error("Connection check failed.");
      setConnections(body);
      setMessage("");
    } catch { setMessage("Connection status is unavailable. Retry."); }
  }
  useEffect(() => { void refresh(); }, []);

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
              <Tag tone="amber">BINDING {item.binding_status}</Tag>
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
    <Panel title="Operational runs and audit" code="RUNS">
      <p className="p-3 text-xs text-term-text-dim">
        No durable collateral run registry is configured. Spec015 must establish identity, immutable storage,
        authorization, and append-only audit before this panel can show operational runs.
      </p>
    </Panel>
  </div>;
}
