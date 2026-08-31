# Visual polish — slice 3b: the last stock type sizes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the stock-Tailwind type sizes from 17 to 0, so the type scale is
the only type scale in the app.

**Architecture:** A rename, plus a leading change of at most 2px. Every
font-size maps exactly; the deltas come from Tailwind pairing tighter leading
at small sizes than the app's 1.5.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md`

**Depends on:** `docs/plans/2026-08-31-polish-slice3a-line-heights.md`. Doing
this first would have stripped the leading from five shared primitives.

**Branch:** `feat/finish-the-design-system`.

## The complete mapping, measured at the compiler

| From | To | Size | Leading | Delta |
| --- | --- | --- | --- | --- |
| `text-xs` | `text-label` | 12px, same | 16 → 18px | **+2px** |
| `text-sm` | `text-caption` | 14px, same | 20 → 21px | **+1px** |
| `text-base` | `text-body` | 16px, same | 24 → 24px | **0** |
| `text-xl` | `text-title` | 20px, same | 28 → 27px | **−1px** |

No font size moves. The leading deltas are the app's 1.5 asserting itself over
Tailwind's tighter pairing at small sizes — the same 1.5 that 582 existing
call sites already use, so this makes the primitives agree with the app rather
than the framework.

## Where the leading delta can and cannot matter

**It cannot move layout in three of the five primitives.** `button`
(`h-6`/`h-7`/`h-8`/`h-9`), `badge` (`h-5`) and `input` (`h-6`/`h-8`) all set a
fixed height and centre their text in it. Leading changes nothing there —
worth stating because those three are the highest-traffic components in the
app and the instinct is to fear them most.

**It can matter in `card`, `label` and `connector-card`**, whose text flows.
`card.tsx`'s root `text-sm` is inherited by any card content that does not set
its own size, so that is the one to watch in captures.

## The 17 call sites

| File | Line | Now | Becomes |
| --- | --- | --- | --- |
| `ui/button.tsx` | 8 | `text-sm` | `text-caption` |
| `ui/button.tsx` | 26 | `text-xs` | `text-label` |
| `ui/badge.tsx` | 8 | `text-xs` | `text-label` |
| `ui/label.tsx` | 12 | `text-sm` | `text-caption` |
| `ui/input.tsx` | 12 | `text-base` … `md:text-sm` | `text-body` … `md:text-caption` |
| `ui/input.tsx` | 12 | `file:text-sm` | `file:text-caption` |
| `ui/card.tsx` | 15 | `text-sm` | `text-caption` |
| `ui/card.tsx` | 41 | `text-base` + `group-data-[size=sm]/card:text-sm` | `text-body` + `group-data-[size=sm]/card:text-caption` |
| `ui/card.tsx` | 53 | `text-sm` | `text-caption` |
| `settings/connector-card.tsx` | 23 | `text-sm` | `text-caption` |
| `settings/connector-card.tsx` | 24 | `text-xl` | `text-title` |
| `settings/connector-card.tsx` | 26, 30 | `text-base` | `text-body` |
| `app/join/[code]/page.tsx` | 21 | `text-xl` | `text-title` |
| `app/join/[code]/join-form.tsx` | 40 | `text-xl` | `text-title` |

`input.tsx`'s `md:text-sm` is a deliberate responsive pair — 16px on mobile so
iOS does not zoom the viewport on focus, 14px from `md` up. **Both halves must
migrate together**; migrating only the base would silently drop the desktop
size.

## Global Constraints

- **No font size changes.** If a capture shows text at a different size, the
  mapping was applied wrong.
- **`join/[code]` is pre-auth**, which the spec assigns to slice 5. Its two
  sizes are included here anyway because they are the same mechanical rename
  and leaving two behind would keep the ratchet off zero for a slice that is
  otherwise about surfaces, not type.
- **Zero confirmed axe violations** stays the ceiling.

---

### Task 1: drive the count to zero

**Files:** the 8 files above, plus `tests/type-scale-guard.test.ts`.

- [ ] **Step 1: Pin the target first**

`tests/type-scale-guard.test.ts` has no counted family for stock sizes — its
`ARBITRARY_TYPE` scan covers `text-[…]` arbitrary values, not Tailwind's own
keys. Add one to `tests/motion-scale-guard.test.ts` beside the others:

```ts
describe("the type scale is the only type scale", () => {
  /** Tailwind's own size keys, which the semantic scale replaced. */
  const STOCK_TYPE = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/g;

  it("no call site uses a stock Tailwind type size", () => {
    // Not a style preference: two scales in one app means two answers to
    // "how big is small text", and the semantic one is the one the 12px
    // floor and the contrast guard actually check.
    expect(srcOffenders(STOCK_TYPE)).toEqual([]);
  });
});
```

Run it. Expected: FAIL listing 17 `file:line` entries. If the count is not 17,
re-measure and correct this plan's table rather than the test.

- [ ] **Step 2: Apply the mapping**

One file at a time, re-running the new test after each so the list shrinks
visibly. Do `ui/input.tsx` deliberately by hand — it is the only file where a
naive `text-sm` → `text-caption` would also rewrite `file:text-sm` and
`md:text-sm`, which is correct here but must be *seen* to be correct.

- [ ] **Step 3: Confirm no font size moved**

```bash
node --input-type=module -e '
import postcss from "postcss"; import tw from "@tailwindcss/postcss"; import { readFileSync } from "node:fs";
const out = await postcss([tw()]).process(readFileSync("src/app/globals.css","utf8"), { from: "src/app/globals.css" });
for (const [a, b] of [["text-xs","text-label"],["text-sm","text-caption"],["text-base","text-body"],["text-xl","text-title"]]) {
  const get = (c) => { const i = out.css.indexOf("." + c + " {"); return i < 0 ? null : out.css.slice(i, out.css.indexOf("}", i) + 1); };
  const fs = (r) => r && /font-size:\s*([^;]+);/.exec(r)?.[1].trim();
  console.log(a + " " + fs(get(a)) + "  ->  " + b + " " + fs(get(b)));
}'
```
Expected: each pair reports the same computed size (`var(--text-xs)` resolves
to 0.75rem, `text-label` is 0.75rem, and so on).

- [ ] **Step 4: Suite, types, lint**

Expect component tests that assert on class strings to fail — several read
`text-sm` directly. Each is a finding: update it to the new class, and check
while you are there that the assertion was about the size rather than about
Tailwind specifically.

- [ ] **Step 5: Commit**

---

### Task 2: prove it

- [ ] **Step 1: Capture**

```bash
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice3b
```
Expected: 0 confirmed axe violations.

- [ ] **Step 2: Open the card-bearing surfaces**

`settings`, `settings-expanded` and `admin` are the densest card stacks and
carry `card.tsx`'s inherited `text-caption`. A +1px leading per line
accumulates down a long card list; that is the change to look at, and the one
place this slice could plausibly need a second opinion.

Buttons, badges and inputs need no special attention: their heights are fixed
and their text is centred, so the delta cannot reach the layout.

- [ ] **Step 3: Tick and commit**

## What this slice completes

With the count at zero, `type-scale-guard.test.ts`'s surviving `it.fails` is
the only thing left standing between the strand and a prescriptive
`design-system.md`. The remaining arbitrary size is
`inline-markdown.tsx`'s `text-[0.95em]`, which the spec records as an optical
correction to be inventoried rather than removed — slice 7's job.
