import { describe, expect, test } from "vitest";
import { noProxyList } from "./fetchProxy";

describe("noProxyList", () => {
  test("always bypasses loopback even when NO_PROXY is unset", () => {
    expect(noProxyList({}).split(",")).toEqual(["localhost", "127.0.0.1", "::1"]);
  });

  test("keeps configured entries first and de-duplicates loopback", () => {
    expect(noProxyList({ NO_PROXY: "internal.example, 127.0.0.1" })).toBe("internal.example,127.0.0.1,localhost,::1");
    expect(noProxyList({ no_proxy: "svc.local" })).toBe("svc.local,localhost,127.0.0.1,::1");
  });
});
