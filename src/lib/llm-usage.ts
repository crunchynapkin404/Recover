/**
 * v0.15 token transparency — one row per LLM call, recorded best-effort.
 * Usage accounting must never break the reply it accounts for, and providers
 * that omit usage produce no row rather than estimates (tokens, never
 * guesses; cost-in-currency is deliberately out of scope — BYO endpoints
 * make pricing unknowable).
 */
import { and, count, eq, gte, lt, sum } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";

export type LlmPurpose =
  | "chat"
  | "morning"
  | "weekly"
  | "monthly"
  | "ride_review"
  | "race_debrief"
  | "health_extract";

export interface LlmUsageInput {
  userId: string;
  model: string;
  slot: "quick" | "deep";
  purpose: LlmPurpose;
  inputTokens?: number;
  outputTokens?: number;
}

export async function recordLlmUsage(u: LlmUsageInput): Promise<void> {
  const input = Number.isFinite(u.inputTokens)
    ? Math.round(u.inputTokens!)
    : null;
  const output = Number.isFinite(u.outputTokens)
    ? Math.round(u.outputTokens!)
    : null;
  if (input == null && output == null) return;
  try {
    await db.insert(schema.llmUsage).values({
      userId: u.userId,
      model: u.model,
      slot: u.slot,
      purpose: u.purpose,
      inputTokens: input,
      outputTokens: output,
    });
  } catch (err) {
    logger.warn("llm usage record failed", {
      userId: u.userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface UsageSummaryRow {
  model: string;
  purpose: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Aggregate usage for the server-local calendar month containing `ref`. */
export async function getUsageSummary(
  userId: string,
  ref: Date
): Promise<UsageSummaryRow[]> {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const rows = await db
    .select({
      model: schema.llmUsage.model,
      purpose: schema.llmUsage.purpose,
      calls: count(),
      inputTokens: sum(schema.llmUsage.inputTokens).mapWith(Number),
      outputTokens: sum(schema.llmUsage.outputTokens).mapWith(Number),
    })
    .from(schema.llmUsage)
    .where(
      and(
        eq(schema.llmUsage.userId, userId),
        gte(schema.llmUsage.createdAt, start),
        lt(schema.llmUsage.createdAt, end)
      )
    )
    .groupBy(schema.llmUsage.model, schema.llmUsage.purpose);
  return rows.map((r) => ({
    model: r.model,
    purpose: r.purpose,
    calls: Number(r.calls),
    inputTokens: r.inputTokens ?? 0,
    outputTokens: r.outputTokens ?? 0,
  }));
}
