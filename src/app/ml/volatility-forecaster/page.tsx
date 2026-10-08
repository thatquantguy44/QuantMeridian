import { RefreshCw } from "lucide-react";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { KpiStrip, PageHeader } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useVolatilityForecaster } from "@/lib/useVolatilityForecaster";
import type { VolatilityForecastRow } from "@/lib/volatilityForecaster";

function volatility(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;
}

function count(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

function statusTone(value: string): "up" | "down" | "amber" | "neutral" {
  const normalized = value.toLowerCase();
  if (normalized === "complete" || normalized === "scored") return "up";
  if (normalized.includes("fail") || normalized.includes("error")) return "down";
  if (normalized === "pending" || normalized.includes("not_met")) return "amber";
  return "neutral";
}

const FORECAST_COLUMNS: Column<VolatilityForecastRow>[] = [
  { key: "asOf", header: "As Of", width: "110px", render: (row) => row.asOfDate, sortVal: (row) => row.asOfDate },
  { key: "horizon", header: "Horizon End", width: "115px", render: (row) => row.horizonEnd, sortVal: (row) => row.horizonEnd },
  { key: "model", header: "Model", width: "105px", render: (row) => <Tag tone={row.modelKey === "candidate" ? "blue" : "neutral"}>{row.modelKey}</Tag>, sortVal: (row) => row.modelKey },
  { key: "forecast", header: "Forecast Vol", align: "right", width: "120px", render: (row) => volatility(row.forecastVolatility), sortVal: (row) => row.forecastVolatility },
  { key: "threshold", header: "Alert Level", align: "right", width: "110px", render: (row) => volatility(row.alertThreshold), sortVal: (row) => row.alertThreshold },
  { key: "high", header: "High Alert", align: "center", width: "95px", render: (row) => <Tag tone={row.predictedHigh ? "down" : "neutral"}>{row.predictedHigh ? "YES" : "NO"}</Tag>, sortVal: (row) => Number(row.predictedHigh) },
  { key: "outcome", header: "Outcome", width: "100px", render: (row) => <Tag tone={statusTone(row.outcomeStatus)}>{row.outcomeStatus}</Tag>, sortVal: (row) => row.outcomeStatus },
  { key: "actual", header: "Actual Vol", align: "right", width: "105px", render: (row) => volatility(row.actualVolatility), sortVal: (row) => row.actualVolatility ?? -1 },
];

export default function VolatilityForecaster() {
  const { data, loading, refresh } = useVolatilityForecaster();
  const snapshot = data?.ok ? data : null;
  const latestAsOf = snapshot?.forecasts[0]?.asOfDate ?? snapshot?.operations.sourceLastSession ?? null;
  const latestRows = snapshot?.forecasts.filter((row) => row.asOfDate === latestAsOf) ?? [];
  const candidate = latestRows.find((row) => row.modelKey === "candidate");
  const persistence = latestRows.find((row) => row.modelKey === "persistence");
  const error = data && !data.ok ? data : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        code="VOLF"
        title="Volatility Forecaster"
        desc="QR Haven five-session SPY realized-volatility forecast"
        asOf={latestAsOf}
        showStreaming={false}
        right={
          <>
            <ProvenanceBadge source={snapshot ? "QR_HAVEN" : "ERR"} asOf={latestAsOf} />
            <Tag tone="amber">SHADOW ONLY</Tag>
            <button
              aria-label="Refresh volatility forecast"
              className="term-btn inline-flex items-center gap-1"
              disabled={loading}
              onClick={refresh}
              title="Refresh QR Haven status and forecast export"
            >
              <RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
              Refresh
            </button>
          </>
        }
      />

      <KpiStrip>
        <Stat label="Candidate Vol" value={volatility(candidate?.forecastVolatility)} sub="next 5 XNYS sessions" tone={candidate?.predictedHigh ? "down" : "neutral"} />
        <Stat label="Persistence" value={volatility(persistence?.forecastVolatility)} sub="benchmark forecast" />
        <Stat label="Alert Threshold" value={volatility(snapshot?.model.alertThreshold)} sub="fixed research threshold" tone="amber" />
        <Stat label="Horizon End" value={candidate?.horizonEnd ?? "—"} sub="realized-vol window" />
        <Stat label="Data Fresh" value={snapshot?.operations.dataFresh == null ? "—" : snapshot.operations.dataFresh ? "YES" : "NO"} sub={snapshot?.operations.sourceLastSession ?? "service unavailable"} tone={snapshot?.operations.dataFresh ? "up" : "amber"} />
        <Stat label="Pending / Scored" value={`${count(snapshot?.operations.pendingOrigins)} / ${count(snapshot?.operations.scoredOrigins)}`} sub="shadow origins" />
      </KpiStrip>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {error && (
          <Panel title="QR Haven Connection" code="ERR" bodyClassName="p-3" resizable={false} accent>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-term-text">Forecast service unavailable</div>
                <div className="mt-1 text-xs text-term-text-dim">{error.message}</div>
              </div>
              <Tag tone="down">{error.code}</Tag>
            </div>
          </Panel>
        )}

        {snapshot?.warnings.map((warning) => (
          <div key={warning} className="border border-term-amber/40 bg-term-amber/10 px-3 py-2 text-xs text-term-amber">
            {warning}
          </div>
        ))}

        <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-12">
          <Panel title="Current Forecast" code="NOW" className="xl:col-span-7" bodyClassName="p-3">
            {latestRows.length ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {latestRows.map((row) => (
                  <div key={row.forecastKey} className="border border-term-border bg-term-panel-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Tag tone={row.modelKey === "candidate" ? "blue" : "neutral"}>{row.modelKey}</Tag>
                      <Tag tone={row.predictedHigh ? "down" : "up"}>{row.predictedHigh ? "HIGH-VOL ALERT" : "BELOW ALERT"}</Tag>
                    </div>
                    <div className="tnum mt-4 text-3xl font-semibold text-term-text">{volatility(row.forecastVolatility)}</div>
                    <div className="mt-1 text-2xs uppercase tracking-wide text-term-text-mute">
                      Annualized SPY realized volatility · {row.asOfDate} → {row.horizonEnd}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-term-border pt-2 text-xs">
                      <span className="text-term-text-mute">Outcome</span>
                      <Tag tone={statusTone(row.outcomeStatus)}>{row.outcomeStatus}</Tag>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-term-text-dim">{loading ? "Loading the latest shadow forecasts…" : "No forecast export is available."}</div>
            )}
          </Panel>

          <Panel title="Research & Deployment Contract" code="GATE" className="xl:col-span-5" bodyClassName="p-3" accent>
            <div className="flex flex-wrap gap-1.5">
              <Tag tone="amber">{snapshot?.service.deploymentStatus ?? "shadow_only"}</Tag>
              <Tag tone="down">{snapshot?.service.researchStatus ?? "target_not_met"}</Tag>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-term-text-dim">
              This is a research-monitoring integration, not a production trading signal. The candidate improved continuous forecast loss versus persistence, but did not pass the high-volatility recall gate.
            </p>
            <div className="mt-3 border-y border-term-border text-xs">
              <div className="flex justify-between gap-3 border-b border-term-border-soft py-1.5"><span className="text-term-text-mute">Target</span><span className="text-right text-term-text">Next 5-session annualized SPY realized volatility</span></div>
              <div className="flex justify-between gap-3 border-b border-term-border-soft py-1.5"><span className="text-term-text-mute">Candidate</span><span className="tnum text-right text-term-text">{snapshot?.service.candidateId ?? "—"}</span></div>
              <div className="flex justify-between gap-3 border-b border-term-border-soft py-1.5"><span className="text-term-text-mute">Blend</span><span className="tnum text-term-text">{snapshot ? `${(snapshot.model.modelWeight * 100).toFixed(0)}% model / ${((1 - snapshot.model.modelWeight) * 100).toFixed(0)}% persistence` : "—"}</span></div>
              <div className="flex justify-between gap-3 py-1.5"><span className="text-term-text-mute">Training rows</span><span className="tnum text-term-text">{snapshot?.model.trainingRows.toLocaleString("en-US") ?? "—"}</span></div>
            </div>
            <div className="mt-3 break-all text-3xs text-term-text-mute">MODEL SHA256 {snapshot?.service.modelSha256 ?? "—"}</div>
          </Panel>

          <Panel title="Shadow Operations" code="OPS" className="xl:col-span-4" bodyClassName="p-3">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Run State" value={snapshot?.operations.latestRunState?.toUpperCase() ?? "—"} sub={snapshot?.operations.mode ?? "unavailable"} tone={statusTone(snapshot?.operations.latestRunState ?? "")} className="min-w-0 px-0 py-0" />
              <Stat label="Failed Runs" value={count(snapshot?.operations.failedRuns)} sub="current report" tone={snapshot?.operations.failedRuns ? "down" : "up"} className="min-w-0 px-0 py-0" />
              <Stat label="Origins" value={count(snapshot?.operations.origins)} sub={`${count(snapshot?.operations.missingOrigins)} missing`} className="min-w-0 px-0 py-0" />
              <Stat label="Expected Session" value={snapshot?.operations.expectedLatestSession ?? "—"} sub="XNYS calendar" className="min-w-0 px-0 py-0" />
            </div>
            {snapshot?.operations.latestError && <div className="mt-3 border border-term-down/40 bg-term-down/10 p-2 text-xs text-term-down">{snapshot.operations.latestError}</div>}
          </Panel>

          <Panel title="Model Inputs" code="FEAT" className="xl:col-span-8" bodyClassName="p-3">
            <div className="mb-2 text-2xs text-term-text-mute">{snapshot?.model.featureOrder.length ?? 0} causal features in serving order</div>
            <div className="flex flex-wrap gap-1.5">
              {snapshot?.model.featureOrder.map((feature, index) => (
                <span key={feature} className="tnum rounded-sm border border-term-border bg-term-panel-2 px-2 py-1 text-2xs text-term-text-dim">
                  {String(index + 1).padStart(2, "0")} {feature}
                </span>
              )) ?? <span className="text-xs text-term-text-dim">Model metadata unavailable.</span>}
            </div>
          </Panel>

          <Panel title="Forecast History" code="HIST" className="xl:col-span-12" scroll>
            <DataGrid
              columns={FORECAST_COLUMNS}
              rows={snapshot?.forecasts ?? []}
              rowKey={(row) => row.forecastKey}
              maxHeight="380px"
              initialSort={{ key: "asOf", dir: "desc" }}
              zebra
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
