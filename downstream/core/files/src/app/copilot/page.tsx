import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, Tag } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";

interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  text: string;
  bullets?: string[];
  source?: "AI" | "LOCAL";
  model?: string;
}

const SUGGESTED = [
  "How steep is the 2s10s curve and what does it signal?",
  "Which indicators moved the most versus their prior reading?",
  "Summarize the current Treasury curve shape.",
  "What changed in the latest inflation readings?",
];

const LOCAL_TEXT = "No language model is available right now, so there is no generated answer. Configure an LLM profile (see settings/llm_profiles.json) to enable the Copilot, or use the Macro Dashboard and ECOIQ for evidence-backed explanations.";

/** AI Copilot (QuantMeridian-Core): natural-language answers over the latest Gold macro snapshot. */
export default function CopilotPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(0);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    setPending(true);
    setMessages((m) => [...m, { id: ++nextId.current, role: "user", text: q }]);
    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const j = await res.json();
      if (j?.source === "AI" && j.text) {
        setMessages((m) => [...m, {
          id: ++nextId.current, role: "assistant", text: j.text, source: "AI",
          bullets: Array.isArray(j.bullets) && j.bullets.length ? j.bullets : undefined,
          model: typeof j.profile === "string" && typeof j.model === "string" ? `${j.profile} · ${j.model}` : undefined,
        }]);
      } else {
        setMessages((m) => [...m, { id: ++nextId.current, role: "assistant", text: LOCAL_TEXT, source: "LOCAL" }]);
      }
    } catch {
      setMessages((m) => [...m, { id: ++nextId.current, role: "assistant", text: LOCAL_TEXT, source: "LOCAL" }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader code="AI" title="AI Copilot" desc="Natural-language answers over the latest Gold macro data" right={<ProvenanceBadge source="DB" />} />
      <div className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-12">
        <Panel title="Conversation" code="CHAT" className="xl:col-span-8">
          <div className="flex max-h-[60vh] min-h-[240px] flex-col gap-3 overflow-auto p-3">
            {messages.length === 0 && <div className="text-xs text-term-text-mute">Ask about the Treasury curve, rates, inflation, or the economic indicators. Answers come only from the snapshot of Gold data sent with each question.</div>}
            {messages.map((msg) => (
              <div key={msg.id} className={msg.role === "user" ? "self-end rounded-sm border border-term-border bg-term-panel-2 px-2.5 py-2 text-xs" : "max-w-[88%] rounded-sm border border-term-border bg-term-panel-2 px-2.5 py-2 text-xs"}>
                {msg.role === "assistant" && msg.source && (
                  <div className="mb-1.5"><Tag tone={msg.source === "AI" ? "up" : "amber"}>{msg.source === "AI" ? msg.model ?? "AI model" : "No model"}</Tag></div>
                )}
                <p className="whitespace-pre-wrap text-term-text">{msg.text}</p>
                {msg.bullets && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-term-text-dim">{msg.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
              </div>
            ))}
            {pending && <div className="text-xs text-term-text-mute">Thinking…</div>}
          </div>
          <form className="flex gap-2 border-t border-term-border p-2" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
            <input className="flex-1 rounded-sm border border-term-border bg-term-panel px-2 py-1 text-xs text-term-text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about the curve, rates, or inflation…" aria-label="Ask the Copilot" />
            <button className="term-btn" type="submit" disabled={pending || !input.trim()}>Ask</button>
          </form>
        </Panel>
        <Panel title="Suggested questions" code="SUGG" className="xl:col-span-4">
          <div className="flex flex-col gap-1 p-2">
            {SUGGESTED.map((q) => <button key={q} className="term-btn text-left" onClick={() => void ask(q)} disabled={pending}>{q}</button>)}
          </div>
        </Panel>
      </div>
    </div>
  );
}
