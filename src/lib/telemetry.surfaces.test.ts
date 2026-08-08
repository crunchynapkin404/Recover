import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SURFACES } from "./telemetry";

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

  it("mounts SurfaceViewsCard on /admin, reading from surfaceViewTotals", () => {
    const src = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(src).toContain("surfaceViewTotals(");
    expect(src).toContain("<SurfaceViewsCard");
  });
});
