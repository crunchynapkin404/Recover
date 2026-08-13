import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { HistoryStatStrip } from "./history-stat-strip";

const stats = [
  { value: "8.4h" },
  { value: "412", label: "load" },
  { value: "5", label: "sessions" },
  { value: "187", label: "km" },
];

describe("HistoryStatStrip", () => {
  it("renders the scope and every figure it is given", () => {
    const html = renderToString(
      <HistoryStatStrip scope="7 days" stats={stats} />
    );
    expect(html).toContain("7 days");
    expect(html).toContain("8.4h");
    expect(html).toContain("412");
    expect(html).toContain("sessions");
    expect(html).toContain("187");
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(
      <HistoryStatStrip scope="7 days" stats={stats} />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});
