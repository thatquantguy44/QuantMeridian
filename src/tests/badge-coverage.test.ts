import { describe, test, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Pages that render badges via child components (ChartStudio, MotionStudio, etc.)
const BADGE_EXEMPT_PAGES = [
  "macro-chart/page.tsx",
  "market-chart/page.tsx",
  "economics/motion/page.tsx",
  // Module guides are documentation only: no market, model or desk data is shown.
  "guides/page.tsx",
];

function findPages(dir: string): string[] {
  const pages: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pages.push(...findPages(full));
    } else if (entry.name === "page.tsx") {
      pages.push(full);
    }
  }
  return pages;
}

describe("badge coverage", () => {
  const appDir = path.resolve(__dirname, "../app");
  const pages = findPages(appDir);

  test("found page files", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  test("every page imports a provenance badge or is exempt", () => {
    const missing: string[] = [];
    for (const page of pages) {
      const rel = path.relative(appDir, page);
      if (BADGE_EXEMPT_PAGES.some(ex => rel.endsWith(ex))) continue;
      const content = fs.readFileSync(page, "utf-8");
      const hasBadge =
        content.includes("ProvenanceBadge") ||
        content.includes("SourceBadge") ||
        content.includes("DataSourceStrip") ||
        content.includes("StalenessBar");
      if (!hasBadge) missing.push(rel);
    }
    if (missing.length > 0) {
      console.warn("Pages missing provenance badge:", missing);
    }
    expect(missing.length).toBe(0);
  });
});
