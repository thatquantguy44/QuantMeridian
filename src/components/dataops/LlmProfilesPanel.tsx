import { useCallback, useEffect, useState } from "react";
import { Panel, Tag } from "@/components/ui/Panel";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { fmtInt } from "@/lib/format";

interface ProfileRow {
  id: string;
  label: string;
  api_style: string;
  enabled: boolean;
  state: "ready" | "LLM_PROFILE_UNKNOWN" | "LLM_PROFILE_NOT_ALLOWED" | "LLM_PROFILE_UNAVAILABLE";
  detail: string | null;
  model: string | null;
  usage_today: { input_tokens: number; output_tokens: number } | null;
}
interface ProbeResult { profile: string; status: "ok" | "failed" | "unavailable" | "skipped"; code: string | null; latency_ms: number; model: string | null }

const STATE_LABEL: Record<ProfileRow["state"], string> = { ready: "READY", LLM_PROFILE_UNKNOWN: "UNKNOWN", LLM_PROFILE_NOT_ALLOWED: "OFF", LLM_PROFILE_UNAVAILABLE: "NOT CONFIGURED" };
const STATE_TONE: Record<ProfileRow["state"], "up" | "neutral" | "amber" | "down"> = { ready: "up", LLM_PROFILE_UNKNOWN: "down", LLM_PROFILE_NOT_ALLOWED: "neutral", LLM_PROFILE_UNAVAILABLE: "amber" };

/** Data Ops card for the LLM profile registry (spec009 T-007): dry-run states, today's usage, and an on-demand probe. */
export function LlmProfilesPanel() {
  const [rows, setRows] = useState<ProfileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult | "pending" | { error: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/profiles", { cache: "no-store" });
      const body = await res.json() as { profiles?: ProfileRow[]; error_code?: string };
      if (!res.ok || !body.profiles) { setError(body.error_code ?? `HTTP ${res.status}`); setRows(null); return; }
      setError(null); setRows(body.profiles);
    } catch { setError("UNREACHABLE"); setRows(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const probe = async (id: string) => {
    setProbes((p) => ({ ...p, [id]: "pending" }));
    try {
      const res = await fetch(`/api/agent/profiles/${encodeURIComponent(id)}/probe`, { method: "POST" });
      const body = await res.json() as ProbeResult & { error_code?: string };
      setProbes((p) => ({ ...p, [id]: res.ok ? body : { error: body.error_code ?? `HTTP ${res.status}` } }));
    } catch { setProbes((p) => ({ ...p, [id]: { error: "UNREACHABLE" } })); }
  };

  const columns: Column<ProfileRow>[] = [
    { key: "id", header: "Profile", render: (r) => <span className="font-semibold text-term-text">{r.id}</span>, sortVal: (r) => r.id },
    { key: "state", header: "State", align: "center", render: (r) => <span title={r.detail ?? r.state}><Tag tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Tag></span>, sortVal: (r) => r.state },
    { key: "style", header: "API", render: (r) => <span className="font-mono text-3xs">{r.api_style}</span>, sortVal: (r) => r.api_style },
    { key: "model", header: "Model", render: (r) => <span className="font-mono text-3xs">{r.model ?? "—"}</span>, sortVal: (r) => r.model ?? "" },
    { key: "usage", header: "Tokens today", align: "right", render: (r) => (r.usage_today ? `${fmtInt(r.usage_today.input_tokens)} in / ${fmtInt(r.usage_today.output_tokens)} out` : "—"), sortVal: (r) => (r.usage_today ? r.usage_today.input_tokens + r.usage_today.output_tokens : -1) },
    {
      key: "probe", header: "Probe", align: "center",
      render: (r) => {
        const result = probes[r.id];
        if (r.state !== "ready" || r.api_style === "none") return <span className="text-term-text-mute">—</span>;
        if (result === "pending") return <span className="text-3xs text-term-text-mute">probing…</span>;
        const outcome = !result ? null : "error" in result ? <Tag tone="down">{result.error}</Tag> : <Tag tone={result.status === "ok" ? "up" : "down"}>{result.status === "ok" ? `OK ${result.latency_ms} ms` : `FAILED ${result.code ?? ""}`}</Tag>;
        return <span className="flex items-center justify-center gap-1"><button className="term-btn" onClick={() => void probe(r.id)} aria-label={`Probe ${r.id}`}>Probe</button>{outcome}</span>;
      },
    },
  ];

  return (
    <Panel title="LLM Profiles" code="LLM" className="xl:col-span-12" right={<span className="flex items-center gap-2"><Tag tone={error ? "down" : rows ? "blue" : "neutral"}>{error ? error : rows ? "DRY RUN" : "LOADING…"}</Tag><button className="term-btn" onClick={() => void load()}>Refresh</button></span>}>
      <div className="px-3 py-1 text-3xs text-term-text-mute">
        States come from the profile registry and the server environment — nothing is called until you press <span className="font-semibold">Probe</span>, which sends one tiny completion. Keys and endpoints are never shown.
      </div>
      {rows ? <DataGrid columns={columns} rows={rows} rowKey={(r) => r.id} maxHeight="260px" zebra /> : <div className="px-3 py-4 text-xs text-term-text-mute">{error ? `Profile states are unavailable (${error}).` : "Loading profile states…"}</div>}
    </Panel>
  );
}
