export type EcoIqWorkflow = "economics.explain" | "economics.transmission" | "economics.scenario";

export interface EcoIqEvidence {
  id: string;
  label: string;
  value: string;
  asOf: string | null;
  source: "GOLD" | "ERR";
  interpretation: string;
}

export interface EcoIqEffect {
  order: 1 | 2 | 3;
  title: string;
  detail: string;
  confidence: "high" | "medium" | "low";
}

export type EcoIqClaimType = "observation" | "mechanism" | "effect" | "alternative" | "falsifier";

export interface EcoIqClaim {
  id: string;
  type: EcoIqClaimType;
  text: string;
  evidenceIds: string[];
  confidence: "high" | "medium" | "low";
}

export interface EcoIqAgentStage {
  agent: string;
  status: "not_run" | "completed" | "failed";
  summary: string;
  evidenceIds: string[];
}

export interface EcoIqEvidenceEnvelope {
  source: "macro_medallion";
  asOf: string | null;
  question: string;
  workflow: EcoIqWorkflow;
  evidence: EcoIqEvidence[];
  rules: string[];
}

export interface EcoIqResponse {
  ok: boolean;
  module: "ECOIQ";
  workflow: EcoIqWorkflow;
  question: string;
  observed: string[];
  explanation: string;
  evidence: EcoIqEvidence[];
  effects: EcoIqEffect[];
  alternatives: string[];
  falsifiers: string[];
  disclosures: string[];
  asOf: string | null;
  source: "macro_medallion" | "ERR";
  error?: string;
  llmProfile?: string;
  llmProvider?: string;
  llmModel?: string | null;
  verification?: { ok: boolean; verifiedEvidence: string[]; issues: string[] };
  llmUsed?: boolean;
  llmOutputAccepted?: boolean;
  synthesisMode?: "deterministic_fallback" | "structured_evidence_local_llm";
  evidenceEnvelope?: EcoIqEvidenceEnvelope;
  claims?: EcoIqClaim[];
  agentStages?: EcoIqAgentStage[];
}
