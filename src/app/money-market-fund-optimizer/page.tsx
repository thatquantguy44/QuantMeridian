import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, Tag } from "@/components/ui/Panel";

type Readiness = "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";

interface ConnectionResponse {
  binding_status: "UNCONFIGURED";
  service_health: Readiness;
  detail: string;
  model_revision: string | null;
  api_schema_version: string | null;
  solve_enabled: boolean;
}

function tone(status: Readiness): "up" | "amber" | "down" | "blue" {
  if (status === "READY") return "up";
  if (status === "UNAVAILABLE") return "down";
  if (status === "INCOMPATIBLE") return "blue";
  return "amber";
}

export default function MoneyMarketFundOptimizer() {
  const [connection, setConnection] = useState<ConnectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mm-fund-optimizer/connection", { cache: "no-store" });
      const body = (await response.json()) as ConnectionResponse;
      if (!response.ok || !body.service_health) throw new Error("Connection check failed.");
      setConnection(body);
    } catch {
      setError("The fund optimizer connection could not be checked. Retry to refresh its status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="MMFO"
        title="Money Market Fund Optimizer"
        desc="Fund Allocation · External Model Service"
        showStreaming={false}
        right={<Tag tone="amber">MODEL GATED</Tag>}
      />

      <div className="m-2 border border-term-blue/40 bg-term-blue/5 px-3 py-2 text-xs text-term-text-dim">
        This is a separate fund allocation workspace from CASH, which covers treasury funding sources and uses.
        Optimization requests will be sent through the terminal server to the approved model service built from its own repository.
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-2">
        <Panel
          title="Model Repository Connection"
          code="ENGINE"
          right={
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="border border-term-border px-2 py-1 text-3xs font-semibold uppercase text-term-text-dim hover:bg-term-panel-2 disabled:opacity-50"
            >
              {loading ? "Checking…" : "Refresh"}
            </button>
          }
        >
          <div className="space-y-3 p-3">
            {error && <div role="alert" className="border border-term-down/40 px-2 py-1.5 text-xs text-term-down">{error}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-term-text">Service</span>
              <Tag tone={tone(connection?.service_health ?? "UNCONFIGURED")}>
                {loading && !connection ? "CHECKING" : connection?.service_health ?? "UNCONFIGURED"}
              </Tag>
              <span className="text-xs font-semibold text-term-text">Approved binding</span>
              <Tag tone="amber">{connection?.binding_status ?? "UNCONFIGURED"}</Tag>
            </div>
            <p className="text-xs leading-relaxed text-term-text-dim">
              {connection?.detail ?? "Waiting for the external fund model service to be configured."}
            </p>
            <dl className="grid grid-cols-1 gap-2 border-t border-term-border pt-3 text-xs sm:grid-cols-2">
              <div><dt className="text-term-text-mute">Model revision</dt><dd className="mt-1 break-all font-mono text-term-text-dim">{connection?.model_revision ?? "—"}</dd></div>
              <div><dt className="text-term-text-mute">API schema</dt><dd className="mt-1 font-mono text-term-text-dim">{connection?.api_schema_version ?? "—"}</dd></div>
            </dl>
          </div>
        </Panel>

        <Panel title="Optimization Workflow" code="RUN">
          <div className="space-y-3 p-3 text-xs">
            <p className="leading-relaxed text-term-text-dim">
              The model repository owns the optimization logic. QuantMeridian will provide the reviewed input snapshot,
              collect the model response, and retain its revision and run provenance.
            </p>
            <ol className="space-y-2 text-term-text-dim">
              <li><span className="mr-2 font-mono text-term-amber">01</span>Connect an approved model service revision.</li>
              <li><span className="mr-2 font-mono text-term-amber">02</span>Load its reviewed input and configuration schema.</li>
              <li><span className="mr-2 font-mono text-term-amber">03</span>Validate, run, and inspect verified results.</li>
            </ol>
            <div className="border border-term-amber/40 bg-term-amber/5 px-2 py-2 text-term-text-dim">
              Run controls are disabled until the model repository, request/result contract, and verifier are approved.
            </div>
            <button type="button" disabled className="cursor-not-allowed border border-term-border px-3 py-1.5 text-2xs font-bold uppercase text-term-text-mute">
              Run fund optimization
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
