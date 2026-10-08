import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("@/lib/server/volatilityForecaster", () => ({
  readVolatilityForecaster: mocks.read,
}));

import { GET } from "./route";

describe("/api/ml-tools/volatility-forecaster", () => {
  test("forwards the adapter status and disables caching", async () => {
    mocks.read.mockResolvedValue({
      status: 503,
      body: { ok: false, source: "ERR", code: "QR_HAVEN_UNAVAILABLE", message: "Unavailable." },
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "QR_HAVEN_UNAVAILABLE" });
  });
});
