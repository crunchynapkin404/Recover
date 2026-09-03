import { describe, expect, it, vi, beforeEach } from "vitest";
import { blockPlacement } from "@/lib/week-plan/placement";

// The route's two dependencies that reach outside it: the session, and the
// week. Both mocked, because what this file is about is the route's own
// contract — validation, refusal, and the bytes it hands back.
const getSession = vi.fn();
const getOpenWeekPlan = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: () => getSession() } },
}));
vi.mock("@/lib/week-plan/service", () => ({
  getOpenWeekPlan: (...a: unknown[]) => getOpenWeekPlan(...a),
}));

const { GET } = await import("@/app/api/workout/zwo/route");
const { withPurpose } = await import("@/lib/training-plan");

const DATE = "2026-09-01";
const bike = withPurpose({
  day: 0,
  sport: "Bike",
  type: "Tempo",
  durationMins: 75,
  intensity: "Z4",
  description: "x",
  placement: blockPlacement(0),
});

const req = (qs: string) => new Request(`http://x/api/workout/zwo?${qs}`);

beforeEach(() => {
  getSession.mockReset();
  getOpenWeekPlan.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" } });
  getOpenWeekPlan.mockResolvedValue({
    days: [{ date: DATE, workouts: [bike] }],
  });
});

describe("/api/workout/zwo", () => {
  it("401s without a session, before touching the week at all", async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req(`date=${DATE}`));
    expect(res.status).toBe(401);
    expect(getOpenWeekPlan).not.toHaveBeenCalled();
  });

  it("refuses a date that is not a plain Ymd", async () => {
    // The date is a lookup key, not free text.
    for (const bad of [
      "",
      "not-a-date",
      "2026-9-1",
      "2026-09-01T00:00",
      "../../etc",
    ]) {
      const res = await GET(req(`date=${encodeURIComponent(bad)}`));
      expect(res.status, `accepted ${JSON.stringify(bad)}`).toBe(400);
    }
  });

  it("refuses a negative or non-integer session index", async () => {
    for (const bad of ["-1", "1.5", "abc"]) {
      const res = await GET(req(`date=${DATE}&i=${bad}`));
      expect(res.status, `accepted i=${bad}`).toBe(400);
    }
  });

  it("404s for a day the week does not hold", async () => {
    const res = await GET(req("date=2026-12-25"));
    expect(res.status).toBe(404);
  });

  it("404s for a session index the day does not hold", async () => {
    const res = await GET(req(`date=${DATE}&i=3`));
    expect(res.status).toBe(404);
  });

  it("404s rather than inventing a file when the library refuses", async () => {
    // A run is not cycling. The athlete's day genuinely has no structured
    // session, and an empty .zwo would be a worse answer than saying so.
    getOpenWeekPlan.mockResolvedValue({
      days: [{ date: DATE, workouts: [{ ...bike, sport: "Run" }] }],
    });
    const res = await GET(req(`date=${DATE}`));
    expect(res.status).toBe(404);
  });

  it("returns a downloadable .zwo whose duration matches the planned day", async () => {
    const res = await GET(req(`date=${DATE}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("xml");
    expect(res.headers.get("Content-Disposition")).toContain(".zwo");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain("<sportType>bike</sportType>");
    // The whole point: the file is the planned day's length, exactly.
    const secs = [...xml.matchAll(/Duration="(\d+)"/g)].reduce(
      (t, m) => t + Number(m[1]),
      0
    );
    expect(secs).toBe(75 * 60);
  });

  it("is a pure derivation — the same request twice gives the same bytes", async () => {
    const a = await (await GET(req(`date=${DATE}`))).text();
    const b = await (await GET(req(`date=${DATE}`))).text();
    expect(a).toBe(b);
  });
});
