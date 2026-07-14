/**
 * MCP server factory — creates a stateless McpServer instance with all tools
 * registered. Each request gets a fresh server+transport (stateless per plan).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerRequest,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { allTools, requiredScope } from "@/lib/tools/registry";
import { db } from "@/lib/db";
import type { Scope } from "@/lib/mcp/token-auth";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Create and configure the MCP server with all registered tools.
 * Tools check authInfo.extra.userId for data scoping and
 * authInfo.scopes for permission checks.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "recover",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register each tool from the shared registry
  for (const toolDef of allTools) {
    // Extract the raw Zod shape from z.object() for the MCP SDK
    const zodShape =
      "shape" in toolDef.parameters
        ? (toolDef.parameters as { shape: Record<string, unknown> }).shape
        : {};

    if (Object.keys(zodShape).length > 0) {
      server.tool(
        toolDef.name,
        toolDef.description,
        zodShape as Record<string, never>,
        async (args: Record<string, unknown>, extra: Extra) => {
          return executeToolHandler(toolDef, args, extra);
        }
      );
    } else {
      // No-param tools
      server.tool(toolDef.name, toolDef.description, async (extra: Extra) => {
        return executeToolHandler(toolDef, {}, extra);
      });
    }
  }

  return server;
}

/** Exported for security tests (scope + auth enforcement). */
export async function executeToolHandler(
  toolDef: (typeof allTools)[number],
  args: Record<string, unknown>,
  extra: Extra
) {
  const userId = extra.authInfo?.extra?.userId as string | undefined;
  if (!userId) {
    return {
      content: [{ type: "text" as const, text: "Authentication required." }],
      isError: true,
    };
  }

  // Generic scope enforcement: every tool declares its required scope
  // (default "read") — nothing dispatches without it.
  const scopes = (extra.authInfo?.scopes ?? []) as Scope[];
  const needed = requiredScope(toolDef);
  if (!scopes.includes(needed)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Insufficient scope: ${needed} required.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await toolDef.execute(args, { userId, db });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ],
      isError: true,
    };
  }
}
