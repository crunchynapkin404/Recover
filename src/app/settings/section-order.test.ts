import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NAV_ITEMS } from "@/lib/nav-items";

const PAGE = readFileSync("src/app/settings/page.tsx", "utf8");
const CAPTURE = readFileSync("scripts/verify-surfaces.ts", "utf8");

/**
 * The section labels this page renders, in DOM order.
 *
 * Read out of the source rather than a rendered tree on purpose: the page is
 * an async server component that fetches from Postgres in a dozen places, so
 * rendering it in a unit test would mean mocking the database to assert a
 * fact about JSX. The label list IS the fact.
 */
function renderedSections(): string[] {
  return [...PAGE.matchAll(/triggerLabelClass}>([^<]+)</g)].map((m) =>
    m[1].replace(/&amp;/g, "&").trim()
  );
}

/** The labels the capture script clicks open, in its own order. */
function capturedSections(): string[] {
  const block = CAPTURE.match(/for \(const label of \[([\s\S]*?)\]\) \{/);
  if (!block) throw new Error("expandSettingsSections' label list not found");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("settings sections", () => {
  it("renders the six sections in the intended order", () => {
    expect(renderedSections()).toEqual([
      "Integrations",
      "Your baselines",
      "AI & Coach",
      "Advanced / API",
      "App",
      "Data",
    ]);
  });

  // The reason this file exists. expandSettingsSections hardcodes the labels
  // it clicks, and a section missing from that list does NOT fail loudly — it
  // stays collapsed, so the capture photographs a closed row and the axe run
  // audits nothing inside it, while `settings-expanded` still passes. Adding
  // a seventh section and forgetting the script is a silent loss of coverage.
  it("is captured in full — every rendered section is opened by the script", () => {
    const missing = renderedSections().filter(
      (s) => !capturedSections().includes(s)
    );
    expect(missing).toEqual([]);
  });

  it("does not ask the script to open a section that no longer exists", () => {
    const stale = capturedSections().filter(
      (s) => !renderedSections().includes(s)
    );
    expect(stale).toEqual([]);
  });

  // BodyPrefsCard holds wake time, max HR, both FTPs, threshold pace and the
  // four 1RMs — the athlete's own baselines, which every engine figure is
  // computed against. It spent its life under "App", between the push
  // toggles and LLM usage, because it was none of integrations/coach/API/
  // data. That is where an implementer lost real time finding it.
  it("keeps the athlete's baselines under Your baselines, not App", () => {
    const at = (needle: string) => PAGE.indexOf(needle);
    const card = at("<BodyPrefsCard");
    const baselines = at("triggerLabelClass}>Your baselines<");
    const app = at("triggerLabelClass}>App<");

    expect(card).toBeGreaterThan(-1);
    expect(baselines).toBeGreaterThan(-1);
    // The card is inside the baselines section, which itself precedes App.
    expect(card).toBeGreaterThan(baselines);
    expect(card).toBeLessThan(app);
  });

  // The section is addressable: Body links to `?open=baselines#baselines`,
  // and href-carried state is the property the whole tab pattern was chosen
  // for (CHANGELOG "A tab pattern, chosen rather than inherited"). A section
  // that could only be opened by clicking would not survive that contract.
  it("opens the baselines section from the URL", () => {
    expect(PAGE).toContain('<Collapsible id="baselines"');
    expect(PAGE).toContain('defaultOpen={opened === "baselines"}');
  });

  it("is reachable from Body, which had no outbound link before", () => {
    const body = readFileSync("src/app/body/page.tsx", "utf8");
    expect(body).toContain('href="/settings?open=baselines#baselines"');
  });
});

describe("the settings nav item", () => {
  // It was "Menu", and /settings' own <h1> read "Menu" to agree with it —
  // the page renamed itself to match the tab. Every other nav item names the
  // job it opens.
  it("names its destination", () => {
    const item = NAV_ITEMS.find((i) => i.href === "/settings");
    expect(item?.label).toBe("Settings");
    expect(NAV_ITEMS.map((i) => i.label)).not.toContain("Menu");
  });

  it("agrees with the page's own heading", () => {
    expect(PAGE).toContain(">Settings</h1>");
    expect(PAGE).not.toContain(">Menu</h1>");
  });

  // The avatar button on Today goes to the same place, and a screen-reader
  // user hears only its accessible name before following it.
  it("agrees with Today's avatar button", () => {
    const today = readFileSync("src/app/page.tsx", "utf8");
    expect(today).toContain('aria-label="Settings"');
    expect(today).not.toContain('aria-label="Menu"');
  });
});
