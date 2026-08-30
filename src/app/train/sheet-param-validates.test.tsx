import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Matches ONLY IntakeForm's own day-row weekday span (`text-label font-bold
 * uppercase tracking-wider text-ink-muted`) — not WeekDayList's open-day
 * badge (`text-ink-secondary`) and, the confound review caught, not its
 * `NextWeekSummary` preview rows either (`w-10 shrink-0 text-label
 * font-bold uppercase tracking-[0.15em] text-ink-muted` — same trailing
 * token, different `tracking-*`, `w-10 shrink-0` prefix DayRow alone
 * carries). See the decisive test's own comment, below, for the full case
 * — and the AVAILABILITY_USER test further down for proof this narrowing
 * still holds against a fixture where NextWeekSummary's rows actually
 * render, not just one where they happen not to.
 *
 * SLICE 3 CHANGED THE MARKUP THIS MATCHES, NOT WHAT IT IS FOR. IntakeForm's
 * day list became `AvailabilityTimeline`, whose weekday label carries the
 * same class list with a `shrink-0` prefix. The discrimination this pattern
 * exists for is unaffected: `DayRow`'s span is `w-10 shrink-0 …
 * tracking-[0.15em] …`, so it still differs by BOTH its `w-10` prefix and
 * its `tracking-*` value, and an exact-list match still tells the two apart.
 */
const INTAKE_FORM_WEEKDAY_SPAN =
  /<span class="shrink-0 text-label font-bold uppercase tracking-wider text-ink-muted">(Mon|Tue|Wed|Thu|Fri|Sat|Sun)</g;

/**
 * Matches ONLY the "Availability" `SummaryRow`'s own label span (I2, final
 * whole-branch review) — the exact class list `summary-row.tsx` renders,
 * not a bare substring match that would also hit the pinned action's own
 * "…availability" text or the sheet's `aria-label="Availability"`.
 */
const AVAILABILITY_ROW_LABEL_SPAN =
  /<span class="text-label font-bold uppercase tracking-\[0\.15em\] text-ink-secondary">Availability<\/span>/;

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

/**
 * The general form: any of TrainPage's own searchParams keys. Most tests
 * only ever vary `sheet` (and, since task 4, `availability`) against the
 * default `tab=week` — `renderTrainWeekWithSheet` below stays the short
 * spelling for that common case. Review finding 3 on task 4's fix pass
 * needs `tab` driven independently too: `sheetParam`'s `?availability=next`
 * fallback must not leak onto a tab that never asked for it.
 */
async function renderTrain(
  userId: string,
  params: {
    tab?: string;
    sheet?: string;
    availability?: string;
  }
): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve(params)} />
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
  return renderTrain(userId, { sheet, availability });
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

    // This used to be "renders no dialog for a valid-but-unimplemented
    // sheet name" — the probe for a TRAIN_SHEETS member with NO entry in
    // `sheetOverlays` at all, silently falling through its `?? null`.
    // Task 5 implemented "plan-review", the last such member, so that gap
    // no longer exists anywhere in this codebase; keeping the old name and
    // comment would claim a bug class this file can no longer produce.
    // What's still true of "plan-review" specifically: like "why-week"'s
    // `week` gate, it's gated on `draftPreview`, and TEST_USER
    // (seedOpenWeek) never writes a `trainingPlans` row with
    // `status: "draft"` — so this now proves that gate, not a missing map
    // entry. See "TrainPage: a draft plan preview becomes a destination"
    // below for the positive case (a real draft, the dialog it opens).
    it("renders no dialog for plan-review when there is no draft for it to show", async () => {
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

    // Review finding 3 on this task's fix pass: `sheetParam` (and the
    // `??` fallback it computes) feeds `href`, the ONE builder every tab —
    // not just Week — uses for its own links. Without gating the fallback
    // on `tab === "week"`, `/train?tab=history&availability=next` derived
    // "availability" too, and every link History renders (including its
    // own "Week" segment, back to the tab that actually owns the sheet)
    // silently carried `sheet=availability` forward — switching back to
    // Week would reopen the sheet unbidden, from a URL that never named it.
    it("does not let ?availability=next leak sheet=availability onto another tab's own links", async () => {
      const html = await renderTrain(TEST_USER, {
        tab: "history",
        availability: "next",
      });
      // History renders no sheet of its own regardless — this is the
      // defence-in-depth half of the assertion.
      expect(html).not.toContain('role="dialog"');
      // The decisive half: not one link on the page — including History's
      // own "Week" tab link — carries the derived sheet param forward.
      expect(html).not.toContain("sheet=availability");
    });

    // M1, final whole-branch review: the fix pass above gated only the `??`
    // FALLBACK on `tab === "week"`, not the whole `sheetParam` expression —
    // `TRAIN_SHEETS.find((s) => s === sp.sheet)` still ran unconditionally.
    // `/train?tab=history&sheet=races` derives `sheetParam = "races"` on
    // History exactly as it would on Week, and `href` (fed by `sheetParam`)
    // is the ONE builder every tab's own links go through — so every link
    // History renders, including its own "Week" segment, silently carries
    // `sheet=races` forward, and returning to Week reopens the races sheet
    // from a URL that only ever named History. The old comment claiming
    // "nothing links `?sheet=` from History" was false: Week's own
    // `TrainTabs` are built from `resolvedHref`, which is `href` with `day`
    // pinned — the same builder.
    it("does not let an explicit ?sheet= leak onto another tab's own links either", async () => {
      const html = await renderTrain(TEST_USER, {
        tab: "history",
        sheet: "races",
      });
      // History renders no sheet of its own regardless — this is the
      // defence-in-depth half of the assertion.
      expect(html).not.toContain('role="dialog"');
      // The decisive half: not one link on the page — including History's
      // own "Week" tab link — carries the explicit sheet param forward.
      expect(html).not.toContain("sheet=races");
    });

    // THE DECISIVE ASSERTION for the whole task: the measured regression was
    // the week rendering TWICE — once as WeekStrip's day strip, once as
    // IntakeForm's own Monday-through-Sunday list, both outside any sheet.
    //
    // CLAIM, PRECISELY: this counts IntakeForm's OWN day-row span, not any
    // muted three-letter weekday text on the page. Two other renderers of
    // the exact same WEEKDAY_SHORT strings, both legitimate and both
    // untouched by this task, would otherwise confound a looser match —
    // caught in review, not by this file's original TEST_USER fixture,
    // which happens to seed zero availability and so never exercises
    // either: WeekDayList's own open-day badge (week-day-list.tsx:92-96,
    // `text-ink-secondary` when open) and, the real leak, its
    // `NextWeekSummary` preview (week-day-list.tsx:279-296) — SEVEN more
    // `DayRow`s, `isOpen={false}`, each `text-ink-muted`, rendered into the
    // SSR HTML (a native `<details>` with no `open` attribute still emits
    // its children, only CSS hides them) the moment `nextWeekHasAvailability`
    // is true. That preview is next week's, not a duplicate of THIS week,
    // and this task does not touch it — so it must not be able to fail
    // this assertion either way, which a wildcard class match could not
    // guarantee. IntakeForm's span is `text-label font-bold uppercase
    // tracking-wider text-ink-muted`; DayRow's non-open span is `w-10
    // shrink-0 text-label font-bold uppercase tracking-[0.15em]
    // text-ink-muted` — same trailing token, different `tracking-*` value
    // and DayRow-only `w-10 shrink-0` prefix. Matching the EXACT class
    // list (not `[^"]*text-ink-muted`) is what tells the two apart; the
    // "confirmed against a fixture where NextWeekSummary's rows actually
    // render" test below (AVAILABILITY_USER) is what proves this
    // narrowing still catches the real regression rather than just
    // dodging the confound by coincidence.
    it("renders none of the seven weekdays' own IntakeForm-day-row labels outside the sheet — the duplicate week this task removes", async () => {
      const closed = await renderTrainWeekWithSheet(TEST_USER, undefined);
      const matches = closed.match(INTAKE_FORM_WEEKDAY_SPAN);
      expect(matches ?? []).toHaveLength(0);
    });

    // The other half of the same proof: the labels are not gone, only
    // moved. Without this, a test that deleted IntakeForm's day list
    // entirely (rather than relocating it) would also pass the assertion
    // above.
    it("renders the seven weekdays' own IntakeForm-day-row labels inside the sheet once it opens", async () => {
      const open = await renderTrainWeekWithSheet(TEST_USER, "availability");
      const matches = open.match(INTAKE_FORM_WEEKDAY_SPAN);
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

    it("keeps only the pinned action reachable for availability (I2: the summary row it would otherwise duplicate is dropped), and never leaks the switcher it replaces", async () => {
      const closed = await renderTrainWeekWithSheet(
        AVAILABILITY_USER,
        undefined
      );
      // I2, final whole-branch review: this fixture is unconfirmed with a
      // real this-week half — exactly the state where the "Availability"
      // SummaryRow's href used to be byte-identical to the pinned
      // action's own. Two controls to one destination, in a slice whose
      // whole purpose was cutting control count — the row is dropped
      // here (option b); the pinned link is the only way in, so the
      // week's real offered hours ("1h") no longer surface on the closed
      // page outside it.
      expect(closed).not.toMatch(AVAILABILITY_ROW_LABEL_SPAN);
      // AvailabilityWeekSwitcher's own group label.
      expect(closed).not.toContain("Availability week");
      // IntakeForm's own body copy.
      expect(closed).not.toContain("When you can train");
      // The pinned link promises navigation, not the confirmation the
      // sheet itself still performs (dedicated describe block further
      // down covers the label's own shape/href/tense in full) — a stale
      // "Confirm week" claim must not survive on this closed page either.
      expect(closed).toMatch(/<a[^>]*>Set this week&#x27;s availability<\/a>/);
      expect(closed).not.toContain("Confirm week");
      expect(closed).not.toMatch(/<button[^>]*>\s*Confirm week/);
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

    // Review finding 2 on this task's fix pass: the "0, not fewer" claim
    // above was only ever exercised against TEST_USER, which seeds no
    // availability at all — `NextWeekSummary`'s own seven-row preview
    // (week-day-list.tsx) never fires there, so a wildcard weekday-text
    // match would have looked correct for a reason that had nothing to do
    // with IntakeForm actually moving. AVAILABILITY_USER's recurring
    // Monday default carries into next week's projection too (a standard-
    // week default applies to every week), which is enough to make
    // `nextWeekHasAvailability` true and put those seven rows on the page
    // for real — confirmed below by the preview's own trigger label, not
    // assumed. The scoped `INTAKE_FORM_WEEKDAY_SPAN` still returns zero
    // against that fixture; the old, wider pattern would not have.
    it("still shows zero IntakeForm weekday labels even when the next-week preview's own seven rows are on the page", async () => {
      const closed = await renderTrainWeekWithSheet(
        AVAILABILITY_USER,
        undefined
      );
      // Proves the confound is real on this fixture, not hypothetical:
      // NextWeekSummary's own disclosure trigger, present only once
      // `nextWeekHasAvailability` is true.
      expect(closed).toMatch(/Show all \d+ days/);
      // The decisive assertion, unconfounded by that preview's own matches.
      const matches = closed.match(INTAKE_FORM_WEEKDAY_SPAN);
      expect(matches ?? []).toHaveLength(0);
    });
  }
);

// Review finding 1, task 4's fix pass: with IntakeForm's own "Confirm
// week" submit moved into the "availability" sheet (the describe block
// above), the page itself lost its only pinned primary action — the spec
// (§ "One primary action, pinned") requires exactly one, permanently
// reachable, not one tap-and-a-scroll behind a sheet. `PinnedAction` now
// renders a real `<Link>` in the OPEN-WEEK branch instead, worded for
// whichever tense the athlete is actually in. Separate fixtures/users from
// AVAILABILITY_USER above so this block can drive `availabilityConfirmedAt`
// independently without disturbing that block's own assertions.
const PINNED_USER = "test-train-sheet-pinned-availability-unconfirmed";
const PINNED_CONFIRMED_USER = "test-train-sheet-pinned-availability-confirmed";

/**
 * The pinned bar's own wrapper (`data-pinned-action`), not the whole page —
 * WeekDayList's pre-existing "Assumes this week goes to plan… Set next
 * week's availability" prose CTA (`NextWeekAvailabilityNote`) carries the
 * IDENTICAL label and an identical `availability=next` href, unrelated to
 * this pinned action, so a whole-page substring check for either label
 * would pass even if the pinned bar itself said the wrong thing (or
 * nothing at all). Scoping to this one element is what actually proves the
 * PINNED bar's own label, not just that the string appears somewhere.
 */
function pinnedActionHtml(html: string): string {
  const match = html.match(
    /<div data-pinned-action="true"[^>]*>[\s\S]*?<\/div>/
  );
  expect(match).not.toBeNull();
  return match![0];
}

describe.skipIf(!hasDb)(
  "TrainPage: the page keeps one pinned primary action, worded for the athlete's actual tense",
  () => {
    beforeAll(async () => {
      await seedOpenWeek(PINNED_USER);
      await seedOpenWeek(PINNED_CONFIRMED_USER);
      const { db, schema } = await import("@/lib/db");
      await db
        .update(schema.weekPlans)
        .set({ availabilityConfirmedAt: new Date() })
        .where(eq(schema.weekPlans.userId, PINNED_CONFIRMED_USER));
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, PINNED_USER));
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, PINNED_CONFIRMED_USER));
    });

    it('pins "Set this week\'s availability" — a real navigation link, not a disguised button — to the availability sheet in this-week mode, while this week is unconfirmed', async () => {
      const html = await renderTrainWeekWithSheet(PINNED_USER, undefined);
      // Exactly one pinned action on the closed page — the spec's own
      // "one primary action, pinned" rule, not merely this label's own
      // presence.
      expect(html.match(/data-pinned-action/g) ?? []).toHaveLength(1);
      const pinned = pinnedActionHtml(html);
      // I2, final whole-branch review: this used to be "Confirm week" — a
      // claim the tap itself does not honour, since this is a `<Link>`
      // (see PinnedAction's own `LinkProps`) that only navigates to the
      // sheet housing the real "Confirm week" submit. Renamed to match
      // the "Set next week's availability" tense already beside it: a
      // link-shaped pinned action promises to take you somewhere, never
      // to have done something on your behalf.
      const match = pinned.match(
        /<a[^>]*href="([^"]+)"[^>]*>Set this week&#x27;s availability<\/a>/
      );
      expect(match).not.toBeNull();
      const href = match![1];
      expect(href).toContain("sheet=availability");
      // The "confirm THIS week" tense, not next week's — no `?availability=
      // next` riding along.
      expect(href).not.toContain("availability=next");
      // No `<button>` masquerading as this bar's action either.
      expect(pinned).not.toContain("<button");
      // The stale claim is gone outright, not merely relabelled beside it.
      expect(pinned).not.toContain("Confirm week");
      // I2 option (b): the "Availability" SummaryRow is dropped in this
      // exact state — its href was byte-identical to the pinned link's
      // (both `resolvedHref({ sheet: "availability" })`), so keeping both
      // was two controls to one destination in a slice whose whole
      // purpose was cutting control count.
      expect(html).not.toMatch(AVAILABILITY_ROW_LABEL_SPAN);
    });

    it('re-labels to "Set next week\'s availability" once this week is confirmed, and the "Availability" row comes back since it no longer duplicates the pinned link', async () => {
      const html = await renderTrainWeekWithSheet(
        PINNED_CONFIRMED_USER,
        undefined
      );
      expect(html.match(/data-pinned-action/g) ?? []).toHaveLength(1);
      const pinned = pinnedActionHtml(html);
      const match = pinned.match(
        /<a[^>]*href="([^"]+)"[^>]*>Set next week&#x27;s availability<\/a>/
      );
      expect(match).not.toBeNull();
      const href = match![1];
      expect(href).toContain("availability=next");
      // Confirmed: the "Confirm week"/"Set this week's availability" tense
      // is gone from THIS bar, not merely relabelled beside a stale
      // duplicate.
      expect(pinned).not.toContain("Confirm week");
      expect(pinned).not.toContain("Set this week&#x27;s availability");
      // I2 option (b), the other half: the pinned link now points at
      // `?availability=next` — a different landing mode than the row's
      // own plain `resolvedHref({ sheet: "availability" })` — so showing
      // both is not the I2 duplicate, and the row stays.
      expect(html).toMatch(AVAILABILITY_ROW_LABEL_SPAN);
    });

    // I1, final whole-branch review: `PinnedAction` is `position: sticky`,
    // so it always reserves its own in-flow slot — rendering it between
    // two summary rows (as it used to) put that reserved gap, and the
    // un-stuck button at max scroll, mid-document instead of at the very
    // bottom the spec's own wireframe puts it (§3, "The new Week, top to
    // bottom"). This pins the actual DOM order, which a purely visual
    // check would miss.
    it("renders the pinned action after every summary row, not mid-document between them", async () => {
      const html = await renderTrainWeekWithSheet(PINNED_USER, undefined);
      const pinnedAt = html.indexOf('data-pinned-action="true"');
      expect(pinnedAt).toBeGreaterThan(-1);
      // Every row the wireframe lists before the pinned action — "Why
      // this week", "Plan setup", "Races" — must all appear earlier in
      // the document, not just the last one.
      for (const label of ["Why this week", "Plan setup", "Races"]) {
        const rowAt = html.indexOf(`>${label}<`);
        expect(rowAt).toBeGreaterThan(-1);
        expect(rowAt).toBeLessThan(pinnedAt);
      }
    });
  }
);

// Task 5's own destination: PlanPreviewCard (21 rows, ~1.5 phone screens)
// moved off the page and behind a banner. Seeds BOTH a confirmed plan (so
// `week` exists — the thing the card used to bury) and a second,
// unconfirmed `previewTrainingPlan` call for the same athlete (a
// later-season proposal). `previewTrainingPlan` only ever deletes a PRIOR
// DRAFT row before writing a new one, and the first plan is `status:
// "active"` by the time the second call runs — not a draft — so both
// survive side by side, the same "independent of whether an active plan
// also exists" shape page.tsx's own comment on the draft query describes.
const PLAN_REVIEW_USER = "test-train-sheet-moves-plan-review";

async function seedPlanWithDraftReview(userId: string): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  const { previewTrainingPlan, confirmTrainingPlan } =
    await import("@/lib/training-plan");

  await db.insert(schema.users).values({
    id: userId,
    name: "Test Athlete",
    email: `${userId}@example.invalid`,
  });

  const activeRaceDate = ymd(new Date(Date.now() + 60 * DAY_MS));
  const activePreview = await previewTrainingPlan({
    userId,
    raceType: "marathon",
    raceDate: activeRaceDate,
    title: "Active season plan",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });
  if (!activePreview.ok) {
    throw new Error(`previewTrainingPlan refused: ${activePreview.reason}`);
  }
  const confirmed = await confirmTrainingPlan(
    userId,
    activePreview.preview.planId
  );
  if (!confirmed.ok) {
    throw new Error(`confirmTrainingPlan refused: ${confirmed.reason}`);
  }

  // 238 calendar days, not a raw `Date.now() + N * DAY_MS` offset: review
  // finding 4 wants the exact rendered week count asserted below, and
  // `weeksTotal` is `Math.ceil(daysBetween(now, raceDate) / 7)`
  // (training-plan.ts) -- `daysBetween` rounds a NOW-to-MIDNIGHT ms
  // difference, so its result depends on what time of day the suite
  // happens to run, landing on either 237 or 238 days for a target exactly
  // 238 CALENDAR days out. `ceil` only changes the answer between those
  // two candidates when the smaller one is a multiple of 7 (237 isn't), so
  // 238 is a deliberately chosen stable offset: `Math.ceil(237 / 7)` and
  // `Math.ceil(238 / 7)` both equal 34, whichever way the clock rounds.
  const draftRaceDate = addDaysYmd(ymd(new Date()), 238);
  const draftPreview = await previewTrainingPlan({
    userId,
    raceType: "marathon",
    raceDate: draftRaceDate,
    title: "Next season proposal",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });
  if (!draftPreview.ok) {
    throw new Error(`previewTrainingPlan refused: ${draftPreview.reason}`);
  }
}

describe.skipIf(!hasDb)(
  "TrainPage: a draft plan preview becomes a destination",
  () => {
    beforeAll(async () => {
      await seedPlanWithDraftReview(PLAN_REVIEW_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, PLAN_REVIEW_USER));
    });

    it("keeps a banner on the page but not the 21-row table it replaces", async () => {
      const closed = await renderTrainWeekWithSheet(
        PLAN_REVIEW_USER,
        undefined
      );
      // The banner that replaces the card stays on the page, with the
      // real week count -- review finding 4: checking only the
      // number-independent tail let a wrong field through silently.
      // React SSR inserts an empty `<!--` `-->` comment between the JSX
      // text and the interpolated `{weeksTotal}` (and another right after
      // it), so strip comments first rather than working around them by
      // dropping the number from the assertion.
      const closedNoComments = closed.replace(/<!--.*?-->/g, "");
      expect(closedNoComments).toContain("A 34-week plan is ready");
      expect(closed).toContain("Review →");
      // The card's own distinctive markers must not also render inline.
      expect(closed).not.toContain('data-testid="phase-total"');
      expect(closed).not.toContain(">Rebuild<");
      expect(closed).not.toContain(">Start this plan<");
      // The week the draft used to bury is still the headline content —
      // proof the banner is winning back the fold, not just adding a
      // second UI on top of the old one.
      expect(closed).toContain("data-season-progress");
    });

    it("puts the 21-row table and its Rebuild/Start actions in the sheet once it opens", async () => {
      const open = await renderTrainWeekWithSheet(
        PLAN_REVIEW_USER,
        "plan-review"
      );
      expect(open).toContain('role="dialog"');
      expect(open).toContain('aria-label="Plan review"');
      expect(open).toContain('data-testid="phase-total"');
      expect(open).toContain(">Rebuild<");
      expect(open).toContain(">Start this plan<");
    });
  }
);

// Task 5's ruling on the OTHER PlanPreviewCard call site (the `!plan`
// early return, around page.tsx:505): that branch has no open week to
// bury the card below — `draftPreview` and `firstRun`/`PlanEmpty` are
// mutually exclusive there, so a draft is the entire content of the
// branch, not something sitting on top of something else — and the
// branch hard-codes `overlay: null` regardless of `sheetParam`, so a
// `?sheet=plan-review` banner would link to a sheet this branch has no
// machinery to open. It keeps rendering the card inline.
const NO_PLAN_DRAFT_USER = "test-train-no-plan-draft-preview";

async function seedDraftWithNoActivePlan(userId: string): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  const { previewTrainingPlan } = await import("@/lib/training-plan");

  await db.insert(schema.users).values({
    id: userId,
    name: "Test Athlete",
    email: `${userId}@example.invalid`,
  });

  const raceDate = ymd(new Date(Date.now() + 90 * DAY_MS));
  const preview = await previewTrainingPlan({
    userId,
    raceType: "marathon",
    raceDate,
    title: "First plan proposal",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });
  if (!preview.ok) {
    throw new Error(`previewTrainingPlan refused: ${preview.reason}`);
  }
}

describe.skipIf(!hasDb)(
  "TrainPage: a first-run draft (no active plan) stays inline",
  () => {
    beforeAll(async () => {
      await seedDraftWithNoActivePlan(NO_PLAN_DRAFT_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, NO_PLAN_DRAFT_USER));
    });

    it("renders the 21-row table inline, not behind a banner — there is no open week here for it to bury", async () => {
      const html = await renderTrainWeekWithSheet(
        NO_PLAN_DRAFT_USER,
        undefined
      );
      expect(html).toContain('data-testid="phase-total"');
      expect(html).toContain(">Rebuild<");
      expect(html).toContain(">Start this plan<");
      expect(html).not.toContain("Review →");
    });

    it("opens no dialog for ?sheet=plan-review — this branch hard-codes overlay: null", async () => {
      const html = await renderTrainWeekWithSheet(
        NO_PLAN_DRAFT_USER,
        "plan-review"
      );
      expect(html).not.toContain('role="dialog"');
      // Still the inline card, sheet param or not.
      expect(html).toContain('data-testid="phase-total"');
    });
  }
);
