# Disclosure slice 1 — fuelling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `FuellingCard` from an open 99-line section into one line carrying the figure plus an `ⓘ` link, with its detail moving to a new `?sheet=fuelling&day=<ymd>` destination.

**Architecture:** A new `DisclosureLink` primitive renders a lucide `Info` anchor with a real accessible name. A new pure `fuellingSummary()` produces the one-line text so it is testable without rendering. `TRAIN_SHEETS` gains `fuelling`; `train/page.tsx` renders the existing `FuellingCard` body inside a `WeekSheet` and replaces the on-page section with the summary line.

**Tech Stack:** Next.js App Router (server components), React 19, Tailwind v4 tokens, vitest, Playwright via `scripts/verify-surfaces.ts`.

**Spec:** `docs/specs/2026-09-04-disclosure-affordance-design.md`

## Global Constraints

- **Zero confirmed axe violations is a ratchet, not a milestone.** `surface-ceilings.json` is `confirmedNodes: 0`. No slice may raise it.
- **The `ⓘ` is a link, never a tooltip or popover.** A drawer keeps content on the page and removes no screens.
- **The accessible name says what it discloses, never "info".**
- **lucide `Info`, not the `ⓘ` character** — single-character text is filed `incomplete` for contrast and adds indeterminate nodes.
- **Design-system tokens only.** `tests/type-scale-guard.test.ts` and `tests/motion-scale-guard.test.ts` fail the build on arbitrary sizes, ad-hoc ink alphas, `transition-all` and raw durations.
- **Both workflow files move together.** A new capture surface must be added to `.github/workflows/surfaces.yml` AND `.github/workflows/soak.yml`. `0.127.0-rc.1` died in the Soak for updating one.
- **Verify with:** `set -a; . ./.env; set +a; DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run` then `npx tsc --noEmit` (the suite will not tell you this).

---

## File Structure

| File                                         | Responsibility                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `src/components/ui/disclosure-link.tsx`      | **Create.** The `ⓘ` primitive. Owns no state, no data.                      |
| `src/components/ui/disclosure-link.test.tsx` | **Create.** Anchor, accessible name, `aria-hidden` icon.                    |
| `src/lib/fuelling/summary.ts`                | **Create.** Pure `fuellingSummary()` — the one-line text.                   |
| `src/lib/fuelling/summary.test.ts`           | **Create.** Unit tests, no rendering.                                       |
| `src/lib/log-href.ts`                        | **Modify.** Add `fuelling` to `TRAIN_SHEETS`.                               |
| `src/components/train/fuelling-card.tsx`     | **Modify.** Split: `FuellingDetail` (sheet body) and `FuellingLine` (page). |
| `src/app/train/page.tsx`                     | **Modify.** Render the fuelling sheet; replace the section with the line.   |
| `scripts/verify-surfaces.ts`                 | **Modify.** Add `train-fuelling` + a `sheetOpenGuard`.                      |
| `.github/workflows/surfaces.yml`, `soak.yml` | **Modify.** Surface lists — both files.                                     |

---

### Task 1: The `DisclosureLink` primitive

**Files:**

- Create: `src/components/ui/disclosure-link.tsx`
- Test: `src/components/ui/disclosure-link.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: `DisclosureLink({ href, label }: { href: string; label: string })` — a React element rendering `<a>`.

- [ ] **Step 1: Write the failing test.** Copy the render harness from `src/components/ui/summary-row.test.tsx` verbatim — it already has the `createRoot`/`act` setup this repo uses.

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DisclosureLink } from "./disclosure-link";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
  return container;
}

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

describe("DisclosureLink", () => {
  it("is a link, not a button — it navigates", async () => {
    const el = await render(
      <DisclosureLink
        href="/train?sheet=fuelling&day=2026-09-04"
        label="How to fuel this session"
      />
    );
    const a = el.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.getAttribute("href")).toBe(
      "/train?sheet=fuelling&day=2026-09-04"
    );
    expect(el.querySelector("button")).toBeNull();
  });

  it("carries an accessible name that says what it discloses", async () => {
    const el = await render(
      <DisclosureLink href="/x" label="How to fuel this session" />
    );
    expect(el.querySelector("a")!.textContent).toContain(
      "How to fuel this session"
    );
  });

  it("refuses a name that says nothing", async () => {
    // "Info" beside three different figures teaches a screen-reader user
    // nothing — the defect the connector cards' aria-describedby fix closed.
    expect(() => DisclosureLink({ href: "/x", label: "Info" })).toThrow(
      /says what it discloses/i
    );
  });

  it("hides the glyph from assistive technology", async () => {
    const el = await render(
      <DisclosureLink href="/x" label="Why this week's volume" />
    );
    expect(el.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `set -a; . ./.env; set +a; DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run src/components/ui/disclosure-link.test.tsx`
Expected: FAIL — `Failed to resolve import "./disclosure-link"`.

- [ ] **Step 3: Write the component.**

```tsx
import Link from "next/link";
import { Info } from "lucide-react";

const EMPTY_LABELS = new Set(["info", "information", "more", "details", "?"]);

/**
 * The `ⓘ`. A LINK to where an explanation lives, never a tooltip or popover —
 * a drawer keeps its contents on the page, which removes no screens and
 * inverts the principle this whole strand serves (see the spec's "The
 * principle this serves").
 *
 * lucide `Info` rather than the `ⓘ` character: this repo's axe reporting files
 * single-character text as `incomplete` for contrast — the same treatment the
 * `▲`/`▼` trend arrows get — so a glyph would add indeterminate nodes for
 * nothing. The icon is `aria-hidden` and the name is carried in text.
 */
export function DisclosureLink({
  href,
  /** What this discloses — "How to fuel this session", never "Info". */
  label,
}: {
  href: string;
  label: string;
}) {
  if (EMPTY_LABELS.has(label.trim().toLowerCase())) {
    throw new Error(
      `DisclosureLink label ${JSON.stringify(label)} says what it IS, not ` +
        "what it discloses. Three identical 'Info' links in one card teach a " +
        "screen-reader user nothing. Name the destination instead."
    );
  }
  return (
    <Link
      href={href}
      data-slot="disclosure-link"
      className="inline-flex shrink-0 items-center rounded-full p-1 text-ink-muted transition-colors hover:text-ink-primary focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Info aria-hidden className="size-4" />
      <span className="sr-only">{label}</span>
    </Link>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass.**

Run: same command as Step 2. Expected: 4 passed.

- [ ] **Step 5: Mutation-check the label guard.** Delete the `if (EMPTY_LABELS…)` block, re-run, confirm "refuses a name that says nothing" goes red, then restore it. A guard never seen to fail is a claim.

- [ ] **Step 6: Commit.**

```bash
git add src/components/ui/disclosure-link.tsx src/components/ui/disclosure-link.test.tsx
git commit -m "The ⓘ, as a link with a name that says what it discloses"
```

---

### Task 2: `fuellingSummary()` — the one line

**Files:**

- Create: `src/lib/fuelling/summary.ts`
- Test: `src/lib/fuelling/summary.test.ts`

**Interfaces:**

- Consumes: `fuellingFromSession(w, bodyMassKg)` from `@/lib/fuelling/from-session`, and `ScheduledWorkout` from `@/lib/week-plan/types`.
- Produces: `fuellingSummary(workouts: ScheduledWorkout[], bodyMassKg: number | null): string | null` — `null` when there is nothing to say.

Pure and separate from the component so the wording is testable without rendering, the same split `zone-band.ts` uses.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { fuellingSummary } from "./summary";
import type { ScheduledWorkout } from "@/lib/week-plan/types";

const ride = (mins: number): ScheduledWorkout =>
  ({ type: "endurance", durationMins: mins }) as ScheduledWorkout;

describe("fuellingSummary", () => {
  it("is null with no sessions — the line does not render at all", () => {
    expect(fuellingSummary([], 70)).toBeNull();
  });

  it("names the before-figure for a single session", () => {
    const line = fuellingSummary([ride(90)], 70);
    expect(line).toMatch(/^Fuelling: \d+-\d+ g carbs before$/);
  });

  it("counts rather than picking a winner when a day has two sessions", () => {
    // Two sessions have two different before-figures. Showing one silently
    // would attach a number to the wrong session — the day holds up to two.
    expect(fuellingSummary([ride(60), ride(120)], 70)).toBe(
      "Fuelling: 2 sessions"
    );
  });

  it("still answers without a body mass", () => {
    expect(fuellingSummary([ride(90)], null)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `... npx vitest run src/lib/fuelling/summary.test.ts`
Expected: FAIL — cannot resolve `./summary`.

- [ ] **Step 3: Write the implementation.**

```ts
import { fuellingFromSession } from "./from-session";
import type { ScheduledWorkout } from "@/lib/week-plan/types";

/**
 * The one line that replaces the open FuellingCard on the Week page.
 *
 * TWO SESSIONS COUNT RATHER THAN COMPETE. A day holds up to two, and their
 * before-figures differ; rendering the first would put a number next to a
 * session it does not describe. The count is honest and the `ⓘ` holds both.
 */
export function fuellingSummary(
  workouts: ScheduledWorkout[],
  bodyMassKg: number | null
): string | null {
  if (workouts.length === 0) return null;
  if (workouts.length > 1) return `Fuelling: ${workouts.length} sessions`;
  const { before } = fuellingFromSession(workouts[0], bodyMassKg);
  return `Fuelling: ${before.carbsG.min}-${before.carbsG.max} g carbs before`;
}
```

- [ ] **Step 4: Run and watch pass.** Expected: 4 passed.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/fuelling/summary.ts src/lib/fuelling/summary.test.ts
git commit -m "The fuelling line, as a pure function"
```

---

### Task 3: `fuelling` becomes a destination

**Files:**

- Modify: `src/lib/log-href.ts` (the `TRAIN_SHEETS` array, currently at :123)
- Test: `src/app/train/sheet-param-validates.test.tsx`

**Interfaces:**

- Produces: `"fuelling"` as a member of `TrainSheetName`.

- [ ] **Step 1: Write the failing test.** Add to `sheet-param-validates.test.tsx`, following the shape of the `why-week` case already there:

```tsx
it("accepts the fuelling sheet", () => {
  expect(TRAIN_SHEETS).toContain("fuelling");
});

it("still rejects a sheet nobody defined", () => {
  expect(TRAIN_SHEETS.find((s) => s === "not-a-sheet")).toBeUndefined();
});
```

- [ ] **Step 2: Run and watch fail.** Expected: FAIL — `TRAIN_SHEETS` does not contain `"fuelling"`.

- [ ] **Step 3: Add the entry** to `src/lib/log-href.ts`:

```ts
  /** Session fuelling for one day, opened with `?day=` alongside. */
  "fuelling",
```

- [ ] **Step 4: Run and watch pass.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/log-href.ts src/app/train/sheet-param-validates.test.tsx
git commit -m "Fuelling becomes a destination"
```

---

### Task 4: Split `FuellingCard` into a line and a detail

**Files:**

- Modify: `src/components/train/fuelling-card.tsx`
- Test: `src/components/train/fuelling-card.test.tsx` (create)

**Interfaces:**

- Consumes: `fuellingSummary` (Task 2), `DisclosureLink` (Task 1).
- Produces: `FuellingLine({ date, workouts, bodyMassKg, href })` and `FuellingDetail({ date, workouts, bodyMassKg })`.

`FuellingDetail` is the CURRENT `FuellingCard` body, moved unchanged apart from dropping the outer `<section className="glass mb-5 …">` wrapper and the heading — the sheet supplies both. Keeping the markup byte-identical otherwise means a regression shows against unchanged code.

- [ ] **Step 1: Write the failing test.**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { FuellingLine, FuellingDetail } from "./fuelling-card";
import type { ScheduledWorkout } from "@/lib/week-plan/types";

const ride = (mins: number): ScheduledWorkout =>
  ({ type: "endurance", durationMins: mins }) as ScheduledWorkout;

describe("FuellingLine", () => {
  it("renders one line and a disclosure link, not the detail", () => {
    const html = renderToString(
      <FuellingLine
        date="2026-09-04"
        workouts={[ride(90)]}
        bodyMassKg={70}
        href="/train?sheet=fuelling&day=2026-09-04"
      />
    );
    expect(html).toContain("g carbs before");
    expect(html).toContain('data-slot="disclosure-link"');
    // The whole point: the detail is NOT in the DOM. A drawer that renders
    // its panel is costed by assistive tech and counted by the choice-load
    // measurement whether or not it is visibly open.
    expect(html).not.toContain("During:");
    expect(html).not.toContain("Assumptions:");
  });

  it("renders nothing on a day with no session", () => {
    expect(
      renderToString(
        <FuellingLine
          date="2026-09-04"
          workouts={[]}
          bodyMassKg={70}
          href="/x"
        />
      )
    ).toBe("");
  });
});

describe("FuellingDetail", () => {
  it("still carries the full guidance the card used to show", () => {
    const html = renderToString(
      <FuellingDetail date="2026-09-04" workouts={[ride(90)]} bodyMassKg={70} />
    );
    for (const label of ["Before:", "During:", "After:"]) {
      expect(html).toContain(label);
    }
  });
});
```

- [ ] **Step 2: Run and watch fail.** Expected: FAIL — no export `FuellingLine`.

- [ ] **Step 3: Restructure the file.** Keep `range` and `confidenceTone` as they are. Rename the existing `FuellingCard` to `FuellingDetail`, delete its outer `<section>` and the header `<div>` (the sheet's own title replaces them), keeping the `<div className="space-y-3">` and everything inside it byte-identical. Then add:

```tsx
export function FuellingLine({
  date,
  workouts,
  bodyMassKg,
  href,
}: {
  date: string;
  workouts: ScheduledWorkout[];
  bodyMassKg: number | null;
  href: string;
}) {
  const summary = fuellingSummary(workouts, bodyMassKg);
  if (!summary) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-2 px-1">
      <p className="truncate text-label text-ink-secondary">{summary}</p>
      <DisclosureLink href={href} label={`How to fuel ${date}'s session`} />
    </div>
  );
}
```

with the imports:

```tsx
import { DisclosureLink } from "@/components/ui/disclosure-link";
import { fuellingSummary } from "@/lib/fuelling/summary";
```

- [ ] **Step 4: Run and watch pass.**

- [ ] **Step 5: `npx tsc --noEmit`.** The rename breaks every caller and the compiler is how you find them — the suite will not tell you.

- [ ] **Step 6: Commit.**

```bash
git add src/components/train/fuelling-card.tsx src/components/train/fuelling-card.test.tsx
git commit -m "Split fuelling into a line and a detail"
```

---

### Task 5: Wire the page

**Files:**

- Modify: `src/app/train/page.tsx` (the `FuellingCard` call at ~:1628, and the sheet block near `whyWeekSheet` at ~:1044)

**Interfaces:**

- Consumes: `FuellingLine`, `FuellingDetail` (Task 4); `resolvedHref` and `openDate`/`openDaySlot`, already in scope.

- [ ] **Step 1: Write the failing test.** Add to `src/app/train/sheet-param-validates.test.tsx`, mirroring `renderTrainWeekWithSheet(TEST_USER, "why-week")` already there:

```tsx
it("opens the fuelling sheet with the day's guidance", async () => {
  const html = await renderTrainWeekWithSheet(TEST_USER, "fuelling");
  expect(html).toContain("Before:");
});
```

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Add the sheet**, beside `whyWeekSheet`:

```tsx
// Session fuelling for the open day. Gated on `openDaySlot` as well as
// `sheetParam`: with no open day there is no session to fuel, and an empty
// sheet reachable only by typing the URL is the state `whyWeekSheet`'s own
// comment above refuses for the same reason.
const fuellingSheet =
  sheetParam === "fuelling" && openDate && openDaySlot ? (
    <WeekSheet title="Session fuelling" closeHref={resolvedHref({ sheet: "" })}>
      <FuellingDetail
        date={openDate}
        workouts={openDaySlot.workouts}
        bodyMassKg={bodyMassKg}
      />
    </WeekSheet>
  ) : null;
```

- [ ] **Step 4: Replace the on-page card.** Swap the `<FuellingCard … />` block for:

```tsx
<FuellingLine
  date={openDate}
  workouts={openDaySlot.workouts}
  bodyMassKg={bodyMassKg}
  href={resolvedHref({ sheet: "fuelling" })}
/>
```

and render `{fuellingSheet}` wherever `{whyWeekSheet}` is rendered.

- [ ] **Step 5: Run the full suite and `npx tsc --noEmit`.**

- [ ] **Step 6: Commit.**

```bash
git add src/app/train/page.tsx src/app/train/sheet-param-validates.test.tsx
git commit -m "The week page hands fuelling to a sheet"
```

---

### Task 6: Capture the new surface

**Files:**

- Modify: `scripts/verify-surfaces.ts`, `.github/workflows/surfaces.yml`, `.github/workflows/soak.yml`

- [ ] **Step 1: Add the surface** to the `SURFACES` map:

```ts
  // `?sheet=fuelling` shares a pathname with `/train`, so assertOnSurface —
  // which compares pathname only — would pass over the ordinary Train tab
  // under this name. sheetOpenGuard is what makes the surface mean anything;
  // train-availability carries the identical note for the identical reason.
  "train-fuelling": "/train?sheet=fuelling",
```

- [ ] **Step 2: Register the guard** in `SURFACE_PREPARE`:

```ts
  "train-fuelling": sheetOpenGuard("train-fuelling", "?sheet=fuelling"),
```

- [ ] **Step 3: Add it to BOTH workflow files.** It needs a seeded open day with a session, which the demo owner has, so it belongs in the default set — no `--except` entry. Verify nothing else changed:

```bash
grep -n "except" .github/workflows/surfaces.yml .github/workflows/soak.yml
```

- [ ] **Step 4: Run the capture locally** per `docs/ENVIRONMENTS.md` and the standalone-server recipe: build, `cp -r .next/static .next/standalone/.next/`, serve on 3200 with `BETTER_AUTH_URL=http://localhost:3200`, then `--only=train-fuelling`. Confirm `0 confirmed`.

- [ ] **Step 5: Commit.**

---

### Task 7: Measure, and record whatever it says

**Files:**

- Modify: `docs/2026-08-26-flow-inventory.md`

- [ ] **Step 1: Measure Train ▸ Week at 390×844** with the flow-inventory method — phone screens and visible controls — on the same fixture as the 1.84 / 17 baseline.

- [ ] **Step 2: Write the result into the flow inventory as a new dated measurement**, stating both numbers and the prediction they are being judged against (fewer screens, +1 control for this slice's single `ⓘ`).

- [ ] **Step 3: If screens did not fall, say so plainly and stop.** The spec makes this the decision point: slices 2 and 3 are reconsidered rather than continued on momentum. A slice that measures worse is a finding; an unreported one is the failure.

- [ ] **Step 4: Commit.**

---

## Self-Review

**Spec coverage.** Component → Task 1. Destinations table (fuelling row) → Tasks 3, 5. `FuellingCard` collapse → Tasks 2, 4, 5. Testing section: component → 1; wiring at the surface → 5; sheet-param validation → 3; capture with `sheetOpenGuard` → 6; axe ratchet → Global Constraints + 6. Measurement commitment → Task 7. Slices 2 and 3 are deliberately out of scope: the spec makes slice 1 a decision point, so planning them now would presuppose its result.

**Placeholders.** None. Task 4's `FuellingDetail` is described as the existing body minus its wrapper rather than re-printed, because reprinting 70 lines invites a transcription error where "move this unchanged" cannot.

**Type consistency.** `fuellingSummary(workouts, bodyMassKg)` is defined in Task 2 and called in Task 4 with that signature. `DisclosureLink({ href, label })` is defined in Task 1 and called in Task 4. `FuellingLine`/`FuellingDetail` are produced in Task 4 and consumed in Task 5. `bodyMassKg` is `number | null` throughout, matching the current `FuellingCard` prop.

**Open risk carried from the spec.** ~~`?sheet=fuelling` can be typed for a day with no session; Task 5 gates on `openDaySlot` so it renders nothing rather than an empty sheet. If a refusal message is wanted instead, that is a copy decision, not a structural one.~~ **This claim was false, and was corrected by the final whole-branch review (I1).** Gating on `openDaySlot` refuses nothing: `openDayFrom` resolves an absent or out-of-week `?day=` to a date that IS in the week, so `openDaySlot` is always found and the gate collapsed to "an open week exists". A session-less day got the full modal — scrim, focus trap, body-scroll lock — over a panel holding only its own title, with Escape as a keyboard user's only exit. It was structural, not copy. The fix keeps the sheet reachable and renders `Unavailable`'s `missing_input` state inside it, with a `fix` pointing at `?sheet=pick-workout` whenever `canAddWorkout` admits the day.
