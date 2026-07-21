import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SecurityEvents } from "@/components/admin/security-events";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("SecurityEvents", () => {
  it("renders the recent-events section (server component)", async () => {
    const html = renderToString(await SecurityEvents());
    expect(html).toContain("Recent security events");
  });
});
