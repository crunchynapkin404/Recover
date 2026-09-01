import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { withPurpose } from "@/lib/training-plan";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/train",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: requireUserMock }));

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-train-structured-workout";
const WEEK_START = mondayOf(new Date());
const OPEN_DAY = addDaysYmd(WEEK_START, 2);

const tempo = withPurpose({
  day: 2,
  sport: "Bike",
  type: "Tempo",
  durationMins: 75,
  intensity: "Z4",
  description: "Tempo ride — steady sweetspot effort",
  blockIdx: 0,
});

function emptyDay(date: string): DaySlot {
  return {
    date,
    availableBlocks: [],
    availableMins: 0,
    workouts: [],
    status: "rest",
  };
}

async function seed(days: DaySlot[]): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.users).values({
    id: USER,
    name: "Test Athlete",
    email: `${USER}@example.invalid`,
  });
  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId: USER,
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
  await db.insert(schema.weekPlans).values({
    userId: USER,
    planId: plan.id,
    weekStart: WEEK_START,
    skeletonWeek: 1,
    days,
    status: "open",
  });
}

async function renderTrainWeek(day: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: USER,
    email: `${USER}@example.invalid`,
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

/**
 * WIRING AT THE SURFACE, not at the component.
 *
 * week-day-list.test.tsx proves the row renders what it is handed. It cannot
 * prove the PAGE hands it anything — and RELEASING.md step 4 exists because
 * that gap has shipped before: FuellingCard bound to `todaySlot` while
 * rendering under the open day, and every component test still passed.
 */
describe.skipIf(!hasDb)(
  "TrainPage: the structured workout reaches the open day",
  () => {
    beforeAll(async () => {
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = addDaysYmd(WEEK_START, i);
        return date === OPEN_DAY
          ? { ...emptyDay(date), status: "planned" as const, workouts: [tempo] }
          : emptyDay(date);
      });
      await seed(days);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, USER));
    });

    it("renders the library workout's name, line and profile for a real planned day", async () => {
      const html = await renderTrainWeek(OPEN_DAY);
      expect(html).toContain("data-structured-workout");
      expect(html).toContain("data-workout-profile");
      // The derived line, not the plan's hand-written prose.
      expect(html).toMatch(/\d+ × \d+ min at \d+/);
    });

    it("offers the .zwo download for that day and index", async () => {
      const html = await renderTrainWeek(OPEN_DAY);
      expect(html).toContain(`/api/workout/zwo?date=${OPEN_DAY}&amp;i=0`);
    });

    it("shows nothing structured on a rest day", async () => {
      const html = await renderTrainWeek(addDaysYmd(WEEK_START, 0));
      expect(html).not.toContain("data-structured-workout");
    });
  }
);
