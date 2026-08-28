import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Same App Router shims first-run.test.tsx and day-param-self-heals.test.tsx
// need — SidebarNav/BottomNav call usePathname/useRouter, which need
// context this test has none of. BottomSheet (rendered when ?sheet=why-week
// resolves) additionally calls useRouter().push on close, already covered
// by the same push stub.
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

// `?sheet=` is untrusted URL input — this is where the interesting bug
// could hide (the same class `openDayFrom` and SheetHost's UUID guard
// exist to close off). A membership Set built and then never consulted
// would let ANY string through as if it were "why-week"; this test only
// fails if the validation is both present AND actually read.
const TEST_USER = "test-train-sheet-param-validates";

const WEEK_START = mondayOf(new Date());

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

async function renderTrainWeekWithSheet(
  userId: string,
  sheet: string | undefined
): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({ sheet })} />
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
  "TrainPage: ?sheet= validates against TRAIN_SHEETS",
  () => {
    beforeAll(async () => {
      await seedOpenWeek(TEST_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    it("renders no dialog at all when ?sheet= is absent", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, undefined);
      expect(html).not.toContain('role="dialog"');
    });

    it("renders no dialog for a sheet name outside TRAIN_SHEETS", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "drop-tables");
      expect(html).not.toContain('role="dialog"');
      // Never echoed back into the render unvalidated, the way an unparseable
      // day or activity id must never reach a query.
      expect(html).not.toContain("drop-tables");
    });

    it("renders the dialog for the one implemented sheet name", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "why-week");
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-label="Why this week"');
    });

    // Task 2's own destination — implemented alongside "why-week" now.
    it("renders the dialog for the plan-setup sheet name", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "plan-setup");
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-label="Plan setup"');
    });

    // A real TRAIN_SHEETS member (tasks 3-5's destinations, not yet
    // implemented — "plan-setup" graduated out of this list in task 2) must
    // not fall through to the one sheet this task built — membership in
    // TRAIN_SHEETS is necessary, not sufficient, to open "why-week"
    // specifically.
    it("renders no dialog for a valid-but-unimplemented sheet name", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "races");
      expect(html).not.toContain('role="dialog"');
    });
  }
);

// Review finding 2 on this task: every test above proves the MECHANISM
// (param validation, dialog presence) — none of them prove the four blocks
// this task was actually defined to move (WeekRationale, the adjustments
// list, EventReadiness, the race-pacing prose) are gone from the page.
// Re-adding <WeekRationale/> and <EventReadiness/> to page.tsx beside the
// sheet would leave every test above green. This describe block is the
// guard for that: seed a week with real content in all four categories —
// through the actual previewTrainingPlan/confirmTrainingPlan engine, the
// same producer seed-confirmed-race.ts uses, not hand-inserted rows shaped
// to match what the page happens to expect — then diff the closed-page
// render against the open-sheet render.
//
// SHAPE FOR TASKS 2-5 TO COPY: seed real content for your destination, then
// assert (a) its marker text is ABSENT from the page with no `?sheet=`, and
// (b) the SAME text IS present once your sheet's `?sheet=` is open. Two
// renders and a diff — nothing else proves "moved" as opposed to "also
// duplicated".
const FULL_RATIONALE_USER = "test-train-sheet-moves-content";

async function seedWeekWithFullRationale(userId: string): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  const { previewTrainingPlan, confirmTrainingPlan } =
    await import("@/lib/training-plan");

  await db.insert(schema.users).values({
    id: userId,
    name: "Test Athlete",
    email: `${userId}@example.invalid`,
  });

  // Enough run history that demand/pacing price the race rather than
  // refusing for want of a threshold — this is what pushes EventReadiness
  // and the race-pacing prose into their real-content branches instead of
  // their (equally real, but less distinctive) missing_input refusals.
  const activities = Array.from({ length: 8 }, (_, i) => ({
    userId,
    provider: "manual" as const,
    externalId: `${userId}-run-${i}`,
    sport: "Run",
    name: `Seed run ${i}`,
    startDate: new Date(Date.now() - (i + 2) * DAY_MS),
    startDateLocal: new Date(Date.now() - (i + 2) * DAY_MS),
    durationS: 2400,
    distanceM: 8000,
    load: 60,
  }));
  await db.insert(schema.activities).values(activities);

  const raceDate = ymd(new Date(Date.now() + 30 * DAY_MS));
  const [race] = await db
    .insert(schema.races)
    .values({
      userId,
      name: "Moved Content Race",
      raceType: "marathon",
      sport: "Run",
      date: raceDate,
      priority: "A",
      status: "upcoming",
      eventDays: 1,
      distanceKm: 42.2,
      elevationM: 250,
      goalNote: "Goal: even effort",
    })
    .returning();

  // The real engine, not hand-inserted rows: rolloverWeekPlan (called from
  // confirmTrainingPlan) is what actually produces the "session dropped"
  // plan_adjustments rows the sheet's adjustments list shows — an athlete
  // with no availability defaults set gets a materialized week that drops
  // sessions it has nowhere to put, which is exactly the case here.
  const preview = await previewTrainingPlan({
    userId,
    raceType: "marathon",
    raceDate,
    raceIds: [race.id],
    title: "Moved content plan",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });
  if (!preview.ok) {
    throw new Error(`previewTrainingPlan refused: ${preview.reason}`);
  }
  const confirmed = await confirmTrainingPlan(userId, preview.preview.planId);
  if (!confirmed.ok) {
    throw new Error(`confirmTrainingPlan refused: ${confirmed.reason}`);
  }
}

describe.skipIf(!hasDb)(
  "TrainPage: the four why-week blocks actually leave the page",
  () => {
    beforeAll(async () => {
      await seedWeekWithFullRationale(FULL_RATIONALE_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, FULL_RATIONALE_USER));
    });

    it("keeps the summary row on the page but not the four blocks it replaces", async () => {
      const closed = await renderTrainWeekWithSheet(
        FULL_RATIONALE_USER,
        undefined
      );
      // The row that replaces all four stays on the page.
      expect(closed).toContain("Why this week");
      // WeekRationale's own sentence.
      expect(closed).not.toContain("planned against");
      // The adjustments list's heading.
      expect(closed).not.toContain("What changed &amp; why");
      // EventReadiness's demand sentence — a phrase that appears nowhere
      // else on the page (WeekRationale's own shortfall sentence uses the
      // same words lowercased, mid-sentence, never this exact casing).
      expect(closed).not.toContain("Asks about");
      // The race-pacing prose's own test id.
      expect(closed).not.toContain('data-testid="race-pacing"');
      // The chip's goalNote is NOT one of the four that moved — it must
      // still be on the page.
      expect(closed).toContain("Goal: even effort");
    });

    it("puts all four blocks in the sheet once it opens", async () => {
      const open = await renderTrainWeekWithSheet(
        FULL_RATIONALE_USER,
        "why-week"
      );
      expect(open).toContain('role="dialog"');
      expect(open).toContain("planned against");
      expect(open).toContain("What changed &amp; why");
      expect(open).toContain("Asks about");
      expect(open).toContain('data-testid="race-pacing"');
      // Only the prose moved — the chip's goalNote is not duplicated into
      // the sheet, so it still appears exactly once in the whole page.
      expect(open.split("Goal: even effort").length - 1).toBe(1);
    });
  }
);

// Task 2's own copy of the shape above: PlanStyleSwitch, SeasonModeSwitch
// (with its "Applies from next week…" note), the Standard week
// Collapsible's contents and the Remaining skeleton Collapsible's contents
// all moved into the "plan-setup" sheet. Seeded through the real
// previewTrainingPlan/confirmTrainingPlan engine (not hand-inserted rows)
// so `remaining` holds genuine trainingBlocks rows and `week` is a genuine
// materialized week — the same two conditions the moved content always
// needed, unchanged by the move.
const PLAN_SETUP_USER = "test-train-sheet-moves-plan-setup";

async function seedPlanForPlanSetup(userId: string): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  const { previewTrainingPlan, confirmTrainingPlan } =
    await import("@/lib/training-plan");

  await db.insert(schema.users).values({
    id: userId,
    name: "Test Athlete",
    email: `${userId}@example.invalid`,
  });

  // 42 days out -> a 6-week plan (Math.ceil(42/7)), so periodize() writes
  // several trainingBlocks beyond the open week -- what `remaining` reads.
  const raceDate = ymd(new Date(Date.now() + 42 * DAY_MS));
  // Named to avoid the substring "Plan setup" itself — the plan's own
  // title renders on the page as TrainHeader's subtitle, and the closed-
  // page assertion below checks for that exact phrase as the SummaryRow's
  // label; a title containing it would satisfy that check for the wrong
  // reason.
  const preview = await previewTrainingPlan({
    userId,
    raceType: "marathon",
    raceDate,
    title: "Marathon build test plan",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });
  if (!preview.ok) {
    throw new Error(`previewTrainingPlan refused: ${preview.reason}`);
  }
  const confirmed = await confirmTrainingPlan(userId, preview.preview.planId);
  if (!confirmed.ok) {
    throw new Error(`confirmTrainingPlan refused: ${confirmed.reason}`);
  }
}

describe.skipIf(!hasDb)(
  "TrainPage: the plan-setup blocks actually leave the page",
  () => {
    beforeAll(async () => {
      await seedPlanForPlanSetup(PLAN_SETUP_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, PLAN_SETUP_USER));
    });

    it("keeps the summary row on the page but not the four blocks it replaces", async () => {
      const closed = await renderTrainWeekWithSheet(PLAN_SETUP_USER, undefined);
      // The row that replaces all four stays on the page.
      expect(closed).toContain("Plan setup");
      // PlanStyleSwitch's own option labels.
      expect(closed).not.toContain("Block-lite");
      // SeasonModeSwitch's own option label, and the note that explains
      // both switches (moves WITH them, not orphaned on the page).
      expect(closed).not.toContain("Off-season");
      expect(closed).not.toContain(
        "Applies from next week — this week is already planned."
      );
      // StandardWeek's own heading.
      expect(closed).not.toContain("Your standard week");
      // The deleted Collapsible trigger's own label (review finding 2 on
      // ded5f64) — case-distinct from "Your standard week" above and from
      // the "standard week" this file's own comments use lowercase. Base
      // UI's CollapsiblePanel doesn't render its children into SSR while
      // closed, so a closed-page string check can't tell "moved into the
      // sheet" apart from "re-wrapped in a still-collapsed Collapsible" for
      // PANEL content (see the mutation-check note in task-2-report.md) —
      // but the TRIGGER label is always rendered, closed or not, so this
      // line is the one that actually catches a re-wrap. It now survives
      // only in comments, nowhere in rendered output.
      expect(closed).not.toContain("Standard week");
      // The remaining-skeleton table's own heading and column.
      expect(closed).not.toContain("Remaining skeleton");
      expect(closed).not.toContain("Target load");
    });

    it("puts all four blocks in the sheet once it opens", async () => {
      const open = await renderTrainWeekWithSheet(
        PLAN_SETUP_USER,
        "plan-setup"
      );
      expect(open).toContain('role="dialog"');
      expect(open).toContain("Block-lite");
      expect(open).toContain("Off-season");
      expect(open).toContain(
        "Applies from next week — this week is already planned."
      );
      expect(open).toContain("Your standard week");
      expect(open).toContain("Remaining skeleton");
      expect(open).toContain("Target load");
    });
  }
);
