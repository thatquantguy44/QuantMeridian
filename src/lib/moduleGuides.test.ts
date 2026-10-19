import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/nav";
import { parseInline, parseMarkdown, type Block } from "@/lib/markdown";
import { GUIDE_DOCS, guideModules, hasGuide, loadGuide } from "./moduleGuides";

const optimization = NAV.filter((item) => item.group === "OPTIMIZATION");

const REQUIRED: Record<string, string[]> = {
  whitepaper: ["Executive summary", "Business problem", "How it works", "Data and provenance", "Assumptions", "Outputs and how to read them", "Validation", "Limitations", "Status and governance", "References"],
  help: ["Quick start", "Screen guide", "Assumptions and defaults", "FAQ", "Troubleshooting", "Glossary"],
};

function inlineTexts(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "quote") out.push(block.text);
    if (block.type === "list") for (const item of block.items) out.push(item.text, ...item.children);
    if (block.type === "table") for (const row of [block.header, ...block.rows]) out.push(...row);
  }
  return out;
}

describe("module guides", () => {
  it("covers every Optimization module in the sidebar", () => {
    for (const item of optimization) expect(hasGuide(item.code), item.code).toBe(true);
    expect(guideModules().map((m) => m.code)).toEqual(optimization.map((m) => m.code));
  });

  for (const item of optimization) {
    for (const doc of GUIDE_DOCS) {
      it(`${item.code} ${doc.id}: has a title, the required sections and no broken internal links`, async () => {
        const blocks = parseMarkdown(await loadGuide(item.code, doc.id));
        const h1 = blocks.find((b) => b.type === "heading" && b.level === 1);
        expect(h1, "title").toBeDefined();
        const h2 = blocks.filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading" && b.level === 2).map((b) => b.text);
        for (const section of REQUIRED[doc.id]) expect(h2.some((t) => t.startsWith(section)), `${item.code} ${doc.id} needs "## ${section}"`).toBe(true);

        // Every table row has the header's column count (an unescaped "|" in a cell would split it).
        for (const block of blocks) {
          if (block.type !== "table") continue;
          for (const row of block.rows) expect(row.length, `${item.code} ${doc.id} table row: ${row.join(" | ").slice(0, 80)}`).toBe(block.header.length);
        }
        // No formatting left unparsed (an unbalanced ** or backtick shows up literally).
        for (const text of inlineTexts(blocks)) {
          for (const token of parseInline(text)) {
            if (token.type === "text") expect(token.text, `${item.code} ${doc.id} stray markup`).not.toMatch(/\*\*|`/);
          }
        }

        const routes = new Set(NAV.map((n) => n.href));
        const ids = new Set(blocks.filter((b) => b.type === "heading").map((b) => (b as { id: string }).id));
        for (const text of inlineTexts(blocks)) {
          for (const token of parseInline(text)) {
            if (token.type !== "link") continue;
            const href = token.href;
            if (href.startsWith("#")) expect(ids.has(href.slice(1)), `anchor ${href}`).toBe(true);
            else if (href.startsWith("/guides/")) {
              const [, , code, target] = href.split("/");
              expect(hasGuide(code), `guide ${href}`).toBe(true);
              if (target) expect(["help", "whitepaper"]).toContain(target.split("#")[0]);
            } else if (href.startsWith("/")) expect(routes.has(href.split("#")[0]), `route ${href}`).toBe(true);
            else expect(href, "external links must be absolute https").toMatch(/^https:\/\//);
          }
        }
      });
    }
  }
});
