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
  sheet: string | undefined,
  /**
   * Task 4's own addition: `?availability=next`, the Sunday push
   * notification's own query param, deep-links straight into the
   * "availability" sheet with no `?sheet=` of its own (see page.tsx's
   * `sheetParam` derivation) — tests of that seam need to drive
   * `availability` independently of `sheet`.
   */
  availability?: string
): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({ sheet, availability })} />
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

    // Task 3's own destination. TEST_USER has an active plan but no races
    // (seedOpenWeek never touches schema.races), so this also doubles as
    // the empty-case check the brief calls out: the sheet must hold
    // RacesSection's own empty-state UI, not an invented "no races" string
    // of the page's own.
    it("renders the dialog for the races sheet name, empty-state UI included", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "races");
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-label="Races"');
      expect(html).toContain("No races yet");
    });

    // Task 4's own destination: AvailabilityWeekSwitcher/IntakeForm.
    // TEST_USER's plain seedOpenWeek (an active plan, an open week, no
    // availability defaults or overrides) is enough for this: WeekTab's
    // `projectWeek` call succeeds on it, so both `intake.thisWeek` and
    // `intake.nextWeek` are set and the real switcher renders — the
    // richer, two-form case, not just the bare single-form fallback.
    it("renders the dialog for the availability sheet name", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "availability");
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-label="Availability"');
    });

    // A real TRAIN_SHEETS member (task 5's own destination, not yet
    // implemented — "plan-setup" graduated out of this list in task 2,
    // "races" in task 3, "availability" in task 4) must not fall through to
    // the one sheet this task built — membership in TRAIN_SHEETS is
    // necessary, not sufficient, to open "why-week" specifically.
    it("renders no dialog for a valid-but-unimplemented sheet name", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "plan-review");
      expect(html).not.toContain('role="dialog"');
    });

    // THE HIGHEST-CONSEQUENCE SEAM IN THIS TASK. `promptNextWeekAvailability`
    // (src/lib/week-plan/availability-prompt.ts), shipped a release ago,
    // sends a live push every Sunday linking to exactly
    // `/train?availability=next` — no `?sheet=` at all, because that link
    // predates this task's sheet and cannot be changed retroactively. Before
    // this task that param alone drove `initialAvailabilityMode`; the
    // control it names is now behind a sheet, so the same param must ALSO
    // open it, or the notification lands the athlete on a page with the
    // thing it promised sealed shut.
    it("opens the availability sheet, in next-week mode, from ?availability=next alone — no ?sheet= at all", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, undefined, "next");
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-label="Availability"');
      // The switcher's next-week button is the pressed one…
      expect(html).toMatch(
        /aria-pressed="true"[^>]*>Next week<|>Next week<\/button>[^]*?aria-pressed="true"/
      );
      // …and next week's own IntakeForm — not this week's — is the one NOT
      // marked `hidden`. Each IntakeForm sits directly inside its own
      // wrapper `<div>` (visible) or `<div hidden="">` (hidden) with
      // nothing else in between (AvailabilityWeekSwitcher's own markup) —
      // so the nearer of those two EXACT open tags, immediately preceding
      // each heading, names that heading's own wrapper. Both headings are
      // always in the document (both IntakeForms stay mounted, see the
      // switcher's own doc comment), so only which wrapper form wins proves
      // which mode actually won, not mere presence of either heading.
      function isHiddenWrapper(headingIdx: number): boolean {
        const hiddenAt = html.lastIndexOf('<div hidden="">', headingIdx);
        const visibleAt = html.lastIndexOf("<div>", headingIdx);
        expect(Math.max(hiddenAt, visibleAt)).toBeGreaterThan(-1);
        return hiddenAt > visibleAt;
      }
      const thisIdx = html.indexOf("This week&#x27;s availability");
      const nextIdx = html.indexOf("Next week&#x27;s availability");
      expect(thisIdx).toBeGreaterThan(-1);
      expect(nextIdx).toBeGreaterThan(-1);
      expect(isHiddenWrapper(thisIdx)).toBe(true);
      expect(isHiddenWrapper(nextIdx)).toBe(false);
    });

    // An explicit `?sheet=` still wins over the `?availability=next`
    // fallback — the derivation is `TRAIN_SHEETS.find(...) ?? (…)`, and this
    // is the only test that would notice the `??` silently becoming `||` or
    // being dropped in favour of always preferring `availability`.
    it("lets an explicit ?sheet= win over ?availability=next", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "races", "next");
      expect(html).toContain('aria-label="Races"');
      expect(html).not.toContain('aria-label="Availability"');
    });

    // THE DECISIVE ASSERTION for the whole task: the measured regression was
    // the week rendering TWICE — once as WeekStrip's day strip, once as
    // IntakeForm's own Monday-through-Sunday list, both outside any sheet.
    // WeekStrip's day labels are two letters ("Mo", via WEEKDAY_NARROW) and
    // carry no `text-ink-muted` class of their own, so this pattern —
    // IntakeForm's own three-letter WEEKDAY_SHORT span, `text-ink-muted` —
    // matches ONLY IntakeForm's day-row labels, never WeekStrip's, never
    // WeekDayList's single open-day badge (that one is `text-ink-secondary`,
    // a different token — verified empirically against this exact fixture
    // before writing this test, not assumed). Both IntakeForm instances
    // inside the switcher would each contribute all seven if either stayed
    // outside the sheet — the fixed count is exactly 0, not "fewer".
    it("renders none of the seven weekdays' own short labels outside the sheet — the duplicate week this task removes", async () => {
      const closed = await renderTrainWeekWithSheet(TEST_USER, undefined);
      const matches = closed.match(
        /<span class="[^"]*text-ink-muted">(Mon|Tue|Wed|Thu|Fri|Sat|Sun)</g
      );
      expect(matches ?? []).toHaveLength(0);
    });

    // The other half of the same proof: the labels are not gone, only
    // moved. Without this, a test that deleted IntakeForm's day list
    // entirely (rather than relocating it) would also pass the assertion
    // above.
    it("renders the seven weekdays' own short labels inside the sheet once it opens", async () => {
      const open = await renderTrainWeekWithSheet(TEST_USER, "availability");
      const matches = open.match(
        /<span class="[^"]*text-ink-muted">(Mon|Tue|Wed|Thu|Fri|Sat|Sun)</g
      );
      expect((matches ?? []).length).toBeGreaterThan(0);
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

// Task 3's own copy of the shape above: RacesSection (743 lines — add /
// edit demand / set status / remove races) used to render from TWO mutually
// exclusive call sites — a Collapsible-wrapped list when races.length > 0,
// a bare `<RacesSection/>` when it was 0 — both replaced by one row. This
// seed exercises the non-empty case (the empty case is covered by TEST_USER
// above, which has a plan but no races at all).
const RACES_USER = "test-train-sheet-moves-races";

async function seedPlanWithRaces(userId: string): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  const { previewTrainingPlan, confirmTrainingPlan } =
    await import("@/lib/training-plan");

  await db.insert(schema.users).values({
    id: userId,
    name: "Test Athlete",
    email: `${userId}@example.invalid`,
  });

  // The plan's own target race, pre-created and passed explicitly as
  // `raceIds` so confirmTrainingPlan does not fall back to creating an
  // IMPLICIT race of its own (it does that only when no id is given —
  // see the `if (!raceId)` branch in confirmTrainingPlan). Status
  // "completed" keeps it out of nextUpcomingRace, so it never becomes the
  // page's own RaceChip (`card.race`) — this test is about RacesSection's
  // list, not the chip, and letting the two overlap would make the
  // closed-page assertions below ambiguous about which component a race
  // name came from.
  const [planRace] = await db
    .insert(schema.races)
    .values({
      userId,
      name: "Races Sheet Plan Race",
      raceType: "marathon",
      sport: "Run",
      date: ymd(new Date(Date.now() + 45 * DAY_MS)),
      priority: "A",
      status: "completed",
    })
    .returning();

  const preview = await previewTrainingPlan({
    userId,
    raceType: "marathon",
    raceDate: planRace.date,
    raceIds: [planRace.id],
    title: "Races sheet test plan",
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

  // The two races RacesSection's own management list actually exercises.
  // Both non-"upcoming", for the same reason as planRace above.
  await db.insert(schema.races).values([
    {
      userId,
      name: "Race Sheet Alpha",
      raceType: "10k",
      sport: "Run",
      date: ymd(new Date(Date.now() + 10 * DAY_MS)),
      priority: "B",
      status: "completed",
      eventDays: 1,
      distanceKm: 10,
      elevationM: 50,
      goalNote: "Alpha goal note",
    },
    {
      userId,
      name: "Race Sheet Bravo",
      raceType: "half marathon",
      sport: "Run",
      date: ymd(new Date(Date.now() + 20 * DAY_MS)),
      priority: "C",
      status: "skipped",
      eventDays: 1,
      distanceKm: 21.1,
      elevationM: 120,
      goalNote: "Bravo goal note",
    },
  ]);
}

describe.skipIf(!hasDb)(
  "TrainPage: the races blocks actually leave the page",
  () => {
    beforeAll(async () => {
      await seedPlanWithRaces(RACES_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, RACES_USER));
    });

    it("keeps the summary row on the page but not the races list it replaces", async () => {
      const closed = await renderTrainWeekWithSheet(RACES_USER, undefined);
      // The row that replaces both old call sites stays on the page.
      expect(closed).toContain("Races");
      // The old Collapsible trigger's own text (review finding 2 on
      // ded5f64's pattern) — Base UI's CollapsiblePanel doesn't render its
      // children into SSR while closed, so a closed-page string check
      // can't tell "moved into the sheet" apart from "re-wrapped in a
      // still-collapsed Collapsible" for the races LIST itself; the
      // trigger text is the one marker that survives closed either way,
      // so this is the line that actually catches a re-wrap.
      expect(closed).not.toContain("Races · ");
      // The individual races themselves — caught only for a bare re-add,
      // per the same limitation (see task 2's own note above), which is
      // the realistic regression this guards against.
      expect(closed).not.toContain("Race Sheet Alpha");
      expect(closed).not.toContain("Race Sheet Bravo");
      expect(closed).not.toContain("Alpha goal note");
      expect(closed).not.toContain("Bravo goal note");
      // The add-race disclosure — rendered unconditionally by RacesSection
      // regardless of races.length, so its absence here is not explained
      // by races.length being nonzero.
      expect(closed).not.toContain("+ Add race");
    });

    it("puts the whole races list in the sheet once it opens", async () => {
      const open = await renderTrainWeekWithSheet(RACES_USER, "races");
      expect(open).toContain('role="dialog"');
      expect(open).toContain('aria-label="Races"');
      expect(open).toContain("Race Sheet Alpha");
      expect(open).toContain("Race Sheet Bravo");
      expect(open).toContain("Alpha goal note");
      expect(open).toContain("Bravo goal note");
      expect(open).toContain("+ Add race");
    });
  }
);

// Task 4's own copy of the shape above: AvailabilityWeekSwitcher and both
// IntakeForms (this week's + next week's, both always mounted — see the
// switcher's own doc comment) used to render inline below the day list,
// showing THIS week's seven days a second time next to WeekStrip's own
// seven — the measured regression this whole task exists to remove. A
// standard-week default on Monday (a real, non-"Rest" block) gives the
// closed-page assertions below a genuine, checkable time string to prove
// absent, and the "Availability" row a real hours badge to prove present —
// not just structural markers.
const AVAILABILITY_USER = "test-train-sheet-moves-availability";

async function seedPlanForAvailability(userId: string): Promise<void> {
  await seedOpenWeek(userId);
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.availabilityDefaults).values({
    userId,
    weekday: 0,
    blocks: [
      {
        start: "06:00",
        end: "07:00",
        mins: 60,
        energy: "normal" as const,
        sports: null,
      },
    ],
  });
}

describe.skipIf(!hasDb)(
  "TrainPage: the availability blocks actually leave the page",
  () => {
    beforeAll(async () => {
      await seedPlanForAvailability(AVAILABILITY_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, AVAILABILITY_USER));
    });

    it("keeps the summary row (with an hours badge) on the page but not the switcher it replaces", async () => {
      const closed = await renderTrainWeekWithSheet(
        AVAILABILITY_USER,
        undefined
      );
      // The row that replaces the switcher stays on the page, badged with
      // the week's real offered hours — computed off data WeekTab already
      // fetched, not a new query, so it costs nothing to show.
      expect(closed).toContain("Availability");
      expect(closed).toContain("1h");
      // AvailabilityWeekSwitcher's own group label.
      expect(closed).not.toContain("Availability week");
      // IntakeForm's own body copy.
      expect(closed).not.toContain("When you can train");
      // PinnedAction's own label, as rendered inside IntakeForm's form.
      expect(closed).not.toContain("Confirm week");
      // The real block Monday's standard-week default set, formatted —
      // proves this isn't a structural-marker-only check.
      expect(closed).not.toContain("06:00–07:00");
    });

    it("puts the switcher, both IntakeForms and the real block in the sheet once it opens", async () => {
      const open = await renderTrainWeekWithSheet(
        AVAILABILITY_USER,
        "availability"
      );
      expect(open).toContain('role="dialog"');
      expect(open).toContain('aria-label="Availability"');
      expect(open).toContain("Availability week");
      expect(open).toContain("When you can train");
      expect(open).toContain("Confirm week");
      expect(open).toContain("06:00–07:00");
    });
  }
);
