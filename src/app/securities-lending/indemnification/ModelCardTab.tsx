import { Panel, Tag } from "@/components/ui/Panel";
import type { IndemnificationResult } from "@/lib/indemnificationApi";
import { shortId } from "@/lib/indemnificationView";
import { runStamp } from "./Overview";
import { TD, TH } from "./ui";

export function ModelCardTab({ result, runId, durationMs }: { result: IndemnificationResult; runId: string; durationMs: number }) {
  const card = result.model_card;
  const conv = card.convergence;
  const row = (k: string, v: string) => (
    <tr key={k} className="border-b border-term-border-soft"><td className={`${TD} w-48 text-left text-term-text-mute`}>{k}</td><td className={`${TD} break-all text-left text-term-text`}>{v}</td></tr>
  );
  return (
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="Model card" code="INDEM-20" accent right={<Tag tone="amber">{card.data_label}</Tag>}>
        <table className="w-full border-collapse tnum"><tbody>
          {row("Model version", card.model_version)}
          {row("Run", `${shortId(runId)} · ${(durationMs / 1000).toFixed(1)} s`)}
          {row("Run stamp", runStamp(result))}
          {row("View", `${card.mode} · ${card.horizon_days} business days · ${card.step} steps`)}
          {row("Snapshot hash", card.snapshot_hash)}
          {row("Profile", `${card.profile_name} · ${card.profile_hash}`)}
          {row("Convergence", conv.checked ? `max shift ${conv.max_shift_in_standard_errors?.toFixed(2)} standard errors on a path-count split: ${conv.passed ? "passed" : "FAILED"}` : "not checked (preview run)")}
        </tbody></table>
        <div className="border-t border-term-border px-3 py-2 text-3xs text-term-text-mute">{card.limitations}</div>
      </Panel>
      <Panel title="Validation checks" code="INDEM-21" accent>
        <table className="w-full border-collapse">
          <thead className="bg-term-panel-2"><tr><th className={`${TH} text-left`}>Check</th><th className={`${TH} text-left`}>Result</th><th className={`${TH} text-left`}>Note</th></tr></thead>
          <tbody>
            {card.validation.map((v) => (
              <tr key={v.check} className="border-b border-term-border-soft">
                <td className={`${TD} text-left text-term-text`}>{v.check.replace(/_/g, " ")}</td>
                <td className={`${TD} text-left`}><Tag tone={v.passed === null ? "neutral" : v.passed ? "up" : "down"}>{v.passed === null ? "Not assessed" : v.passed ? "Pass" : "Fail"}</Tag></td>
                <td className={`${TD} whitespace-normal text-left text-3xs text-term-text-mute`}>{v.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
