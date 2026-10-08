import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import type { EcoIqEvidence, EcoIqResponse, EcoIqWorkflow } from "@/lib/ecoiq";

interface CurveMetric { as_of_date?: string; slope_10y2y?: number | null; curve_move?: string | null; }
interface CurvePoint { as_of_date?: string; tenor?: string; tenor_label?: string; yield_pct?: number; }
interface Indicator { series_id?: string; latest_value?: number; prior_value?: number | null; as_of_date?: string | null; }

const fmt = (value: number | null | undefined, suffix = "") => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}${suffix}`;

export async function readEcoIq(question: string, workflow: EcoIqWorkflow): Promise<EcoIqResponse> {
  const fallback = (error: string): EcoIqResponse => ({
    ok: false, module: "ECOIQ", workflow, question, observed: [], explanation: "ECOIQ could not establish a Gold evidence set.",
    evidence: [], effects: [], alternatives: [], falsifiers: [], disclosures: ["No macro_medallion evidence was returned; no causal interpretation was produced."], asOf: null, source: "ERR", error,
  });
  if (!goldEnabled()) return fallback("MACRO_DB_URL is not configured");
  try {
    const store = goldStore();
    const [curve, metrics, indicators] = await Promise.all([
      store.latest<CurvePoint>("treasury_curve"),
      store.latest<CurveMetric>("treasury_curve_metrics"),
      store.latest<Indicator>("macro_indicator_dashboard"),
    ]);
    const asOf = [...curve.map(r => r.as_of_date ?? ""), ...metrics.map(r => r.as_of_date ?? "")].filter(Boolean).sort().at(-1) ?? null;
    const metric = metrics.find(r => r.as_of_date === asOf) ?? metrics.at(-1);
    const slope = metric?.slope_10y2y ?? null;
    const move = metric?.curve_move ?? "not classified";
    const latestByTenor = new Map(curve.filter(r => (r.as_of_date ?? "") === asOf).map(r => [r.tenor ?? r.tenor_label, r.yield_pct]));
    const y2 = latestByTenor.get("2Y"); const y10 = latestByTenor.get("10Y");
    const evidence: EcoIqEvidence[] = [
      { id: "curve.slope_10y2y", label: "2s10s slope", value: fmt(slope, " bp"), asOf, source: "GOLD", interpretation: "Observed Treasury curve slope from the Gold layer." },
      { id: "curve.move", label: "Curve move class", value: move, asOf, source: "GOLD", interpretation: "Pipeline classification; treated as evidence, not a causal verdict." },
      { id: "curve.levels", label: "2Y / 10Y yields", value: `${fmt(y2, "%")} / ${fmt(y10, "%")}`, asOf, source: "GOLD", interpretation: "Latest tenor levels when available." },
    ];
    const keyIndicators = indicators.filter(r => ["FEDFUNDS", "CPIAUCSL", "UNRATE", "GDPNOW"].includes(r.series_id ?? "")).slice(0, 4);
    for (const row of keyIndicators) evidence.push({ id: `indicator.${row.series_id}`, label: row.series_id ?? "indicator", value: fmt(row.latest_value), asOf: row.as_of_date ?? asOf, source: "GOLD", interpretation: "Macro context supplied by macro_medallion." });
    const observed = [`The Gold pipeline classifies the latest curve move as ${move}.`, `The latest 2s10s slope is ${fmt(slope, " bp")}.`];
    const explanation = workflow === "economics.scenario"
      ? "This is a conditional scenario, not a forecast: if the stated curve move persists, the transmission path below is the economically coherent mechanism to monitor."
      : "ECOIQ separates the observed curve state from a mechanism hypothesis. A steeper curve can reflect front-end repricing, long-end term premium, or both; the evidence above does not by itself identify one cause.";
    const effects = workflow === "economics.scenario" ? [
      { order: 1 as const, title: "Curve repricing", detail: "Monitor whether the front end or term premium is driving the move.", confidence: "medium" as const },
      { order: 2 as const, title: "Funding and duration", detail: "Persistent long-end pressure can raise duration hedging and term funding costs.", confidence: "low" as const },
      { order: 3 as const, title: "Cross-asset response", detail: "Rates-sensitive credit, FX and equities may react if the move changes real-rate expectations.", confidence: "low" as const },
    ] : [
      { order: 1 as const, title: "Rates mechanics", detail: "The immediate effect is a change in relative discount rates across maturities.", confidence: "high" as const },
      { order: 2 as const, title: "Funding and credit", detail: "A persistent move can pass through to hedging, issuance and funding conditions, subject to basis and liquidity.", confidence: "medium" as const },
      { order: 3 as const, title: "Cross-asset transmission", detail: "FX, credit and equities may adjust as the market updates growth, inflation and policy expectations.", confidence: "low" as const },
    ];
    return { ok: true, module: "ECOIQ", workflow, question, observed, explanation, evidence, effects,
      alternatives: ["Front-end policy repricing", "Long-end term-premium or supply pressure", "Positioning, liquidity, or technical flow"],
      falsifiers: ["The slope reverses without a corresponding change in macro or policy evidence.", "Front-end and long-end moves point to conflicting mechanisms.", "The move is not reproduced in the next Gold refresh."],
      disclosures: ["Numbers are read from macro_medallion Gold tables.", "Mechanism and effect-chain language is hypothesis-based; observational data does not prove causation.", "QuantSmith is used only by the local worker path; this API does not import or query it directly."], asOf, source: "macro_medallion" };
  } catch (err) { return fallback((err as Error).message); }
}
