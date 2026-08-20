import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { and, eq, asc } from "drizzle-orm";
import { getActivePlan } from "@/lib/active-plan";
import { resolvePlanningSurfaceState } from "@/lib/planning-surface/effective-state";
import { resolveBlockTargets } from "@/lib/week-plan/service";
import { planRaceTargets } from "@/lib/plan-targets";

const parameters = z.object({
  weekNumber: z
    .number()
    .int()
    .optional()
    .describe("Specific week to detail. Omit for plan overview."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const plan = await getActivePlan(ctx.userId);
  if (!plan) return { available: false, reason: "no_active_plan" };
  const state = resolvePlanningSurfaceState(
    (plan.constraints as Record<string, unknown> | null) ?? null
  );

  if (args.weekNumber != null) {
    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, plan.id),
        eq(schema.trainingBlocks.weekNumber, args.weekNumber)
      ),
    });
    if (!block) return { available: false, reason: "week_not_found" };
    // Reports the week's target through the one shared read path: its
    // materialized effective target once one exists, not the un-tapered
    // skeleton value alone — see week-plan/volume.ts's weekTargetLoad().
    const resolved = (await resolveBlockTargets(plan.id, [block])).get(
      block.weekNumber
    );
    const weekTargets = planRaceTargets(plan);
    return {
      available: true,
      plan: {
        id: plan.id,
        title: plan.title,
        // raceType/raceDate stay the FINAL target so the existing contract
        // is unchanged; firstRace is additive and absent on single-race
        // plans (see planRaceTargets, src/lib/plan-targets.ts).
        raceType: weekTargets.final.raceType,
        raceDate: weekTargets.final.date,
        ...(weekTargets.first
          ? {
              firstRace: {
                raceType: weekTargets.first.raceType,
                date: weekTargets.first.date,
              },
            }
          : {}),
        weeksTotal: plan.weeksTotal,
        currentWeek: plan.currentWeek,
        effectiveStyle: state.effectiveStyle,
        effectiveSeasonMode: state.effectiveSeasonMode,
        reentryStage: state.reentryStage,
      },
      week: {
        ...block,
        targetLoadTotal: resolved?.available
          ? resolved.value
          : block.targetLoadTotal,
      },
    };
  }

  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, plan.id),
    orderBy: [asc(schema.trainingBlocks.weekNumber)],
  });
  // Same read path as the single-week detail above: a materialized week's
  // effective target wins over the skeleton value it started from.
  const resolvedTargets = await resolveBlockTargets(plan.id, blocks);
  const overviewTargets = planRaceTargets(plan);
  return {
    available: true,
    plan: {
      id: plan.id,
      title: plan.title,
      // raceType/raceDate stay the FINAL target so the existing contract is
      // unchanged; firstRace is additive and absent on single-race plans
      // (see planRaceTargets, src/lib/plan-targets.ts).
      raceType: overviewTargets.final.raceType,
      raceDate: overviewTargets.final.date,
      ...(overviewTargets.first
        ? {
            firstRace: {
              raceType: overviewTargets.first.raceType,
              date: overviewTargets.first.date,
            },
          }
        : {}),
      startDate: plan.startDate,
      weeksTotal: plan.weeksTotal,
      currentWeek: plan.currentWeek,
      targetCtl: plan.targetCtl,
      startingCtl: plan.startingCtl,
      status: plan.status,
      effectiveStyle: state.effectiveStyle,
      effectiveSeasonMode: state.effectiveSeasonMode,
      reentryStage: state.reentryStage,
    },
    weeks: blocks.map((b) => {
      const resolved = resolvedTargets.get(b.weekNumber);
      return {
        week: b.weekNumber,
        phase: b.phase,
        targetLoad: resolved?.available ? resolved.value : b.targetLoadTotal,
        targetSessions: b.targetSessions,
        actualLoad: b.actualLoad,
        adherencePct: b.adherencePct,
      };
    }),
  };
}

export const getTrainingPlanTool: ToolDefinition<typeof parameters> = {
  name: "get_training_plan",
  description:
    "Get the active training plan overview, or detail a specific week's workouts.",
  parameters,
  execute,
};
