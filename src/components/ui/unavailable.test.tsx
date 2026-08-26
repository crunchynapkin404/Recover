import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Unavailable, unavailableMessage } from "./unavailable";

describe("unavailableMessage", () => {
  it("phrases calibrating as day N of M", () => {
    expect(
      unavailableMessage({
        kind: "calibrating",
        have: 4,
        need: 14,
        unit: "days",
      })
    ).toBe("Calibrating — day 4 of 14 days");
  });

  it("phrases missing_input as a need", () => {
    expect(unavailableMessage({ kind: "missing_input", needs: "an FTP" })).toBe(
      "Needs an FTP"
    );
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
      <Unavailable
        state={{ kind: "calibrating", have: 4, need: 14, unit: "days" }}
      />
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
      <Unavailable
        state={{ kind: "not_applicable", why: "no race scheduled" }}
        full
      />
    );
    expect(html).toContain("no race scheduled");
    expect(html).toContain('data-slot="empty-state"');
  });

  // The bug this file did not catch. Every `full` case above is a state that
  // HAS no fix — not_applicable and calibrating never carry one — so nothing
  // here ever handed `full` a fix to drop, and dropping it silently passed
  // for as long as the treatment existed.
  it("renders the fix link in the full treatment too", () => {
    const html = renderToString(
      <Unavailable
        full
        state={{
          kind: "missing_input",
          needs: "wellness data",
          fix: { label: "Connect a device", href: "/" },
        }}
      />
    );
    expect(html).toContain("Needs wellness data");
    expect(html).toContain('data-slot="empty-state"');
    expect(html).toContain("Connect a device");
    expect(html).toContain('href="/"');
  });

  it("renders no link in the full treatment when there is nothing to fix", () => {
    const html = renderToString(
      <Unavailable full state={{ kind: "missing_input", needs: "an FTP" }} />
    );
    expect(html).toContain("Needs an FTP");
    expect(html).toContain('data-slot="empty-state"');
    expect(html).not.toContain("<a");
  });
});

describe("the first-run screens no longer hand-render the fix link", () => {
  // Train, Body and Coach each worked around the dropped fix by rendering
  // their own <Link> as a sibling — so the label and the href existed twice
  // per site, once in the state object and once in the markup, free to drift.
  // The component owns it now, and this fails if a call site reintroduces a
  // copy of the CTA rather than passing `fix`.
  const CTA =
    "rounded-2xl bg-accent px-6 py-3 font-bold text-accent-foreground";

  it("defines the full-treatment CTA in exactly one place", () => {
    const files = [
      "src/components/ui/unavailable.tsx",
      "src/app/train/page.tsx",
      "src/app/body/page.tsx",
      "src/app/coach/page.tsx",
    ];
    const owners = files.filter((f) => readFileSync(f, "utf8").includes(CTA));
    expect(owners).toEqual(["src/components/ui/unavailable.tsx"]);
  });

  it("still hands each first-run screen a fix to render", () => {
    for (const f of [
      "src/app/train/page.tsx",
      "src/app/body/page.tsx",
      "src/app/coach/page.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("Connect a device or log manually");
      expect(src, f).toContain("fix:");
    }
  });
});
