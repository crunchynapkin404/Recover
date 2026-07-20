/**
 * Recall over history (v0.15) — Postgres FTS with the 'simple' config (the
 * athlete mixes Dutch and English; language stemming would mangle one of
 * them) across chat messages and journal notes. Weekly/monthly reviews,
 * morning insights, and ride debriefs are chat messages in kind-tagged
 * threads, so one index covers every conversational surface.
 *
 * Read-only. Excludes ghost threads (promised to vanish) and the thread the
 * coach is currently in (already in context).
 */
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";

export const RECALL_DEFAULT_LIMIT = 5;
export const RECALL_MAX_LIMIT = 10;

export type RecallSource =
  "chat" | "journal" | "weekly" | "morning" | "debrief" | "monthly";

export interface RecallHit {
  /** YYYY-MM-DD of the matched message/note. */
  date: string;
  source: RecallSource;
  threadTitle: string | null;
  snippet: string;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export async function searchHistory(
  db: Database,
  params: {
    userId: string;
    query: string;
    limit?: number;
    excludeThreadId?: string;
  }
): Promise<RecallHit[]> {
  const q = params.query.trim();
  if (!q) return [];
  const limit = Math.min(
    Math.max(params.limit ?? RECALL_DEFAULT_LIMIT, 1),
    RECALL_MAX_LIMIT
  );
  const exclude = params.excludeThreadId ?? NIL_UUID;

  // websearch_to_tsquery: quoted phrases and -exclusions, never throws on
  // arbitrary user input (plainto/to_tsquery would).
  const result = await db.execute(sql`
    WITH q AS (SELECT websearch_to_tsquery('simple', ${q}) AS tsq)
    SELECT * FROM (
      SELECT
        to_char(m.created_at, 'YYYY-MM-DD') AS date,
        t.kind AS kind,
        t.title AS thread_title,
        ts_headline('simple', m.content, q.tsq,
          'MaxWords=40, MinWords=15, MaxFragments=1') AS snippet,
        ts_rank(m.search, q.tsq) AS rank
      FROM chat_messages m
      JOIN chat_threads t ON t.id = m.thread_id, q
      WHERE t.user_id = ${params.userId}
        AND t.ephemeral = false
        AND t.id <> ${exclude}
        AND m.role IN ('user', 'assistant')
        AND m.search @@ q.tsq
      UNION ALL
      SELECT
        w.date::text AS date,
        'journal' AS kind,
        NULL AS thread_title,
        ts_headline('simple', w.notes, q.tsq,
          'MaxWords=40, MinWords=15, MaxFragments=1') AS snippet,
        ts_rank(w.search, q.tsq) AS rank
      FROM wellness_daily w, q
      WHERE w.user_id = ${params.userId}
        AND w.notes IS NOT NULL
        AND w.search @@ q.tsq
    ) hits
    ORDER BY rank DESC, date DESC
    LIMIT ${limit}
  `);

  const rows = result.rows as Array<{
    date: string;
    kind: string;
    thread_title: string | null;
    snippet: string;
  }>;
  return rows.map((r) => ({
    date: r.date,
    source: r.kind as RecallSource,
    threadTitle: r.thread_title,
    snippet: r.snippet,
  }));
}
