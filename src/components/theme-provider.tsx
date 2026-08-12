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
 *
 * `enableColorScheme={false}` — A DELIBERATE OVERRIDE OF THE LIBRARY DEFAULT
 * (I2, whole-branch review 2026-08-11). next-themes defaults
 * `enableColorScheme` to true and then writes
 * `document.documentElement.style.colorScheme = <theme>` from both its
 * pre-paint script and its mount effect. `main` set `color-scheme` nowhere —
 * not in globals.css, not in any component — so leaving the default on made
 * this branch the first thing in the app's history to declare it, app-wide,
 * as a side effect nobody chose.
 *
 * That is not cosmetic. `color-scheme` is the one property that repaints
 * UA-rendered widgets, and this app has plenty: native scrollbars on every
 * scrollable surface, 26 `type="number"` spinners, 4 `type="date"` and 6
 * `type="time"` fields whose picker popups are browser chrome, and 13
 * `<select>` dropdown lists. None of those are reachable by any token in this
 * branch, so none of them were part of the palette work that was reviewed.
 *
 * Disabled rather than kept, for four reasons:
 *   1. Slice 0's contract is "no athlete-visible visual change, except the
 *      recorded exceptions". Disabling restores parity with `main` instead of
 *      adding a fifteenth item to the exceptions list.
 *   2. It buys nothing yet. `color-scheme` exists so native widgets can
 *      FOLLOW the page's theme. While `forcedTheme="dark"` is in force the
 *      page's theme is a constant, so there is nothing to follow. Its whole
 *      value arrives on the day the athlete can choose light — the same day
 *      `forcedTheme` goes.
 *   3. It cannot be verified here. `chrome-headless-shell` renders no native
 *      scrollbar chrome, and picker popups are OS/browser surfaces outside
 *      the page, so `scripts/verify-surfaces.ts` — this repo's only rendering
 *      check — cannot see the change in either direction. Shipping an
 *      unverifiable visible change into the slice whose contract is "no
 *      visible change" is the wrong side of that trade.
 *   4. The reverse is cheap. Deleting this one prop is a smaller, more
 *      reviewable edit in the slice that lifts `forcedTheme` than unwinding
 *      it would be after the fact.
 *
 * THE COUNTER-ARGUMENT, RECORDED BECAUSE IT IS REAL: a dark app with
 * light-rendered native controls looks unfinished, and `color-scheme: dark`
 * is the correct fix for exactly that — arguably `main` was already wrong not
 * to set it. That is a genuine improvement with its own visible delta, and it
 * belongs in the slice that can look at it and disclose it.
 *
 * RE-ENABLE IT IN THE SLICE THAT REMOVES `forcedTheme`, in the same commit —
 * at that point `color-scheme` must track the resolved theme or native
 * widgets will be the one part of the app that ignores the athlete's choice.
 * The same slice restores `layout.tsx`'s per-theme `themeColor` (see I1).
 *
 * SIDE EFFECT, ACCEPTED DELIBERATELY: this is the first time `.dark` has
 * ever been applied, so `dark:` utilities that were dead code become live.
 * Measured (I3, corrected from "11"): **14 distinct utilities, 21
 * occurrences, 4 files** — `ui/button.tsx`, `ui/input.tsx`, `ui/badge.tsx`
 * and `settings/api-tokens-card.tsx`. `ui/input.tsx` was missing from the
 * original list and is the consequential one: its `dark:bg-input/30` gives
 * every text field in the app a grey fill it never had.
 *
 * 6 of the 14 are confirmed by eye in
 * `.screenshots/branch-A2/settings-token-created-dark-phone.png` (the only
 * capture that reaches an `<Input>`, an outline `Button` and the success box
 * — the plain /settings capture is the collapsed Menu). The other 8 are not:
 * five are hover/focus/disabled/aria-invalid state variants a static capture
 * cannot reach, and three belong to the `destructive` variant, which has zero
 * call sites in src/ and cannot render at all. Measured rather than assumed
 * benign, which turned up two sub-AA states no capture would have shown.
 * The full table, both lists, and the two findings are in the plan's Global
 * Constraints.
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
