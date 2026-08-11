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
 * SIDE EFFECT, ACCEPTED DELIBERATELY: this is the first time `.dark` has
 * ever been applied, so 11 `dark:` utilities that were dead code become
 * live — api-tokens-card's success box, the outline Button's
 * border/background, destructive Button and Badge, and several
 * hover/focus/aria-invalid variants. They were authored for a dark app and
 * had never rendered as intended. Verified in Task 6/7's screenshot and axe
 * pass; see the plan's Global Constraints.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      forcedTheme="dark"
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
