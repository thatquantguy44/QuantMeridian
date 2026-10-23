import katex from "katex";
import { describe, expect, it } from "vitest";
import { VIXR_TEX, formulaIntro, parseFormulaSections } from "./vixrFormulas";
import { latexToSegments, mathOf, parseInline } from "./latexRender";

describe("parseInline", () => {
  it("splits math, bold, code and plain text", () => {
    expect(parseInline("Use $x_k$ and \\textbf{bold} with \\texttt{a\\_b.ts} here")).toEqual([
      { kind: "text", text: "Use " }, { kind: "math", tex: "x_k" }, { kind: "text", text: " and " },
      { kind: "bold", text: "bold" }, { kind: "text", text: " with " }, { kind: "code", text: "a_b.ts" }, { kind: "text", text: " here" },
    ]);
  });
  it("unescapes text characters and dashes", () => {
    expect(parseInline("S\\&P~500, 95\\%, Newey--West")).toEqual([{ kind: "text", text: "S&P 500, 95%, Newey–West" }]);
  });
  it("keeps escaped characters inside math untouched", () => {
    expect(parseInline("$\\text{in \\%}$")).toEqual([{ kind: "math", tex: "\\text{in \\%}" }]);
  });
});

describe("latexToSegments", () => {
  it("handles each structure", () => {
    const segments = latexToSegments(String.raw`Intro $a$.
\begin{itemize}
\item one $b$
\item two
\end{itemize}
\begin{align*}
x &= 1\\
y &= 2
\end{align*}
\[ z = 3 \]
\begin{center}
\begin{tabular}{@{}ll@{}}
\toprule
Model & $y$\\
\midrule
A & $\mathrm{RV}$\\
\bottomrule
\end{tabular}
\end{center}
Tail.`);
    expect(segments.map((s) => s.kind)).toEqual(["paragraph", "list", "display", "display", "table", "paragraph"]);
    const list = segments[1] as Extract<(typeof segments)[number], { kind: "list" }>;
    expect(list.items).toHaveLength(2);
    expect((segments[2] as { tex: string }).tex).toBe("\\begin{aligned}x &= 1\\\\\ny &= 2\\end{aligned}");
    expect((segments[3] as { tex: string }).tex).toBe("z = 3");
    const table = segments[4] as Extract<(typeof segments)[number], { kind: "table" }>;
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(1);
  });

  it("strips the tabular column specification, including nested braces", () => {
    const [table] = latexToSegments(String.raw`\begin{tabular}{@{}lll@{}}
\toprule
Model & $y$ & $x$\\
\midrule
Magnitude & $a$ & $b$\\
\bottomrule
\end{tabular}`) as Extract<ReturnType<typeof latexToSegments>[number], { kind: "table" }>[];
    expect(table.header.map((cell) => cell.map((p) => ("text" in p ? p.text : p.tex)).join(""))).toEqual(["Model", "y", "x"]);
    expect(table.rows[0]).toHaveLength(3);
  });

  it("returns nothing for empty input", () => expect(latexToSegments("   \n\n  ")).toEqual([]));
});

describe("every formula in the VIXR sheet renders", () => {
  const sections = parseFormulaSections(VIXR_TEX);
  const intro = latexToSegments(formulaIntro(VIXR_TEX));

  it("the introduction parses", () => {
    expect(mathOf(intro)).toEqual([]);
    expect(intro.length).toBeGreaterThan(0);
  });

  for (const section of sections) {
    it(`${section.title}: parses into segments and every math string renders in KaTeX`, () => {
      const segments = latexToSegments(section.latex);
      expect(segments.length).toBeGreaterThan(0);
      const math = mathOf(segments);
      expect(math.length).toBeGreaterThan(0);
      for (const { tex, display } of math) {
        // throwOnError and strict mode turn unsupported commands and malformed math into failures.
        expect(() => katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "error" }), tex).not.toThrow();
      }
    });

    it(`${section.title}: leaves no raw LaTeX in the text a reader sees`, () => {
      const text = JSON.stringify(latexToSegments(section.latex).flatMap((s) => (s.kind === "paragraph" ? s.inline : s.kind === "list" ? s.items.flat() : s.kind === "table" ? [...s.header.flat(), ...s.rows.flat(2)] : [])).filter((p) => p.kind !== "math"));
      expect(text).not.toMatch(/\\\\(begin|end|item|textbf|texttt|noindent|toprule|midrule)|\\\$|\$/);
    });
  }

  it("the model table in the sheet reads Model, y, x with four rows", () => {
    const all = sections.flatMap((s) => latexToSegments(s.latex));
    const table = all.find((s) => s.kind === "table") as Extract<(typeof all)[number], { kind: "table" }>;
    const text = (cell: ReturnType<typeof parseInline>) => cell.map((p) => ("text" in p ? p.text : p.tex)).join("");
    expect(table.header.map(text)).toEqual(["Model", "y", "x"]);
    expect(table.rows.map((r) => text(r[0]))).toEqual(["Magnitude (Mincer–Zarnowitz)", "Trailing benchmark", "Absolute move", "Direction"]);
    expect(table.rows.every((r) => r.length === 3)).toBe(true);
  });

  it("the sheet has display equations, lists and a table", () => {
    const kinds = new Set(sections.flatMap((s) => latexToSegments(s.latex).map((x) => x.kind)));
    expect([...kinds].sort()).toEqual(["display", "list", "paragraph", "table"]);
  });

  it("key formulas render to the expected structure", () => {
    const html = katex.renderToString("\\sigma_k = V_k \\sqrt{\\tfrac{30}{365}}", { throwOnError: true });
    expect(html).toContain("katex");
    expect(html).toContain("sqrt");
  });
});
