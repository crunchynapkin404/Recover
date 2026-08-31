# Handoff — Phase 6 closed except IA, from `feat/finish-the-design-system`

**Read this if you are picking up the release, Phase 7, or anything that
touches the design system.** Written 2026-08-31 at the end of the visual-polish
strand. Everything here was measured or run, not remembered.

Authority order: **the code and the workflow files**, then `docs/ROADMAP.md`,
then `docs/specs/2026-08-30-visual-polish-and-motion-design.md`, then this
file. This supersedes `docs/2026-08-30-v0124-handoff.md`, whose traps section
is still accurate and still worth reading.

---

## State

|                   |                                                                             |
| ----------------- | --------------------------------------------------------------------------- |
| Branch            | `feat/finish-the-design-system`, **49 commits**, 83 files, +7,356/−1,398    |
| Version on `main` | 0.124.0 — **this branch is unreleased**                                     |
| Tests             | **3337 passed, 1 skipped**, and **no expected fail**                        |
| Accessibility     | 0 confirmed axe violations across 9 capture sets; ceiling never raised      |
| Phase 6           | **3 of 4 closed.** Only information architecture remains, parked on purpose |
| Phase 7           | 0 of 3, not started                                                         |

**The suite reports no expected-fail for the first time since v0.99.** The
last `it.fails` in the repo was `type-scale-guard.test.ts`'s, and it is a real
assertion now. If you see `1 expected fail` again, something regressed.

---

## What the strand actually was

The roadmap called it "transitions, loading states, density, typographic
rhythm", which reads like taste. Measuring found unfinished system work
instead, so it became **finish the design system**, on a counted meter, in
nine slices.

- **Motion became a scale.** 283 custom properties held zero durations and
  zero easings, against 11 hand-written duration spellings of 10 values and 8
  easings. Six duration tokens, four easings, and `tests/motion-scale-guard.
test.ts` — modelled on the type-scale ratchet — took three families to zero.
- **The type scale got line-heights.** It had sizes only, so every step
  inherited Tailwind preflight's 1.5. The text end is pinned at that same 1.5
  (582 call sites, zero pixels moved); only the four display steps tightened.
- **`body` moved 15px → 16px** and the last 17 stock-Tailwind sizes went with
  it. The app now has one type scale.
- **Loading and pending each got one vocabulary** where there had been none.
- **The availability sheet fell 31 → 25 controls** and stopped truncating.
- **`design-system.md` is prescriptive** — the rewrite 2b.4's slice 9
  promised and did not ship.

---

## The correction this strand had to make about itself

The spec opened by claiming 2b.4's slices 7, 8 and 9 **never ran**, and
several slices were argued from that. **It is wrong**, and the spec now
carries the correction in place.

The error came from reading `docs/plans/`, which stops at a slice-6 plan file,
and from `globals.css` promising 15px stays "until slice 9". Neither is
evidence: the later slices simply have no plan document. `git log` has them —
`81ab022` migrated Admin and Import (slice 7, v0.109.0), `3042cac` lifted
`forcedTheme` and finished the sweep (slice 9, v0.111.0) — and
`type-scale-guard.test.ts` records both with per-file counts, in comments that
were there to be read the whole time.

**Absence of a plan document is not absence of the work.** What slice 9
genuinely left undone was two of its own deliverables: the body flip and the
`design-system.md` rewrite. Both are now done.

Every measurement survived the correction. Slice 5 had already measured admin,
import and pre-auth at zero on every counted family — exactly what you would
expect if slices 7 and 8 had run — and recorded it as "the premise expired"
without joining the dots.

---

## Predictions that did not survive measurement

Worth reading before trusting this strand's own documents:

- **The body flip was called the risky slice.** It moved every surface by
  1–6px. The scale is in `rem` anchored to `html`, so the flip only ever
  reached text setting no size of its own — 42 inheriting elements against 66
  explicit ones on Train ▸ Week, and those 42 are short inline fragments and
  `sr-only` text. It was safe _because_ the migration was complete.
- **Demoting the `Pinned ×` badge was meant to uncrowd the day row.** At 390px
  it bought about 6px against the 269px a two-block summary needs. The
  truncation was fixed on its own terms instead: the summary wraps.
- **"Cuts six without removing any capability" was untrue as written.**
  Per-day unpin existed nowhere else, so it moved into `BlockSheet` first, in
  its own commit.
- **The stock-type-size count was 17, of which four were prose** — a doc
  comment recounting values it had already been migrated away from.

---

## Traps this codebase will spring on you

The v0.124.0 handoff's list is all still true. These are new or sharpened.

**A guard you can trip by writing prose is a guard people work around.** This
happened **four times** in one strand: motion literals, the reduced-motion
rule, `aria-busy` in a doc comment, and the stock type sizes. Every scan in
`motion-scale-guard.test.ts` strips comments before matching.
**`tests/viewport-zoom-guard.test.ts` still matches bare words** and has not
been fixed.

**A token's existence says nothing about a utility's existence.** Tailwind
builds `duration-<name>` from `--transition-duration-*` only; a `--duration-*`
key is a plain custom property that produces **no utility at all**, so the
class is inert while looking correct. Slice 0 shipped that namespace and slice
1's first call site was silently doing nothing. The guard now compiles
`globals.css` and asserts the rule is emitted.

**Never take a token name Tailwind already defines.** `--ease-in`,
`--ease-out`, `--ease-in-out`, `--ease-linear` are its own keys: declaring one
repoints every existing call site rather than adding a token.

**`src/app/loading.tsx` is the ROOT segment's boundary**, not just Today's. It
stands in for every route whose own boundary has not resolved, so a hard load
of `/train` paints it first. It must not name a surface — labelling it made
`/train` announce "Loading your day…".

**`verify-surfaces.ts` can never photograph a loading state** — it waits for
content, by design. Capture coverage says nothing about those screens. Drive a
real navigation and poll for `[role=status]`.

**Two reasons a capture diff misleads.** The script creates an API token per
theme/viewport combo, so every `settings*` surface grows and `admin`'s audit
log gains that run's own entries — those two are never comparable run to run.
And Today, Train, Body and several others render date-dependent content, so a
set taken either side of midnight differs on ~76 of 100 images with no code
change. **Check the mtimes before reading a diff.**

**The banked flow figures no longer reproduce.** Train ▸ Week reads 1.36 where
`docs/2026-08-26-flow-inventory.md` banked 1.84, Fitness 1.48 against 1.00,
Season 1.36 against 1.00. The drift runs in **both** directions, so it is
fixture data, not CSS. The roadmap's "4.7 → 1.84" was left alone deliberately:
replacing it would swap one fixture-dependent number for another and imply a
regression that did not happen.

**Read the shape of a suite result, not the total.** When a guard file stops
loading it takes its own failing-by-design test with it, and the headline
count goes **up**. That happened once here — "3324 passed, 1 skipped" with the
expected-fail line simply gone, while an entire guard was broken.

---

## What you are inheriting

Named so they are not rediscovered as surprises.

- **Information architecture is Phase 6's last strand**, parked on telemetry
  that now has real keys and more data. Nothing in this strand touched it.
- **This branch is unreleased.** `docs/RELEASING.md` is ten steps, nothing
  hand-run except 1, 5 and **8** — the step with no entry point, which exists
  because four defects reached a fully green pipeline in v0.123.0 and a human
  opening a picture caught all four.
- **Three conventions have no guard**, and `design-system.md` says so:
  typographic rhythm beyond the scale, density per role (card padding still
  ranges `p-3` … `p-8`), and which step a given piece of text deserves.
- **`inline-markdown.tsx`'s `text-[0.95em]` is permanent**, recorded by name
  in `RELATIVE_TYPE_INVENTORY`. A second relative size fails the build.
- **Everything the v0.124.0 handoff listed as inherited is still inherited**:
  no `ⓘ` anywhere, `SessionFuelling` and `RaceChip` still full blocks,
  `BlockSheet` has no focus trap of its own, `Math.round` vs anchors, two
  deliberately vacuous tests, energy and sports invisible on the timeline, and
  the stale-snapshot race during a drag.

---

## How to verify anything here

```bash
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run

BETTER_AUTH_URL=http://localhost:3210 npm run dev -- --port 3210

# SEED FIRST — train-availability photographs blank tracks without it.
SEED_DEMO=1 npx tsx scripts/seed-availability.ts
SEED_DEMO=1 npx tsx scripts/seed-confirmed-race.ts
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts <slice>
```

**Do not pipe the capture through `tail`** — it buffers, and an eleven-minute
run looks hung. Watch `.screenshots/<slice>/` fill instead. Expect ~100 PNGs
and the same 28 fixture-gap errors every set in this strand recorded:
`first-run-*` needs a dataless account, `train-plan-preview` a draft,
`activity-detail` and `debrief-sheet` an activity.

For a CSS-only change, skip screenshots: compile `src/app/globals.css` through
`@tailwindcss/postcss` at both commits and diff the output. That is what
proved slice 0 was a no-op, and it has no fixture dependency.
