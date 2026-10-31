import { beforeEach, describe, expect, it, vi } from "vitest";

// No database: these pin the contract between the two Plan setup quick
// actions and the useActionState hook that renders their failures. The
// DB-backed behaviour of setPlanStyleQuick/setSeasonModeQuick lives in
// actions.test.ts.

const { executeMock, warnMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "quick-actions-user" })),
}));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: warnMock, error: vi.fn(), info: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tools/update-training-plan", () => ({
  updateTrainingPlanTool: { execute: executeMock },
}));

import { submitPlanStyleQuick, submitSeasonModeQuick } from "./actions";

function form(entries: Record<string, string | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries))
    if (v !== undefined) f.set(k, v);
  return f;
}

beforeEach(() => {
  executeMock.mockReset();
  warnMock.mockReset();
});

describe.each([
  {
    name: "submitPlanStyleQuick",
    run: submitPlanStyleQuick,
    valid: { style: "block_lite" },
    invalid: { style: "weird" },
    invalidError: "invalid_plan_style",
  },
  {
    name: "submitSeasonModeQuick",
    run: submitSeasonModeQuick,
    valid: { seasonAction: "off_season" },
    invalid: { seasonAction: "weird" },
    invalidError: "invalid_season_action",
  },
])("$name", ({ name, run, valid, invalid, invalidError }) => {
  it("returns no error when the change is saved", async () => {
    executeMock.mockResolvedValue({ success: true });
    await expect(run({ error: null }, form(valid))).resolves.toEqual({
      error: null,
    });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("returns the tool's failure, and still logs it", async () => {
    executeMock.mockResolvedValue({ success: false, error: "no_active_plan" });
    await expect(run({ error: null }, form(valid))).resolves.toEqual({
      error: "no_active_plan",
    });
    expect(warnMock).toHaveBeenCalledWith("quick action failed", {
      action: name,
      error: "no_active_plan",
    });
  });

  it("returns a rejected value without calling the tool", async () => {
    await expect(run({ error: null }, form(invalid))).resolves.toEqual({
      error: invalidError,
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("clears a previous failure on success", async () => {
    executeMock.mockResolvedValue({ success: true });
    await expect(
      run({ error: "no_active_plan" }, form(valid))
    ).resolves.toEqual({ error: null });
  });
});
