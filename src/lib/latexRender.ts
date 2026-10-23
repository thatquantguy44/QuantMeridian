/**
 * Turns the small LaTeX subset used by docs/guides/markets/vixr-formulas.tex into render-ready segments: paragraphs
 * with inline math, display equations, bullet lists and tables. KaTeX renders the math itself; this layer handles the
 * document structure KaTeX does not (itemize, tabular, \textbf, \texttt, paragraphs). Pure and DOM-free so it can be
 * tested in node.
 */
export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "code"; text: string } | { kind: "math"; tex: string };

export type Segment =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "display"; tex: string }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

const BLOCK = /\\begin\{(align\*|itemize|tabular|center)\}(?:\{(?:[^{}]|\{[^{}]*\})*\})?([\s\S]*?)\\end\{\1\}|\\\[([\s\S]*?)\\\]/g;

/** Convert text-mode LaTeX (with $...$ math) into inline pieces. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (text: string) => { if (text) out.push({ kind: "text", text: unescapeText(text) }); };
  // Split off $...$ math first, then handle text macros in the remaining text.
  const parts = src.split(/(\$[^$]+\$)/);
  for (const part of parts) {
    if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) { out.push({ kind: "math", tex: part.slice(1, -1).trim() }); continue; }
    let rest = part;
    const macro = /\\(textbf|texttt|emph)\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    let last = 0, match: RegExpExecArray | null;
    while ((match = macro.exec(rest))) {
      push(rest.slice(last, match.index));
      const inner = unescapeText(match[2]);
      out.push(match[1] === "texttt" ? { kind: "code", text: inner } : { kind: "bold", text: inner });
      last = match.index + match[0].length;
    }
    push(rest.slice(last));
  }
  return out;
}

function unescapeText(text: string): string {
  return text
    .replace(/\\noindent\s*/g, "")
    .replace(/\\(&|%|_|#)/g, "$1")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/\s+/g, " ")
    .replace(/~/g, " ");
}

function paragraphs(text: string): Segment[] {
  return text.split(/\n\s*\n/).map((chunk) => chunk.replace(/\\noindent/g, "").trim()).filter(Boolean)
    .map((chunk) => ({ kind: "paragraph" as const, inline: parseInline(chunk.replace(/\n/g, " ")) }))
    .filter((p) => p.inline.length > 0);
}

function tableOf(body: string): Segment {
  const rows = body
    .replace(/\\(toprule|midrule|bottomrule)/g, "")
    .split(/\\\\/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(/(?<!\\)&/).map((cell) => parseInline(cell.trim())));
  return { kind: "table", header: rows[0] ?? [], rows: rows.slice(1) };
}

export function latexToSegments(src: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0, match: RegExpExecArray | null;
  const re = new RegExp(BLOCK.source, "g");
  while ((match = re.exec(src))) {
    segments.push(...paragraphs(src.slice(last, match.index)));
    last = match.index + match[0].length;
    const [, env, body, bracket] = match;
    if (bracket !== undefined) segments.push({ kind: "display", tex: bracket.trim() });
    else if (env === "align*") segments.push({ kind: "display", tex: `\\begin{aligned}${body.trim()}\\end{aligned}` });
    else if (env === "itemize") {
      segments.push({ kind: "list", items: body.split(/\\item/).map((item) => item.trim()).filter(Boolean).map((item) => parseInline(item.replace(/\n/g, " "))) });
    } else if (env === "tabular") segments.push(tableOf(body));
    else if (env === "center") segments.push(...latexToSegments(body));
  }
  segments.push(...paragraphs(src.slice(last)));
  return segments;
}

/** Every math string in a segment list, with whether it is display style. */
export function mathOf(segments: Segment[]): { tex: string; display: boolean }[] {
  const out: { tex: string; display: boolean }[] = [];
  const fromInline = (inline: Inline[]) => inline.forEach((i) => { if (i.kind === "math") out.push({ tex: i.tex, display: false }); });
  for (const s of segments) {
    if (s.kind === "display") out.push({ tex: s.tex, display: true });
    else if (s.kind === "paragraph") fromInline(s.inline);
    else if (s.kind === "list") s.items.forEach(fromInline);
    else { s.header.forEach(fromInline); s.rows.forEach((r) => r.forEach(fromInline)); }
  }
  return out;
}
