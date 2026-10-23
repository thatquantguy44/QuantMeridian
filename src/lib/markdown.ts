/**
 * Minimal, dependency-free markdown parser for the module guides (docs/guides/**).
 *
 * It covers only the subset the guides are written in: headings, paragraphs, one-level-nested lists, pipe tables,
 * fenced code, blockquotes, rules, and inline code/bold/italic/links. It produces plain data that React renders as
 * text, so raw HTML in a guide is shown literally and can never execute.
 */

export type Block =
  | { type: "heading"; level: number; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: { text: string; children: string[] }[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; text: string; lang?: string }
  | { type: "quote"; text: string }
  | { type: "rule" };

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "link"; text: string; href: string };

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") { current += "|"; i++; continue; }
    if (inner[i] === "|") { cells.push(current.trim()); current = ""; continue; }
    current += inner[i];
  }
  cells.push(current.trim());
  return cells;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (line: string) =>
    /^#{1,6}\s/.test(line) || line.startsWith("```") || line.startsWith(">") || LIST_ITEM.test(line) ||
    isTableRow(line) || /^-{3,}\s*$/.test(line);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2], id: slugify(heading[2]) });
      i++; continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++; // closing fence
      blocks.push(lang ? { type: "code", text: body.join("\n"), lang } : { type: "code", text: body.join("\n") });
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) { blocks.push({ type: "rule" }); i++; continue; }

    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: body.join(" ").trim() });
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]);
      const items: { text: string; children: string[] }[] = [];
      while (i < lines.length) {
        const current = lines[i];
        if (!current.trim()) {
          // A blank line ends the list unless the next line continues it.
          const next = lines[i + 1];
          const nextItem = next ? LIST_ITEM.exec(next) : null;
          if (nextItem && nextItem[1].length === 0 && /\d/.test(nextItem[2]) === ordered) { i++; continue; }
          break;
        }
        const item = LIST_ITEM.exec(current);
        if (item && item[1].length >= 2 && items.length) { items[items.length - 1].children.push(item[3]); i++; continue; }
        if (item && item[1].length < 2) {
          if (/\d/.test(item[2]) !== ordered) break;
          items.push({ text: item[3], children: [] }); i++; continue;
        }
        if (/^\s{2,}\S/.test(current) && items.length) {
          const last = items[items.length - 1];
          if (last.children.length) last.children[last.children.length - 1] += ` ${current.trim()}`;
          else last.text += ` ${current.trim()}`;
          i++; continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) body.push(lines[i++].trim());
    if (!body.length) { body.push(line.trim()); i++; }
    blocks.push({ type: "paragraph", text: body.join(" ") });
  }
  return blocks;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", text: text.slice(last, index) });
    const token = match[0];
    if (match[1]) out.push({ type: "code", text: token.slice(1, -1) });
    else if (match[2]) out.push({ type: "bold", text: token.slice(2, -2) });
    else if (match[3]) out.push({ type: "italic", text: token.slice(1, -1) });
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out.push({ type: "link", text: link[1], href: link[2] });
    }
    last = index + token.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export interface Section { id: string; title: string; blocks: Block[]; searchText: string }

/** Group blocks under their level-2 heading. Content before the first one becomes "Overview". */
export function splitSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { id: "overview", title: "Overview", blocks: [], searchText: "" };
  const text = (block: Block): string => {
    switch (block.type) {
      case "heading": case "paragraph": case "code": case "quote": return block.text;
      case "list": return block.items.map((item) => [item.text, ...item.children].join(" ")).join(" ");
      case "table": return [block.header, ...block.rows].map((row) => row.join(" ")).join(" ");
      default: return "";
    }
  };
  for (const block of blocks) {
    if (block.type === "heading" && block.level === 2) {
      if (current.blocks.length) sections.push(current);
      current = { id: block.id, title: block.text, blocks: [block], searchText: "" };
      continue;
    }
    if (block.type === "heading" && block.level === 1) continue;
    current.blocks.push(block);
  }
  if (current.blocks.length) sections.push(current);
  for (const section of sections) section.searchText = section.blocks.map(text).join(" ").toLowerCase();
  return sections;
}
