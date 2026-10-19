import { useEffect, useMemo, useState } from "react";
import { parseMarkdown, splitSections, type Block, type Section } from "@/lib/markdown";
import { loadGuide, type GuideDoc } from "@/lib/moduleGuides";

/** Loads, parses and filters one guide. `query` keeps only the sections that mention it. */
export function useGuide(code: string, doc: GuideDoc, query: string) {
  const [source, setSource] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${code}:${doc}`;
  useEffect(() => {
    let active = true;
    setError(null);
    loadGuide(code, doc).then((text) => { if (active) setSource({ key, text }); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Guide unavailable."); });
    return () => { active = false; };
  }, [code, doc, key]);

  const parsed = useMemo(() => {
    if (!source || source.key !== key) return null;
    const blocks = parseMarkdown(source.text);
    const title = (blocks.find((b) => b.type === "heading" && b.level === 1) as { text: string } | undefined)?.text ?? code;
    return { title, sections: splitSections(blocks) };
  }, [source, key, code]);

  const needle = query.trim().toLowerCase();
  const sections: Section[] = parsed ? (needle ? parsed.sections.filter((s) => s.searchText.includes(needle)) : parsed.sections) : [];
  const blocks: Block[] = sections.flatMap((s) => s.blocks);
  return { loading: !parsed && !error, error, title: parsed?.title ?? "", allSections: parsed?.sections ?? [], sections, blocks };
}
