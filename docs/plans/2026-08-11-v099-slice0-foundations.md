# v0.99.0 Slice 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the design foundations every later slice is verified against —
two complete token sets, a type and spacing scale, `next-themes` wiring, the
two pinch-zoom fixes, and three build-failing guards — with no athlete-visible
change.

**Architecture:** Tokens live in `src/app/globals.css` as the single source of
truth; `:root` carries light, `.dark` carries dark, and the existing
`@custom-variant dark (&:is(.dark *))` at line 5 already routes Tailwind's
`dark:` variant to that class. A pure contrast module (`src/lib/design/`)
implements WCAG relative luminance so the guard can assert against the shipped
CSS rather than a copy of it. The app stays visually identical throughout this
slice: `ThemeProvider` runs with `forcedTheme="dark"` until slice 9 lifts it,
so light mode can be screenshotted and guarded without ever being reachable by
the athlete while surfaces are half-migrated.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4
(`@theme` tokens), `next-themes@^0.4.6` (already a dependency, currently
unused), Vitest 4, and `axe-core` driven through Playwright's cached
`chrome-headless-shell` — **not** `vitest-axe`, for the reason in Task 7.

## Global Constraints

Copied verbatim from `docs/specs/2026-08-11-2b4-visual-redesign-design.md`:

- **Presentation may change, claims may not.** No new figure, and no existing
  figure claiming more than 2a can source.
- **No IA change.** Nav stays Today/Train/Coach/Body/Menu; every route keeps its
  URL; no route is retired.
- **CORRECTED, T1 (whole-branch review 2026-08-11). This constraint used to
  read "No athlete-visible _visual_ change in this slice", with two named
  exceptions. That sentence was false, and it was never tested against `main`
  until C5 tested it.** Slice 0 changes what the athlete sees in dark mode, in
  **15 token values**, and only 1 of the 15 was disclosed. The truthful
  constraint is below, and it is deliberately phrased so a reader can check it
  rather than trust it.

  **What the constraint actually is:**

  1. **No IA change, no layout change, no surface rebuilt.** Nav, routes and
     component structure are untouched; migrating a surface's utilities to
     tokens is slices 1-8's job, not this one's.
  2. **Dark mode changes in exactly the 15 token values in the table below,
     plus the one non-token exception recorded as the fifth exception below
     (`.nav-active-dot`), and nowhere else.** Light mode is unreachable to the
     athlete while `forcedTheme="dark"` holds.

     **CORRECTED, final pass on `v0.99-the-app-you-can-read` (2026-08-12), closing
     what the rendered pass left open.** "Nowhere else" was wrong by one item:
     `.nav-active-dot` (`globals.css:389`) moves its background and 12px glow
     from the bare keyword `white` to `var(--ink-primary)`,
     `#ffffff → #f5f5f5`, and that **renders** — confirmed on five phone
     surfaces (`docs/v0.99-slice0-main-diff-verification.md` §6.4). It is not
     a token — no `rgba()` spelling, no hex — so the arithmetic that produced
     the 15 could not see it. The prior draft of this paragraph left the
     decision of whether the list becomes 16 or the dot reverts open; it is
     now decided below, as the fifth exception: folded into disclosure, not
     reverted, since a source-code revert is out of scope for a documentation
     pass and there is nothing here to revert away from — the change moves the
     same direction as every other exception in this list.

     The two scope claims mentioned in the prior draft of this paragraph
     (`<Select>`/`<Textarea>`, and "every text field") were overstated in the
     _other_ direction — the exception sounded broader than it is. Both are
     now corrected in place below, in the table and in the second exception.

  3. **Every one of the 15 token values, plus the fifth exception below, either
     raises contrast or is below any plausible perceptual threshold. None
     lowers it.** That is the checkable claim, and the ratio column is how you
     check it.
  4. **One deliberate behavioural exception:** Task 4 restores pinch-zoom, a
     WCAG 1.4.4 fix that ships here because the plumbing it touches is here.

  **The measured table.** Derived by resolving every `var()` chain and
  compositing every translucent value over the page ground `#0a0a0a`, comparing
  `main`'s single `:root` block — which **is** its dark theme, since no `.dark`
  class exists there — against this branch's `.dark`. Re-derivable from
  `git show 2da5f83:src/app/globals.css` against `src/app/globals.css`; method
  and full working in `docs/dark-mode-delta-vs-main.md`. It is exact CSS
  arithmetic, not a rendering.

  | #     | Token                                                                                                                                        | `main` (composited)                 | branch                             | vs `#0a0a0a`    | Where it lands                                                                                       |
  | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
  | 1     | `--border`                                                                                                                                   | `rgba(255,255,255,.1)` → `#232323`  | `var(--hairline)` `#6b6b6b`        | **1.26 → 3.72** | **every bordered element**, via `@layer base { * { @apply border-border } }`                         |
  | 2     | `--input`                                                                                                                                    | `rgba(255,255,255,.1)` → `#232323`  | `var(--hairline)` `#6b6b6b`        | **1.26 → 3.72** | every `<Input>` border — **not** `<Select>`/`<Textarea>`; `src/components/ui/` has neither component |
  | 3     | `--sidebar-border`                                                                                                                           | `rgba(255,255,255,.06)` → `#191919` | `var(--hairline)` `#6b6b6b`        | **1.13 → 3.72** | sidebar dividers                                                                                     |
  | 4     | `--muted-foreground`                                                                                                                         | `rgba(255,255,255,.4)` → `#6c6c6c`  | `var(--ink-muted)` `#8a8a8a`       | **3.77 → 5.73** | 21 `text-muted-foreground` sites, plus every shadcn placeholder                                      |
  | 5     | `--viz-muted-ink`                                                                                                                            | `rgba(255,255,255,.3)` → `#545454`  | `var(--ink-muted)` `#8a8a8a`       | **2.61 → 5.73** | chart axis labels and muted chart text — **the one change that was disclosed**                       |
  | 6     | `--popover`                                                                                                                                  | `#141414`                           | `var(--surface-overlay)` `#1f1f1f` | ground, n/a     | popover and bottom-sheet grounds                                                                     |
  | 7     | `--muted`                                                                                                                                    | `rgba(255,255,255,.05)` → `#161616` | `#262626`                          | ground, n/a     | muted fills, `hover:bg-muted`                                                                        |
  | 8     | `--secondary`                                                                                                                                | `rgba(255,255,255,.08)` → `#1e1e1e` | `#262626`                          | ground, n/a     | secondary buttons                                                                                    |
  | 9     | `--sidebar-accent`                                                                                                                           | `rgba(255,255,255,.08)` → `#1e1e1e` | `#262626`                          | ground, n/a     | sidebar hover fill                                                                                   |
  | 10-15 | `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground` | `#fafafa`                           | `var(--ink-primary)` `#f5f5f5`     | 18.97 → 18.16   | all primary text — 2/255, below any plausible perceptual threshold                                   |

  Six further tokens changed **spelling only and render identically**, so they
  are not changes: `--background`, `--card`, `--primary`, `--ring`,
  `--sidebar-primary`, `--sidebar-ring`. Worth noticing that `--card`'s
  `rgba(255,255,255,.05)` over `#0a0a0a` composites to **exactly** `#161616`,
  the new `--surface-raised` — that was matched deliberately. Seven tokens are
  genuinely new names (`--surface-*`, `--ink-*`, `--hairline`) rather than
  changed values.

  **Why the list becomes truthful instead of the code reverting.** Every one of
  the 15 moves in the direction the release exists to move; nothing got worse.
  Two of them are the release succeeding, loudly:

  - **`--border` / `--input`, 1.26:1 → 3.72:1.** Against the page,
    `rgba(255,255,255,.1)` over `#0a0a0a` is **1.26:1** — WCAG 1.4.11 requires
    **3:1** for the boundary of a UI component, so the app's borders were
    failing that standard **everywhere**, on `main`, before this branch existed.
    They now clear it on every surface: 3.72:1 on `--surface-base`, 3.40:1 on
    `--surface-raised`, 3.09:1 on `--surface-overlay` — worst case still
    passing. Reverting to an invisible 1.26:1 to satisfy a sentence would put
    the sentence above the goal it was written to serve.
  - **`--muted-foreground`, 3.77:1 → 4.77:1 worst-case** (5.73:1 on the page,
    5.24:1 on a card). This is precisely the `.label-micro` fix applied across
    21 `text-muted-foreground` sites plus every placeholder in the app. Same
    defect, same fix, far larger surface — and while `.label-micro` got its own
    recorded exception, this did not.

  **What this table cannot see, so nothing here overclaims.** It is token
  arithmetic. It cannot see layout shifts; it cannot see `dark:bg-input/30`
  giving 10 `<Input>` usages in `src/components/settings/` a fill they never
  had (that is the second exception below, and I3's two sub-AA findings); it
  cannot see `color-scheme`'s effect on native controls (now disabled — see
  Task 5's `enableColorScheme` note); it cannot see bare-keyword (non-token)
  CSS values, which is how `.nav-active-dot` (the fifth exception below) went
  unnoticed by this method; and it cannot see browser or PWA chrome (see
  `layout.tsx`'s `themeColor` comment).

- **Second deliberate exception, found during Task 2 — COUNT AND FILE LIST
  CORRECTED by the whole-branch review (I3); SCOPE CORRECTED by the rendered
  pass (`docs/v0.99-slice0-main-diff-verification.md` §8, item 3) and by this
  pass.** Applying `.dark` for the first time makes previously-dead `dark:`
  utilities live, because nothing had ever applied that class. The number
  recorded here was **11**; measured, it is **14 distinct utilities, 21
  occurrences, across 4 files**
  (`grep -onE 'dark:[a-zA-Z0-9_/:\[\]().,%-]+' <non-test sources in src/>`).
  One of the four files, `ui/input.tsx`, **was not named at all** — and it is
  the one that matters most, because it carries the `dark:bg-input/30` that
  gives a grey fill to **10 `<Input>` usages across 5 files, all under
  `src/components/settings/`**, that they never had.

  **CORRECTED — this was previously claimed as "every text field in the app",
  which overstated it as much as the earlier count understated it.** Measured:
  **79 raw `<input>` elements across 24 files, plus 3 `<textarea>`s, are
  untouched** — the `/train` race fields compute an identical `bg`/`border` on
  both sides of the branch. An exception that overstates its reach is as
  untrue as one that understates it.

  | File                                          | Occ. | Distinct utilities                                                                                                                                                                                                                                                                  |
  | --------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `src/components/ui/button.tsx`                | 9    | `dark:border-input`, `dark:bg-input/30`, `dark:hover:bg-input/50`, `dark:hover:bg-muted/50`, `dark:bg-destructive/20`, `dark:hover:bg-destructive/30`, `dark:focus-visible:ring-destructive/40`, `dark:aria-invalid:border-destructive/50`, `dark:aria-invalid:ring-destructive/40` |
  | `src/components/ui/input.tsx`                 | 4    | `dark:bg-input/30`, `dark:disabled:bg-input/80`, `dark:aria-invalid:border-destructive/50`, `dark:aria-invalid:ring-destructive/40`                                                                                                                                                 |
  | `src/components/ui/badge.tsx`                 | 4    | `dark:hover:bg-muted/50`, `dark:bg-destructive/20`, `dark:focus-visible:ring-destructive/40`, `dark:aria-invalid:ring-destructive/40`                                                                                                                                               |
  | `src/components/settings/api-tokens-card.tsx` | 4    | `dark:bg-green-950`, `dark:border-green-800`, `dark:text-green-200`, `dark:bg-black`                                                                                                                                                                                                |

  **The condition attached to this exception — "looked at, not assumed
  benign" — was not met, and is now met for 6 of the 14.** Stated plainly
  rather than implied, because the earlier record said all of them were
  confirmed in Task 6/7 and `progress.md` simultaneously recorded "Destructive
  Button/Badge unreachable — no call sites".

  **Looked at (6).** Confirmed by opening
  `.screenshots/branch-A2/settings-token-created-dark-phone.png` and cropping
  it, not by the run having produced a file:
  `dark:bg-input/30` (both files — the Label and webhook URL fields render a
  clearly lighter pill than the bare `<select>` beside them),
  `dark:border-input` (the "Sign out everywhere else (11)" outline button now
  has a visible border and fill where `main`'s rgb(34) border measured 1.24:1
  against the page and was effectively invisible), and all four
  `api-tokens-card.tsx` utilities (the green success box and its black
  `<code>` block). Note this state is reachable **only** through
  `verify-surfaces.ts`'s `captureTokenCreated` — the plain `/settings` capture
  is the collapsed Menu, with no `<Input>` and no outline `Button` on screen
  at all, so the nine ordinary surface captures never saw any of these.

  **The strongest single justification for this exception, stated plainly
  rather than left implicit in a bullet about a green box changing colour.**
  On `main`, `api-tokens-card.tsx`'s success box carries `bg-green-50`/
  `bg-white` for light and `dark:bg-green-950`/`dark:bg-black` for dark — but
  `main` never applies `.dark`, so the box renders its **light** styles while
  the rest of the app is dark: token text `rgb(250,250,250)` on a
  `rgb(255,255,255)` `<code>` block, **1.02:1** by direct computation and
  **1.04:1** by axe — the sole `confirmed` node in `main`'s entire 20-capture
  axe baseline, reproduced on both viewports
  (`docs/v0.99-slice0-main-diff-verification.md` §6.3). The branch has **zero**
  confirmed axe nodes across all 20 dark captures. The box's own copy reads
  "Copy this token now — it won't be shown again", so on `main` there is
  nothing legible to copy and no second chance. Activating these four
  utilities — the only part of this exception that touches
  `api-tokens-card.tsx` — is what fixes an athlete-blocking WCAG failure that
  shipped on `main`, not merely a styling change.

  **NOT looked at (8), and why.** Five are pointer/keyboard/validation state
  variants that a static full-page capture cannot reach — there is no cursor,
  no focus ring and no invalid field in a `page.screenshot()`:
  `dark:hover:bg-input/50`, `dark:hover:bg-muted/50`,
  `dark:disabled:bg-input/80`, `dark:aria-invalid:border-destructive/50`,
  `dark:aria-invalid:ring-destructive/40`. Three belong to the `destructive`
  variant of `Button`/`Badge`, which **has zero call sites in `src/`**
  (`grep -rn 'variant="destructive"' src --include=*.tsx` is empty), so they
  cannot render at all: `dark:bg-destructive/20`,
  `dark:hover:bg-destructive/30`, `dark:focus-visible:ring-destructive/40`.

  **Measured instead of eyeballed, and it turned up two real sub-AA states**
  that no capture would have shown and that no guard here catches. Both are
  **recorded, out of scope, and belong to slice 5 (Settings/Menu)**, which is
  where `<Input>` migrates:

  - `dark:bg-input/30` composites `--input` `#6b6b6b` at 30% over `#0a0a0a` to
    **`#272727`**. The field's own `placeholder:text-muted-foreground`
    (`--ink-muted` `#8a8a8a`) on that ground is **4.33:1** — under the 4.5:1
    floor. It is still an improvement (`main`'s `--muted-foreground` rgb(108)
    over the then-unfilled field was **3.77:1**), and without the fill the same
    ink would be 5.73:1, so the fill is what costs the 1.4. This is invisible
    to `tests/contrast-guard.test.ts` by construction: a composited `--input`
    fill is not one of its three `--surface-*` grounds.
  - `sessions-card.tsx`'s live outline `Button` adds
    `className="text-destructive"`. `--destructive` `#ef4444` on that same
    `#272727` is **3.97:1**, and on hover — `dark:hover:bg-input/50` → `#3b3b3b`
    — **2.98:1**. Same blind spot, same slice.

- **Third deliberate exception, found during Task 6b.** Tokenising the 17
  hardcoded values in `globals.css` revealed two that were **sub-AA in dark
  too**: `.label-micro`'s text at ~3.8:1 and `--viz-muted-ink` at ~2.7:1. Both
  now resolve to `--ink-muted`, so **dark changes as well** — micro-labels and
  muted chart ink get lighter. This is the defect the release exists to fix
  rather than a regression, but it is a visible change and is recorded as one.
  Confirmed by pixel-diff: 6 of 20 dark captures differ, and only in those two.
- **Fourth deliberate exception, found by the whole-branch review (C2).** The
  inline-`style` blind spot hid a fourth sub-AA-in-dark value: the CTL/ATL/TSB
  context labels in `fitness-tiles.tsx` were painted `rgba(255,255,255,0.4)` =
  **3.77:1**, the identical value `.label-micro` was fixed from, written in
  **two** places (the component's fallback and `train/page.tsx`'s flat/negative
  CTL branch). Both now take `--ink-muted`, so **those three labels get
  lighter in dark**. Same character as the third exception: the defect the
  release exists to fix, but visible, so recorded. The guard that would have
  caught it is now in `tests/type-scale-guard.test.ts` (an AA floor on inline
  text colour) — before this, `src/components/` inline styles were governed by
  nothing at all.
- **Fifth deliberate exception, found by the rendered pass
  (`docs/v0.99-slice0-main-diff-verification.md` §6.4) and folded in here by
  this final pass rather than left as an open decision.** `.nav-active-dot`
  (`globals.css:389`, applied by `bottom-nav.tsx:43`) moves `background` and
  its 12px glow from the bare keyword `white` to `var(--ink-primary)`,
  `#ffffff → #f5f5f5` on a 4px dot. It is **not a token** — no `rgba()`
  spelling, no hex — which is why the CSS scan behind the 15-row table above
  and behind `docs/dark-mode-delta-vs-main.md` could not find it: that scan
  enumerated two `rgba()` spellings and the token hexes, not bare colour
  keywords. Confirmed rendered on **five phone surfaces** — today, train,
  coach, body and settings, since the dot follows the active route — cropped
  and looked at on all five; dot core measured at coach 254→243, train
  253→237, body 247→228, settings 245→234 (today: confirmed rendered in the
  same pass, not separately numbered there), each visibly very slightly
  dimmer, same size and position. 10/255 on a 4px dot is below any plausible
  perceptual threshold, and it moves the same direction as every other
  exception in this list — a white dot would be the less legible choice as
  surfaces migrate toward these tokens. **Decided: folded into disclosure, not
  reverted** — a source-code revert is out of scope for a documentation pass,
  and there is no defect here to revert away from.
- **Known, out of scope, recorded not fixed:** `.tag-active` hardcodes the dark
  accent `#10b981`, so it does not follow the theme. A real but separate and
  smaller bug; the contrast guard deliberately excludes `accent` from the
  ink/surface scan, so nothing catches it. Belongs to a later slice.
- **Type floor is 12px.** Nothing below 12px exists as a token.
- **Type scale:** `12 · 14 · 16 · 20 · 24 · 30 · 44`, plus a mono numeric variant.
- **Spacing scale:** `4 · 8 · 12 · 16 · 24 · 32 · 48`.
- **Ink is four steps:** `ink-primary`, `ink-secondary`, `ink-muted` (text
  floor), `hairline` (never text).
- **Every ink×surface pair legal for text clears 4.5:1 in both themes;**
  `hairline` clears 3.0:1 and is excluded from text roles.
- **Mutation-check anything guarding a bound** (`docs/RELEASING.md`): break the
  owner, confirm a test fails, restore.
- **Branch:** `v0.99-the-app-you-can-read`. Do not merge to main.
- **NEVER drive a browser or a script at `localhost:3000`.** On this machine
  port 3000 is the **live production container** (`recover-app-1`, fronted by
  cloudflared), not a dev server. An earlier draft of this plan said
  `localhost:3000` throughout Tasks 5-7; following it literally would have
  pointed screenshot and axe runs — which create real data, including API
  tokens — at production. Run the dev server on **3100**:
  ```bash
  BETTER_AUTH_URL=http://localhost:3100 TRUSTED_ORIGINS=http://localhost:3100 \
    npx next dev -p 3100
  ```
  Likewise the database: dev is **5435** and is what `.env` points at. **5434
  is live.** Something pointed a test run at production on 2026-07-27 and the
  cause was never found; do not add a second instance.

## Token values

The complete, computed system. Every ratio below is against the **worst-case**
surface for that token, and Task 2's guard re-derives all of them from the CSS.

| Token               | Light (`:root`) | Dark (`.dark`) |
| ------------------- | --------------- | -------------- |
| `--surface-base`    | `#f6f6f6`       | `#0a0a0a`      |
| `--surface-raised`  | `#ffffff`       | `#161616`      |
| `--surface-overlay` | `#ffffff`       | `#1f1f1f`      |
| `--ink-primary`     | `#171717`       | `#f5f5f5`      |
| `--ink-secondary`   | `#4a4a4a`       | `#b4b4b4`      |
| `--ink-muted`       | `#6e6e6e`       | `#8a8a8a`      |
| `--hairline`        | `#8a8a8a`       | `#6b6b6b`      |
| `--accent`          | `#047857`       | `#10b981`      |

Worst-case ratios (the values the guard asserts):

| Pair                                         | Light    | Dark |
| -------------------------------------------- | -------- | ---- |
| `ink-primary` on worst surface               | 16.6     | 15.1 |
| `ink-secondary` on worst surface             | 8.2      | 8.0  |
| `ink-muted` on worst surface                 | **4.72** | 4.77 |
| `accent` on worst surface                    | 5.1      | 6.5  |
| `hairline` on worst surface (non-text, ≥3.0) | 3.2      | 3.1  |

## File Structure

**Create:**

- `src/lib/design/contrast.ts` — pure WCAG math. No imports, no DOM. One
  responsibility: given two hex colours, return their contrast ratio.
- `src/lib/design/contrast.test.ts` — unit tests against published reference
  values.
- `src/lib/design/tokens.ts` — parses `globals.css` and returns the two token
  sets. Node-only (reads the file); used by the guard, never by the app.
- `tests/contrast-guard.test.ts` — the build-failing contrast assertion.
- `tests/type-scale-guard.test.ts` — the build-failing arbitrary-utility scan.
- `tests/viewport-zoom-guard.test.ts` — asserts neither pinch-zoom blocker
  returns.
- `src/components/theme-provider.tsx` — thin `next-themes` wrapper.
- `scripts/screenshot.ts` — headless Chromium capture, both themes.

**Modify:**

- `src/app/globals.css` — token sets, scales, the `touch-action` fix.
- `src/app/layout.tsx` — provider, viewport export, `themeColor`.

---

### Task 1: WCAG contrast math

A pure module with no dependencies, so the guard's arithmetic is testable
independently of any token values. Reference values come from the WCAG 2.2
definition of relative luminance and are checkable by hand.

**Files:**

- Create: `src/lib/design/contrast.ts`
- Test: `src/lib/design/contrast.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `hexToRgb(hex: string): [number, number, number]`,
  `relativeLuminance(hex: string): number`,
  `contrastRatio(a: string, b: string): number`. Task 2's guard imports all
  three.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/design/contrast.test.ts
import { describe, it, expect } from "vitest";
import { hexToRgb, relativeLuminance, contrastRatio } from "./contrast";

describe("hexToRgb", () => {
  it("parses six-digit hex", () => {
    expect(hexToRgb("#0a0a0a")).toEqual([10, 10, 10]);
    expect(hexToRgb("#FFFFFF")).toEqual([255, 255, 255]);
  });

  it("rejects anything that is not a six-digit hex", () => {
    expect(() => hexToRgb("rgba(255,255,255,0.4)")).toThrow();
    expect(() => hexToRgb("#fff")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white, in either order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio("#10b981", "#10b981")).toBeCloseTo(1, 5);
  });

  // Hand-checked reference: #767676 on #ffffff is the canonical WCAG AA
  // boundary colour for normal text.
  it("puts the canonical AA boundary grey at 4.54:1 on white", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/design/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "./contrast"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/design/contrast.ts
/**
 * WCAG 2.2 relative luminance and contrast ratio, for
 * tests/contrast-guard.test.ts (Phase 2b.4, v0.99.0).
 *
 * Deliberately hex-only: the guard must reject rgba() tokens rather than
 * guess what they composite to. A translucent value has no single ratio —
 * that ambiguity is exactly the defect this release removes.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): [number, number, number] {
  if (!HEX.test(hex)) {
    throw new Error(
      `contrast: expected a six-digit hex colour, got ${JSON.stringify(hex)}`
    );
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function channel(value8Bit: number): number {
  const c = value8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/design/contrast.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/contrast.ts src/lib/design/contrast.test.ts
git commit -m "feat(design): WCAG contrast math for the token guard"
```

---

### Task 2: Token sets and the contrast guard

The guard is written first and fails, because the tokens it asserts do not
exist yet. Then the tokens land and it passes. This is the order that proves
the guard binds.

**Files:**

- Create: `src/lib/design/tokens.ts`
- Create: `tests/contrast-guard.test.ts`
- Modify: `src/app/globals.css` (replace the `:root` block at lines 51-85)

**Interfaces:**

- Consumes: `contrastRatio` from Task 1.
- Produces: `readTokenSets(): { light: Record<string,string>; dark: Record<string,string> }`
  from `src/lib/design/tokens.ts`. Task 3 does not use it; slice 9's
  design-system doc generation will.

- [ ] **Step 1: Write the token reader**

```ts
// src/lib/design/tokens.ts
/**
 * Reads the design tokens out of the CSS that actually ships. The guard
 * asserts against this file rather than a duplicated table, so a token
 * changed in CSS cannot pass a test that was checking a copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CSS_PATH = join(process.cwd(), "src/app/globals.css");

/** Tokens the contrast guard governs. A token not listed here is not checked. */
export const GOVERNED = [
  "surface-base",
  "surface-raised",
  "surface-overlay",
  "ink-primary",
  "ink-secondary",
  "ink-muted",
  "hairline",
  "accent",
] as const;

export type GovernedToken = (typeof GOVERNED)[number];
export type TokenSet = Record<GovernedToken, string>;

function extractBlock(css: string, selector: string): string {
  // Matches `:root {` / `.dark {` at the start of a line, up to the first
  // closing brace in column 0 — the formatting Prettier enforces on this file.
  const re = new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)^\\}`, "m");
  const match = css.match(re);
  if (!match) throw new Error(`tokens: no "${selector}" block in globals.css`);
  return match[1];
}

function parse(block: string, selector: string): TokenSet {
  const out = {} as TokenSet;
  for (const token of GOVERNED) {
    const m = block.match(new RegExp(`--${token}:\\s*([^;]+);`));
    if (!m) throw new Error(`tokens: "${selector}" is missing --${token}`);
    out[token] = m[1].trim();
  }
  return out;
}

export function readTokenSets(): { light: TokenSet; dark: TokenSet } {
  const css = readFileSync(CSS_PATH, "utf8");
  return {
    light: parse(extractBlock(css, ":root"), ":root"),
    dark: parse(extractBlock(css, "\\.dark"), ".dark"),
  };
}
```

- [ ] **Step 2: Write the failing guard**

```ts
// tests/contrast-guard.test.ts — Phase 2b.4's first guardrail
// (docs/specs/2026-08-11-2b4-visual-redesign-design.md).
//
// The premise of v0.99.0 is that 134 ink usages measured between 2.6:1 and
// 3.8:1 — below the 4.5:1 AA floor — because nothing ever checked. This is
// the check. It reads the tokens out of the CSS that ships, so it cannot
// pass against a stale copy of the palette.
//
// WORST CASE, NOT BEST CASE: each ink is asserted against every surface it
// is allowed to appear on, so a token that only passes on the most flattering
// background fails here. The light `hairline` was #949494 in the approved
// design and measured 2.81:1 against surface-base; this guard is why it is
// #8a8a8a.
import { describe, it, expect } from "vitest";
import { contrastRatio } from "../src/lib/design/contrast";
import { readTokenSets, type TokenSet } from "../src/lib/design/tokens";

const SURFACES = ["surface-base", "surface-raised", "surface-overlay"] as const;

/** Inks legal on text, and the floor each must clear on every surface. */
const TEXT_INKS = [
  "ink-primary",
  "ink-secondary",
  "ink-muted",
  "accent",
] as const;
const TEXT_FLOOR = 4.5; // WCAG 2.2 SC 1.4.3, normal text

/** Non-text ink: dividers, borders, icon strokes. */
const NON_TEXT_FLOOR = 3.0; // WCAG 2.2 SC 1.4.11

describe("contrast guard", () => {
  const sets = readTokenSets();

  for (const [themeName, tokens] of Object.entries(sets) as [
    string,
    TokenSet,
  ][]) {
    describe(themeName, () => {
      for (const ink of TEXT_INKS) {
        for (const surface of SURFACES) {
          it(`${ink} on ${surface} clears ${TEXT_FLOOR}:1`, () => {
            const ratio = contrastRatio(tokens[ink], tokens[surface]);
            expect(
              ratio,
              `${themeName}: --${ink} (${tokens[ink]}) on --${surface} ` +
                `(${tokens[surface]}) is ${ratio.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(TEXT_FLOOR);
          });
        }
      }

      for (const surface of SURFACES) {
        it(`hairline on ${surface} clears ${NON_TEXT_FLOOR}:1`, () => {
          const ratio = contrastRatio(tokens["hairline"], tokens[surface]);
          expect(
            ratio,
            `${themeName}: --hairline (${tokens["hairline"]}) on ` +
              `--${surface} (${tokens[surface]}) is ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
        });
      }
    });
  }

  it("governs every ink and surface token the CSS declares", () => {
    // A new --ink-* or --surface-* added to globals.css but not to GOVERNED
    // would ship unchecked. This reads the CSS directly rather than comparing
    // two objects both built FROM GOVERNED — that comparison can never fail,
    // and a guard that cannot fail is the defect this release is about.
    const css = readFileSync(CSS_PATH, "utf8");
    const rootBlock = css.match(/^:root\s*\{([\s\S]*?)^\}/m)![1];
    const declared = [
      ...rootBlock.matchAll(/--((?:ink|surface)-[a-z]+|hairline|accent):/g),
    ].map((m) => m[1]);
    const ungoverned = declared.filter(
      (t) => !(GOVERNED as readonly string[]).includes(t)
    );
    expect(
      ungoverned,
      "add these to GOVERNED in src/lib/design/tokens.ts or they ship unchecked"
    ).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the guard to verify it fails**

Run: `npx vitest run tests/contrast-guard.test.ts`
Expected: FAIL — `tokens: no ".dark" block in globals.css`.

- [ ] **Step 4: Replace the palette in globals.css**

Replace lines 51-85 (the block commented `Dark-first: the only theme`) with:

```css
/* ── Two themes. :root is light; .dark is dark. ───────────────────────────
   Governed by tests/contrast-guard.test.ts — every ink×surface pair here is
   asserted against its worst-case surface in both themes. Do not add an
   --ink-* or --surface-* token without adding it to GOVERNED in
   src/lib/design/tokens.ts, or it ships unchecked. */
:root {
  --surface-base: #f6f6f6;
  --surface-raised: #ffffff;
  --surface-overlay: #ffffff;
  --ink-primary: #171717;
  --ink-secondary: #4a4a4a;
  --ink-muted: #6e6e6e;
  --hairline: #8a8a8a;
  --accent: #047857;

  --background: var(--surface-base);
  --foreground: var(--ink-primary);
  --card: var(--surface-raised);
  --card-foreground: var(--ink-primary);
  --popover: var(--surface-overlay);
  --popover-foreground: var(--ink-primary);
  --primary: var(--accent);
  --primary-foreground: #ffffff;
  --secondary: #ececec;
  --secondary-foreground: var(--ink-primary);
  --muted: #ececec;
  --muted-foreground: var(--ink-muted);
  --accent-foreground: #ffffff;
  --destructive: #b91c1c;
  --border: var(--hairline);
  --input: var(--hairline);
  --ring: var(--accent);
  --chart-1: #2563eb;
  --chart-2: #047857;
  --chart-3: #b45309;
  --chart-4: #6d28d9;
  --chart-5: #b91c1c;
  --radius: 1rem;
  --sidebar: var(--surface-raised);
  --sidebar-foreground: var(--ink-primary);
  --sidebar-primary: var(--accent);
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #ececec;
  --sidebar-accent-foreground: var(--ink-primary);
  --sidebar-border: var(--hairline);
  --sidebar-ring: var(--accent);
}

.dark {
  --surface-base: #0a0a0a;
  --surface-raised: #161616;
  --surface-overlay: #1f1f1f;
  --ink-primary: #f5f5f5;
  --ink-secondary: #b4b4b4;
  --ink-muted: #8a8a8a;
  --hairline: #6b6b6b;
  --accent: #10b981;

  --background: var(--surface-base);
  --foreground: var(--ink-primary);
  --card: var(--surface-raised);
  --card-foreground: var(--ink-primary);
  --popover: var(--surface-overlay);
  --popover-foreground: var(--ink-primary);
  --primary: var(--accent);
  --primary-foreground: #000000;
  --secondary: #262626;
  --secondary-foreground: var(--ink-primary);
  --muted: #262626;
  --muted-foreground: var(--ink-muted);
  --accent-foreground: #000000;
  --destructive: #ef4444;
  --border: var(--hairline);
  --input: var(--hairline);
  --ring: var(--accent);
  --chart-1: #3b82f6;
  --chart-2: #10b981;
  --chart-3: #f59e0b;
  --chart-4: #8b5cf6;
  --chart-5: #ef4444;
  --radius: 1rem;
  --sidebar: #121212;
  --sidebar-foreground: var(--ink-primary);
  --sidebar-primary: var(--accent);
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #262626;
  --sidebar-accent-foreground: var(--ink-primary);
  --sidebar-border: var(--hairline);
  --sidebar-ring: var(--accent);
}
```

Then extend the `@theme inline` block (after line 41) so the new tokens
become utilities:

```css
--color-surface-base: var(--surface-base);
--color-surface-raised: var(--surface-raised);
--color-surface-overlay: var(--surface-overlay);
--color-ink-primary: var(--ink-primary);
--color-ink-secondary: var(--ink-secondary);
--color-ink-muted: var(--ink-muted);
--color-hairline: var(--hairline);
--color-accent: var(--accent);
```

- [ ] **Step 5: Run the guard to verify it passes**

Run: `npx vitest run tests/contrast-guard.test.ts`
Expected: PASS — 27 tests (2 themes × [4 inks × 3 surfaces + 3 hairline] + 1).

- [ ] **Step 6: Mutation-check the guard**

Required by `docs/RELEASING.md` for anything guarding a bound.

```bash
# Break it: restore the light hairline that fails its floor.
sed -i 's/  --hairline: #8a8a8a;/  --hairline: #949494;/' src/app/globals.css
npx vitest run tests/contrast-guard.test.ts
```

Expected: FAIL on exactly
`light: --hairline (#949494) on --surface-base (#f6f6f6) is 2.81:1`.

```bash
git checkout src/app/globals.css   # discard ONLY if nothing else is unstaged
```

If other edits are unstaged, revert the one line by hand instead. Re-run and
confirm PASS before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/design/tokens.ts tests/contrast-guard.test.ts src/app/globals.css
git commit -m "feat(design): two token sets, guarded by measured contrast

:root is light, .dark is dark. Every ink is asserted against its worst-case
surface in both themes, read from the CSS that ships rather than a copy.
Mutation-checked: the design's original #949494 light hairline fails at
2.81:1, which is how the value in the spec got corrected."
```

---

### Task 3: Type and spacing scales, and the guard that keeps them

**Files:**

- Create: `tests/type-scale-guard.test.ts`
- Modify: `src/app/globals.css` (`@theme inline` block; `body` font-size)

**Interfaces:**

- Consumes: nothing.
- Produces: the utilities `text-label text-caption text-body text-title
text-heading text-figure text-hero` and `font-numeric`. Every later slice uses
  these names. **Corrected from the original `text-2xs … text-3xl` naming**:
  those collide with Tailwind v4's own default `--text-*` theme keys and would
  silently resize ~230 existing call sites across unmigrated surfaces. See the
  semantic names below.

- [ ] **Step 1: Write the failing guard**

```ts
// tests/type-scale-guard.test.ts — Phase 2b.4's second guardrail.
//
// v0.99.0's premise: 300 hardcoded pixel sizes over 16 distinct values, 239
// of them 11px or smaller, and 8 ad-hoc ink alphas of which three fail AA.
//
// WHY A SOURCE SCAN IS SOUND HERE, unlike the source-parsing guard v0.39
// deleted: Tailwind v4 only compiles classes that appear as literal strings
// in source. An arbitrary `text-[9px]` that is not a literal never renders.
// So anything that can reach the screen is findable by scanning, and the
// scan cannot be defeated by a class assembled at runtime — such a class
// produces no CSS either.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/** Arbitrary type sizes: text-[10px], text-[0.75rem]. */
const ARBITRARY_TYPE = /\btext-\[[^\]]*(?:px|rem|em)\]/g;
/**
 * Ad-hoc ink: text-white/40, bg-white/5, border-white/10, ring-white/50,
 * divide-white/5, and Tailwind's bracket arbitrary-opacity syntax —
 * bg-white/[0.06]. Both opacity syntaxes and both the ring/divide prefixes
 * are live in src/ today (138 bracket-syntax and 8 ring/divide occurrences
 * as of v0.99.0) — a pattern that misses either would let real offenders
 * through undetected. An earlier draft of this guard matched only
 * `\/\d+` with no ring/divide, which silently exempted ~17% of the
 * offender surface; that is the defect this shape exists to avoid.
 */
const ADHOC_INK =
  /\b(?:text|bg|border|fill|stroke|ring|divide)-(?:white|black)\/(?:\d+|\[[^\]]+\])/g;
/** hairline is a non-text token; using it as text colour is the one misuse. */
const HAIRLINE_AS_TEXT = /\btext-hairline\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full))
      out.push(full);
  }
  return out;
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n").entries()) {
      const [i, content] = line;
      const matches = content.match(new RegExp(pattern.source, "g"));
      if (matches) {
        found.push(
          `${relative(process.cwd(), file)}:${i + 1} — ${matches.join(", ")}`
        );
      }
    }
  }
  return found;
}

describe("type-scale guard", () => {
  it("has no arbitrary type sizes — use the scale", () => {
    expect(offenders(ARBITRARY_TYPE), "use text-label … text-hero").toEqual([]);
  });

  it("has no ad-hoc white/black alpha utilities — use the tokens", () => {
    expect(
      offenders(ADHOC_INK),
      "use ink-primary / ink-secondary / ink-muted / hairline / surface-*"
    ).toEqual([]);
  });

  it("never uses hairline as a text colour", () => {
    expect(
      offenders(HAIRLINE_AS_TEXT),
      "hairline is 3.0:1 — legal for dividers and strokes, never for text"
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `npx vitest run tests/type-scale-guard.test.ts`
Expected: FAIL — three failures listing hundreds of offenders (~300 arbitrary
type, ~250 ad-hoc ink). **This is the correct state at the end of slice 0.**
The offenders are removed surface by surface in slices 1-8.

- [ ] **Step 3: Add the scales to globals.css**

Append inside the existing `@theme inline` block:

```css
/* Type scale — 12px floor, seven steps. Phase 2b.4. Semantic names, not
   Tailwind v4's default --text-* keys (xs/sm/base/xl/3xl/…): those keys are
   Tailwind's own built-in theme values, and defining them here would
   silently override every unmigrated call site still using the default
   scale — exactly the cross-surface change this slice is not allowed to
   make. */
--text-label: 0.75rem; /* 12 — the floor. Nothing smaller exists. */
--text-caption: 0.875rem; /* 14 */
--text-body: 1rem; /* 16 — body */
--text-title: 1.25rem; /* 20 */
--text-heading: 1.5rem; /* 24 */
--text-figure: 1.875rem; /* 30 */
--text-hero: 2.75rem; /* 44 — the primary figure */

/* Spacing scale — 4px base. */
--spacing-1: 0.25rem;
--spacing-2: 0.5rem;
--spacing-3: 0.75rem;
--spacing-4: 1rem;
--spacing-6: 1.5rem;
--spacing-8: 2rem;
--spacing-12: 3rem;
```

`body`'s `font-size` **stays at `15px`.** Sitting it on `--text-body` (1rem /
16px) is deferred to slice 9, when the last surface migrates — doing it here
would be a one-pixel, app-wide visible change, which this foundations-only
slice is not permitted to make. Leave a comment on the rule saying so.

- [ ] **Step 4: Mark the guard as expected-failing until slice 9**

The first two assertions (arbitrary type sizes, ad-hoc ink alphas) cannot
pass until every surface is migrated. Add `.fails` semantics explicitly
rather than skipping, so the guard is visibly pending rather than silently
absent — replace each of those two `it(` with:

```ts
  // TODO(slice-9): flip to `it(` once the last surface is migrated. Tracked
  // in docs/plans/2026-08-11-v099-slice0-foundations.md. Do NOT delete these
  // — a skipped guard that is deleted is a guard that never lands.
  it.fails("has no arbitrary type sizes — use the scale", () => {
```

The third assertion (`hairline` never used as text) has zero offenders today,
so it stays a real `it(...)` rather than `it.fails` — an `it.fails` that
unexpectedly passes is the signal to flip it, and this is that flip done at
implementation time. A fourth, real `it(...)` also pins that `walk()` scanned
a plausible source tree (non-empty, above a sane floor), so a crash before
measuring can't be mistaken for a clean expected-failure.

- [ ] **Step 5: Run the guard to verify it now passes as expected-failing**

Run: `npx vitest run tests/type-scale-guard.test.ts`
Expected: PASS — 4 tests: 2 expected failures (arbitrary type, ad-hoc ink) and
2 real, currently-passing assertions (hairline-as-text, walk sanity). If
either `it.fails` _passes_ unexpectedly, that turns into a test failure, which
is the signal that a surface finished early and it should be flipped to
`it(`.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css tests/type-scale-guard.test.ts
git commit -m "feat(design): type and spacing scales, with the guard that keeps them

The guard is sound rather than best-effort: Tailwind v4 only compiles classes
that appear literally in source, so a class it cannot see renders nothing.
Marked it.fails until slice 9 — the ~300 offenders are removed surface by
surface, and an unexpected pass is the signal to flip it."
```

---

### Task 4: Restore pinch-zoom

Two blockers, in two files. Fixing one and stopping is the failure mode this
task exists to prevent.

**Files:**

- Modify: `src/app/layout.tsx:28-34` (the `viewport` export)
- Modify: `src/app/globals.css:98-101` (`html { touch-action }`)
- Create: `tests/viewport-zoom-guard.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing guard**

```ts
// tests/viewport-zoom-guard.test.ts — WCAG 2.2 SC 1.4.4 (Resize Text).
//
// The app disabled pinch-zoom in TWO places, and a fix that only removes one
// leaves zoom broken while looking finished:
//   1. layout.tsx's viewport export — maximumScale: 1, userScalable: false
//   2. globals.css — html { touch-action: pan-x pan-y }
// On a release whose whole premise is that 239 type usages are 11px or
// smaller, preventing magnification is the sharpest possible contradiction.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("pinch-zoom is not blocked", () => {
  it("the viewport export does not cap the scale", () => {
    expect(layout).not.toMatch(/maximumScale/);
  });

  it("the viewport export does not disable user scaling", () => {
    expect(layout).not.toMatch(/userScalable/);
  });

  it("html does not restrict touch-action to pan gestures", () => {
    const htmlRule = css.match(/\bhtml\s*\{([\s\S]*?)\}/);
    expect(htmlRule, "no html rule found in globals.css").not.toBeNull();
    expect(htmlRule![1]).not.toMatch(/touch-action\s*:\s*pan/);
  });
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `npx vitest run tests/viewport-zoom-guard.test.ts`
Expected: FAIL — all three.

- [ ] **Step 3: Remove both blockers**

In `src/app/layout.tsx`, the `viewport` export becomes:

```ts
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};
```

In `src/app/globals.css`, the `html` rule inside `@layer base` becomes:

```css
html {
  @apply font-sans;
}
```

- [ ] **Step 4: Run the guard to verify it passes**

Run: `npx vitest run tests/viewport-zoom-guard.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Check nothing depended on the pan-only touch-action**

The app has a custom pull-to-refresh (`src/components/pwa/`, used by
`src/app/page.tsx`). Run the suite to confirm nothing asserted the old rule:

Run: `npm test -- pull-to-refresh`
Expected: PASS, or "No test files found" — either is fine; note which.

Pull-to-refresh behaviour under a real finger is a **screenshot/manual check in
Task 7**, not something this step can prove.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css tests/viewport-zoom-guard.test.ts
git commit -m "fix(a11y): restore pinch-zoom, blocked in two places since v0.1

WCAG 1.4.4. The viewport export capped the scale and globals.css restricted
html to pan gestures; removing either alone leaves zoom broken. themeColor
becomes per-theme in the same edit."
```

---

### Task 5: next-themes, forced to dark

**Files:**

- Create: `src/components/theme-provider.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: `<ThemeProvider>` wrapping the app. Slice 5 adds the Menu control
  that calls `useTheme()`; slice 9 removes `forcedTheme`.

- [ ] **Step 1: Write the provider**

```tsx
// src/components/theme-provider.tsx
"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/**
 * Phase 2b.4. next-themes was already a dependency and entirely unused —
 * no .dark class existed until v0.99.0.
 *
 * forcedTheme="dark" until slice 9: the token sets and the light palette
 * ship in slice 0 so every later slice can be screenshotted and guarded in
 * both themes, but the athlete must never reach a half-migrated light theme.
 * The screenshot script sets the class directly, which is why forcing here
 * does not cost us light-mode verification.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      forcedTheme="dark"
      enableColorScheme={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
```

**`enableColorScheme={false}` is a decision, not boilerplate (I2, whole-branch
review).** next-themes defaults it to `true` and then writes
`document.documentElement.style.colorScheme`. `main` declared `color-scheme`
nowhere, so the default made this branch the first thing in the app's history
to set it — app-wide, repainting native scrollbars, 26 `type="number"`
spinners, 4 `type="date"` and 6 `type="time"` picker popups, and 13 `<select>`
dropdown lists, none of which any token in this slice touches.

**Decided: disable it here, re-enable it in the slice that lifts
`forcedTheme`.** While the theme is a constant there is nothing for native
widgets to follow, so the flag buys nothing yet; disabling restores parity with
`main` instead of adding another item to the exceptions list; and
`chrome-headless-shell` renders no native scrollbar chrome and no picker popups
(they are browser/OS surfaces outside the page), so
`scripts/verify-surfaces.ts` cannot see this change in either direction —
**it is not screenshot-verifiable in this repo and was not screenshot
verified.** The counter-argument is real and recorded on the component: a dark
app with light native controls looks unfinished, and `color-scheme: dark` is
the right fix for that — it just needs to ship in a slice that can look at it.
The same slice restores `layout.tsx`'s per-theme `themeColor` (I1).

- [ ] **Step 2: Wire it into the layout**

In `src/app/layout.tsx`, add the import and wrap the body's children. The
`<html>` tag gains `suppressHydrationWarning`, which next-themes requires
because it writes the class before React hydrates:

```tsx
<html
  lang="en"
  suppressHydrationWarning
  className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
>
  <body className="min-h-full flex flex-col">
    <ThemeProvider>
      <SwRegister />
      {children}
    </ThemeProvider>
  </body>
</html>
```

- [ ] **Step 3: Verify dark is unchanged and the build is clean**

Run: `npm run typecheck && npm run build`
Expected: both succeed. `npm run build` is the check that catches a sync
export from a `"use server"` file and is **not** in the local pre-merge gate —
run it explicitly.

- [ ] **Step 4: Confirm the class is applied**

**`curl` cannot answer this — do not try.** With `attribute="class"`,
next-themes applies `.dark` from an inline script, so it is absent from the
SSR markup on _any_ correct setup. A `curl | grep` returning empty proves
nothing, and reading it as failure would send you chasing a working
configuration.

Two checks that do answer it. First, structural — confirm the served HTML
contains next-themes' inline `<script>` with no `src`, `async` or `defer`,
positioned before the first visible content node. A parser-blocking inline
script runs before anything after it can paint.

Second, empirical — in the headless browser from Task 6, assert the class
lands before first paint:

```js
// Instrument on `document`, not documentElement — the latter does not exist
// yet when an init script runs.
new MutationObserver(() => {
  if (document.documentElement.classList.contains("dark")) {
    window.__darkAt = performance.now();
  }
}).observe(document, { attributes: true, subtree: true });
// Then compare window.__darkAt against
// performance.getEntriesByName("first-contentful-paint")[0].startTime
```

Expected: the class lands before first paint. Measured on 2026-08-11 across
five runs: class at 43-63ms, FCP at 52-144ms — no flash of light. If the
class lands _after_ first paint, the athlete sees a white flash on every load
and the task is not done.

- [ ] **Step 5: Commit**

```bash
git add src/components/theme-provider.tsx src/app/layout.tsx
git commit -m "feat(theme): wire next-themes, forced dark until slice 9

Already a dependency, never used. Forcing dark keeps the athlete out of a
half-migrated light theme while every slice is still screenshotted in both."
```

---

### Task 6: Screenshot script

**Files:**

- Create: `scripts/screenshot.ts`

**Interfaces:**

- Consumes: a running dev server on port 3000.
- Produces: PNGs under `.screenshots/<slice>/<surface>-<theme>-<viewport>.png`.
  Every later slice runs this and attaches the output to the PR.

- [ ] **Step 1: Confirm the browser launches (already verified 2026-08-11)**

This sandbox has no sudo, so Playwright's bundled Chromium dies on
`libnspr4.so` unless it is pointed at the cached extracted system libraries.
Both the browser and the libraries persist across sessions. Verify, don't
assume:

```bash
export CHROME_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
export LD_LIBRARY_PATH=$HOME/.cache/chromium-sysdeps/root/usr/lib/x86_64-linux-gnu:$HOME/.cache/chromium-sysdeps/root/lib/x86_64-linux-gnu
"$CHROME_PATH" --version
```

Expected: `Google Chrome for Testing 151.0.7922.34` (confirmed working on
2026-08-11). If it fails on a missing `.so`, re-run
`~/.cache/chromium-sysdeps/resolve.sh`, which resolves the whole dependency
chain unattended in about a minute.

**Playwright itself is not in `node_modules`** — it exists only in the npx
cache, at several versions, and only one matches revision 1234:
`~/.npm/_npx/e41f203b7505f1fb`. Import it by absolute path; the others fail
with "Executable doesn't exist at …chromium_headless_shell-1232".

- [ ] **Step 2: Write the script**

```ts
// scripts/screenshot.ts — Phase 2b.4 verification.
// Captures each surface in both themes at two viewports. Light mode is
// forced by setting the class directly, which is why ThemeProvider's
// forcedTheme="dark" does not blind us to it.
//
// Usage: npx tsx scripts/screenshot.ts <slice-name>
//
// Requires, per docs/plans/2026-08-11-v099-slice0-foundations.md Task 6:
//   CHROME_PATH, LD_LIBRARY_PATH (cached sysdeps), and a dev server started
//   with BETTER_AUTH_URL=http://localhost:3100 — without it, secure-cookie
//   mode drops the session and every authenticated capture is a login page.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
// Playwright is not in node_modules — it lives only in the npx cache, at
// several versions, and only one matches the installed chromium revision.
// Resolve from the environment so no machine's home directory is baked into
// the repo, with the verified path as the documented default.
const PLAYWRIGHT_CORE =
  process.env.PLAYWRIGHT_CORE ??
  `${process.env.HOME}/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core`;
let chromium: typeof import("playwright-core").chromium;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ chromium } = require(PLAYWRIGHT_CORE));
} catch {
  throw new Error(
    `Cannot load playwright-core from ${PLAYWRIGHT_CORE}. Set PLAYWRIGHT_CORE to ` +
      `a copy whose playwright-core/browsers.json chromium revision matches a ` +
      `directory in ~/.cache/ms-playwright. See Task 6 Step 1.`
  );
}

const SURFACES: Record<string, string> = {
  today: "/",
  train: "/train",
  coach: "/coach",
  body: "/body",
  settings: "/settings",
  admin: "/admin",
  import: "/import",
  "activity-log": "/activity/log",
  login: "/login",
};

const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
};

const slice = process.argv[2];
if (!slice) throw new Error("usage: tsx scripts/screenshot.ts <slice-name>");

const outDir = join(process.cwd(), ".screenshots", slice);
mkdirSync(outDir, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
  });

  // Sign in through the real form and reuse the state. Do NOT fabricate a
  // session cookie — a hand-made cookie that better-auth rejects produces a
  // login page in every capture, which looks like a styling bug.
  const signIn = await browser.newContext({ viewport: VIEWPORTS.phone });
  const page = await signIn.newPage();
  await page.goto("http://localhost:3100/login");
  await page.fill('input[type="email"]', process.env.SMOKE_EMAIL!);
  await page.fill('input[type="password"]', process.env.SMOKE_PASSWORD!);
  // Clicking before hydration silently posts nothing and waitForURL times
  // out, which reads like bad credentials. Wait for the button, then pause.
  await page.waitForSelector('button[type="submit"]:not([disabled])');
  await page.waitForTimeout(500);
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3100/", { timeout: 15_000 });
  const storageState = await signIn.storageState();
  await signIn.close();

  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    for (const theme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ storageState, viewport });
      // ThemeProvider forces dark until slice 9, so set the class directly
      // on every document rather than driving the UI control.
      await ctx.addInitScript(`
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.classList.toggle("dark", ${theme === "dark"});
        });
      `);
      const p = await ctx.newPage();
      for (const [name, path] of Object.entries(SURFACES)) {
        await p.goto(`http://localhost:3100${path}`, {
          waitUntil: "networkidle",
        });
        await p.screenshot({
          path: join(outDir, `${name}-${theme}-${vpName}.png`),
          fullPage: true,
        });
      }
      await ctx.close();
    }
  }

  await browser.close();
  console.log(
    `captured ${Object.keys(SURFACES).length * 4} images → ${outDir}`
  );
}

main();
```

- [ ] **Step 3: Capture and actually look at the output**

```bash
npm run dev &   # with BETTER_AUTH_URL=http://localhost:3100
sleep 10
npx tsx scripts/screenshot.ts slice-0
```

Open at least four of the PNGs. Confirm: light renders light, dark renders
dark, no capture is a login page or an error, and the phone captures are 390px
wide. **A run that produces 36 files is not evidence — a run whose files you
looked at is.** Note in the commit which ones you opened.

Known flakiness that is not the app's fault: one patched Chromium hitting one
local Next.js + Postgres process back to back will occasionally produce one bad
capture that is fine on a retry. Something that fails twice in isolation is
real; a single blip is not.

- [ ] **Step 4: Add `.screenshots/` to .gitignore**

```bash
echo ".screenshots/" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add scripts/screenshot.ts .gitignore
git commit -m "feat(verify): headless capture of every surface in both themes"
```

---

### Task 7: Axe, in the real browser

**A deliberate deviation from the spec, recorded here rather than done
quietly.** The spec says "axe, nine surfaces × two themes — 18 tests, up from
one". The existing `journal-form.axe.test.tsx` uses `vitest-axe`, which renders
a _component_ in jsdom. Nine of this app's surfaces are async server components
that read Postgres; they do not render in jsdom, and jsdom computes no layout,
so it cannot see a contrast or overlap violation at all. Component-level axe on
these surfaces would be a test that passes without checking anything.

Axe therefore runs **in the browser we just verified**, over the real rendered
page. Same nine surfaces, same two themes, stronger result.

**Files:**

- Modify: `scripts/screenshot.ts` — rename to `scripts/verify-surfaces.ts`; it
  now captures _and_ audits in one pass over the same pages.

**Interfaces:**

- Consumes: the browser setup from Task 6.
- Produces: `.screenshots/<slice>/axe-report.json`, and a non-zero exit when a
  surface has violations at `serious` or `critical`.

- [ ] **Step 1: Add axe-core**

```bash
npm install --save-dev axe-core
```

- [ ] **Step 2: Audit each page in the same loop as the capture**

Inside the per-surface loop in Task 6's script, after `p.screenshot(...)`:

```ts
await p.addScriptTag({
  path: require.resolve("axe-core/axe.min.js"),
});
const result = await p.evaluate(async () => {
  // @ts-expect-error injected on the page
  return await window.axe.run(document, {
    resultTypes: ["violations"],
  });
});
const blocking = result.violations.filter((v: { impact: string }) =>
  ["serious", "critical"].includes(v.impact)
);
report.push({ surface: name, theme, viewport: vpName, blocking });
```

Write `report` to `axe-report.json` after the loop and
`process.exitCode = 1` if any entry has a non-empty `blocking` array.

- [ ] **Step 3: Run it and record the baseline**

Run: `npx tsx scripts/verify-surfaces.ts slice-0`
Expected: **violations, and a non-zero exit.** The current surfaces have the
134 sub-AA ink usages this release exists to fix, so a clean run here would
mean the audit is not working. Record the violation count per surface in the
commit message — that is slice 1-8's target list, and the number each slice
must drive down.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-surfaces.ts package.json package-lock.json
git commit -m "feat(verify): axe over every surface in both themes, in a real browser

Deviates from the spec's vitest-axe framing on purpose: nine surfaces are
async server components that do not render in jsdom, and jsdom computes no
layout, so component-level axe cannot see a contrast violation. Baseline
violation counts recorded here are slices 1-8's target list."
```

---

### Task 8: Mockups for Today and Train

The design-source decision: settle the system against the smallest and largest
surfaces before any surface is rebuilt. This is a design artifact, not code.

**Files:**

- Create: `docs/design/v0.99-today.html`, `docs/design/v0.99-train.html`

- [ ] **Step 1: Build the Today mockup, all three states**

Static HTML using the real token values from Task 2, in both themes. Three
states: morning, post-session, evening. Real content, not lorem — pull actual
figures from the live instance so density is honest.

- [ ] **Step 2: Build the Train mockup**

Week, History and Fitness tabs at the 12px floor. **This is the mockup that
matters**: Train is where the floor forces content to be cut. If the week rows
do not fit, that is a finding to resolve here, not during slice 2.

- [ ] **Step 3: Review both with the user before slice 1 begins**

Present in the browser companion. Get explicit approval. **Slice 1 does not
start until this is approved** — that is the entire point of doing the
reference surfaces first.

- [ ] **Step 4: Commit**

```bash
git add docs/design/
git commit -m "docs(design): Today and Train reference mockups, both themes"
```

---

## Rollback: the real revert unit (I9, whole-branch review)

The spec's release shape says "slices keep rollback at one `git revert`" and
its risk table answers "no partial rollback" with "a bad surface is one
revert". **That is true for slices 1-8 and false for this slice.** Written down
here because the moment it matters is an incident, which is the worst moment to
discover it.

**Inside slice 0 there is no revertible commit.** Two worked examples, both
using real commits on this branch:

- **Revert the token commit (`b33b3ca`) alone → the app has no colours.** It
  declares `:root` and `.dark`. Four later commits build on it: the type and
  spacing scales (`b5906a9`), the ad-hoc-ink closure (`e4f4be3`), the
  globals.css component-class tokenisation (`84280ae`) and the inline-style fix
  (`61c7546`) all reference `var(--ink-*)` / `var(--surface-*)`, and
  `@theme inline` maps `--color-ink-*` onto them. Reverting the declarations
  leaves every one of those references **undefined** — text and surfaces fall
  back to inherited or transparent. It also breaks
  `src/lib/design/tokens.ts`, so `tests/contrast-guard.test.ts` throws
  `tokens: no ".dark" block in globals.css` rather than reporting a colour
  problem. In practice the revert does not even apply cleanly, because
  `84280ae` edited the same region.
- **Revert the `ThemeProvider` commit (`369e72e`) alone → the athlete gets the
  half-migrated LIGHT theme, app-wide.** Removing the provider removes the
  `.dark` class from `<html>`, and `:root` **is** the light theme. Every
  surface is still unmigrated: 70 `bg-white/5` cards go invisible on `#f6f6f6`
  and 447 `text-white/N` texts go nearly so. That is strictly worse than
  either the state before this branch or the state after it, and it is the
  exact failure `forcedTheme="dark"` exists to prevent — so the revert
  reintroduces the defect by removing its guard.

**The safe unit for slice 0 is the whole slice**, reverted as one range, and
operationally the release's rollback unit is **the previous release tag
(`v0.98.0`)** — this is one deploy, so there is no in-between state to fall
back to.

Two commits inside the slice are individually revertible, and neither is one
anybody would reach for in an incident: `41c4ede` (static `themeColor`) and
`176361b` (`enableColorScheme={false}`) each undo one small change and put back
one small defect. `b15751f` (pinch-zoom) is revertible but self-announcing —
`tests/viewport-zoom-guard.test.ts` goes red immediately, which is the guard
working.

**And a rider for later slices.** Slices 1-8 are individually revertible only
_while_ `forcedTheme="dark"` holds: reverting slice 3 restores Body's
`text-white/N` classes, which is harmless in dark and invisible in light. Once
slice 9 lifts `forcedTheme`, the revert unit for any earlier slice becomes
**slice 9 plus that slice** — reverting a surface on its own after slice 9
recreates the same half-migrated light theme described above, one surface at a
time. Slice 9's plan must carry this forward.

## Slice 0 exit criteria

- [ ] `npm run typecheck && npm run build && npm test` all green
- [ ] `tests/contrast-guard.test.ts` passes and its mutation check was recorded
- [ ] `tests/viewport-zoom-guard.test.ts` passes
- [ ] `tests/type-scale-guard.test.ts` passes: two expected failures
      (arbitrary type sizes, ad-hoc ink alphas) plus two real assertions
      (hairline-as-text, walk-sanity floor)
- [ ] `KNOWN_ORPHANS` still empty; `ia-directory-guard` and `route-guard` green
- [ ] Dark mode renders as before — no athlete-visible change
- [ ] Screenshots captured in both themes, and **at least four were opened and
      looked at**
- [ ] Axe baseline recorded per surface — this run is expected to fail
- [ ] Today and Train mockups approved by the user

## What this plan does not cover

Slices 1-9 get their own plans, written against the approved mockups. Their
exact content depends on decisions this slice makes, and pre-writing them would
be fiction. The next plan is `slice 1 — Today`, which also closes the roadmap's
three-untested-Today-components rider.
