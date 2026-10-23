/**
 * Registry of module guides: one white paper / business guide and one Help & FAQ per module, authored as markdown in
 * docs/guides/<group>/ (<code>-whitepaper.md, <code>-help.md). The /guides library lists the Optimization suite;
 * any module with both files also gets a Guide button in its page header.
 *
 * Content is loaded lazily, so a page only downloads a guide when someone opens it.
 */
import { NAV } from "@/lib/nav";

export type GuideDoc = "help" | "whitepaper";
export const GUIDE_DOCS: { id: GuideDoc; label: string }[] = [
  { id: "help", label: "Help & FAQ" },
  { id: "whitepaper", label: "White paper" },
];

const loaders = import.meta.glob("/docs/guides/*/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

const byFile = new Map(Object.keys(loaders).map((path) => [path.slice(path.lastIndexOf("/") + 1), path]));
const pathFor = (code: string, doc: GuideDoc) => byFile.get(`${code.toLowerCase()}-${doc}.md`) ?? "";

export interface ModuleGuideEntry { code: string; label: string; href: string; desc: string }

/** Optimization modules in sidebar order that have both documents. */
export function guideModules(): ModuleGuideEntry[] {
  return NAV.filter((item) => item.group === "OPTIMIZATION" && hasGuide(item.code))
    .map((item) => ({ code: item.code, label: item.label, href: item.href, desc: item.desc }));
}

export function hasGuide(code: string): boolean {
  return GUIDE_DOCS.every((doc) => pathFor(code, doc.id) in loaders);
}

export async function loadGuide(code: string, doc: GuideDoc): Promise<string> {
  const loader = loaders[pathFor(code, doc)];
  if (!loader) throw new Error(`No ${doc} guide for ${code}.`);
  return loader();
}

export const guideHref = (code: string, doc: GuideDoc = "help") => `/guides/${code}/${doc}`;
