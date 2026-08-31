# Visual polish — slice 5: the surfaces 2b.4 never reached

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last route that waits in silence, and record that the rest
of this slice's premise no longer holds.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md`, slice 5.

**Branch:** `feat/finish-the-design-system`.

## The slice is nearly empty, and that is the finding

The spec assigned Admin, Import and pre-auth (`login`, `join/[code]`) to this
slice because **2b.4's slices 7 and 8 never ran** — they were the surfaces the
type and colour migration was reorganised away from. That premise was correct
when the spec was written and is no longer true.

Measured 2026-08-31 with the guards' own patterns, comments stripped:

| Surface group | files | arbitrary type | ad-hoc ink | raw colour |
| ------------- | ----: | -------------: | ---------: | ---------: |
| Admin         |     7 |          **0** |      **0** |      **0** |
| Import        |     4 |          **0** |      **0** |      **0** |
| Pre-auth      |     5 |          **0** |      **0** |      **0** |

They were migrated in pieces by work that came after 2b.4 stopped: the v0.106
settings redesign pulled shared chrome onto the tokens, the contrast and
type-scale guards scan all of `src/` rather than a slice's own directory so
drift could not accumulate quietly, and **slice 3b of this strand took
`join/[code]`'s last two `text-xl` to `text-title`**.

All three also already render in both themes with **0 confirmed axe
violations**, in every capture set this strand has taken.

**So the honest scope of this slice is one file.**

## Global Constraints

- **Do not invent work to fill the slice.** A slice whose premise has expired
  should shrink, not find something to justify itself.
- **Zero confirmed axe violations** stays the ceiling.

---

### Task 1: the last route that waits in silence

`src/app/join/[code]/page.tsx` awaits `findValidInvite(code)` and has no
loading state. It is the single named entry in slice 2a's route guard, which
records it as pre-auth and therefore this slice's to close.

**Files:**

- Create: `src/app/join/[code]/loading.tsx`
- Modify: `tests/motion-scale-guard.test.ts`

- [ ] **Step 1: Make the guard demand zero**

In the `routes that await` block, change the assertion from naming
`join/[code]` to expecting an empty list:

```ts
it("do not wait in silence", () => {
  expect(awaitingWithoutLoading()).toEqual([]);
});
```

Run it. Expected: FAIL, listing `src/app/join/[code]/page.tsx` alone.

- [ ] **Step 2: Write the loading state**

`join/[code]` is **outside `AppShell`** — it is pre-auth, and renders a
centred glass card on a mesh gradient (`page.tsx` uses
`<main className="mesh-gradient flex min-h-svh items-center justify-center p-6">`).
Its loading state must match that shell, not the app one:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingScreen } from "@/components/ui/loading-screen";

export default function Loading() {
  return (
    <main className="mesh-gradient flex min-h-svh items-center justify-center p-6">
      <div className="glass w-full max-w-sm rounded-[2rem] p-8">
        <LoadingScreen label="your invite">
          <Skeleton className="mb-1 h-7 w-40" />
          <Skeleton className="mb-6 h-10 w-full" />
          <Skeleton className="mb-3 h-10 rounded-xl" />
          <Skeleton className="mb-3 h-10 rounded-xl" />
          <Skeleton className="h-11 rounded-xl" />
        </LoadingScreen>
      </div>
    </main>
  );
}
```

Note it takes a label: unlike `src/app/loading.tsx`, this boundary stands in
for exactly one route, so naming the surface is correct here.

- [ ] **Step 3: Run the guard and the suite**

Expected: `routes that await` passes with an empty list; suite at its previous
count plus nothing.

- [ ] **Step 4: See it, because a capture cannot**

`verify-surfaces.ts` waits for content and can never photograph a loading
state. Drive it: `page.goto(BASE + "/join/anything", { waitUntil: "commit" })`
and poll for `[role=status]`, the same method slice 2a used. Confirm the
announcement reads "Loading your invite…" and the card is centred rather than
top-aligned — the wrong shell would show up as the latter.

- [ ] **Step 5: Commit**

---

### Task 2: record that the premise expired

- [ ] **Step 1: Add the measurement to this plan's Outcome**

State the zeros, and where the work actually happened, so the next reader does
not go looking for a migration that already landed.

- [ ] **Step 2: Correct the spec**

`docs/specs/2026-08-30-visual-polish-and-motion-design.md`'s slice table
describes slice 5 as "Admin, Import, and pre-auth — the surfaces 2b.4 never
reached". Amend it in place to say what this slice turned out to be, with the
date and the measured zeros. A spec that still promises work nobody needs to
do is how a strand acquires phantom scope.

## Next

`docs/plans/2026-08-31-polish-slice6-named-offenders.md` — the `Pinned ×`
badge demotion and the crowded availability day row, which is the substantive
remaining work in this strand.
