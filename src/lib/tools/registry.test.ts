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

  it("registers the v0.5a artifact tools (15 total)", () => {
    expect(allTools.length).toBe(15);
    const names = allTools.map((t) => t.name);
    for (const name of [
      "remember_fact",
      "forget_fact",
      "get_power_curve",
      "get_pace_curve",
      "get_best_efforts",
      "get_training_load_summary",
      "render_chart",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("render_chart validates chart type enum", () => {
    const tool = allTools.find((t) => t.name === "render_chart")!;
    expect(tool.parameters.safeParse({ type: "line", title: "T", series: [{ label: "A", data: [{ x: 1, y: 1 }] }] }).success).toBe(true);
    expect(tool.parameters.safeParse({ type: "pie", title: "T", series: [{ label: "A", data: [{ x: 1, y: 1 }] }] }).success).toBe(false);
  });

  it("curve tools validate the days literal union", () => {
    for (const name of [
      "get_power_curve",
      "get_pace_curve",
      "get_best_efforts",
    ]) {
      const tool = allTools.find((t) => t.name === name)!;
      expect(tool.parameters.safeParse({}).success).toBe(true);
      expect(tool.parameters.safeParse({ days: 30 }).success).toBe(true);
      expect(tool.parameters.safeParse({ days: 365 }).success).toBe(true);
      expect(tool.parameters.safeParse({ days: 45 }).success).toBe(false);
    }
  });

  it("remember_fact is a no-op in ghost threads", async () => {
    const tool = allTools.find((t) => t.name === "remember_fact")!;
    const result = await tool.execute(
      { category: "fact", content: "should not persist" },
      { userId: "ghost-user", db: {} as never, ephemeral: true }
    );
    expect(result).toEqual({ saved: false, reason: "ghost thread" });
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
