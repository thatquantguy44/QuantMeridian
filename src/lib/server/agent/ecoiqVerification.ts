import type { EcoIqEvidence, EcoIqResponse } from "@/lib/ecoiq";

export function verifyEcoIq(response: EcoIqResponse): { ok: boolean; verifiedEvidence: string[]; issues: string[] } {
  const issues: string[] = [];
  const verifiedEvidence = response.evidence.filter((item: EcoIqEvidence) => item.source === "GOLD" && Boolean(item.asOf)).map(item => item.id);
  if (response.source !== "macro_medallion") issues.push("Evidence source is not macro_medallion.");
  if (!response.evidence.length) issues.push("No evidence rows were supplied.");
  if (response.explanation.toLowerCase().includes("proves causation")) issues.push("Unsupported causal language.");
  const evidenceIds = new Set(verifiedEvidence);
  for (const claim of response.claims ?? []) {
    if (!claim.evidenceIds.every(id => evidenceIds.has(id))) issues.push(`Claim ${claim.id} references unverified evidence.`);
    if ((claim.type === "mechanism" || claim.type === "effect") && !claim.confidence) issues.push(`Claim ${claim.id} is missing confidence.`);
  }
  if (response.evidenceEnvelope && response.evidenceEnvelope.source !== response.source) issues.push("Evidence envelope source mismatch.");
  return { ok: issues.length === 0, verifiedEvidence, issues };
}
