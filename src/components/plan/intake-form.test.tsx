import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { IntakeForm } from "./intake-form";

const suggested = [0, 60, 45, 0, 90, 120, 150];

const noopAction = async () => ({ message: "" });

describe("intake form", () => {
  it("renders 7 numeric inputs prefilled from the suggested minutes", () => {
    const html = renderToString(
      <IntakeForm suggested={suggested} action={noopAction} />
    );
    const inputs = html.match(/name="mins-\d"/g) ?? [];
    expect(inputs).toHaveLength(7);
    expect(html).toContain('value="150"');
    expect(html).toContain('value="90"');
  });

  it("submit button is labelled Confirm week", () => {
    const html = renderToString(
      <IntakeForm suggested={suggested} action={noopAction} />
    );
    expect(html).toContain("Confirm week");
  });
});
