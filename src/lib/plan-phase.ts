/**
 * The periodization phase vocabulary, in one place.
 *
 * This union was written out four times before v0.119: `Block.phase`
 * (training-plan.ts), `MaterializeInput["skeleton"]["phase"]`
 * (materialize.ts, aliased to a local `PlanPhase`), `PlanPhase` export
 * (plan-preview.ts, now re-exported), and `trainingBlocks.phase`'s enum
 * (db/schema.ts). Four copies of one vocabulary is the drift shape
 * `resolveFtpAnchor()` was built to close for FTP in v0.118.0 — a phase
 * added to one copy and missed in another would typecheck on both sides of
 * the gap.
 *
 * The schema's enum is deliberately NOT re-pointed here: drizzle needs a
 * literal array at that call site, and a drifting fifth copy is caught by
 * plan-phase.test.ts asserting the two lists match.
 *
 * Pure and dependency-free, so schema, planner and UI can all import it.
 */
export const PLAN_PHASES = [
  "base",
  "build",
  "peak",
  "taper",
  "recovery",
] as const;

export type PlanPhase = (typeof PLAN_PHASES)[number];
