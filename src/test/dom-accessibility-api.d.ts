// dom-accessibility-api ships real types (dist/index.d.ts), but its
// package.json "exports" map doesn't resolve them under this project's
// `moduleResolution: "bundler"` — the runtime import works (it's a
// transitive dependency of vitest-axe/axe-core, already on disk), only the
// type resolution fails. Same shape of fix as vitest-axe.d.ts alongside
// this file: a minimal ambient declaration for the one export this repo's
// tests actually use, rather than fighting the upstream package.json.
declare module "dom-accessibility-api" {
  export function computeAccessibleName(
    root: Element,
    options?: unknown
  ): string;
}
