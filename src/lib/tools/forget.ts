import { z } from "zod";
import type { ToolDefinition } from "./registry";
import { deleteMemoryByPrefix } from "@/lib/coach-memory";

const parameters = z.object({
  id: z.string().min(8).describe("The [id] prefix shown in your memory block"),
});

export const forgetFact: ToolDefinition<typeof parameters> = {
  name: "forget_fact",
  description:
    "Delete a saved fact about the athlete by the [id] shown in your memory block. Use when the athlete corrects or retracts something you remembered.",
  parameters,
  scope: "write:memory",
  execute: async ({ id }, ctx) => {
    const outcome = await deleteMemoryByPrefix(ctx.userId, id);
    if (outcome === "deleted") return { deleted: true };
    return { deleted: false, reason: outcome };
  },
};
