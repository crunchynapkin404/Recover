// vitest-axe (0.1.0, last published years ago, predates Vitest 4) ships its
// `toHaveNoViolations` type augmentation against the old `Vi.Assertion`
// namespace, which current Vitest no longer merges into — so
// `import type {} from "vitest-axe/extend-expect"` type-checks against a
// dead namespace and `expect(...).toHaveNoViolations()` doesn't resolve.
// Re-declare the same matcher against the real (current) extension point
// instead. See docs/a11y-sweep-2026-07.md for the full vitest-axe writeup.
//
// Vitest 5 bundles what used to be `@vitest/expect`, so the extension point
// is `Matchers` on the "vitest" module itself, and it takes two type
// parameters. Declaration merging needs both, with the same constraints and
// defaults as upstream; augmenting "@vitest/expect" (the Vitest 4 location)
// now merges into nothing.
import type { AxeMatchers } from "vitest-axe/matchers";

declare module "vitest" {
  // This is TS declaration merging, not a real empty interface:
  // `Matchers<R, T>` is deliberately declared empty upstream specifically so
  // packages can merge matchers into it this way. R and T are unused here but
  // must keep upstream's names: merged declarations need identical type
  // parameters.
  /* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends AxeMatchers {}
  /* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */
}
