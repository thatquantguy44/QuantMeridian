"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, X } from "lucide-react";
import Link from "@/components/Link";
import { GUIDE_DOCS, guideHref, hasGuide, type GuideDoc } from "@/lib/moduleGuides";
import { MarkdownView } from "./MarkdownView";
import { useGuide } from "./useGuide";

/** "Guide" button for a module page header. Renders nothing for modules without a guide. */
export function GuideButton({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  if (!hasGuide(code)) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} data-testid="open-guide"
      title="Help, FAQ and white paper for this module"
      className="term-btn flex items-center gap-1 px-2 py-0.5 text-3xs">
      <BookOpen size={11} /> Guide
    </button>
    {open && <GuideDrawer code={code} onClose={() => setOpen(false)} />}
  </>;
}

export function GuideDrawer({ code, onClose, initialDoc = "help" }: { code: string; onClose: () => void; initialDoc?: GuideDoc }) {
  const [doc, setDoc] = useState<GuideDoc>(initialDoc);
  const [query, setQuery] = useState("");
  const guide = useGuide(code, doc, query);
  const body = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const jump = (id: string) => body.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start" });

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button type="button" aria-label="Close guide" className="absolute inset-0 bg-black/50" onClick={onClose} tabIndex={-1} />
      <section role="dialog" aria-modal="true" aria-label={`${code} guide`} data-testid="guide-drawer"
        className="relative flex h-full w-full max-w-3xl flex-col border-l border-term-border bg-term-panel shadow-2xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-term-border px-3 py-2">
          <span className="font-mono text-sm font-bold text-term-amber">{code}</span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-term-text">{guide.title || "Guide"}</h2>
          <Link href={guideHref(code, doc)} className="term-btn flex items-center gap-1 px-2 py-0.5 text-3xs" onClick={onClose}>
            <ExternalLink size={11} /> Full page
          </Link>
          <button ref={closeButton} type="button" onClick={onClose} className="term-btn px-1.5 py-0.5 text-3xs" aria-label="Close guide (Esc)"><X size={12} /></button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-term-border px-3 py-2">
          <div role="tablist" aria-label="Guide document" className="flex overflow-hidden rounded-sm border border-term-border">
            {GUIDE_DOCS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={doc === item.id} onClick={() => setDoc(item.id)}
                className={`px-2.5 py-1 text-2xs ${doc === item.id ? "bg-term-amber/15 text-term-amber" : "text-term-text-dim"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this guide…"
            aria-label="Search this guide" className="min-w-[10rem] flex-1 border border-term-border bg-term-panel-2 px-2 py-1 text-2xs text-term-text" />
        </div>
        {guide.allSections.length > 1 && !query && (
          <nav aria-label="Sections" className="flex flex-wrap gap-1 border-b border-term-border px-3 py-1.5">
            {guide.allSections.map((section) => (
              <button key={section.id} type="button" onClick={() => jump(section.id)} className="border border-term-border px-1.5 py-0.5 text-3xs text-term-text-dim hover:text-term-amber">
                {section.title}
              </button>
            ))}
          </nav>
        )}
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="guide-body">
          {guide.loading && <p className="text-xs text-term-text-dim">Loading…</p>}
          {guide.error && <p role="alert" className="text-xs text-term-down">{guide.error}</p>}
          {!guide.loading && query && guide.sections.length === 0 && <p className="text-xs text-term-text-dim">No section mentions “{query}”.</p>}
          <MarkdownView blocks={guide.blocks} />
        </div>
      </section>
    </div>
  );
}
