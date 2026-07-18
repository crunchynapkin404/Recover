/**
 * Shared "does this user have an active intervals.icu connection" guard for
 * all icu_* tools (Task 2-5, the absorbed intervals-icu-mcp cluster).
 */
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { IcuConnection } from "@/lib/connectors/intervals";
import type { ToolContext } from "./registry";

export async function activeIcuConnection(
  ctx: ToolContext
): Promise<IcuConnection | null> {
  const c = await ctx.db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, ctx.userId),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });
  return c && c.status === "active" ? c : null;
}
