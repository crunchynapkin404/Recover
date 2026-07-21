import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ActivityLogEmpty } from "./activity-log-empty";

describe("ActivityLogEmpty", () => {
  it("names the honest empty state for manual activities", () => {
    const html = renderToString(<ActivityLogEmpty />);
    expect(html).toContain(
      "No manual activities logged. Add your first session."
    );
    expect(html).toContain('data-slot="empty-state"');
  });
});
