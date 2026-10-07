import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSecretShapedValues, secretShape } from "./secretShape";

const fixtures = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../contracts/agent/fixtures/settings/secret-shapes.json"), "utf8"),
) as { reject: { kind: string; value: string }[]; accept: string[] };

const FILL: Record<string, string> = { x: "x", a: "a", A: "A", n: "1" };
const expand = (template: string) => template.replace(/\{([xaAn])(\d+)\}/g, (_m, c: string, n: string) => FILL[c].repeat(Number(n)));

describe("secretShape (shared fixtures)", () => {
  it.each(fixtures.reject.map((r) => [r.kind, r.value] as const))("rejects %s: %s", (kind, template) => {
    expect(secretShape(expand(template))).toBe(kind);
  });

  it.each(fixtures.accept)("accepts %s", (value) => {
    expect(secretShape(expand(value))).toBeNull();
  });
});

describe("findSecretShapedValues", () => {
  it("reports the path of values and keys, however deep", () => {
    const doc = {
      profiles: { p: { label: "ok", note: expand("sk-{x32}"), nested: [{ url: "https://a.example" }] } },
      [expand("ghp_{x24}")]: 1,
    };
    const hits = findSecretShapedValues(doc).map((h) => h.path).sort();
    expect(hits).toEqual(
      ["/profiles/p/nested/0/url", "/profiles/p/note", `/${expand("ghp_{x24}")} (key)`].sort(),
    );
  });

  it("finds nothing in the shipped settings files", () => {
    for (const file of ["settings/agent_workflows.json", "settings/llm_profiles.json"]) {
      const doc = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../..", file), "utf8"));
      expect(findSecretShapedValues(doc), file).toEqual([]);
    }
  });
});
