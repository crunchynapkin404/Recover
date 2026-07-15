import { describe, expect, it, vi } from "vitest";

// Since fetchBusyTimes calls external Google API, test with mocked fetch
describe("google-calendar connector", () => {
  it("module exports fetchBusyTimes", async () => {
    const mod = await import("./google-calendar");
    expect(typeof mod.fetchBusyTimes).toBe("function");
  });

  it("module exports refreshAccessToken", async () => {
    const mod = await import("./google-calendar");
    expect(typeof mod.refreshAccessToken).toBe("function");
  });
});
