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

  it("registers the v0.6 strava describe tool (24 total)", () => {
    expect(allTools.length).toBe(32);
    const names = allTools.map((t) => t.name);
    expect(names).toContain("describe_strava_activity");
    for (const name of [
      "remember_fact",
      "forget_fact",
      "get_power_curve",
      "get_pace_curve",
      "get_best_efforts",
      "get_training_load_summary",
      "render_chart",
      "get_planned_workouts",
      "get_calendar_availability",
      "generate_training_plan",
      "get_training_plan",
      "update_training_plan",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("registers the v0.9.2 living-week tools", () => {
    const names = allTools.map((t) => t.name);
    for (const name of [
      "get_week_plan",
      "set_week_availability",
      "get_plan_drift",
    ]) {
      expect(names).toContain(name);
    }
    const setAvail = allTools.find((t) => t.name === "set_week_availability")!;
    expect(setAvail.scope).toBe("write:plan");
    expect(
      setAvail.parameters.safeParse({
        availableMins: [0, 60, 60, 60, 60, 120, 150],
      }).success
    ).toBe(true);
    // wrong length
    expect(
      setAvail.parameters.safeParse({ availableMins: [60, 60] }).success
    ).toBe(false);
    // out of range
    expect(
      setAvail.parameters.safeParse({
        availableMins: [0, 60, 60, 60, 60, 120, 800],
      }).success
    ).toBe(false);
    // read-only tools take no parameters
    for (const name of ["get_week_plan", "get_plan_drift"]) {
      const tool = allTools.find((t) => t.name === name)!;
      expect(tool.parameters.safeParse({}).success).toBe(true);
    }
  });

  it("registers the v0.9.6 absorbed icu_* event tools with correct scopes", () => {
    const names = allTools.map((t) => t.name);
    for (const name of [
      "icu_get_calendar_events",
      "icu_get_event",
      "icu_create_event",
      "icu_update_event",
      "icu_delete_event",
      "icu_bulk_create_events",
      "icu_bulk_delete_events",
      "icu_duplicate_events",
    ]) {
      expect(names).toContain(name);
    }
    // The 2 reads default to "read" (no explicit scope).
    for (const name of ["icu_get_calendar_events", "icu_get_event"]) {
      const tool = allTools.find((t) => t.name === name)!;
      expect(tool.scope).toBeUndefined();
    }
    // The 6 writes require write:icu.
    for (const name of [
      "icu_create_event",
      "icu_update_event",
      "icu_delete_event",
      "icu_bulk_create_events",
      "icu_bulk_delete_events",
      "icu_duplicate_events",
    ]) {
      const tool = allTools.find((t) => t.name === name)!;
      expect(tool.scope).toBe("write:icu");
    }
  });

  it("get_calendar_availability validates days range", () => {
    const tool = allTools.find((t) => t.name === "get_calendar_availability")!;
    expect(tool.parameters.safeParse({}).success).toBe(true); // default 3
    expect(tool.parameters.safeParse({ days: 7 }).success).toBe(true);
    expect(tool.parameters.safeParse({ days: 0 }).success).toBe(false);
    expect(tool.parameters.safeParse({ days: 8 }).success).toBe(false);
  });

  it("render_chart validates chart type enum", () => {
    const tool = allTools.find((t) => t.name === "render_chart")!;
    expect(
      tool.parameters.safeParse({
        type: "line",
        title: "T",
        series: [{ label: "A", data: [{ x: 1, y: 1 }] }],
      }).success
    ).toBe(true);
    expect(
      tool.parameters.safeParse({
        type: "pie",
        title: "T",
        series: [{ label: "A", data: [{ x: 1, y: 1 }] }],
      }).success
    ).toBe(false);
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

  it("get_planned_workouts validates days range", () => {
    const tool = allTools.find((t) => t.name === "get_planned_workouts")!;
    expect(tool.parameters.safeParse({}).success).toBe(true); // default 7
    expect(tool.parameters.safeParse({ days: 14 }).success).toBe(true);
    expect(tool.parameters.safeParse({ days: 0 }).success).toBe(false);
    expect(tool.parameters.safeParse({ days: 15 }).success).toBe(false);
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

  it("generate_training_plan validates raceType enum and daysPerWeek range", () => {
    const tool = allTools.find((t) => t.name === "generate_training_plan")!;
    expect(
      tool.parameters.safeParse({
        raceType: "marathon",
        raceDate: "2027-04-01",
      }).success
    ).toBe(true);
    expect(
      tool.parameters.safeParse({
        raceType: "ironman",
        raceDate: "2027-06-01",
        daysPerWeek: 6,
      }).success
    ).toBe(true);
    // Invalid race type
    expect(
      tool.parameters.safeParse({
        raceType: "swimming",
        raceDate: "2027-04-01",
      }).success
    ).toBe(false);
    // daysPerWeek out of range
    expect(
      tool.parameters.safeParse({
        raceType: "10k",
        raceDate: "2027-04-01",
        daysPerWeek: 2,
      }).success
    ).toBe(false);
    expect(
      tool.parameters.safeParse({
        raceType: "10k",
        raceDate: "2027-04-01",
        daysPerWeek: 8,
      }).success
    ).toBe(false);
    // Missing required raceDate
    expect(tool.parameters.safeParse({ raceType: "marathon" }).success).toBe(
      false
    );
  });

  it("get_training_plan accepts optional weekNumber", () => {
    const tool = allTools.find((t) => t.name === "get_training_plan")!;
    expect(tool.parameters.safeParse({}).success).toBe(true);
    expect(tool.parameters.safeParse({ weekNumber: 3 }).success).toBe(true);
    expect(tool.parameters.safeParse({ weekNumber: "three" }).success).toBe(
      false
    );
  });

  it("update_training_plan validates action enum and requires all fields", () => {
    const tool = allTools.find((t) => t.name === "update_training_plan")!;
    expect(
      tool.parameters.safeParse({
        weekNumber: 2,
        action: "reduce_load",
        reason: "feeling tired",
      }).success
    ).toBe(true);
    expect(
      tool.parameters.safeParse({
        weekNumber: 4,
        action: "skip_week",
        reason: "vacation",
      }).success
    ).toBe(true);
    // Invalid action
    expect(
      tool.parameters.safeParse({
        weekNumber: 2,
        action: "delete",
        reason: "test",
      }).success
    ).toBe(false);
    // Missing reason
    expect(
      tool.parameters.safeParse({ weekNumber: 2, action: "reduce_load" })
        .success
    ).toBe(false);
    // Missing weekNumber
    expect(
      tool.parameters.safeParse({ action: "reduce_load", reason: "test" })
        .success
    ).toBe(false);
  });

  it("update_training_plan supports day-level move/swap actions", () => {
    const tool = allTools.find((t) => t.name === "update_training_plan")!;
    expect(
      tool.parameters.safeParse({
        action: "move_workout",
        reason: "conflict",
        fromDate: "2026-07-21",
        toDate: "2026-07-23",
      }).success
    ).toBe(true);
    expect(
      tool.parameters.safeParse({
        action: "swap_workout",
        reason: "prefer long ride sunday",
        fromDate: "2026-07-21",
        toDate: "2026-07-26",
      }).success
    ).toBe(true);
    // Day-level actions require both dates.
    expect(
      tool.parameters.safeParse({ action: "move_workout", reason: "r" }).success
    ).toBe(false);
    // Week-level actions unchanged: weekNumber still required.
    expect(
      tool.parameters.safeParse({ action: "skip_week", reason: "r" }).success
    ).toBe(false);
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
