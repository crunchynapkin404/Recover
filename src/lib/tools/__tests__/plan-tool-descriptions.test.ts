/**
 * v0.43's safety guarantee lives in prose, so it needs a test.
 *
 * The whole release rests on the coach understanding that generating a plan
 * only PROPOSES one, and that activating it is a separate call the athlete has
 * to agree to. The only thing carrying that to the model is the wording of two
 * tool descriptions — and `frozen-tools.test.ts` deliberately excludes
 * `description` from its snapshot, so nothing else would notice if someone
 * softened "does not activate anything" into "creates a plan".
 *
 * These are substring assertions rather than a snapshot on purpose: the copy
 * should stay free to improve, while the three claims it must never lose are
 * pinned. If you are here because one of these failed, the question is not
 * "how do I make the test pass" — it is whether the coach can still tell that
 * it must not activate a plan unasked.
 */
import { describe, expect, it } from "vitest";
import { generateTrainingPlanTool } from "../generate-training-plan";
import { confirmTrainingPlanTool } from "../confirm-training-plan";

describe("plan tool descriptions carry v0.43's two-step contract", () => {
  const propose = generateTrainingPlanTool.description.toLowerCase();
  const confirm = confirmTrainingPlanTool.description.toLowerCase();

  it("generate_training_plan says it does not activate anything", () => {
    expect(propose).toContain("does not activate anything");
  });

  it("generate_training_plan points at the confirmation step by name", () => {
    expect(propose).toContain("confirm_training_plan");
  });

  it("generate_training_plan does not claim to create or start a plan", () => {
    // "Propose"/"drafts" are the load-bearing verbs. A description that says it
    // creates the plan is the pre-v0.43 contract, and the coach would act on it.
    expect(propose).not.toMatch(/\bcreates? a (periodized )?plan\b/);
    expect(propose).toMatch(/\bpropose|\bdrafts?\b/);
  });

  it("confirm_training_plan says it archives the previous plan", () => {
    expect(confirm).toContain("archive");
  });

  it("confirm_training_plan requires the athlete to have agreed first", () => {
    expect(confirm).toMatch(/only (call )?(this )?after/);
    expect(confirm).toContain("agreed");
  });

  it("both tools are scoped as writes, because a draft is still a write", () => {
    expect(generateTrainingPlanTool.scope).toBe("write:plan");
    expect(confirmTrainingPlanTool.scope).toBe("write:plan");
  });
});
