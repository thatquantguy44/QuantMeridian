
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Plus, X, Search, Save, Share2, Download, Image as ImageIcon, Trash2, Minus, TrendingUp, GitBranch } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Modal } from "@/components/ui/Modal";
import { ChartCanvas, type ChartCanvasHandle } from "./ChartCanvas";
import { useChartSeries } from "@/lib/charting/resolver";
import { RANGE_PRESETS, SERIES_COLORS, type ChartType, type RangePreset, type SeriesRef } from "@/lib/charting/spec";
import { TRANSFORMS, TRANSFORM_LABELS, transformFmt, type Transform } from "@/lib/charting/transforms";
import { US_RECESSIONS } from "@/lib/charting/recessions";
import { INDICATOR_PRESETS, computeIndicator, synthOHLC, type IndicatorSpec } from "@/lib/charting/indicators";
import { STUDY_PRESETS, computeStudy, monthlySeasonality, type StudySpec } from "@/lib/charting/studies";
import { getPresetsForStudio, getSavedTemplates, saveTemplate, deleteTemplate, fetchRemoteTemplates, saveTemplateRemote, deleteTemplateRemote, mergeTemplates, templateToURL, urlToChartState, type ChartTemplate } from "@/lib/charting/templates";
import { type Drawing, type DrawMode } from "@/lib/charting/drawings";
import type { CatalogItem } from "@/data/chartCatalog";

const CHART_TYPES: ChartType[] = ["line", "area", "candles"];

const MAX_SERIES = 6;

interface ChartStudioProps {
  code: string;
  title: string;
  desc: string;
  catalog: CatalogItem[];
  defaultRefs: SeriesRef[];
  allowChartType?: boolean;
  defaultChartType?: ChartType;
  recessionShading?: boolean;
  allowIndicators?: boolean;
}

function refKey(r: SeriesRef): string {
  return `${r.source}:${r.id}`;
}

export function ChartStudio({ code, title, desc, catalog, defaultRefs, allowChartType = false, defaultChartType = "line", recessionShading = false, allowIndicators = false }: ChartStudioProps) {
  const studioId = code === "MKC" ? "MKC" : "MGC";

  const [refs, setRefs] = useState<SeriesRef[]>(defaultRefs);
  const [range, setRange] = useState<RangePreset>("2Y");
  const [transform, setTransform] = useState<Transform>("none");
  const [chartType, setChartType] = useState<ChartType>(defaultChartType);
  const [showRecession, setShowRecession] = useState(recessionShading);
  const [indicators, setIndicators] = useState<IndicatorSpec[]>([]);
  const [indMenu, setIndMenu] = useState(false);
  const [studies, setStudies] = useState<StudySpec[]>([]);
  const [studyMenu, setStudyMenu] = useState(false);
  const [showSeasonality, setShowSeasonality] = useState(false);
  const [query, setQuery] = useState("");

  // Phase 4: templates, drawings, export
  const [tplMenu, setTplMenu] = useState(false);
  const [saveDialog, setSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [drawMenu, setDrawMenu] = useState(false);

  const canvasRef = useRef<ChartCanvasHandle>(null);

  // Restore chart state from URL param on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const state = params.get("chart");
    if (!state) return;
    const parsed = urlToChartState(state);
    if (!parsed) return;
    setRefs(parsed.refs);
    setRange(parsed.range);
    setTransform(parsed.transform);
    setChartType(parsed.chartType);
    if (parsed.indicators?.length) setIndicators(parsed.indicators);
    if (parsed.studies?.length) setStudies(parsed.studies);
    if (parsed.showRecession != null) setShowRecession(parsed.showRecession);
    if (parsed.showSeasonality) setShowSeasonality(parsed.showSeasonality);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { axis, series, loading, failed } = useChartSeries(refs, range, transform);

  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    return catalog
      .filter((c) => c.id.toUpperCase().includes(q) || c.label.toUpperCase().includes(q) || (c.sub ?? "").toUpperCase().includes(q))
      .slice(0, 8);
  }, [query, catalog]);

  const addRef = (item: CatalogItem) => {
    const ref: SeriesRef = { source: item.source, id: item.id, assetClass: item.assetClass };
    setRefs((prev) => (prev.some((r) => refKey(r) === refKey(ref)) || prev.length >= MAX_SERIES ? prev : [...prev, ref]));
    setQuery("");
  };
  const removeRef = (r: SeriesRef) => setRefs((prev) => prev.filter((x) => refKey(x) !== refKey(r)));

  const addIndicator = (spec: Omit<IndicatorSpec, "id">) => {
    setIndicators((prev) => [...prev, { ...spec, id: `${spec.type}-${Math.random().toString(36).slice(2, 7)}` }]);
    setIndMenu(false);
  };
  const removeIndicator = (id: string) => setIndicators((prev) => prev.filter((i) => i.id !== id));

  const addStudy = (spec: Omit<StudySpec, "id">) => {
    setStudies((prev) => [...prev, { ...spec, id: `${spec.type}-${Math.random().toString(36).slice(2, 7)}` }]);
    setStudyMenu(false);
  };
  const removeStudy = (id: string) => setStudies((prev) => prev.filter((s) => s.id !== id));

  // Templates
  const presets = useMemo(() => getPresetsForStudio(studioId), [studioId]);
  const [savedTemplates, setSavedTemplates] = useState<ChartTemplate[]>([]);

  /** localStorage templates for this studio (the always-available offline tier). */
  const localTemplates = useCallback(
    () => getSavedTemplates().filter((t) => t.studio === studioId || t.studio === "both"),
    [studioId]
  );

  // Render local templates instantly, then merge in any DB-backed ones (shared
  // across devices when MACRO_DB_URL is configured) — render-local-then-upgrade.
  useEffect(() => {
    let alive = true;
    setSavedTemplates(localTemplates());
    fetchRemoteTemplates(studioId).then((remote) => {
      if (alive && remote.length) setSavedTemplates((cur) => mergeTemplates(cur, remote));
    });
    return () => { alive = false; };
  }, [studioId, localTemplates]);

  const applyTemplate = useCallback((t: ChartTemplate) => {
    setRefs(t.refs);
    setRange(t.range);
    setTransform(t.transform);
    setChartType(t.chartType);
    setIndicators(t.indicators);
    setStudies(t.studies);
    if (t.showRecession != null) setShowRecession(t.showRecession);
    if (t.showSeasonality != null) setShowSeasonality(t.showSeasonality);
    setTplMenu(false);
  }, []);

  const handleSave = () => {
    if (!saveName.trim()) return;
    const t: ChartTemplate = {
      id: `user-${Date.now()}`,
      name: saveName.trim(),
      desc: `${refs.map((r) => r.id).join(", ")} — ${range}`,
      studio: studioId,
      refs, range, transform, chartType, indicators, studies,
      showRecession, showSeasonality,
    };
    saveTemplate(t);
    saveTemplateRemote(t); // best-effort shared persistence
    setSavedTemplates(localTemplates());
    setSaveDialog(false);
    setSaveName("");
  };

  const handleDelete = (id: string) => {
    deleteTemplate(id);
    deleteTemplateRemote(id);
    setSavedTemplates((cur) => cur.filter((t) => t.id !== id));
  };

  const handleShare = () => {
    const url = templateToURL({ refs, range, transform, chartType, indicators, studies, showRecession, showSeasonality });
    const base = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
    const full = `${base}?chart=${url}`;
    navigator.clipboard.writeText(full).then(() => {
      setShareNotice("Link copied!");
      setTimeout(() => setShareNotice(null), 2000);
    }).catch(() => {
      setShareNotice("Copy failed");
      setTimeout(() => setShareNotice(null), 2000);
    });
  };

  // Export PNG
  const exportPNG = useCallback(() => {
    const svg = canvasRef.current?.getSvgElement();
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // set background
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", "#0A0A0C");
    clone.insertBefore(bg, clone.firstChild);
    const data = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([data], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth * 2;
      canvas.height = img.naturalHeight * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `${code}-chart-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    };
    img.src = url;
  }, [code]);

  // Export CSV
  const exportCSV = useCallback(() => {
    if (!axis.length || !series.length) return;
    const header = ["Date", ...series.map((s) => byId.get(s.ref.id)?.label ?? s.ref.id)].join(",");
    const rows = axis.map((d, i) =>
      [d, ...series.map((s) => s.values[i] == null ? "" : String(s.values[i]))].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${code}-data-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [axis, series, code, byId]);

  // Drawings
  const addDrawing = useCallback((d: Drawing) => {
    setDrawings((prev) => [...prev, d]);
    setDrawMode("none");
  }, []);
  const clearDrawings = () => setDrawings([]);

  const allSeries = series.map((s, i) => ({
    label: byId.get(s.ref.id)?.label ?? s.label,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    values: s.values,
    area: chartType === "area",
  }));

  const primary = series[0];
  const indResults = useMemo(
    () => indicators.map((spec, i) => computeIndicator(spec, primary?.values ?? [], i)),
    [indicators, primary?.values]
  );
  const overlays = indResults.flatMap((r) => r.overlays);

  const studyPanes = useMemo(() => {
    const vals = series.map((s) => s.values);
    const labels = series.map((s) => byId.get(s.ref.id)?.label ?? s.label);
    return studies.map((spec) => computeStudy(spec, vals, labels)).filter((p): p is NonNullable<typeof p> => p != null);
  }, [studies, series, byId]);

  const oscPanes = [...indResults.flatMap((r) => r.oscPanes), ...studyPanes];

  const seasonality = useMemo(
    () => (showSeasonality && primary ? monthlySeasonality(axis, primary.values) : null),
    [showSeasonality, axis, primary]
  );
  const seasonalityMax = seasonality ? Math.max(0.01, ...seasonality.map((m) => Math.abs(m.mean ?? 0))) : 1;

  const candles = chartType === "candles" && primary ? synthOHLC(primary.values) : undefined;
  const mainSeries = candles ? allSeries.slice(1) : allSeries;

  const yFmt = transformFmt(transform);
  // Include failed refs' sources (e.g. ERR) so the provenance is visible even
  // when those series dropped out of `series` for contributing no axis points.
  const sources = Array.from(new Set([...series.map((s) => s.source), ...failed.map((f) => f.source)]));
  const showUnavailable = !loading && failed.length > 0;
  const failedLabels = failed.map((f) => byId.get(f.ref.id)?.label ?? f.label).join(", ");

  const btn = "rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide transition-colors";

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        code={code}
        title={title}
        desc={desc}
        right={
          <span className="flex items-center gap-1">
            {sources.map((s) => (
              <ProvenanceBadge key={s} source={s} />
            ))}
          </span>
        }
      />

      <KpiStrip>
        <Stat label="Series" value={refs.length} sub={`of ${MAX_SERIES} max`} tone="amber" />
        <Stat label="Range" value={range} sub="lookback" />
        <Stat label="Transform" value={TRANSFORM_LABELS[transform]} sub={transform === "none" ? "native units" : "applied"} tone={transform === "none" ? "neutral" : "amber"} />
        <Stat label="Points" value={axis.length} sub={loading ? "loading…" : "observations"} tone={axis.length ? "up" : "neutral"} />
        <Stat label="Sources" value={sources.join(", ") || "—"} sub="provenance" />
      </KpiStrip>

      {showUnavailable && (
        <div
          className="mx-2 mt-2 flex items-center gap-2 rounded-sm border border-term-down/40 bg-term-down/10 px-2 py-1 text-3xs font-semibold text-term-down"
          title="The chart series endpoint (/api/chart/series) did not return data. On a static-only deploy there is no API layer — serve via `npm start`. Otherwise the upstream source is unavailable."
          role="status"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-term-down" />
          DATA UNAVAILABLE
          <span className="font-normal text-term-text-dim">
            {series.length === 0 ? "no series resolved" : "partial"} — {failedLabels}
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-term-border bg-term-panel px-3 py-1.5">
        {/* Series search */}
        <div className="relative">
          <div className="flex items-center gap-1 rounded-sm border border-term-border bg-term-panel-2 px-2">
            <Search className="h-3 w-3 text-term-text-mute" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add series…"
              className="h-6 w-40 bg-transparent text-2xs text-term-text outline-none placeholder:text-term-text-mute"
            />
          </div>
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-auto rounded-sm border border-term-border bg-term-panel shadow-xl">
              {results.map((c) => (
                <button
                  key={`${c.source}:${c.id}`}
                  onClick={() => addRef(c)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-2xs hover:bg-term-panel-3"
                >
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-3 w-3 text-term-amber" />
                    <span className="w-12 font-semibold text-term-text">{c.label}</span>
                    <span className="truncate text-term-text-mute">{c.sub}</span>
                  </span>
                  <Tag tone="neutral">{c.group}</Tag>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Range presets */}
        <div className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((r) => (
            <button key={r} onClick={() => setRange(r)} className={clsx(btn, range === r ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
              {r}
            </button>
          ))}
        </div>

        {/* Transform */}
        <select
          value={transform}
          onChange={(e) => setTransform(e.target.value as Transform)}
          className="h-6 rounded-sm border border-term-border bg-term-panel-2 px-1.5 text-2xs text-term-text outline-none focus:border-term-amber"
        >
          {TRANSFORMS.map((t) => (
            <option key={t} value={t}>{TRANSFORM_LABELS[t]}</option>
          ))}
        </select>

        {/* Recession shading (macro) */}
        {recessionShading && (
          <button onClick={() => setShowRecession((v) => !v)} className={clsx(btn, showRecession ? "border-term-amber bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
            Recessions
          </button>
        )}

        {/* Chart type (MKC) */}
        {allowChartType && (
          <div className="flex gap-1">
            {CHART_TYPES.map((t) => (
              <button key={t} onClick={() => setChartType(t)} className={clsx(btn, chartType === t ? "border-term-amber bg-term-amber text-black" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Indicators */}
        {allowIndicators && (
          <div className="relative">
            <button onClick={() => setIndMenu((v) => !v)} className={clsx(btn, indMenu ? "border-term-amber bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
              + Indicator
            </button>
            {indMenu && (
              <div className="absolute z-20 mt-1 w-44 overflow-hidden rounded-sm border border-term-border bg-term-panel shadow-xl">
                {INDICATOR_PRESETS.map((p) => (
                  <button key={p.label} onClick={() => addIndicator(p.spec)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs text-term-text hover:bg-term-panel-3">
                    <Plus className="h-3 w-3 text-term-amber" />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Studies */}
        <div className="relative">
          <button onClick={() => setStudyMenu((v) => !v)} className={clsx(btn, studyMenu ? "border-term-amber bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
            + Study
          </button>
          {studyMenu && (
            <div className="absolute z-20 mt-1 w-52 overflow-hidden rounded-sm border border-term-border bg-term-panel shadow-xl">
              {STUDY_PRESETS.map((p) => {
                const disabled = p.needsPair && refs.length < 2;
                return (
                  <button
                    key={p.label}
                    onClick={() => !disabled && addStudy(p.spec)}
                    disabled={disabled}
                    title={disabled ? "Add a second series (S1, S2) first" : undefined}
                    className={clsx("flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs", disabled ? "cursor-not-allowed text-term-text-mute/50" : "text-term-text hover:bg-term-panel-3")}
                  >
                    <Plus className="h-3 w-3 text-term-amber" />
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Seasonality */}
        <button onClick={() => setShowSeasonality((v) => !v)} className={clsx(btn, showSeasonality ? "border-term-amber bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
          Seasonality
        </button>

        <div className="h-4 w-px bg-term-border" />

        {/* Drawing tools */}
        <div className="relative">
          <button onClick={() => setDrawMenu((v) => !v)} className={clsx(btn, drawMode !== "none" ? "border-term-amber bg-term-amber/15 text-term-amber" : "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
            Draw
          </button>
          {drawMenu && (
            <div className="absolute z-20 mt-1 w-44 overflow-hidden rounded-sm border border-term-border bg-term-panel shadow-xl">
              <button onClick={() => { setDrawMode("hline"); setDrawMenu(false); }} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs text-term-text hover:bg-term-panel-3">
                <Minus className="h-3 w-3 text-term-amber" /> Horizontal Level
              </button>
              <button onClick={() => { setDrawMode("trendline"); setDrawMenu(false); }} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs text-term-text hover:bg-term-panel-3">
                <TrendingUp className="h-3 w-3 text-term-amber" /> Trend Line
              </button>
              <button onClick={() => { setDrawMode("fib"); setDrawMenu(false); }} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs text-term-text hover:bg-term-panel-3">
                <GitBranch className="h-3 w-3 text-term-amber" /> Fibonacci Retracement
              </button>
              {drawings.length > 0 && (
                <>
                  <div className="border-t border-term-border" />
                  <button onClick={() => { clearDrawings(); setDrawMenu(false); }} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs text-term-down hover:bg-term-panel-3">
                    <Trash2 className="h-3 w-3" /> Clear All Drawings
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Templates */}
        <div className="relative">
          <button onClick={() => setTplMenu((v) => !v)} className={clsx(btn, "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")}>
            Templates
          </button>
          {tplMenu && (
            <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-sm border border-term-border bg-term-panel shadow-xl">
              <div className="border-b border-term-border px-2 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute">Presets</div>
              {presets.map((p) => (
                <button key={p.id} onClick={() => applyTemplate(p)} className="flex w-full items-center gap-2 px-2 py-1 text-left text-2xs hover:bg-term-panel-3">
                  <span className="font-semibold text-term-amber">{p.name}</span>
                  <span className="truncate text-term-text-mute">{p.desc}</span>
                </button>
              ))}
              {savedTemplates.length > 0 && (
                <>
                  <div className="border-b border-term-border px-2 py-1 text-3xs font-semibold uppercase tracking-wider text-term-text-mute">Saved</div>
                  {savedTemplates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between px-2 py-1 text-2xs hover:bg-term-panel-3">
                      <button onClick={() => applyTemplate(t)} className="flex-1 text-left">
                        <span className="font-semibold text-term-text">{t.name}</span>
                        <span className="ml-2 truncate text-term-text-mute">{t.desc}</span>
                      </button>
                      <button onClick={() => handleDelete(t.id)} className="ml-1 text-term-text-mute hover:text-term-down" title="Delete">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Save */}
        <button onClick={() => setSaveDialog(true)} className={clsx(btn, "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")} title="Save as template">
          <Save className="inline h-3 w-3" />
        </button>

        {/* Share */}
        <div className="relative">
          <button onClick={handleShare} className={clsx(btn, "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")} title="Copy share link">
            <Share2 className="inline h-3 w-3" />
          </button>
          {shareNotice && (
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-term-up px-2 py-0.5 text-3xs font-semibold text-black">
              {shareNotice}
            </div>
          )}
        </div>

        {/* Export */}
        <button onClick={exportPNG} className={clsx(btn, "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")} title="Export PNG">
          <ImageIcon className="inline h-3 w-3" />
        </button>
        <button onClick={exportCSV} className={clsx(btn, "border-term-border bg-term-panel-2 text-term-text-mute hover:text-term-text")} title="Export CSV">
          <Download className="inline h-3 w-3" />
        </button>

        {/* Active indicator + study chips */}
        {indicators.map((ind) => (
          <span key={ind.id} className="flex items-center gap-1 rounded-sm border border-term-border bg-term-panel-2 px-1.5 py-0.5 text-3xs text-term-text-dim">
            {ind.type.toUpperCase()}{ind.length ? ` ${ind.length}` : ind.type === "macd" ? ` ${ind.fast}/${ind.slow}/${ind.signal}` : ""}
            <button onClick={() => removeIndicator(ind.id)} className="text-term-text-mute hover:text-term-down" aria-label="remove indicator">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {studies.map((s) => (
          <span key={s.id} className="flex items-center gap-1 rounded-sm border border-term-amber/40 bg-term-amber/5 px-1.5 py-0.5 text-3xs text-term-amber">
            {s.type.replace("_", " ").toUpperCase()}{s.window ? ` ${s.window}` : ""}
            <button onClick={() => removeStudy(s.id)} className="text-term-text-mute hover:text-term-down" aria-label="remove study">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {drawings.length > 0 && (
          <span className="text-3xs text-term-text-mute">{drawings.length} drawing{drawings.length > 1 ? "s" : ""}</span>
        )}
        {drawMode !== "none" && (
          <span className="flex items-center gap-1 rounded-sm border border-term-amber/40 bg-term-amber/10 px-1.5 py-0.5 text-3xs text-term-amber">
            Click chart to place {drawMode === "hline" ? "level" : drawMode === "trendline" ? "endpoints" : "swing points"}
            <button onClick={() => setDrawMode("none")} className="text-term-text-mute hover:text-term-down" aria-label="cancel draw">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        )}
      </div>

      {/* Save dialog */}
      <Modal open={saveDialog} onClose={() => setSaveDialog(false)} label="Save chart template" className="w-80 rounded border border-term-border bg-term-panel p-4 shadow-xl">
        <div className="mb-3 text-sm font-semibold text-term-text">Save Template</div>
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Template name…"
          className="mb-3 w-full rounded-sm border border-term-border bg-term-panel-2 px-2 py-1.5 text-xs text-term-text outline-none focus:border-term-amber"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <div className="flex justify-end gap-2">
          <button onClick={() => setSaveDialog(false)} className="rounded-sm border border-term-border px-3 py-1 text-2xs text-term-text-mute hover:text-term-text">Cancel</button>
          <button onClick={handleSave} disabled={!saveName.trim()} className="rounded-sm border border-term-amber bg-term-amber px-3 py-1 text-2xs font-semibold text-black disabled:opacity-40">Save</button>
        </div>
      </Modal>

      <div className="flex flex-1 flex-col gap-2 p-2">
        <Panel title="Chart" code={code} accent>
          <div className="p-2">
            <ChartCanvas ref={canvasRef} axis={axis} series={mainSeries} candles={candles} overlays={overlays} oscPanes={oscPanes} height={candles || overlays.length ? 340 : 360} yFmt={yFmt} recessions={showRecession ? US_RECESSIONS : undefined} drawings={drawings} drawMode={drawMode} onDrawingAdd={addDrawing} />
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-1.5 border-t border-term-border px-2 py-1.5">
            {series.map((s, i) => (
              <span key={refKey(s.ref)} className="flex items-center gap-1 rounded-sm border border-term-border bg-term-panel-2 px-1.5 py-0.5 text-2xs">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                <span className="font-semibold text-term-text">{byId.get(s.ref.id)?.label ?? s.ref.id}</span>
                <ProvenanceBadge source={s.source} />
                <button onClick={() => removeRef(s.ref)} className="text-term-text-mute hover:text-term-down" aria-label="remove">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {refs.length === 0 && <span className="text-2xs text-term-text-mute">Add a series to begin.</span>}
          </div>
        </Panel>

        {/* Seasonality */}
        {seasonality && (
          <Panel title={`Seasonality — ${primary ? byId.get(primary.ref.id)?.label ?? primary.ref.id : ""}`} code="SEAS">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 sm:grid-cols-3 lg:grid-cols-4">
              {seasonality.map((m) => {
                const v = m.mean ?? 0;
                const w = Math.min(1, Math.abs(v) / seasonalityMax) * 100;
                const pos = v >= 0;
                return (
                  <div key={m.month} className="grid grid-cols-[28px_1fr_52px] items-center gap-2 text-2xs">
                    <span className="font-semibold text-term-text-dim">{m.month}</span>
                    <div className="relative h-3 bg-term-panel-3">
                      <div className={clsx("absolute top-0 h-full", pos ? "left-1/2 bg-term-up/60" : "right-1/2 bg-term-down/60")} style={{ width: `${w / 2}%` }} />
                      <div className="absolute left-1/2 top-0 h-full w-px bg-term-border" />
                    </div>
                    <span className={clsx("tnum text-right", m.mean == null ? "text-term-text-mute" : pos ? "text-term-up" : "text-term-down")}>
                      {m.mean == null ? "—" : `${pos ? "+" : ""}${v.toFixed(2)}%`}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-term-border px-3 py-1 text-3xs text-term-text-mute">
              Average month-over-month % change by calendar month over the visible range.
            </div>
          </Panel>
        )}
      </div>

      <div className="border-t border-term-border bg-term-panel px-3 py-1.5 text-3xs text-term-text-mute">
        <span className="text-term-amber">{title}</span> — freeform charting on the terminal&apos;s existing data layer.
        {" "}Macro via FRED/econ · market via committed snapshots. ETF proxies labelled; research-grade data.
      </div>
    </div>
  );
}
