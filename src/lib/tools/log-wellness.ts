import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { upsertWellness } from "@/lib/wellness-write";

const parameters = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date to log, YYYY-MM-DD."),
  sleep_hours: z.number().min(0).max(24).optional().describe("Hours slept."),
  weight_kg: z.number().min(20).max(300).optional(),
  energy: z.number().int().min(1).max(10).optional().describe("Energy 1-10."),
  soreness: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Soreness 1-10."),
  stress: z.number().int().min(1).max(10).optional().describe("Stress 1-10."),
  hrv_ms: z.number().min(1).max(300).optional().describe("HRV rMSSD in ms."),
  resting_hr: z.number().min(20).max(120).optional(),
  mood: z.string().max(32).optional().describe("One-word mood label."),
  notes: z.string().max(2000).optional().describe("Free-form journal note."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const { fieldsWritten } = await upsertWellness(ctx.userId, {
    date: args.date,
    sleepSecs: args.sleep_hours != null ? args.sleep_hours * 3600 : undefined,
    weightKg: args.weight_kg,
    energy1_10: args.energy,
    soreness1_10: args.soreness,
    stress1_10: args.stress,
    hrvMs: args.hrv_ms,
    restingHr: args.resting_hr,
    mood: args.mood,
    notes: args.notes,
  });
  if (fieldsWritten === 0) {
    return { saved: false, reason: "No fields provided." };
  }
  return { saved: true, date: args.date, fields_written: fieldsWritten };
}

export const logWellnessTool: ToolDefinition<typeof parameters> = {
  name: "log_wellness",
  description:
    "Log or update the athlete's wellness for a date (sleep, weight, subjective energy/soreness/stress, HRV, resting HR, mood, notes). Only provided fields are written; readiness is recomputed.",
  parameters,
  scope: "write:wellness",
  execute,
};
