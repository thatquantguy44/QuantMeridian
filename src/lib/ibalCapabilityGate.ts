// IBAL workbench gating from the service's own health and capability manifest (spec013
// IBAL-002/003, AC-002). Every answer here is read from what the pinned engine service reports;
// nothing re-derives engine support client-side. Each gate returns a human-readable reason when
// an action is unavailable, so the UI can say why instead of hiding the control.
import type { IbalCapabilities, IbalHealth } from "@/lib/inventoryOptimizer";

const MISMATCH_LABELS: Record<string, string> = {
  version: "package version",
  fingerprint: "source fingerprint",
  commit: "commit",
  engine_not_importable: "engine not importable",
  engine_path_not_used: "configured engine path not used",
};

/** Why the service cannot solve right now, or null when it is ready to. */
export function engineBlockReason(health: IbalHealth | null, capabilities: IbalCapabilities | null): string | null {
  if (!health) return "Checking optimizer service health...";
  if (health.status === "unavailable") return "Optimizer service is unavailable. Start services/inventory_optimizer_api and reload.";
  if (health.error_category === "incompatible_engine" || capabilities?.engine_compatible === false) {
    const mismatches = (health.engine_mismatches ?? []).map((item) => MISMATCH_LABELS[item] ?? item);
    return `Installed engine does not match the pin${mismatches.length ? ` (${mismatches.join(", ")})` : ""}.`;
  }
  if (health.error_category === "optimizer_backend_unavailable") return "No solver backend is installed in the optimizer service.";
  if (!health.ready) return "Optimizer service is not ready.";
  if (!capabilities) return "Engine capabilities are unavailable.";
  return null;
}

/** Why the pinned engine cannot accept a named input feature, or null when it can. */
export function featureBlockReason(capabilities: IbalCapabilities | null, feature: string): string | null {
  if (!capabilities) return "Engine capabilities are unavailable.";
  return capabilities.input_features[feature] ? null : `Not supported by the pinned engine (${feature.replaceAll("_", " ")}).`;
}

/** Why the pinned engine cannot solve a formulation (lp, mip, qp), or null when it can. */
export function formulationBlockReason(capabilities: IbalCapabilities | null, formulation: string): string | null {
  if (!capabilities) return "Engine capabilities are unavailable.";
  if (capabilities.formulations.includes(formulation)) return null;
  const backend = capabilities.backend.name ?? "no backend";
  return `${formulation.toUpperCase()} is not available with the installed solver (${backend}).`;
}

/** Whether the service will return a result section; unknown capabilities mean no. */
export function hasOutputSection(capabilities: IbalCapabilities | null, section: string): boolean {
  return Boolean(capabilities?.output_sections.includes(section));
}

/** Rejects a file the service is certain to refuse, before it is sent. */
export function uploadBlockReason(capabilities: IbalCapabilities | null, file: { name: string; size: number }): string | null {
  if (!capabilities) return null; // the service still validates; this is only an early, local check
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!capabilities.upload_formats.includes(extension)) {
    return `Unsupported file type ".${extension}". Upload ${capabilities.upload_formats.map((item) => item.toUpperCase()).join(" or ")}.`;
  }
  const limit = capabilities.limits.upload_bytes;
  if (limit !== undefined && file.size > limit) {
    return `File is ${formatMegabytes(file.size)}; the service accepts at most ${formatMegabytes(limit)}.`;
  }
  return null;
}

/** The upload input's accept attribute, from the advertised formats. */
export function uploadAccept(capabilities: IbalCapabilities | null): string {
  return (capabilities?.upload_formats ?? ["json", "xlsx"]).map((item) => `.${item}`).join(",");
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
