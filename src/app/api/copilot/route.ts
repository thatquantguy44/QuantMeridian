// Exception to DB-only policy — LLM call is the live piece; context is sourced from Gold (see GOLD_DB_MIGRATION_HANDOFF §7 D1).
import { json } from "@/lib/server/http";
import { buildCopilotContext } from "@/lib/server/copilotContext";
import { callLlm } from "@/lib/server/llm/client";
import { resolveProfile } from "@/lib/server/llm/profiles";
import { AgentQueueStore, queueConfig } from "@/lib/server/agent/queueStore";


/**
 * POST /api/copilot  { question: string }
 *
 * Natural-language answer over the securities-finance desk data. The model comes from the LLM
 * profile layer (spec009): by default `anthropic-direct`, which sends the same request this route
 * always has (claude-opus-4-8, 1500 tokens). When the profile is unavailable or has no model — or on
 * any error — returns source "LOCAL" so the client falls back to its deterministic keyword engine.
 * Mirrors the terminal's provenance-honest fallback pattern: always 200, always a `source` badge.
 * `AI` responses name the `profile` and `model` that answered.
 */

const SYSTEM = `You are the AI Copilot for a Bloomberg-style securities-finance terminal, covering Securities Lending, Prime Finance, Collateral Management, and Cash/Treasury.

You will be given a JSON snapshot of the current desk data. Answer the user's question USING ONLY the figures in that snapshot — never invent numbers, tickers, clients, or rates. If the snapshot doesn't contain what's needed, say so plainly.

Style: terminal-desk register — direct, quantitative, no preamble or pleasantries. Lead with the answer. Cite the specific figures from the data. Keep the main text to 2-4 sentences; put supporting specifics in bullets.

Respond with ONLY a single JSON object and nothing else (no markdown, no code fences), of the form:
{"text": "<the narrative answer, 2-4 sentences>", "bullets": ["<short supporting point>", ...]}
The bullets array may be empty.`;

/** Extract the first balanced JSON object from a model response, tolerating fences/prose. */
function extractJson(raw: string): { text?: string; bullets?: string[] } | null {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let question = "";
  try {
    const body = await req.json();
    question = typeof body?.question === "string" ? body.question.trim() : "";
  } catch {
    return json({ error: "invalid body" }, { status: 400 });
  }
  if (!question) return json({ error: "question required" }, { status: 400 });

  // The Copilot snapshot is simulated desk data. An unavailable default profile degrades to LOCAL.
  const resolved = resolveProfile({ use: "copilot", dataClasses: ["desk_simulated"], optional: true });
  if (!resolved.ok || resolved.api_style === "none") {
    return json({ source: "LOCAL" });
  }

  try {
    const context = buildCopilotContext();
    const response = await callLlm(resolved, {
      workflow_id: "copilot",
      run_id: crypto.randomUUID(),
      task_type: "copilot",
      prompt_id: "copilot.v1",
      system: SYSTEM,
      user: `Desk data snapshot (JSON):\n${JSON.stringify(context)}\n\nQuestion: ${question}`,
      data_classes: ["desk_simulated"],
      correlation_id: crypto.randomUUID(),
    });
    if (response.status !== "completed" || !response.output_text) return json({ source: "LOCAL" });
    recordUsage(resolved.profile_id, response.usage.input_tokens, response.usage.output_tokens);

    const parsed = extractJson(response.output_text);
    if (!parsed?.text) return json({ source: "LOCAL" });

    return json({
      source: "AI",
      text: parsed.text,
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 8) : [],
      profile: resolved.profile_id,
      model: response.model ?? resolved.model,
    });
  } catch {
    // Any failure (context build, parse) → deterministic fallback.
    return json({ source: "LOCAL" });
  }
}

/** Counts tokens against the profile's daily usage when the queue database is configured; never affects the answer. */
function recordUsage(profileId: string, input: number | null, output: number | null) {
  if (!queueConfig()) return;
  new AgentQueueStore().recordUsage(profileId, input ?? 0, output ?? 0).catch(() => {});
}
