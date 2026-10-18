import { json } from "@/lib/server/http";
import { collateralProxy } from "@/lib/server/collateralOptimizerProxy";

export const runtime = "nodejs";

type ServiceHealth = "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";

const DEFAULT_MMKT_URL = "http://127.0.0.1:8014";
const PROBE_TIMEOUT_MS = 2500;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

async function probeService(baseUrl: string | undefined) {
  if (!baseUrl) {
    return {
      service_health: "UNCONFIGURED" as ServiceHealth,
      detail: "Service URL is not configured.",
    };
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
  } catch {
    return {
      service_health: "INCOMPATIBLE" as ServiceHealth,
      detail: "Configured service URL is invalid.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/health", url), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        service_health: "UNAVAILABLE" as ServiceHealth,
        detail: "Service health endpoint returned an error.",
      };
    }

    const health = (await response.json().catch(() => ({}))) as {
      status?: string;
      ready?: boolean;
      model_status?: string;
      api_schema_version?: string;
    };
    if (health.status === "ready" && health.ready === true) {
      return {
        service_health: "READY" as ServiceHealth,
        detail: "Service is reachable and reports ready.",
        model_status: health.model_status ?? null,
        api_schema_version: health.api_schema_version ?? null,
      };
    }
    if (health.status === "unconfigured" || health.ready === false) {
      return {
        service_health: "UNCONFIGURED" as ServiceHealth,
        detail: "Service is reachable but has no enabled model binding.",
        model_status: health.model_status ?? null,
        api_schema_version: health.api_schema_version ?? null,
      };
    }
    return {
      service_health: "INCOMPATIBLE" as ServiceHealth,
      detail: "Service health response does not match the expected contract.",
    };
  } catch {
    return {
      service_health: "UNAVAILABLE" as ServiceHealth,
      detail: "Service health endpoint could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeCollateral() {
  const response = await collateralProxy(new Request("http://terminal/api/collateral-optimizer/health"),
    "/health", "GET");
  const health = await response.json() as {
    code?: string; message?: string; readiness?: ServiceHealth;
    detail?: string; model_status?: string; api_schema_version?: string;
  };
  const state: ServiceHealth = response.ok ?
    (health.readiness ?? "INCOMPATIBLE") :
    health.code?.includes("INCOMPATIBLE") || health.code === "RESPONSE_INVALID" ? "INCOMPATIBLE" :
    health.code?.includes("UNCONFIGURED") || health.code === "PRODUCTION_DISABLED" ? "UNCONFIGURED" :
    "UNAVAILABLE";
  return { service_health: state, detail: health.detail ?? health.message ?? "Collateral service state is unavailable.",
    model_status: health.model_status ?? null, api_schema_version: health.api_schema_version ?? null };
}

export async function GET() {
  const mmktUrl = env("MONEY_MARKET_API_URL") ?? DEFAULT_MMKT_URL;
  const [mmkt, collateral] = await Promise.all([
    probeService(mmktUrl),
    probeCollateral(),
  ]);

  return json(
    {
      ok: true,
      approval: "No Spec015 model bindings are registered in the optimization registry yet.",
      connections: [
        {
          family: "MMKT",
          label: "Money Market",
          binding_status: "UNCONFIGURED" as const,
          service_health: mmkt.service_health,
          detail: mmkt.detail,
          model_status: "model_status" in mmkt ? mmkt.model_status : null,
          api_schema_version: "api_schema_version" in mmkt ? mmkt.api_schema_version : null,
        },
        {
          family: "COLL",
          label: "Collateral",
          binding_status: "UNCONFIGURED" as const,
          service_health: collateral.service_health,
          detail: collateral.detail,
          model_status: "model_status" in collateral ? collateral.model_status : null,
          api_schema_version: "api_schema_version" in collateral ? collateral.api_schema_version : null,
        },
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
