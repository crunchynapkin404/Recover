/**
 * PUSH wellness data for one date UP TO intervals.icu. Distinct from
 * Recover's own local `log_wellness` tool, which only stores wellness inside
 * Recover — this tool writes to the athlete's intervals.icu account.
 *
 * Field set ported from the standalone intervals-icu-mcp server's
 * wellness.py:update_wellness, verified against openapi-spec.json's Wellness
 * schema. Uses PUT /athlete/{id}/wellness/{date} (client.py's
 * update_wellness_by_date / openapi's `updateWellness` operation), not
 * client.py's path-less `update_wellness` (PUT /athlete/{id}/wellness with
 * `id` echoed in the body) — the {date}-scoped endpoint matches this task's
 * brief and avoids sending a redundant `id` field.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  date: z.string().describe("Date in YYYY-MM-DD format."),
  weight: z.number().optional().describe("Weight in kg."),
  restingHr: z.number().int().optional().describe("Resting heart rate in bpm."),
  hrv: z.number().optional().describe("HRV (rMSSD) value."),
  sleepSecs: z.number().int().optional().describe("Sleep duration in seconds."),
  sleepQuality: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Sleep quality, 1-5 (1=Great, 5=Poor — inverted scale)."),
  fatigue: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Fatigue level, 1-5 (1=very low, 5=very high)."),
  soreness: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Soreness level, 1-5 (1=very low, 5=very high)."),
  stress: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Stress level, 1-5 (1=very low, 5=very high)."),
  mood: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Mood level, 1-5 (1=very poor, 5=very good)."),
  motivation: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Motivation level, 1-5 (1=very low, 5=very high)."),
  injury: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Injury severity, 1-5 (1=none, 5=severe)."),
  readiness: z.number().optional().describe("Readiness score (0-100)."),
  bodyFat: z.number().optional().describe("Body fat percentage."),
  abdomen: z.number().optional().describe("Abdominal circumference in cm."),
  vo2max: z
    .number()
    .optional()
    .describe("VO2max (ml/kg/min) — lab result or device estimate."),
  systolic: z
    .number()
    .int()
    .optional()
    .describe("Systolic blood pressure in mmHg."),
  diastolic: z
    .number()
    .int()
    .optional()
    .describe("Diastolic blood pressure in mmHg."),
  spo2: z
    .number()
    .optional()
    .describe("Blood oxygen saturation percentage (SpO2)."),
  respiration: z
    .number()
    .optional()
    .describe("Respiration rate in breaths per minute."),
  bloodGlucose: z.number().optional().describe("Blood glucose in mmol/L."),
  lactate: z
    .number()
    .optional()
    .describe("Blood lactate in mmol/L — lab result."),
  menstrualPhase: z
    .string()
    .optional()
    .describe(
      "Menstrual phase, e.g. FOLLICULAR, OVULATING, LUTEAL, MENSTRUAL."
    ),
  locked: z
    .boolean()
    .optional()
    .describe(
      "Lock record to prevent device sync from overwriting manual entries."
    ),
  caloriesConsumed: z
    .number()
    .int()
    .optional()
    .describe("Calories consumed (kcal)."),
  carbohydrates: z
    .number()
    .optional()
    .describe("Carbohydrates consumed (grams)."),
  protein: z.number().optional().describe("Protein consumed (grams)."),
  fatTotal: z.number().optional().describe("Total fat consumed (grams)."),
  hydrationLiters: z.number().optional().describe("Hydration volume (liters)."),
  comments: z.string().optional().describe("Comments or notes."),
});

type Fields = Omit<z.infer<typeof parameters>, "date">;

function buildBody(fields: Fields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.weight !== undefined) body.weight = fields.weight;
  if (fields.restingHr !== undefined) body.restingHR = fields.restingHr;
  if (fields.hrv !== undefined) body.hrv = fields.hrv;
  if (fields.sleepSecs !== undefined) body.sleepSecs = fields.sleepSecs;
  if (fields.sleepQuality !== undefined)
    body.sleepQuality = fields.sleepQuality;
  if (fields.fatigue !== undefined) body.fatigue = fields.fatigue;
  if (fields.soreness !== undefined) body.soreness = fields.soreness;
  if (fields.stress !== undefined) body.stress = fields.stress;
  if (fields.mood !== undefined) body.mood = fields.mood;
  if (fields.motivation !== undefined) body.motivation = fields.motivation;
  if (fields.injury !== undefined) body.injury = fields.injury;
  if (fields.readiness !== undefined) body.readiness = fields.readiness;
  if (fields.bodyFat !== undefined) body.bodyFat = fields.bodyFat;
  if (fields.abdomen !== undefined) body.abdomen = fields.abdomen;
  if (fields.vo2max !== undefined) body.vo2max = fields.vo2max;
  if (fields.systolic !== undefined) body.systolic = fields.systolic;
  if (fields.diastolic !== undefined) body.diastolic = fields.diastolic;
  if (fields.spo2 !== undefined) body.spO2 = fields.spo2;
  if (fields.respiration !== undefined) body.respiration = fields.respiration;
  if (fields.bloodGlucose !== undefined)
    body.bloodGlucose = fields.bloodGlucose;
  if (fields.lactate !== undefined) body.lactate = fields.lactate;
  if (fields.menstrualPhase !== undefined)
    body.menstrualPhase = fields.menstrualPhase;
  if (fields.locked !== undefined) body.locked = fields.locked;
  if (fields.caloriesConsumed !== undefined)
    body.kcalConsumed = fields.caloriesConsumed;
  if (fields.carbohydrates !== undefined)
    body.carbohydrates = fields.carbohydrates;
  if (fields.protein !== undefined) body.protein = fields.protein;
  if (fields.fatTotal !== undefined) body.fatTotal = fields.fatTotal;
  if (fields.hydrationLiters !== undefined)
    body.hydrationVolume = fields.hydrationLiters;
  if (fields.comments !== undefined) body.comments = fields.comments;
  return body;
}

function shapeWellness(w: Record<string, unknown>, date: string) {
  return {
    date,
    weight: w.weight ?? null,
    restingHr: w.restingHR ?? null,
    hrv: w.hrv ?? null,
    sleepSecs: w.sleepSecs ?? null,
    sleepQuality: w.sleepQuality ?? null,
    fatigue: w.fatigue ?? null,
    soreness: w.soreness ?? null,
    stress: w.stress ?? null,
    mood: w.mood ?? null,
    motivation: w.motivation ?? null,
    injury: w.injury ?? null,
    readiness: w.readiness ?? null,
    bodyFat: w.bodyFat ?? null,
    abdomen: w.abdomen ?? null,
    vo2max: w.vo2max ?? null,
    systolic: w.systolic ?? null,
    diastolic: w.diastolic ?? null,
    spo2: w.spO2 ?? null,
    respiration: w.respiration ?? null,
    bloodGlucose: w.bloodGlucose ?? null,
    lactate: w.lactate ?? null,
    menstrualPhase: w.menstrualPhase ?? null,
    locked: w.locked ?? null,
    caloriesConsumed: w.kcalConsumed ?? null,
    carbohydrates: w.carbohydrates ?? null,
    protein: w.protein ?? null,
    fatTotal: w.fatTotal ?? null,
    hydrationLiters: w.hydrationVolume ?? null,
    comments: w.comments ?? null,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const { date, ...fields } = args;
  const body = buildBody(fields);
  if (Object.keys(body).length === 0) {
    return { error: "No fields provided to update." };
  }
  const raw = (await icuRequest(conn, `/athlete/{id}/wellness/${date}`, {
    method: "PUT",
    body,
  })) as Record<string, unknown>;
  return { wellness: shapeWellness(raw, date) };
}

export const icuUpdateWellness: ToolDefinition<typeof parameters> = {
  name: "icu_update_wellness",
  description:
    "PUSH wellness data (HRV, resting HR, sleep, subjective feel, body metrics, vitals, nutrition, etc.) for ONE date UP TO your intervals.icu account — creates the record if missing, otherwise updates only the fields you pass. This writes to intervals.icu itself; it is separate from Recover's own local `log_wellness` tool, which only stores wellness inside Recover.",
  parameters,
  scope: "write:icu",
  execute,
};
