import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineChart } from "./LineChart";

const render = (data: number[], extra: object = {}) =>
  renderToStaticMarkup(createElement(LineChart, { series: [{ name: "s", data, color: "#fff" }], yFmt: (n: number) => `${n.toFixed(2)}%`, ...extra }));

describe("LineChart", () => {
  it("renders an empty state, not NaN ticks, when a series has no points", () => {
    const html = render([]);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("No data available");
  });

  it("treats a series of only non-finite values as empty", () => {
    const html = render([Number.NaN, Number.POSITIVE_INFINITY]);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("No data available");
  });

  it("renders no series at all without NaN", () => {
    const html = renderToStaticMarkup(createElement(LineChart, { series: [] }));
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("draws a single point without dividing by zero", () => {
    const html = render([4.1]);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("<path");
  });

  it("draws normal data with formatted ticks", () => {
    const html = render([1, 2, 3, 4]);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("1.00%");
    expect(html).toContain("4.00%");
  });

  it("skips a non-finite point instead of poisoning the path", () => {
    const html = render([1, Number.NaN, 3]);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html.match(/M\d/g)?.length).toBe(2);
  });
});
