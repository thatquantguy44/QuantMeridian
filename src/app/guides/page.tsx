"use client";

import { useState } from "react";
import { useParams } from "react-router-dom";
import { BookOpen, Printer } from "lucide-react";
import Link from "@/components/Link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { MarkdownView } from "@/components/guides/MarkdownView";
import { useGuide } from "@/components/guides/useGuide";
import { GUIDE_DOCS, guideHref, guideModules, hasGuide, type GuideDoc } from "@/lib/moduleGuides";

/** /guides — the Optimization suite library. /guides/:code/:doc — one module's Help & FAQ or white paper. */
export default function GuidesPage() {
  const { code, doc } = useParams();
  if (code && hasGuide(code)) return <GuideReader code={code} doc={doc === "whitepaper" ? "whitepaper" : "help"} />;
  return <GuideLibrary missing={code} />;
}

function GuideLibrary({ missing }: { missing?: string }) {
  return <div className="flex min-h-full flex-col">
    <PageHeader code="GUIDES" title="Optimization suite guides" desc="White papers, business guides, help and FAQ for every optimization module" showStreaming={false} />
    {missing && <p role="alert" className="mx-2 mt-2 border border-term-down/40 bg-term-down/10 p-2 text-xs text-term-down">There is no guide for “{missing}”.</p>}
    <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="guide-library">
      {guideModules().map((module) => (
        <Panel key={module.code} title={module.label} code={module.code} resizable={false}>
          <div className="space-y-2 p-3 text-xs">
            <p className="text-term-text-dim">{module.desc}</p>
            <div className="flex flex-wrap gap-2">
              {GUIDE_DOCS.map((item) => <Link key={item.id} href={guideHref(module.code, item.id)} className="term-btn px-2 py-0.5 text-3xs">{item.label}</Link>)}
              <Link href={module.href} className="term-btn px-2 py-0.5 text-3xs">Open module</Link>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  </div>;
}

function GuideReader({ code, doc }: { code: string; doc: GuideDoc }) {
  const [query, setQuery] = useState("");
  const guide = useGuide(code, doc, query);
  const module = guideModules().find((item) => item.code === code);
  return <div className="flex min-h-full flex-col">
    <PageHeader code={code} title={guide.title || `${code} guide`} desc={module?.label} showStreaming={false} />
    <div className="flex flex-wrap items-center gap-2 border-b border-term-border bg-term-panel px-3 py-2 print:hidden">
      <Link href="/guides" className="term-btn flex items-center gap-1 px-2 py-0.5 text-3xs"><BookOpen size={11} /> All guides</Link>
      <div role="tablist" aria-label="Guide document" className="flex overflow-hidden rounded-sm border border-term-border">
        {GUIDE_DOCS.map((item) => (
          <Link key={item.id} href={guideHref(code, item.id)} role="tab" aria-selected={doc === item.id}
            className={`px-2.5 py-1 text-2xs ${doc === item.id ? "bg-term-amber/15 text-term-amber" : "text-term-text-dim"}`}>{item.label}</Link>
        ))}
      </div>
      {module && <Link href={module.href} className="term-btn px-2 py-0.5 text-3xs">Open {module.code}</Link>}
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this guide…"
        aria-label="Search this guide" className="min-w-[10rem] flex-1 border border-term-border bg-term-panel-2 px-2 py-1 text-2xs text-term-text" />
      <button type="button" className="term-btn flex items-center gap-1 px-2 py-0.5 text-3xs" onClick={() => window.print()}><Printer size={11} /> Print / PDF</button>
    </div>
    <div className="grid flex-1 gap-2 p-2 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="Sections" className="hidden self-start lg:sticky lg:top-2 lg:block print:hidden">
        <ul className="space-y-0.5 border border-term-border bg-term-panel p-2 text-2xs">
          {guide.allSections.map((section) => <li key={section.id}><a href={`#${section.id}`} className="block truncate px-1 py-0.5 text-term-text-dim hover:text-term-amber">{section.title}</a></li>)}
        </ul>
      </nav>
      <article className="min-w-0 border border-term-border bg-term-panel px-4 py-3" data-testid="guide-article">
        {guide.loading && <p className="text-xs text-term-text-dim">Loading…</p>}
        {guide.error && <p role="alert" className="text-xs text-term-down">{guide.error}</p>}
        {!guide.loading && query && guide.sections.length === 0 && <p className="text-xs text-term-text-dim">No section mentions “{query}”.</p>}
        <MarkdownView blocks={guide.blocks} />
      </article>
    </div>
  </div>;
}
