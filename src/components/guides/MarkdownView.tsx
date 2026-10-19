import { Fragment, type ReactNode } from "react";
import Link from "@/components/Link";
import { parseInline, type Block } from "@/lib/markdown";

function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((token, index) => {
    switch (token.type) {
      case "code": return <code key={index} className="rounded-sm bg-term-panel-2 px-1 font-mono text-[0.92em] text-term-amber">{token.text}</code>;
      case "bold": return <strong key={index} className="font-semibold text-term-text">{token.text}</strong>;
      case "italic": return <em key={index}>{token.text}</em>;
      case "link":
        if (token.href.startsWith("/")) return <Link key={index} href={token.href} className="text-term-blue underline">{token.text}</Link>;
        if (token.href.startsWith("#")) return <a key={index} href={token.href} className="text-term-blue underline">{token.text}</a>;
        if (token.href.startsWith("https://")) return <a key={index} href={token.href} target="_blank" rel="noopener noreferrer" className="text-term-blue underline">{token.text}</a>;
        return <span key={index}>{token.text}</span>;
      default: return <Fragment key={index}>{token.text}</Fragment>;
    }
  })}</>;
}

const HEADING: Record<number, string> = {
  1: "mb-3 text-lg font-semibold text-term-text",
  2: "mt-6 mb-2 border-b border-term-border pb-1 text-base font-semibold text-term-amber",
  3: "mt-4 mb-1.5 text-sm font-semibold text-term-text",
  4: "mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-term-text-dim",
};

/** Renders parsed guide markdown. Everything is rendered as React text, never as raw HTML. */
export function MarkdownView({ blocks }: { blocks: Block[] }) {
  const out: ReactNode[] = blocks.map((block, index) => {
    switch (block.type) {
      case "heading": {
        const Tag = `h${Math.min(6, block.level + 1)}` as "h2";
        return <Tag key={index} id={block.id} className={HEADING[block.level] ?? HEADING[4]}><Inline text={block.text} /></Tag>;
      }
      case "paragraph": return <p key={index} className="my-2 leading-relaxed text-term-text-dim"><Inline text={block.text} /></p>;
      case "quote": return <div key={index} className="my-3 border-l-2 border-term-amber bg-term-panel-2 px-3 py-2 text-term-text-dim"><Inline text={block.text} /></div>;
      case "code": return <pre key={index} className="my-2 overflow-x-auto rounded-sm border border-term-border bg-term-bg p-2 font-mono text-[0.92em] text-term-text">{block.text}</pre>;
      case "rule": return <hr key={index} className="my-4 border-term-border" />;
      case "list": {
        const ListTag = block.ordered ? "ol" : "ul";
        return <ListTag key={index} className={`my-2 space-y-1 pl-5 text-term-text-dim ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, i) => <li key={i} className="leading-relaxed"><Inline text={item.text} />
            {item.children.length > 0 && <ul className="mt-1 list-[circle] space-y-0.5 pl-5">{item.children.map((child, j) => <li key={j}><Inline text={child} /></li>)}</ul>}
          </li>)}
        </ListTag>;
      }
      case "table": return <div key={index} className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead><tr>{block.header.map((cell, i) => <th key={i} className="border-b border-term-border bg-term-panel-2 px-2 py-1 align-bottom font-semibold text-term-text"><Inline text={cell} /></th>)}</tr></thead>
          <tbody>{block.rows.map((row, r) => <tr key={r} className="align-top">{row.map((cell, c) => <td key={c} className="border-b border-term-border-soft px-2 py-1 text-term-text-dim"><Inline text={cell} /></td>)}</tr>)}</tbody>
        </table>
      </div>;
    }
  });
  return <div className="text-xs">{out}</div>;
}
