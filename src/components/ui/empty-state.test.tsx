import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Activity } from "lucide-react";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the icon and message", () => {
    const html = renderToString(
      <EmptyState icon={Activity} message="No activities synced yet." />
    );
    expect(html).toContain("No activities synced yet.");
    expect(html).toContain('data-slot="empty-state"');
  });
});
