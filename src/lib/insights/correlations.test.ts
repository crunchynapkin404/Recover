import { describe, expect, it } from "vitest";
import { correlateTags } from "./correlations";
import { AUTO_TAG_REST, AUTO_TAG_DOUBLE } from "./auto-tags";

// 2026-08-03 is a Monday. Builder: n consecutive days from a start date.
function dates(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00`);
  for (let i = 0; i < n; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}

describe("correlateTags", () => {
  it("computes a conclusive two-sample impact with CI", () => {
    // 30 days; tag on the first 10. Readiness next day: 60 after tagged
    // days, 80 after untagged — large separation, tiny variance.
    const days = dates("2026-08-03", 30);
    const manualTagsByDate = new Map(
      days.slice(0, 10).map((d) => [d, ["🍷 Alcohol"]])
    );
    const readinessByDate = new Map<string, number>();
    days.forEach((d, i) => {
      const next = dates(d, 2)[1];
      readinessByDate.set(next, i < 10 ? 60 + (i % 2) : 80 + (i % 2));
    });
    const out = correlateTags({
      manualTagsByDate,
      autoTagsByDate: new Map(),
      readinessByDate,
    });
    expect(out).toHaveLength(1);
    const row = out[0];
    expect(row.behavior).toBe("Alcohol");
    expect(row.emoji).toBe("🍷");
    expect(row.auto).toBe(false);
    expect(row.events).toBe(10);
    expect(row.impactPct).toBeLessThan(-20); // ≈ (60.5−80.5)/80.5 ≈ −25%
    expect(row.conclusive).toBe(true);
    expect(row.ciHalfWidthPct).toBeLessThan(Math.abs(row.impactPct));
  });

  it("hides tags under 5 events; marks noisy ones inconclusive", () => {
    const days = dates("2026-08-03", 40);
    const manualTagsByDate = new Map<string, string[]>([
      ...days.slice(0, 4).map((d) => [d, ["☕ Rare"]] as [string, string[]]),
      // 6 events, but readiness is pure noise around the same mean:
      ...days.slice(10, 16).map((d) => [d, ["🧊 Noisy"]] as [string, string[]]),
    ]);
    const readinessByDate = new Map<string, number>();
    days.forEach((d, i) => {
      readinessByDate.set(dates(d, 2)[1], 70 + ((i * 7) % 11) - 5);
    });
    const out = correlateTags({
      manualTagsByDate,
      autoTagsByDate: new Map(),
      readinessByDate,
    });
    expect(out.find((r) => r.behavior === "Rare")).toBeUndefined();
    const noisy = out.find((r) => r.behavior === "Noisy")!;
    expect(noisy.conclusive).toBe(false);
  });

  it("auto flag: set for engine tags, cleared when also used manually", () => {
    const days = dates("2026-08-03", 30);
    const autoTagsByDate = new Map(
      days.slice(0, 10).map((d) => [d, [AUTO_TAG_REST]])
    );
    // The athlete also typed the rest tag by hand on one day.
    const manualTagsByDate = new Map([[days[20], [AUTO_TAG_REST]]]);
    const readinessByDate = new Map<string, number>();
    days.forEach((d, i) =>
      readinessByDate.set(dates(d, 2)[1], i < 10 ? 85 : 65)
    );
    const withManual = correlateTags({
      manualTagsByDate,
      autoTagsByDate,
      readinessByDate,
    });
    expect(withManual[0].auto).toBe(false);
    const autoOnly = correlateTags({
      manualTagsByDate: new Map(),
      autoTagsByDate,
      readinessByDate,
    });
    expect(autoOnly[0].auto).toBe(true);
  });

  it("weekday/weekend splits gate at 5 events per side", () => {
    // Tag every day for 6 weeks: 30 weekday events, 12 weekend events.
    const days = dates("2026-08-03", 42);
    const manualTagsByDate = new Map(days.map((d) => [d, ["😴 Nap"]]));
    // Untagged baseline comes from 4 more untagged weeks.
    const base = dates("2026-09-14", 28);
    const readinessByDate = new Map<string, number>();
    [...days, ...base].forEach((d, i) => {
      const tagged = i < days.length;
      readinessByDate.set(dates(d, 2)[1], (tagged ? 75 : 65) + (i % 3));
    });
    const out = correlateTags({
      manualTagsByDate,
      autoTagsByDate: new Map(),
      readinessByDate,
    });
    const row = out.find((r) => r.behavior === "Nap")!;
    expect(row.splits.weekday).not.toBeNull();
    expect(row.splits.weekend).not.toBeNull();
    expect(row.splits.weekday!.events).toBe(30);
    expect(row.splits.weekend!.events).toBe(12);
  });

  it("sorts conclusive by |impact| desc, then inconclusive by events desc", () => {
    const days = dates("2026-08-03", 60);
    const manualTagsByDate = new Map<string, string[]>();
    days
      .slice(0, 8)
      .forEach((d) =>
        manualTagsByDate.set(d, ["💊 Big", ...(manualTagsByDate.get(d) ?? [])])
      );
    days.slice(20, 28).forEach((d) => manualTagsByDate.set(d, ["🧘 Small"]));
    days.slice(40, 52).forEach((d) => manualTagsByDate.set(d, ["📱 Flat"]));
    const readinessByDate = new Map<string, number>();
    days.forEach((d, i) => {
      let r = 70;
      if (i < 8)
        r = 40; // Big: −30 points
      else if (i >= 20 && i < 28)
        r = 60; // Small: −10 points
      else if (i >= 40 && i < 52) r = 70 + ((i % 2) * 30 - 15); // Flat: noise
      readinessByDate.set(dates(d, 2)[1], r + (i % 2));
    });
    const out = correlateTags({
      manualTagsByDate,
      autoTagsByDate: new Map(),
      readinessByDate,
    });
    const order = out.map((r) => r.behavior);
    expect(order.indexOf("Big")).toBeLessThan(order.indexOf("Small"));
    expect(order.indexOf("Small")).toBeLessThan(order.indexOf("Flat"));
    expect(out.find((r) => r.behavior === "Flat")!.conclusive).toBe(false);
  });

  it("parses keycap emoji tags like Double day", () => {
    const days = dates("2026-08-03", 30);
    const autoTagsByDate = new Map(
      days.slice(0, 10).map((d) => [d, [AUTO_TAG_DOUBLE]])
    );
    const readinessByDate = new Map<string, number>();
    days.forEach((d, i) =>
      readinessByDate.set(dates(d, 2)[1], i < 10 ? 60 : 80)
    );
    const out = correlateTags({
      manualTagsByDate: new Map(),
      autoTagsByDate,
      readinessByDate,
    });
    expect(out[0].emoji).toBe("2️⃣");
    expect(out[0].behavior).toBe("Double day");
    expect(out[0].auto).toBe(true);
  });
});
