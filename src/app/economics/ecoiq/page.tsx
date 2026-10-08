import { FormEvent, useState } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";
import { PageHeader, KpiStrip } from "@/components/ui/PageHeader";
import { Panel, Stat, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useEcoIq } from "@/lib/useEcoIq";
import type { EcoIqWorkflow } from "@/lib/ecoiq";

const WORKFLOWS: Array<{ id: EcoIqWorkflow; label: string; description: string }> = [
  { id: "economics.explain", label: "Explain", description: "Observed move → mechanism" },
  { id: "economics.transmission", label: "Effect chain", description: "First / second / third order" },
  { id: "economics.scenario", label: "Scenario", description: "Conditional forward path" },
];

export default function EconIqPage() {
  const { data, loading, queueStatus, run } = useEcoIq();
  const [question, setQuestion] = useState("Why did the 2s10s Treasury curve move, and what are the second- and third-order effects?");
  const [workflow, setWorkflow] = useState<EcoIqWorkflow>("economics.explain");
  const submit = (event: FormEvent) => { event.preventDefault(); void run(question, workflow); };
  const tone = data?.ok ? "up" : "amber";
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader code="ECOIQ" title="Economic Intelligence" desc="Causal macro explanations and effect chains" asOf={data?.asOf} showStreaming={false} right={<><ProvenanceBadge source={data?.source === "macro_medallion" ? "GOLD" : "ERR"} asOf={data?.asOf} /><Tag tone="violet"><BrainCircuit className="mr-1 h-3 w-3" />QuantSmith workflow</Tag><Tag tone="amber">ATTENDED MODE</Tag></>} />
    <KpiStrip>
      <Stat label="Evidence" value={data?.evidence.length ?? "—"} sub="Gold-backed fields" tone={tone} />
      <Stat label="Effect Orders" value={data?.effects.length ?? "—"} sub="mechanism chain" />
      <Stat label="Source" value={data?.source === "macro_medallion" ? "GOLD" : "—"} sub="macro_medallion" tone={data?.source === "macro_medallion" ? "up" : "amber"} />
      <Stat label="Causal Status" value="HYPOTHESIS" sub="not identification" tone="amber" />
      <Stat label="Worker" value="LOCAL" sub="pinned QuantSmith" />
      <Stat label="Run" value={loading ? queueStatus.toUpperCase() : data ? "READY" : "IDLE"} sub="read-only" tone={loading ? "amber" : "up"} />
    </KpiStrip>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
      <Panel title="Ask ECOIQ" code="QUERY" accent bodyClassName="p-3" resizable={false}>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="ecoiq-question" className="term-label">Question</label>
          <textarea id="ecoiq-question" value={question} onChange={e => setQuestion(e.target.value)} rows={3} maxLength={2000} className="w-full resize-y border border-term-border bg-term-panel-2 p-2 text-sm text-term-text outline-none focus:border-term-amber" />
          <div className="flex flex-wrap items-center gap-2">
            {WORKFLOWS.map(item => <button type="button" key={item.id} onClick={() => setWorkflow(item.id)} className={`term-btn ${workflow === item.id ? "border-term-amber text-term-amber" : ""}`} title={item.description}>{item.label}</button>)}
            <button type="submit" disabled={loading || !question.trim()} className="term-btn ml-auto inline-flex items-center gap-1 border-term-amber text-term-amber"><RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />{loading ? "Analyzing…" : "Analyze"}</button>
          </div>
        </form>
      </Panel>
      {!data && loading && <div className="p-4 text-sm text-term-text-dim">Loading Gold evidence…</div>}
      {data && <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-12">
        <Panel title="Observed facts" code="GOLD" className="xl:col-span-5" bodyClassName="p-3"><div className="space-y-2">{data.observed.map(item => <div key={item} className="border-l-2 border-term-up/70 pl-2 text-sm text-term-text">{item}</div>)}{!data.ok && <div className="text-sm text-term-amber">{data.error ?? "No evidence available."}</div>}</div><div className="mt-3 flex flex-wrap gap-1.5">{data.evidence.map(item => <Tag key={item.id} tone={item.source === "GOLD" ? "up" : "amber"}>{item.label}: {item.value}</Tag>)}</div></Panel>
        <Panel title="Mechanism hypothesis" code="WHY" className="xl:col-span-7" bodyClassName="p-3" accent><p className="text-sm leading-relaxed text-term-text">{data.explanation}</p><div className="mt-3 grid gap-2 md:grid-cols-3">{data.effects.map(effect => <div key={effect.order} className="border border-term-border bg-term-panel-2 p-3"><div className="flex items-center justify-between"><Tag tone={effect.confidence === "high" ? "up" : effect.confidence === "medium" ? "amber" : "neutral"}>ORDER {effect.order}</Tag><span className="text-3xs uppercase text-term-text-mute">{effect.confidence} confidence</span></div><div className="mt-2 text-sm font-semibold text-term-text">{effect.title}</div><p className="mt-1 text-xs leading-relaxed text-term-text-dim">{effect.detail}</p></div>)}</div></Panel>
        <Panel title="Alternative explanations" code="ALT" className="xl:col-span-6" bodyClassName="p-3"><ul className="space-y-2 text-sm text-term-text-dim">{data.alternatives.map(item => <li key={item} className="border-b border-term-border-soft pb-2">{item}</li>)}</ul></Panel>
        <Panel title="What would change the view?" code="FALS" className="xl:col-span-6" bodyClassName="p-3"><ul className="space-y-2 text-sm text-term-text-dim">{data.falsifiers.map(item => <li key={item} className="border-b border-term-border-soft pb-2">{item}</li>)}</ul></Panel>
        <Panel title="Disclosures & provenance" code="GOV" className="xl:col-span-12" bodyClassName="p-3"><div className="flex flex-wrap gap-2"><Tag tone={data.verification?.ok ? "up" : "amber"}>{data.verification?.ok ? "VERIFIED" : "PENDING VERIFICATION"}</Tag>{data.llmProfile && <Tag tone="violet">PROFILE {data.llmProfile}</Tag>}<Tag tone={data.llmUsed ? "up" : "neutral"}>{data.llmUsed ? "LLM CALLED" : "DETERMINISTIC"}</Tag>{data.llmModel && <Tag tone="violet">MODEL {data.llmModel}</Tag>}{data.llmOutputAccepted != null && <Tag tone={data.llmOutputAccepted ? "up" : "amber"}>{data.llmOutputAccepted ? "LLM OUTPUT ACCEPTED" : "LLM OUTPUT FALLBACK"}</Tag>}{data.disclosures.map(item => <Tag key={item} tone="neutral">{item}</Tag>)}</div></Panel>
      </div>}
    </div>
  </div>;
}
