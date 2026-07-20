import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { deleteRace } from "@/lib/race/service";

const parameters = z.object({ id: z.string().uuid() });

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const ok = await deleteRace(ctx.userId, args.id);
  return ok ? { success: true } : { success: false, error: "not_found" };
}

export const deleteRaceTool: ToolDefinition<typeof parameters> = {
  name: "delete_race",
  description:
    "Delete a race. A linked training plan keeps working from its snapshot.",
  parameters,
  scope: "write:plan",
  execute,
};
