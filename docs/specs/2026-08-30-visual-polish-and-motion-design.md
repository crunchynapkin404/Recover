# Visual polish and motion — Phase 6's fourth strand

Written 2026-08-30, post-v0.124.0. Every count in this document was measured
against the working tree at `d7b1e17` by the command recorded beside it, not
estimated.

Authority order: **the code and the workflow files**, then `docs/ROADMAP.md`,
then this file. This file inherits, and finishes, the unfinished tail of
`docs/specs/2026-08-11-2b4-visual-redesign-design.md`.

---

## The premise, and the surprise in it

The roadmap describes this strand as "transitions, loading states, density,
typographic rhythm" — which reads like a taste exercise. It is not. Measuring
the territory turned up a **half-finished migration whose closing slice was
reorganised away**.

> **CORRECTED 2026-08-31, mid-strand.** This section originally claimed that
> 2b.4's slices 7, 8 and 9 "never ran". **That is wrong**, and it was the
> premise several slices of this strand were argued from. The correct account
> is below; the conclusion the strand draws from it survives, but narrower.
>
> The error came from reading `docs/plans/`, which stops at a slice-6 plan
> document, and from `globals.css` still carrying a comment that said 15px
> stays "until slice 9". Neither is evidence a slice did not run — the later
> slices simply have no plan file. `git log` does have them:
> `81ab022 feat(admin): migrate Admin and Import to tokens` is slice 7
> (v0.109.0), and `3042cac feat(theme): lift forcedTheme, and finish the sweep`
> is slice 9 (v0.111.0). `tests/type-scale-guard.test.ts` records both, with
> per-file counts, in comments that were there to be read.

`docs/specs/2026-08-11-2b4-visual-redesign-design.md` planned ten slices and
**all ten ran**, across v0.99 → v0.111. Slice 9 took the ad-hoc-ink sweep to
zero, flipped that guard's `it.fails` into a real assertion, deleted its
ratchet entry, and lifted `forcedTheme` so the app gained a light theme.

What it did **not** do is two of its own stated deliverables, and they are what
this strand inherits:

- the `body` font-size flip from the pre-redesign 15px to `--text-body` (16px),
  which `globals.css` still carried a comment promising — the comment named
  slice 9 as its trigger and slice 9 shipped without pulling it;
- `design-system.md` "rewritten prescriptive", which is why that document still
  opens with *"Descriptive, not prescriptive"* — and why it still claims the
  app has one theme, thirteen releases after the very commit that finished the
  sweep gave it two.

So the residue is real but narrower than first written: two items slice 9
promised and did not deliver, not three slices that never happened. **The type
and colour migration itself is finished**, which is exactly what slice 5 of
this strand went on to measure and confirm — admin, import and pre-auth all at
zero on every counted family.

So this strand is not "add polish". It is **finish the design system, and give
motion and loading the same treatment type and colour already got.**

---

## Goals

1. Motion becomes a scale with tokens and a guard, the way type and colour are.
2. The type migration reaches zero and the last `it.fails` flips.
3. Every route that can wait has a loading state, and that state is legible to
   a screen reader and to a reduced-motion athlete.
4. Pending is spoken one way in all 26 components that speak it.
5. The two named layout offenders carried in the v0.124.0 handoff are fixed.
6. `design-system.md` becomes prescriptive and stops making a false claim.

## Non-goals

- **No surface is redesigned.** Outliers snap to a scale; the named offenders
  are relaid out. Nothing else deliberately changes shape. The full visual pass
  was considered and rejected: it changes every capture at once, which is the
  exact condition under which v0.123.0's four defects reached a green pipeline.
- **No new figure, card or destination.** Same non-goal 2b.4 carried.
- **No motion is added for delight.** Every token this introduces replaces a
  hand-written value that already ships. The count goes down, never up.

---

## The meter

Phase 6's other strands each opened with a measured inventory and closed
against it — choice load for flow and friction, route keys for IA. This strand
counts **the system's own scatter**, and the counting reuses machinery this
repo already trusts: `OFFENDER_CEILINGS` in `tests/type-scale-guard.test.ts`,
two-sided with `RATCHET_SLACK = 25`, re-pinned by every slice that moves a
number.

| Family | Today | Target | How counted |
| --- | --- | --- | --- |
| Arbitrary type sizes | **1** | 0 | existing `ARBITRARY_TYPE` scan; the one live offender is `src/components/ui/inline-markdown.tsx:38` (`text-[0.95em]`) |
| Stock-Tailwind type sizes | **17** in 8 files | 0 | `grep -rnoE '\btext-(xs\|sm\|base\|lg\|xl\|2xl\|3xl\|4xl\|5xl)\b' src --include=*.tsx \| grep -v test` |
| Hand-written durations | **11 spellings / 10 values** | 6 tokens, 0 literals | scan of `globals.css` + `duration-[…]` utilities |
| Hand-written easings | **8** | 4 tokens, 0 literals | scan of `globals.css` + `ease-[…]` utilities |
| Pending vocabularies | **3** across 26 components | 1 | call sites setting `disabled={<transition flag>}` without the shared primitive |
| Routes that wait with no `loading.tsx` | **2** (`/train`, `/body`) | 0 | `find src/app -name loading.tsx` against the route list |
| Loading states with no busy semantics | **6 of 6** | 0 | `aria-busy` / `role="status"` scan over `loading.tsx` |

`0.3s` and `300ms` both appear in `globals.css` for the same value. That two
spellings of one number survived a design-system release is the argument for
tokens in one line.

Density is deliberately **not** in that table. See "Density, and why its meter
is smaller" below — a strand that fakes a number is worse than one that admits
which part is judgement.

---

## Design 1 — The motion scale

Six durations and four easings, in `@theme` beside the type scale, named
semantically for the same reason the type scale is:

```css
/* Motion scale — Phase 6.4. Semantic names, and NOT Tailwind v4's own
   --ease-* keys: --ease-out, --ease-in and --ease-in-out are built-in theme
   values, and redefining them here would silently change every existing
   `ease-out` call site — the identical trap the type scale's comment records
   for --text-*. --duration-* has no built-in keys, so those are free. */
--duration-feedback: 120ms;   /* colour and opacity under the finger */
--duration-motion: 200ms;     /* small transforms, pops, chips */
--duration-transition: 320ms; /* sheets, panel heights, entrances */
--duration-reveal: 1200ms;    /* one-shot data draws: rings, sparklines */
--duration-loop: 3s;          /* ambient breathe / pulse */
--duration-drift: 8s;         /* the shimmer rotation */

--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--ease-settle: cubic-bezier(0.21, 1.02, 0.49, 1);
--ease-draw: cubic-bezier(0.65, 0, 0.35, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

**The collision trap is the load-bearing decision here.** Tailwind v4 ships
`--ease-in`, `--ease-out` and `--ease-in-out` as theme keys. Naming our settle
curve `--ease-out` would repoint every unmigrated `ease-out` in the app at a
curve it was never designed against — a silent, app-wide motion change from a
foundations-only edit. `--ease-settle` costs one word and cannot do that. This
is the same reasoning `globals.css:90` records for keeping the type scale off
`--text-sm`, and it is written here so the next implementer does not have to
rediscover it.

**Retirements.** `0.6s`/`0.7s`/`1.5s` collapse into `--duration-reveal`;
`160ms`/`0.2s`/`220ms` into `--duration-motion`; `0.3s`/`300ms` into
`--duration-transition`. `ease`, `ease-in-out` and `linear` go: `linear`
survives only on `--duration-drift`'s rotation, where it is correct and stays.

**`transition-all` is banned by the guard.** 17 call sites, including
`ui/button.tsx`'s base string, which animates every property a button has —
including `translate-y` on `:active`, which is why button presses currently
feel slightly late. Each becomes an explicit property list.

## Design 2 — Reduced motion, and the skeleton that says nothing

`globals.css:827` is a sledgehammer:

```css
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
```

`animation: none` also stops `.animate-pulse`. Combined with **zero of the six
`loading.tsx` files carrying `aria-busy` or `role="status"`**, a route load
today shows a reduced-motion athlete a static grey page with no signal, and
tells a screen-reader user nothing at all. Two defects, one root: the skeleton
carries its meaning entirely in movement.

The fix is in two halves:

- **Semantics, unconditionally.** The `Skeleton` primitive gains
  `aria-hidden`, and each `loading.tsx` wraps its skeletons in a container
  with `role="status"` and a visually-hidden "Loading <surface>". Motion stops
  being the only carrier.
- **A gentler reduced-motion rule.** `animation: none` becomes
  `animation-duration: 1ms; animation-iteration-count: 1`, with
  `transition-duration: 1ms` — the standard pattern, which kills motion
  without killing the state changes that some components depend on completing.
  This is a real behaviour change and gets its own capture pass in both
  motion preferences.

## Design 3 — Loading and pending

**Routes.** `loading.tsx` for `/train` and `/body` — the two heaviest
server-rendered surfaces, and the only two that can wait without saying so.
`/wellness` is a redirect stub and gets none; `/admin` gets one in the same
slice that migrates it.

**Pending.** 26 components run `useTransition` and all render the flag, in
three different vocabularies: `disabled` alone
(`today/mark-done-button.tsx:30`, `week/day-actions.tsx:201`), `disabled` plus
`"…"` (`settings/strava-card.tsx:128`), and `disabled` plus `"Saving…"`
(`train/races-section.tsx:419`, `today/checkin-sheet.tsx:264`). The athlete
gets a different answer to "did my tap register" depending on which surface
they are on, and on two of them the answer is "the button went grey".

One vocabulary, owned by `ui/button.tsx`: a `pending` prop that sets
`disabled`, sets `aria-busy`, and swaps the label for a caller-supplied
`pendingLabel` defaulting to the base label plus an ellipsis. Call sites stop
spelling the ternary out. The guard counts call sites that still do.

## Design 4 — Finishing the type migration

Three pieces, and the third is the risky one.

1. **The last arbitrary size, which is not a defect.** The one live offender
   is `inline-markdown.tsx:38` — `<code className="font-mono text-[0.95em]">`.
   Read before prescribing: the 0.95 is an **optical correction**, because
   Geist Mono renders visibly larger than Geist Sans at an identical
   `font-size`, and it is expressed in `em` precisely so it tracks whatever
   scale step its host sets. No absolute step can express it, and deleting it
   makes inline code read oversized on every surface that renders prose.

   So it is recorded, not removed. `type-scale-guard.test.ts` already has the
   precedent and the doctrine for exactly this: `INLINE_COLOR_INVENTORY`,
   described in its own comment as *"THE RECORD, not a waiver list"* — an
   exact inventory that cannot grow, for values no scan can rule on. A
   one-entry `RELATIVE_TYPE_INVENTORY` holds this call site and its reason;
   the scan narrows to arbitrary **absolute** sizes, which is what the release
   premise was ever about (300 hardcoded pixel sizes, 239 of them ≤11px); the
   `it.fails` at `type-scale-guard.test.ts:1373` flips to a real assertion;
   and `OFFENDER_CEILINGS["arbitrary type sizes"]` is re-pinned to 0.

   Narrowing a scan to make it pass is how guards get hollowed out, so the
   constraint is written into the slice: the inventory is exact and
   size-capped at one entry, a second relative size fails the suite, and the
   commit that adds one has to argue for it in the message.
2. **The 17 stock sizes.** Five shadcn primitives (`button`, `card`, `input`,
   `badge`, `label`), plus `connector-card.tsx` and `join/[code]`.
   `ui/button.tsx` is the illustrative one: within a single `cva` string its
   `sm` size already uses `text-label` while the base and `xs` still use
   `text-sm`/`text-xs`. Because the primitives are shared, this is the change
   with the widest blast radius in the strand and it gets its own slice with
   its own captures.
3. **The `body` flip, 15px → 16px.** `--text-body` is 16px and is used at 12
   call sites, so today those render one pixel larger than the body they sit
   in — the scale's own body step disagrees with the body element. Flipping it
   makes the scale true.

   **It also makes every surface taller, and that collides with a number this
   phase already banked.** `docs/2026-08-26-flow-inventory.md` records Train ▸
   Week at 1.84 phone screens measured at 15px. At 16px it will not be 1.84.
   The flip therefore ships in its own slice, is re-measured with the same
   method against the same fixtures, and the flow inventory gains a fifth
   dated section recording the new figures and naming the flip as the cause.
   A rise there is expected and is not a regression of the flow strand — but
   it must be measured and disclosed rather than discovered later by someone
   comparing two documents.

   `NOMINAL_TRACK_PX` (338px) is **not** affected: it is a width, and the flip
   changes no container width. Stated explicitly because the v0.124.0 handoff
   asks anyone touching the sheet's box to re-measure it, and this is the one
   nearby change that does not require it.

## Design 5 — Density, and why its meter is smaller

The spacing scale declares seven steps on a 4px base
(`--spacing-1` … `--spacing-12`). The app runs an **eleven-step 2px grid**:
210 half-step call sites (`py-1.5`×45, `gap-1.5`×37, `py-2.5`×33, `px-3.5`×18,
`px-2.5`×16, and the rest). The declared scale is fiction.

The tempting move is to count those 210 as offenders and drive them down. That
would be a fake number. Tailwind v4 computes fractional steps from the
`--spacing` base, `py-1.5` is 6px on a 2px grid, and 6px is not a defect — it
is the grid the app was actually built on. Counting it as scatter would
generate 210 units of churn for no legibility gained, and this strand's own
non-goal says the count goes down, never up.

So density gets the honest treatment instead:

- **Declare the real grid.** The seven discrete `--spacing-N` keys are
  removed, not added to. They are already no-ops: every one of them
  (`1`→0.25rem … `12`→3rem) restates exactly what Tailwind v4's default
  `--spacing` base of 0.25rem computes, so deleting them changes no rendered
  pixel while removing the claim that seven steps is the scale. The base is
  left at 0.25rem — **it must not be lowered to make the half-steps look
  integral**, because `--spacing` multiplies every utility and halving it
  would halve every padding in the app. Documented for what it is: a 4px base
  on which half-steps are permitted, an eleven-step 2px grid in practice.
- **Three role tokens where the scatter is real**, and it is real for one
  role: card padding runs `p-6`×28, `p-4`×25, `p-5`×15, `p-3`×8, `p-8`×7 —
  five paddings for one job. `--pad-card`, `--pad-row` and `--gap-stack` are
  introduced and the Card primitive adopts them; the guard counts Card call
  sites that override padding.
- **Typographic rhythm is judged, not counted.** Line-height and tracking get
  a review pass against captures in the final slice, and the spec says plainly
  that this part has no meter.

## Design 6 — The named offenders

The v0.124.0 handoff names two, both in one row of
`week/availability-timeline.tsx:319-370`, where day name, block summary,
`Pinned ×`, `+` and "edit precisely" share one flex line at 390px and the
summary truncates on a two-block day.

The handoff also names the honest lever, and this spec takes it: **`Pinned ×`
is a status that happens to be pressable, up to seven times.** It becomes a
non-interactive mark, and a single week-level "Back to your standard week"
control takes over the unpinning. That removes up to six controls without
removing a capability, and frees the width the summary needs.

Consequence for the number the last release moved the wrong way: the
availability sheet's choice load, **31 today**, is expected to land at **~25**.
That is disclosed as a prediction here and measured in the slice — the flow
inventory's own convention.

## Design 7 — The documentation debt

`docs/design-system.md` states *"one dark theme (no light mode — 'Dark-first:
the only theme')"*. Both themes have rendered since **v0.111.0** lifted
`forcedTheme`; `theme-provider.tsx:65` sets `defaultTheme="system"` and
`renderableThemes()` returns both. The document has been wrong for thirteen
releases because the slice that owned correcting it never ran.

Final slice: rewrite it prescriptive, as slice 9 intended, covering the type
scale, the spacing grid, the new motion scale, the pending vocabulary and both
themes.

---

## Slices

One branch, one PR, one deploy. Each slice is its own commit with its own
captures and axe pass, so a defect found after deploy costs one `git revert`.

| # | Slice | Contents |
| --- | --- | --- |
| 0 | **Foundations** | Motion tokens, spacing base, `motion-scale-guard.test.ts` with its ceilings pinned at the measured counts. **No call site changes**, so the app renders identically — the same shape slice 0 of 2b.4 used, and the proof is an unchanged capture set. |
| 1 | **Motion migration** | Every hand-written duration and easing onto the tokens; `transition-all` ×17 replaced with explicit property lists; ceilings re-pinned. |
| 2 | **Loading and pending** | `loading.tsx` for `/train` and `/body`; busy semantics on all of them; the gentler reduced-motion rule; `Button`'s `pending` prop and 26 call sites onto it. Captures in both motion preferences. |
| 3 | **The primitives** | The 17 stock type sizes, five shared primitives first. Widest blast radius in the strand; full capture set. |
| 4 | **The body flip** | 15px → 16px alone, nothing else. Re-measure choice load and screens; flow inventory gains its fifth dated section. |
| 5 | **Slices 7 + 8's surfaces** | ~~Admin, Import, and pre-auth — the surfaces 2b.4 never reached.~~ **Premise expired, corrected 2026-08-31.** Measured with the guards' own patterns, all three groups are at **0 arbitrary type sizes, 0 ad-hoc ink, 0 raw colour** — migrated in pieces by the v0.106 settings redesign, by guards that scan all of `src/` rather than one slice's directory, and by slice 3b taking `join/[code]`'s last two `text-xl`. `/admin` got its `loading.tsx` in slice 2a. The slice shrank to one file: `join/[code]/loading.tsx`. |
| 6 | **The named offenders** | `Pinned ×` demoted to a mark; one week-level "Back to your standard week"; re-measure the sheet's choice load against the predicted ~25. |
| 7 | **Sweep** | Last arbitrary type size; every ceiling re-pinned; `it.fails` flipped; `design-system.md` rewritten prescriptive; typographic rhythm review against captures; roadmap ticked. |

## Risks

| Risk | Mitigation |
| --- | --- |
| The body flip changes every capture at once, hiding a real defect in the noise | It ships alone, in its own slice, with nothing else in the commit. A diff that touches one declaration cannot hide a layout defect in an unrelated component. |
| The flip regresses the flow strand's banked figures | Expected and disclosed, not denied. Re-measured with the flow inventory's own method and recorded in a dated section naming the cause. |
| Migrating the shared primitives changes surfaces nobody looked at | Slice 3 takes a full capture set, not a targeted one. The v0.124.0 lesson is that the picture you did not expect to open is the one that carries the defect. |
| The gentler reduced-motion rule lets motion through that a user asked to stop | 1ms duration is not motion; the rule is the widely-used pattern. Captured under both motion preferences, and the axe pass runs against both. |
| A new `--ease-*` token silently repoints existing Tailwind call sites | Designed against: no token takes a name Tailwind v4 already defines. Slice 0's guard asserts that no token in the motion block collides with a built-in key. |
| The `Pinned ×` demotion removes a capability rather than a control | The week-level control lands in the same commit as the demotion, and the slice's acceptance is that every unpin reachable before is reachable after. |
| "Visual polish" quietly becomes a tweak list | Six of the seven slices close against a counted number. The one that does not — typographic rhythm — says so in this spec rather than pretending. |

## Verification

Every slice: the suite with a database, a capture + axe pass over the surfaces
it touched, and its ceiling re-pinned in the guard.

```bash
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run

BETTER_AUTH_URL=http://localhost:3210 npm run dev -- --port 3210

SEED_DEMO=1 npx tsx scripts/seed-availability.ts
npx tsx scripts/seed-confirmed-race.ts
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts <slice> --only=<surface>
```

**Open every picture, not the one you expect.** `docs/RELEASING.md` step 8 is
the only thing that stopped v0.124.0-rc.1 shipping a photograph of nothing,
and this strand changes shared primitives that every surface renders.
