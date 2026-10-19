import { describe, expect, it } from "vitest";
import { parseMarkdown, parseInline, slugify, splitSections } from "./markdown";

describe("parseMarkdown", () => {
  it("parses headings with stable ids", () => {
    const blocks = parseMarkdown("# Title\n\n## Screen guide: Run Config\n");
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Title", id: "title" },
      { type: "heading", level: 2, text: "Screen guide: Run Config", id: "screen-guide-run-config" },
    ]);
  });

  it("joins consecutive lines into one paragraph and splits on blank lines", () => {
    const blocks = parseMarkdown("one\ntwo\n\nthree");
    expect(blocks).toEqual([{ type: "paragraph", text: "one two" }, { type: "paragraph", text: "three" }]);
  });

  it("parses bullet and numbered lists, with continuation lines and one nested level", () => {
    const blocks = parseMarkdown("- a\n  continued\n- b\n  - b1\n  - b2\n\n1. first\n2. second");
    expect(blocks[0]).toEqual({
      type: "list", ordered: false,
      items: [{ text: "a continued", children: [] }, { text: "b", children: ["b1", "b2"] }],
    });
    expect(blocks[1]).toEqual({ type: "list", ordered: true, items: [{ text: "first", children: [] }, { text: "second", children: [] }] });
  });

  it("parses pipe tables and keeps escaped pipes inside cells", () => {
    const blocks = parseMarkdown("| Field | Meaning |\n|---|---|\n| `a` | x \\| y |\n| b | z |");
    expect(blocks).toEqual([{ type: "table", header: ["Field", "Meaning"], rows: [["`a`", "x | y"], ["b", "z"]] }]);
  });

  it("parses fenced code verbatim, blockquotes and rules", () => {
    const blocks = parseMarkdown("```\nnpm run dev:all\n  indented\n```\n\n> **Note:** careful\n> second line\n\n---");
    expect(blocks).toEqual([
      { type: "code", text: "npm run dev:all\n  indented" },
      { type: "quote", text: "**Note:** careful second line" },
      { type: "rule" },
    ]);
  });
});

describe("parseInline", () => {
  it("splits code, bold, italic and links", () => {
    expect(parseInline("Run `x` then **stop**, *maybe* see [Guide](/guides/IBAL).")).toEqual([
      { type: "text", text: "Run " }, { type: "code", text: "x" }, { type: "text", text: " then " },
      { type: "bold", text: "stop" }, { type: "text", text: ", " }, { type: "italic", text: "maybe" },
      { type: "text", text: " see " }, { type: "link", text: "Guide", href: "/guides/IBAL" }, { type: "text", text: "." },
    ]);
  });
  it("does not treat code contents as formatting", () => {
    expect(parseInline("`**not bold**`")).toEqual([{ type: "code", text: "**not bold**" }]);
  });
  it("leaves raw HTML as plain text (it is never rendered as markup)", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([{ type: "text", text: "<script>alert(1)</script>" }]);
  });
});

describe("slugify and splitSections", () => {
  it("makes url-safe ids", () => {
    expect(slugify("FAQ: Why is savings “n/a”?")).toBe("faq-why-is-savings-n-a");
  });
  it("splits a document into level-2 sections with their text for search", () => {
    const sections = splitSections(parseMarkdown("# T\nintro\n## A\nalpha\n## B\nbeta gamma"));
    expect(sections.map((s) => s.title)).toEqual(["Overview", "A", "B"]);
    expect(sections[2].searchText).toContain("beta gamma");
  });
});
