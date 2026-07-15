import { describe, expect, it } from "vitest";
import { renderChart } from "./render-chart";

describe("render_chart tool", () => {
  it("validates a minimal line chart spec", () => {
    const result = renderChart.parameters.safeParse({
      type: "line",
      title: "CTL trend",
      series: [{ label: "CTL", data: [{ x: 1, y: 80 }, { x: 2, y: 82 }] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown chart types", () => {
    const result = renderChart.parameters.safeParse({
      type: "pie",
      title: "Bad",
      series: [{ label: "X", data: [{ x: 1, y: 1 }] }],
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one series", () => {
    const result = renderChart.parameters.safeParse({
      type: "bar",
      title: "Empty",
      series: [],
    });
    expect(result.success).toBe(false);
  });

  it("execute returns artifact envelope with spec", async () => {
    const parsed = renderChart.parameters.parse({
      type: "line",
      title: "Test",
      series: [{ label: "A", data: [{ x: 1, y: 10 }] }],
    });
    const result = await renderChart.execute(parsed, {
      userId: "u1",
      db: {} as never,
    });
    expect(result).toMatchObject({
      artifact: true,
      spec: parsed,
    });
    expect((result as { chartId: string }).chartId).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });

  it("accepts string x-values (dates)", () => {
    const result = renderChart.parameters.safeParse({
      type: "bar",
      title: "Weekly load",
      series: [{
        label: "Load",
        data: [
          { x: "Mon", y: 120 },
          { x: "Tue", y: 0 },
          { x: "Wed", y: 85 },
        ],
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts annotations", () => {
    const result = renderChart.parameters.safeParse({
      type: "line",
      title: "CTL projection",
      series: [{ label: "CTL", data: [{ x: 1, y: 80 }] }],
      annotations: [{ x: 12, label: "Race day", color: "rose-500" }],
    });
    expect(result.success).toBe(true);
  });
});
