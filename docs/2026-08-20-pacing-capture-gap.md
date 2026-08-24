# The pacing line is verified but not captured

**Read this before assuming `surfaces.yml` guards race pacing. It does not.**
Written 2026-08-20, immediately after v0.116.0 reached production.

## What is true

`src/lib/race/pacing.ts` and its render on Train were verified by running
them: a throwaway Postgres, a seeded owner, a **confirmed** plan, a dev
server, and a real browser capture looked at in both viewports. It renders
`Target 6:05/km · hold 5:47/km–6:23/km`, followed by the assumption and
`(low confidence)`.

## What is not true

**No automated capture reaches that state.** `src/app/train/page.tsx:376` is
`if (!plan) return <PlanPreviewCard/>`, and the seeded athlete has a **draft**
plan, not a confirmed one. So the `train` surface — in `surfaces.yml` and in
`soak.yml` alike — photographs the plan-preview card and never renders the
race card at all.

The consequence is precise: **a regression that removed the pacing line
entirely would pass every gate.** 2893 tests, `0 confirmed` on the axe
ratchet, both capture jobs green. That is the same shape as the two v0.114.0
defects that this whole pipeline was built in response to.

`train-plan-preview` exists as a separate surface because `/train` has two
states. This is the third: **confirmed plan, with a race.** It has no surface.

## What would close it

`scripts/seed-two-race.ts` builds a draft through the real
`previewTrainingPlan` and stops. Closing this means either that script
confirming the plan, or a sibling that does — then a new `SURFACES` entry for
the confirmed-plan state, guarded by `SURFACE_PREPARE` on something only that
state renders (`assertOnSurface` compares pathname only, and all three states
share `/train`).

Do not simply confirm the plan inside `seed-two-race.ts` without checking what
else reads it: `train-plan-preview` guards on a visible `segment-2` header and
needs the DRAFT state to survive.

## Also unseen

Triathlon and multi-day refusals are unit-tested and render through the house
`<Unavailable>` component, but **no one has looked at either rendered**. The
component is shared and well-tested, so this is lower risk than the above —
but "lower risk" and "verified" are different words.
