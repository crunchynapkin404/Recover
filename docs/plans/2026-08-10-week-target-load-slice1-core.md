# Week target load — Slice 1: core infrastructure (v0.82.0)

**Date:** 2026-08-10
**Phase:** 2c — One source of truth per number (`docs/ROADMAP.md`)
**Slice:** first of four. Full analysis and slicing plan:
`docs/specs/2026-08-10-week-target-load-ownership-design.md`.

## Scope

- Add `weekTargetLoad()` to `src/lib/week-plan/volume.ts`: the shared read
  path for "what does this week target" (effectiveTarget-over-blockTarget,
  returning `Figure<number>`).
- Refactor `weekAdherencePct` to share the same resolution via a private
  helper, with **zero behavior change** (its existing tests must pass
  unchanged, unmodified).
- Document `trainingBlocks.targetLoadTotal` and `weekPlans.effectiveTarget`
  in `schema.ts` as cache/authority, cross-referencing `weekTargetLoad()`.
- Tests for `weekTargetLoad()` covering: effectiveTarget present (wins),
  effectiveTarget null + blockTarget present (fallback), both null
  (`Figure.missingInput`), both present (effectiveTarget wins — the
  ownership rule, not just a truthy check).
- Mutation check (criterion 6): confirm breaking `weekTargetLoad`'s
  resolution order fails a test.

## Out of scope (this slice)

- Migrating any of the 87 existing read sites (race domain, MCP tools,
  weekly-review, UI, export) — slices 2-4, see the design doc.
- Re-enabling the week quick actions — explicitly deferred, product
  decision, tracked as a follow-up once slices 2-4 ship.
- `currentTargetLoad()`/`weekLoadPerMin()` — already single-owner, no
  change needed.

## Design recap (full reasoning in the spec doc)

`effectiveTarget` wins once a week has materialized; `blockTarget`
(`trainingBlocks.targetLoadTotal`) is authoritative only pre-materialization.
This generalizes `weekAdherencePct`'s existing, already-correct fallback
(same file) rather than inventing a new rule.

```ts
export function weekTargetLoad(input: {
  effectiveTarget: number | null;
  blockTarget: number | null;
}): Figure<number>;
```

`Figure<T>` is `src/lib/uncertainty.ts`'s existing vocabulary (Phase 2b.3) —
`Figure.available(value, "high")` when a value resolves,
`Figure.missingInput(...)` when neither input does. High confidence: once
resolved, this is an exact stored figure, not an estimate.

## Verification

- `weekAdherencePct`'s existing test suite (`volume.test.ts`) passes
  byte-for-byte unchanged — proof the refactor is behavior-preserving.
- New `weekTargetLoad` describe block follows the existing
  `weekLoadPerMin`/`currentTargetLoad` test style in the same file.
- Full suite must show identical pass counts plus the new tests, no
  regressions elsewhere.
- `npx tsc --noEmit`, `eslint`, `prettier --check` clean.
