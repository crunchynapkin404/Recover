import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { listRaces } from "@/lib/race/service";

const parameters = z.object({
  status: z.enum(["upcoming", "completed", "skipped"]).optional(),
  priority: z.enum(["A", "B", "C"]).optional(),
});

function daysFromToday(ymd: string): number {
  const now = new Date();
  const today = new Date(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T00:00:00`
  );
  return Math.round(
    (new Date(ymd + "T00:00:00").getTime() - today.getTime()) / 86_400_000
  );
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const races = await listRaces(ctx.userId, args);
  return {
    races: races.map((r) => ({
      id: r.id,
      name: r.name,
      raceType: r.raceType,
      sport: r.sport,
      date: r.date,
      priority: r.priority,
      status: r.status,
      goalNote: r.goalNote,
      daysToRace: daysFromToday(r.date),
    })),
  };
}

export const getRacesTool: ToolDefinition<typeof parameters> = {
  name: "get_races",
  description:
    "List the athlete's races (A/B/C priority, date, goal note, status) with a countdown in days. The races table is the source of truth for races — prefer it over memory.",
  parameters,
  execute,
};
