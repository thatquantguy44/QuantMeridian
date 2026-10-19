/** Maps the IBAL health snapshot onto the optimization-connections row shape. */
export type IbalServiceHealth = "READY" | "UNCONFIGURED" | "UNAVAILABLE" | "INCOMPATIBLE";

interface IbalSnapshot {
  reachable: boolean;
  ready: boolean;
  code: string;
  detail: string;
  health?: { error_category?: string; api_schema_version?: string };
}

const UNCONFIGURED_CODES = new Set(["IBAL_TOKEN_MISSING", "IBAL_PRODUCTION_DISABLED", "IBAL_TRUSTED_BOUNDARY_MISSING"]);

export function ibalConnection(snapshot: IbalSnapshot) {
  let service_health: IbalServiceHealth;
  if (snapshot.ready) service_health = "READY";
  else if (UNCONFIGURED_CODES.has(snapshot.code)) service_health = "UNCONFIGURED";
  else if (!snapshot.reachable) service_health = "UNAVAILABLE";
  else service_health = snapshot.health?.error_category === "incompatible_engine" ? "INCOMPATIBLE" : "UNAVAILABLE";
  return {
    family: "IBAL" as const,
    label: "InventoryBallast",
    // IBAL is gated by its own pinned-engine check, not a Spec015 model binding.
    binding_status: "ENGINE_PINNED" as const,
    service_health,
    detail: snapshot.detail,
    model_status: null,
    api_schema_version: snapshot.health?.api_schema_version ?? null,
  };
}
