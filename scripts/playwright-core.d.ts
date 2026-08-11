// playwright-core is intentionally not a project dependency (see the header
// comment in screenshot.ts) — it is loaded at runtime from an absolute path
// via `require(PLAYWRIGHT_CORE)`. This ambient declaration only satisfies
// `tsc --noEmit` for the type-only references in screenshot.ts; it adds no
// package and has no runtime effect.
declare module "playwright-core" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const chromium: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Browser = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Page = any;
}
