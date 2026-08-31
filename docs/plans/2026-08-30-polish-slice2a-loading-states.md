# Visual polish — slice 2a: loading states and reduced motion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No route waits without saying so, and what it says reaches a screen
reader and a reduced-motion athlete — not only a sighted one watching a pulse.

**Architecture:** A `LoadingScreen` wrapper owns the status semantics so eight
files cannot spell them eight ways; `Skeleton` becomes explicitly decorative.
A new guard family counts routes that `await` without a loading state.

**Tech Stack:** Next.js App Router (`loading.tsx` conventions), Tailwind v4,
Vitest.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md`

**Branch:** `feat/finish-the-design-system`.

## Why this is slice 2a and not slice 2

The spec's slice 2 bundled loading states with the pending vocabulary, on the
stated plan that pending would become "a `pending` prop owned by
`ui/button.tsx`". **That premise is wrong, and measuring killed it: only 4 of
the 26 components that run `useTransition` use the `Button` primitive at all.**
The other 22 are raw `<button>` elements carrying their own class strings.
Giving `Button` a prop would have required migrating 22 components onto the
primitive — a visual redesign, which this strand's own non-goals forbid.

So pending needs a different primitive and its own design, and it is a
26-file behavioural change that makes ten buttons start saying something they
have never said. That does not belong in the same revert unit as a CSS rule
change. Slice 2b owns it.

## Global Constraints

- **`Skeleton` must not be announced.** It is decoration; the status region is
  what speaks. A skeleton that is both `aria-hidden` and inside a `role="status"`
  region is correct — the region's visually-hidden text is the announcement.
- **The reduced-motion rule change is real behaviour**, not a refactor.
  `animation: none` currently stops `.animate-pulse` dead, so a reduced-motion
  athlete sees a static grey page with no signal at all. Verify under emulated
  `prefers-reduced-motion: reduce`, not just by reading the CSS.
- **Zero confirmed axe violations** stays the ceiling.
- Run `npx prettier --write src/app/globals.css` after editing it.

---

### Task 1: `LoadingScreen`, and the six files that speak silently

**Files:**

- Create: `src/components/ui/loading-screen.tsx`
- Modify: `src/components/ui/skeleton.tsx`
- Modify: all six existing `loading.tsx`
- Modify: `tests/motion-scale-guard.test.ts` (new assertions)

**Interfaces:**

- Produces: `<LoadingScreen label="Train">…</LoadingScreen>` — renders a
  `role="status"` container with `aria-live="polite"` and a visually-hidden
  "Loading {label}…", wrapping the skeletons.

- [x] **Step 1: Write the failing test**

Append to `tests/motion-scale-guard.test.ts`:

```ts
import { readdirSync as rd } from "node:fs";

/** Every `loading.tsx` under src/app, as repo-relative paths. */
function loadingFiles(
  dir = join(process.cwd(), "src/app"),
  out: string[] = []
): string[] {
  for (const entry of rd(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) loadingFiles(full, out);
    else if (entry === "loading.tsx") out.push(relative(process.cwd(), full));
  }
  return out;
}

describe("a route that waits says so", () => {
  it("every loading.tsx announces itself", () => {
    // The defect this pins: all six loading.tsx files carried skeletons and
    // NOTHING else — no role, no live region, no text. A screen-reader user
    // got silence, and because the reduced-motion rule kills animation
    // outright, a reduced-motion user got a static grey page. Motion was the
    // only carrier of "this is loading", and two audiences cannot perceive it.
    const silent = loadingFiles().filter(
      (f) => !readFileSync(f, "utf8").includes("LoadingScreen")
    );
    expect(
      silent,
      `these loading states carry no status semantics — wrap their skeletons ` +
        `in <LoadingScreen label="…"> so the wait is announced rather than ` +
        `only animated.`
    ).toEqual([]);
  });

  it("Skeleton is decorative, not announced", () => {
    const src = readFileSync("src/components/ui/skeleton.tsx", "utf8");
    expect(
      src.includes("aria-hidden"),
      "Skeleton must be aria-hidden: it is decoration, and the LoadingScreen " +
        "region around it is what speaks. Without this a screen reader walks " +
        "a pile of empty divs."
    ).toBe(true);
  });
});
```

- [x] **Step 2: Run it and watch both fail**

Run: `npx vitest run tests/motion-scale-guard.test.ts -t "route that waits"`
Expected: FAIL — six files listed as silent, and `Skeleton` not `aria-hidden`.

- [x] **Step 3: Write `LoadingScreen`**

Create `src/components/ui/loading-screen.tsx`:

```tsx
/**
 * The status semantics every `loading.tsx` needs, in one place so eight files
 * cannot spell them eight ways.
 *
 * WHY THIS EXISTS. Before it, all six loading states were skeletons and
 * nothing else — no role, no live region, no text. Motion was the only
 * carrier of "this is loading", which leaves out two audiences at once: a
 * screen-reader user heard silence, and a reduced-motion user saw a static
 * grey page, because globals.css stops `.animate-pulse` outright under
 * `prefers-reduced-motion`.
 *
 * `aria-live="polite"` rather than `assertive`: a route transition is not an
 * interruption, and the region is present from first paint so the label is
 * read as the page arrives.
 */
export function LoadingScreen({
  label,
  children,
}: {
  /** The surface being loaded, in the athlete's words: "Train", "your week". */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}
```

- [x] **Step 4: Make `Skeleton` decorative**

In `src/components/ui/skeleton.tsx`, add `aria-hidden` to the div:

```tsx
<div
  data-slot="skeleton"
  aria-hidden
  className={cn("animate-pulse rounded-md bg-muted", className)}
  {...props}
/>
```

- [x] **Step 5: Wrap all six existing loading states**

Each file imports `LoadingScreen` and wraps the content _inside_ `AppShell`
(the shell's nav is real, not a skeleton, and must not be inside the status
region). Labels: `/` → "your day", `/coach` → "Coach", `/settings` →
"Settings", `/import` → "Import", `/activity/[id]` → "this activity",
`/activity/log` → "the activity log".

Worked example, `src/app/settings/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <LoadingScreen label="Settings">
        <Skeleton className="mb-8 mt-8 h-10 w-40" />
        <div className="space-y-6">
          <Skeleton className="h-28 rounded-[2rem]" />
          <Skeleton className="h-16 rounded-[2rem]" />
          <Skeleton className="h-16 rounded-[2rem]" />
          <Skeleton className="h-16 rounded-[2rem]" />
          <Skeleton className="h-16 rounded-[2rem]" />
          <Skeleton className="h-16 rounded-[2rem]" />
        </div>
      </LoadingScreen>
    </AppShell>
  );
}
```

- [x] **Step 6: Run the tests**

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/components/ui/loading-screen.tsx src/components/ui/skeleton.tsx src/app tests/motion-scale-guard.test.ts
git commit -m "feat(a11y): loading states that announce themselves

All six loading.tsx files carried skeletons and nothing else — no role, no
live region, no text. Motion was the only carrier of 'this is loading', which
leaves out two audiences at once: a screen-reader user heard silence, and a
reduced-motion user saw a static grey page, because globals.css stops
animate-pulse outright under prefers-reduced-motion.

LoadingScreen owns the semantics so eight files cannot spell them eight ways,
and Skeleton is now explicitly aria-hidden decoration."
```

---

### Task 2: the routes that wait in silence

**Files:**

- Create: `src/app/train/loading.tsx`, `src/app/body/loading.tsx`, `src/app/admin/loading.tsx`
- Modify: `tests/motion-scale-guard.test.ts`

**The route audit**, from reading every `page.tsx` under `src/app`:

| Route            | Awaits?                | `loading.tsx` | Verdict                            |
| ---------------- | ---------------------- | ------------- | ---------------------------------- |
| `/`              | yes                    | yes           | —                                  |
| `/activity/[id]` | yes                    | yes           | —                                  |
| `/activity/log`  | yes                    | yes           | —                                  |
| `/coach`         | yes                    | yes           | —                                  |
| `/import`        | yes                    | yes           | —                                  |
| `/settings`      | yes                    | yes           | —                                  |
| `/train`         | yes                    | **no**        | **add**                            |
| `/body`          | yes                    | **no**        | **add**                            |
| `/admin`         | yes                    | **no**        | **add**                            |
| `/join/[code]`   | yes                    | **no**        | offender, **slice 5's** (pre-auth) |
| `/login`         | no — `"use client"`    | no            | not an offender                    |
| `/wellness`      | no — `redirect()` only | no            | not an offender                    |

- [x] **Step 1: Write the failing test**

```ts
describe("routes that await", () => {
  /** Every page.tsx under src/app, repo-relative. */
  function pageFiles(
    dir = join(process.cwd(), "src/app"),
    out: string[] = []
  ): string[] {
    for (const entry of rd(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) pageFiles(full, out);
      else if (entry === "page.tsx") out.push(relative(process.cwd(), full));
    }
    return out;
  }

  /**
   * A page is an offender when it can make the athlete wait and says nothing
   * while it does. "Can wait" is `await` in a server component: a "use client"
   * page renders instantly, and a page whose whole body is a redirect() never
   * paints.
   */
  function awaitingWithoutLoading(): string[] {
    return pageFiles().filter((f) => {
      const src = readFileSync(f, "utf8");
      if (src.includes('"use client"')) return false;
      if (/^\s*redirect\(/m.test(src) && !/\bawait\b/.test(src)) return false;
      if (!/\bawait\b/.test(src)) return false;
      return !existsSync(f.replace(/page\.tsx$/, "loading.tsx"));
    });
  }

  it("do not wait in silence", () => {
    // Ceiling, not zero: src/app/join/[code]/page.tsx awaits findValidInvite
    // and has no loading state, but it is pre-auth and outside AppShell — the
    // spec assigns pre-auth to slice 5, which takes this to 0.
    expect(awaitingWithoutLoading()).toEqual(["src/app/join/[code]/page.tsx"]);
  });
});
```

Add `existsSync` to the `node:fs` import.

- [x] **Step 2: Run it and read the real list**

Run: `npx vitest run tests/motion-scale-guard.test.ts -t "await"`
Expected: FAIL, listing four — `train`, `body`, `admin` and `join/[code]`.
If the list differs, the audit table above is wrong; fix the table, not the
test.

- [x] **Step 3: Add the three loading states**

`src/app/train/loading.tsx` — Train's shell is a `<header className="mb-5 pt-8">`
with an `h1`, then the week surface:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <LoadingScreen label="Train">
        <Skeleton className="mt-8 mb-4 h-8 w-28" />
        <Skeleton className="mb-5 h-10 rounded-full" />
        <Skeleton className="mb-4 h-28 rounded-[2rem]" />
        <Skeleton className="mb-4 h-20 rounded-[2rem]" />
        <div className="mb-4 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-32 rounded-[2rem]" />
      </LoadingScreen>
    </AppShell>
  );
}
```

`src/app/body/loading.tsx` — Body is a header, a tab row, then cards:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <LoadingScreen label="Body">
        <Skeleton className="mt-8 mb-4 h-8 w-24" />
        <Skeleton className="mb-5 h-10 rounded-full" />
        <Skeleton className="mb-4 h-40 rounded-[2rem]" />
        <Skeleton className="mb-4 h-24 rounded-[2rem]" />
        <Skeleton className="mb-4 h-24 rounded-[2rem]" />
        <Skeleton className="h-24 rounded-[2rem]" />
      </LoadingScreen>
    </AppShell>
  );
}
```

`src/app/admin/loading.tsx` — owner-only, a header and stacked panels:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <LoadingScreen label="Admin">
        <Skeleton className="mt-8 mb-6 h-8 w-32" />
        <Skeleton className="mb-4 h-32 rounded-[2rem]" />
        <Skeleton className="mb-4 h-48 rounded-[2rem]" />
        <Skeleton className="h-48 rounded-[2rem]" />
      </LoadingScreen>
    </AppShell>
  );
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: PASS — only `join/[code]` remains, as the assertion states.

- [x] **Step 5: Commit**

```bash
git add src/app/train/loading.tsx src/app/body/loading.tsx src/app/admin/loading.tsx tests/motion-scale-guard.test.ts
git commit -m "feat(ux): loading states for Train, Body and Admin

The two heaviest server-rendered surfaces held the previous page with no
signal while they fetched. The guard now enumerates every page.tsx that
awaits in a server component and asserts it has a loading sibling; only
join/[code] remains, and the spec assigns pre-auth to slice 5."
```

---

### Task 3: reduced motion that stops motion without stopping meaning

**Files:**

- Modify: `src/app/globals.css`
- Modify: `tests/motion-scale-guard.test.ts`

The rule today:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
```

`animation: none` also stops `.animate-pulse`, so the skeletons freeze. Task 1
gave them a spoken alternative, which is what makes this safe to soften — but
the blunt rule has a second problem: `transition: none` cancels transitions
mid-flight rather than completing them, so a component that reads a state
change on `transitionend` never hears it.

- [x] **Step 1: Write the failing test**

```ts
describe("reduced motion", () => {
  it("stops motion without cancelling state changes", () => {
    const rule =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css());
    expect(rule, "the reduced-motion block is gone").not.toBeNull();
    const body = rule![1];
    // `animation: none` and `transition: none` cancel outright: an animation
    // never runs its final frame and a transitionend never fires. The
    // standard pattern collapses them to 1ms instead, which is not motion
    // but does complete.
    expect(body).not.toMatch(/animation:\s*none/);
    expect(body).not.toMatch(/transition:\s*none/);
    expect(body).toMatch(/animation-duration:\s*1ms/);
    expect(body).toMatch(/transition-duration:\s*1ms/);
    expect(body).toMatch(/animation-iteration-count:\s*1/);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/motion-scale-guard.test.ts -t "reduced motion"`
Expected: FAIL on the first `not.toMatch` — `animation: none` is present.

- [x] **Step 3: Replace the rule**

```css
/* ── Reduced motion ──────────────────────────────────────────────────────── */
/* 1ms rather than `none`. `animation: none` and `transition: none` CANCEL:
   an animation never reaches its final frame, and `transitionend` never
   fires, so any component keyed on completion silently stalls. A 1ms
   duration is not motion by any reasonable reading, and it completes.

   This also used to stop `.animate-pulse` dead, which left a reduced-motion
   athlete looking at a static grey page with no indication anything was
   loading — motion was the only carrier. `LoadingScreen` now speaks that
   state, which is what makes softening this safe rather than merely nicer. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [x] **Step 4: Run the tests**

```bash
npx prettier --write src/app/globals.css
npx vitest run tests/motion-scale-guard.test.ts
```

Expected: PASS.

- [x] **Step 5: Verify in a browser under emulated reduced motion**

Reading the CSS proves the rule; only the browser proves the effect.

```bash
BETTER_AUTH_URL=http://localhost:3210 npm run dev -- --port 3210 &
```

Then, with Playwright, load `/login` under `reducedMotion: "reduce"` and read
a computed `animation-duration` and `transition-duration` off a real element.
Expected: both `0.001s`, and the page still paints normally.

- [x] **Step 6: Commit**

```bash
git add src/app/globals.css tests/motion-scale-guard.test.ts
git commit -m "fix(a11y): reduced motion stops motion without cancelling completion

animation: none and transition: none CANCEL — an animation never reaches its
final frame and transitionend never fires, so anything keyed on completion
stalls. 1ms is not motion and does complete.

The old rule also stopped animate-pulse dead, leaving a reduced-motion
athlete on a static grey page with no sign anything was loading. LoadingScreen
now speaks that state, which is what makes this safe to soften."
```

---

### Task 4: prove it

- [x] **Step 1: Full suite, types, lint**

```bash
npx tsc --noEmit && npx eslint src tests
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```

Expected: clean; suite at the slice-1 baseline plus this slice's new tests.

- [x] **Step 2: Capture and axe**

```bash
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice2a
```

Expected: ~100 PNGs, **0 confirmed axe violations**. Do not pipe through
`tail`. Remember `admin` and every `settings*` surface are never comparable
run-to-run — `verify-surfaces.ts` creates an API token per theme/viewport
combo, so those grow every run. That is not a regression.

- [x] **Step 3: The new axe surface area is the point**

A `role="status"` region with a live announcement is exactly the kind of thing
axe has opinions about. Read the report's confirmed count specifically, and if
anything appears, fix it rather than raising the ceiling — 0 has never been
raised.

- [x] **Step 4: Tick and commit**

```bash
git add docs/plans/2026-08-30-polish-slice2a-loading-states.md
git commit -m "docs(plan): slice 2a complete"
```

## What this slice deliberately does not do

- **The pending vocabulary is untouched.** Slice 2b, with its own design,
  because the spec's premise for it was wrong.
- **`join/[code]` still waits in silence.** Recorded in the guard as the one
  remaining offender; slice 5 owns pre-auth.
- **No skeleton is made to match its page more closely than "same rough
  shape".** A skeleton is a promise about layout, not a rendering of it.

## Next

`docs/plans/2026-08-30-polish-slice2b-pending-vocabulary.md`.

---

## Outcome — run 2026-08-30/31, all four tasks complete

Suite **3323 passed / 1 expected fail / 1 skipped** at task 3, plus three
tests from the defect below. `tsc` and `eslint` clean. Capture: **100 PNGs,
0 confirmed axe violations**, 128 entries / 89 indeterminate / 28 errors —
identical to slices 0 and 1, so the fixture gaps are stable.

### A defect this slice introduced, and only a driven browser could find

`src/app/loading.tsx` is not merely Today's loading UI. It is the **root
segment's Suspense boundary**, so it stands in for every route whose own
boundary has not resolved yet — a hard load of `/train` paints it first.
Giving it `label="your day"` therefore made `/train` and `/admin` announce
**"Loading your day…"** to a screen reader.

Before this slice it had no text at all, so there was nothing wrong to
notice. **Adding a voice is what made the wrong label audible.**

`label` is now optional and the root passes none. Verified in a browser:
`/train` → "Loading Train…", `/body` → "Loading Body…", `/admin` → "Loading
Admin…", `/` → "Loading…". A render test and a guard both pin it.

**No amount of capture coverage would have found this.** `verify-surfaces.ts`
waits for real content, so it can never photograph a loading state. Catching
it needed real navigations screenshotted mid-flight.

### A false finding, nearly reported

Three attempts to observe the loading state during client-side navigation
returned `null`, and the conclusion drawn — that `loading.tsx` does not appear
on tab-to-tab navigation — was **wrong**. It was a measurement artifact: the
poll window was 1.2s against a 6s injected RSC delay, so the navigation had
not committed yet. With correct timing the fallback appears on both hard and
client-side navigation. Recorded because the wrong version was stated aloud
before it was checked.

### The capture diff is entirely environmental

76 of 100 images differ from slice 1, and none of it is this slice:

- **The date rolled over between runs.** Slice 1 captured at 2026-08-30 19:53,
  this at 2026-08-31 05:30. Today, Train, Body, `checkin-sheet`,
  `train-fitness` and `body-sleep` all render date-dependent content, and most
  of them got _shorter_.
- **`settings*` grew again** — the capture script creates an API token per
  theme/viewport combo, as slice 1 recorded.

Proven rather than assumed: every file this slice touched is a `loading.tsx`
(never captured), a component used only by those, or the
`prefers-reduced-motion` block (captures do not emulate that preference).
`Skeleton` and `LoadingScreen` have no importer outside `loading.tsx`. **The
code cannot reach a captured surface.**

**Capture sets are not comparable across a date boundary**, which now joins
the token side effect on the list of reasons a run-to-run diff misleads here.

### Verified in a real browser

- Under emulated `prefers-reduced-motion: reduce`, `.animate-pulse` keeps its
  `animation-name` and runs **one iteration at 0.001s** rather than being
  switched off — it completes instead of being cancelled, which is what any
  `transitionend`/`animationend` listener needs.
- Without the preference it is `2s`, infinite, unchanged.
