import { z } from "zod";

/**
 * The wire shape of one availability block for the coach tools.
 *
 * Shared by set_standard_week and set_week_availability so the two writers
 * cannot drift apart. Note this is only the SHAPE — validateBlocks() is still
 * the semantic gate (it checks overlap, end-after-start, and rejects a block
 * that admits no sport), and every tool must call it before writing.
 */
export const availabilityBlockSchema = z.object({
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  mins: z.number().int().min(0).max(720),
  energy: z.enum(["easy", "normal", "full"]),
  sports: z.array(z.string()).nullable(),
});
