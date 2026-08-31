# Visual polish — slice 2b: one pending vocabulary

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every button that starts a transition says the same thing while it
is in flight, in the same way, to sighted and screen-reader athletes alike.

**Architecture:** A `PendingButton` that renders a plain `<button>` and owns
only the _semantics_ — `disabled`, `aria-busy`, and the label swap. It takes
`className` from the call site and has no styling opinion at all, which is
what lets 22 raw buttons adopt it without a single pixel moving.

**Tech Stack:** React 19, TypeScript, Vitest.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md` — this
slice **overrides** the spec's stated primitive; see below.

**Branch:** `feat/finish-the-design-system`.

## Why the spec's primitive is wrong

The spec says: _"One vocabulary, owned by `ui/button.tsx`: a `pending` prop."_
Measuring killed it. Of the 26 components that call `useTransition`:

|                                                 | count                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| use the `Button` primitive                      | **4** — `api-tokens-card`, `intervals-card`, `sessions-card`, `webhooks-card`         |
| use raw `<button>` with their own class strings | **20**                                                                                |
| have no button at all                           | **2** — `ride-debrief-toggles` (toggles), `intake-form` (delegates to `PinnedAction`) |

A prop on `Button` reaches four files. Reaching the other twenty would mean
migrating them onto the primitive — a restyle of twenty surfaces, which is
exactly the "full visual pass" this strand's non-goals rejected.

So the primitive has to be **styling-agnostic**: it renders a bare `<button>`,
passes `className` straight through, and owns nothing but the pending
semantics. `Button` and `PinnedAction` then use it internally, so there is one
implementation and one vocabulary rather than two that drift.

## The vocabulary, stated once

While a transition is in flight, a button:

1. is `disabled`;
2. carries `aria-busy` — **no call site does this today**, so a screen-reader
   athlete currently gets a button that simply goes quiet;
3. shows a label that says work is happening.

Today (3) is spoken three ways across 24 files: nothing at all
(`mark-done-button`, `day-actions`), a bare `"…"` (`strava-card`), or
`"Saving…"` (`races-section`, `checkin-sheet`). Two of those leave the athlete
with a button that greys out and says nothing.

## Global Constraints

- **No pixel moves except where a label appears that was not there before.**
  `PendingButton` emits `<button>` with the caller's `className` unchanged.
- **The compiler must not let a pending button stay silent.** The prop types
  below make `pendingLabel` mandatory whenever `children` is not a plain
  string, so "no visible feedback" cannot be reached by omission.
- **Zero confirmed axe violations** stays the ceiling.

---

### Task 1: the primitive

**Files:**

- Create: `src/components/ui/pending-button.tsx`
- Create: `src/components/ui/pending-button.test.tsx`

**Interfaces:**

- Produces: `<PendingButton pending={boolean} pendingLabel?={ReactNode} …buttonProps>`.
  With `children: string`, `pendingLabel` is optional and defaults to
  `` `${children}…` ``. With any other `children`, `pendingLabel` is required.

- [x] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { PendingButton } from "./pending-button";

describe("PendingButton", () => {
  it("is an ordinary button when idle, with the caller's classes", () => {
    const html = renderToString(
      <PendingButton
        pending={false}
        type="button"
        className="rounded-full bg-accent"
      >
        Save
      </PendingButton>
    );
    expect(html).toContain('class="rounded-full bg-accent"');
    expect(html).toContain("Save");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });

  it("says work is happening, three ways at once", () => {
    const html = renderToString(
      <PendingButton pending type="button" className="x">
        Save
      </PendingButton>
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    // The default label change: a trailing ellipsis, not a replacement, so
    // the button never becomes an unlabelled "…" the way strava-card's did.
    expect(html).toContain("Save…");
  });

  it("keeps a caller's own disabled reason while idle", () => {
    // A form that is invalid is disabled for a reason unrelated to pending;
    // the primitive must not clear it.
    const html = renderToString(
      <PendingButton pending={false} disabled type="submit" className="x">
        Save
      </PendingButton>
    );
    expect(html).toContain("disabled");
  });

  it("uses an explicit pendingLabel when given", () => {
    const html = renderToString(
      <PendingButton
        pending
        type="button"
        className="x"
        pendingLabel="Syncing…"
      >
        Sync
      </PendingButton>
    );
    expect(html).toContain("Syncing…");
    expect(html).not.toContain("Sync…");
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/ui/pending-button.test.tsx`
Expected: FAIL — cannot resolve `./pending-button`.

- [x] **Step 3: Write the primitive**

```tsx
/**
 * The one way this app says "your tap registered and work is happening".
 *
 * STYLING-AGNOSTIC ON PURPOSE. It renders a bare `<button>` and passes
 * `className` straight through, because only 4 of the 26 components that run
 * a transition use the `Button` primitive — the other 20 are raw buttons with
 * their own class strings. A `pending` prop on `Button` would have reached
 * four of them, and reaching the rest would have meant restyling twenty
 * surfaces. This owns semantics and nothing else, so all of them can adopt it
 * without a pixel moving.
 *
 * WHAT IT OWNS, and why each part:
 *   - `disabled`, which every call site already did.
 *   - `aria-busy`, which NONE did. A screen-reader athlete previously got a
 *     button that simply went quiet, indistinguishable from one that ignored
 *     the tap.
 *   - the label, which was spoken three ways: nothing at all
 *     (mark-done-button, day-actions), a bare "…" (strava-card), or "Saving…"
 *     (races-section, checkin-sheet).
 *
 * THE TYPES MAKE SILENCE UNREACHABLE. With a plain-string label the ellipsis
 * is free; with any richer children — an icon beside text — `pendingLabel` is
 * required, so a call site cannot end up saying nothing by omission, which is
 * how two of them ended up saying nothing in the first place.
 */
type Base = Omit<React.ComponentProps<"button">, "children"> & {
  pending: boolean;
};

export type PendingButtonProps = Base &
  (
    | { children: string; pendingLabel?: React.ReactNode }
    | { children: React.ReactNode; pendingLabel: React.ReactNode }
  );

export function PendingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  ...props
}: PendingButtonProps) {
  return (
    <button
      {...props}
      // A caller's own `disabled` is a separate reason (an invalid form, a
      // missing target); pending adds to it rather than replacing it.
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending ? (pendingLabel ?? `${children as string}…`) : children}
    </button>
  );
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/components/ui/pending-button.test.tsx`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add src/components/ui/pending-button.tsx src/components/ui/pending-button.test.tsx
git commit -m "feat(a11y): PendingButton — one vocabulary for work in flight

Styling-agnostic because it has to be: only 4 of the 26 components running a
transition use the Button primitive, and the other 20 are raw buttons with
their own class strings. This owns disabled, aria-busy and the label swap, and
nothing else, so all of them can adopt it without a pixel moving.

aria-busy is new to every one of them. The types make silence unreachable: a
string label gets a free ellipsis, richer children must supply pendingLabel."
```

---

### Task 2: the ratchet

**Files:** modify `tests/motion-scale-guard.test.ts`

- [x] **Step 1: Add the counted family**

```ts
describe("pending is spoken one way", () => {
  /** Components that run a transition and render a button for it. */
  function transitionButtons(): string[] {
    return walk(SRC)
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return src.includes("useTransition") && /<[Bb]utton[\s>]/.test(src);
      })
      .map((f) => relative(process.cwd(), f));
  }

  function withoutVocabulary(): string[] {
    return transitionButtons().filter(
      (f) => !readFileSync(f, "utf8").includes("PendingButton")
    );
  }

  it("every transition button uses the shared primitive", () => {
    expect(
      withoutVocabulary(),
      `these components start a transition and render a button for it, but ` +
        `spell the pending state themselves. Three spellings already exist ` +
        `and two of them say nothing at all. Use <PendingButton>.`
    ).toEqual([]);
  });

  it("aria-busy is not hand-rolled anywhere", () => {
    // If a call site sets aria-busy directly it has re-implemented the
    // vocabulary rather than adopted it, and the two will drift.
    const rogue = walk(SRC)
      .filter((f) => !f.endsWith("pending-button.tsx"))
      .filter((f) => readFileSync(f, "utf8").includes("aria-busy"))
      .map((f) => relative(process.cwd(), f));
    expect(rogue).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and record the real starting list**

Run: `npx vitest run tests/motion-scale-guard.test.ts -t "pending is spoken"`
Expected: FAIL listing ~24 files. **Write the actual number into the commit
message for Task 4** — it is this slice's meter.

- [x] **Step 3: Commit the failing guard**

```bash
git add tests/motion-scale-guard.test.ts
git commit -m "test(a11y): pin the pending-vocabulary ratchet

Fails at N until every transition button adopts PendingButton."
```

---

### Task 3: the migration

**Files:** the 24 components, plus `src/components/ui/button.tsx` and
`src/components/week/pinned-action.tsx`.

The mechanical shape at every call site:

```tsx
// before
<button type="button" disabled={pending} onClick={save} className="…">
  {pending ? "Saving…" : "Save check-in"}
</button>

// after
<PendingButton pending={pending} type="button" onClick={save} className="…"
  pendingLabel="Saving…">
  Save check-in
</PendingButton>
```

Where the existing label swap was a bare `"…"` (`strava-card`'s Sync pill),
drop `pendingLabel` and take the default `Sync…` — an unlabelled ellipsis was
never the intent, it was a width workaround, and the pill is wide enough.

Where there was **no** label swap (`mark-done-button`, `day-actions`,
`PinnedAction`), the default ellipsis is new visible feedback. That is the
point of the slice, and those are the surfaces to open in the captures.

- [x] **Step 1: Migrate in batches, running the guard between each**

Do them in five batches so a mistake is bisectable, running
`npx vitest run tests/motion-scale-guard.test.ts -t "pending is spoken"`
after each and watching the list shrink:

1. `settings/` — the 9 connector and account cards.
2. `today/` — `mark-done-button`, `checkin-sheet`.
3. `train/` + `week/` — `races-section`, `plan-preview-card`, `standard-week`, `day-actions`, `pinned-action`.
4. `body/` + `activity/` + `debrief/` — `journal-form`, `health-upload`, `health-manual-entry`, `delete-activity-button`, `debrief-sheet`.
5. `admin/` + `ui/button.tsx` — `invite-manager`, `sync-jobs-panel`, and the primitive itself gains `pending`/`pendingLabel` that delegate to `PendingButton`'s logic.

- [x] **Step 2: Guard reaches zero**

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: PASS.

- [x] **Step 3: Full suite**

```bash
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```

Expect failures here and treat them as findings, not noise: several component
tests assert on button text (`oura-card.test.tsx`, `webhooks-card.test.tsx`,
`connector-card.test.tsx` all read labels). A test that breaks because a
button now says `Sync…` instead of `…` is telling you the change reached it.
Update the assertion to the new vocabulary; do **not** weaken it to match
whatever the code now does without reading why.

- [x] **Step 4: Commit**

---

### Task 4: prove it

- [x] **Step 1: Types, lint, suite** — all clean.

- [x] **Step 2: Capture and axe**

```bash
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice2b
```

Expected: **0 confirmed axe violations**. Do not pipe through `tail`. `admin`
and every `settings*` surface grow every run (the script creates an API token
per theme/viewport combo) — not a regression.

- [x] **Step 3: Drive one pending state in a browser**

A capture photographs buttons at rest, so it cannot show this slice working at
all. With the dev server up, sign in with Playwright, click a save control,
and assert `aria-busy="true"` and the changed label appear while the
transition is in flight. Without this the slice has no evidence.

- [x] **Step 4: Tick and commit**

## What this slice deliberately does not do

- **`ride-debrief-toggles` and `intake-form` keep no button of their own.**
  The first is toggles; the second delegates to `PinnedAction`, which adopts
  the vocabulary in batch 3.
- **No spinner.** A label change plus `aria-busy` is the vocabulary; adding a
  spinner would be motion added for delight, which the spec forbids.

## Next

`docs/plans/2026-08-30-polish-slice3-primitives.md` — the 17 stock-Tailwind
type sizes, five shared primitives first.

---

## Outcome — run 2026-08-31, all four tasks complete

**24 components to zero.** Suite **3331 passed / 1 expected fail / 1 skipped**;
`tsc` and `eslint` clean. Capture: **100 PNGs, 0 confirmed axe violations**,
128 entries / 89 indeterminate / 28 errors — identical to slices 0, 1 and 2a,
so `aria-busy` on 24 components introduced nothing.

**Driven in a real browser**, which is the only evidence that matters here — a
capture photographs buttons at rest and cannot show this working at all:

|           | label      | `aria-busy` | `disabled` |
| --------- | ---------- | ----------- | ---------- |
| idle      | New invite | —           | no         |
| in flight | Creating…  | `true`      | yes        |
| after     | New invite | —           | no         |

### Most of the work was not the swap

Nine components had several buttons sharing ONE transition flag. Adopting the
vocabulary naively would have made every button on the card announce itself
while one worked — every Revoke row saying "Revoke…" because one was
revoking. Each gained a named action, the per-item shape `sessions-card`
already used.

### Three findings

1. **The suite caught a bug this slice introduced.** `plan-preview-card` was
   stranded in "Starting…" forever: `busy` was set and never cleared. That
   exposed the same weakness everywhere the pattern had just been introduced,
   so every comparison is now guarded by the transition flag **and** every
   clear moved into a `finally` — a thrown action would otherwise strand its
   button for the rest of the session.
2. **The bare-words trap, third time in this guard's life.** `ui/button.tsx`'s
   own doc comment naming `aria-busy` failed the scan. It now strips comments,
   as the motion scan already does.
3. **`busyId={isPending ? busyId : null}` is a prop, not a label.** The
   ternary check now requires a string literal, so passing state to a child is
   no longer mistaken for a hand-rolled label.

### One component deliberately not migrated

`standard-week.tsx` is recorded in `NO_WORKING_BUTTON` with its reason. Its
single button opens a day row and is disabled because a save runs elsewhere on
the card. It is not doing that work, so making it say "…" or claim `aria-busy`
would misstate what the athlete is waiting for. That distinction is why
`PendingButton` owns semantics only and leaves plain `disabled` alone.

### Two of the session's own probes were wrong before the code was

One located the button by its idle label — which the pending label replaces,
so it stopped finding it. One did not account for Playwright escaping commas
in selectors. Both times the instrument was at fault, not the change.

## Handover to slice 3

Re-measuring the stock type sizes turned up something that reshapes the rest of
the strand: **the type scale defines font sizes and no line-heights.**
`.text-sm` emits `font-size: 0.875rem; line-height: 1.25rem`; `.text-caption`
emits the font-size alone. `globals.css` sets no `line-height` at all and only
38 call sites use `leading-*`, so nearly all app text renders at the browser
default (~1.2) — about 16% tighter than the stock utilities it replaced.

The 17 remaining stock sizes are therefore the ONLY text in the app with a
designed line-height, and migrating them would make five shared primitives
(button, badge, card, input, label) tighter. **Decided: complete the scale
first, in its own slice with its own capture pass**, so the 17 can then be
migrated without regressing anything.
