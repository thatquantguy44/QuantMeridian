import { Suspense, lazy } from "react";

// KaTeX and its fonts are loaded only when a formula is first shown, so they stay out of the main bundle.
const Impl = lazy(() => import("./LatexBlockImpl"));

/** Rendered LaTeX for a section body; shows the source while the renderer loads. */
export function LatexBlock({ latex }: { latex: string }) {
  return (
    <Suspense fallback={<pre className="overflow-x-auto font-mono text-[10px] text-term-text-mute">{latex}</pre>}>
      <Impl latex={latex} />
    </Suspense>
  );
}
