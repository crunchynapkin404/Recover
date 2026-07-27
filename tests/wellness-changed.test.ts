import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Narrow two-key stub: this mock only supports the one call the gate
// actually makes (db.query.wellnessDaily.findFirst). Any future code in
// wellness-changed.ts that touches a different table or db method would
// silently get `undefined` here rather than a helpful error — if this file
// starts exercising more of @/lib/db, widen the mock rather than guessing.
const findFirstWellness = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      wellnessDaily: {
        findFirst: (...args: unknown[]) => findFirstWellness(...args),
      },
    },
  },
  schema: {
    wellnessDaily: { userId: "user_id", date: "date" },
  },
}));

describe("onWellnessDataChanged", () => {
  beforeEach(() => {
    runDailyAdaptation.mockClear();
    generateMorningInsight.mockClear();
    maybeSendMorningReadinessPush.mockClear();
    findFirstWellness.mockReset();
    findFirstWellness.mockResolvedValue({ hrvMs: 62, sleepSecs: 25000 });
  });

  afterEach(() => {
    // Belt-and-suspenders: guarantees real timers are restored even if a
    // test using vi.setSystemTime below throws before its own cleanup runs.
    vi.useRealTimers();
  });

  it("calls adaptation, insight, and push, returns 'fired' when insight is generated", async () => {
    // Fixed system time past the 4am floor (Fix 4): opts is omitted below,
    // so onWellnessDataChanged falls back to `new Date()` internally — a
    // real-clock default here would make this test flaky between
    // 00:00-03:59 local time.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 26, 9, 0, 0));
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
    vi.useRealTimers();
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

  // Fix 4: a non-forced trigger before 04:00 local (e.g. an overnight Apple
  // Health push) must not post the brief or push — but adaptation, which
  // isn't a user-facing notification, still runs.
  it("skips insight and push, but still adapts, before the 4am floor when not forced", async () => {
    const now = new Date(2026, 6, 26, 2, 0, 0); // 02:00 local
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    const outcome = await onWellnessDataChanged("user-5", { now });
    expect(outcome).toBe("skipped");
    expect(runDailyAdaptation).toHaveBeenCalledWith("user-5", now);
    expect(generateMorningInsight).not.toHaveBeenCalled();
    expect(maybeSendMorningReadinessPush).not.toHaveBeenCalled();
  });

  it("does not apply the 4am floor when force is true", async () => {
    generateMorningInsight.mockResolvedValue({
      text: "hi",
      warning: null,
      threadId: "t1",
    });
    const now = new Date(2026, 6, 26, 2, 0, 0); // 02:00 local, but forced
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    const outcome = await onWellnessDataChanged("user-6", {
      now,
      force: true,
    });
    expect(outcome).toBe("fired");
    expect(generateMorningInsight).toHaveBeenCalledWith("user-6", {
      now,
      force: true,
    });
    expect(maybeSendMorningReadinessPush).toHaveBeenCalledWith("user-6", now);
  });

  it("does not apply the floor at exactly 04:00 (boundary is inclusive of 4)", async () => {
    generateMorningInsight.mockResolvedValue({
      text: "hi",
      warning: null,
      threadId: "t1",
    });
    const now = new Date(2026, 6, 26, 4, 0, 0); // exactly 04:00 local
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    const outcome = await onWellnessDataChanged("user-7", { now });
    expect(outcome).toBe("fired");
    expect(generateMorningInsight).toHaveBeenCalledWith("user-7", {
      now,
      force: undefined,
    });
  });
});

describe("onWellnessDataChanged — overnight completeness gate", () => {
  beforeEach(() => {
    runDailyAdaptation.mockClear();
    generateMorningInsight.mockClear();
    maybeSendMorningReadinessPush.mockClear();
    findFirstWellness.mockReset();
    generateMorningInsight.mockResolvedValue({
      text: "hi",
      warning: null,
      threadId: "t1",
    });
  });

  const noon = new Date();
  noon.setHours(12, 0, 0, 0);

  it("skips the brief when HRV has not arrived", async () => {
    findFirstWellness.mockResolvedValue({ hrvMs: null, sleepSecs: 25000 });
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    expect(await onWellnessDataChanged("u", { now: noon })).toBe("skipped");
    expect(generateMorningInsight).not.toHaveBeenCalled();
    expect(maybeSendMorningReadinessPush).not.toHaveBeenCalled();
  });

  it("skips the brief when sleep has not arrived", async () => {
    findFirstWellness.mockResolvedValue({ hrvMs: 62, sleepSecs: null });
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    expect(await onWellnessDataChanged("u", { now: noon })).toBe("skipped");
    expect(generateMorningInsight).not.toHaveBeenCalled();
  });

  it("skips the brief when there is no wellness row at all", async () => {
    findFirstWellness.mockResolvedValue(undefined);
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    expect(await onWellnessDataChanged("u", { now: noon })).toBe("skipped");
    expect(generateMorningInsight).not.toHaveBeenCalled();
  });

  it("fires once both HRV and sleep have arrived", async () => {
    findFirstWellness.mockResolvedValue({ hrvMs: 62, sleepSecs: 25000 });
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    expect(await onWellnessDataChanged("u", { now: noon })).toBe("fired");
    expect(generateMorningInsight).toHaveBeenCalled();
  });

  // The 09:00 backstop must still be able to post an (honest, caveated)
  // brief precisely when the data never arrived.
  it("force bypasses the gate", async () => {
    findFirstWellness.mockResolvedValue({ hrvMs: null, sleepSecs: null });
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    expect(await onWellnessDataChanged("u", { now: noon, force: true })).toBe(
      "fired"
    );
    expect(generateMorningInsight).toHaveBeenCalled();
  });

  // Training-load adaptation does not depend on the overnight measurement,
  // so a blocked brief must not block it.
  it("still runs daily adaptation when the gate blocks the brief", async () => {
    findFirstWellness.mockResolvedValue({ hrvMs: null, sleepSecs: null });
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    await onWellnessDataChanged("u", { now: noon });
    expect(runDailyAdaptation).toHaveBeenCalledWith("u", noon);
  });

  // Fix: the gate's fail-closed catch is the branch's core safety property —
  // if the completeness read itself throws, we must not guess and fire a
  // brief we can't vouch for.
  it("fails closed when the completeness read throws", async () => {
    findFirstWellness.mockRejectedValue(new Error("boom"));
    const { onWellnessDataChanged } =
      await import("@/lib/sync/wellness-changed");
    expect(await onWellnessDataChanged("u", { now: noon })).toBe("skipped");
    expect(generateMorningInsight).not.toHaveBeenCalled();
    expect(maybeSendMorningReadinessPush).not.toHaveBeenCalled();
  });
});
