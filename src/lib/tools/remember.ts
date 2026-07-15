import { z } from "zod";
import type { ToolDefinition } from "./registry";
import { saveMemory } from "@/lib/coach-memory";

const parameters = z.object({
  category: z.enum(["goal", "injury", "race", "preference", "fact"]),
  content: z
    .string()
    .min(3)
    .max(280)
    .describe("One short durable fact about the athlete"),
});

export const rememberFact: ToolDefinition<typeof parameters> = {
  name: "remember_fact",
  description:
    "Save a durable fact about the athlete (goal, injury, race date, preference). Call this when the athlete tells you something worth remembering across conversations. Do not save transient daily states.",
  parameters,
  scope: "write:memory",
  execute: async ({ category, content }, ctx) => {
    if (ctx.ephemeral) {
      return { saved: false, reason: "ghost thread" };
    }
    const result = await saveMemory(ctx.userId, category, content);
    if (!result.ok) {
      return {
        saved: false,
        reason:
          result.reason === "memory_full"
            ? "memory full — ask the athlete what to forget"
            : "content too long (max 280 chars)",
      };
    }
    return { saved: true, id: result.id };
  },
};
