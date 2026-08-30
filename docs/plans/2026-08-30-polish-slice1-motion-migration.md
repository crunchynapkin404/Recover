# Visual polish — slice 1: the motion migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive all three motion ceilings to **zero** — every hand-written
duration and easing onto the tokens slice 0 added, every `transition-all`
replaced by the properties that actually change.

**Architecture:** The guard written in slice 0 is the test. Each task lowers
its ceiling to 0 first and watches the suite go red, then migrates until it
goes green — the ratchet drives the work rather than recording it afterwards.

**Tech Stack:** Tailwind v4 (`@theme inline` in `src/app/globals.css`),
Vitest, TypeScript.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md`

**Previous slice:** `docs/plans/2026-08-30-polish-slice0-foundations.md` —
read its Outcome section for the ceilings as they stand and the two counting
errors it corrected.

**Branch:** `feat/finish-the-design-system`.

## Global Constraints

- **THIS SLICE CHANGES RENDERED MOTION.** Slice 0 was a no-op and could be
  proven so by diffing compiled CSS. This one cannot: collapsing 10 duration
  values into 6 moves some of them. Every changed timing is enumerated in
  Task 1 with its before, after and reason. A capture pass is mandatory, and
  a reviewer should be told which surfaces to watch.
- **Narrowing a `transition-all` can DELETE an animation.** `transition-all`
  animates every animatable property, including ones nobody intended. Each
  replacement in Task 3 lists the properties that actually change at that
  call site, derived by reading the variant classes on the same element. Two
  sites deliberately stop animating something — both are named.
- **Tailwind v4 uses standalone `translate` and `scale` properties**, not the
  legacy `transform`. Verified in compiled output: `active:scale-90` emits
  `scale: var(--tw-scale-x) var(--tw-scale-y)`, `hover:-translate-y-px` emits
  `translate: …`. So the property list is `translate` / `scale`, and
  `transition-transform` would NOT cover them.
- **Zero confirmed axe violations** stays the ceiling.
- Run `npx prettier --write src/app/globals.css` after editing it, or the
  token readers stop seeing the tokens.

---

### Task 1: globals.css — 25 literals to zero

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/motion-scale-guard.test.ts` (lower one ceiling)

**Interfaces:**
- Consumes: the ten motion tokens from slice 0.
- Produces: no new names.

**The complete mapping.** Every literal, its token, and what an athlete sees.
"±" is the rendered change; three entries are large enough to name in the
commit message.

| Line | Selector | Now | Becomes | Rendered change |
| --- | --- | --- | --- | --- |
| 402 | `.glass` transform | `0.3s` + spring | `var(--duration-transition)` + `var(--ease-spring)` | +20ms |
| 403 | `.glass` box-shadow | `0.3s ease` | `var(--duration-transition)` + `var(--ease-standard)` | +20ms, curve |
| 442 | `.hero-pulse` | `3s` + `(0.4,0,0.2,1)` | `var(--duration-loop)` + `var(--ease-standard)` | none |
| 459 | `.ring-animate` | `1.2s` + draw | `var(--duration-reveal)` + `var(--ease-draw)` | none |
| 471 | `.ring-fill` | `1.2s` + draw | `var(--duration-reveal)` + `var(--ease-draw)` | none |
| 485 | `.sparkline-animate path` | `1.2s ease-out` | `var(--duration-reveal)` + `var(--ease-standard)` | curve |
| 495 | `.clip-reveal` | `1.5s` + draw | `var(--duration-reveal)` + `var(--ease-draw)` | **−300ms** |
| 504 | `.trend-arrow-animate` | `0.6s` + spring | `var(--duration-transition)` + `var(--ease-spring)` | **−280ms** |
| 521 | `.ai-sparkle` | `8s linear` | `var(--duration-drift) linear` | none |
| 548 | `.breathe` | `3s ease-in-out` | `var(--duration-loop)` + `var(--ease-standard)` | curve |
| 566 | `.reveal` | `all 0.7s` + settle | explicit props + `var(--duration-transition)` + `var(--ease-settle)` | **−380ms** |
| 577 | `.login-input` | `all 0.2s ease` | explicit props + `var(--duration-motion)` + `var(--ease-standard)` | curve |
| 618 | `.collapsible-panel` | `height 0.3s ease-out` | `height var(--duration-transition) var(--ease-standard)` | +20ms, curve |
| 688 | `.sheet-panel` animation | `300ms` + settle | `var(--duration-transition)` + `var(--ease-settle)` | +20ms |
| 689 | `.sheet-panel` transition | `220ms` + settle | `var(--duration-motion)` + `var(--ease-settle)` | −20ms |
| 702 | `.menu-pop` | `160ms ease-out` | `var(--duration-motion)` + `var(--ease-standard)` | +40ms |

**The three that move visibly, and why each is right rather than merely
tolerated:**

- `.clip-reveal` 1500 → 1200ms joins the other three one-shot data draws
  (`ring-animate`, `ring-fill`, `sparkline-animate`) which were already 1.2s.
  It was the odd one out, not the standard.
- `.trend-arrow-animate` 600 → 320ms. A spring-eased arrow nudge is a
  micro-interaction, not a data reveal; 600ms on a small bounce reads as lag.
  Mapping it to `--duration-reveal` would have DOUBLED it, which is why the
  spec's "0.6s collapses into reveal" line is wrong and this plan overrides
  it — recorded here rather than silently.
- `.reveal` 700 → 320ms. A scroll-triggered entrance that takes over
  two-thirds of a second is the single most sluggish motion in the app. It is
  a transition, not a draw.

**Two `transition: all` in CSS become explicit**, for the same reason Task 3
does it in markup:

- `.reveal` animates `opacity` and a `translateY` → `transition: opacity …, transform …`
- `.login-input` animates `background`, `border-color` and `box-shadow` on
  focus → those three, not `all`.

- [ ] **Step 1: Lower the ceiling to zero and watch it fail**

In `tests/motion-scale-guard.test.ts`, change the entry to:

```ts
  // 0 — slice 1 migrated every literal onto the motion scale.
  "globals.css motion literals": 0,
```

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: FAIL — "globals.css motion literals rose to 25, above the pinned
ceiling of 0".

That failure is the task's definition of done, stated before the work.

- [ ] **Step 2: Migrate all 16 declarations**

Apply the mapping table above. Worked examples for the three shapes present:

```css
/* animation shorthand */
.ring-animate {
  animation: ring-draw var(--duration-reveal) var(--ease-draw) forwards;
}

/* multi-property transition */
.glass {
  transition:
    transform var(--duration-transition) var(--ease-spring),
    box-shadow var(--duration-transition) var(--ease-standard);
}

/* `all` becoming explicit */
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity var(--duration-transition) var(--ease-settle),
    transform var(--duration-transition) var(--ease-settle);
}
```

- [ ] **Step 3: Run the guard**

```bash
npx prettier --write src/app/globals.css
npx vitest run tests/motion-scale-guard.test.ts
```
Expected: PASS. If the count is not 0, the failure message names the
remaining `globals.css:<line>` — go and look at it rather than raising the
ceiling.

- [ ] **Step 4: Confirm no keyframe lost its curve**

```bash
grep -nE "animation:|transition:" src/app/globals.css | grep -v "var(--duration" | grep -v "^\s*[0-9]*:\s*\*"
```
Expected: no output. Any line printed is a declaration that kept a literal or
lost its easing entirely.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tests/motion-scale-guard.test.ts
git commit -m "refactor(design): globals.css motion onto the scale

25 hand-written literals across 16 declarations to zero. Three timings move
visibly and deliberately: clip-reveal 1500->1200ms (joins the three data
draws that were already 1.2s), trend-arrow 600->320ms (a spring nudge is a
micro-interaction; mapping it to --duration-reveal would have doubled it,
which is where the spec's collapse table was wrong), and the scroll reveal
700->320ms (the most sluggish motion in the app). Everything else moves by
20-40ms or only changes curve.

Two CSS \`transition: all\` became explicit property lists at the same time."
```

---

### Task 2: the four numeric duration utilities

**Files:**
- Modify: `src/app/login/page.tsx:102`, `src/components/ui/collapsible.tsx:38`, `src/components/coach/artifact-card.tsx:156`, `src/components/ui/bottom-sheet.tsx:206`
- Modify: `tests/motion-scale-guard.test.ts`

**Interfaces:** none new. `duration-300` → `duration-transition` (300→320ms),
`duration-200` → `duration-motion` (exact).

- [ ] **Step 1: Lower the ceiling and watch it fail**

```ts
  // 0 — slice 1 moved all four onto token-named utilities.
  "numeric duration utilities": 0,
```

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: FAIL — "numeric duration utilities rose to 4, above the pinned
ceiling of 0".

- [ ] **Step 2: Replace all four**

```bash
sed -i 's/\bduration-300\b/duration-transition/' src/app/login/page.tsx src/components/ui/collapsible.tsx src/components/ui/bottom-sheet.tsx
sed -i 's/\bduration-200\b/duration-motion/' src/components/coach/artifact-card.tsx
```

- [ ] **Step 3: Verify the utilities actually compile**

A token-named utility only exists if the token exists. Confirm all four emit
real CSS rather than silently doing nothing:

```bash
node --input-type=module -e '
import postcss from "postcss"; import tw from "@tailwindcss/postcss"; import { readFileSync } from "node:fs";
const out = await postcss([tw()]).process(readFileSync("src/app/globals.css","utf8"), { from: "src/app/globals.css" });
for (const c of ["duration-transition","duration-motion"]) {
  const m = new RegExp(`\\\\.${c}\\\\s*\\\\{[^}]*\\\\}`).exec(out.css);
  console.log(m ? m[0].replace(/\\s+/g," ") : c + ": NOT EMITTED — the utility is inert");
}'
```
Expected: both print a rule containing `transition-duration`. A `NOT EMITTED`
means the class silently does nothing, which is worse than the literal it
replaced.

- [ ] **Step 4: Run the guard**

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx src/components/ui/collapsible.tsx src/components/ui/bottom-sheet.tsx src/components/coach/artifact-card.tsx tests/motion-scale-guard.test.ts
git commit -m "refactor(design): numeric duration utilities onto the scale

duration-300 -> duration-transition (300->320ms) at three sites, duration-200
-> duration-motion (exact) at one. Verified both utilities compile to real
CSS: a token-named utility whose token is missing is inert, which is worse
than the literal it replaced."
```

---

### Task 3: `transition-all` — 17 to zero

**Files:** the 14 files below.
- Modify: `tests/motion-scale-guard.test.ts`

**The complete mapping**, derived by reading the variant classes on each
element. Tailwind v4 property names, confirmed against compiled output.

| # | Site | What actually changes | Replacement |
| --- | --- | --- | --- |
| 1 | `app/page.tsx:308` | `hover:bg-surface-overlay` | `transition-colors` |
| 2 | `app/page.tsx:319` | same | `transition-colors` |
| 3 | `app/join/[code]/join-form.tsx:110` | `hover:opacity-90`, `disabled:opacity-50` | `transition-opacity` |
| 4 | `app/login/page.tsx:102` | opacity + `hover:-translate-y-px` + `active:translate-y-0` | `transition-[opacity,translate]` |
| 5 | `components/bottom-nav.tsx:19` | `active:scale-90` + active/inactive `text-*` | `transition-[color,scale]` |
| 6 | `components/activity/activity-log-form.tsx:63` | bg, `ring-2` (box-shadow), text colour | `transition-[color,background-color,box-shadow]` |
| 7 | `components/activity/activity-log-form.tsx:248` | opacity | `transition-opacity` |
| 8 | `components/import/import-form.tsx:148` | opacity | `transition-opacity` |
| 9 | `components/ui/button.tsx:7` | bg/text/border colour, focus ring, `disabled:opacity-50` | `transition-[color,background-color,border-color,box-shadow,opacity]` |
| 10 | `components/ui/unavailable.tsx:47` | `hover:bg-accent/90` | `transition-colors` |
| 11 | `components/ui/badge.tsx:8` | bg/text/border colour, focus ring | `transition-[color,background-color,border-color,box-shadow]` |
| 12 | `components/admin/invite-manager.tsx:51` | opacity | `transition-opacity` |
| 13 | `components/admin/sync-jobs-panel.tsx:113` | opacity | `transition-opacity` |
| 14 | `components/coach/artifact-card.tsx:156` | `h-80` ↔ `h-20` | `transition-[height]` |
| 15 | `components/coach/chat-interface.tsx:332` | `hover:bg-accent/90` | `transition-colors` |
| 16 | `components/body/journal-form.tsx:323` | `grayscale` ↔ `grayscale-0` (filter), `ring-2` | `transition-[filter,box-shadow]` |
| 17 | `components/body/journal-form.tsx:698` | opacity | `transition-opacity` |

**TWO SITES DELIBERATELY STOP ANIMATING SOMETHING. Both are improvements, and
both are visible:**

- **#9, `ui/button.tsx`.** The base string carries
  `active:not-aria-[haspopup]:translate-y-px` — the press nudge. Under
  `transition-all` that nudge is *animated*, so the button sinks over the
  transition duration instead of on contact. That is the "presses read
  slightly late" note in the spec. `translate` is deliberately excluded, so
  the nudge becomes instant. **This changes how every button in the app feels
  on touch** and is the single highest-traffic change in the slice.
- **#16, `body/journal-form.tsx:323`.** The selected mood gains `p-1` and
  `rounded-full` alongside its ring. `transition-all` animates the padding,
  so the emoji shifts its neighbours during the transition. Narrowing to
  `filter` and `box-shadow` makes the layout snap and only the greyscale and
  ring animate. Watch `body-journal` in the captures.

- [ ] **Step 1: Lower the ceiling and watch it fail**

```ts
  // 0 — slice 1 replaced every one with the properties that actually change.
  "transition-all": 0,
```

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: FAIL — "transition-all rose to 17, above the pinned ceiling of 0".

- [ ] **Step 2: Apply the seven `transition-opacity` sites**

These seven are identical in shape — a filled accent button whose only
animated properties are `hover:opacity-90` and `disabled:opacity-50`:

```bash
for f in src/app/join/\[code\]/join-form.tsx \
         src/components/activity/activity-log-form.tsx \
         src/components/import/import-form.tsx \
         src/components/admin/invite-manager.tsx \
         src/components/admin/sync-jobs-panel.tsx \
         src/components/body/journal-form.tsx; do
  sed -i 's/transition-all hover:opacity-90/transition-opacity hover:opacity-90/g' "$f"
done
```

Then confirm exactly seven changed and none was missed:

```bash
grep -rno "transition-opacity hover:opacity-90" src --include=*.tsx | grep -v test | wc -l
```
Expected: `7`.

- [ ] **Step 3: Apply the four `transition-colors` sites**

`app/page.tsx` ×2, `ui/unavailable.tsx`, `coach/chat-interface.tsx` — each
animates only a background or text colour. Edit each occurrence of
`transition-all` to `transition-colors` in those three files (page.tsx has
two, on lines 308 and 319).

- [ ] **Step 4: Apply the six arbitrary-property sites, one at a time**

Each of these needs the exact string from the table:

- `app/login/page.tsx:102` → `transition-[opacity,translate]`
- `components/bottom-nav.tsx:19` → `transition-[color,scale]`
- `components/activity/activity-log-form.tsx:63` → `transition-[color,background-color,box-shadow]`
- `components/ui/button.tsx:7` → `transition-[color,background-color,border-color,box-shadow,opacity]`
- `components/ui/badge.tsx:8` → `transition-[color,background-color,border-color,box-shadow]`
- `components/coach/artifact-card.tsx:156` → `transition-[height]`
- `components/body/journal-form.tsx:323` → `transition-[filter,box-shadow]`

- [ ] **Step 5: Verify every arbitrary utility compiles**

An arbitrary property list with a typo emits nothing and removes the
transition silently. Check all seven produce a `transition-property`:

```bash
node --input-type=module -e '
import postcss from "postcss"; import tw from "@tailwindcss/postcss"; import { readFileSync } from "node:fs";
const out = await postcss([tw()]).process(readFileSync("src/app/globals.css","utf8"), { from: "src/app/globals.css" });
const want = ["opacity,translate","color,scale","color,background-color,box-shadow","color,background-color,border-color,box-shadow,opacity","color,background-color,border-color,box-shadow","height","filter,box-shadow"];
for (const w of want) {
  console.log(out.css.includes(w) ? "ok   " + w : "MISSING (inert!) " + w);
}'
```
Expected: every line `ok`. A `MISSING` means Tailwind did not generate that
class and the element now has no transition at all.

- [ ] **Step 6: Run the guard and the full suite**

```bash
npx vitest run tests/motion-scale-guard.test.ts
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```
Expected: guard PASS with all three ceilings at 0; suite at the slice-0
baseline of 3316 passed / 1 expected fail / 1 skipped.

- [ ] **Step 7: Commit**

```bash
git add -u src tests
git commit -m "refactor(design): transition-all onto explicit property lists

17 to zero. Each replacement lists the properties that actually change at
that call site, read off the variant classes on the same element.

Two sites deliberately stop animating something, both visible:

- ui/button.tsx excludes \`translate\`, so the :active press nudge lands on
  contact instead of easing in over the transition. That is every button in
  the app.
- journal-form's mood picker excludes padding, so the selected emoji no
  longer shifts its neighbours mid-transition; only greyscale and the ring
  animate.

Tailwind v4 uses standalone translate/scale properties, not transform, so
transition-transform would not have covered either of the two transform
sites. Every arbitrary property list was verified to compile — a typo emits
nothing and removes the transition silently."
```

---

### Task 4: prove it, and hand on

**Files:** none modified beyond ticking this plan.

- [ ] **Step 1: All three ceilings read zero**

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: PASS, and `OFFENDER_CEILINGS` reads `0, 0, 0`. Note that the
two-sided half of the ratchet now pins them there: any re-introduced literal
fails the suite immediately.

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint src tests
```
Expected: clean. Ignore `.next/` generated-type noise; re-run before
investigating it.

- [ ] **Step 3: Seed and capture**

```bash
BETTER_AUTH_URL=http://localhost:3210 npm run dev -- --port 3210 &
set -a; . ./.env; set +a
SEED_DEMO=1 npx tsx scripts/seed-availability.ts
SEED_DEMO=1 npx tsx scripts/seed-confirmed-race.ts
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice1
```

Do **not** pipe this through `tail` — it buffers and the run looks hung for
eleven minutes. Watch `.screenshots/polish-slice1/` fill instead. Expect ~100
PNGs, 0 confirmed axe violations, and the same 22 fixture-gap errors slice 0
recorded (`first-run-*`, `train-plan-preview`, `activity-detail`,
`debrief-sheet`) — those are dev-database gaps, not regressions.

- [ ] **Step 4: Open the pictures, and know which ones matter**

Motion does not photograph. A still capture proves nothing about a 320ms
curve, so this step is about the things that changed *statically* or that a
capture can catch mid-transition:

- **`body-journal`** — the mood picker's selected state (#16). Padding no
  longer animates; confirm the selected emoji is not visibly offset.
- **every surface with a button** — #9 touches all of them. Confirm no
  button lost its hover colour transition entirely, which is what a typo in
  the arbitrary property list would look like.
- **`coach-thread` / `coach-history`** — the artifact card's height toggle.
- **`today`** — `.reveal`, `.trend-arrow-animate` and `.hero-pulse` all live
  here.

Then open the rest anyway. Four defects reached a green pipeline on
v0.124.0 and a human opening a picture caught every one.

- [ ] **Step 5: Check the motion by hand, because no test can**

With the dev server still running, in a browser at 390×844:

1. Press and hold a primary button — the nudge must land on contact, not
   ease in. This is the one change a reviewer is most likely to feel.
2. Open a bottom sheet — it should still settle, not snap.
3. Toggle a collapsible panel — height still animates.
4. Set the OS to reduced motion and repeat: everything should be still.
   (The blunt `*` rule is still in force; slice 2 replaces it.)

- [ ] **Step 6: Tick this plan and commit**

```bash
git add docs/plans/2026-08-30-polish-slice1-motion-migration.md
git commit -m "docs(plan): slice 1 complete — all three motion ceilings at zero"
```

---

## What this slice deliberately does not do

- **Reduced motion is still the `*` sledgehammer** and the six `loading.tsx`
  files still carry no busy semantics. Slice 2.
- **The `pending` vocabulary is still spoken three ways** across 26
  components. Slice 2.
- **No type or spacing work.** Slices 3 and 4.
- **`.ease-settle` stops being a dead rule** in this slice — slice 0 recorded
  it as generated-but-unused, and Task 1 gives it real call sites.

## Next

`docs/plans/2026-08-30-polish-slice2-loading-and-pending.md`: `loading.tsx`
for `/train` and `/body`, busy semantics on all of them, the gentler
reduced-motion rule, and `Button`'s `pending` prop with 26 call sites onto it.
