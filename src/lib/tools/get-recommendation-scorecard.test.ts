import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRecommendationScorecard } from "./get-recommendation-scorecard";
import type { ToolContext } from "./registry";

const { mockGetActivePlan } = vi.hoisted(() => ({
  mockGetActivePlan: vi.fn(),
}));

vi.mock("@/lib/active-plan", () => ({
  getActivePlan: mockGetActivePlan,
}));

const mockFindMany = vi.fn();
const context: ToolContext = {
  userId: "u1",
  db: {
    query: {
      trainingBlocks: {
        findMany: mockFindMany,
      },
    },
  } as unknown as ToolContext["db"],
};

describe("get_recommendation_scorecard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reports a improving scorecard from recent adherence history", async () => {
    mockGetActivePlan.mockResolvedValue({ id: "plan-1", title: "Century" });
    mockFindMany.mockResolvedValue([
      { weekNumber: 8, adherencePct: 92 },
      { weekNumber: 7, adherencePct: 88 },
      { weekNumber: 6, adherencePct: 84 },
      { weekNumber: 5, adherencePct: 86 },
    ]);

    await expect(getRecommendationScorecard.execute({}, context)).resolves.toEqual({
      planId: "plan-1",
      planTitle: "Century",
      latestWeekNumber: 8,
      latestAdherencePct: 92,
      rollingAdherencePct: 88,
      trendPct: 4,
      quality: "steady",
      status: "steady",
    });
  });

  it("flags a slipping scorecard when the recent trend drops", async () => {
    mockGetActivePlan.mockResolvedValue({ id: "plan-1", title: "Century" });
    mockFindMany.mockResolvedValue([
      { weekNumber: 8, adherencePct: 68 },
      { weekNumber: 7, adherencePct: 78 },
      { weekNumber: 6, adherencePct: 81 },
    ]);

    await expect(getRecommendationScorecard.execute({}, context)).resolves.toMatchObject({
      rollingAdherencePct: 76,
      trendPct: -10,
      quality: "slipping",
      status: "risk",
    });
  });

  it("returns no plan when the athlete has not started one", async () => {
    mockGetActivePlan.mockResolvedValue(null);

    await expect(getRecommendationScorecard.execute({}, context)).resolves.toEqual({
      status: "no_plan",
      message: "No active training plan yet.",
    });
  });
});