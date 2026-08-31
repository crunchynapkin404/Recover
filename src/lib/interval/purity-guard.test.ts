import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "src/lib/interval");

/**
 * Strip comments before matching, the way motion-scale-guard.test.ts does.
 * Prose must be unable to trip a guard — and equally unable to satisfy one,
 * which is why this strips rather than skips files that mention a banned
 * term. Safe here because this module has no string literal containing `//`;
 * revisit if one ever appears.
 *
 * This is not hypothetical tidiness. The first draft of this slice's plan
 * mandated the doc comment "Targets are ALWAYS % of FTP, never watts" in
 * types.ts and then checked the module with `grep -rniE "\bwatt|…"`, which
 * matches inside "watts" — so the slice could not pass its own proof step.
 * docs/2026-08-31-visual-polish-handoff.md records that same trap springing
 * four times in one strand. The fix is the guard, never the prose.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sources(): [string, string][] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => [f, code(readFileSync(join(DIR, f), "utf8"))]);
}

describe("src/lib/interval stays a pure module", () => {
  it("reaches no database, no clock and no randomness", () => {
    // What makes it callable from a test and from the MCP surface, exactly
    // as strengthPrescription is.
    const banned = /from "@\/lib\/db"|new Date\b|Date\.now|Math\.random/;
    for (const [file, src] of sources()) {
      expect(src, `${file} broke the pure-module contract`).not.toMatch(banned);
    }
  });

  it("names no absolute power", () => {
    // Every target here is % of FTP. Resolution against the athlete's own
    // FTP happens later and elsewhere — and per the spec, no renderer needs
    // an FTP at all.
    const banned = /\bwatts?\b|\bftpWatts\b|\btargetLoadKg\b/i;
    for (const [file, src] of sources()) {
      expect(src, `${file} named an absolute power`).not.toMatch(banned);
    }
  });

  it("has files to check", () => {
    // A guard that silently scans nothing passes forever. The handoff records
    // a whole guard going dark while the headline test count went UP.
    expect(sources().length).toBeGreaterThanOrEqual(4);
  });
});
