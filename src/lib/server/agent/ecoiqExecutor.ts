import type { EcoIqAgentStage, EcoIqClaim, EcoIqClaimType, EcoIqResponse, EcoIqWorkflow } from "@/lib/ecoiq";
import { readEcoIq } from "@/lib/server/ecoiq";
import { completeJsonWithProfile, resolveLlmProfile } from "./profileResolver";
import { verifyEcoIq } from "./ecoiqVerification";
import { AgentQueueStore } from "./queueStore";

const STAGE_AGENTS = [
  { agent: "economists.macro_indicator_analyst", purpose: "identify relevant macro observations and release context" },
  { agent: "economists.monetary_policy_analyst", purpose: "interpret policy-path and rate expectations" },
  { agent: "asset_classes.fixed_income_rates", purpose: "explain curve mechanics and rates transmission" },
  { agent: "economists.macro_regime_classifier", purpose: "frame regime, confidence, and competing hypotheses" },
  { agent: "economists.cross_asset_macro_linkages", purpose: "map qualified second- and third-order effects" },
] as const;

type StagePayload = { summary?: unknown; claims?: unknown };
const stripJson = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
function parseStage(text: string | null, evidenceIds: Set<string>): { summary: string; claims: EcoIqClaim[] } | null {
  if (!text) return null;
  let payload: StagePayload;
  try { payload = JSON.parse(stripJson(text)) as StagePayload; } catch { return null; }
  if (typeof payload.summary !== "string" || !Array.isArray(payload.claims)) return null;
  const claims: EcoIqClaim[] = [];
  for (const raw of payload.claims) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const type = item.type as EcoIqClaimType;
    const confidence = item.confidence as EcoIqClaim["confidence"];
    const refs = item.evidenceIds;
    if (typeof item.id !== "string" || typeof item.text !== "string" || !["observation", "mechanism", "effect", "alternative", "falsifier"].includes(type) || !["high", "medium", "low"].includes(confidence) || !Array.isArray(refs) || refs.length === 0 || !refs.every(ref => typeof ref === "string" && evidenceIds.has(ref))) return null;
    claims.push({ id: item.id, type, text: item.text, evidenceIds: refs as string[], confidence });
  }
  return { summary: payload.summary, claims };
}
function stagePrompt(base: EcoIqResponse, agent: string, purpose: string): string {
  return JSON.stringify({ module: "ECOIQ", workflow: base.workflow, question: base.question, purpose, evidenceEnvelope: base.evidenceEnvelope, observed: base.observed, priorClaims: base.claims ?? [], assignedAgent: agent });
}

export async function executeEcoIqJob(jobId: string, requesterId: string, question: string, workflow: EcoIqWorkflow, requestedProfile?: string | null) {
  const store = new AgentQueueStore();
  const base = await readEcoIq(question, workflow);
  const profile = resolveLlmProfile(requestedProfile);
  const evidenceIds = new Set(base.evidence.map(item => item.id));
  const agentStages: EcoIqAgentStage[] = STAGE_AGENTS.map(({ agent }) => ({
    agent, status: base.ok ? "not_run" : "failed",
    summary: base.ok ? "Waiting for structured stage output." : "Stage skipped because the Gold evidence set was unavailable.",
    evidenceIds: base.evidence.map(item => item.id),
  }));
  let result = { ...base, agentStages, synthesisMode: "deterministic_fallback" as "deterministic_fallback" | "structured_evidence_local_llm", llmProfile: profile.id, llmProvider: profile.apiStyle === "openai_chat_completions" ? "OpenAI-compatible local endpoint" : profile.apiStyle === "none" ? "deterministic" : profile.apiStyle, llmModel: profile.model, llmUsed: false, llmOutputAccepted: false };
  if (base.ok && profile.available && profile.apiStyle === "openai_chat_completions") {
    const acceptedClaims: EcoIqClaim[] = [];
    const disclosures = [...result.disclosures];
    for (const [index, stage] of STAGE_AGENTS.entries()) {
      try {
        const response = await completeJsonWithProfile(profile,
          `You are ${stage.agent}, one stage in ECOIQ. Return JSON only with exactly this shape: {"summary":"string","claims":[{"id":"string","type":"observation|mechanism|effect|alternative|falsifier","text":"string","evidenceIds":["existing Gold evidence id"],"confidence":"high|medium|low"}]}. ${stage.purpose}. Every claim must cite only evidence IDs supplied in the envelope. Do not invent numbers, dates, releases, probabilities, or causal certainty.`,
          stagePrompt(base, stage.agent, stage.purpose));
        const parsed = parseStage(response, evidenceIds);
        if (!parsed) {
          result.agentStages[index] = { ...result.agentStages[index], status: "failed", summary: "Rejected: invalid JSON or an unsupported/unbound claim." };
          disclosures.push(`${stage.agent} output rejected by JSON/evidence validation.`);
          continue;
        }
        result.agentStages[index] = { ...result.agentStages[index], status: "completed", summary: parsed.summary };
        acceptedClaims.push(...parsed.claims.map(claim => ({ ...claim, id: `${stage.agent}.${claim.id}` })));
      } catch {
        result.agentStages[index] = { ...result.agentStages[index], status: "failed", summary: "Stage call failed; deterministic evidence retained." };
        disclosures.push(`${stage.agent} unavailable; stage omitted from synthesis.`);
      }
    }
    result = { ...result, llmUsed: true };
    if (acceptedClaims.length > 0) {
      const mechanism = acceptedClaims.find(claim => claim.type === "mechanism");
      result = { ...result, claims: acceptedClaims, explanation: mechanism?.text ?? result.explanation, synthesisMode: "structured_evidence_local_llm", llmOutputAccepted: true, disclosures };
    } else {
      result = { ...result, disclosures: [...disclosures, "No structured stage output passed validation; deterministic explanation retained."] };
    }
  }
  const verification = verifyEcoIq(result);
  result = { ...result, verification };
  await store.finish(jobId, requesterId, verification.ok ? "succeeded" : "failed", verification.ok ? null : "VERIFICATION_ERROR", result);
  return result;
}
