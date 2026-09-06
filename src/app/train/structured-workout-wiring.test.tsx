import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { withPurpose } from "@/lib/training-plan";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";
import { blockPlacement } from "@/lib/week-plan/placement";
import { workoutForDay } from "@/lib/interval/for-day";

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
  placement: blockPlacement(0),
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
      //
      // This asserted /\d+ × \d+ min at \d+/, and that shape is NOT fixed:
      // which workout a day gets is seeded by the date itself
      // (interval/match.ts:154-160 hash the YYYY-MM-DD to pick first a family,
      // then a workout within it). OPEN_DAY is the Wednesday of whatever week
      // the suite runs in, so the seed moves every week. Measured across a
      // year of those Wednesdays with tests/setup/shift-clock.ts, 12 of 54
      // land on a ladder and render "46 min at 55-100% FTP" instead — 22% of
      // weeks red, for the whole week, next on the week of 2026-09-30.
      //
      // So assert against the line the app itself derives. workoutForDay is
      // the one entry point the page uses (interval/for-day.ts), which keeps
      // this a test of the WIRING — the page hands the row the derived
      // sentence and name — without pinning what the library chose.
      const derived = workoutForDay(
        {
          sport: tempo.sport,
          purpose: tempo.purpose,
          durationMins: tempo.durationMins,
          intensity: tempo.intensity,
        },
        OPEN_DAY
      );
      if (!derived) {
        throw new Error(
          `the library derived no workout for ${OPEN_DAY} — the fixture's ` +
            `session no longer matches anything, which is a real regression`
        );
      }
      // Anchored to the element that carries each, not to the raw string:
      // the description is ALSO the profile SVG's aria-label, so a bare
      // `toContain` still passes with the visible line deleted. Verified by
      // mutation — replacing the line's own <p> makes exactly these two
      // assertions fail.
      expect(html).toContain(`>${derived.workout.name}</p>`);
      expect(html).toContain(`>${derived.description}</p>`);
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
