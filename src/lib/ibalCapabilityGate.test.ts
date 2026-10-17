import { describe, expect, it } from "vitest";
import {
  engineBlockReason,
  featureBlockReason,
  formulationBlockReason,
  hasOutputSection,
  uploadAccept,
  uploadBlockReason,
} from "@/lib/ibalCapabilityGate";
import type { IbalCapabilities, IbalHealth } from "@/lib/inventoryOptimizer";

const READY_HEALTH: IbalHealth = {
  status: "ready",
  ready: true,
  engine_mismatches: [],
  error_category: null,
  formulations: ["lp", "mip", "qp"],
  backend: { name: "highs", version: "1.11.0", ready: true },
};

const CAPABILITIES: IbalCapabilities = {
  engine_compatible: true,
  engine_commit: "e84801b65a4d1c23b19cb34b0de1e217f6b345f9",
  engine_fingerprint: "4312cd76",
  engine_package_version: "0.1.0",
  engine_source: "path",
  backend: { name: "highs", version: "1.11.0", ready: true },
  formulations: ["lp", "mip", "qp"],
  input_features: { scenarios: true, fee_tier_authoring: false, all_or_none_routes: true },
  output_sections: ["allocations", "scenario_stress"],
  upload_formats: ["xlsx", "json"],
  limits: { upload_bytes: 10 * 1024 * 1024 },
};

describe("engineBlockReason", () => {
  it("allows solving only when health is ready and capabilities are loaded", () => {
    expect(engineBlockReason(READY_HEALTH, CAPABILITIES)).toBeNull();
    expect(engineBlockReason(READY_HEALTH, null)).toMatch(/capabilities are unavailable/);
    expect(engineBlockReason(null, CAPABILITIES)).toMatch(/Checking/);
  });

  it("reports an unreachable service", () => {
    expect(engineBlockReason({ status: "unavailable", ready: false }, null)).toMatch(/unavailable/);
  });

  it("names each identity mismatch for an incompatible engine", () => {
    const health: IbalHealth = { status: "unready", ready: false, error_category: "incompatible_engine", engine_mismatches: ["fingerprint", "commit"] };
    expect(engineBlockReason(health, { ...CAPABILITIES, engine_compatible: false })).toBe(
      "Installed engine does not match the pin (source fingerprint, commit)."
    );
  });

  it("blocks on capabilities reporting incompatibility even if health raced ahead", () => {
    expect(engineBlockReason(READY_HEALTH, { ...CAPABILITIES, engine_compatible: false })).toMatch(/does not match the pin/);
  });

  it("reports a missing solver backend", () => {
    const health: IbalHealth = { status: "unready", ready: false, error_category: "optimizer_backend_unavailable" };
    expect(engineBlockReason(health, null)).toMatch(/No solver backend/);
  });
});

describe("feature, formulation and section gates", () => {
  it("follows the manifest's input features", () => {
    expect(featureBlockReason(CAPABILITIES, "scenarios")).toBeNull();
    expect(featureBlockReason(CAPABILITIES, "fee_tier_authoring")).toBe("Not supported by the pinned engine (fee tier authoring).");
    expect(featureBlockReason(CAPABILITIES, "unknown_feature")).not.toBeNull();
    expect(featureBlockReason(null, "scenarios")).not.toBeNull();
  });

  it("follows the formulations the installed backend can solve", () => {
    expect(formulationBlockReason(CAPABILITIES, "mip")).toBeNull();
    const scipyOnly = { ...CAPABILITIES, backend: { name: "scipy_highs", version: "1.16", ready: true }, formulations: ["lp", "mip"] };
    expect(formulationBlockReason(scipyOnly, "qp")).toBe("QP is not available with the installed solver (scipy_highs).");
  });

  it("treats unknown capabilities as no output section", () => {
    expect(hasOutputSection(CAPABILITIES, "scenario_stress")).toBe(true);
    expect(hasOutputSection(CAPABILITIES, "sensitivity")).toBe(false);
    expect(hasOutputSection(null, "allocations")).toBe(false);
  });
});

describe("upload gates", () => {
  it("accepts advertised formats within the size limit", () => {
    expect(uploadBlockReason(CAPABILITIES, { name: "Book.XLSX", size: 1024 })).toBeNull();
    expect(uploadAccept(CAPABILITIES)).toBe(".xlsx,.json");
  });

  it("rejects unadvertised formats and oversized files before sending", () => {
    expect(uploadBlockReason(CAPABILITIES, { name: "book.csv", size: 10 })).toBe('Unsupported file type ".csv". Upload XLSX or JSON.');
    expect(uploadBlockReason(CAPABILITIES, { name: "book", size: 10 })).toMatch(/Unsupported file type/);
    expect(uploadBlockReason(CAPABILITIES, { name: "big.json", size: 11 * 1024 * 1024 })).toBe(
      "File is 11.0 MB; the service accepts at most 10.0 MB."
    );
  });

  it("leaves validation to the service when capabilities are unknown", () => {
    expect(uploadBlockReason(null, { name: "book.csv", size: 10 })).toBeNull();
  });
});
