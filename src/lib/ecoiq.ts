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
  verification?: { ok: boolean; verifiedEvidence: string[]; issues: string[] };
  llmUsed?: boolean;
  llmOutputAccepted?: boolean;
}
