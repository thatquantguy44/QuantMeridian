import { useCallback, useEffect, useState } from "react";
import type { EcoIqResponse, EcoIqWorkflow } from "@/lib/ecoiq";

export function useEcoIq() {
  const [data, setData] = useState<EcoIqResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const run = useCallback(async (question: string, workflow: EcoIqWorkflow) => {
    setLoading(true);
    try {
      const res = await fetch("/api/economics/ecoiq", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, workflow }) });
      setData(await res.json() as EcoIqResponse);
    } catch { setData({ ok: false, module: "ECOIQ", workflow, question, observed: [], explanation: "ECOIQ request failed.", evidence: [], effects: [], alternatives: [], falsifiers: [], disclosures: ["The API request failed before evidence could be loaded."], asOf: null, source: "ERR" }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void run("Why did the Treasury curve move?", "economics.explain"); }, [run]);
  return { data, loading, run };
}
