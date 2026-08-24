import { describe, expect, it } from "vitest";
import { PLAN_PHASES } from "./plan-phase";
import { trainingBlocks } from "./db/schema";

describe("PlanPhase", () => {
  it("matches the schema enum exactly", () => {
    // The one copy that cannot import the union (drizzle needs a literal
    // array at the pgTable call site). If someone adds a phase to either
    // list and not the other, this fails.
    const schemaEnum = trainingBlocks.phase.enumValues;
    expect([...schemaEnum].sort()).toEqual([...PLAN_PHASES].sort());
  });
});
