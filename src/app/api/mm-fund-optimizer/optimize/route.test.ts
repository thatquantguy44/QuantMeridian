import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/mm-fund-optimizer/optimize", () => {
  it("runs the synthetic demo allocation when explicitly enabled", async () => {
    const response = await POST(new Request("http://localhost/api/mm-fund-optimizer/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        synthetic_mode: true,
        total_cash: 10_000_000,
        cash_reserve_pct: 10,
        min_same_day_pct: 30,
        max_prime_pct: 40,
        max_single_fund_pct: 25,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result.dataset_id).toBe("mmfo-demo-us-institutional-2026-10-16");
    expect(body.result.allocations.some((row: { allocated_amount: number }) => row.allocated_amount > 0)).toBe(true);
    expect(body.result.checks.every((check: { passed: boolean }) => check.passed)).toBe(true);
  });

  it("refuses to run when synthetic mode is off", async () => {
    const response = await POST(new Request("http://localhost/api/mm-fund-optimizer/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        synthetic_mode: false,
        total_cash: 10_000_000,
        cash_reserve_pct: 10,
        min_same_day_pct: 30,
        max_prime_pct: 40,
        max_single_fund_pct: 25,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/synthetic demo mode/i);
  });
});
