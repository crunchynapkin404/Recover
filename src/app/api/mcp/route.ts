/**
 * POST /api/mcp — Stateless MCP endpoint (Streamable HTTP transport).
 *
 * Auth flow (resolved BEFORE handleRequest per plan):
 * 1. Extract Bearer token from Authorization header
 * 2. Resolve token → userId + scopes
 * 3. Rate limit check (per-token bucket)
 * 4. Create transport + server, pass authInfo into handleRequest
 *
 * Stateless: fresh server+transport per request. No session state.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveToken } from "@/lib/mcp/token-auth";
import { checkRateLimit } from "@/lib/mcp/rate-limit";
import { createMcpServer } from "@/lib/mcp/server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 1. Auth — resolve BEFORE handleRequest (security requirement)
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Bearer token required" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const plaintext = authHeader.slice(7);
  const tokenInfo = await resolveToken(plaintext);
  if (!tokenInfo) {
    return new Response(
      JSON.stringify({ error: "Invalid or revoked token" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. Rate limit (per-token)
  const rateResult = checkRateLimit(tokenInfo.tokenId);
  if (!rateResult.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rateResult.resetMs / 1000)),
        },
      }
    );
  }

  // 3. Create stateless transport + server
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  const server = createMcpServer();
  await server.connect(transport);

  // 4. Handle request with authInfo carrying userId + scopes
  const response = await transport.handleRequest(req, {
    authInfo: {
      token: plaintext,
      clientId: tokenInfo.tokenId,
      scopes: tokenInfo.scopes,
      extra: { userId: tokenInfo.userId },
    },
  });

  logger.info("mcp request", {
    userId: tokenInfo.userId,
    tokenId: tokenInfo.tokenId,
  });

  return response;
}

/** Handle GET for SSE stream connections */
export async function GET(req: Request) {
  // Same auth flow for GET (SSE stream)
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Bearer token required" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const plaintext = authHeader.slice(7);
  const tokenInfo = await resolveToken(plaintext);
  if (!tokenInfo) {
    return new Response(
      JSON.stringify({ error: "Invalid or revoked token" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const rateResult = checkRateLimit(tokenInfo.tokenId);
  if (!rateResult.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rateResult.resetMs / 1000)),
        },
      }
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const server = createMcpServer();
  await server.connect(transport);

  return transport.handleRequest(req, {
    authInfo: {
      token: plaintext,
      clientId: tokenInfo.tokenId,
      scopes: tokenInfo.scopes,
      extra: { userId: tokenInfo.userId },
    },
  });
}

/** Handle DELETE for session cleanup (no-op in stateless mode) */
export async function DELETE() {
  return new Response(null, { status: 405 });
}
