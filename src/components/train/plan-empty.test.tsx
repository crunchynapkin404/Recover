import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PlanEmpty } from "./plan-empty";

describe("PlanEmpty", () => {
  it("names the honest next step, not a blank card", () => {
    const html = renderToString(<PlanEmpty />);
    expect(html).toContain(
      "No plan yet — generate one from a race goal, or plan just this week."
    );
    expect(html).toContain('data-slot="empty-state"');
  });

  it("keeps the existing next-step control to the coach", () => {
    const html = renderToString(<PlanEmpty />);
    expect(html).toContain('href="/coach"');
  });
});
