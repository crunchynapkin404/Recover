import { describe, expect, it, vi, beforeEach } from "vitest";

const icuRequest = vi.fn();
vi.mock("@/lib/connectors/intervals", () => ({
  icuRequest: (...a: unknown[]) => icuRequest(...a),
}));

const { exportWorkoutToIcu } = await import("./export-workout");
const { withPurpose } = await import("@/lib/training-plan");

const DATE = "2026-09-01";
const bike = withPurpose({
  day: 0,
  sport: "Bike",
  type: "Tempo",
  durationMins: 75,
  intensity: "Z4",
  description: "x",
  blockIdx: 0,
});

let updated: unknown;
function fakeDb(opts: {
  week?: unknown;
  conn?: unknown;
}): Parameters<typeof exportWorkoutToIcu>[0] {
  updated = undefined;
  return {
    query: {
      weekPlans: { findFirst: async () => opts.week },
      connections: { findFirst: async () => opts.conn },
    },
    update: () => ({
      set: (v: unknown) => ({
        where: async () => {
          updated = v;
        },
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const week = () => ({
  id: "w1",
  days: [{ date: DATE, workouts: [{ ...bike }] }],
});
const activeConn = {
  status: "active",
  encryptedAccessToken: "e",
  externalAthleteId: "1",
};

beforeEach(() => {
  icuRequest.mockReset();
  icuRequest.mockResolvedValue({ id: 1 });
});

describe("exportWorkoutToIcu", () => {
  it("posts a WORKOUT event carrying the rendered structure", async () => {
    const res = await exportWorkoutToIcu(
      fakeDb({ week: week(), conn: activeConn }),
      "u1",
      DATE,
      0,
      new Date("2026-09-01T07:00:00Z")
    );
    expect(res.ok).toBe(true);
    const [, path, opts] = icuRequest.mock.calls[0] as [
      unknown,
      string,
      { body: Record<string, string> },
    ];
    expect(path).toBe("/athlete/{id}/events");
    expect(opts.body.category).toBe("WORKOUT");
    expect(opts.body.start_date_local.startsWith(DATE)).toBe(true);
    // The structure itself, in the syntax get-workout-syntax.ts documents.
    expect(opts.body.description).toContain("Main set");
    expect(opts.body.description).toMatch(/- \d+m \d+/);
  });

  it("pins what it sent, with all four fields", async () => {
    await exportWorkoutToIcu(
      fakeDb({ week: week(), conn: activeConn }),
      "u1",
      DATE,
      0,
      new Date("2026-09-01T07:00:00Z")
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pin = (updated as any).days[0].workouts[0].pin;
    expect(pin.workoutId).toBeTruthy();
    expect(pin.exportedAt).toBe("2026-09-01T07:00:00.000Z");
    // purpose and durationMins AS THEY WERE — this is what makes staleness a
    // comparison against the session rather than a re-derivation.
    expect(pin.purpose).toBe("threshold");
    expect(pin.durationMins).toBe(75);
  });

  it("does NOT pin when intervals.icu refuses", async () => {
    // A pin without a calendar entry claims an export that never happened —
    // the athlete would see "exported" for a workout their device never got.
    icuRequest.mockRejectedValue(new Error("401 Unauthorized"));
    const res = await exportWorkoutToIcu(
      fakeDb({ week: week(), conn: activeConn }),
      "u1",
      DATE,
      0,
      new Date()
    );
    expect(res).toMatchObject({ ok: false, reason: "icu-failed" });
    expect(updated).toBeUndefined();
  });

  it("refuses without an active connection, and never calls intervals.icu", async () => {
    for (const conn of [undefined, { status: "revoked" }]) {
      const res = await exportWorkoutToIcu(
        fakeDb({ week: week(), conn }),
        "u1",
        DATE,
        0,
        new Date()
      );
      expect(res).toMatchObject({ ok: false, reason: "no-connection" });
    }
    expect(icuRequest).not.toHaveBeenCalled();
    expect(updated).toBeUndefined();
  });

  it("refuses a session the library cannot answer, without posting", async () => {
    const res = await exportWorkoutToIcu(
      fakeDb({
        week: {
          id: "w1",
          days: [{ date: DATE, workouts: [{ ...bike, sport: "Run" }] }],
        },
        conn: activeConn,
      }),
      "u1",
      DATE,
      0,
      new Date()
    );
    expect(res).toMatchObject({ ok: false, reason: "no-workout" });
    expect(icuRequest).not.toHaveBeenCalled();
  });

  it("refuses a day or index the week does not hold", async () => {
    for (const [d, i] of [
      ["2026-12-25", 0],
      [DATE, 4],
    ] as [string, number][]) {
      const res = await exportWorkoutToIcu(
        fakeDb({ week: week(), conn: activeConn }),
        "u1",
        d,
        i,
        new Date()
      );
      expect(res).toMatchObject({ ok: false, reason: "no-session" });
    }
    expect(icuRequest).not.toHaveBeenCalled();
  });

  it("leaves every other session's pin alone", async () => {
    const two = {
      id: "w1",
      days: [
        { date: DATE, workouts: [{ ...bike }, { ...bike, durationMins: 60 }] },
      ],
    };
    await exportWorkoutToIcu(
      fakeDb({ week: two, conn: activeConn }),
      "u1",
      DATE,
      1,
      new Date()
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = (updated as any).days[0].workouts;
    expect(ws[0].pin).toBeUndefined();
    expect(ws[1].pin.durationMins).toBe(60);
  });
});
