import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";

// Same App Router shims first-run.test.tsx needs — SidebarNav/BottomNav
// call usePathname/useRouter, which need context this test has none of.
vi.mock("next/navigation", () => ({
  usePathname: () => "/train",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireUser: requireUserMock,
}));

// requires Postgres; skips without DATABASE_URL. (See src/lib/first-run.test.ts.)
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

// M1 (final whole-branch review): page.tsx's `href` builder carried the RAW
// `?day=` (`sp.day`) rather than the resolved `openDate`, so an invalid or
// stale value stuck to every tab/filter link on the page forever instead of
// self-healing the moment openDayFrom resolves it to a real day.
const TEST_USER = "test-train-day-param-self-heals";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TODAY = localYmd(new Date());
const WEEK_START = mondayOf(new Date());
// Outside any real week — openDayFrom falls through to today for this
// exact reason (day-shape.ts's own doc comment: an invalid value must fall
// through to the same default path as an absent one, never reach a render).
const INVALID_DAY = "2099-01-01";

function emptyDay(date: string): DaySlot {
  return {
    date,
    availableBlocks: [],
    availableMins: 0,
    workouts: [],
    status: "rest",
  };
}

async function seedOpenWeek(userId: string): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.users).values({
    id: userId,
    name: "Test Athlete",
    email: `${userId}@example.invalid`,
  });
  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      title: "Test Plan",
      raceType: "Ride",
      raceDate: addDaysYmd(WEEK_START, 90),
      startDate: WEEK_START,
      weeksTotal: 16,
      currentWeek: 1,
      status: "active",
      constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Bike"] },
    })
    .returning();
  const days = Array.from({ length: 7 }, (_, i) =>
    emptyDay(addDaysYmd(WEEK_START, i))
  );
  await db.insert(schema.weekPlans).values({
    userId,
    planId: plan.id,
    weekStart: WEEK_START,
    skeletonWeek: 1,
    days,
    status: "open",
  });
}

async function renderTrainWeekAs(userId: string, day: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({ day })} />
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html;
}

describe.skipIf(!hasDb)(
  "TrainPage: ?day= self-heals in generated links",
  () => {
    beforeAll(async () => {
      await seedOpenWeek(TEST_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    it("carries the resolved day into the History tab link, not the raw invalid ?day=", async () => {
      const html = await renderTrainWeekAs(TEST_USER, INVALID_DAY);
      const idx = html.indexOf("tab=history");
      expect(idx).toBeGreaterThan(-1);
      // Pull just this one anchor's href out of the surrounding markup.
      const hrefStart = html.lastIndexOf('href="', idx);
      const hrefEnd = html.indexOf('"', hrefStart + 6);
      const historyHref = html.slice(hrefStart + 6, hrefEnd);
      expect(historyHref).toContain(`day=${TODAY}`);
      expect(historyHref).not.toContain(INVALID_DAY);
    });
  }
);
