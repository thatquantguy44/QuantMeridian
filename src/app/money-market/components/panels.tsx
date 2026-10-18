import { Fragment } from "react";
import { CheckCircle2, CircleAlert, Download, Terminal, XCircle } from "lucide-react";
import {
  BASELINES, ENTITY_LABELS, FAMILY_META, FAMILY_OF, type BaselineOutcome, type BookInputs, type ForecastCase, type InstrumentCandidate,
  type MmktRunResult, type RateRow, type RunAnalytics,
} from "@/data/mmkt";

export interface ServiceStatus {
  service_health: "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";
  detail: string;
  token_configured: boolean;
  url_configured: boolean;
  model_status: string | null;
  binding_id: string | null;
  api_schema_version: string | null;
}

const fmt = (v: number, dp = 1) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const inputCls = "w-16 rounded border border-term-border bg-term-panel-2 px-1.5 py-0.5 text-right font-mono text-[10px] text-term-text outline-none focus:border-term-amber/60 disabled:opacity-40";

/** Step-by-step setup when the service, binding or token is missing. */
export function SetupGuide({ status }: { status: ServiceStatus | null }) {
  const steps = [
    { done: status !== null && status.service_health !== "UNAVAILABLE", label: "Start the MMKT service on port 8014",
      code: "pip install ./services/optimization_core ./services/money_market_api\nMONEY_MARKET_API_TOKEN=<token> MONEY_MARKET_MODEL_BINDING=local-mmkt-execution-v2 \\\n  uvicorn money_market_api.app:app --app-dir services/money_market_api/src --port 8014" },
    { done: status?.model_status === "ticketed_mip_available", label: "Enable the ticketed binding (MONEY_MARKET_MODEL_BINDING=local-mmkt-execution-v2)", code: null },
    { done: Boolean(status?.token_configured), label: "Give the terminal the same token, then restart the dev server", code: "# .env.local\nMONEY_MARKET_API_TOKEN=<token>" },
    { done: Boolean(status?.binding_id), label: "The terminal and service authenticate (capability manifest readable)", code: null },
  ];
  return (
    <ol className="space-y-2.5">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-2.5">
          {step.done ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-term-up" aria-label="done" /> : <span className="mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-term-text-mute font-mono text-[9px] text-term-text-mute">{i + 1}</span>}
          <div className="min-w-0 flex-1">
            <div className={`text-[11px] ${step.done ? "text-term-text-dim" : "text-term-text"}`}>{step.label}</div>
            {step.code && !step.done && (
              <pre className="mt-1 overflow-x-auto rounded border border-term-border bg-term-bg p-2 font-mono text-[10px] leading-relaxed text-term-text-dim"><Terminal size={10} className="mb-0.5 mr-1 inline text-term-amber" />{step.code}</pre>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Every snapshot row with quoted vs normalized yield and pricing eligibility. */
export function RateTable({ rows, labels, sourceTag }: { rows: RateRow[]; labels: Record<string, string>; sourceTag: "SIM" | "DB" }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[10px]">
        <caption className="sr-only">Rate snapshot rows with status and pricing eligibility</caption>
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.1em] text-term-text-mute">
            <th scope="col" className="pb-1 text-left font-semibold">Instrument</th>
            <th scope="col" className="pb-1 text-right font-semibold">Quoted %</th>
            <th scope="col" className="pb-1 text-left font-semibold pl-2">Basis</th>
            <th scope="col" className="pb-1 text-right font-semibold">mm yield %</th>
            <th scope="col" className="pb-1 text-left font-semibold pl-2">Observed</th>
            <th scope="col" className="pb-1 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const priced = r.status === "ok" && r.mm_yield_pct !== null;
            return (
              <tr key={r.instrument_id} className="border-t border-term-border" title={r.status_detail ?? undefined}>
                <th scope="row" className="py-1 text-left font-normal">
                  <div className="font-mono text-term-text">{r.instrument_id}</div>
                  <div className="text-[9px] text-term-text-mute">{labels[r.instrument_id] ?? ""}</div>
                </th>
                <td className="py-1 text-right font-mono text-term-text-dim">{r.quoted_rate_pct?.toFixed(3) ?? "—"}</td>
                <td className="py-1 pl-2 font-mono text-term-text-mute">{r.quoted_basis ?? "—"}</td>
                <td className={`py-1 text-right font-mono ${priced ? "text-term-text" : "text-term-text-mute"}`}>{r.mm_yield_pct?.toFixed(4) ?? "—"}</td>
                <td className="py-1 pl-2 font-mono text-term-text-mute">{r.observation_date ?? "—"}{r.staleness_days ? ` (${r.staleness_days}d)` : ""}</td>
                <td className="py-1">
                  {priced
                    ? <span className={`rounded-sm px-1 py-px text-[9px] font-semibold ${sourceTag === "SIM" ? "bg-term-cyan/10 text-term-cyan" : "bg-term-up/10 text-term-up"}`}>{sourceTag}</span>
                    : <span className="rounded-sm bg-term-down/10 px-1 py-px text-[9px] font-semibold text-term-down" title="Not priced: only status=ok rows with a normalized yield enter the model">ERR · {r.status}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] leading-relaxed text-term-text-mute">The model ranks on the normalized <span className="font-mono">mm_yield_pct</span>, never on quoted rates with unlike bases. Rows that are not <span className="font-mono">ok</span> stay visible but are never priced. Candidates that reference them are excluded from the request.</p>
    </div>
  );
}

/** Candidate universe with enable toggles and editable caps/costs. */
export function CandidateTable({ book, rates, onChange }: { book: BookInputs; rates: RateRow[] | null; onChange: (book: BookInputs) => void }) {
  const rateById = new Map((rates ?? []).map((r) => [r.instrument_id, r]));
  // Collapse the daily overnight candidates into one row per product for editing.
  const groups = new Map<string, InstrumentCandidate[]>();
  for (const c of book.candidates) {
    const key = c.candidate_id.replace(/-\d{4}-\d{2}-\d{2}$/, "");
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const update = (ids: string[], patch: Partial<InstrumentCandidate>) =>
    onChange({ ...book, candidates: book.candidates.map((c) => (ids.includes(c.candidate_id) ? { ...c, ...patch } : c)) });
  const toggle = (ids: string[], on: boolean) => onChange({ ...book, enabled: { ...book.enabled, ...Object.fromEntries(ids.map((id) => [id, on])) } });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-[10px]">
        <caption className="sr-only">Instrument candidates</caption>
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.1em] text-term-text-mute">
            <th scope="col" className="pb-1 text-left font-semibold">Use</th>
            <th scope="col" className="pb-1 text-left font-semibold">Candidate</th>
            <th scope="col" className="pb-1 text-left font-semibold">Rating · cpty</th>
            <th scope="col" className="pb-1 text-left font-semibold">Settle → mature</th>
            <th scope="col" className="pb-1 text-right font-semibold">Max $mm</th>
            <th scope="col" className="pb-1 text-right font-semibold">Min ticket</th>
            <th scope="col" className="pb-1 text-right font-semibold">Lot</th>
            <th scope="col" className="pb-1 text-right font-semibold">Cost bp</th>
            <th scope="col" className="pb-1 text-left font-semibold pl-2">Rate</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([key, items]) => {
            const c = items[0];
            const ids = items.map((i) => i.candidate_id);
            const rate = rateById.get(c.rate_instrument_id);
            // Before a rate source is chosen, eligibility is unknown rather than failed.
            const awaiting = rates === null;
            const priced = awaiting || Boolean(rate && rate.status === "ok" && rate.mm_yield_pct !== null);
            const on = ids.every((id) => book.enabled[id]);
            const fam = FAMILY_META[FAMILY_OF[c.instrument_type]];
            const rolling = items.length > 1;
            return (
              <tr key={key} className={`border-t border-term-border ${priced ? "" : "opacity-60"}`}>
                <td className="py-1">
                  <input type="checkbox" aria-label={`Include ${key}`} checked={on && priced} disabled={!priced} onChange={(e) => toggle(ids, e.target.checked)} className="h-3 w-3 accent-term-amber" />
                </td>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  <div className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: fam.color }} aria-hidden /><span className="font-mono text-term-text">{key}{rolling ? " ×" + items.length : ""}</span></div>
                  <div className="pl-3.5 text-[9px] text-term-text-mute">{c.instrument_type.replace(/_/g, " ")}{rolling ? " · rolls daily" : ""}</div>
                </th>
                <td className="py-1 font-mono text-term-text-dim">{c.rating ?? "—"} · {c.counterparty_id ?? c.issuer_id ?? "—"}</td>
                <td className="py-1 font-mono text-term-text-mute">{rolling ? "overnight" : `${c.settlement_date.slice(5)} → ${c.maturity_date}`}</td>
                <td className="py-1 text-right">
                  <input type="number" min={0} step={10} aria-label={`${key} maximum amount`} disabled={!priced} placeholder="∞"
                    value={c.maximum_amount ?? ""} className={inputCls}
                    onChange={(e) => update(ids, { maximum_amount: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />
                </td>
                <td className="py-1 text-right"><input type="number" min={0} step={1} aria-label={`${key} minimum ticket`} disabled={!priced}
                  value={c.minimum_ticket_amount} className={inputCls}
                  onChange={(e) => update(ids, { minimum_ticket_amount: Math.max(0, Number(e.target.value) || 0) })} /></td>
                <td className="py-1 text-right"><input type="number" min={0.01} step={1} aria-label={`${key} lot size`} disabled={!priced}
                  value={c.lot_size_amount} className={inputCls}
                  onChange={(e) => update(ids, { lot_size_amount: Math.max(0.01, Number(e.target.value) || 1) })} /></td>
                <td className="py-1 text-right">
                  <input type="number" min={0} step={0.1} aria-label={`${key} explicit cost (bp)`} disabled={!priced}
                    value={c.explicit_cost_bps} className={inputCls}
                    onChange={(e) => update(ids, { explicit_cost_bps: Math.max(0, Number(e.target.value) || 0) })} />
                </td>
                <td className="py-1 pl-2">
                  {awaiting ? <span className="text-[9px] text-term-text-mute">awaiting rates</span>
                    : priced ? <span className="font-mono text-term-text-dim">{rate!.mm_yield_pct!.toFixed(3)}%</span>
                    : <span className="text-[9px] font-semibold text-term-down" title={rate?.status_detail ?? "No rate row"}>{rate ? `${rate.status} · excluded` : "no row · excluded"}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Forecast case, liquidity floors, WAM/WAL and the exposure-limit summary. */
export function PolicyEditor({ book, onChange }: { book: BookInputs; onChange: (book: BookInputs) => void }) {
  const p = book.policy;
  const setPolicy = (patch: Partial<typeof p>) => onChange({ ...book, policy: { ...p, ...patch } });
  const floorFor = (entity: string, weekly: boolean) => (weekly ? p.weekly_liquidity_floors : p.daily_liquidity_floors).find((f) => f.legal_entity_id === entity)?.minimum_cash ?? 0;
  const setFloor = (entity: string, weekly: boolean, value: number) => {
    const key = weekly ? "weekly_liquidity_floors" : "daily_liquidity_floors";
    setPolicy({ [key]: p[key].map((f) => (f.legal_entity_id === entity ? { ...f, minimum_cash: Math.max(0, value) } : f)) } as Partial<typeof p>);
  };
  const setLimit = (key: string, patch: Partial<(typeof p.exposure_limits)[number]>) =>
    setPolicy({ exposure_limits: p.exposure_limits.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const cases: { id: ForecastCase; label: string }[] = [{ id: "p10", label: "p10 downside" }, { id: "p50", label: "p50 base" }, { id: "p90", label: "p90 upside" }];
  return (
    <div className="space-y-3 text-[10px]">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-term-text-dim">Model formulation
          <select aria-label="Model formulation" value={p.execution_mode ?? "continuous_preview"} onChange={(event) => setPolicy({ execution_mode: event.target.value as "continuous_preview" | "ticketed_plan" })}
            className="mt-1 w-full rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text">
            <option value="ticketed_plan">Ticketed MIP plan</option><option value="continuous_preview">Continuous LP preview</option>
          </select>
        </label>
        <label className="text-term-text-dim">Maximum tickets per currency
          <input type="number" min={1} aria-label="Maximum ticket count" value={p.maximum_ticket_count ?? ""} placeholder="no cap"
            onChange={(event) => setPolicy({ maximum_ticket_count: event.target.value === "" ? null : Math.max(1, Number(event.target.value)) })}
            className="mt-1 w-full rounded border border-term-border bg-term-panel-2 px-2 py-1 text-term-text" />
        </label>
      </div>
      {p.execution_mode === "ticketed_plan" && <label className="block text-term-text-dim">Indicative decision time (ISO with offset)
        <input type="text" aria-label="Indicative decision time" value={p.decision_at ?? ""}
          onChange={(event) => setPolicy({ decision_at: event.target.value })}
          className="mt-1 w-full rounded border border-term-border bg-term-panel-2 px-2 py-1 font-mono text-term-text" />
      </label>}
      <div>
        <div className="mb-1 text-term-text-dim">Cash forecast case</div>
        <div className="flex overflow-hidden rounded-md border border-term-border" role="radiogroup" aria-label="Cash forecast case">
          {cases.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={p.cash_forecast_case === c.id} onClick={() => setPolicy({ cash_forecast_case: c.id })}
              className={`flex-1 px-2 py-1 font-medium transition ${p.cash_forecast_case === c.id ? "bg-term-amber text-black" : "bg-term-panel-2 text-term-text-dim hover:text-term-text"}`}>{c.label}</button>
          ))}
        </div>
      </div>
      <table className="w-full">
        <caption className="mb-1 text-left text-term-text-dim">Liquidity floors ($mm minimum cash)</caption>
        <thead><tr className="text-[9px] uppercase tracking-[0.1em] text-term-text-mute"><th scope="col" className="text-left font-semibold">Entity</th><th scope="col" className="text-right font-semibold">Daily</th><th scope="col" className="text-right font-semibold">Friday</th></tr></thead>
        <tbody>
          {Object.keys(ENTITY_LABELS).map((e) => (
            <tr key={e} className="border-t border-term-border">
              <th scope="row" className="py-1 text-left font-normal text-term-text">{ENTITY_LABELS[e]}</th>
              <td className="py-1 text-right"><input type="number" min={0} step={25} aria-label={`${e} daily floor`} value={floorFor(e, false)} onChange={(ev) => setFloor(e, false, Number(ev.target.value))} className={inputCls} /></td>
              <td className="py-1 text-right"><input type="number" min={0} step={25} aria-label={`${e} Friday floor`} value={floorFor(e, true)} onChange={(ev) => setFloor(e, true, Number(ev.target.value))} className={inputCls} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center justify-between gap-2 text-term-text-dim">Max WAM (days)
          <input type="number" min={1} step={5} value={p.maximum_wam_days ?? ""} placeholder="none" onChange={(e) => setPolicy({ maximum_wam_days: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} className={inputCls} />
        </label>
        <label className="flex items-center justify-between gap-2 text-term-text-dim">Max WAL (days)
          <input type="number" min={1} step={5} value={p.maximum_wal_days ?? ""} placeholder="none" onChange={(e) => setPolicy({ maximum_wal_days: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} className={inputCls} />
        </label>
      </div>
      <table className="w-full">
        <caption className="mb-1 text-left text-term-text-dim">Exposure limits</caption>
        <tbody>
          {p.exposure_limits.map((l) => (
            <tr key={`${l.dimension}-${l.key}`} className="border-t border-term-border">
              <th scope="row" className="py-1 text-left font-normal"><span className="text-term-text">{l.key}</span> <span className="text-term-text-mute">{l.dimension}</span></th>
              <td className="py-1 text-right">
                {l.minimum_rating !== null ? (
                  <select aria-label={`${l.key} minimum rating`} value={l.minimum_rating} onChange={(e) => setLimit(l.key, { minimum_rating: e.target.value })} className="rounded border border-term-border bg-term-panel-2 px-1 py-0.5 font-mono text-[10px] text-term-text">
                    {["AAA", "AA-", "A+", "A", "A-", "BBB+", "BBB"].map((r) => <option key={r} value={r}>min {r}</option>)}
                  </select>
                ) : l.maximum_portfolio_fraction !== null ? (
                  <label className="text-term-text-mute">≤ <input type="number" min={0} max={100} step={5} aria-label={`${l.key} maximum share (%)`} value={Math.round(l.maximum_portfolio_fraction * 100)} onChange={(e) => setLimit(l.key, { maximum_portfolio_fraction: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} className={inputCls} />%</label>
                ) : (
                  <label className="text-term-text-mute">≤ $<input type="number" min={0} step={25} aria-label={`${l.key} maximum amount`} value={l.maximum_amount ?? 0} onChange={(e) => setLimit(l.key, { maximum_amount: Math.max(0, Number(e.target.value)) })} className={inputCls} />mm</label>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Forecast summary per account: opening, known flows and the residual band. */
export function ForecastTable({ book }: { book: BookInputs }) {
  const accounts = [...new Set(book.forecast.map((f) => f.account_id))];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[10px]">
        <caption className="sr-only">Cash forecast by account and day ($mm)</caption>
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.1em] text-term-text-mute">
            <th scope="col" className="pb-1 text-left font-semibold">Account</th>
            {book.forecast.filter((f) => f.account_id === accounts[0]).map((f) => <th key={f.period_date} scope="col" className="pb-1 text-right font-semibold">{f.period_date.slice(5)}</th>)}
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const pts = book.forecast.filter((f) => f.account_id === a);
            return (
              <tr key={a} className="border-t border-term-border">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  <div className="font-mono text-term-text">{a}</div>
                  <div className="text-[9px] text-term-text-mute">open {fmt(pts[0].opening_cash, 0)} · residual {pts[0].estimated_residual_p10}/{pts[0].estimated_residual_p50}/{pts[0].estimated_residual_p90}</div>
                </th>
                {pts.map((f) => <td key={f.period_date} className={`py-1 text-right font-mono ${f.known_net_flow < 0 ? "text-term-down" : "text-term-text-dim"}`}>{f.known_net_flow > 0 ? "+" : ""}{fmt(f.known_net_flow, 0)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-term-text-mute">Known net flows per day ($mm). Residual bands are p10/p50/p90 per day. The selected case drives the run, and opening cash is rebased consistently.</p>
    </div>
  );
}

/** LP allocation lines grouped by purchase date. Explicitly not an execution blotter. */
export function AllocationTable({ result, types }: { result: MmktRunResult; types: Map<string, string> }) {
  const lines = result.currency_results.flatMap((cr) => cr.allocations);
  const dates = [...new Set(lines.map((l) => l.purchase_date))].sort();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[10px]">
        <caption className="sr-only">LP allocation lines (continuous relaxation, not execution-ready)</caption>
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.1em] text-term-text-mute">
            <th scope="col" className="pb-1 text-left font-semibold">Purchase</th>
            <th scope="col" className="pb-1 text-left font-semibold">Candidate</th>
            <th scope="col" className="pb-1 text-left font-semibold">Account</th>
            <th scope="col" className="pb-1 text-left font-semibold">Matures</th>
            <th scope="col" className="pb-1 text-right font-semibold">Amount $mm</th>
            <th scope="col" className="pb-1 text-right font-semibold">mm yield %</th>
            <th scope="col" className="pb-1 text-right font-semibold">Net return %</th>
          </tr>
        </thead>
        <tbody>
          {dates.flatMap((d) => lines.filter((l) => l.purchase_date === d).map((l, i) => {
            const type = types.get(l.candidate_id);
            const fam = type ? FAMILY_META[FAMILY_OF[type as keyof typeof FAMILY_OF]] : null;
            return (
              <tr key={`${l.candidate_id}-${l.account_id}-${l.purchase_date}`} className={i === 0 ? "border-t border-term-border" : ""}>
                <td className="py-0.5 font-mono text-term-text-mute">{i === 0 ? d : ""}</td>
                <th scope="row" className="py-0.5 text-left font-normal"><span className="flex items-center gap-1.5">{fam && <span className="h-2 w-2 rounded-sm" style={{ background: fam.color }} aria-hidden />}<span className="font-mono text-term-text">{l.candidate_id}</span></span></th>
                <td className="py-0.5 font-mono text-term-text-dim">{l.account_id}</td>
                <td className="py-0.5 font-mono text-term-text-mute">{l.maturity_date}</td>
                <td className="py-0.5 text-right font-mono text-term-text">{fmt(l.amount, 2)}</td>
                <td className="py-0.5 text-right font-mono text-term-text-dim">{l.mm_yield_pct.toFixed(4)}</td>
                <td className="py-0.5 text-right font-mono text-term-text-dim">{l.modeled_net_return_pct.toFixed(4)}</td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

export function Lineage({ result }: { result: MmktRunResult }) {
  const cr = result.currency_results[0];
  const items: [string, string][] = [
    ["Run ID", result.run.run_id],
    ["Request hash", result.run.request_hash],
    ["Rate snapshot hash", result.run.rate_snapshot_hash],
    ["Rate source", result.run.rate_source === "sim" ? `SIM · ${result.run.sim_set_id}` : "Gold"],
    ["Rates as of", result.run.rate_as_of_date],
    ["Forecast case", result.run.cash_forecast_case],
    ["Model", result.run.model_family.replace(/_/g, " ")],
    ["Solver", cr ? `${cr.backend} ${cr.backend_version} · ${cr.iterations ?? "—"} iterations` : "—"],
    ["Received", result.run.received_at],
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[10px]">
      {items.map(([k, v]) => (<Fragment key={k}><dt className="text-term-text-mute">{k}</dt><dd className="truncate text-right font-mono text-term-text" title={v}>{v}</dd></Fragment>))}
    </dl>
  );
}

export function VerificationBlock({ result }: { result: MmktRunResult }) {
  return (
    <ul className="space-y-1.5">
      {result.currency_results.map((cr) => (
        <li key={cr.currency} className="space-y-1">
          {([
            ["Variable bounds", cr.verification.max_variable_bound_violation],
            ["Constraint rows", cr.verification.max_row_violation],
            ["Integer tickets and lots", cr.verification.max_integrality_violation ?? 0],
            ["Objective reconstruction", cr.verification.objective_delta],
          ] as [string, number][]).map(([label, v]) => (
            <div key={label} className="flex items-center gap-2">
              {Math.abs(v) <= 1e-6 ? <CheckCircle2 size={13} className="shrink-0 text-term-up" aria-label="passed" /> : <XCircle size={13} className="shrink-0 text-term-down" aria-label="failed" />}
              <span className="flex-1 text-[11px] text-term-text">{label} <span className="text-term-text-mute">({cr.currency})</span></span>
              <span className="font-mono text-[9px] text-term-text-mute">max {Math.abs(v).toExponential(1)}</span>
            </div>
          ))}
        </li>
      ))}
      <li className="flex gap-2 border-t border-term-border pt-1.5 text-[10px] text-term-text-mute">
        <CircleAlert size={12} className="mt-px shrink-0 text-term-amber" /><span>The service's independent verifier passed. <span className="font-mono">execution_ready = {String(result.execution_ready)}</span> means model execution rules were checked; it does not send an order or approve a live recommendation.</span>
      </li>
    </ul>
  );
}

export function CsvButton({ csv, filename }: { csv: string; filename: string }) {
  return (
    <button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    }} className="flex items-center gap-1 rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-text-dim hover:text-term-amber">
      <Download size={11} /> CSV
    </button>
  );
}

export interface CompareRow {
  id: string; title: string; analytics: RunAnalytics | null; error: string | null; hash: string | null; simSetId: string;
  baseline: { upliftMm: number; upliftBps: number } | { reason: string } | null;
  result?: MmktRunResult | null;
}

/** Scenario comparison on separate scales: modeled return, avg invested, held at end. */
export function ScenarioCompare({ rows, activeId }: { rows: CompareRow[]; activeId: string | null }) {
  const ok = rows.filter((r) => r.analytics);
  const maxObj = Math.max(1e-9, ...ok.map((r) => r.analytics!.objective));
  const maxInv = Math.max(1e-9, ...ok.map((r) => r.analytics!.avgInvested));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[11px]">
        <caption className="sr-only">Scenario comparison</caption>
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.12em] text-term-text-mute">
            <th scope="col" className="pb-1.5 text-left font-semibold">Scenario</th>
            <th scope="col" className="pb-1.5 text-left font-semibold">Modeled net return ($k, horizon)</th>
            <th scope="col" className="pb-1.5 text-left font-semibold">Avg invested ($mm)</th>
            <th scope="col" className="pb-1.5 text-right font-semibold">Annualized</th>
            <th scope="col" className="pb-1.5 text-right font-semibold">Uplift vs baseline</th>
            <th scope="col" className="pb-1.5 text-left font-semibold pl-3">Mix</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-term-border ${r.id === activeId ? "bg-term-amber/5" : ""}`}>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <div className={r.id === activeId ? "font-semibold text-term-amber" : "text-term-text"}>{r.title}</div>
                <div className="font-mono text-[9px] text-term-text-mute">{r.simSetId.replace("SIM-MMKT-2026-10-", "SIM ")}{r.hash ? ` · ${r.hash.slice(0, 8)}` : ""}</div>
              </th>
              {r.analytics ? (
                <>
                  <td className="w-[28%] py-1.5 pr-3"><Bar value={r.analytics.objective * 1000} max={maxObj * 1000} color="bg-term-amber" label={fmt(r.analytics.objective * 1000, 1)} /></td>
                  <td className="w-[24%] py-1.5 pr-3"><Bar value={r.analytics.avgInvested} max={maxInv} color="bg-term-text/70" label={fmt(r.analytics.avgInvested, 0)} /></td>
                  <td className="py-1.5 text-right font-mono text-[10px] text-term-text-dim">{r.analytics.annualizedReturnPct.toFixed(3)}%</td>
                  <td className="py-1.5 text-right font-mono text-[10px]" title={r.baseline && "reason" in r.baseline ? r.baseline.reason : undefined}>
                    {r.baseline && "upliftMm" in r.baseline
                      ? <span className="text-term-up">+${fmt(r.baseline.upliftMm * 1000, 1)}k · {r.baseline.upliftBps.toFixed(1)}bp</span>
                      : <span className="text-term-text-mute">—</span>}
                  </td>
                  <td className="py-1.5 pl-3"><MixBar analytics={r.analytics} /></td>
                </>
              ) : (
                <td colSpan={5} className="py-1.5 text-[10px] text-term-down"><span className="inline-flex items-center gap-1"><CircleAlert size={11} />{r.error ?? "Not run"}</span></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-[8px] flex-1"><div className={`h-full rounded-r-[3px] ${color}`} style={{ width: `${Math.max(0, value / max) * 100}%` }} /></div>
      <span className="w-12 text-right font-mono text-[10px] text-term-text-dim">{label}</span>
    </div>
  );
}

export function MixBar({ analytics }: { analytics: RunAnalytics }) {
  const total = Math.max(1e-9, Object.values(analytics.byFamilyPurchases).reduce((s, v) => s + v, 0));
  const fams = Object.keys(FAMILY_META) as (keyof typeof FAMILY_META)[];
  return (
    <div className="flex h-2.5 w-36 gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label={fams.map((f) => `${FAMILY_META[f].label} ${Math.round((analytics.byFamilyPurchases[f] / total) * 100)}%`).join(", ")}>
      {fams.map((f) => analytics.byFamilyPurchases[f] > 1e-6 && <div key={f} style={{ width: `${(analytics.byFamilyPurchases[f] / total) * 100}%`, background: FAMILY_META[f].color }} title={`${FAMILY_META[f].label}: ${fmt(analytics.byFamilyPurchases[f], 0)} gross purchases`} />)}
    </div>
  );
}

/** Optimized vs the selected baseline, each a separate verified service run. */
export function BaselinePanel({ optimized, baseline, optimizedHash }: { optimized: RunAnalytics; baseline: BaselineOutcome | null; optimizedHash: string }) {
  if (!baseline) return <p className="text-[11px] text-term-text-mute">Running the baseline…</p>;
  const meta = BASELINES.find((b) => b.id === baseline.kind)!;
  if (baseline.status !== "ok") {
    return (
      <div className="flex gap-2 text-[11px]">
        <CircleAlert size={14} className="mt-px shrink-0 text-term-amber" />
        <div><div className="font-semibold text-term-text">{meta.label}: not computed</div><div className="text-term-text-dim">{baseline.reason}</div></div>
      </div>
    );
  }
  const b = baseline;
  const types = new Map(b.input.instrument_candidates.map((c) => [c.candidate_id, c.instrument_type]));
  const fams = Object.keys(FAMILY_META) as (keyof typeof FAMILY_META)[];
  const famOf = (id: string) => FAMILY_OF[types.get(id) ?? "bank_deposit"];
  const baselineMix = Object.fromEntries(fams.map((f) => [f, 0])) as Record<keyof typeof FAMILY_META, number>;
  for (const a of b.result.currency_results[0].allocations) baselineMix[famOf(a.candidate_id)] += a.amount;
  const baselineObjective = b.comparison.baselineObjective;
  const max = Math.max(optimized.objective, baselineObjective, 1e-9);
  const rows: { label: string; objective: number; hash: string; mix: Record<keyof typeof FAMILY_META, number> }[] = [
    { label: "Optimized", objective: optimized.objective, hash: optimizedHash, mix: optimized.byFamilyPurchases },
    { label: `Baseline · ${meta.label}`, objective: baselineObjective, hash: b.result.run.request_hash, mix: baselineMix },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-term-border pb-2 text-[11px]">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-term-text-mute">Uplift vs {meta.label}</span>
        <span className={`font-mono text-xl font-semibold ${b.comparison.upliftMm >= 0 ? "text-term-up" : "text-term-down"}`}>{b.comparison.upliftMm >= 0 ? "+" : "−"}${fmt(Math.abs(b.comparison.upliftMm) * 1000, 1)}k</span>
        <span className="font-mono text-[11px] text-term-text-dim">{b.comparison.upliftBps.toFixed(1)}bp annualized on the average total balance</span>
      </div>
      <table className="w-full text-[11px]">
        <caption className="sr-only">Optimized run versus baseline run</caption>
        <thead><tr className="text-[9px] uppercase tracking-[0.12em] text-term-text-mute">
          <th scope="col" className="pb-1.5 text-left font-semibold">Run</th>
          <th scope="col" className="pb-1.5 text-left font-semibold">Modeled net return ($k, horizon)</th>
          <th scope="col" className="pb-1.5 text-left font-semibold pl-3">Mix (gross purchases)</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-term-border">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <div className="text-term-text">{r.label}</div>
                <div className="font-mono text-[9px] text-term-text-mute">request {r.hash.slice(0, 12)}…</div>
              </th>
              <td className="w-[45%] py-1.5 pr-3">
                <div className="flex items-center gap-2">
                  <div className="h-[8px] flex-1"><div className={`h-full rounded-r-[3px] ${r.label === "Optimized" ? "bg-term-amber" : "bg-term-text/60"}`} style={{ width: `${(r.objective / max) * 100}%` }} /></div>
                  <span className="w-16 text-right font-mono text-[10px] text-term-text-dim">{fmt(r.objective * 1000, 1)}</span>
                </div>
              </td>
              <td className="py-1.5 pl-3">
                {Object.values(r.mix).some((v) => v > 1e-6)
                  ? <div className="flex h-2.5 w-40 gap-[2px] overflow-hidden rounded-[3px]">{fams.map((f) => r.mix[f] > 1e-6 && <div key={f} style={{ width: `${(r.mix[f] / Object.values(r.mix).reduce((s, v) => s + v, 0)) * 100}%`, background: FAMILY_META[f].color }} title={`${FAMILY_META[f].label}: ${fmt(r.mix[f], 0)}`} />)}</div>
                  : <span className="text-[10px] text-term-text-mute">all cash</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] leading-relaxed text-term-text-mute">{meta.description} Same forecast, floors and policy; only the instrument set is restricted. Both runs passed the service verifier.</p>
    </div>
  );
}
