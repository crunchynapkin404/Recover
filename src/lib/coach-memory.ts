/**
 * Coach memory — durable per-athlete facts injected into the system prompt.
 * Caps: 50 entries, 280 chars each, ~2000-char prompt block.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type MemoryCategory = "goal" | "injury" | "race" | "preference" | "fact";
export type SaveMemoryResult =
  { ok: true; id: string } | { ok: false; reason: "too_long" | "memory_full" };

export const MEMORY_MAX_ENTRIES = 50;
export const MEMORY_MAX_CONTENT_CHARS = 280;
const BLOCK_MAX_CHARS = 2000;
// Importance order for the prompt block; later categories truncate first.
const CATEGORY_ORDER: MemoryCategory[] = [
  "goal",
  "race",
  "injury",
  "preference",
  "fact",
];

export async function listMemories(userId: string) {
  return db.query.coachMemories.findMany({
    where: eq(schema.coachMemories.userId, userId),
    orderBy: [
      asc(schema.coachMemories.category),
      asc(schema.coachMemories.createdAt),
    ],
  });
}

export async function saveMemory(
  userId: string,
  category: MemoryCategory,
  content: string
): Promise<SaveMemoryResult> {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > MEMORY_MAX_CONTENT_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.coachMemories)
    .where(eq(schema.coachMemories.userId, userId));
  if (n >= MEMORY_MAX_ENTRIES) return { ok: false, reason: "memory_full" };
  const [row] = await db
    .insert(schema.coachMemories)
    .values({ userId, category, content: trimmed })
    .returning();
  return { ok: true, id: row.id };
}

export async function updateMemory(
  userId: string,
  id: string,
  content: string
): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > MEMORY_MAX_CONTENT_CHARS) return false;
  const rows = await db
    .update(schema.coachMemories)
    .set({ content: trimmed, updatedAt: new Date() })
    .where(
      and(
        eq(schema.coachMemories.id, id),
        eq(schema.coachMemories.userId, userId)
      )
    )
    .returning();
  return rows.length > 0;
}

export async function deleteMemory(
  userId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .delete(schema.coachMemories)
    .where(
      and(
        eq(schema.coachMemories.id, id),
        eq(schema.coachMemories.userId, userId)
      )
    )
    .returning();
  return rows.length > 0;
}

export async function deleteMemoryByPrefix(
  userId: string,
  idPrefix: string
): Promise<"deleted" | "not_found" | "ambiguous"> {
  if (idPrefix.length < 8) return "not_found";
  const matches = await db
    .select({ id: schema.coachMemories.id })
    .from(schema.coachMemories)
    .where(
      and(
        eq(schema.coachMemories.userId, userId),
        sql`${schema.coachMemories.id}::text LIKE ${idPrefix + "%"}`
      )
    );
  if (matches.length === 0) return "not_found";
  if (matches.length > 1) return "ambiguous";
  await deleteMemory(userId, matches[0].id);
  return "deleted";
}

export async function memoryPromptBlock(userId: string): Promise<string> {
  const rows = await listMemories(userId);
  if (rows.length === 0) return "";
  const ordered = [...rows].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category as MemoryCategory) -
      CATEGORY_ORDER.indexOf(b.category as MemoryCategory)
  );
  const lines: string[] = ["## What you know about this athlete"];
  let used = lines[0].length;
  let truncated = false;
  for (const row of ordered) {
    const line = `- [${row.id.slice(0, 8)}] (${row.category}) ${row.content}`;
    if (used + line.length + 1 > BLOCK_MAX_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (truncated) lines.push("…(memory truncated)");
  return lines.join("\n");
}
