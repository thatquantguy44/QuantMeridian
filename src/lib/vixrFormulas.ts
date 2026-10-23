/**
 * The VIXR formula sheet. docs/guides/markets/vixr-formulas.tex is the single source: the page's Formulas panel, the
 * white paper's Formulas section and the downloadable file all come from it, and a test keeps the white paper in step.
 */
const sources = import.meta.glob("/docs/guides/markets/vixr-formulas.tex", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const VIXR_TEX: string = Object.values(sources)[0] ?? "";
export const VIXR_TEX_FILENAME = "vixr-formulas.tex";

export interface FormulaSection { title: string; latex: string }

/** Split on \subsection*{Title}; each body is the LaTeX up to the next section or \end{document}, trimmed. */
export function parseFormulaSections(tex: string): FormulaSection[] {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.lastIndexOf("\\end{document}");
  if (start < 0 || end < 0) return [];
  const body = tex.slice(start + "\\begin{document}".length, end);
  const parts = body.split(/\\subsection\*\{([^}]*)\}/);
  const sections: FormulaSection[] = [];
  for (let i = 1; i < parts.length; i += 2) sections.push({ title: parts[i].trim(), latex: parts[i + 1].trim() });
  return sections;
}

/** The introduction before the first section, without the title block. */
export function formulaIntro(tex: string): string {
  const start = tex.indexOf("\\maketitle");
  const first = tex.indexOf("\\subsection*{");
  return start < 0 || first < 0 ? "" : tex.slice(start + "\\maketitle".length, first).trim();
}
