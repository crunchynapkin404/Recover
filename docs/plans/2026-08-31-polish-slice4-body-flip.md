# Visual polish — slice 4: the body flip, 15px → 16px

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the type scale true. `--text-body` is 16px and `body` is 15px,
so the scale's own body step disagrees with the body element.

**Architecture:** One declaration. Everything else in this slice is
measurement, because one declaration changes the height of every surface in
the app.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md`, Design 4,
third piece.

**Branch:** `feat/finish-the-design-system`.

## The one-line change, and why it needs a whole slice

`src/app/globals.css` carries this, and has since v0.99:

```css
  /* Stays at the pre-redesign 15px until the last surface migrates
     (slice 9), when this moves to --text-body (16px). Sitting on the new
     scale now would be a one-pixel, app-wide visible change this
     foundations-only slice is not permitted to make. */
  font-size: 15px;
```

Slice 9 never ran. The comment has been a promissory note for thirteen
releases, and **slice 3b just made its condition true**: the last surface has
migrated, so the reason to wait is gone.

**It changes the height of every surface at once**, which is the exact
condition the spec's Risks table names as how v0.123.0's four defects reached
a green pipeline. Hence: it ships alone, in its own commit, with nothing else
in it. A diff that touches one declaration cannot hide a layout defect in an
unrelated component.

## It collides with a number this phase already banked

`docs/2026-08-26-flow-inventory.md` records **Train ▸ Week at 1.84 phone
screens**, measured at 390×844 with `body` at 15px. At 16px it will not be
1.84. That is not a regression of the flow strand — it is the same content
measured against a different ruler — but it must be **re-measured and
disclosed** rather than left for someone to discover by comparing two
documents.

`NOMINAL_TRACK_PX` (338px) is **not** affected: it is a width, and this
changes no container width. Stated explicitly because the v0.124.0 handoff
tells anyone touching the availability sheet's box to re-measure it, and this
is the one nearby change that does not require it.

**Choice load does not change either.** The flip adds and removes no control,
so only the `scroll (IA)` column of the flow inventory's table moves.

## Global Constraints

- **Nothing else in the commit.** No other file may be touched.
- **Measure before flipping.** A "before" reading taken after the change is
  worthless, and the existing 1.84 figure predates three slices of this
  strand — it cannot be assumed still current.
- **Zero confirmed axe violations** stays the ceiling. A larger base font is
  very unlikely to break contrast, but the ratchet is a ratchet.

---

### Task 1: measure the ruler before you change it

**Files:** none. This task produces the "before" column.

- [x] **Step 1: Confirm the current state**

```bash
grep -n "font-size: 15px" src/app/globals.css
```
Expected: one hit, in the `body` rule. If it is already 16px, this slice has
been done and the plan is stale.

- [x] **Step 2: Measure screens for every surface in the inventory's table**

The repo has no committed choice-load counter — the flow inventory says so
twice — so this is an ad hoc Playwright pass, same as the previous four
measurements. Sign in as `dev@recover.local`, phone viewport 390×844, and for
each surface record `document.documentElement.scrollHeight / 844`.

Surfaces, in the inventory's own order: `Body ▸ Journal`, `Train ▸ Week`,
`Activity log`, `Today`, `Coach`, `Settings (collapsed)`, `Body ▸ Trends`,
`Train ▸ History`, `Train ▸ Fitness`, `Import`, `Train ▸ Season`.

Record the numbers to two decimals, in a scratch file, before touching
anything.

- [x] **Step 3: Sanity-check against the banked figure**

Train ▸ Week should read close to **1.84**. If it does not, say so — three
slices have landed since that measurement and one of them (3a) shortened
display type. **Do not adjust the flow inventory to match a number you did
not verify**; record what you measured and note the drift.

---

### Task 2: the flip

**Files:** `src/app/globals.css` only.

- [x] **Step 1: Write the failing test**

Add to `tests/motion-scale-guard.test.ts`:

```ts
describe("the body element sits on the scale", () => {
  it("uses --text-body, not a pre-redesign literal", () => {
    // The scale's own body step is 16px. While `body` was 15px the scale
    // disagreed with the element it describes, and the 12 call sites using
    // `text-body` rendered one pixel larger than the text around them.
    const body = /\n\s*body\s*\{([\s\S]*?)\n\s*\}/.exec(css());
    expect(body, "no body rule in globals.css").not.toBeNull();
    expect(body![1]).not.toMatch(/font-size:\s*15px/);
    expect(body![1]).toMatch(/font-size:\s*var\(--text-body\)/);
  });
});
```

Run it. Expected: FAIL on the first matcher — `font-size: 15px` is present.

- [x] **Step 2: Flip it**

```css
  body {
    @apply bg-background text-foreground;
    /* On the scale as of slice 4. This sat at the pre-redesign 15px from
       v0.99 until slice 3b migrated the last surface, which was the condition
       the original comment named — "until the last surface migrates (slice
       9)". Slice 9 never ran; slice 3b finished its work. The scale's body
       step is 16px, and while this was 15px the scale disagreed with the
       element it describes: the 12 `text-body` call sites rendered a pixel
       larger than the prose around them. */
    font-size: var(--text-body);
    -webkit-font-smoothing: antialiased;
    letter-spacing: -0.01em;
    overflow-x: hidden;
  }
```

- [x] **Step 3: Tests, types, lint**

```bash
npx prettier --write src/app/globals.css
npx vitest run tests/motion-scale-guard.test.ts
npx tsc --noEmit && npx eslint src tests
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```

Read the *shape* of the suite result, not just the total: a guard file that
stops loading takes its own `it.fails` with it and the headline count goes
**up**. Expect `1 expected fail` to still be present.

- [x] **Step 4: Commit, alone**

```bash
git add src/app/globals.css tests/motion-scale-guard.test.ts
git commit -m "feat(design): body sits on the scale — 15px to 16px

..."
```

---

### Task 3: measure the new ruler, and disclose it

- [x] **Step 1: Re-measure, same method, same fixtures**

Identical script, identical surfaces, identical viewport. The only thing that
may differ is the day's data — note it if so.

- [x] **Step 2: Add a fifth dated section to the flow inventory**

`docs/2026-08-26-flow-inventory.md` has four dated sections (original, slice
1, slice 2, slice 3). Add a fifth for this, stating plainly:

- the before and after screen counts per surface;
- that **choice load is unchanged**, because the flip adds and removes no
  control;
- that a rise is **expected and not a regression of the flow strand** — the
  same content measured against a different ruler;
- Train ▸ Week specifically, since 1.84 is the figure the roadmap quotes.

- [x] **Step 3: Update the roadmap if it quotes a moved number**

`docs/ROADMAP.md` states "4.7 phone screens → 1.84". If the new figure differs,
correct it there too, in the same commit, with a pointer to the new section.
Leaving the roadmap quoting a superseded measurement is how the v0.87.0
mistake happened, per 2b.4's own spec.

- [x] **Step 4: Capture and axe**

```bash
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice4
```

**Every surface will differ.** That is expected here and is the reason this
slice ships alone — with one declaration in the diff, a defect cannot hide
behind an unrelated change. Capture a same-day baseline first if a diff is
wanted, since date-dependent content makes cross-day sets unreadable.

- [x] **Step 5: Open the pictures, and know what you are looking for**

Not "did it get bigger" — it did, everywhere, by design. Look for:

- **text that now wraps where it did not**, especially the availability day
  row, which the v0.124.0 handoff already records as crowded at 390px with a
  truncating summary;
- **fixed-height components whose text no longer fits** — `button` (h-6..h-9),
  `badge` (h-5), `input` (h-6/h-8) all centre text in a fixed box, and 16px
  in an `h-5` badge is the tightest of those;
- **anything that now overflows horizontally**, since `body` has
  `overflow-x: hidden` and would silently clip rather than scroll.

- [x] **Step 6: Commit the measurement**

## What this slice does not do

- **It does not adjust any component to compensate.** If something breaks at
  16px, that is a finding for its own commit with its own reasoning, not a
  tweak buried in the flip.
- **It does not touch `--text-body` itself.** The scale is right; the element
  was wrong.

## Next

`docs/plans/2026-08-31-polish-slice5-remaining-surfaces.md` — admin, import
and pre-auth, the surfaces 2b.4's slices 7 and 8 never reached.


---

## Outcome — run 2026-08-31, all three tasks complete

Suite **3335 passed / 1 expected fail / 1 skipped**; `tsc` and `eslint` clean.
Capture: **100 PNGs, 0 confirmed axe violations**, 128/89/28 — identical to
every prior slice.

### The predicted risk did not materialise, and the reason is worth keeping

The spec called this the risky slice: 15px → 16px would make every surface
taller and collide with the banked 1.84 screens. Measured before and after in
one session on identical fixtures, **every surface was unchanged** except
Train ▸ Fitness at +0.01. The capture agrees: all 100 images moved, but by
**1–6px** on pages 1,700–4,000px tall.

**The type scale is in `rem`, anchored to `html`, not to `body`.** `html` is
the browser default 16px, so `--text-label: 0.75rem` has always been 12px
whatever `body` said. The flip reached only text that sets no size of its own:
on Train ▸ Week, **66 text-bearing elements carry an explicit scale class and
42 inherit**, and the inheriting ones are short inline fragments
(`ml-1.5 text-ink-muted`, "0 min free"), `sr-only` text, and a script node.

So the flip was safe **because** the type migration is complete. The spec's
risk was written when it was not.

### The drift it surfaced

The banked figures no longer reproduce on current fixtures — Train ▸ Week
1.84 → 1.36, Fitness 1.00 → 1.48, Season 1.00 → 1.36. The drift runs in
**both** directions, which rules out a CSS cause. It is fixture data, and
`docs/2026-08-26-flow-inventory.md` gained a fifth dated section recording it.

**The roadmap's "4.7 → 1.84" was deliberately left alone.** Replacing it with
1.36 would swap one fixture-dependent number for another and imply the flow
strand regressed, which it did not.
