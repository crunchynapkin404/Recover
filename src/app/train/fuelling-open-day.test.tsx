import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { withPurpose } from "@/lib/training-plan";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";
import { blockPlacement } from "@/lib/week-plan/placement";

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

// C1 (final whole-branch review): FuellingCard used to bind to
// `todaySlot`/`todayYmd` while rendering directly beneath the OPEN day's
// row — Task 4 moved the open day off "today" everywhere else (the
// verdict, the strip, WeekDayList) and missed this one call site. These
// fixtures cover both directions the finding names: the open day carries
// a different session than today's, and today carries nothing at all.
const TODAY_HAS_SESSION_USER = "test-train-fuelling-open-day-both";
const TODAY_IS_REST_USER = "test-train-fuelling-open-day-rest";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TODAY = localYmd(new Date());
const WEEK_START = mondayOf(new Date());
// A day in this week that is not today, for the "open day" — Saturday of
// the week TODAY falls in. When TODAY itself is a Saturday this would
// collide, which the six-day offset from Monday can never do (TODAY is
// always within [WEEK_START, WEEK_START+6], and WEEK_START+5 equals TODAY
// only if TODAY is that same Saturday — guarded by the assertion below so
// a future run on an actual Saturday fails loudly instead of silently
// testing OPEN_DAY against itself).
const OPEN_DAY = addDaysYmd(WEEK_START, 5);
if (OPEN_DAY === TODAY) {
  throw new Error(
    "fixture collision: OPEN_DAY equals TODAY — rerun on a non-Saturday"
  );
}

const recoverySpin = withPurpose({
  day: 0,
  sport: "Ride",
  type: "Recovery",
  durationMins: 45,
  intensity: "Z1",
  description: "easy spin",
  placement: blockPlacement(0),
});

const longRide = withPurpose({
  day: 5,
  sport: "Ride",
  type: "Long",
  durationMins: 240,
  intensity: "Z1-Z2",
  description: "long ride",
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

function weekDays(overrides: Record<string, DaySlot>): DaySlot[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysYmd(WEEK_START, i);
    return overrides[date] ?? emptyDay(date);
  });
}

async function seedOpenWeek(userId: string, days: DaySlot[]): Promise<void> {
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
  await db.insert(schema.weekPlans).values({
    userId,
    planId: plan.id,
    weekStart: WEEK_START,
    skeletonWeek: 1,
    days,
    status: "open",
  });
}

/**
 * Disclosure slice 1, task 5: the fuelling detail this test is about no
 * longer renders on the page itself — FuellingCard collapsed to
 * FuellingLine (a summary + ⓘ) there, and the per-session detail this file
 * checks (type, duration) moved into the "fuelling" sheet, opened here with
 * `sheet: "fuelling"` alongside `day`. The open-day binding this whole file
 * guards (C1) is unchanged: `fuellingSheet` in page.tsx is still built from
 * `openDaySlot`/`openDate`, the same values FuellingCard used to read.
 */
async function renderTrainWeekAs(userId: string, day: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({ day, sheet: "fuelling" })} />
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

describe.skipIf(!hasDb)("TrainPage: fuelling binds to the open day", () => {
  beforeAll(async () => {
    await seedOpenWeek(
      TODAY_HAS_SESSION_USER,
      weekDays({
        [TODAY]: {
          ...emptyDay(TODAY),
          status: "planned",
          workouts: [recoverySpin],
        },
        [OPEN_DAY]: {
          ...emptyDay(OPEN_DAY),
          status: "planned",
          workouts: [longRide],
        },
      })
    );
    await seedOpenWeek(
      TODAY_IS_REST_USER,
      weekDays({
        [OPEN_DAY]: {
          ...emptyDay(OPEN_DAY),
          status: "planned",
          workouts: [longRide],
        },
      })
    );
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.users)
      .where(eq(schema.users.id, TODAY_HAS_SESSION_USER));
    await db
      .delete(schema.users)
      .where(eq(schema.users.id, TODAY_IS_REST_USER));
  });

  it("shows the OPEN day's fuelling, not today's, when both carry a session", async () => {
    const html = await renderTrainWeekAs(TODAY_HAS_SESSION_USER, OPEN_DAY);
    // Slice from the dialog itself, not from the first "Session fuelling"
    // text on the page — FuellingLine's own ⓘ carries an sr-only "Session
    // fuelling detail" label that appears EARLIER, inline, next to whatever
    // day's summary the page happens to show; only the sheet's own dialog
    // (its `<h2>` title is this same string) holds the actual per-session
    // detail this test is about.
    const dialogIdx = html.indexOf('role="dialog"');
    expect(dialogIdx).toBeGreaterThan(-1);

    // I2, final whole-branch review: BOTH regions, because slice 1 split
    // the one card this file was written to guard into two bindings, and
    // asserting only the sheet's left the on-page one uncovered. Reverting
    // page.tsx's `<FuellingLine workouts={openDaySlot.workouts}>` to
    // today's slot — the exact defect this file exists to pin, only now one
    // component further down — passed every assertion below the dialog.
    // The on-page region first.
    const onPage = html.slice(0, dialogIdx);
    // FuellingLine renders `fuellingSummary`'s single string, so the
    // before-figure is one text node rather than SSR-split: 50-70 g is the
    // open day's 240-minute long ride, 20-30 g is today's 45-minute
    // recovery spin. Different duration bands, so the two never collide.
    expect(onPage).toContain("50-70 g carbs before");
    expect(onPage).not.toContain("20-30 g carbs before");

    // Then the sheet. The open day's session (Saturday's 240-minute long
    // ride) is what's shown — a wrong numeric fuelling claim attached to
    // the wrong session is exactly the failure this pins. React SSR splits
    // `{type} · {mins} min` across text/comment nodes, so these check the
    // type name and the bare duration number rather than a literal "240
    // min" substring. FuellingDetail itself never renders the date (only
    // type/duration), so there is no OPEN_DAY/TODAY string to check for
    // inside the sheet body.
    const section = html.slice(dialogIdx, dialogIdx + 1500);
    expect(section).toContain("Long");
    expect(section).toContain("240");
    expect(section).not.toContain("Recovery");
  });

  it("still shows fuelling for the open day's session when today is a rest day", async () => {
    // The inverse failure named in the finding: today has nothing planned,
    // so the old todaySlot-bound card rendered nothing at all even though
    // the open day (Saturday) has a real session to fuel.
    const html = await renderTrainWeekAs(TODAY_IS_REST_USER, OPEN_DAY);
    const dialogIdx = html.indexOf('role="dialog"');
    expect(dialogIdx).toBeGreaterThan(-1);

    // The on-page line, again — and here it is the STRONGER of the two
    // halves: rebinding FuellingLine to today makes it render nothing at
    // all on this fixture, so a `.not.toContain` alone would still pass.
    // Asserting the figure is PRESENT is what catches that.
    const onPage = html.slice(0, dialogIdx);
    expect(onPage).toContain("50-70 g carbs before");

    const section = html.slice(dialogIdx, dialogIdx + 1500);
    expect(section).toContain("Long");
    expect(section).toContain("240");
  });
});
