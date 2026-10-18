import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine, Check, ChevronDown, CircleAlert, FileJson2, FileSpreadsheet,
  Layers3, Plus, Search, SlidersHorizontal, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, Tag } from "@/components/ui/Panel";
import { SyntheticShowcase } from "./synthetic/SyntheticShowcase";
import { toWorkspaceConfiguration, type PenaltyConfig, type SimProblem } from "@/data/sourcesUsesSynthetic";
import {
  CONFIGURATION_STORAGE_KEY, SOURCES_USES_SCHEMA_VERSION, configurationToCsv, createEmptyConfiguration,
  createSource, createUse, newId, parseConfigurationCsv, parseConfigurationJson, ruleFor,
  setCompatibilityRule, touch, validateConfiguration,
  type CompatibilityRule, type CompatibilityStatus, type ConfigurableSource, type ConfigurableUse,
  type SourcesUsesConfiguration,
} from "@/data/sourcesUses";

type WorkspaceTab = "sources" | "uses" | "compatibility";
type PageMode = "workspace" | "synthetic";
type EditTarget = { kind: "source"; value: ConfigurableSource } | { kind: "use"; value: ConfigurableUse } | null;
const tabs: { id: WorkspaceTab; label: string }[] = [
  { id: "sources", label: "Sources" }, { id: "uses", label: "Uses" }, { id: "compatibility", label: "Compatibility" },
];

export default function SourcesUses() {
  const [configurations, setConfigurations] = useState<SourcesUsesConfiguration[]>([]);
  const [activeId, setActiveId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("sources");
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [search, setSearch] = useState("");
  const [selectedPair, setSelectedPair] = useState<{ sourceId: string; useId: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<PageMode>(() => (typeof window !== "undefined" && window.location.hash === "#synthetic" ? "synthetic" : "workspace"));
  const configuration = configurations.find((item) => item.id === activeId) ?? null;
  const issues = useMemo(() => configuration ? validateConfiguration(configuration) : [], [configuration]);
  const filteredSources = useMemo(() => configuration?.sources.filter((source) => matchesSearch(source, search)) ?? [], [configuration, search]);
  const filteredUses = useMemo(() => configuration?.uses.filter((use) => matchesSearch(use, search)) ?? [], [configuration, search]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CONFIGURATION_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((item) => validateConfiguration(item).length === 0) as SourcesUsesConfiguration[];
          setConfigurations(valid);
          setActiveId(valid[0]?.id ?? "");
        }
      }
    } catch {
      setNotice({ kind: "error", message: "Saved configurations could not be read. You can still import a file." });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(CONFIGURATION_STORAGE_KEY, JSON.stringify(configurations)); }
    catch { setNotice({ kind: "error", message: "Browser storage is full. Export this configuration to keep a copy." }); }
  }, [configurations, hydrated]);

  function updateActive(mutator: (current: SourcesUsesConfiguration) => SourcesUsesConfiguration) {
    if (!configuration) return;
    setConfigurations((items) => items.map((item) => item.id === configuration.id ? touch(mutator(item)) : item));
  }

  function createConfiguration() {
    const item = createEmptyConfiguration(`Configuration ${configurations.length + 1}`);
    setConfigurations((current) => [item, ...current]);
    setActiveId(item.id);
    setTab("sources");
    setNotice({ kind: "success", message: "New configuration created." });
  }

  function switchMode(next: PageMode) {
    setMode(next);
    try { window.history.replaceState(null, "", next === "synthetic" ? "#synthetic" : window.location.pathname + window.location.search); } catch { /* non-browser */ }
  }

  function copySyntheticToWorkspace(problem: SimProblem, scenarioTitle: string, config: PenaltyConfig) {
    const item = toWorkspaceConfiguration(problem, `SIM · ${scenarioTitle}`, newId("cfg"), config);
    setConfigurations((current) => [item, ...current]);
    setActiveId(item.id);
    setTab("sources");
    switchMode("workspace");
    setNotice({ kind: "success", message: `Copied “${item.name}” into the workspace as an editable configuration. It is tagged SIM.` });
  }

  function deleteConfiguration() {
    if (!configuration || !window.confirm(`Delete “${configuration.name}”? This only removes the browser-saved copy.`)) return;
    const remaining = configurations.filter((item) => item.id !== configuration.id);
    setConfigurations(remaining);
    setActiveId(remaining[0]?.id ?? "");
    setNotice({ kind: "success", message: "Configuration deleted from this browser." });
  }

  function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configuration || !editTarget) return;
    const form = new FormData(event.currentTarget);
    const base = editTarget.value;
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const number = (key: string) => Number(form.get(key) ?? 0);
    const optionalNumber = (key: string) => text(key) === "" ? null : Number(form.get(key));
    const common = {
      ...base,
      label: text("label"), category: text("category"), amount: number("amount"), currency: text("currency").toUpperCase(),
      legalEntity: text("legalEntity"), assetClass: text("assetClass"), tenorDays: optionalNumber("tenorDays"),
      priorityTier: number("priorityTier"), minimum: optionalNumber("minimum"), maximum: optionalNumber("maximum"),
      lotSize: optionalNumber("lotSize"), tags: text("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
    };
    if (editTarget.kind === "source") {
      const source: ConfigurableSource = {
        ...common, costBps: number("costBps"), haircutPct: number("haircutPct"),
        internality: text("internality") as ConfigurableSource["internality"],
      };
      updateActive((current) => ({ ...current, sources: current.sources.some((row) => row.id === source.id)
        ? current.sources.map((row) => row.id === source.id ? source : row) : [...current.sources, source] }));
    } else {
      const use: ConfigurableUse = {
        ...common, bidBps: number("bidBps"), policy: text("policy") as ConfigurableUse["policy"],
        shortfallPenaltyBps: number("shortfallPenaltyBps"),
      };
      updateActive((current) => ({ ...current, uses: current.uses.some((row) => row.id === use.id)
        ? current.uses.map((row) => row.id === use.id ? use : row) : [...current.uses, use] }));
    }
    setEditTarget(null);
    setNotice({ kind: "success", message: `${editTarget.kind === "source" ? "Source" : "Use"} saved.` });
  }

  function removeSource(id: string) {
    if (!configuration || !window.confirm("Remove this source and its compatibility entries?")) return;
    updateActive((current) => ({ ...current, sources: current.sources.filter((row) => row.id !== id), compatibility: current.compatibility.filter((rule) => rule.sourceId !== id) }));
  }

  function removeUse(id: string) {
    if (!configuration || !window.confirm("Remove this use and its compatibility entries?")) return;
    updateActive((current) => ({ ...current, uses: current.uses.filter((row) => row.id !== id), compatibility: current.compatibility.filter((rule) => rule.useId !== id) }));
  }

  function download(filename: string, content: string, mime: string) {
    if (!configuration) return;
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
    setNotice({ kind: "success", message: `${filename} exported.` });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = file.name.toLowerCase().endsWith(".csv") ? parseConfigurationCsv(text) : parseConfigurationJson(text);
      const item = { ...imported, id: newId("cfg"), name: imported.name || file.name.replace(/\.(json|csv)$/i, "") };
      setConfigurations((current) => [item, ...current]);
      setActiveId(item.id);
      setTab("sources");
      setNotice({ kind: "success", message: `Imported ${item.name} with ${item.sources.length} sources and ${item.uses.length} uses.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message.split("\n")[0] : "Could not import that file." });
    } finally { event.target.value = ""; }
  }

  function updateRule(sourceId: string, useId: string, status: CompatibilityStatus) {
    updateActive((current) => setCompatibilityRule(current, sourceId, useId, status));
    setSelectedPair({ sourceId, useId });
  }

  function updateRuleNote(sourceId: string, useId: string, note: string) {
    updateActive((current) => {
      const existing = ruleFor(current, sourceId, useId);
      const rest = current.compatibility.filter((rule) => !(rule.sourceId === sourceId && rule.useId === useId));
      if (existing.status !== "unspecified" || note.trim()) rest.push({ ...existing, note });
      return { ...current, compatibility: rest };
    });
  }

  const selectedRule = configuration && selectedPair ? ruleFor(configuration, selectedPair.sourceId, selectedPair.useId) : null;
  const selectedSource = configuration?.sources.find((source) => source.id === selectedPair?.sourceId);
  const selectedUse = configuration?.uses.find((use) => use.id === selectedPair?.useId);
  const configuredPairs = configuration?.compatibility.filter((rule) => rule.status !== "unspecified").length ?? 0;
  const hasBothSides = Boolean(configuration?.sources.length && configuration?.uses.length);
  const configurationReady = Boolean(hasBothSides && issues.length === 0);

  return (
    <div className="flex min-h-full flex-col bg-term-bg">
      <PageHeader code="SXU" title="Sources & Uses" desc={mode === "synthetic" ? "Synthetic optimizer proof of concept" : "Configuration workspace"} showStreaming={false}
        right={<div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-term-border" role="tablist" aria-label="Sources & Uses mode">
            {([["workspace", "Workspace"], ["synthetic", "Synthetic PoC"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => switchMode(id)}
                className={`px-2.5 py-1 text-[11px] font-medium transition ${mode === id ? "bg-term-amber text-black" : "bg-term-panel-2 text-term-text-dim hover:text-term-text"}`}>{label}</button>
            ))}
          </div>
          {mode === "synthetic" ? <Tag tone="blue">SIM</Tag> : <Tag tone="amber">SETUP ONLY</Tag>}
        </div>} />

      {mode === "synthetic" && <>
        {notice && <div className="mx-4 mt-3 rounded-md border border-term-up/25 bg-term-up/5 px-3 py-2 text-xs text-term-up lg:mx-6" role="status">{notice.message}</div>}
        <SyntheticShowcase onCopyToWorkspace={copySyntheticToWorkspace} />
      </>}

      {mode === "workspace" && <>

      <div className="border-b border-term-border bg-[radial-gradient(ellipse_at_top_left,rgba(255,140,0,0.10),transparent_48%),linear-gradient(110deg,#111315,#0b0c0d_60%)] px-4 py-4 lg:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2"><span className="rounded-md border border-term-amber/30 bg-term-amber/10 p-1.5 text-term-amber"><Layers3 size={17} /></span><span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-term-amber">Configuration studio</span></div>
            <h2 className="text-xl font-semibold tracking-tight text-term-text md:text-2xl">Shape the funding universe.</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-text-dim">Define sources, obligations, and explicit eligibility. This workspace stores configuration only; no allocations or funding recommendations are generated.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={createConfiguration} className="flex items-center gap-1.5 rounded-md border border-term-amber/50 bg-term-amber px-3 py-2 text-xs font-semibold text-black transition hover:bg-[#ffa329]"><Plus size={14} /> New configuration</button>
            <button onClick={() => importRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-term-border bg-term-panel-2 px-3 py-2 text-xs text-term-text transition hover:border-term-text-dim"><Upload size={14} /> Import</button>
            <input ref={importRef} type="file" accept=".json,.csv,application/json,text/csv" className="hidden" onChange={importFile} />
            {configuration && <div className="flex overflow-hidden rounded-md border border-term-border">
              <button onClick={() => download(`${fileSlug(configuration.name)}.json`, JSON.stringify(configuration, null, 2), "application/json")} className="flex items-center gap-1.5 bg-term-panel-2 px-3 py-2 text-xs text-term-text transition hover:bg-term-panel-3"><FileJson2 size={14} /> JSON</button>
              <span className="w-px bg-term-border" />
              <button onClick={() => download(`${fileSlug(configuration.name)}.csv`, configurationToCsv(configuration), "text/csv;charset=utf-8")} className="flex items-center gap-1.5 bg-term-panel-2 px-3 py-2 text-xs text-term-text transition hover:bg-term-panel-3"><FileSpreadsheet size={14} /> CSV</button>
            </div>}
          </div>
        </div>
      </div>

      {notice && <div className={`mx-4 mt-3 flex items-center justify-between rounded-md border px-3 py-2 text-xs lg:mx-6 ${notice.kind === "error" ? "border-term-down/30 bg-term-down/5 text-term-down" : "border-term-up/25 bg-term-up/5 text-term-up"}`} role="status"><span className="flex items-center gap-2">{notice.kind === "error" ? <CircleAlert size={14} /> : <Check size={14} />}{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notice"><X size={14} /></button></div>}

      {!configuration ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-xl border border-term-border bg-term-panel p-6 text-center shadow-2xl shadow-black/20 md:p-9">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-term-amber/25 bg-term-amber/10 text-term-amber"><SlidersHorizontal size={22} /></div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-term-amber">Start with your own inputs</p>
            <h3 className="mt-2 text-lg font-semibold text-term-text">No saved configurations yet</h3>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-term-text-dim">Create a blank workspace or import a configuration file. Nothing is prefilled with generated book data.</p>
            <div className="mt-5 flex justify-center gap-2"><button onClick={createConfiguration} className="flex items-center gap-1.5 rounded-md bg-term-amber px-3 py-2 text-xs font-semibold text-black hover:bg-[#ffa329]"><Plus size={14} /> Create configuration</button><button onClick={() => importRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-term-border bg-term-panel-2 px-3 py-2 text-xs text-term-text hover:border-term-text-dim"><Upload size={14} /> Import file</button></div>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 p-3 lg:p-5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="rounded-lg border border-term-border bg-term-panel p-3 md:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <label htmlFor="configuration-name" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.15em] text-term-text-mute">Active configuration</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 sm:w-64"><select aria-label="Choose configuration" value={activeId} onChange={(event) => { setActiveId(event.target.value); setSelectedPair(null); }} className="w-full appearance-none rounded-md border border-term-border bg-term-panel-2 px-3 py-2 pr-8 text-xs text-term-text outline-none transition focus:border-term-amber">{configurations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-2.5 text-term-text-mute" /></div>
                    <input id="configuration-name" value={configuration.name} onChange={(event) => updateActive((current) => ({ ...current, name: event.target.value }))} className="min-w-0 flex-1 rounded-md border border-term-border bg-term-panel-2 px-3 py-2 text-xs font-medium text-term-text outline-none transition placeholder:text-term-text-mute focus:border-term-amber" placeholder="Name this configuration" />
                    <input value={configuration.description} onChange={(event) => updateActive((current) => ({ ...current, description: event.target.value }))} className="min-w-0 flex-1 rounded-md border border-term-border bg-term-panel-2 px-3 py-2 text-xs text-term-text-dim outline-none transition placeholder:text-term-text-mute focus:border-term-amber" placeholder="Optional description" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-term-border pt-2 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-term-text-mute"><span className="h-1.5 w-1.5 rounded-full bg-term-up" /> Auto-saved in this browser</span>
                  <button onClick={deleteConfiguration} title="Delete configuration" aria-label="Delete configuration" className="rounded-md border border-term-border p-2 text-term-text-mute transition hover:border-term-down/50 hover:text-term-down"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-term-border rounded-lg border border-term-border bg-term-panel">
              {[{ label: "Sources", value: configuration.sources.length }, { label: "Uses", value: configuration.uses.length }, { label: "Rules", value: configuredPairs }].map((item) => <div key={item.label} className="min-w-0 px-2.5 py-2.5 sm:px-3"><div className="truncate text-[9px] uppercase tracking-wider text-term-text-mute">{item.label}</div><div className="mt-1 text-lg font-semibold leading-none text-term-text">{item.value}</div><div className="mt-1 text-[9px] text-term-text-dim">{item.label === "Rules" ? "explicit" : "configured"}</div></div>)}
            </div>
          </div>

          <div className="grid flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Panel accent className="min-h-[540px] overflow-hidden rounded-lg" bodyClassName="flex flex-1 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-term-border bg-term-panel px-3 pt-3">
                <div className="flex items-center gap-1" role="tablist" aria-label="Configuration sections">
                  {tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`relative rounded-t-md px-3 py-2 text-xs font-medium transition ${tab === item.id ? "bg-term-panel-3 text-term-amber" : "text-term-text-dim hover:text-term-text"}`}>{item.label}<span className="ml-1.5 rounded-full bg-black/20 px-1.5 py-0.5 text-[9px] text-term-text-mute">{item.id === "sources" ? configuration.sources.length : item.id === "uses" ? configuration.uses.length : `${configuredPairs}/${configuration.sources.length * configuration.uses.length}`}</span>{tab === item.id && <span className="absolute inset-x-0 bottom-0 h-px bg-term-amber" />}</button>)}
                </div>
                {tab !== "compatibility" && <div className="flex w-full items-center gap-2 pb-2 sm:w-auto"><div className="relative min-w-0 flex-1 sm:w-56"><Search size={14} className="absolute left-2.5 top-2.5 text-term-text-mute" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Filter ${tab}…`} aria-label={`Filter ${tab}`} className="w-full rounded-md border border-term-border bg-term-panel-2 py-2 pl-8 pr-2 text-[11px] text-term-text outline-none placeholder:text-term-text-mute focus:border-term-amber" /></div><button onClick={() => setEditTarget(tab === "sources" ? { kind: "source", value: createSource() } : { kind: "use", value: createUse() })} className="flex shrink-0 items-center gap-1.5 rounded-md bg-term-amber px-3 py-2 text-[11px] font-semibold text-black transition hover:bg-[#ffa329]"><Plus size={13} /> Add {tab === "sources" ? "source" : "use"}</button></div>}
              </div>

              {tab === "sources" && <SourceTable rows={filteredSources} onEdit={(source) => setEditTarget({ kind: "source", value: source })} onRemove={removeSource} />}
              {tab === "uses" && <UseTable rows={filteredUses} onEdit={(use) => setEditTarget({ kind: "use", value: use })} onRemove={removeUse} />}
              {tab === "compatibility" && <CompatibilityWorkspace configuration={configuration} selectedPair={selectedPair} selectedRule={selectedRule} selectedSource={selectedSource} selectedUse={selectedUse} onSelect={setSelectedPair} onStatus={updateRule} onNote={updateRuleNote} />}
            </Panel>

            <div className="flex flex-col gap-3">
              <Panel title="Readiness" code="SETUP" className="rounded-lg" accent>
                <div className="space-y-3 p-3">
                  <div className="flex items-start gap-2 rounded-md border border-term-amber/20 bg-term-amber/5 p-2.5"><Sparkles size={14} className="mt-0.5 shrink-0 text-term-amber" /><p className="text-[11px] leading-relaxed text-term-text-dim">This build is for configuration and eligibility setup. It does not solve, rank, or recommend allocations.</p></div>
                  <div><div className="mb-1.5 flex items-center justify-between text-[10px]"><span className="text-term-text-dim">Configuration checks</span><span className={configurationReady ? "text-term-up" : "text-term-amber"}>{issues.length ? `${issues.length} to review` : configurationReady ? "Inputs ready" : "Add inputs"}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-term-panel-3"><div className={`h-full rounded-full transition-all ${configurationReady ? "bg-term-up" : "bg-term-amber"}`} style={{ width: `${issues.length ? 35 : configurationReady ? 100 : 28}%` }} /></div></div>
                  {issues.length ? <ul className="space-y-1.5">{issues.slice(0, 4).map((issue, index) => <li key={`${issue.path}-${index}`} className="flex gap-1.5 text-[10px] text-term-text-dim"><CircleAlert size={12} className="mt-0.5 shrink-0 text-term-amber" /><span><b className="font-medium text-term-text">{issue.path}</b> · {issue.message}</span></li>)}</ul> : configurationReady ? <p className="flex items-center gap-1.5 text-[10px] text-term-text-dim"><Check size={12} className="text-term-up" /> Structure and configured values pass validation.</p> : <p className="flex items-center gap-1.5 text-[10px] text-term-text-dim"><CircleAlert size={12} className="text-term-amber" /> Add at least one source and one use to continue setup.</p>}
                </div>
              </Panel>
              <Panel title="Configuration controls" code="CFG" className="rounded-lg">
                <div className="divide-y divide-term-border px-3">
                  <InfoLine label="Schema version" value={`v${SOURCES_USES_SCHEMA_VERSION}`} />
                  <InfoLine label="Storage" value="This browser only" />
                  <InfoLine label="Compatibility" value="Explicit per pair" />
                  <InfoLine label="Source haircut" value="Configurable per source" />
                  <InfoLine label="Solver" value="Not enabled" />
                </div>
              </Panel>
              <Panel title="Haircut convention" code="MATH" className="rounded-lg">
                <div className="space-y-2.5 p-3">
                  <p className="font-mono text-[11px] text-term-amber">Eligible coverage = flow × (1 − haircut)</p>
                  <p className="text-[10px] leading-relaxed text-term-text-dim">Nominal flow consumes source capacity. Its source-level haircut reduces the amount credited toward a use.</p>
                  <p className="border-t border-term-border pt-2 text-[9px] text-term-text-mute">Values are configuration inputs; no haircut is inferred from asset class or currency.</p>
                </div>
              </Panel>
              <Panel title="Data handling" code="IO" className="rounded-lg">
                <div className="space-y-2 p-3 text-[10px] leading-relaxed text-term-text-dim"><p>JSON preserves the complete versioned configuration. CSV uses one row per source, use, and compatibility rule.</p><p>Imports are validated before they become active. Export a backup before clearing browser data.</p></div>
              </Panel>
            </div>
          </div>
        </div>
      )}
      </>}

      <RecordEditor target={editTarget} onClose={() => setEditTarget(null)} onSave={saveRecord} />
    </div>
  );
}

function SourceTable({ rows, onEdit, onRemove }: { rows: ConfigurableSource[]; onEdit: (source: ConfigurableSource) => void; onRemove: (id: string) => void }) {
  if (!rows.length) return <EmptySection title="No sources configured" detail="Add a funding pool or import a configuration. Each source has its own editable haircut and cost assumptions." />;
  return <div className="flex-1 overflow-auto"><table className="min-w-[1250px] w-full border-collapse text-left text-[10px]"><thead className="sticky top-0 z-10 bg-term-panel-2 text-[9px] uppercase tracking-wider text-term-text-mute"><tr>{["Source", "Category", "Capacity", "Cost", "Haircut", "Currency", "Legal entity", "Asset class", "Tenor", "Priority", "Min / max", "Lot", "Class", "Tags", ""].map((label) => <th key={label} className="border-b border-term-border px-2.5 py-2 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-term-border/70">{rows.map((source) => <tr key={source.id} className="group transition hover:bg-term-panel-2/70"><td className="px-2.5 py-2.5"><button onClick={() => onEdit(source)} className="text-left font-medium text-term-text transition hover:text-term-amber">{source.label || "Untitled source"}</button><div className="mt-0.5 max-w-40 truncate font-mono text-[9px] text-term-text-mute">{source.id}</div></td><td className="px-2.5 py-2.5"><Tag tone="blue">{source.category || "Uncategorized"}</Tag></td><td className="px-2.5 py-2.5 font-mono text-term-text">{formatAmount(source.amount)}</td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{source.costBps} bps</td><td className="px-2.5 py-2.5"><span className="rounded bg-term-amber/10 px-1.5 py-1 font-mono text-term-amber">{source.haircutPct}%</span></td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{source.currency}</td><td className="max-w-32 truncate px-2.5 py-2.5 text-term-text-dim">{source.legalEntity || "—"}</td><td className="max-w-32 truncate px-2.5 py-2.5 text-term-text-dim">{source.assetClass || "—"}</td><td className="px-2.5 py-2.5 text-term-text-dim">{source.tenorDays == null ? "—" : `${source.tenorDays}d`}</td><td className="px-2.5 py-2.5 text-term-text-dim">T{source.priorityTier}</td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{formatBound(source.minimum)} / {formatBound(source.maximum)}</td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{formatBound(source.lotSize)}</td><td className="px-2.5 py-2.5"><Tag tone={source.internality === "internal" ? "up" : source.internality === "external" ? "violet" : "neutral"}>{source.internality}</Tag></td><td className="max-w-40 truncate px-2.5 py-2.5 text-term-text-mute">{source.tags.join(", ") || "—"}</td><td className="px-2.5 py-2.5"><div className="flex gap-1 opacity-60 transition group-hover:opacity-100"><button onClick={() => onEdit(source)} className="rounded border border-term-border px-2 py-1 text-term-text-dim hover:border-term-amber/50 hover:text-term-amber">Edit</button><button onClick={() => onRemove(source.id)} aria-label={`Remove ${source.label}`} className="rounded p-1 text-term-text-mute hover:text-term-down"><Trash2 size={12} /></button></div></td></tr>)}</tbody></table></div>;
}

function UseTable({ rows, onEdit, onRemove }: { rows: ConfigurableUse[]; onEdit: (use: ConfigurableUse) => void; onRemove: (id: string) => void }) {
  if (!rows.length) return <EmptySection title="No uses configured" detail="Add an obligation or demand. Set priority, hard or soft treatment, and any explicit shortfall penalty." />;
  return <div className="flex-1 overflow-auto"><table className="min-w-[1250px] w-full border-collapse text-left text-[10px]"><thead className="sticky top-0 z-10 bg-term-panel-2 text-[9px] uppercase tracking-wider text-term-text-mute"><tr>{["Use", "Category", "Requirement", "Bid", "Currency", "Policy", "Penalty", "Legal entity", "Asset class", "Tenor", "Priority", "Min / max", "Lot", "Tags", ""].map((label) => <th key={label} className="border-b border-term-border px-2.5 py-2 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-term-border/70">{rows.map((use) => <tr key={use.id} className="group transition hover:bg-term-panel-2/70"><td className="px-2.5 py-2.5"><button onClick={() => onEdit(use)} className="text-left font-medium text-term-text transition hover:text-term-amber">{use.label || "Untitled use"}</button><div className="mt-0.5 max-w-40 truncate font-mono text-[9px] text-term-text-mute">{use.id}</div></td><td className="px-2.5 py-2.5"><Tag tone="blue">{use.category || "Uncategorized"}</Tag></td><td className="px-2.5 py-2.5 font-mono text-term-text">{formatAmount(use.amount)}</td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{use.bidBps} bps</td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{use.currency}</td><td className="px-2.5 py-2.5"><Tag tone={use.policy === "hard" ? "down" : "amber"}>{use.policy}</Tag></td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{use.shortfallPenaltyBps} bps</td><td className="max-w-32 truncate px-2.5 py-2.5 text-term-text-dim">{use.legalEntity || "—"}</td><td className="max-w-32 truncate px-2.5 py-2.5 text-term-text-dim">{use.assetClass || "—"}</td><td className="px-2.5 py-2.5 text-term-text-dim">{use.tenorDays == null ? "—" : `${use.tenorDays}d`}</td><td className="px-2.5 py-2.5 text-term-text-dim">T{use.priorityTier}</td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{formatBound(use.minimum)} / {formatBound(use.maximum)}</td><td className="px-2.5 py-2.5 font-mono text-term-text-dim">{formatBound(use.lotSize)}</td><td className="max-w-40 truncate px-2.5 py-2.5 text-term-text-mute">{use.tags.join(", ") || "—"}</td><td className="px-2.5 py-2.5"><div className="flex gap-1 opacity-60 transition group-hover:opacity-100"><button onClick={() => onEdit(use)} className="rounded border border-term-border px-2 py-1 text-term-text-dim hover:border-term-amber/50 hover:text-term-amber">Edit</button><button onClick={() => onRemove(use.id)} aria-label={`Remove ${use.label}`} className="rounded p-1 text-term-text-mute hover:text-term-down"><Trash2 size={12} /></button></div></td></tr>)}</tbody></table></div>;
}

function CompatibilityWorkspace({ configuration, selectedPair, selectedRule, selectedSource, selectedUse, onSelect, onStatus, onNote }: {
  configuration: SourcesUsesConfiguration; selectedPair: { sourceId: string; useId: string } | null; selectedRule: CompatibilityRule | null;
  selectedSource?: ConfigurableSource; selectedUse?: ConfigurableUse;
  onSelect: (pair: { sourceId: string; useId: string }) => void; onStatus: (sourceId: string, useId: string, status: CompatibilityStatus) => void; onNote: (sourceId: string, useId: string, note: string) => void;
}) {
  if (!configuration.sources.length || !configuration.uses.length) return <EmptySection title="Add sources and uses to build the matrix" detail="Compatibility is configured one source/use pair at a time. Unspecified pairs remain unavailable." />;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-term-border bg-term-panel-2/50 px-3 py-2"><p className="text-[10px] text-term-text-dim">Each cell is an explicit rule. Unspecified pairs remain unavailable; no eligibility is inferred.</p><div className="flex gap-1.5"><Tag tone="up">Allowed</Tag><Tag tone="down">Denied</Tag><Tag>Unspecified</Tag></div></div>
    <div className="min-h-0 flex-1 overflow-auto"><table className="w-full min-w-max border-collapse text-[10px]"><thead className="sticky top-0 z-10"><tr><th className="sticky left-0 z-20 min-w-48 border-b border-r border-term-border bg-term-panel-2 px-3 py-2 text-left text-[9px] uppercase tracking-wider text-term-text-mute">Source / use</th>{configuration.uses.map((use) => <th key={use.id} className="min-w-36 max-w-44 border-b border-term-border bg-term-panel-2 px-2 py-2 text-left"><div className="truncate font-semibold text-term-text" title={use.label}>{use.label || "Untitled use"}</div><div className="mt-0.5 truncate font-mono text-[9px] font-normal text-term-text-mute">{use.category || "Uncategorized"} · {use.currency}</div></th>)}</tr></thead><tbody>{configuration.sources.map((source) => <tr key={source.id} className="group"><th className="sticky left-0 z-[1] border-b border-r border-term-border/70 bg-term-panel px-3 py-2 text-left group-hover:bg-term-panel-2"><div className="truncate font-medium text-term-text">{source.label || "Untitled source"}</div><div className="mt-0.5 truncate font-mono text-[9px] font-normal text-term-text-mute">{source.category || "Uncategorized"} · {source.currency}</div></th>{configuration.uses.map((use) => {
      const rule = ruleFor(configuration, source.id, use.id);
      const selected = selectedPair?.sourceId === source.id && selectedPair.useId === use.id;
      return <td key={use.id} className={`border-b border-term-border/70 px-2 py-1.5 ${selected ? "bg-term-amber/5" : "group-hover:bg-term-panel-2/50"}`}><button onClick={() => { onSelect({ sourceId: source.id, useId: use.id }); onStatus(source.id, use.id, nextStatus(rule.status)); }} title={rule.note || `Set compatibility for ${source.label} → ${use.label}`} aria-label={`${source.label} to ${use.label}: ${rule.status}. Click to change.`} className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 transition ${statusClasses(rule.status)} ${selected ? "ring-1 ring-term-amber/70" : ""}`}><StatusDot status={rule.status} /><span className="font-semibold uppercase tracking-wider">{rule.status}</span></button></td>;
    })}</tr>)}</tbody></table></div>
    <div className="grid gap-0 border-t border-term-border bg-term-panel-2/50 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="border-b border-term-border p-3 md:border-b-0 md:border-r"><div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-term-text-mute">Selected pair</div>{selectedSource && selectedUse ? <><p className="text-xs font-medium text-term-text">{selectedSource.label} <span className="text-term-text-mute">→</span> {selectedUse.label}</p><p className="mt-1 text-[10px] text-term-text-dim">Haircut stays attached to the source and is not overridden in this matrix.</p></> : <p className="text-[10px] text-term-text-dim">Choose a matrix cell to add an audit note.</p>}</div>
      <div className="p-3"><label htmlFor="compatibility-note" className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.15em] text-term-text-mute">Rule note</label><textarea id="compatibility-note" disabled={!selectedSource || !selectedUse} value={selectedRule?.note ?? ""} onChange={(event) => selectedPair && onNote(selectedPair.sourceId, selectedPair.useId, event.target.value)} placeholder="Document why this pair is allowed, denied, or still unspecified…" className="min-h-14 w-full resize-y rounded-md border border-term-border bg-term-panel px-2.5 py-2 text-[10px] text-term-text outline-none placeholder:text-term-text-mute focus:border-term-amber disabled:opacity-50" /></div>
    </div>
  </div>;
}

function RecordEditor({ target, onClose, onSave }: { target: EditTarget; onClose: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  const isSource = target?.kind === "source";
  const value = target?.value;
  return <Modal open={!!target} onClose={onClose} label={isSource ? "Edit source" : "Edit use"} align="top" className="w-full max-w-3xl rounded-xl border border-term-border bg-term-panel shadow-2xl shadow-black/50">
    {target && value && <form onSubmit={onSave} className="max-h-[82vh] overflow-y-auto rounded-xl">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-term-border bg-term-panel px-4 py-3"><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-term-amber">{isSource ? "Funding input" : "Obligation input"}</p><h3 className="mt-1 text-sm font-semibold text-term-text">{isSource ? "Configure source" : "Configure use"}</h3><p className="mt-0.5 font-mono text-[9px] text-term-text-mute">{value.id}</p></div><button type="button" onClick={onClose} aria-label="Close editor" className="rounded-md p-1.5 text-term-text-mute hover:bg-term-panel-3 hover:text-term-text"><X size={15} /></button></div>
      <div className="grid gap-x-3 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Display name" required><input name="label" required defaultValue={value.label} placeholder="e.g. Treasury cash pool" className={inputClass} /></FormField>
        <FormField label="Category / type" required helper="Free-form to support custom taxonomies"><input name="category" required defaultValue={value.category} placeholder="e.g. Treasury cash" className={inputClass} /></FormField>
        <FormField label={isSource ? "Available amount" : "Required amount"} required><input name="amount" required type="number" min="0" step="any" defaultValue={value.amount} className={inputClass} /></FormField>
        <FormField label="Currency" required helper="ISO currency code"><input name="currency" required maxLength={8} defaultValue={value.currency} className={inputClass} /></FormField>
        <FormField label={isSource ? "Source cost (bps)" : "Use bid (bps)"}><input name={isSource ? "costBps" : "bidBps"} type="number" min="0" step="any" defaultValue={isSource ? (value as ConfigurableSource).costBps : (value as ConfigurableUse).bidBps} className={inputClass} /></FormField>
        {isSource ? <FormField label="Source haircut (%)" helper="Applied to every compatible flow from this source"><input name="haircutPct" type="number" min="0" max="100" step="any" required defaultValue={(value as ConfigurableSource).haircutPct} className={inputClass} /></FormField> : <FormField label="Use policy"><select name="policy" defaultValue={(value as ConfigurableUse).policy} className={inputClass}><option value="hard">Hard · full cover or infeasible</option><option value="soft">Soft · shortfall permitted</option></select></FormField>}
        {isSource ? <FormField label="Internal / external"><select name="internality" defaultValue={(value as ConfigurableSource).internality} className={inputClass}><option value="unclassified">Unclassified</option><option value="internal">Internal</option><option value="external">External</option></select></FormField> : <FormField label="Shortfall penalty (bps)"><input name="shortfallPenaltyBps" type="number" min="0" step="any" defaultValue={(value as ConfigurableUse).shortfallPenaltyBps} className={inputClass} /></FormField>}
        <FormField label="Legal entity"><input name="legalEntity" defaultValue={value.legalEntity} placeholder="Optional entity identifier" className={inputClass} /></FormField>
        <FormField label="Asset class"><input name="assetClass" defaultValue={value.assetClass} placeholder="Optional asset class" className={inputClass} /></FormField>
        <FormField label="Tenor (days)"><input name="tenorDays" type="number" min="0" step="any" defaultValue={value.tenorDays ?? ""} placeholder="No limit / unspecified" className={inputClass} /></FormField>
        <FormField label="Priority tier" helper="Lower tier number = higher priority"><input name="priorityTier" type="number" min="1" step="1" defaultValue={value.priorityTier} className={inputClass} /></FormField>
        <FormField label="Minimum ticket"><input name="minimum" type="number" min="0" step="any" defaultValue={value.minimum ?? ""} placeholder="Optional" className={inputClass} /></FormField>
        <FormField label="Maximum ticket"><input name="maximum" type="number" min="0" step="any" defaultValue={value.maximum ?? ""} placeholder="Optional" className={inputClass} /></FormField>
        <FormField label="Lot size"><input name="lotSize" type="number" min="0" step="any" defaultValue={value.lotSize ?? ""} placeholder="Optional" className={inputClass} /></FormField>
        <FormField label="Tags" helper="Comma-separated custom labels"><input name="tags" defaultValue={value.tags.join(", ")} placeholder="desk, source-system, scenario" className={inputClass} /></FormField>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-term-border bg-term-panel-2/50 px-4 py-3"><p className="text-[10px] text-term-text-mute">Inputs are saved to this browser configuration.</p><div className="flex gap-2"><button type="button" onClick={onClose} className="rounded-md border border-term-border px-3 py-2 text-[11px] text-term-text-dim hover:text-term-text">Cancel</button><button type="submit" className="flex items-center gap-1.5 rounded-md bg-term-amber px-3 py-2 text-[11px] font-semibold text-black hover:bg-[#ffa329]"><Check size={13} /> Save {isSource ? "source" : "use"}</button></div></div>
    </form>}
  </Modal>;
}

function FormField({ label, required, helper, children }: { label: string; required?: boolean; helper?: string; children: ReactNode }) { return <label className="block"><span className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-term-text-dim">{label}{required && <span className="text-term-amber">*</span>}</span>{children}{helper && <span className="mt-1 block text-[9px] leading-relaxed text-term-text-mute">{helper}</span>}</label>; }
function EmptySection({ title, detail }: { title: string; detail: string }) { return <div className="flex flex-1 items-center justify-center p-6"><div className="max-w-md text-center"><div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-term-border bg-term-panel-2 text-term-text-mute"><ArrowDownToLine size={17} /></div><h3 className="text-xs font-semibold text-term-text">{title}</h3><p className="mt-1.5 text-[10px] leading-relaxed text-term-text-dim">{detail}</p></div></div>; }
function InfoLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 py-2.5 text-[10px]"><span className="text-term-text-mute">{label}</span><span className="text-right font-medium text-term-text-dim">{value}</span></div>; }
function StatusDot({ status }: { status: CompatibilityStatus }) { return <span className={`h-1.5 w-1.5 rounded-full ${status === "allowed" ? "bg-term-up" : status === "denied" ? "bg-term-down" : "bg-term-text-mute"}`} />; }
function statusClasses(status: CompatibilityStatus) { return status === "allowed" ? "border-term-up/30 bg-term-up/10 text-term-up hover:bg-term-up/15" : status === "denied" ? "border-term-down/30 bg-term-down/10 text-term-down hover:bg-term-down/15" : "border-term-border bg-term-panel-2 text-term-text-mute hover:border-term-text-mute hover:text-term-text-dim"; }
function nextStatus(status: CompatibilityStatus): CompatibilityStatus { return status === "unspecified" ? "allowed" : status === "allowed" ? "denied" : "unspecified"; }
function matchesSearch(value: ConfigurableSource | ConfigurableUse, query: string) { const q = query.trim().toLowerCase(); return !q || [value.label, value.category, value.currency, value.legalEntity, value.assetClass, value.id, ...value.tags].some((item) => item.toLowerCase().includes(q)); }
function formatAmount(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value); }
function formatBound(value: number | null) { return value == null ? "—" : formatAmount(value); }
function fileSlug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sources-uses"; }
const inputClass = "w-full rounded-md border border-term-border bg-term-panel-2 px-2.5 py-2 text-[11px] text-term-text outline-none transition placeholder:text-term-text-mute focus:border-term-amber";
