import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SURFACES, SURFACE_TABS, surfaceViewKeys } from "./telemetry";
import { BODY_TABS, TRAIN_TABS } from "./log-href";

/** Every page.tsx under src/app, as repo-relative paths. */
function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pageFiles(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

describe("surface instrumentation", () => {
  it("records a view on every authenticated page", () => {
    const missing: string[] = [];
    for (const file of pageFiles("src/app")) {
      const src = readFileSync(file, "utf8");
      const authenticated =
        src.includes("requireUser()") || src.includes("requireSession()");
      if (!authenticated) continue;
      if (!src.includes("recordSurfaceView(")) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  it("uses only keys declared in SURFACES", () => {
    const used = new Set<string>();
    for (const file of pageFiles("src/app")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/recordSurfaceView\([^,]+,\s*"([^"]+)"/g)) {
        used.add(m[1]);
      }
    }
    const declared = new Set<string>(SURFACES);
    expect([...used].filter((s) => !declared.has(s))).toEqual([]);
  });

  // The regex above matches the SURFACE argument only. Once train and body
  // began passing a third argument the surface stayed a literal, so that
  // test kept passing while saying nothing about the tab — the exact shape
  // of gap the tabbed keys were added to close. These two cover the rest.
  it("passes a tab at every call site whose surface has tabs", () => {
    const missing: string[] = [];
    for (const file of pageFiles("src/app")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(
        /recordSurfaceView\([^,]+,\s*"([^"]+)"\s*([,)])/g
      )) {
        const [, surface, next] = m;
        const tabbed = surface in SURFACE_TABS;
        // `,` means a third argument follows; `)` means the call ended.
        if (tabbed && next === ")") missing.push(`${file}: ${surface}`);
        if (!tabbed && next === ",") missing.push(`${file}: ${surface} +tab`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("declares a key for every tab the nav can actually reach", () => {
    const keys = new Set(surfaceViewKeys());
    // Reads TRAIN_TABS/BODY_TABS directly — the lists the tab rows and href
    // builders use. While SURFACE_TABS imports those, adding a tab to the nav
    // extends the counter automatically and this cannot fail; what it catches
    // is someone replacing the import with a hand-written list, which is the
    // one edit that would let the two sets drift. Verified by mutation:
    // restating `train:` as a literal missing "fitness" fails this test.
    for (const tab of TRAIN_TABS) expect(keys).toContain(`train:${tab}`);
    for (const tab of BODY_TABS) expect(keys).toContain(`body:${tab}`);
    expect(surfaceViewKeys()).toHaveLength(
      SURFACES.length + TRAIN_TABS.length + BODY_TABS.length
    );
  });

  it("keeps the bare parent keys that pre-v0.121 rows carry", () => {
    // train/body are no longer written bare, but stored rows have them and
    // surfaceViewTotals reads storage, not the call sites.
    expect(surfaceViewKeys()).toContain("train");
    expect(surfaceViewKeys()).toContain("body");
  });

  it("mounts SurfaceViewsCard on /admin, reading from surfaceViewTotals", () => {
    const src = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(src).toContain("surfaceViewTotals(");
    expect(src).toContain("<SurfaceViewsCard");
  });
});
