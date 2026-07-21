import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StreamDataEmpty } from "./stream-data-empty";

describe("StreamDataEmpty", () => {
  it("names the missing stream data honestly by default", () => {
    const html = renderToString(<StreamDataEmpty />);
    expect(html).toContain("This activity has no stream data to chart yet.");
    expect(html).toContain('data-slot="empty-state"');
  });

  it("keeps the fetch-failed message distinct from the no-data message", () => {
    const html = renderToString(<StreamDataEmpty reason="fetch_failed" />);
    // renderToString HTML-escapes the apostrophe in "Couldn't", so match
    // around it rather than embedding a literal ' in the expected string.
    expect(html).toContain(
      "load detailed data from intervals.icu right now — the summary above is still accurate."
    );
    expect(html).not.toContain("no stream data to chart yet");
  });
});
