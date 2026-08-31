# Visual polish — slice 3a: the half of the type scale that was missing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the type scale line-heights, so a 44px hero stops being set at
body leading.

**Architecture:** Tailwind v4 pairs `--text-<name>--line-height` with
`--text-<name>` automatically and leaves `leading-*` able to override it
(verified: `.text-probe { font-size: 2.75rem; line-height: var(--tw-leading, 1) }`).
So this is seven token additions and no call-site changes.

**Tech Stack:** Tailwind v4 `@theme inline`, Vitest, Playwright.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md` — this
slice is new; the spec's "typographic rhythm is judged, not counted" line
anticipated it without knowing the cause.

**Branch:** `feat/finish-the-design-system`.

## Why this slice exists, and a correction it rests on

Slice 3 was going to migrate the last 17 stock-Tailwind type sizes. Measuring
first turned up that **the scale defines font sizes and no line-heights**:
`.text-sm` emits `font-size: 0.875rem; line-height: 1.25rem`, while
`.text-caption` emits the font-size alone.

**A wrong inference was drawn from that and is corrected here.** The initial
reading was that app text therefore rendered at the browser default (~1.2) and
would be "16% tighter". It does not. **Tailwind's preflight sets
`html { line-height: 1.5 }`**, so every unstyled element inherits 1.5 —
measured in a real browser at `text-label` 12/18, `text-caption` 14/21,
`text-body` 16/24, `text-title` 20/30, all ratio 1.50.

The real defect is the opposite end of the scale. Display type inherits body
leading:

| Step             | Size | Renders at | Should be near |
| ---------------- | ---- | ---------- | -------------- |
| `--text-hero`    | 44px | **66px**   | ~44px          |
| `--text-figure`  | 30px | **45px**   | ~33px          |
| `--text-heading` | 24px | **36px**   | ~30px          |
| `--text-title`   | 20px | **30px**   | ~27px          |

And it is already being worked around by hand: of 12 display-size call sites,
**10 set no leading at all and two set `leading-none`** — `today-hero.tsx` and
`bedtime-card.tsx`, two people independently patching the same missing token.

## Global Constraints

- **The text end of the scale does not move.** `label` (367 call sites),
  `caption` (203) and `body` (12) are pinned at their current 1.5. Writing
  them down explicitly is the point: a value that is only inherited from a
  framework reset is not a decision anyone made, and it silently changes if
  the reset does.
- **Only 28 call sites can move** — `title` 15, `heading` 7, `figure` 4,
  `hero` 2. That is what makes this reviewable rather than a full visual pass.
- `leading-*` at a call site still wins, so the two existing `leading-none`
  workarounds keep working and can be removed later on their own evidence.
- **Zero confirmed axe violations** stays the ceiling.

---

### Task 1: the line-height companions

**Files:**

- Modify: `src/app/globals.css`
- Modify: `tests/motion-scale-guard.test.ts`

- [x] **Step 1: Write the failing test**

```ts
describe("the type scale has line-heights", () => {
  it("every step pairs a size with a leading", () => {
    // The gap this pins: the scale shipped font sizes only, so every step
    // inherited Tailwind preflight's `html { line-height: 1.5 }`. That is
    // right for body and wrong for display — a 44px hero was set at 66px
    // leading, and two call sites had already hand-patched it with
    // `leading-none`.
    const sizes = Object.keys(readPrefixedThemeTokens(css(), "--text-")).filter(
      (t) => !t.endsWith("--line-height")
    );
    const missing = sizes.filter(
      (t) =>
        readPrefixedThemeTokens(css(), "--text-")[`${t}--line-height`] ===
        undefined
    );
    expect(
      missing,
      `these steps set a size with no leading, so they inherit whatever the ` +
        `framework reset happens to say. A scale that does not state its own ` +
        `leading is half a scale.`
    ).toEqual([]);
  });

  it("display steps are tighter than body steps", () => {
    // Not a taste assertion: leading that is right for a paragraph is
    // visibly loose on a 44px figure, which is the defect this slice fixes.
    const t = readPrefixedThemeTokens(css(), "--text-");
    const lh = (n: string) => Number(t[`--text-${n}--line-height`]);
    expect(lh("body")).toBeGreaterThan(lh("title"));
    expect(lh("title")).toBeGreaterThan(lh("heading"));
    expect(lh("heading")).toBeGreaterThan(lh("figure"));
    expect(lh("figure")).toBeGreaterThan(lh("hero"));
  });
});
```

- [x] **Step 2: Run it and watch both fail**

Run: `npx vitest run tests/motion-scale-guard.test.ts -t "line-heights"`
Expected: FAIL listing all seven steps as missing.

- [x] **Step 3: Add the companions**

In `src/app/globals.css`, beside each step:

```css
/* Line-heights. Tailwind pairs `--text-<name>--line-height` with
     `--text-<name>` automatically, and `leading-*` at a call site still wins.

     THE TEXT END IS PINNED AT ITS CURRENT VALUE, NOT RETUNED. label, caption
     and body render at 1.5 today — inherited from Tailwind preflight's
     `html { line-height: 1.5 }`, not from any decision. Writing 1.5 down
     changes no pixel on 582 call sites and stops the value moving if the
     framework reset ever does.

     THE DISPLAY END IS THE DEFECT. A 44px hero at 1.5 is 66px of leading;
     `today-hero.tsx` and `bedtime-card.tsx` had each already patched their own
     figure with `leading-none`, which is two people working around a missing
     token rather than a coincidence. */
--text-label--line-height: 1.5; /* pinned, unchanged */
--text-caption--line-height: 1.5; /* pinned, unchanged */
--text-body--line-height: 1.5; /* pinned, unchanged */
--text-title--line-height: 1.35;
--text-heading--line-height: 1.25;
--text-figure--line-height: 1.1;
--text-hero--line-height: 1;
```

- [x] **Step 4: Run the tests**

```bash
npx prettier --write src/app/globals.css
npx vitest run tests/motion-scale-guard.test.ts
```

Expected: PASS.

- [x] **Step 5: Prove the text end did not move, at the compiler**

The claim "582 call sites are unaffected" is checkable without a browser:

```bash
node --input-type=module -e '
import postcss from "postcss"; import tw from "@tailwindcss/postcss"; import { readFileSync } from "node:fs";
const out = await postcss([tw()]).process(readFileSync("src/app/globals.css","utf8"), { from: "src/app/globals.css" });
for (const c of ["text-label","text-caption","text-body","text-title","text-heading","text-figure","text-hero"]) {
  const i = out.css.indexOf("." + c + " {");
  console.log(i < 0 ? c + ": NOT EMITTED" : out.css.slice(i, out.css.indexOf("}", i) + 1).replace(/\s+/g, " "));
}'
```

Expected: label/caption/body carry `line-height: var(--tw-leading, 1.5)` —
the same 1.5 they inherited — and the four display steps carry their new,
smaller values.

- [x] **Step 6: Commit**

---

### Task 2: prove it in a browser, and look at it

- [x] **Step 1: Measure the rendered leading, before and after**

With the dev server up, read computed `fontSize`/`lineHeight` for one element
of each step. Expected: label 12/18, caption 14/21, body 16/24 **unchanged**;
title 20/27, heading 24/30, figure 30/33, hero 44/44.

- [x] **Step 2: Capture**

```bash
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice3a
```

Expected: 0 confirmed axe violations. Surfaces that will legitimately change
are the ones carrying display type: `today` (the hero figure), `settings`,
`admin`, `import`, `activity-log`, `train-season`, `body-labs`.

**Do not compare against a set captured on a different day** — Today, Train,
Body and several others render date-dependent content, and the previous runs
straddle a midnight boundary. Capture a fresh baseline in the same session if
a diff is wanted.

- [x] **Step 3: Open the display surfaces specifically**

`today` is the one that matters: its figure is the largest type in the app and
already carries `leading-none`, so it should be **unchanged** — if it moved,
the `leading-*` override is not winning and the whole approach is wrong.

- [x] **Step 4: Tick and commit**

## What this slice deliberately does not do

- **It does not remove the two `leading-none` workarounds.** They still win,
  and whether the tokens make them redundant is a judgement for the sweep,
  with captures in hand.
- **It does not retune label/caption/body.** Those 582 call sites are the
  whole app's text; moving them is a separate decision with its own evidence.
- **It does not migrate the 17 stock type sizes.** That is slice 3b, and it
  is safe to do only once the scale carries leading — otherwise five shared
  primitives would lose theirs.

## Next

`docs/plans/2026-08-31-polish-slice3b-primitives.md` — the 17 stock sizes,
five shared primitives first.

---

## Outcome — run 2026-08-31, both tasks complete

Suite **3333 passed / 1 expected fail / 1 skipped**; `tsc` and `eslint` clean.
Capture: **100 PNGs, 0 confirmed axe violations**, 128 entries / 89
indeterminate / 28 errors — identical to every prior slice.

**The compiler agrees with the design:**

| step                   | leading before | after         |
| ---------------------- | -------------- | ------------- |
| label / caption / body | 18 / 21 / 24px | **unchanged** |
| title                  | 30px           | 27px          |
| heading                | 36px           | 30px          |
| figure                 | 45px           | 33px          |
| hero                   | 66px           | **44px**      |

**The falsifier passed.** Today's figure carries `leading-none` and measures
30/30 after the change, so a call-site override still wins. Had it moved, the
whole approach would have been wrong.

**Both captures were taken the same day**, so the diff is readable for once.
90 of 100 images changed and the pattern is exactly the intended one: pages
carrying display type got **shorter** by small amounts — `login` −44px (the
44px hero), `admin` −12px, `body-journal` −16px, `import` −12px, `train`
−18px — while `settings*` grew by the established API-token accumulation.

Opened `login` before and after: the wordmark's 66px leading had been pushing
its subtitle away from it, and at 44px the two read as one unit. This is the
change the two hand-written `leading-none` workarounds were reaching for.

### The codebase defended itself, and that was right

Adding the companions took `tests/type-scale-guard.test.ts` down **entirely**:
`readScaleTokens` fails loudly on any `--text-*` it cannot resolve to pixels,
and `--text-label--line-height: 1.5` is a unitless ratio. It was narrowed by
NAME rather than by tolerating a parse failure, so a real size token in an
unreadable unit still throws, and the comment records what still covers the
companions.

**The failure mode is worth remembering.** The suite reported "3324 passed, 1
skipped" with the expected-fail line simply _gone_ — a whole guard file had
stopped loading, and the headline count went UP because that file's own
failing-by-design test vanished with it. A green-looking number is not a green
suite; read the shape of the result, not just the total.
