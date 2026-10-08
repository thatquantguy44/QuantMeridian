import { useCallback, useEffect, useState } from "react";
import type { EcoIqResponse, EcoIqWorkflow } from "@/lib/ecoiq";

export function useEcoIq() {
  const [data, setData] = useState<EcoIqResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queueStatus, setQueueStatus] = useState<"idle" | "queued" | "running" | "deterministic">("idle");
  const run = useCallback(async (question: string, workflow: EcoIqWorkflow) => {
    setLoading(true);
    try {
      const queued = await fetch("/api/agent/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schema_version: "agent-job/1", module: "ECOIQ", thread_id: crypto.randomUUID(), workflow, message: question, context: { series: [{ source: "econ", id: "DGS2" }, { source: "econ", id: "DGS10" }], tenors: ["2Y", "10Y"] } }) });
      if (queued.ok) {
        const created = await queued.json() as { job: { job_id: string } };
        setQueueStatus("queued");
        setQueueStatus("running");
        await fetch(`/api/agent/jobs/${created.job.job_id}/execute`, { method: "POST" });
        for (let attempt = 0; attempt < 20; attempt++) {
          const status = await fetch(`/api/agent/jobs/${created.job.job_id}`, { cache: "no-store" });
          const body = await status.json() as { job?: { status?: string; result?: EcoIqResponse } };
          if (body.job?.result) { setData(body.job.result); break; }
          if (body.job?.status === "failed" || body.job?.status === "cancelled") break;
          await new Promise(resolve => window.setTimeout(resolve, 250));
        }
      } else {
        setQueueStatus("deterministic");
        const res = await fetch("/api/economics/ecoiq", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, workflow }) });
        setData(await res.json() as EcoIqResponse);
      }
    } catch { setData({ ok: false, module: "ECOIQ", workflow, question, observed: [], explanation: "ECOIQ request failed.", evidence: [], effects: [], alternatives: [], falsifiers: [], disclosures: ["The API request failed before evidence could be loaded."], asOf: null, source: "ERR" }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void run("Why did the Treasury curve move?", "economics.explain"); }, [run]);
  return { data, loading, queueStatus, run };
}
