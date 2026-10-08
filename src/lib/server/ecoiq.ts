import { goldEnabled, goldStore } from "@/lib/server/goldStore";
import { goldParam, goldTable } from "@/lib/server/goldStore";
import { FRED_CATALOG } from "@/data/econSeries";
import type { EcoIqEvidence, EcoIqResponse, EcoIqWorkflow } from "@/lib/ecoiq";

interface CurveMetric { as_of_date?: string; slope_10y2y?: number | null; curve_move?: string | null; }
interface CurvePoint { as_of_date?: string; tenor?: string; tenor_label?: string; yield_pct?: number; }
interface Indicator { series_id?: string; latest_value?: number; prior_value?: number | null; as_of_date?: string | null; }
interface InflationObservation { series_id: string; observation_date: string; value: number; }

const fmt = (value: number | null | undefined, suffix = "") => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}${suffix}`;
const isInflationQuestion = (question: string) => /inflation|cpi|pce|month[- ]over[- ]month|m\/?m/i.test(question);

async function readInflationMoves(store: ReturnType<typeof goldStore>, workflow: EcoIqWorkflow, question: string): Promise<EcoIqResponse> {
  const ids = FRED_CATALOG.filter((s) => s.category === "INFLATION" && s.freq === "M").map((s) => s.id);
  const placeholders = ids.map((_id, i) => goldParam(i + 1)).join(", ");
  const rows = await store.raw<InflationObservation>(`SELECT series_id, observation_date, value FROM (SELECT series_id, observation_date, value, ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY observation_date DESC) AS rn FROM ${goldTable("fred_latest_observation")} WHERE series_id IN (${placeholders}) AND NOT is_missing) ranked WHERE rn <= 2 ORDER BY series_id, observation_date DESC`, ids);
  const bySeries = new Map<string, InflationObservation[]>();
  for (const row of rows) bySeries.set(row.series_id, [...(bySeries.get(row.series_id) ?? []), row]);
  const meta = new Map(FRED_CATALOG.map((s) => [s.id, s]));
  const moves = [...bySeries.entries()].flatMap(([id, values]) => {
    if (values.length < 2) return [];
    const latest = values[0]; const prior = values[1];
    const m = meta.get(id); const rateSeries = Boolean(m?.unit.match(/%\s*(m\/m|y\/y|ann\.)/i)); const delta = rateSeries ? latest.value - prior.value : (prior.value === 0 ? null : (latest.value - prior.value) / Math.abs(prior.value) * 100);
    if (delta == null || !Number.isFinite(delta)) return [];
    return [{ id, label: m?.label ?? id, latest, prior, delta }];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8);
  const asOf = moves.map((m) => m.latest.observation_date).sort().at(-1) ?? null;
  const evidence: EcoIqEvidence[] = moves.map((m) => ({ id: `inflation.${m.id}`, label: m.label, value: `${m.delta >= 0 ? "+" : ""}${m.delta.toFixed(2)}% m/m`, asOf: m.latest.observation_date, source: "GOLD", interpretation: `Observed change from ${m.prior.observation_date} to ${m.latest.observation_date}; calculated from Gold observations.` }));
  const observed = moves.length ? [`The largest absolute monthly inflation moves in the available Gold series are ranked below.`, `The most recent observation dates range through ${asOf ?? "—"}.`] : ["No two-period monthly inflation observations were returned from Gold."];
  const explanation = moves.length ? "These are descriptive month-over-month moves, not causal attribution. Large changes can reflect energy, food, base effects, seasonal adjustment, or release/revision timing; ECOIQ needs additional evidence before assigning a mechanism." : "ECOIQ could not establish a two-period monthly inflation comparison.";
  return { ok: moves.length > 0, module: "ECOIQ", workflow, question, observed, explanation, evidence, effects: [
    { order: 1, title: "Print-level move", detail: "The ranked changes identify which inflation series moved most month over month.", confidence: "high" },
    { order: 2, title: "Basket transmission", detail: "Persistent component moves can change headline/core momentum depending on weights and persistence.", confidence: "medium" },
    { order: 3, title: "Policy and rates", detail: "A sustained inflation impulse can alter policy expectations and rates, subject to corroboration.", confidence: "low" },
  ], alternatives: ["Energy or food shock", "Seasonal adjustment or base effect", "Revision or release-timing effect"], falsifiers: ["The move disappears on the next vintage refresh.", "Other inflation measures do not corroborate the direction.", "The largest component is immaterial after basket weights are applied."], disclosures: ["Numbers are calculated from macro_medallion Gold observations.", "Ranking is descriptive; it does not establish causation.", "Component weights and seasonal-adjustment attribution are not inferred without a governed pack."], asOf, source: "macro_medallion" };
}

export async function readEcoIq(question: string, workflow: EcoIqWorkflow): Promise<EcoIqResponse> {
  const fallback = (error: string): EcoIqResponse => ({
    ok: false, module: "ECOIQ", workflow, question, observed: [], explanation: "ECOIQ could not establish a Gold evidence set.",
    evidence: [], effects: [], alternatives: [], falsifiers: [], disclosures: ["No macro_medallion evidence was returned; no causal interpretation was produced."], asOf: null, source: "ERR", error,
  });
  if (!goldEnabled()) return fallback("MACRO_DB_URL is not configured");
  try {
    const store = goldStore();
    if (isInflationQuestion(question)) return await readInflationMoves(store, workflow, question);
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
