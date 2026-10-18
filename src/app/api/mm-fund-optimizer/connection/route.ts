import { json } from "@/lib/server/http";

export const runtime = "nodejs";

type Readiness = "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";
const PROBE_TIMEOUT_MS = 2500;

function configuredUrl(): URL | null {
  const value = process.env.MM_FUND_OPTIMIZER_API_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET() {
  const baseUrl = configuredUrl();
  if (!baseUrl) {
    const configured = Boolean(process.env.MM_FUND_OPTIMIZER_API_URL?.trim());
    return json({
      binding_status: "UNCONFIGURED" as const,
      service_health: configured ? "INCOMPATIBLE" as Readiness : "UNCONFIGURED" as Readiness,
      detail: configured ? "Configured model service URL is invalid." : "External fund model service is not configured.",
      model_revision: null,
      api_schema_version: null,
      solve_enabled: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/health", baseUrl), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return json({
        binding_status: "UNCONFIGURED" as const,
        service_health: "UNAVAILABLE" as Readiness,
        detail: "Model service health endpoint returned an error.",
        model_revision: null,
        api_schema_version: null,
        solve_enabled: false,
      }, { headers: { "cache-control": "no-store" } });
    }

    const health = await response.json().catch(() => ({})) as {
      status?: string;
      ready?: boolean;
      model_revision?: string;
      api_schema_version?: string;
    };
    if (health.status === "ready" && health.ready === true) {
      return json({
        binding_status: "UNCONFIGURED" as const,
        service_health: "READY" as Readiness,
        detail: "Model service is reachable. Its binding still requires Spec015 approval.",
        model_revision: health.model_revision ?? null,
        api_schema_version: health.api_schema_version ?? null,
        solve_enabled: false,
      }, { headers: { "cache-control": "no-store" } });
    }
    if (health.status === "unconfigured" || health.ready === false) {
      return json({
        binding_status: "UNCONFIGURED" as const,
        service_health: "UNCONFIGURED" as Readiness,
        detail: "Model service is reachable but reports no active model.",
        model_revision: health.model_revision ?? null,
        api_schema_version: health.api_schema_version ?? null,
        solve_enabled: false,
      }, { headers: { "cache-control": "no-store" } });
    }
    return json({
      binding_status: "UNCONFIGURED" as const,
      service_health: "INCOMPATIBLE" as Readiness,
      detail: "Model service health response does not match the expected contract.",
      model_revision: null,
      api_schema_version: null,
      solve_enabled: false,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return json({
      binding_status: "UNCONFIGURED" as const,
      service_health: "UNAVAILABLE" as Readiness,
      detail: "Model service health endpoint could not be reached.",
      model_revision: null,
      api_schema_version: null,
      solve_enabled: false,
    }, { headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }
}
