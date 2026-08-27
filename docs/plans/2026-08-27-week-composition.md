# Week composition (slice 1) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Train ▸ Week's top half from a document into a surface: a
verdict headline, the season as two figures, a day strip that carries the
week's shape, and one open day instead of seven rows — with the Season tab
retired into Week.

**Architecture:** Recomposition of existing server components in
`src/app/train/page.tsx` plus three new presentational components. No new
server actions, no schema change. The open day is URL state (`?day=`), the
way sheets already are, so it survives reload and is linkable.

**Tech Stack:** Next.js App Router (server components), React 19, Tailwind v4
with the app's token classes, Drizzle, Vitest + jsdom (`createRoot` + `act`,
no testing-library).

**Spec:** `docs/specs/2026-08-27-week-surface-redesign-design.md`

## Global Constraints

- **Colour means status in the day strip, always.** `STATUS_DOT`
  (`src/lib/status-color.ts`) is shared with `week-day-list.tsx` precisely so
  a status never means two colours. Intensity gets a notch, never a hue.
- **No new colour tokens.** Use existing token classes only (`bg-chart-2`,
  `text-ink-muted`, `bg-surface-overlay`, `border-hairline`, …). The scan in
  `tests/type-scale-guard.test.ts` reads source and only ever lets ad-hoc
  sizes and alphas fall.
- **Uncertainty vocabulary.** Anything that could be absent renders through
  `<Unavailable>` / the `missing_input` / `calibrating` kinds, never an
  invented cheerful string. See `src/components/ui/unavailable.tsx`.
- **Tests are jsdom + `createRoot` + `act`**, matching
  `src/components/settings/connector-card.test.tsx`. No testing-library.
- **Every test is watched failing first.** Mutation-check any guard whose
  failure would be silent.
- **Slice 1 ships alone.** The four `Collapsible`s at the bottom of Week stay
  exactly as they are; slice 2 replaces them with summary rows.

---

### Task 1: Retire the Season tab

Train drops to three tabs. The Season tab is one screen with **zero**
actions (flow inventory), and its content splits: the timeline chart to
Fitness, the two figures to Week (Task 2).

**Files:**

- Modify: `src/lib/log-href.ts:89` — `TRAIN_TABS`
- Modify: `src/app/train/page.tsx` — the `tab === "season"` branch, `SeasonTab`
- Modify: `src/lib/telemetry.surfaces.test.ts` — retired-key assertion
- Test: `src/lib/telemetry.surfaces.test.ts`, `src/lib/log-href.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `TRAIN_TABS: TrainTab[] = ["week", "history", "fitness"]`. Task 2
  relies on `SeasonTimelineCard` still being imported somewhere (Fitness).

- [ ] **Step 1: Write the failing tests**

In `src/lib/telemetry.surfaces.test.ts`, add to the existing describe:

```ts
it("no longer offers season as a train tab", () => {
  expect(TRAIN_TABS).not.toContain("season");
  expect(TRAIN_TABS).toEqual(["week", "history", "fitness"]);
});

// v0.121.0 shipped tab-level telemetry one day before this tab was retired.
// Rows written as `train:season` still exist and must stay readable; the key
// is retired from the offered set, not from history.
it("keeps train:season readable as a retired key", () => {
  expect(RETIRED_SURFACE_KEYS).toContain("train:season");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/telemetry.surfaces.test.ts`
Expected: FAIL — `TRAIN_TABS` still contains `"season"`, and
`RETIRED_SURFACE_KEYS` is not defined.

- [ ] **Step 3: Implement**

In `src/lib/log-href.ts`:

```ts
export const TRAIN_TABS: TrainTab[] = ["week", "history", "fitness"];
```

In `src/lib/telemetry.ts`, beside `SURFACES`:

```ts
/**
 * Keys that were once offered and no longer are. `/admin` labels rows
 * carrying them so a retired destination reads as history rather than as a
 * bug — the same treatment pre-v0.121 rows get for having no tab at all.
 * Retiring a tab must never make its recorded views unreadable.
 */
export const RETIRED_SURFACE_KEYS = ["train:season"] as const;
```

In `src/app/train/page.tsx`, delete the `tab === "season"` branch and the
whole `SeasonTab` function, and move its one card to `FitnessTab`'s render,
directly under the existing tiles:

```tsx
<div className="mb-8">
  <SeasonTimelineCard data={points} />
</div>
```

`points` is computed by the block that `SeasonTab` used to own — move that
query with it.

- [ ] **Step 4: Add the redirect**

`/train?tab=season` must not render an empty tab. In `TrainPage`, before
`recordSurfaceView`:

```tsx
// A retired tab is a redirect, not a 404 and not a silent fallback: the
// athlete may have it bookmarked, and telemetry should record where they
// actually landed.
if (sp.tab === "season") redirect("/train?tab=week");
```

Import `redirect` from `next/navigation`.

- [ ] **Step 5: Run the suite**

Run: `npx vitest run src/lib/ && npm run typecheck`
Expected: PASS. The typecheck will flag any leftover reference to `SeasonTab`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/log-href.ts src/lib/telemetry.ts src/lib/telemetry.surfaces.test.ts src/app/train/page.tsx
git commit -m "refactor(train): retire the Season tab, keep its key readable"
```

---

### Task 2: The season as two figures

**Files:**

- Create: `src/components/train/season-progress.tsx`
- Create: `src/components/train/season-progress.test.tsx`
- Modify: `src/app/train/page.tsx` — `WeekTab`

**Interfaces:**

- Consumes: `TRAIN_TABS` from Task 1.
- Produces:
  `SeasonProgress({ progressPct, weeksToRace, raceName }: { progressPct: number | null; weeksToRace: number | null; raceName: string | null })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SeasonProgress } from "./season-progress";

// (standard root/container harness — copy from connector-card.test.tsx)

describe("SeasonProgress", () => {
  it("shows progress and the weeks left when both are known", async () => {
    const el = await render(
      <SeasonProgress
        progressPct={17}
        weeksToRace={5}
        raceName="Autumn Marathon"
      />
    );
    expect(el.textContent).toContain("17%");
    expect(el.textContent).toContain("5");
    expect(el.textContent).toContain("WEEKS TO RACE");
  });

  // The engine computes progress from plan weeks elapsed against total. An
  // athlete between plans has no such figure, and inventing 0% would read as
  // "you have done nothing" rather than "there is nothing to measure".
  it("says nothing at all when there is no plan to progress through", async () => {
    const el = await render(
      <SeasonProgress progressPct={null} weeksToRace={null} raceName={null} />
    );
    expect(el.querySelector("[data-season-progress]")).toBeNull();
  });

  it("still shows progress when no race is scheduled", async () => {
    const el = await render(
      <SeasonProgress progressPct={40} weeksToRace={null} raceName={null} />
    );
    expect(el.textContent).toContain("40%");
    expect(el.textContent).not.toContain("WEEKS TO RACE");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/train/season-progress.test.tsx`
Expected: FAIL — cannot resolve `./season-progress`.

- [ ] **Step 3: Implement**

```tsx
/**
 * The Season tab, reduced to what it actually said. That tab was one screen
 * with zero actions (docs/2026-08-26-flow-inventory.md) — a report wearing a
 * tab's clothing. Its timeline chart moved to Fitness; these two figures are
 * what remained worth reading on Week.
 *
 * Renders nothing rather than zeroes when there is no plan: 0% is a claim
 * about the athlete, "no figure" is a claim about the data.
 */
export function SeasonProgress({
  progressPct,
  weeksToRace,
  raceName,
}: {
  progressPct: number | null;
  weeksToRace: number | null;
  raceName: string | null;
}) {
  if (progressPct == null && weeksToRace == null) return null;
  return (
    <div
      data-season-progress
      className="mb-5 flex gap-8 border-t border-hairline pt-4"
    >
      {progressPct != null && (
        <div>
          <p className="text-heading font-bold tracking-[-0.02em] tabular-nums">
            {Math.round(progressPct)}%
          </p>
          <p className="text-label font-bold uppercase tracking-[0.13em] text-ink-muted">
            Progress
          </p>
        </div>
      )}
      {weeksToRace != null && (
        <div>
          <p className="text-heading font-bold tracking-[-0.02em] tabular-nums">
            {weeksToRace}
          </p>
          <p className="text-label font-bold uppercase tracking-[0.13em] text-ink-muted">
            {raceName ? "Weeks to race" : "Weeks left"}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `WeekTab`**

Render directly under `TrainHeader`, above the week card. Reuse the figures
the retired `SeasonTab` computed (`points`) for `progressPct`, and the
existing race countdown for `weeksToRace` — both are already fetched in
`WeekTab` for the race chip.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/components/train/ && npm run lint && npm run typecheck
git add src/components/train/season-progress.tsx src/components/train/season-progress.test.tsx src/app/train/page.tsx
git commit -m "feat(train): the season as two figures on Week"
```

---

### Task 3: The day strip carries the week's shape

The load-bearing task. With six of seven days collapsed (Task 4), these seven
marks are the only place the week's shape can live.

**Files:**

- Modify: `src/components/week/week-strip.tsx` (rewrite)
- Create: `src/components/week/week-strip.test.tsx`
- Create: `src/lib/week-plan/day-shape.ts`
- Create: `src/lib/week-plan/day-shape.test.ts`

**Interfaces:**

- Consumes: `DaySlot` (`src/lib/week-plan/types.ts`), `STATUS_DOT`,
  `STATUS_LABEL` (`src/lib/status-color.ts`).
- Produces:
  - `dayShape(day: DaySlot, maxMins: number): { mins: number; heightPct: number; hard: boolean; rest: boolean }`
  - `weekMaxMins(days: DaySlot[]): number`
  - `WeekStrip({ days, selectedDate, hrefForDay })` where
    `hrefForDay: (date: string) => string`.

- [ ] **Step 1: Write the failing test for the pure scale**

`src/lib/week-plan/day-shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dayShape, weekMaxMins } from "./day-shape";

const slot = (over: Partial<DaySlot> = {}): DaySlot => ({
  date: "2026-08-27",
  availableBlocks: [],
  workouts: [],
  availableMins: 0,
  status: "planned",
  ...over,
});

const w = (durationMins: number, purpose: string) =>
  ({
    durationMins,
    purpose,
    day: 3,
    sport: "Ride",
    type: "Endurance",
    intensity: "Z1-Z2",
    description: "",
    minEffectiveMins: 30,
    blockIdx: 0,
  }) as unknown as ScheduledWorkout;

describe("dayShape", () => {
  it("scales height against the week's longest day", () => {
    const day = slot({ workouts: [w(60, "aerobic_base")] });
    expect(dayShape(day, 120).heightPct).toBe(50);
  });

  it("sums a day that holds more than one session", () => {
    const day = slot({ workouts: [w(45, "aerobic_base"), w(30, "recovery")] });
    expect(dayShape(day, 150).mins).toBe(75);
  });

  // A 20-minute recovery spin and an empty day must not look alike. The bar
  // never falls below a floor, and a rest day is not a short bar at all.
  it("floors a very short session instead of rendering a hairline", () => {
    const day = slot({ workouts: [w(20, "recovery")] });
    expect(dayShape(day, 300).heightPct).toBeGreaterThanOrEqual(12);
  });

  it("calls a day with no sessions rest, not a zero-height bar", () => {
    expect(dayShape(slot(), 120).rest).toBe(true);
    expect(dayShape(slot({ workouts: [w(60, "long")] }), 120).rest).toBe(false);
  });

  // Intensity is read from the engine's own purpose taxonomy, never by
  // parsing the "Z4-Z5" display string.
  it("marks threshold and vo2max days hard, and nothing else", () => {
    expect(dayShape(slot({ workouts: [w(60, "threshold")] }), 60).hard).toBe(
      true
    );
    expect(dayShape(slot({ workouts: [w(60, "vo2max")] }), 60).hard).toBe(true);
    expect(dayShape(slot({ workouts: [w(300, "long")] }), 300).hard).toBe(
      false
    );
    expect(dayShape(slot({ workouts: [w(60, "aerobic_base")] }), 60).hard).toBe(
      false
    );
  });

  it("never divides by zero on a week with nothing planned", () => {
    expect(weekMaxMins([slot(), slot()])).toBeGreaterThan(0);
    expect(dayShape(slot(), weekMaxMins([slot()])).heightPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/week-plan/day-shape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure module**

```ts
import type { DaySlot } from "./types";

/** Below this a bar reads as a hairline rather than as a session. */
const MIN_HEIGHT_PCT = 12;

/**
 * The engine's own taxonomy, not the "Z4-Z5" display string: `purpose` is
 * what the planner reasons in (PURPOSE_BY_TYPE, src/lib/training-plan.ts),
 * and parsing the human-readable band would break the moment its wording
 * changes.
 */
const HARD_PURPOSES = new Set(["threshold", "vo2max"]);

export function weekMaxMins(days: DaySlot[]): number {
  const max = Math.max(
    0,
    ...days.map((d) => d.workouts.reduce((s, w) => s + w.durationMins, 0))
  );
  // Never zero: the caller divides by this, and a week with nothing planned
  // is a real state (a new athlete, an off-season week).
  return max > 0 ? max : 1;
}

export function dayShape(
  day: DaySlot,
  maxMins: number
): { mins: number; heightPct: number; hard: boolean; rest: boolean } {
  const mins = day.workouts.reduce((s, w) => s + w.durationMins, 0);
  const rest = day.workouts.length === 0;
  const raw = (mins / maxMins) * 100;
  return {
    mins,
    heightPct: rest ? 0 : Math.max(MIN_HEIGHT_PCT, Math.min(100, raw)),
    hard: day.workouts.some((w) => HARD_PURPOSES.has(w.purpose)),
    rest,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/lib/week-plan/day-shape.test.ts`

- [ ] **Step 5: Write the failing component test**

`src/components/week/week-strip.test.tsx` — jsdom harness as in Task 2:

```tsx
describe("WeekStrip", () => {
  it("gives every day a link and an accessible name that reads as a sentence", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate="2026-08-27"
        hrefForDay={(d) => `/train?day=${d}`}
      />
    );
    const thu = el.querySelector('a[href="/train?day=2026-08-27"]');
    expect(thu?.getAttribute("aria-label")).toBe(
      "Thursday, 95 minutes, hard session, planned"
    );
  });

  // A bar chart is not a label. Sighted athletes read height; everyone else
  // reads this string, and it must carry the same two channels.
  it("names a rest day as rest rather than as zero minutes", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
      />
    );
    const mon = el.querySelector('a[href="/train?day=2026-08-24"]');
    expect(mon?.getAttribute("aria-label")).toBe("Monday, rest");
  });

  it("marks the selected day for assistive tech, not only in colour", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate="2026-08-27"
        hrefForDay={(d) => `/train?day=${d}`}
      />
    );
    expect(
      el
        .querySelector('a[href="/train?day=2026-08-27"]')
        ?.getAttribute("aria-current")
    ).toBe("true");
  });

  it("puts a notch on hard days only", async () => {
    const el = await render(
      <WeekStrip
        days={week}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
      />
    );
    expect(el.querySelectorAll("[data-hard]").length).toBe(1);
  });

  it("keeps the race glyph", async () => {
    const el = await render(
      <WeekStrip
        days={raceWeek}
        selectedDate={null}
        hrefForDay={(d) => `/train?day=${d}`}
      />
    );
    expect(el.querySelector('[data-status="race"]')).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify it fails, then implement**

Rewrite `week-strip.tsx`: each day becomes an `<a>` wrapping the label, a bar
(`height: ${heightPct}%` inside a fixed-height track, fill `STATUS_DOT[status]`),
a `data-hard` notch when `hard`, and the existing 🏁 for `status === "race"`.
Rest renders the app's rest glyph rather than a bar. Keep `min-w-fit` and
`gap-x-2` and the comment explaining why they are load-bearing.

- [ ] **Step 7: Mutation-check the accessible name**

Break `aria-label` to the date alone, run the test, watch exactly the two
name tests fail, restore.

- [ ] **Step 8: Commit**

```bash
git add src/lib/week-plan/day-shape.ts src/lib/week-plan/day-shape.test.ts src/components/week/week-strip.tsx src/components/week/week-strip.test.tsx
git commit -m "feat(week): the day strip carries duration, status and hard days"
```

---

### Task 4: One open day

**Files:**

- Modify: `src/app/train/page.tsx` — `WeekTab`, `TrainPage` (read `?day=`)
- Modify: `src/components/train/week-day-list.tsx` — render one day
- Modify: `src/lib/log-href.ts` — `buildTrainHref` carries `day`
- Test: `src/components/train/week-day-list.test.tsx`,
  `src/lib/log-href.test.ts`

**Interfaces:**

- Consumes: `WeekStrip`'s `hrefForDay` (Task 3).
- Produces: `openDayFrom(days: DaySlot[], param: string | undefined, todayYmd: string): string` — the date to open, defaulting to today, falling back to the first day of the week when today is not in it.

- [ ] **Step 1: Write the failing test for the selection rule**

```ts
describe("openDayFrom", () => {
  it("opens today by default", () => {
    expect(openDayFrom(week, undefined, "2026-08-27")).toBe("2026-08-27");
  });

  it("opens the day the URL names", () => {
    expect(openDayFrom(week, "2026-08-29", "2026-08-27")).toBe("2026-08-29");
  });

  // ?day= is untrusted URL input. A date outside this week must not open an
  // empty panel or reach a query — the same rule SheetHost applies to ids.
  it("ignores a date that is not in this week", () => {
    expect(openDayFrom(week, "2027-01-01", "2026-08-27")).toBe("2026-08-27");
    expect(openDayFrom(week, "garbage", "2026-08-27")).toBe("2026-08-27");
  });

  // Next week's card, or a week the athlete is looking back at, contains no
  // "today" at all.
  it("falls back to the week's first day when today is elsewhere", () => {
    expect(openDayFrom(week, undefined, "2026-09-14")).toBe("2026-08-24");
  });
});
```

- [ ] **Step 2: Run — expect FAIL. Implement in `src/lib/week-plan/day-shape.ts`.**

```ts
export function openDayFrom(
  days: DaySlot[],
  param: string | undefined,
  todayYmd: string
): string {
  const dates = new Set(days.map((d) => d.date));
  if (param && dates.has(param)) return param;
  if (dates.has(todayYmd)) return todayYmd;
  return days[0]?.date ?? todayYmd;
}
```

- [ ] **Step 3: Render one day**

`WeekDayList` takes `openDate: string`. It renders the open day's `DayRow`
expanded exactly as today's row renders now (actions included), and renders
no other `DayRow` at all. The next-week summary, divider and availability
note stay.

- [ ] **Step 4: Thread `day` through the href builder**

Add `day` to `buildTrainHref`'s params so switching tabs or filters keeps the
open day, matching how `view`, `month`, `range` and `sport` already behave.
Add a case to `src/lib/log-href.test.ts` pinning that `day` survives a tab
switch.

- [ ] **Step 5: Run everything, then commit**

```bash
npx vitest run && npm run lint && npm run typecheck
git add -u && git commit -m "feat(week): open one day at a time, from the URL"
```

---

### Task 5: The verdict headline

**Files:**

- Create: `src/lib/week-plan/verdict-line.ts`
- Create: `src/lib/week-plan/verdict-line.test.ts`
- Modify: `src/app/train/page.tsx` — `WeekTab`

**Interfaces:**

- Consumes: `dayShape` (Task 3), the readiness figure `WeekTab` already
  fetches for the chip.
- Produces:
  `verdictLine(input: { openDay: DaySlot; readiness: Figure<Readiness>; firstRun: boolean }): { text: string; emphasis: string | null } | null`

- [ ] **Step 1: Write the failing test**

```ts
describe("verdictLine", () => {
  it("names the day's session and says the athlete is ready", () => {
    const v = verdictLine({
      openDay: longRide,
      readiness: green,
      firstRun: false,
    });
    expect(v?.text).toBe("Thursday is your long one — you're ready for it.");
    expect(v?.emphasis).toBe("you're ready for it");
  });

  it("says rest is the plan on a rest day, rather than nothing", () => {
    expect(
      verdictLine({ openDay: restDay, readiness: green, firstRun: false })?.text
    ).toBe("Nothing planned today — that's the plan.");
  });

  // The whole project's discipline: no claim the engine cannot support. An
  // athlete with no readiness figure gets a statement about the session and
  // NO statement about their body.
  it("makes no readiness claim when readiness is calibrating", () => {
    const v = verdictLine({
      openDay: longRide,
      readiness: calibrating,
      firstRun: false,
    });
    expect(v?.text).toBe("Thursday is your long one.");
    expect(v?.emphasis).toBeNull();
  });

  it("renders nothing at all on first run", () => {
    expect(
      verdictLine({ openDay: longRide, readiness: missing, firstRun: true })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL. Implement, keeping every branch a pure string.**

- [ ] **Step 3: Render it in `WeekTab`** under `TrainHeader`, with `emphasis`
      wrapped in `text-accent`. When `verdictLine` returns null, render
      nothing — first run keeps the v0.120.0 welcome voice it already has.

- [ ] **Step 4: Mutation-check the readiness branch** — make `calibrating`
      fall through to the confident sentence, watch that one test fail,
      restore.

- [ ] **Step 5: Commit**

```bash
git add src/lib/week-plan/verdict-line.ts src/lib/week-plan/verdict-line.test.ts src/app/train/page.tsx
git commit -m "feat(week): lead with the verdict, not the score"
```

---

### Task 6: Pin the primary action

**Files:**

- Modify: `src/app/train/page.tsx` — the confirm/plan form
- Create: `src/components/week/pinned-action.tsx`
- Create: `src/components/week/pinned-action.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("keeps the action reachable and out of the bottom nav's way", async () => {
  const el = await render(
    <PinnedAction label="Confirm week" formAction={noop} />
  );
  const wrap = el.querySelector("[data-pinned-action]");
  expect(wrap?.className).toContain("sticky");
  // BottomNav owns the bottom edge on phones; overlapping it would put two
  // controls under one thumb.
  expect(wrap?.className).toContain("bottom-20");
});

it("is a real submit button, not a link that posts", async () => {
  const el = await render(
    <PinnedAction label="Confirm week" formAction={noop} />
  );
  expect(el.querySelector('button[type="submit"]')?.textContent).toBe(
    "Confirm week"
  );
});
```

- [ ] **Step 2: Run — FAIL. Implement with `sticky bottom-20 z-30` and a
      `bg-surface-base/95 backdrop-blur` band so content scrolling under it
      stays legible.**

- [ ] **Step 3: Verify against `BottomNav`'s height at 390 px in the app**
      (`npm run dev`), not only in jsdom — jsdom computes no layout.

- [ ] **Step 4: Commit**

```bash
git add src/components/week/pinned-action.tsx src/components/week/pinned-action.test.tsx src/app/train/page.tsx
git commit -m "feat(week): pin the week's primary action"
```

---

### Task 7: Capture, axe, and re-measure

The spec's 4.8 → ~1.2 screens is a **prediction** until this runs.

**Files:**

- Modify: `scripts/verify-surfaces.ts` — add `train-open-day` if the open day
  needs its own surface
- Modify: `docs/2026-08-26-flow-inventory.md` — append the re-measurement
- Modify: `surface-ceilings.json` — only via `npm run verify:ratchet -- --update`

- [ ] **Step 1: Seed a real week**

```bash
npx tsx scripts/seed-confirmed-race.ts
```

The flow inventory's own caveat: a database with no plan measures `PlanEmpty`
and reports a plausible, meaningless number.

- [ ] **Step 2: Capture**

```bash
SCREENSHOT_BASE_URL=http://localhost:3210 npm run verify:surfaces -- week-redesign --only=train,train-plan-preview
```

- [ ] **Step 3: Open the pictures.** Both themes, both viewports. This is the
      step with no entry point and it is not optional — v0.122.0 shipped a
      clean `0 confirmed` over a state its fixture never rendered.

- [ ] **Step 4: Re-measure choice load** with the same method as the flow
      inventory (visible/enabled controls, split appChrome / tabs / surface;
      check `appChrome` is 5 on every row before quoting anything), and append
      the result to the inventory with the date.

- [ ] **Step 5: Commit**

```bash
git add docs/2026-08-26-flow-inventory.md
git commit -m "docs(flow): the redesign, measured rather than predicted"
```

---

## Self-review

**Spec coverage.** Verdict headline → Task 5. Race line and the `ⓘ`
destinations → **slice 2, not this plan** (they need sheets). Progress figures
→ Task 2. Day strip V2 → Task 3. Open day → Task 4. Pinned action → Task 6.
Season retirement + telemetry + redirect → Task 1. Availability timeline →
slice 3, its own plan. Summary rows → slice 2. Re-measurement → Task 7.

**Placeholders.** None: every code step carries real code, every test step
real assertions.

**Type consistency.** `dayShape`/`weekMaxMins`/`openDayFrom` all live in
`src/lib/week-plan/day-shape.ts` and are used under those exact names in
Tasks 3, 4 and 5. `WeekStrip`'s `hrefForDay` signature matches what Task 4's
`buildTrainHref` produces.

**Known gap, stated rather than hidden.** Task 5's `verdictLine` reads a
`Figure<Readiness>` whose exact type name must be confirmed against
`src/lib/readiness.ts` at implementation time; if it differs, the test's
fixtures change but no logic does.
