/**
 * Shared "does this user have an active intervals.icu connection" guard for
 * all icu_* tools (Task 2-5, the absorbed intervals-icu-mcp cluster).
 */
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { ConnectorError } from "@/lib/connectors/intervals";
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

export async function executeIcuTool<T>(
  ctx: ToolContext,
  run: (connection: IcuConnection) => Promise<T>
): Promise<T | { error: string }> {
  const connection = await activeIcuConnection(ctx);
  if (!connection) return { error: "No active intervals.icu connection" };
  try {
    return await run(connection);
  } catch (error) {
    if (error instanceof ConnectorError) {
      return { error: error.message };
    }
    throw error;
  }
}
