import type { EcoIqWorkflow } from "@/lib/ecoiq";
import { readEcoIq } from "@/lib/server/ecoiq";
import { completeWithProfile, resolveLlmProfile } from "./profileResolver";
import { verifyEcoIq } from "./ecoiqVerification";
import { AgentQueueStore } from "./queueStore";

export async function executeEcoIqJob(jobId: string, requesterId: string, question: string, workflow: EcoIqWorkflow, requestedProfile?: string | null) {
  const store = new AgentQueueStore();
  const base = await readEcoIq(question, workflow);
  const profile = resolveLlmProfile(requestedProfile);
  let result = { ...base, llmProfile: profile.id, llmProvider: profile.apiStyle === "openai_chat_completions" ? "OpenAI-compatible local endpoint" : profile.apiStyle === "none" ? "deterministic" : profile.apiStyle, llmModel: profile.model, llmUsed: false, llmOutputAccepted: false };
  if (base.ok && profile.available && profile.apiStyle === "openai_chat_completions") {
    try {
      const narrative = await completeWithProfile(profile,
        "You are ECOIQ. Rewrite only the mechanism explanation. Use no numerals, percentages, dates, or unsupported causal claims. State uncertainty explicitly.",
        `${question}\nObserved facts:\n${base.observed.join("\n")}\nEvidence IDs:\n${base.evidence.map(e => e.id).join(", ")}`);
      if (narrative) {
        result = { ...result, llmUsed: true };
        const permissive = process.env.ECOIQ_VERIFICATION_MODE === "permissive";
        if (permissive || !/[0-9]/.test(narrative)) result = { ...result, explanation: narrative, llmOutputAccepted: true, disclosures: permissive ? [...result.disclosures, "Permissive verification mode is enabled for testing; numeric LLM prose is allowed."] : result.disclosures };
        else result = { ...result, disclosures: [...result.disclosures, "Local LLM response was rejected because it contained unbound numerals; deterministic explanation retained."] };
      }
    } catch { result = { ...result, disclosures: [...result.disclosures, "Local LLM unavailable; deterministic explanation retained."] }; }
  }
  const verification = verifyEcoIq(result);
  result = { ...result, verification };
  await store.finish(jobId, requesterId, verification.ok ? "succeeded" : "failed", verification.ok ? null : "VERIFICATION_ERROR", result);
  return result;
}
