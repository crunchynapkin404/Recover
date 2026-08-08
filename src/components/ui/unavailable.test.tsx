import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Unavailable, unavailableMessage } from "./unavailable";

describe("unavailableMessage", () => {
  it("phrases calibrating as day N of M", () => {
    expect(
      unavailableMessage({ kind: "calibrating", have: 4, need: 14, unit: "days" })
    ).toBe("Calibrating — day 4 of 14 days");
  });

  it("phrases missing_input as a need", () => {
    expect(
      unavailableMessage({ kind: "missing_input", needs: "an FTP" })
    ).toBe("Needs an FTP");
  });

  it("phrases not_applicable as its reason verbatim", () => {
    expect(
      unavailableMessage({ kind: "not_applicable", why: "no race scheduled" })
    ).toBe("no race scheduled");
  });
});

describe("Unavailable", () => {
  it("renders inline by default", () => {
    const html = renderToString(
      <Unavailable state={{ kind: "calibrating", have: 4, need: 14, unit: "days" }} />
    );
    expect(html).toContain("day 4 of 14 days");
    expect(html).not.toContain("empty-state");
  });

  it("renders a fix link for missing_input when provided", () => {
    const html = renderToString(
      <Unavailable
        state={{
          kind: "missing_input",
          needs: "an FTP",
          fix: { label: "Set FTP", href: "/settings" },
        }}
      />
    );
    expect(html).toContain("Needs an FTP");
    expect(html).toContain("Set FTP");
    expect(html).toContain('href="/settings"');
  });

  it("renders the full empty-state treatment when full is set", () => {
    const html = renderToString(
      <Unavailable state={{ kind: "not_applicable", why: "no race scheduled" }} full />
    );
    expect(html).toContain("no race scheduled");
    expect(html).toContain("data-slot=\"empty-state\"");
  });
});
