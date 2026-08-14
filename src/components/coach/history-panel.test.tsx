import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { HistoryPanel } from "./history-panel";

describe("HistoryPanel layout invariants", () => {
  it("keeps the truncating title able to shrink beside the fixed stamp", () => {
    const html = renderToString(
      <HistoryPanel
        inboxItems={[]}
        threads={[
          {
            id: "t1",
            title: "A conversation title long enough to need truncation",
            updatedAt: new Date("2026-08-13T09:00:00Z").toISOString(),
            ephemeral: false,
          },
        ]}
        activeThreadId={null}
        unread={0}
        now={new Date("2026-08-13T10:00:00Z")}
      />
    );
    // Sanity: this asserts against real rendered content, not an empty string.
    expect(html).toContain("A conversation title long enough");
    // The stamp column must be shrink-0 AND the title must be allowed to
    // shrink, or widening the stamp to the 12px floor eats the title.
    expect(html).toMatch(/min-w-0[^"]*truncate|truncate[^"]*min-w-0/);
  });
});
