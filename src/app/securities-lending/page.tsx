
import { useMemo, useState } from "react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { Waterfall, type WaterfallStep } from "@/components/charts/Waterfall";
import { Sankey } from "@/components/charts/Sankey";
import { Donut, ProgressBar } from "@/components/charts/Radial";
import {
  getInventory,
  getLoanBook,
  getBorrowDemand,
  getSLSummary,
  getRevenueSankey,
  mergeLiveInventoryPrices,
  type InventoryRow,
  type LoanRow,
  type BorrowRequest,
  type PipelinePriceMap,
} from "@/data/securitiesLending";
import { fmtAbbr, fmtUsdAbbr, fmtSignedPct, fmtNum, fmtInt, pnlClass } from "@/lib/format";
import { TermToggleGroup } from "@/components/ui/TermToggleGroup";
import { useMarketView } from "@/lib/useMarket";
import type { SnapshotCard } from "@/data/marketPipeline";

const CLASS_TONE: Record<InventoryRow["classification"], "up" | "down" | "amber" | "neutral" | "blue" | "violet"> = {
  GC: "neutral",
  WARM: "blue",
  SPECIAL: "amber",
  HTB: "down",
};

const SOURCE_LABEL: Record<InventoryRow["source"], string> = {
  INTERNAL: "Internal",
  BENEFICIAL_OWNER: "Ben. Owner",
  PRIME: "Prime",
};

const URGENCY_TONE: Record<BorrowRequest["urgency"], "up" | "down" | "amber"> = {
  LOW: "up",
  MED: "amber",
  HIGH: "down",
};

const SOURCE_TABS: { key: "ALL" | InventoryRow["source"]; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "INTERNAL", label: "Internal" },
  { key: "BENEFICIAL_OWNER", label: "Beneficial Owner" },
  { key: "PRIME", label: "Prime" },
];

const DONUT_COLORS = ["#FF8C00", "#3B9DFF", "#2ECC71", "#A78BFA", "#22D3EE", "#EC4899", "#FFB400"];

function feeColor(bps: number): string {
  if (bps > 500) return "text-term-down";
  if (bps > 150) return "text-term-amber";
  if (bps > 50) return "text-term-blue";
  return "text-term-text-dim";
}

function utilColor(util: number): string {
  if (util >= 90) return "#FF3B3B";
  if (util >= 75) return "#FF8C00";
  return "#2ECC71";
}

export default function SecuritiesLending() {
  const rawInventory = getInventory();
  const loanBook = getLoanBook();
  const demand = getBorrowDemand();
  const summary = getSLSummary();
  const sankey = getRevenueSankey();

  const { data: marketData, source: mktSource } = useMarketView<{ cards: SnapshotCard[] }>("market");
  const priceMap: PipelinePriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of marketData?.cards ?? []) {
      if (c.price != null) m.set(c.series_id, c.price);
    }
    return m;
  }, [marketData]);
  const inventory = useMemo(() => mergeLiveInventoryPrices(rawInventory, priceMap), [rawInventory, priceMap]);
  const hasPipelinePrices = priceMap.size > 0 && mktSource !== "LOADING";
  const badgeSource = hasPipelinePrices ? mktSource : "SIM";

  const [source, setSource] = useState<"ALL" | InventoryRow["source"]>("ALL");
  const [classFilter, setClassFilter] = useState<string>("ALL");

  const inventoryRows = useMemo(() => {
    let rows = source === "ALL" ? inventory : inventory.filter((r) => r.source === source);
    if (classFilter !== "ALL") rows = rows.filter((r) => r.classification === classFilter);
    return rows;
  }, [inventory, source, classFilter]);

  // Revenue waterfall: leading Open total, one step per asset class, trailing Total.
  const waterfallSteps: WaterfallStep[] = useMemo(() => {
    const steps: WaterfallStep[] = [{ label: "Open", value: 0, total: true }];
    for (const ac of summary.byAssetClass) steps.push({ label: ac.label, value: ac.dayRevenue });
    steps.push({ label: "Total", value: summary.dayRevenue, total: true });
    return steps;
  }, [summary]);

  const byBorrowerBars = useMemo(
    () => summary.byBorrower.slice(0, 8).map((b) => ({ label: b.label, value: b.dayRevenue })),
    [summary]
  );

  const bySecurityBars = useMemo(
    () => summary.bySecurity.slice(0, 10).map((s) => ({ label: s.label, value: s.dayRevenue, color: "#3B9DFF" })),
    [summary]
  );

  const concentrationBars = useMemo(
    () => summary.byBorrower.slice(0, 8).map((b) => ({ label: b.label, value: b.share, color: "#A78BFA" })),
    [summary]
  );

  const utilCurve = useMemo(
    () => inventory.map((r) => r.utilization).sort((a, b) => b - a),
    [inventory]
  );

  const donutSegments = useMemo(
    () => summary.byAssetClass.map((ac, i) => ({ value: ac.share, color: DONUT_COLORS[i % DONUT_COLORS.length], label: ac.label })),
    [summary]
  );

  // ── Column definitions ──────────────────────────────────────────────
  const invCols: Column<InventoryRow>[] = [
    { key: "ticker", header: "Ticker", sortVal: (r) => r.ticker, render: (r) => <span className="font-semibold text-term-text">{r.ticker}</span> },
    { key: "name", header: "Name", sortVal: (r) => r.name, render: (r) => <span className="truncate text-term-text-dim">{r.name}</span> },
    { key: "class", header: "Class", sortVal: (r) => r.classification, render: (r) => <Tag tone={CLASS_TONE[r.classification]}>{r.classification}</Tag> },
    { key: "source", header: "Source", sortVal: (r) => r.source, render: (r) => <span className="text-2xs text-term-text-mute">{SOURCE_LABEL[r.source]}</span> },
    { key: "available", header: "Available", align: "right", sortVal: (r) => r.available, render: (r) => <span className="text-term-text">{fmtAbbr(r.available)}</span> },
    { key: "onLoan", header: "On Loan", align: "right", sortVal: (r) => r.onLoan, render: (r) => <span className="text-term-amber">{fmtAbbr(r.onLoan)}</span> },
    { key: "restricted", header: "Restr.", align: "right", sortVal: (r) => r.restricted, render: (r) => <span className="text-term-text-mute">{fmtAbbr(r.restricted)}</span> },
    {
      key: "util",
      header: "Utilization",
      align: "right",
      width: "120px",
      sortVal: (r) => r.utilization,
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-14">
            <ProgressBar value={r.utilization} color={utilColor(r.utilization)} height={5} />
          </div>
          <span className="tnum w-9 text-right text-2xs text-term-text-dim">{fmtNum(r.utilization, 0)}%</span>
        </div>
      ),
    },
    { key: "fee", header: "Fee", align: "right", sortVal: (r) => r.feeBps, render: (r) => <span className={feeColor(r.feeBps)}>{fmtNum(r.feeBps, 0)}</span> },
    { key: "mv", header: "Mkt Value", align: "right", sortVal: (r) => r.marketValue, render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.marketValue)}</span> },
  ];

  const loanCols: Column<LoanRow>[] = [
    { key: "id", header: "Loan ID", sortVal: (r) => r.id, render: (r) => <span className="font-mono text-2xs text-term-text-mute">{r.id}</span> },
    { key: "ticker", header: "Ticker", sortVal: (r) => r.ticker, render: (r) => <span className="font-semibold text-term-text">{r.ticker}</span> },
    { key: "borrower", header: "Borrower", sortVal: (r) => r.borrower, render: (r) => <span className="truncate text-term-text-dim">{r.borrower}</span> },
    { key: "qty", header: "Qty", align: "right", sortVal: (r) => r.qty, render: (r) => <span className="text-term-text">{fmtAbbr(r.qty)}</span> },
    { key: "notional", header: "Notional", align: "right", sortVal: (r) => r.notional, render: (r) => <span className="text-term-text">{fmtUsdAbbr(r.notional)}</span> },
    { key: "rate", header: "Rate", align: "right", sortVal: (r) => r.rateBps, render: (r) => <span className={feeColor(r.rateBps)}>{fmtNum(r.rateBps, 0)}</span> },
    { key: "coll", header: "Coll.", align: "center", sortVal: (r) => r.collateralType, render: (r) => <Tag tone={r.collateralType === "CASH" ? "up" : "violet"}>{r.collateralType === "CASH" ? "CASH" : "NON-C"}</Tag> },
    { key: "days", header: "Days", align: "right", sortVal: (r) => r.daysOpen, render: (r) => <span className="text-term-text-dim">{fmtInt(r.daysOpen)}</span> },
    { key: "rev", header: "Rev/Day", align: "right", sortVal: (r) => r.revenueDay, render: (r) => <span className="text-term-amber">{fmtUsdAbbr(r.revenueDay)}</span> },
    { key: "recall", header: "Recall", align: "center", sortVal: (r) => (r.recallable ? 1 : 0), render: (r) => (r.recallable ? <Tag tone="down">RECALL</Tag> : <span className="text-term-text-mute">—</span>) },
  ];

  const demandCols: Column<BorrowRequest>[] = [
    { key: "ticker", header: "Ticker", sortVal: (r) => r.ticker, render: (r) => <span className="font-semibold text-term-text">{r.ticker}</span> },
    { key: "name", header: "Name", sortVal: (r) => r.name, render: (r) => <span className="truncate text-term-text-dim">{r.name}</span> },
    { key: "borrower", header: "Borrower", sortVal: (r) => r.borrower, render: (r) => <span className="truncate text-term-text-dim">{r.borrower}</span> },
    { key: "qty", header: "Qty", align: "right", sortVal: (r) => r.qty, render: (r) => <span className="text-term-text">{fmtAbbr(r.qty)}</span> },
    { key: "bid", header: "Bid", align: "right", sortVal: (r) => r.bidBps, render: (r) => <span className={feeColor(r.bidBps)}>{fmtNum(r.bidBps, 0)}</span> },
    {
      key: "class",
      header: "Class",
      sortVal: (r) => r.classification,
      render: (r) => <Tag tone={r.classification === "HTB" ? "down" : r.classification === "SPECIAL" ? "amber" : r.classification === "WARM" ? "blue" : "neutral"}>{r.classification}</Tag>,
    },
    {
      key: "fill",
      header: "Fill",
      align: "right",
      width: "120px",
      sortVal: (r) => r.filled,
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-14">
            <ProgressBar value={r.filled} color={r.filled >= 90 ? "#2ECC71" : r.filled >= 60 ? "#FF8C00" : "#FF3B3B"} height={5} />
          </div>
          <span className="tnum w-9 text-right text-2xs text-term-text-dim">{fmtNum(r.filled, 0)}%</span>
        </div>
      ),
    },
    { key: "urgency", header: "Urgency", align: "center", sortVal: (r) => r.urgency, render: (r) => <Tag tone={URGENCY_TONE[r.urgency]}>{r.urgency}</Tag> },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader code="SLAB" title="Securities Lending" desc="Inventory · Loan Book · Borrow Demand · Revenue" right={<ProvenanceBadge source={badgeSource} />} />

      <KpiStrip>
        <Stat label="Day Revenue" value={fmtUsdAbbr(summary.dayRevenue)} sub={<span className={pnlClass(summary.dayChgPct)}>{fmtSignedPct(summary.dayChgPct)} vs prior</span>} tone="amber" />
        <Stat label="MTD Revenue" value={fmtUsdAbbr(summary.mtdRevenue)} sub="month to date" />
        <Stat label="YTD Revenue" value={fmtUsdAbbr(summary.ytdRevenue)} sub="year to date" />
        <Stat label="Utilization" value={`${fmtNum(summary.utilization, 1)}%`} sub={`${fmtInt(summary.activeLoans)} active loans`} tone={summary.utilization >= 90 ? "down" : summary.utilization >= 75 ? "amber" : "up"} />
        <Stat label="Active Loans" value={fmtInt(summary.activeLoans)} sub={`avg ${fmtNum(summary.avgFeeBps, 0)}bps`} />
        <Stat label="HTB Count" value={fmtInt(summary.htbCount)} sub={<span>{fmtUsdAbbr(summary.specialsBalance)} specials</span>} tone="down" />
      </KpiStrip>

      <div className="flex flex-col gap-2 p-2">
        {/* Inventory + Loan Book */}
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Panel
            title="Inventory"
            code="INVN"
            toolbar={<><TermToggleGroup label="Source" value={source} onChange={(v) => setSource(v as typeof source)} options={SOURCE_TABS.map((t) => ({ value: t.key, label: t.label }))} size="sm" /><TermToggleGroup label="Class" value={classFilter} onChange={setClassFilter} options={[{ value: "ALL", label: "All" }, { value: "GC", label: "GC" }, { value: "WARM", label: "Warm" }, { value: "SPECIAL", label: "Special" }, { value: "HTB", label: "HTB" }]} size="sm" /></>}
            right={<span className="text-3xs text-term-text-mute">{inventoryRows.length} items</span>}
          >
            <DataGrid columns={invCols} rows={inventoryRows} rowKey={(r) => `${r.ticker}-${r.source}`} maxHeight="360px" initialSort={{ key: "mv", dir: "desc" }} zebra />
          </Panel>

          <Panel title="Loan Book — Open Positions" code="LOAN" right={<Tag tone="amber">{fmtInt(loanBook.length)} loans</Tag>}>
            <DataGrid columns={loanCols} rows={loanBook} rowKey={(r) => r.id} maxHeight="360px" initialSort={{ key: "rev", dir: "desc" }} zebra />
          </Panel>
        </div>

        {/* Borrow Demand */}
        <Panel title="Borrow Demand — Hard-to-Borrow & Specials" code="DMND" accent right={<Tag tone="down">{demand.filter((d) => d.urgency === "HIGH").length} HIGH</Tag>}>
          <DataGrid columns={demandCols} rows={demand} rowKey={(r) => `${r.ticker}-${r.borrower}`} maxHeight="300px" initialSort={{ key: "bid", dir: "desc" }} zebra />
        </Panel>

        {/* Revenue Analytics */}
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
          <Panel title="Revenue Trend — Trailing 60d" code="REVT" className="xl:col-span-2">
            <div className="p-2">
              <LineChart height={170} yFmt={(n) => fmtAbbr(n)} series={[{ name: "Daily Revenue", data: summary.revenueTrend, color: "#FF8C00", area: true }]} />
            </div>
          </Panel>

          <Panel title="Revenue by Asset Class" code="REVAC">
            <div className="flex items-center justify-center gap-3 p-3">
              <Donut segments={donutSegments} size={130} thickness={18} center={fmtUsdAbbr(summary.dayRevenue)} centerSub="day rev" />
              <div className="flex flex-col gap-1">
                {summary.byAssetClass.map((ac, i) => (
                  <div key={ac.key} className="flex items-center gap-1.5 text-2xs">
                    <span className="h-2 w-2 rounded-sm" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="w-14 truncate text-term-text-dim">{ac.label}</span>
                    <span className="tnum w-10 text-right text-term-text-mute">{fmtNum(ac.share, 0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Panel title="Revenue Bridge — by Asset Class" code="BRDG">
            <div className="p-2">
              <Waterfall steps={waterfallSteps} height={210} fmt={(n) => fmtAbbr(n)} />
            </div>
          </Panel>

          <Panel title="Revenue Flow — Beneficial Owners → Desk → Borrowers" code="FLOW">
            <div className="p-2">
              <Sankey nodes={sankey.nodes} links={sankey.links} height={210} />
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Panel title="Revenue by Borrower" code="REVB">
            <div className="p-2">
              <BarChart horizontal data={byBorrowerBars} fmt={(n) => fmtAbbr(n)} />
            </div>
          </Panel>

          <Panel title="Revenue by Security" code="REVS">
            <div className="p-2">
              <BarChart horizontal data={bySecurityBars} fmt={(n) => fmtAbbr(n)} />
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Panel title="Borrow Utilization Curve" code="UCRV">
            <div className="p-2">
              <LineChart height={170} yFmt={(n) => `${n.toFixed(0)}%`} series={[{ name: "Utilization", data: utilCurve, color: "#22D3EE", area: true }]} />
            </div>
          </Panel>

          <Panel title="Counterparty Concentration — Revenue Share" code="CONC">
            <div className="p-2">
              <BarChart horizontal data={concentrationBars} fmt={(n) => `${n.toFixed(1)}%`} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
