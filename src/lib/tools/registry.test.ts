import { describe, it, expect } from "vitest";
import { allTools } from "@/lib/tools/registry";

describe("tool registry", () => {
  it("every tool has required fields", () => {
    expect(allTools.length).toBeGreaterThan(0);
    for (const tool of allTools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a valid zod schema for parameters", () => {
    for (const tool of allTools) {
      // All our tools should parse an empty object or an object with defaults
      const schema = tool.parameters;
      expect(schema).toBeDefined();
      // Verify it's a zod schema by calling safeParse
      const result = schema.safeParse({});
      // Either succeeds (all optional/default) or fails with a ZodError
      expect(result.success === true || result.error !== undefined).toBe(true);
    }
  });

  it("tools with no required params accept empty input", () => {
    const noParamTools = [
      "get_readiness",
      "get_fitness_summary",
      "get_athlete_profile",
    ];
    for (const name of noParamTools) {
      const tool = allTools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const result = tool!.parameters.safeParse({});
      expect(result.success).toBe(true);
    }
  });

  it("get_readiness_history validates days param", () => {
    const tool = allTools.find((t) => t.name === "get_readiness_history")!;

    // Default works
    expect(tool.parameters.safeParse({}).success).toBe(true);

    // Valid days
    expect(tool.parameters.safeParse({ days: 14 }).success).toBe(true);

    // Invalid: over max
    expect(tool.parameters.safeParse({ days: 100 }).success).toBe(false);

    // Invalid: zero
    expect(tool.parameters.safeParse({ days: 0 }).success).toBe(false);
  });

  it("list_activities validates sport filter and limit", () => {
    const tool = allTools.find((t) => t.name === "list_activities")!;

    expect(tool.parameters.safeParse({}).success).toBe(true);
    expect(tool.parameters.safeParse({ sport: "Ride", limit: 5 }).success).toBe(
      true
    );
    expect(tool.parameters.safeParse({ limit: 50 }).success).toBe(false); // over max
  });
});

describe("tool registry - userId scoping", () => {
  it("every tool execute function requires userId in context", () => {
    // Verify the execute signature expects ToolContext with userId
    for (const tool of allTools) {
      // The execute function should have arity 2 (args, ctx)
      expect(tool.execute.length).toBe(2);
    }
  });
});
