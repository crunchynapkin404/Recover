# Week destinations (slice 2) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make slice 1 shippable. Move everything the Week surface only
_explains_ or _configures_ off the page and behind a destination, so the page
is the week and nothing else.

**Architecture:** One sheet mechanism for Train, mirroring Today's
`?sheet=` pattern, rendered from `WeekTab` where the data already lives. Four
sheets, four summary rows, one banner. No new server actions, no schema
change, no new route.

**Tech Stack:** Next.js App Router (server components), React 19, Tailwind v4
token classes, Vitest + jsdom (`createRoot` + `act`, no testing-library).

**Spec:** `docs/specs/2026-08-27-week-surface-redesign-design.md`

**Why this slice is not optional.** Slice 1 measured at 3.28 phone screens
against a predicted 1.2, with visible controls _rising_ 21 → 28, because it
added the verdict, strip and figures while removing nothing. The spec's own
Risks section predicted this ("Slice 1 without slice 2 is a regression… They
must ship in the same release"). Slice 1 is merged but **must not be released
alone**; this slice is what makes the release honest.

## Global Constraints

- **Colour means status in the day strip, always.** `STATUS_DOT`
  (`src/lib/status-color.ts`) is shared with `week-day-list.tsx`.
- **No new colour tokens.** Existing token classes only. Note
  `--surface-raised` and `--surface-overlay` are BOTH `#ffffff` in light —
  use `--surface-selected` for a highlight inside a raised container.
- **Uncertainty vocabulary.** Absent data renders through `<Unavailable>` /
  `missing_input` / `calibrating`, never an invented string.
- **Tests are jsdom + `createRoot` + `act`**, matching
  `src/components/settings/connector-card.test.tsx`. No testing-library.
- **Every test watched failing first.** Mutation-check any guard whose
  failure would be silent.
- **Nothing the engine knows may be deleted.** Every block that leaves the
  page must be reachable in one tap. A destination that drops content is a
  failed task, not a smaller one.
- **This branch's signature defect is "correct in isolation, wrong in
  composition."** Six such defects were found in slice 1, each passing its own
  task review. Before finishing any task, ask what _other_ surface or task
  consumes what you touched.

## Three decisions taken as plan author

Recorded because they deviate from, or resolve silences in, the spec.

1. **Races is a sheet, not a route.** The spec said "sheets for what you
   return from, routes for what you browse", and filed Races as a route.
   Adding a race is a return-to-the-week task, not browsing — and a route
   would need a new key in `SURFACES` (`src/lib/telemetry.ts`), one release
   after v0.121.0 shipped that counter and one after v0.123 retires
   `train:season` from it. One mechanism, no new surface key.
2. **Availability moves into a sheet in THIS slice, unchanged.** The spec put
   availability in slice 3 (the drag-timeline). But the availability form
   renders its own seven-day list, so slice 1 left the page showing the week
   _twice_ — the concrete regression the measurement found. Moving the
   existing UI wholesale into a sheet kills the duplication now; slice 3 later
   replaces that sheet's innards with the timeline without touching the page
   again.
3. **The sheets render from `WeekTab`, not from a Today-style `SheetHost`.**
   Today's host exists because its sheets need data the page does not fetch.
   Every Train sheet's data — adjustments, rationale, race card, preview,
   intake — is already fetched in `WeekTab`. A second host would re-query it.

---

### Task 1: The sheet mechanism, and the first destination

**Files:**

- Create: `src/components/week/week-sheet.tsx`
- Create: `src/components/week/week-sheet.test.tsx`
- Create: `src/components/week/summary-row.tsx`
- Create: `src/components/week/summary-row.test.tsx`
- Modify: `src/app/train/page.tsx` — thread `?sheet=`, render the first sheet
- Modify: `src/lib/log-href.ts` — `sheet` in `buildTrainHref`
- Test: `src/lib/log-href.test.ts`

**Interfaces:**

- Produces:
  - `WeekSheet({ title, closeHref, children })` — thin wrapper over
    `BottomSheet` (`src/components/ui/bottom-sheet.tsx`), which already owns
    Escape, body-scroll lock, swipe-to-dismiss and `prefers-reduced-motion`.
  - `SummaryRow({ label, badge, href })` — the row that replaces a
    `Collapsible` trigger: label, optional count, chevron.
  - `TRAIN_SHEETS = ["why-week", "plan-setup", "races", "availability", "plan-review"] as const`

- [ ] **Step 1: Write the failing tests**

```tsx
// summary-row.test.tsx
it("is a link to its destination, not a button that toggles", async () => {
  const el = await render(
    <SummaryRow label="Why this week" badge="4" href="/train?sheet=why-week" />
  );
  const a = el.querySelector("a");
  expect(a?.getAttribute("href")).toBe("/train?sheet=why-week");
  expect(el.querySelector("button")).toBeNull();
});

// The whole point of the slice: a drawer keeps its contents in the DOM,
// costed by assistive technology and counted by the choice-load measurement.
// A row must not secretly render the panel it links to.
it("renders none of the destination's content", async () => {
  const el = await render(
    <SummaryRow label="Races" badge="3" href="/train?sheet=races" />
  );
  expect(el.textContent).toBe("Races3");
});

it("omits the badge entirely when there is no count", async () => {
  const el = await render(
    <SummaryRow label="Plan setup" href="/train?sheet=plan-setup" />
  );
  expect(el.textContent).toBe("Plan setup");
});
```

```ts
// log-href.test.ts — `sheet` behaves like `day`: carried, and cleared by ""
it("carries an open sheet across a tab switch", () => {
  expect(
    buildTrainHref(
      {
        tab: "week",
        view: "week",
        month: "",
        range: 90,
        sport: "",
        sheet: "why-week",
      },
      { tab: "history" }
    )
  ).toContain("sheet=why-week");
});

it("clears the sheet when asked", () => {
  expect(
    buildTrainHref(
      {
        tab: "week",
        view: "week",
        month: "",
        range: 90,
        sport: "",
        sheet: "why-week",
      },
      { sheet: "" }
    )
  ).not.toContain("sheet=");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/week/summary-row.test.tsx src/lib/log-href.test.ts`
Expected: FAIL — modules and the `sheet` param do not exist.

- [ ] **Step 3: Implement the mechanism**

`sheet` joins `day` in `TrainFilterState`, `TrainHrefOverride` and
`buildTrainHref`, exactly as `day` was added in slice 1 — read that commit
(`e314a00`) and follow it rather than inventing a second convention.

Validate the param against `TRAIN_SHEETS` before use: an unknown value
renders no sheet, the way `SheetHost` returns null for an unknown name. `?sheet=`
is untrusted URL input.

- [ ] **Step 4: Move the first destination — "Why this week"**

Four blocks leave the page and land in one sheet, in this order: the rationale
(`WeekRationale`), the adjustments currently inside the `What changed & why`
`Collapsible`, `EventReadiness`, and the race-pacing prose beneath the race
chip. The race _chip_ stays on the page; only its prose moves.

The page keeps one row: `Why this week · {adjustments.length} changes`.

- [ ] **Step 5: Verify nothing was lost**

For each of the four blocks, confirm by reading the rendered sheet that the
content is identical to what the page rendered before. State each one in your
report.

- [ ] **Step 6: Run and commit**

```bash
set -a; . ./.env; set +a; DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
npm run lint && npm run typecheck
git add src/components/week/week-sheet.tsx src/components/week/week-sheet.test.tsx src/components/week/summary-row.tsx src/components/week/summary-row.test.tsx src/app/train/page.tsx src/lib/log-href.ts src/lib/log-href.test.ts
git commit -m "feat(week): why this week becomes a destination"
```

---

### Task 2: Plan setup

The two switches above the tabs are plan configuration rendered before the
week itself — the first thing seen, the last thing touched.

**Files:**

- Modify: `src/app/train/page.tsx` — remove `controls`/`controlsNote` from
  `TrainHeader`'s call, add the sheet and its row
- Test: existing `plan-style-switch.test.tsx`, `season-mode-switch.test.tsx`
  must still pass unchanged

- [ ] **Step 1: Write the failing test**

Assert, in a test over `WeekTab`'s rendered output or the sheet component,
that `PlanStyleSwitch` and `SeasonModeSwitch` do NOT appear on the page and DO
appear in the sheet.

- [ ] **Step 2-4: Move four things into the sheet**

`PlanStyleSwitch`, `SeasonModeSwitch` (with its `controlsNote` — "Applies from
next week…" — which explains them and belongs beside them), the
`Standard week` `Collapsible`'s contents, and the `Remaining skeleton`
`Collapsible`'s contents.

Row on the page: `Plan setup`.

**`TrainHeader`'s `controls` and `controlsNote` props become unused by Week.**
Check History and Fitness before deleting them: if neither uses them, delete
the props; if either does, leave them. Say which in your report.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(week): plan configuration stops leading the page"
```

---

### Task 3: Races

**Files:**

- Modify: `src/app/train/page.tsx`

- [ ] **Step 1: Write the failing test** — the page renders a
      `Races · {n}` row and no `RacesSection` outside the sheet.

- [ ] **Step 2-4: Move `RacesSection` (743 lines) into the sheet.**

Both call sites go: the `Collapsible`-wrapped one for `races.length > 0` and
the bare one for `races.length === 0`. The empty case still needs a way in —
the row renders with no badge and the sheet holds the empty-state UI that
`RacesSection` already provides.

`hideHeading` exists because the `Collapsible` supplied the heading; in a
sheet the sheet's title does. Check which you need.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(week): races move behind a destination"
```

---

### Task 4: Availability — kill the duplicate week

**This is the task that fixes the measured regression.** The availability
section renders its own seven-day list, so since slice 1 the page has shown
the week twice: once as the strip, once as that list.

**Files:**

- Modify: `src/app/train/page.tsx`

- [ ] **Step 1: Write the failing test**

The page must render the seven weekdays ONCE. Assert the count of weekday
labels outside the sheet.

- [ ] **Step 2-4: Move the availability `<section>` wholesale into the sheet**

`AvailabilityWeekSwitcher` and both `IntakeForm`s move unchanged. Do not
redesign them — slice 3 replaces their innards with a drag timeline, and
touching them here doubles that work.

`PinnedAction` currently lives inside `IntakeForm`. Decide, and argue in your
report: does the pinned `Confirm week` follow availability into the sheet, or
stay on the page? Consider that confirming the week is the page's primary
action and the spec pins it to the page — but the form that owns its fields
is moving.

Row on the page: `Availability` with the week's offered hours as its badge if
that is cheap; otherwise no badge.

The `?availability=next` deep link (used by the Sunday push notification
shipped in v0.123) MUST still land the athlete on next week's availability.
It currently drives `initialAvailabilityMode`. Make it open the sheet in
next-week mode, and TEST that — a push notification that lands nowhere is
worse than no push.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(week): the week renders once"
```

---

### Task 5: The draft plan preview

`PlanPreviewCard` is 21 rows and ~1.5 screens, and it exists only while a
draft is pending — during which it pushes the actual week below the fold.

**Files:**

- Modify: `src/app/train/page.tsx`

- [ ] **Step 1: Write the failing test** — with a draft present, the page
      renders a banner and NOT the 21-row table; the table renders in the
      sheet.

- [ ] **Step 2-4: Banner + sheet**

Banner: `A {n}-week plan is ready · Review →`, linking to
`?sheet=plan-review`. The sheet holds `PlanPreviewCard` with its existing
`Rebuild` and `Start this plan` actions intact.

There are TWO `PlanPreviewCard` call sites (the no-plan branch around
page.tsx:451 and the with-plan branch around :951). Handle both, or state why
one should keep rendering inline.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(week): a draft plan announces itself instead of burying the week"
```

---

### Task 6: The two carried fixes

Both were deferred from slice 1 with rulings; both are one-liners.

**Files:**

- Modify: `src/app/train/page.tsx` (both `Math.round` call sites)
- Modify: `src/lib/week-plan/verdict-line.ts`

- [ ] **Step 1: `Math.round(daysOut / 7)` overstates weeks remaining.**

At 32 days out (4 weeks 4 days) it reports "5 weeks to race" — the error runs
in the direction that hurts a taper. It was left alone in slice 1 because it
matches `weeksUntilEvent` on the same page, and one surface disagreeing with
another is worse. **Change BOTH call sites together** — `SeasonProgress`'s
figure and `weeksUntilEvent` (around page.tsx:543-553). Test the boundary:
28 days, 31 days, 32 days, 34 days.

- [ ] **Step 2: "{day}'s planned session was missed" says "session" singular**

`adapt-day.ts:87-90` deliberately snapshots EVERY session on a missed day ("A
two-session day misses both sessions"), and the count is discarded by the
stamp, so the branch cannot pluralise. Use the count-neutral
`"{day}'s plan was missed."` Test a two-session missed day.

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(train): stop rounding a taper up, and stop counting a missed plan"
```

---

### Task 7: Measure it, and open the pictures

Slice 1's prediction was wrong by a factor of nearly three. This task decides
whether slice 2 earns the release.

- [ ] **Step 1: Seed** — `npx tsx scripts/seed-confirmed-race.ts`. The flow
      inventory records that its first measurement was invalid because the
      database had no plan.

- [ ] **Step 2: Capture** — dev server on 3210, then
      `SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts week-slice2 --only=train,train-plan-preview`

- [ ] **Step 3: Measure**, with the flow inventory's own method: visible and
      enabled `button, a[href], input, select, textarea, [role=button]`, split
      appChrome / tabs / surface. **`appChrome` must be 5** — that is the
      method's self-check. Measure the default state and each sheet open.

- [ ] **Step 4: Append a dated section** to
      `docs/2026-08-26-flow-inventory.md`. Do not edit the slice 1 section;
      this repo appends rather than rewrites.

- [ ] **Step 5: Report the truth.** If the surface is still above ~1.5
      screens, say so plainly. A measurement that flatters the plan is worth
      nothing — that is the lesson slice 1 paid for.

---

## Self-review

**Spec coverage.** Why-this-week sheet → Task 1. Plan setup → Task 2. Races →
Task 3 (as a sheet, deviation argued above). Plan review → Task 5.
Availability → Task 4 (pulled forward from slice 3, argued above). Carried
minors → Task 6. Re-measurement → Task 7. The drag timeline remains slice 3.

**Placeholders.** None: every step names its files and its assertions.

**Type consistency.** `TRAIN_SHEETS`, `WeekSheet` and `SummaryRow` are
declared in Task 1 and used under those names in Tasks 2-5. `sheet` follows
`day`'s exact shape in `buildTrainHref`.

**Known risk.** Five destinations all render from `WeekTab`, which is already
a long function. If it grows unwieldy, extracting the sheet bodies into
`src/components/week/sheets/` is in scope for whichever task first feels it —
say so rather than leaving a 1,400-line render.
