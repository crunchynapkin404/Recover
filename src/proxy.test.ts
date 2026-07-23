import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("allows public webhook POSTs to reach /api/webhooks without redirecting", () => {
    const request = new NextRequest(
      "http://localhost:3000/api/webhooks/strava",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      }
    );

    const response = proxy(request);
    expect(response.status).toBe(200);
  });
});
