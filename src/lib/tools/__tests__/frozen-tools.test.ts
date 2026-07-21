/**
 * Freeze test for the MCP/tool surface (docs/API-STABILITY.md).
 *
 * `allTools` is consumed both by the in-app AI coach and by the MCP server
 * (registry.ts's "one registry, two consumers" principle) — an accidental
 * rename, scope change, or schema drift here breaks every external MCP
 * client silently. This test has no DB dependency (it only inspects the
 * static tool definitions), so it runs unguarded in CI — that's the point
 * of a freeze test: it must never be skippable.
 *
 * `description` is deliberately excluded from the frozen surface: it is
 * documentation text that gets legitimately reworded (typo fixes, clarity
 * passes) without being a wire-contract change. `name`, `scope`, and the
 * JSON Schema derived from `parameters` are the actual wire contract an
 * MCP client depends on, so those are what's frozen.
 */
import { expect, test } from "vitest";
import { z } from "zod";
import { allTools } from "@/lib/tools/registry";

test("MCP tool count is frozen", () => {
  expect(allTools.length).toBe(54);
});

test("MCP tool surface is frozen (names + scopes + schemas)", () => {
  const surface = allTools
    .map((t) => ({
      name: t.name,
      scope: t.scope ?? "read",
      schema: z.toJSONSchema(t.parameters),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  expect(surface).toMatchSnapshot();
});
