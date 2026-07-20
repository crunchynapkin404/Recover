import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SecurityEvents } from "@/components/admin/security-events";

describe("SecurityEvents", () => {
  it("renders the recent-events section (server component)", async () => {
    const html = renderToString(await SecurityEvents());
    expect(html).toContain("Recent security events");
  });
});
