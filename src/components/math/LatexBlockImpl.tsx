import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { latexToSegments, type Inline, type Segment } from "@/lib/latexRender";

function Math({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(() => {
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "html", trust: false }); }
    catch { return null; }
  }, [tex, display]);
  // KaTeX output is generated from our own committed .tex files and escapes its input, so it is safe to inject.
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code className="font-mono text-term-down">{tex}</code>;
}

function Inlines({ inline }: { inline: Inline[] }) {
  return <>{inline.map((piece, i) => {
    if (piece.kind === "math") return <Math key={i} tex={piece.tex} display={false} />;
    if (piece.kind === "bold") return <strong key={i} className="text-term-text">{piece.text}</strong>;
    if (piece.kind === "code") return <code key={i} className="rounded-sm bg-term-panel-3 px-1 font-mono text-[0.92em] text-term-amber">{piece.text}</code>;
    return <span key={i}>{piece.text}</span>;
  })}</>;
}

function SegmentView({ segment }: { segment: Segment }) {
  switch (segment.kind) {
    case "paragraph": return <p className="leading-relaxed"><Inlines inline={segment.inline} /></p>;
    case "display": return <div className="overflow-x-auto py-1 text-term-text"><Math tex={segment.tex} display /></div>;
    case "list": return <ul className="list-inside list-disc space-y-0.5">{segment.items.map((item, i) => <li key={i}><Inlines inline={item} /></li>)}</ul>;
    case "table": return (
      <div className="overflow-x-auto"><table className="w-full text-left text-2xs">
        <thead><tr className="border-b border-term-border text-term-text-mute">{segment.header.map((cell, i) => <th key={i} scope="col" className="py-1 pr-3 font-semibold"><Inlines inline={cell} /></th>)}</tr></thead>
        <tbody>{segment.rows.map((row, r) => <tr key={r} className="border-b border-term-border">{row.map((cell, c) => <td key={c} className="py-1 pr-3"><Inlines inline={cell} /></td>)}</tr>)}</tbody>
      </table></div>
    );
  }
}

/** Rendered LaTeX (math via KaTeX) for one section body of the formula sheet. */
export default function LatexBlockImpl({ latex }: { latex: string }) {
  const segments = useMemo(() => latexToSegments(latex), [latex]);
  return <div className="space-y-2 text-xs text-term-text-dim">{segments.map((segment, i) => <SegmentView key={i} segment={segment} />)}</div>;
}
