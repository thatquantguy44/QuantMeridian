import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";

type Readiness = "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";

interface ConnectionResponse {
  binding_status: "UNCONFIGURED";
  service_health: Readiness;
  detail: string;
  model_revision: string | null;
  api_schema_version: string | null;
}
interface AllocationRow {
  fund: { id: string; name: string; fund_type: "GOVERNMENT" | "PRIME"; liquidity: "SAME_DAY" | "NEXT_DAY"; gross_7day_yield_pct: number; expense_ratio_pct: number; net_7day_yield_pct: number; aum_usd_bn: number; wam_days: number; wal_days: number; daily_liquid_assets_pct: number; weekly_liquid_assets_pct: number; treasury_assets_pct: number; repo_assets_pct: number; agency_assets_pct: number; other_assets_pct: number; snapshot_as_of: string };
  allocated_amount: number;
  portfolio_weight_pct: number;
  estimated_annual_income: number;
}
interface OptimizeResult {
  model_id: string;
  model_status: "POC_OPTIMAL";
  source_mode: "SIM";
  synthetic_mode: true;
  dataset_id: string;
  dataset_as_of: string;
  independent_verification: "NOT_PROVIDED";
  total_cash: number;
  cash_reserve_amount: number;
  investable_amount: number;
  allocated_amount: number;
  estimated_weighted_net_yield_pct: number;
  estimated_annual_income: number;
  same_day_liquidity_amount: number;
  same_day_liquidity_pct: number;
  prime_exposure_amount: number;
  prime_exposure_pct: number;
  allocations: AllocationRow[];
  checks: { check: string; passed: boolean; observed: number; required: number }[];
  limitations: string[];
}
const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const dollars2 = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
const pct = (n: number) => `${n.toFixed(2)}%`;

function tone(status: Readiness): "up" | "amber" | "down" | "blue" {
  if (status === "READY") return "up";
  if (status === "UNAVAILABLE") return "down";
  if (status === "INCOMPATIBLE") return "blue";
  return "amber";
}

export default function MoneyMarketFundOptimizer() {
  const [syntheticMode, setSyntheticMode] = useState(false);
  const [totalCash, setTotalCash] = useState("10000000");
  const [cashReserve, setCashReserve] = useState("10");
  const [minSameDay, setMinSameDay] = useState("30");
  const [maxPrime, setMaxPrime] = useState("40");
  const [maxFund, setMaxFund] = useState("25");
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const [connection, setConnection] = useState<ConnectionResponse | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);

  const refreshConnection = useCallback(async () => {
    setConnectionLoading(true);
    try {
      const response = await fetch("/api/mm-fund-optimizer/connection", { cache: "no-store" });
      const body = (await response.json()) as ConnectionResponse;
      if (response.ok && body.service_health) setConnection(body);
    } catch {
      setConnection({
        binding_status: "UNCONFIGURED",
        service_health: "UNAVAILABLE",
        detail: "External model service status could not be loaded.",
        model_revision: null,
        api_schema_version: null,
      });
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  useEffect(() => { void refreshConnection(); }, [refreshConnection]);

  async function runOptimization() {
    if (!syntheticMode) return;
    setSolving(true);
    setSolveError(null);
    try {
      const response = await fetch("/api/mm-fund-optimizer/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          synthetic_mode: true,
          total_cash: Number(totalCash),
          cash_reserve_pct: Number(cashReserve),
          min_same_day_pct: Number(minSameDay),
          max_prime_pct: Number(maxPrime),
          max_single_fund_pct: Number(maxFund),
        }),
      });
      const body = await response.json() as { ok: boolean; result?: OptimizeResult; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "Optimization could not be completed.");
      setResult(body.result);
    } catch (error) {
      setResult(null);
      setSolveError(error instanceof Error ? error.message : "Optimization could not be completed.");
    } finally {
      setSolving(false);
    }
  }

  const columns: Column<AllocationRow>[] = [
    { key: "fund", header: "Fund", render: (row) => <span className="text-term-text">{row.fund.name}</span> },
    { key: "type", header: "Type", render: (row) => <Tag tone={row.fund.fund_type === "GOVERNMENT" ? "blue" : "amber"}>{row.fund.fund_type}</Tag> },
    { key: "liquidity", header: "Liquidity", render: (row) => <Tag tone={row.fund.liquidity === "SAME_DAY" ? "up" : "neutral"}>{row.fund.liquidity.replace("_", " ")}</Tag> },
    { key: "gross", header: "Gross 7D", align: "right", render: (row) => <span className="tnum text-term-text-dim">{pct(row.fund.gross_7day_yield_pct)}</span> },
    { key: "expense", header: "Expense", align: "right", render: (row) => <span className="tnum text-term-text-mute">{pct(row.fund.expense_ratio_pct)}</span> },
    { key: "net", header: "Net 7D", align: "right", render: (row) => <span className="tnum text-term-amber">{pct(row.fund.net_7day_yield_pct)}</span> },
    { key: "aum", header: "AUM ($bn)", align: "right", render: (row) => <span className="tnum text-term-text-dim">{row.fund.aum_usd_bn.toFixed(1)}</span> },
    { key: "wamwal", header: "WAM / WAL", align: "right", render: (row) => <span className="tnum text-term-text-dim">{row.fund.wam_days} / {row.fund.wal_days}d</span> },
    { key: "liquidassets", header: "DLA / WLA", align: "right", render: (row) => <span className="tnum text-term-text-dim">{pct(row.fund.daily_liquid_assets_pct)} / {pct(row.fund.weekly_liquid_assets_pct)}</span> },
    { key: "mix", header: "UST / Repo / Agency / Other", align: "right", render: (row) => <span className="tnum text-term-text-mute" title="Illustrative asset mix: Treasury, repo, agency securities, other">{row.fund.treasury_assets_pct} / {row.fund.repo_assets_pct} / {row.fund.agency_assets_pct} / {row.fund.other_assets_pct}%</span> },
    { key: "allocation", header: "Allocation", align: "right", render: (row) => <span className="tnum font-semibold text-term-text">{dollars2(row.allocated_amount)}</span> },
    { key: "weight", header: "Weight", align: "right", render: (row) => <span className="tnum text-term-text-dim">{pct(row.portfolio_weight_pct)}</span> },
    { key: "income", header: "Est. Annual Income", align: "right", render: (row) => <span className="tnum text-term-up">{dollars2(row.estimated_annual_income)}</span> },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code="MMFO"
        title="Money Market Fund Optimizer"
        desc="Fund Allocation · Local POC Model"
        showStreaming={false}
        right={<Tag tone="amber">POC · SIM</Tag>}
      />

      <div className="m-2 border border-term-amber/50 bg-term-amber/5 px-3 py-2 text-xs leading-relaxed text-term-text-dim">
        <span className="mr-2 font-bold text-term-amber">PROOF OF CONCEPT · SYNTHETIC INPUTS</span>
        This workspace is separate from CASH treasury funding. It uses an illustrative fund universe and net-yield assumptions. Results demonstrate allocation mechanics only; they are not live offers, forecasts, or investment recommendations.
      </div>

      <div className="mx-2 mb-1 flex flex-wrap items-center justify-between gap-3 border border-term-border bg-term-panel px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-term-text">Synthetic Demo Mode</div>
          <p className="mt-1 text-2xs text-term-text-mute">Uses a fixed, fictional institutional fund snapshot for presentations. Values are illustrative, not live market quotes.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-term-text">
          <input
            type="checkbox"
            role="switch"
            aria-label="Synthetic demo mode"
            checked={syntheticMode}
            onChange={(event) => {
              const enabled = event.target.checked;
              setSyntheticMode(enabled);
              setResult(null);
              setSolveError(null);
            }}
            className="h-4 w-4 accent-term-amber"
          />
          <span>{syntheticMode ? "ON · SIM DATA" : "OFF"}</span>
        </label>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-2">
          <Panel title="Portfolio Constraints" code="INPUT">
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-term-text-dim sm:col-span-2">
                Total cash to allocate
                <span className="flex items-center border border-term-border bg-term-panel-2 px-2 text-term-text">
                  <span>$</span><input aria-label="Total cash to allocate" inputMode="decimal" type="number" min="100" step="1000" value={totalCash} onChange={(e) => { setTotalCash(e.target.value); setResult(null); setSolveError(null); }} className="w-full bg-transparent px-1 py-1.5 outline-none" />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-term-text-dim">
                Cash reserve
                <span className="flex items-center border border-term-border bg-term-panel-2 px-2 text-term-text">
                  <input aria-label="Cash reserve percentage" inputMode="decimal" type="number" min="0" max="99" step="1" value={cashReserve} onChange={(e) => { setCashReserve(e.target.value); setResult(null); setSolveError(null); }} className="w-full bg-transparent px-1 py-1.5 outline-none" /><span>%</span>
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-term-text-dim">
                Minimum same-day liquidity
                <span className="flex items-center border border-term-border bg-term-panel-2 px-2 text-term-text">
                  <input aria-label="Minimum same-day liquidity percentage" inputMode="decimal" type="number" min="0" max="100" step="1" value={minSameDay} onChange={(e) => { setMinSameDay(e.target.value); setResult(null); setSolveError(null); }} className="w-full bg-transparent px-1 py-1.5 outline-none" /><span>%</span>
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-term-text-dim">
                Maximum prime exposure
                <span className="flex items-center border border-term-border bg-term-panel-2 px-2 text-term-text">
                  <input aria-label="Maximum prime exposure percentage" inputMode="decimal" type="number" min="0" max="100" step="1" value={maxPrime} onChange={(e) => { setMaxPrime(e.target.value); setResult(null); setSolveError(null); }} className="w-full bg-transparent px-1 py-1.5 outline-none" /><span>%</span>
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-term-text-dim">
                Maximum per fund
                <span className="flex items-center border border-term-border bg-term-panel-2 px-2 text-term-text">
                  <input aria-label="Maximum per fund percentage" inputMode="decimal" type="number" min="0" max="100" step="1" value={maxFund} onChange={(e) => { setMaxFund(e.target.value); setResult(null); setSolveError(null); }} className="w-full bg-transparent px-1 py-1.5 outline-none" /><span>%</span>
                </span>
              </label>
              <button type="button" onClick={() => void runOptimization()} disabled={solving || !syntheticMode} className="self-end border border-term-amber bg-term-amber/15 px-3 py-2 text-xs font-bold uppercase text-term-amber hover:bg-term-amber/25 disabled:opacity-50">
                {solving ? "Solving…" : syntheticMode ? "Run demo optimization" : "Turn on demo mode to run"}
              </button>
            </div>
          </Panel>

          <Panel title="Future Model Repository" code="BINDING" right={<button type="button" onClick={() => void refreshConnection()} disabled={connectionLoading} className="border border-term-border px-2 py-1 text-3xs uppercase text-term-text-dim disabled:opacity-50">{connectionLoading ? "Checking…" : "Refresh"}</button>}>
            <div className="space-y-2 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={tone(connection?.service_health ?? "UNCONFIGURED")}>SERVICE {connection?.service_health ?? "UNCONFIGURED"}</Tag>
                <Tag tone="amber">BINDING {connection?.binding_status ?? "UNCONFIGURED"}</Tag>
              </div>
              <p className="text-term-text-dim">{connection?.detail ?? "Checking external model service."}</p>
              <p className="break-all font-mono text-3xs text-term-text-mute">Revision {connection?.model_revision ?? "—"} · API {connection?.api_schema_version ?? "—"}</p>
              <p className="border-t border-term-border pt-2 text-term-text-mute">The current SIM POC runs locally in the terminal API. Once the external model contract is approved, the same workspace will call that binding instead.</p>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-2">
          <Panel title="Allocation Result" code="RESULT" accent right={result ? <><Tag tone="blue">{result.model_status}</Tag><Tag tone="amber">SIM · {result.dataset_as_of}</Tag></> : undefined}>
            {solveError && <div role="alert" className="m-3 border border-term-down/40 bg-term-down/5 px-2 py-1.5 text-xs text-term-down">{solveError}</div>}
            {!result && !solveError && <div className="p-4 text-xs text-term-text-mute">{syntheticMode ? "Run the POC model to calculate a synthetic fund allocation." : "Turn on Synthetic Demo Mode to load the fictional fund snapshot and enable the local POC."}</div>}
            {result && <>
              <div className="grid grid-cols-2 divide-x divide-term-border border-b border-term-border md:grid-cols-4">
                <Stat label="Investable" value={dollars(result.investable_amount)} sub={`Reserve ${dollars(result.cash_reserve_amount)}`} />
                <Stat label="Weighted Net Yield" value={pct(result.estimated_weighted_net_yield_pct)} sub="Illustrative 7-day yield" tone="amber" />
                <Stat label="Annualized Income" value={dollars(result.estimated_annual_income)} sub="Simple run-rate estimate" tone="up" />
                <Stat label="Same-Day Liquidity" value={pct(result.same_day_liquidity_pct)} sub={dollars(result.same_day_liquidity_amount)} />
              </div>
              <div className="border-b border-term-border px-3 py-1.5 text-3xs text-term-text-mute">Dataset {result.dataset_id} · fictional share classes · snapshot {result.dataset_as_of} · portfolio mix fields are descriptive; the LP uses net yield and the stated limits.</div>
              <DataGrid columns={columns} rows={result.allocations} rowKey={(row) => row.fund.id} maxHeight="360px" initialSort={{ key: "allocation", dir: "desc" }} zebra />
              <div className="border-t border-term-border p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-term-text"><span>POC constraint checks</span><Tag tone="amber">NOT INDEPENDENTLY VERIFIED</Tag></div>
                <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                  {result.checks.map((check) => <li key={check.check} className={check.passed ? "text-term-up" : "text-term-down"}>{check.passed ? "✓" : "!"} {check.check}</li>)}
                </ul>
              </div>
              <details className="border-t border-term-border p-3 text-xs text-term-text-mute">
                <summary className="cursor-pointer font-semibold text-term-text-dim">Model limitations</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">{result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
              </details>
            </>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
