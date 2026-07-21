import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ImportForm } from "./import-form";

describe("ImportForm", () => {
  it("shows an honest empty state before anything is imported", () => {
    const html = renderToString(<ImportForm />);
    expect(html).toContain(
      "Nothing imported yet. Choose a CSV to map columns."
    );
    expect(html).toContain('data-slot="empty-state"');
  });
});
