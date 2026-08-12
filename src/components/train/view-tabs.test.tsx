import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ViewTabs, currentYm } from "./view-tabs";
import type { LogHref } from "@/lib/log-href";

const href: LogHref = (over) => `/train?view=${over.view ?? "week"}`;

describe("ViewTabs", () => {
  it("renders the three periods and marks the active one", () => {
    const html = renderToString(
      <ViewTabs active="week" month={currentYm()} href={href} />
    );
    expect(html).toContain("Today");
    expect(html).toContain("Week");
    expect(html).toContain("Month");
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("shows the month picker only in month view", () => {
    const week = renderToString(
      <ViewTabs active="week" month={currentYm()} href={href} />
    );
    const month = renderToString(
      <ViewTabs active="month" month={currentYm()} href={href} />
    );
    // Six trailing months, each its own link, plus the active segment.
    expect((month.match(/aria-current="true"/g) ?? []).length).toBeGreaterThan(
      1
    );
    expect((week.match(/aria-current="true"/g) ?? []).length).toBe(1);
  });

  it("uses the token type and ink scale, and dims nothing with bare opacity", () => {
    const html = renderToString(
      <ViewTabs active="month" month={currentYm()} href={href} />
    );
    expect(html).toMatch(/text-label/);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    // `opacity-40` / `opacity-30` on a whole link is ink done as opacity —
    // the exact class of sub-AA value this release exists to remove, and
    // invisible to the ratchet, which only counts white/N and text-[Npx].
    expect(html).not.toMatch(/\bopacity-(30|40)\b/);
    // The repo avoids blue for accents (races-section.tsx:61 says so).
    expect(html).not.toMatch(/bg-blue-400/);
  });
});
