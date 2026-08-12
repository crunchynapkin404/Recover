import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BedtimeCard } from "./bedtime-card";

describe("BedtimeCard", () => {
  it("renders the bed-by time and the debt it is paying back", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" debtSecs={2520} confidence="high" />
    );
    expect(html).toContain("22:45");
    expect(html).toContain("debt 42m");
  });

  it("renders nothing without a bedtime", () => {
    expect(
      renderToString(
        <BedtimeCard bedtime={null} debtSecs={2520} confidence="high" />
      )
    ).toBe("");
  });

  it("switches long debts to hours rather than printing three digits of minutes", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" debtSecs={81540} confidence="high" />
    );
    expect(html).toContain("22.7h");
    expect(html).not.toContain("1359m");
  });

  it("still renders the target when there is no debt to pay back", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" debtSecs={0} confidence="high" />
    );
    expect(html).toContain("22:45");
    expect(html).not.toContain("debt");
  });

  it("still renders the target when debtSecs is null (no debt data)", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" debtSecs={null} confidence="high" />
    );
    expect(html).toContain("22:45");
    expect(html).not.toContain("debt");
  });

  it("marks a low-confidence figure", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" debtSecs={2520} confidence="low" />
    );
    expect(html).toContain("Low confidence");
  });

  it("uses the token type and ink scales", () => {
    const html = renderToString(
      <BedtimeCard bedtime="22:45" debtSecs={2520} confidence="high" />
    );
    expect(html).toContain("text-figure");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });
});
