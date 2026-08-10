// tests/read-site-guard.test.ts — Phase 2d's second guardrail
// (docs/specs/2026-08-11-source-of-truth-read-site-guard-design.md), Part 2:
// "a source-of-truth guard pinning approved read sites, so a new one fails
// the build."
//
// wellness_daily.ctl/.atl is the RAW PROVIDER INPUT — it arrives from
// intervals.icu only (connectors/intervals.ts) and is null for every day a
// manual-only or Strava-only athlete has ever logged. daily_metrics.ctl/.atl
// is the RESOLVED AUTHORITY: the provider's value wins when present, and
// Recover's native engine fills the gap from activities when it isn't
// (metrics.ts:43-45). Reading wellness_daily directly for ctl/atl silently
// starves an athlete with no intervals.icu connection of a figure Recover
// has actually computed for them — the same defect class v0.10 fixed for
// the dashboard, v0.86.0 fixed for five coach/MCP surfaces, and v0.92.0
// Part 1 (the commit immediately before this one) fixed for three more: the
// Train page's fitness trend, the PMC chart, and volume-inputs.ts's
// ctlBuckets.
//
// WHY THIS COLUMN PAIR, AND ONLY THIS ONE: it is the one with the proven,
// repeated defect history above. Every other column pair in this schema
// might benefit from the same treatment eventually, but pinning a broad
// list up front means guessing which ones actually matter. Same reasoning
// tests/uncertainty-dialects-guard.test.ts gives for listing two retired
// phrases instead of all six the spec named: "It grows one migrated surface
// at a time; do not add an unmigrated phrase here, or this guard fails
// permanently until that surface's own fix lands." This list grows one
// migrated column at a time, the same way.
//
// DETECTION — why a bare `.ctl`/`.atl` match is the wrong tool: daily_metrics
// rows carry their own `.ctl`/`.atl`, and that is the CORRECT thing to read.
// A text match on the bare token would fail the build on exactly the code
// this guard exists to protect (see e.g. src/app/train/page.tsx, which reads
// both `wellness.eftp` and `dailyMetrics.ctl` in the same function).
//
// The heuristic here is narrower and traces the real shape violations took
// (see `git show HEAD~1 -- src/app/train/page.tsx
// src/lib/week-plan/volume-inputs.ts` for the pre-fix code): a
// `db.query.wellnessDaily.findMany(...)`/`findFirst(...)` result bound to a
// local (directly, or destructured out of a `Promise.all([...])` array),
// with `.ctl`/`.atl` then read off that SPECIFIC local — either directly
// (`row.ctl`), through a `for...of` loop, or through an array method
// callback (`.map`/`.find`/`.filter`/`.some`/`.every`/`.forEach`/`.reduce`,
// including a leading `[...local]` spread or a `.reverse()` in the chain).
// The callback/loop check is SCOPED to that specific call's argument text
// (via balanced-paren/brace extraction), not "anywhere in the file" — the
// codebase has files where a loop variable named `w` is bound to
// wellnessDaily in one place and to dailyMetrics in another (same letter,
// different source), and an unscoped file-wide check would conflate them.
//
// Two further unambiguous shapes are flagged independent of variable
// binding: a `columns: { ctl: true }` / `{ atl: true }` restriction inside
// a `db.query.wellnessDaily.find(Many|First)(...)` call (this is how
// src/lib/week-plan/start-state.ts's still-open violation looks — see
// below), and a literal `schema.wellnessDaily.ctl` / `.atl` column
// reference (e.g. inside a raw drizzle `where`/`orderBy`/`select`).
//
// KNOWN LIMITATION, same honesty as its siblings: this is a heuristic over
// syntax shapes, not a type-aware read. It catches the realistic
// reintroduction — a copy-pasted `db.query.wellnessDaily.findMany` plus a
// loop reading `.ctl` off the result, or a `columns: { ctl: true }`
// restriction — not one built through deeper indirection (e.g. threading
// the row through a differently-named parameter two functions away, or
// re-exporting `.ctl` off a generic `Record<string, unknown>`). A pass is
// evidence against the common case, not proof.
//
// ============================================================================
// A GENUINE FOURTH SITE, FOUND WHILE BUILDING THIS GUARD, NOT ALLOWLISTED:
// ============================================================================
// src/lib/week-plan/start-state.ts:173-177 queries
// `db.query.wellnessDaily.findFirst({ ..., columns: { ctl: true, atl: true
// } })` and resolveStartStateFromInputs (same file) reads `args.wellness.ctl`
// / `.atl` off it as the second-priority source (after `persisted`, before
// `sport_rolling`/`global_fallback`) for a training plan's STARTING CTL/ATL/
// TSB. It is wired live into training-plan.ts (lines 1040, 1272, 1506) — not
// dead code. This is the exact defect class this guard exists to catch: for
// a manual-only athlete this read is always null, so start state silently
// skips past a real, already-computed daily_metrics.ctl and falls through to
// sport_rolling or the hardcoded GLOBAL_FALLBACK_CTL/ATL (30/40) — while
// daily_metrics has known the athlete's real CTL the whole time.
//
// The 2026-08-11 survey in the design doc ("Checked against the code, not
// assumed") named three sites and missed this one. Per that same design
// doc's own warning — "a guard cannot ship green over existing violations,
// and pinning the wrong set would freeze a defect in place" — this file is
// NOT added to APPROVED_READERS. Doing so would launder a live, unfixed
// defect into a permanent exception. Test 1 below fails on it, honestly,
// until a Part 3 migrates it the way Part 1 migrated the other three.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const SRC_ROOT = join(REPO_ROOT, "src");

// ── Filesystem walk ─────────────────────────────────────────────────────────

function isTestFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith(".test.tsx");
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkSourceFiles(full, out);
      continue;
    }
    const ext = extname(entry);
    if (ext !== ".ts" && ext !== ".tsx") continue;
    if (isTestFile(entry)) continue;
    out.push(full);
  }
  return out;
}

// ── Small text-scanning primitives ──────────────────────────────────────────

/** Index of the bracket matching the one at `openIndex` (which must hold
 *  `open`), tracking nesting depth. Returns -1 if unbalanced. */
function matchingBracket(
  text: string,
  openIndex: number,
  open: string,
  close: string
): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits `s` on top-level commas only (depth 0 across (), [], {}) — used to
 *  line up a destructured `const [a, b, c] = await Promise.all([x, y, z])`
 *  against the array literal's own entries positionally. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── The heuristic ────────────────────────────────────────────────────────────

/** Every local variable name bound to a wellnessDaily query result: either
 *  `const x = await db.query.wellnessDaily.find(Many|First)(...)` directly,
 *  or `const [a, b, c] = await Promise.all([...])` where the wellnessDaily
 *  call sits at the same position in the array as the variable does in the
 *  destructure (the real shape both migrated Part-1 sites used). */
function findWellnessBoundVariables(text: string): string[] {
  const names = new Set<string>();

  const directRe =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?db\.query\.wellnessDaily\.find(?:Many|First)\s*\(/g;
  for (const m of text.matchAll(directRe)) names.add(m[1]);

  const promiseAllRe =
    /const\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]*?)\n\s*\]\)/g;
  for (const m of text.matchAll(promiseAllRe)) {
    const varNames = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const entries = splitTopLevel(m[2]);
    entries.forEach((entry, i) => {
      if (
        /db\.query\.wellnessDaily\.find(?:Many|First)\s*\(/.test(entry) &&
        varNames[i]
      ) {
        names.add(varNames[i]);
      }
    });
  }

  return [...names];
}

/** Every "iteration scope" over wellness-bound variable `w`: a `for (const p
 *  of w) { ... }` body, or the argument text of a `w.method((p) => ...)` /
 *  `[...w].method((p) => ...)` call (method one of the standard array
 *  read methods, with an optional no-arg chain like `.reverse()` first). */
function findWellnessIterationScopes(
  text: string,
  w: string
): { param: string; body: string }[] {
  const scopes: { param: string; body: string }[] = [];
  const wEsc = escapeRe(w);

  const forOfRe = new RegExp(
    `for\\s*\\(\\s*(?:const|let)\\s+(\\w+)\\s+of\\s+${wEsc}\\s*\\)`,
    "g"
  );
  for (const m of text.matchAll(forOfRe)) {
    const afterIdx = m.index! + m[0].length;
    const braceOffset = text.indexOf("{", afterIdx);
    const between = text.slice(
      afterIdx,
      braceOffset === -1 ? afterIdx : braceOffset
    );
    if (braceOffset !== -1 && /^\s*$/.test(between)) {
      const closeIdx = matchingBracket(text, braceOffset, "{", "}");
      scopes.push({
        param: m[1],
        body: text.slice(
          braceOffset,
          closeIdx === -1 ? undefined : closeIdx + 1
        ),
      });
    } else {
      // Braceless single-statement loop body — take up to the next `;`.
      const semiIdx = text.indexOf(";", afterIdx);
      scopes.push({
        param: m[1],
        body: text.slice(
          afterIdx,
          semiIdx === -1 ? afterIdx + 300 : semiIdx + 1
        ),
      });
    }
  }

  const chainRe = new RegExp(
    `(?:\\[\\s*\\.\\.\\.\\s*${wEsc}\\s*\\]|\\b${wEsc}\\b)` +
      `(?:\\s*\\.\\s*\\w+\\(\\s*\\))*` + // e.g. a leading `.reverse()`
      `\\s*\\.\\s*(?:map|find|filter|some|every|forEach|reduce)\\s*\\(`,
    "g"
  );
  for (const m of text.matchAll(chainRe)) {
    const openParenIdx = m.index! + m[0].length - 1;
    const closeParenIdx = matchingBracket(text, openParenIdx, "(", ")");
    if (closeParenIdx === -1) continue;
    const argsText = text.slice(openParenIdx + 1, closeParenIdx);
    const paramMatch = argsText.match(/^\s*\(?\s*(\w+)/);
    if (paramMatch) scopes.push({ param: paramMatch[1], body: argsText });
  }

  return scopes;
}

/** Every `new Map(w.map(...))` variable name built off wellness-bound `w` —
 *  the shape src/lib/metrics.ts uses (`byDate = new Map(rows.map((r) => ...
 *  ))`) to look a row up by date rather than iterating linearly. Caught
 *  separately from findWellnessIterationScopes because a Map's `.get(...)`
 *  isn't an array-iteration method. */
function findWellnessBoundMaps(text: string, w: string): string[] {
  const names = new Set<string>();
  const re = new RegExp(
    `(?:const|let)\\s+(\\w+)\\s*=\\s*new Map\\(\\s*${escapeRe(w)}\\.map\\(`,
    "g"
  );
  for (const m of text.matchAll(re)) names.add(m[1]);
  return [...names];
}

/** True if `.ctl`/`.atl` is read off wellness-bound variable `w`: directly
 *  (`w.ctl`, `w?.ctl`, including a same-named parameter it was threaded into
 *  elsewhere in the file, e.g. `args.wellness?.ctl`), off the iteration
 *  parameter within a scope genuinely derived from `w`, or through a
 *  `Map(w.map(...))` lookup — either chained directly (`byDate.get(x)?.ctl`)
 *  or via one further local the `.get(...)` result is assigned to (`const
 *  day = byDate.get(x); ...; day?.ctl` — metrics.ts's actual shape). */
function readsCtlAtlFromWellness(text: string, w: string): boolean {
  const wEsc = escapeRe(w);
  const directRe = new RegExp(`\\b${wEsc}\\??\\.(ctl|atl)\\b`);
  if (directRe.test(text)) return true;

  for (const { param, body } of findWellnessIterationScopes(text, w)) {
    const paramRe = new RegExp(`\\b${escapeRe(param)}\\??\\.(ctl|atl)\\b`);
    if (paramRe.test(body)) return true;
  }

  for (const mapVar of findWellnessBoundMaps(text, w)) {
    const mapEsc = escapeRe(mapVar);
    if (
      new RegExp(`\\b${mapEsc}\\.get\\([^()]*\\)\\??\\.(ctl|atl)\\b`).test(text)
    ) {
      return true;
    }
    const hopRe = new RegExp(
      `(?:const|let)\\s+(\\w+)\\s*=\\s*${mapEsc}\\.get\\(`,
      "g"
    );
    for (const hm of text.matchAll(hopRe)) {
      const hopVarRe = new RegExp(`\\b${escapeRe(hm[1])}\\??\\.(ctl|atl)\\b`);
      if (hopVarRe.test(text)) return true;
    }
  }

  return false;
}

/** Every `db.query.wellnessDaily.find(Many|First)(...)` call's balanced
 *  argument text, for the `columns: { ctl: true }` check below. */
function wellnessQueryArgTexts(text: string): string[] {
  const out: string[] = [];
  const callRe = /db\.query\.wellnessDaily\.find(?:Many|First)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text))) {
    const openParenIdx = m.index + m[0].length - 1;
    const closeParenIdx = matchingBracket(text, openParenIdx, "(", ")");
    if (closeParenIdx === -1) continue;
    out.push(text.slice(openParenIdx + 1, closeParenIdx));
  }
  return out;
}

/** Returns a human-readable reason if `text` reads wellness_daily.ctl/.atl
 *  in one of the three shapes this guard understands, or null if clean. */
function findWellnessCtlAtlViolation(text: string): string | null {
  // Unambiguous: a raw drizzle column reference, e.g. inside a where/orderBy.
  if (/schema\.wellnessDaily\.(ctl|atl)\b/.test(text)) {
    return "references schema.wellnessDaily.ctl/.atl directly";
  }

  // Unambiguous: explicitly selecting the columns out of a wellnessDaily
  // query, regardless of what the caller does with the result afterward.
  // This is how src/lib/week-plan/start-state.ts's open violation looks.
  for (const argsText of wellnessQueryArgTexts(text)) {
    if (/\b(?:ctl|atl)\s*:\s*true\b/.test(argsText)) {
      return "restricts a wellnessDaily query's `columns` to include ctl/atl";
    }
  }

  // The realistic shape: query wellnessDaily into a local, then read
  // .ctl/.atl off entries of that local.
  for (const w of findWellnessBoundVariables(text)) {
    if (readsCtlAtlFromWellness(text, w)) {
      return `reads .ctl/.atl off "${w}", bound to a wellnessDaily query result`;
    }
  }

  return null;
}

// ── The allowlist ────────────────────────────────────────────────────────────

interface ApprovedReader {
  /** Path relative to REPO_ROOT. */
  path: string;
  reason: string;
  /** Confirms the file still legitimately touches the column, in whatever
   *  shape is appropriate for *why* it's approved (this is deliberately not
   *  the same function as findWellnessCtlAtlViolation above — that one is
   *  built to avoid false positives on arbitrary new files; this one only
   *  ever runs against these four hand-verified files, so it can afford to
   *  check for the column reference directly rather than through the same
   *  narrow lens). */
  stillReferencesColumn: (text: string) => boolean;
}

const APPROVED_READERS: ApprovedReader[] = [
  {
    path: "src/lib/connectors/intervals.ts",
    reason:
      "Writes ctl/atl INTO wellness_daily from the intervals.icu API payload " +
      "(normalizeWellnessRow: `ctl: num(row.ctl), atl: num(row.atl)`, where " +
      "`row` is the raw provider response, not a DB row). This is the " +
      "column's only writer, not a reader of the stored value.",
    stillReferencesColumn: (text) =>
      /\bctl\s*:\s*num\(/.test(text) && /\batl\s*:\s*num\(/.test(text),
  },
  {
    path: "src/lib/metrics.ts",
    reason:
      "computeDailyMetrics reads wellness_daily.ctl/.atl (the raw provider " +
      "value) specifically to RESOLVE it into daily_metrics via " +
      "resolveEffectiveLoad — `{ ctl: day?.ctl ?? null, atl: day?.atl ?? " +
      "null }` — where `day` comes off the queried wellnessDaily rows via a " +
      "Map keyed by date. This is the resolution step every other file in " +
      "this codebase is supposed to read the OUTPUT of, not a competing read.",
    stillReferencesColumn: (text) =>
      /db\.query\.wellnessDaily\.findMany\(/.test(text) &&
      /\.ctl\s*\?\?\s*null/.test(text) &&
      /\.atl\s*\?\?\s*null/.test(text),
  },
  {
    path: "src/lib/export/export-user.ts",
    reason:
      "exportUserData queries the full wellnessDaily row set and round-trips " +
      "it verbatim into the export (`wellness_daily: wellnessDaily`, typed " +
      "`(typeof schema.wellnessDaily.$inferSelect)[]`). It never destructures " +
      "individual fields — ctl/atl travel along with every other column " +
      "because the whole row is the unit of export/import, the same reason " +
      "db/schema.ts is approved for defining the column.",
    stillReferencesColumn: (text) =>
      /db\.query\.wellnessDaily\.findMany\(/.test(text) &&
      /typeof schema\.wellnessDaily\.\$inferSelect/.test(text),
  },
  {
    path: "src/lib/db/schema.ts",
    reason: "Defines the wellness_daily.ctl/.atl columns themselves.",
    stillReferencesColumn: (text) => {
      const idx = text.indexOf("wellnessDaily = pgTable(");
      if (idx === -1) return false;
      const openIdx = text.indexOf("(", idx);
      const closeIdx = matchingBracket(text, openIdx, "(", ")");
      const body = text.slice(openIdx, closeIdx === -1 ? undefined : closeIdx);
      return /\bctl:\s*real\(/.test(body) && /\batl:\s*real\(/.test(body);
    },
  },
  {
    path: "src/lib/strava-describer.ts",
    reason:
      "ADDED BEYOND THE DESIGN DOC'S NAMED FOUR — found by this guard's own " +
      "scan, justified here rather than silently included. " +
      "buildGeneratedDescription reads `wellness?.ctl`/`.atl` to annotate a " +
      "Strava activity description with CTL/TSB. Unlike the three Part-1 " +
      "sites, this code path is reachable ONLY for activities with " +
      '`provider === "intervals_icu"` (see the two `eq(schema.activities.' +
      'provider, "intervals_icu")` filters gating callers of ' +
      'buildGeneratedDescription, and the module docblock: "deterministic ' +
      'metric template built from intervals.icu data ONLY"). An athlete ' +
      "reaching this function therefore already has an active intervals.icu " +
      "connection, so wellness_daily.ctl is never the empty-for-manual-only " +
      "figure this guard exists to catch here — the defect class doesn't " +
      "apply. It also only affects a cosmetic annotation pushed to Strava, " +
      "not a plan or training decision. Gracefully null-safe either way " +
      '(`on("ctl") && input.ctl != null`).',
    stillReferencesColumn: (text) =>
      /db\.query\.wellnessDaily\.findFirst\(/.test(text) &&
      /wellness\?\.ctl/.test(text) &&
      /wellness\?\.atl/.test(text),
  },
];

const APPROVED_PATHS = new Set(APPROVED_READERS.map((r) => r.path));

// ── Test 1 — no unapproved readers ──────────────────────────────────────────

describe("read-site guard: wellness_daily.ctl / .atl", () => {
  it("fails on any non-approved file reading wellness_daily.ctl/.atl directly", () => {
    const offenders: string[] = [];

    for (const file of walkSourceFiles(SRC_ROOT)) {
      const relPath = relative(REPO_ROOT, file).split("\\").join("/");
      if (APPROVED_PATHS.has(relPath)) continue;

      const text = readFileSync(file, "utf8");
      const violation = findWellnessCtlAtlViolation(text);
      if (violation) {
        offenders.push(
          `${relPath}: ${violation}. wellness_daily.ctl/.atl is the raw ` +
            `provider input — intervals.icu only, and null for every day a ` +
            `manual-only or Strava-only athlete has ever logged. Read the ` +
            `resolved daily_metrics.ctl/.atl instead (via ` +
            `db.query.dailyMetrics), or add this file to APPROVED_READERS ` +
            `in tests/read-site-guard.test.ts with a comment justifying why.`
        );
      }
    }

    if (offenders.length > 0) expect.fail(offenders.join("\n\n"));
  });

  // ── Test 2 — the ratchet ───────────────────────────────────────────────────

  it("keeps APPROVED_READERS a ratchet: every entry still exists and still reads the column", () => {
    const failures: string[] = [];

    for (const entry of APPROVED_READERS) {
      const absPath = join(REPO_ROOT, entry.path);
      let text: string;
      try {
        text = readFileSync(absPath, "utf8");
      } catch {
        failures.push(
          `APPROVED_READERS lists "${entry.path}", which no longer exists ` +
            `on disk. Remove this entry from APPROVED_READERS in ` +
            `tests/read-site-guard.test.ts.`
        );
        continue;
      }

      if (!entry.stillReferencesColumn(text)) {
        failures.push(
          `APPROVED_READERS lists "${entry.path}" as approved to read ` +
            `wellness_daily.ctl/.atl (${entry.reason}), but it no longer ` +
            `does. Remove this entry from APPROVED_READERS in ` +
            `tests/read-site-guard.test.ts — an allowlist entry the code no ` +
            `longer needs is a permission nobody is using, not a safe default.`
        );
      }
    }

    if (failures.length > 0) expect.fail(failures.join("\n\n"));
  });
});
