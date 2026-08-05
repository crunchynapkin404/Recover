import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { createRace, updateRace } from "@/lib/race/service";

const parameters = z.object({
  id: z.string().uuid().optional().describe("Set to update an existing race."),
  name: z.string().min(1),
  raceType: z
    .string()
    .describe('Free text, e.g. "marathon", "70.3", "gran fondo", "10k".'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  priority: z
    .enum(["A", "B", "C"])
    .describe(
      "A = full taper target; B = short pre-race ease-off; C = train through."
    ),
  sport: z
    .enum(["Bike", "Run", "Triathlon"])
    .optional()
    .describe(
      "Required when creating a race; omit on update to leave it unchanged. Decides what the training plan builds."
    ),
  goalNote: z.string().optional(),
  status: z.enum(["upcoming", "completed", "skipped"]).optional(),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  if (args.id) {
    const { id, ...patch } = args;
    const r = await updateRace(ctx.userId, id, patch);
    if ("error" in r) return { success: false, error: r.error };
    return { success: true, race: { id: r.id, name: r.name, date: r.date } };
  }
  if (!args.sport) {
    return {
      success: false,
      error:
        "sport is required when creating a race — one of Bike, Run, Triathlon",
    };
  }
  const r = await createRace(ctx.userId, { ...args, sport: args.sport });
  if ("error" in r) return { success: false, error: r.error };
  return {
    success: true,
    race: { id: r.race.id, name: r.race.name, date: r.race.date },
  };
}

export const upsertRaceTool: ToolDefinition<typeof parameters> = {
  name: "upsert_race",
  description:
    "Create or update a race (A/B/C). A races drive the taper and race-day form projection; creating a race in the past is rejected.",
  parameters,
  scope: "write:plan",
  execute,
};
