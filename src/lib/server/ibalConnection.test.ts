import { describe, expect, it } from "vitest";
import { ibalConnection } from "./ibalConnection";

const base = { reachable: true, ready: true, code: "IBAL_READY", detail: "ok" };

describe("ibalConnection", () => {
  it("is READY only when the engine reports ready", () => {
    expect(ibalConnection(base).service_health).toBe("READY");
    expect(ibalConnection({ ...base, ready: false, code: "IBAL_ENGINE_NOT_READY" }).service_health).not.toBe("READY");
  });
  it("flags a mismatched pinned engine as INCOMPATIBLE", () => {
    const row = ibalConnection({ ...base, ready: false, code: "IBAL_ENGINE_NOT_READY", health: { error_category: "incompatible_engine" } });
    expect(row.service_health).toBe("INCOMPATIBLE");
  });
  it("treats missing token and disabled production as UNCONFIGURED", () => {
    for (const code of ["IBAL_TOKEN_MISSING", "IBAL_PRODUCTION_DISABLED", "IBAL_TRUSTED_BOUNDARY_MISSING"]) {
      expect(ibalConnection({ reachable: false, ready: false, code, detail: "x" }).service_health).toBe("UNCONFIGURED");
    }
  });
  it("treats an unreachable service as UNAVAILABLE", () => {
    expect(ibalConnection({ reachable: false, ready: false, code: "IBAL_HEALTH_UNREACHABLE", detail: "x" }).service_health).toBe("UNAVAILABLE");
  });
  it("does not claim a Spec015 binding", () => {
    expect(ibalConnection(base).binding_status).toBe("ENGINE_PINNED");
  });
});
