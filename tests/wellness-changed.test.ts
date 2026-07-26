import { beforeEach, describe, expect, it, vi } from "vitest";

const runDailyAdaptation = vi.fn().mockResolvedValue("adapted");
vi.mock("@/lib/week-plan/service", () => ({
  runDailyAdaptation: (...args: unknown[]) => runDailyAdaptation(...args),
}));

const generateMorningInsight = vi.fn();
vi.mock("@/lib/morning-insight", () => ({
  generateMorningInsight: (...args: unknown[]) =>
    generateMorningInsight(...args),
}));

const maybeSendMorningReadinessPush = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/push", () => ({
  maybeSendMorningReadinessPush: (...args: unknown[]) =>
    maybeSendMorningReadinessPush(...args),
}));

describe("onWellnessDataChanged", () => {
  beforeEach(() => {
    runDailyAdaptation.mockClear();
    generateMorningInsight.mockClear();
    maybeSendMorningReadinessPush.mockClear();
  });

  it("calls adaptation, insight, and push, returns 'fired' when insight is generated", async () => {
    generateMorningInsight.mockResolvedValue({
      text: "hi",
      warning: null,
      threadId: "t1",
    });
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    const outcome = await onWellnessDataChanged("user-1");
    expect(outcome).toBe("fired");
    expect(runDailyAdaptation).toHaveBeenCalledWith("user-1", undefined);
    expect(generateMorningInsight).toHaveBeenCalledWith("user-1", {
      now: undefined,
      force: undefined,
    });
    expect(maybeSendMorningReadinessPush).toHaveBeenCalledWith(
      "user-1",
      undefined
    );
  });

  it("returns 'skipped' when generateMorningInsight skips", async () => {
    generateMorningInsight.mockResolvedValue("skipped");
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    expect(await onWellnessDataChanged("user-2")).toBe("skipped");
  });

  it("passes force and now through to generateMorningInsight and the others", async () => {
    generateMorningInsight.mockResolvedValue("skipped");
    const now = new Date("2026-07-26T09:00:00Z");
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    await onWellnessDataChanged("user-3", { force: true, now });
    expect(generateMorningInsight).toHaveBeenCalledWith("user-3", {
      now,
      force: true,
    });
    expect(runDailyAdaptation).toHaveBeenCalledWith("user-3", now);
    expect(maybeSendMorningReadinessPush).toHaveBeenCalledWith("user-3", now);
  });

  it("never throws when a sub-step rejects, and still returns a result", async () => {
    runDailyAdaptation.mockRejectedValueOnce(new Error("boom"));
    generateMorningInsight.mockRejectedValueOnce(new Error("boom2"));
    maybeSendMorningReadinessPush.mockRejectedValueOnce(new Error("boom3"));
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    await expect(onWellnessDataChanged("user-4")).resolves.toBe("skipped");
  });
});
