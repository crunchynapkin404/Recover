// vitest-axe (0.1.0, last published years ago, predates Vitest 4) ships its
// `toHaveNoViolations` type augmentation against the old `Vi.Assertion`
// namespace, which Vitest 4's `@vitest/expect` no longer merges into — so
// `import type {} from "vitest-axe/extend-expect"` type-checks against a
// dead namespace and `expect(...).toHaveNoViolations()` doesn't resolve.
// Re-declare the same matcher against the real (current) extension point
// instead. See docs/a11y-sweep-2026-07.md for the full vitest-axe writeup.
import type { AxeMatchers } from "vitest-axe/matchers";

declare module "@vitest/expect" {
  // This is TS declaration merging, not a real empty interface:
  // `Matchers<T>` is deliberately declared empty upstream specifically so
  // packages can merge matchers into it this way.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T = unknown> extends AxeMatchers {}
}
