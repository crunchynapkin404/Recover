"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/**
 * Phase 2b.4. next-themes was already a dependency and entirely unused —
 * no .dark class existed until v0.99.0.
 *
 * ── v0.111.0: `forcedTheme` IS GONE, AND SO IS THE OVERRIDE ──────────────
 * Slice 9. The athlete can now choose light, dark or system, and every one of
 * the conditions the old comment set for this moment has been met:
 *
 *   - All nine surface slices shipped. The app measures ZERO confirmed axe
 *     nodes across 24 surfaces in both themes at two viewports.
 *   - The theme-blind chromatic literals are gone. 28 base occurrences of
 *     `text-emerald-400`/`red-400`/`violet-400`/`orange-400`/`blue-400`
 *     resolved to semantic tokens in this same release; they measured
 *     1.35-2.89:1 in light and were latent only because nobody could reach
 *     light to see them.
 *   - `enableColorScheme` is restored to the library default (this prop is
 *     simply deleted). Its whole value arrives exactly now: `color-scheme`
 *     exists so native widgets FOLLOW the page's theme, and until this commit
 *     the page's theme was a constant with nothing to follow. Native
 *     scrollbars, 26 number spinners, 4 date and 6 time pickers and 13
 *     `<select>` popups now track the athlete's choice instead of being the
 *     one part of the app that ignores it.
 *   - `layout.tsx`'s `themeColor` becomes per-theme in the same commit, so
 *     browser and PWA chrome follows too.
 *
 * WHAT NO GUARD HERE CAN CHECK, AND HOW TO CHECK IT: `color-scheme` repaints
 * UA chrome, which `chrome-headless-shell` does not render at all, and picker
 * popups are OS surfaces outside the page. `scripts/verify-surfaces.ts`
 * therefore cannot see any of it, in either direction. On a real device: set
 * the OS to light, open the app, and look at a `<select>`, a date field and
 * the scrollbar. They must look like the page, not like its opposite.
 *
 * `tests/type-scale-guard.test.ts` reads this file through
 * `renderableThemes()`. With `forcedTheme` gone it returns BOTH themes, which
 * is what widens every inline-literal AA assertion in that file from one
 * theme to two — the tripwire the old comment described, now armed.
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
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
