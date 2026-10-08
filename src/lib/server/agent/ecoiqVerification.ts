import type { EcoIqEvidence, EcoIqResponse } from "@/lib/ecoiq";

export function verifyEcoIq(response: EcoIqResponse): { ok: boolean; verifiedEvidence: string[]; issues: string[] } {
  const issues: string[] = [];
  const verifiedEvidence = response.evidence.filter((item: EcoIqEvidence) => item.source === "GOLD" && Boolean(item.asOf)).map(item => item.id);
  if (response.source !== "macro_medallion") issues.push("Evidence source is not macro_medallion.");
  if (!response.evidence.length) issues.push("No evidence rows were supplied.");
  if (response.explanation.toLowerCase().includes("proves causation")) issues.push("Unsupported causal language.");
  return { ok: issues.length === 0, verifiedEvidence, issues };
}
