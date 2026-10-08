import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/server/ecoiq", () => ({ readEcoIq: mocks.read }));
import { GET, POST } from "./route";

describe("/api/economics/ecoiq", () => {
  test("GET returns the attended explain workflow without caching", async () => {
    mocks.read.mockResolvedValue({ ok: true, module: "ECOIQ", workflow: "economics.explain", source: "macro_medallion" });
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.read).toHaveBeenCalledWith("Why did the Treasury curve move?", "economics.explain");
    await expect(response.json()).resolves.toMatchObject({ module: "ECOIQ" });
  });

  test("POST bounds the question and rejects unknown workflows to explain", async () => {
    mocks.read.mockResolvedValue({ ok: true, module: "ECOIQ", workflow: "economics.explain", source: "macro_medallion" });
    const response = await POST(new Request("http://localhost/api/economics/ecoiq", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "x".repeat(3000), workflow: "sql.execute" }),
    }));
    const [question, workflow] = mocks.read.mock.calls.at(-1)!;
    expect(question).toHaveLength(2000);
    expect(workflow).toBe("economics.explain");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
