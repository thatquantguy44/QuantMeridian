import type { MmktRunResult } from "@/data/mmkt";
import type { CompareRow } from "./panels";

const num = (value: number, places = 2) => value.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });

/** Service ordered, verified, indicative tickets. No browser-side sorting or sizing. */
export function ExecutionBlotter({ result }: { result: MmktRunResult }) {
  const lines = result.currency_results.flatMap((currency) => currency.blotter ?? []);
  if (!result.execution_ready) return <p className="text-[11px] text-term-text-mute">This run is a continuous LP preview. No executable ticket plan was verified.</p>;
  if (!lines.length) return <p className="text-[11px] text-term-text-mute">The verified plan keeps all cash uninvested; there are no tickets.</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[10px]">
    <caption className="sr-only">Verified indicative execution order</caption>
    <thead><tr className="text-left text-term-text-mute"><th scope="col">#</th><th scope="col">Plan time</th><th scope="col">Cutoff</th><th scope="col">Candidate</th><th scope="col">Account</th><th scope="col" className="text-right">Ticket $mm</th><th scope="col" className="text-right">Lot $mm</th></tr></thead>
    <tbody>{lines.map((line) => <tr key={`${line.currency}-${line.sequence}-${line.account_id}`} className="border-t border-term-border">
      <td className="py-1 font-mono">{line.sequence}</td><td className="font-mono">{line.planned_at.replace("T", " ")}</td>
      <td className="font-mono">{line.cutoff_at?.replace("T", " ") ?? "none"}</td>
      <td className="font-mono text-term-text">{line.candidate_id}</td><td>{line.account_id}</td>
      <td className="text-right font-mono">{num(line.amount, 0)}</td><td className="text-right font-mono">{num(line.lot_size_amount, 0)}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function CutoffTimeline({ result }: { result: MmktRunResult }) {
  const events = result.currency_results.flatMap((currency) => currency.cutoff_timeline ?? []);
  if (!events.length) return <p className="text-[11px] text-term-text-mute">No dated cutoffs were supplied for this run.</p>;
  return <div className="space-y-1 text-[10px]">{events.map((event) => <div key={event.candidate_id} className="flex flex-wrap justify-between gap-2 border-b border-term-border py-1">
    <span className="font-mono text-term-text">{event.candidate_id}</span>
    <span className="font-mono text-term-text-mute">{event.cutoff_at.replace("T", " ")}</span>
    <span className={event.status === "missed" ? "text-term-down" : event.status === "planned" ? "text-term-up" : "text-term-text-dim"}>{event.status.toUpperCase()}</span>
  </div>)}</div>;
}

export function ShadowPrices({ result }: { result: MmktRunResult }) {
  const prices = result.currency_results.flatMap((currency) => currency.shadow_prices ?? []);
  const convention = result.run.model_family === "ticketed_mip" ? "FIXED_INTEGER_LP" : "LP_LOCAL";
  return <div className="space-y-2 text-[10px]">
    <p className="text-term-text-mute">{convention === "FIXED_INTEGER_LP" ? "All integer ticket and lot choices are fixed, then an LP is re-solved. These marginals apply only to that fixed plan; they are not MIP shadow prices." : "Local LP marginal change in modeled net return when the named row's right-hand side increases by $1mm."} A negative cash-floor value is the yield cost of requiring $1mm more cash.</p>
    {prices.length ? <div className="max-h-[220px] space-y-1 overflow-y-auto">{prices.map((price) => <div key={price.row_name} className="flex justify-between gap-3 border-b border-term-border py-1"><span className="text-term-text">{price.label} <span className="font-mono text-term-text-mute">({price.bound})</span></span><span className="whitespace-nowrap font-mono">{price.objective_delta_usd_per_extra_mm >= 0 ? "+" : ""}${num(price.objective_delta_usd_per_extra_mm)} / $1mm</span></div>)}</div> : <p className="text-term-text-mute">No eligible binding row has a local marginal value in this plan.</p>}
  </div>;
}

export function LiquidityFrontier({ result }: { result: MmktRunResult }) {
  const points = result.currency_results.flatMap((currency) => (currency.frontier ?? []).map((point) => ({ ...point, currency: currency.currency })));
  if (!points.length) return <p className="text-[11px] text-term-text-mute">Run a floor sensitivity to show verified yield and liquidity tradeoffs.</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[470px] text-[10px]">
    <caption className="sr-only">Independently verified liquidity floor frontier</caption>
    <thead><tr className="text-left text-term-text-mute"><th scope="col">Currency</th><th scope="col">Cash floor</th><th scope="col">Solve</th><th scope="col" className="text-right">Net return $k</th><th scope="col" className="text-right">Min headroom $mm</th></tr></thead>
    <tbody>{points.map((point) => <tr key={`${point.currency}-${point.floor_multiplier}`} className="border-t border-term-border" title={`Input hash ${point.input_hash}`}>
      <td className="py-1 font-mono">{point.currency}</td><td className="font-mono">{num(point.floor_multiplier * 100, 0)}% of base</td>
      <td className={point.status === "optimal_verified" ? "text-term-up" : "text-term-down"}>{point.status.replace("_", " ")}</td>
      <td className="text-right font-mono">{point.objective_value === null ? "—" : num(point.objective_value * 1000)}</td>
      <td className="text-right font-mono">{point.minimum_cash_headroom === null ? "—" : num(point.minimum_cash_headroom)}</td>
    </tr>)}</tbody>
  </table><p className="mt-2 text-term-text-mute">Each point is a separate verified model solve with a distinct input hash. SIM sensitivities are illustrative, not forecasts.</p></div>;
}

/** Signed differences between verified service plans; no synthetic optimization output. */
export function ScenarioPlanDelta({ rows }: { rows: CompareRow[] }) {
  const base = rows.find((row) => row.id === "base");
  if (!base?.result?.execution_ready || !base.analytics) return <p className="text-[11px] text-term-text-mute">Run all scenarios with the ticketed service binding to compare verified plans.</p>;
  const totals = (result: MmktRunResult) => {
    const byCandidate = new Map<string, number>();
    for (const line of result.currency_results.flatMap((currency) => currency.blotter ?? [])) {
      byCandidate.set(line.candidate_id, (byCandidate.get(line.candidate_id) ?? 0) + line.amount);
    }
    return byCandidate;
  };
  const baseTotals = totals(base.result);
  return <div className="space-y-4 text-[10px]">{["rate-cut", "forecast-miss"].map((id) => {
    const shock = rows.find((row) => row.id === id);
    if (!shock?.result?.execution_ready || !shock.analytics) return <p key={id} className="text-term-down">{shock?.title ?? id}: {shock?.error ?? "No verified ticketed plan"}</p>;
    const shockedTotals = totals(shock.result);
    const movers = [...new Set([...baseTotals.keys(), ...shockedTotals.keys()])].map((candidate) => ({
      candidate, baseAmount: baseTotals.get(candidate) ?? 0, shockedAmount: shockedTotals.get(candidate) ?? 0,
      delta: (shockedTotals.get(candidate) ?? 0) - (baseTotals.get(candidate) ?? 0),
    })).filter((item) => Math.abs(item.delta) > 1e-7).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.candidate.localeCompare(b.candidate)).slice(0, 6);
    const returnDelta = shock.analytics.objective - base.analytics!.objective;
    const liquidityDelta = shock.analytics.minHeadroom !== null && base.analytics!.minHeadroom !== null
      ? shock.analytics.minHeadroom - base.analytics!.minHeadroom : null;
    const avgCash = (holdings: { cash: number }[]) => holdings.reduce((sum, day) => sum + day.cash, 0) / Math.max(holdings.length, 1);
    const cashDelta = avgCash(shock.analytics.holdings) - avgCash(base.analytics!.holdings);
    return <section key={id} className="rounded border border-term-border p-2" aria-label={`${shock.title} plan impact`}>
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-term-text">{shock.title}</h3><span className="font-mono text-term-text-mute">base {base.hash?.slice(0, 8)} → shock {shock.hash?.slice(0, 8)}</span></div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div>Net return <strong className="ml-1 font-mono text-term-text">{returnDelta >= 0 ? "+" : ""}${num(returnDelta * 1000)}k</strong></div>
        <div>Annualized yield <strong className="ml-1 font-mono text-term-text">{shock.analytics.annualizedReturnPct.toFixed(3)}%</strong> <span className="text-term-text-mute">vs {base.analytics!.annualizedReturnPct.toFixed(3)}%</span></div>
        <div>Minimum cash headroom <strong className="ml-1 font-mono text-term-text">{liquidityDelta === null ? "—" : `${liquidityDelta >= 0 ? "+" : ""}$${num(liquidityDelta)}mm`}</strong></div>
        <div>Avg cash held <strong className="ml-1 font-mono text-term-text">${num(avgCash(shock.analytics.holdings))}mm</strong> <span className="text-term-text-mute">({cashDelta >= 0 ? "+" : ""}{num(cashDelta)}mm)</span></div>
      </div>
      <div className="mt-2 text-term-text-mute">{movers.length ? "Largest ticket changes from verified blotters:" : "The verified blotter keeps the same ticket amounts; the economic return changed."}</div>
      {movers.length > 0 && <ul className="mt-1 grid gap-1 sm:grid-cols-2">{movers.map((item) => <li key={item.candidate} className="flex justify-between gap-2 border-b border-term-border py-0.5"><span className="font-mono">{item.candidate}</span><span className="font-mono">{item.delta >= 0 ? "+" : ""}{num(item.delta, 0)}mm</span></li>)}</ul>}
    </section>;
  })}</div>;
}
