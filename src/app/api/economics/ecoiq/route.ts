import { json } from "@/lib/server/http";
import { readEcoIq } from "@/lib/server/ecoiq";
import type { EcoIqWorkflow } from "@/lib/ecoiq";

export const runtime = "nodejs";
const workflows = new Set<EcoIqWorkflow>(["economics.explain", "economics.transmission", "economics.scenario"]);

export async function GET() {
  return json(await readEcoIq("Why did the Treasury curve move?", "economics.explain"), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { question?: unknown; workflow?: unknown };
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "Why did the Treasury curve move?";
  const workflow = workflows.has(body.workflow as EcoIqWorkflow) ? body.workflow as EcoIqWorkflow : "economics.explain";
  return json(await readEcoIq(question || "Why did the Treasury curve move?", workflow), { headers: { "cache-control": "no-store" } });
}
