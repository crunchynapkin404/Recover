// scripts/verify-surfaces.ts — Phase 2b.4 verification.
// Captures each surface in both themes at two viewports, then audits the
// same loaded page with axe-core (Task 7) before moving on. One browser
// pass does both jobs because they need the same signed-in, correctly
// themed, correctly-navigated page — building that twice would just be two
// chances for the two copies to drift. Light mode is forced by setting the
// class directly, which is why ThemeProvider's forcedTheme="dark" does not
// blind us to it — see forceThemeVerified below for how that forcing is
// confirmed rather than assumed.
//
// Why axe runs here and not as a vitest-axe unit test (like the existing
// src/components/body/journal-form.axe.test.tsx): nine of this app's
// surfaces are async server components that read Postgres. They do not
// render in jsdom at all, and jsdom computes no layout, so even a surface
// that did render there would show no contrast or overlap violation —
// component-level axe on these pages would be a test that passes without
// checking anything. Axe therefore runs against the real rendered page in
// the real headless browser this script already drives.
//
// Usage: npm run verify:surfaces -- <slice-name>
//        (equivalently: npx tsx scripts/verify-surfaces.ts <slice-name>)
//
// IT IS NOT A CI GATE, AND THE SPEC WAS WRONG TO CALL IT ONE (I8,
// whole-branch review 2026-08-11). It is a named local pre-merge step, which
// is what docs/specs/2026-08-11-2b4-visual-redesign-design.md's
// "Real-browser screenshots" section always said and what its "Guards that
// fail the build" section contradicted. CONTRIBUTING.md's "Can this run in
// CI?" subsection has the four things that would have to change first —
// including that a zero-threshold gate would fail every pull request from
// slice 0 to slice 8, because the recorded baseline is deliberately non-zero.
//
// Output: .screenshots/<slice-name>/*.png, plus
//         .screenshots/<slice-name>/axe-report.json — one entry per
//         surface/theme/viewport, with axe's "violations" and "incomplete"
//         results (see auditPage's doc comment for why "incomplete" is
//         requested at all — the brief's literal resultTypes: ["violations"]
//         silently misses real invisible-text bugs behind this app's
//         gradient backgrounds) filtered to "serious"/"critical" impact and
//         then split into TWO separate metrics (task-7 review, Finding 1;
//         classification lives in scripts/lib/axe-report.ts):
//
//           CONFIRMED — axe actually computed a failure: every
//           "violations"-bucket result, plus every "incomplete"-bucket node
//           for which axe resolved both colours, computed a ratio, and that
//           ratio fails the threshold axe itself reports alongside it. That
//           covers messageKey "equalRatio" (1:1, invisible text) AND
//           "shortTextContent" (one-character text — `%`, `·`, lone digits,
//           single-letter axis labels — which axe files as incomplete purely
//           because of its length). Requiring "equalRatio" alone was C3 in
//           the whole-branch review: a page whose sole defect was a single
//           digit at 3.45:1 exited 0. This is what process.exitCode gates on.
//
//           INDETERMINATE — "incomplete"-bucket nodes axe could not compute
//           an answer for at all (composited gradient backgrounds, partial
//           obscuring, non-BMP glyphs such as this app's ▲/▼ trend arrows,
//           and short text over a background axe could not resolve — see
//           auditPage's doc comment). Reported
//           prominently, in the JSON and the console summary, but NEVER
//           gates the exit code — on this app's four gradient-background
//           surfaces (today/train/coach/body) axe's color-contrast rule can
//           structurally never resolve, so gating on it would make "drive
//           the number to zero" unfalsifiable regardless of what a slice
//           fixes. It is still a real, trending-to-zero number: it counts
//           text with no opaque backing, which is exactly what giving cards
//           real surface tokens fixes — just via a different mechanism (the
//           count shrinking) than the exit-code gate.
//
//           DO NOT re-merge these two counts. See scripts/lib/axe-report.ts's
//           file header and isComputedFailure's doc comment for why that
//           would silently reintroduce the unfalsifiable-exit-code bug, and
//           tests/axe-report-split.test.ts / scripts/axe-split-proof.ts for
//           committed, re-runnable proof the split discriminates correctly
//           in both directions.
//
//         Report leads with NODE-level counts, not rule-row counts: a
//         seeded-data re-measurement found the rule-row count move 46→44
//         while the node count moved 1398→1687 (+20.7%, Train +600%, Today
//         +240%) — rule-row counting hid a real regression. See
//         docs/axe-baseline-2026-08-11-seeded.md.
//
//         Written incrementally after every audited surface, not just once
//         at the end (task-7 review, Finding 4) — a crash partway through
//         still leaves every finding collected so far on disk.
//
// Required environment (task-6 review, Finding 5 — this header is the
// canonical list; CONTRIBUTING.md's "Demo data" section points here):
//   CHROME_PATH        Path to a headless Chromium/chrome-headless-shell
//                       binary. This sandbox has no sudo, so Playwright's
//                       bundled browser needs LD_LIBRARY_PATH pointed at
//                       extracted system libs too — see Task 6 Step 1 in
//                       docs/plans/2026-08-11-v099-slice0-foundations.md.
//   LD_LIBRARY_PATH     See above.
//   PLAYWRIGHT_CORE     Optional. Overrides the default npx-cache path below
//                       when the cached version drifts from what's here.
//   SCREENSHOT_BASE_URL REQUIRED, no default — this block used to say
//                       "Optional, default http://localhost:3000", which the
//                       code below stopped being true of when C4 made it fail
//                       closed. On this machine port 3000 is *permanently* the
//                       live production container and this script is refused
//                       outright if pointed there. Start
//                       the dev server on another port — 3200 while a
//                       slice is in progress, since 3100 is the RC soak
//                       stack and holds a RELEASED image, not your work —
//                       with BETTER_AUTH_URL/TRUSTED_ORIGINS matching that
//                       origin — without it, secure-cookie mode drops the
//                       session and every authenticated capture is a login
//                       page — and pass the same origin here.
//   OWNER_EMAIL,        Real, seeded credentials on the target database —
//   OWNER_PASSWORD      the same pair CONTRIBUTING.md's `npm run db:seed`
//                       and src/lib/bootstrap.ts already use (this script
//                       used to call them SMOKE_EMAIL/SMOKE_PASSWORD; that
//                       was a needless second name for the same account —
//                       renamed to match the repo's one convention). Must
//                       be an owner: /admin redirects non-owner roles away,
//                       and it is one of the required surfaces.
//
// Dev-DB debris, expected: every run through captureTokenCreated mints a
// fresh api_tokens row labelled `screenshot-verify-<theme>-<viewport>-
// <timestamp>` (see the label below) and revokes it before exiting. Revoked,
// so not a leak — but the rows themselves are never deleted, and repeated
// runs of this script accumulate them on whatever database
// SCREENSHOT_BASE_URL points at. A 2026-08-12 pass found 76 such rows on the
// dev database from earlier capture runs, inflating admin/settings surface
// counts (session/token lists) well past what a real account would show.
// Clean them up periodically with a query scoped to that label prefix —
// never touch a row that doesn't match it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Page } from "playwright-core";
import type Axe from "axe-core";
import { hexToRgb } from "../src/lib/design/contrast";
import { resolvedThemeTokens } from "../src/lib/design/tokens";
import { BLOCK_ORDER } from "../src/lib/today/block-order";
import type { TodayState } from "../src/lib/today/state";
import {
  splitFindings,
  computeTotals,
  type AxeFinding,
} from "./lib/axe-report";
import { selectSurfaces } from "./lib/surface-select";
import { axeGateEnabled } from "./lib/axe-gate";

// playwright-core is an exact-pinned devDependency as of v0.104.0. It used to
// resolve ONLY from an npx cache path baked into this file
// (~/.npm/_npx/<content-hash>/…), which did not survive moving to the new dev
// box on 2026-08-14: no npx cache, no chromium, and every redesign slice
// unverifiable until it was fixed. Undeclared tooling is tooling that stops
// existing when the machine changes. See
// docs/specs/2026-08-16-dev-prod-gate-design.md §2.
//
// Run `npm run dev:browser-setup` once per machine for the matching browser.
// The pin is exact, not a caret range: playwright-core and its chromium
// revision are a matched pair, and `npm ci` resolving a newer driver against
// an older installed browser is the same class of breakage all over again.
//
// PLAYWRIGHT_CORE remains an escape hatch for a machine whose installed
// revision differs from the pin.
const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE ?? "playwright-core";
let chromium: typeof import("playwright-core").chromium;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ chromium } = require(PLAYWRIGHT_CORE));
} catch {
  throw new Error(
    `Cannot load playwright-core from ${PLAYWRIGHT_CORE}. Run ` +
      `\`npm ci && npm run dev:browser-setup\`, or set PLAYWRIGHT_CORE to a ` +
      `copy whose playwright-core/browsers.json chromium revision matches a ` +
      `directory in ~/.cache/ms-playwright.`
  );
}

// FAILS CLOSED, DELIBERATELY. There is no default. This script signs in as
// the owner, walks every surface, and creates a real API token through the
// real UI. An earlier version defaulted to port 3000, which on the old
// single-box setup WAS the live production container — running it with no env
// var would have driven all of the above against production and, if
// revocation failed, left a live API token behind.
//
// TWO REFUSALS, AND THEY GUARD DIFFERENT THINGS (v0.104.0):
//
//   1. Port 3000. Kept, though on the current dev box nothing production runs
//      there — because a self-hoster following docs/SELF-HOSTING.md serves
//      their real instance on exactly that port, and this file is public. It
//      costs nothing to obey: run the dev server on 3200. 3100 is the RC
//      soak stack (recover-rc-app-1) — the right target when verifying a
//      RELEASE CANDIDATE (docs/RELEASING.md step 7), the wrong one while a
//      slice is in progress, because it serves a released image.
//
//   2. The production HOST. Added when the project moved to a dev box and a
//      prod box on 2026-08-14 (docs/ENVIRONMENTS.md). The port rule was a
//      proxy for "is this production", and the move falsified it in the
//      dangerous direction: http://10.0.10.100:3000 is the athlete's live
//      instance and the port check let it through, because the port is not
//      what makes it production any more. Refusing the host is the check
//      that actually means what the original intended.
const PRODUCTION_HOSTS = ["10.0.10.100", "prod"];

const BASE_URL = (() => {
  const url = process.env.SCREENSHOT_BASE_URL;
  if (!url) {
    throw new Error(
      "SCREENSHOT_BASE_URL is required — this script has no default on purpose.\n" +
        "Point it at a DEV server, never production.\n" +
        "While a slice is in progress use 3200, not 3100: 3100 is\n" +
        "recover-rc-app-1, the RC soak stack, so capturing it measures a\n" +
        "RELEASED image rather than your working tree. (3100 IS the right\n" +
        "target when verifying a release candidate — docs/RELEASING.md.)\n" +
        "  BETTER_AUTH_URL=http://localhost:3200 TRUSTED_ORIGINS=http://localhost:3200 npx next dev -p 3200\n" +
        "  SCREENSHOT_BASE_URL=http://localhost:3200 npm run verify:surfaces -- <slice>\n" +
        "See docs/ENVIRONMENTS.md for which box is which."
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`SCREENSHOT_BASE_URL is not a valid URL: ${url}`);
  }

  if (PRODUCTION_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to run against ${url} — ${host} is the PRODUCTION box ` +
        `(docs/ENVIRONMENTS.md). This script signs in as the owner and creates ` +
        `a real API token. Run it against a dev server.`
    );
  }

  if (/localhost:3000|127\.0\.0\.1:3000/.test(url)) {
    throw new Error(
      `Refusing to run against ${url} — port 3000 is where a self-hosted ` +
        `production instance serves (docs/SELF-HOSTING.md). This script ` +
        `creates real data. Use a dev server on 3200 for slice work, or ` +
        `the RC stack on 3100 when verifying a release candidate.`
    );
  }

  return url;
})();

const SURFACES: Record<string, string> = {
  // `?state=morning` is NOT redundant with the bare path, and leaving it off
  // made this surface wall-clock dependent. TODAY_STATE_BY_SURFACE says this
  // surface stands in for "morning", and assertBlockOrder checks the rendered
  // blocks against BLOCK_ORDER.morning — but `/` renders whatever
  // resolveTodayState() derives from the clock, and EVENING_HOUR is 18. So the
  // run passed before 18:00 local and failed after it, and it additionally
  // made `today` byte-identical to `today-evening`, which assertTodayStatesDiffer
  // correctly refuses to report as a pass.
  //
  // It went unnoticed for as long as this script was only ever run by a person
  // during the working day. Making the capture a blocking CI gate (v0.115.0)
  // turned that into a job that failed every evening — found at 18:20 UTC on
  // run 32401663053, on a docs-only pull request that changed nothing.
  today: "/?state=morning",
  // Today is state-aware from v0.99 slice 1. `?state=` only REORDERS blocks
  // and is refused outright in production (previewStateFrom in
  // src/lib/today/state.ts returns null when NODE_ENV === "production"), so
  // these two capture the same real seeded athlete at two other moments —
  // no data is faked. Their captures are checksum-compared at the end of
  // main(); see assertTodayStatesDiffer for why that is not optional.
  "today-post-session": "/?state=post-session",
  "today-evening": "/?state=evening",
  // Train is FOUR tabs behind one path, and `/train` alone captures only the
  // first. v0.99 slice 2 redesigned all four — including the two hardest
  // cases on the surface, History's fixed-height row and the Season
  // timeline's "cannot fit" restructure — and neither was reachable by this
  // script until they were named here. A tab that cannot be captured cannot
  // be checked against its own axe run or looked at in a PNG, which is the
  // only way two of slice 1's defects were ever found.
  train: "/train",
  "train-history": "/train?tab=history",
  "train-season": "/train?tab=season",
  "train-fitness": "/train?tab=fitness",
  // A two-A-race plan preview. Same PATH as `train` — the card only renders
  // when the athlete has an open draft, so the state is the surface, not the
  // URL. It gets its own entry because `train` promises nothing about a
  // preview and would pass happily without one, while THIS name promises two
  // arcs; `assertOnSurface` compares pathname only, so the guard in
  // SURFACE_PREPARE is what makes the promise true. Requires
  // scripts/seed-two-race.ts to have run — seed-demo.ts seeds no races and no
  // plans, so without it this surface fails loudly rather than filing the
  // single-race path under a two-race name.
  "train-plan-preview": "/train",
  // Also same PATH as `train`, and same reasoning as `train-plan-preview`
  // above — the race card's pacing line only renders once the athlete has a
  // CONFIRMED plan, and neither `train` nor `train-plan-preview` ever reach
  // that branch: `seed-demo.ts` seeds no plan at all, and `seed-two-race.ts`
  // deliberately stops at a draft. So this state had never been captured —
  // a regression deleting the pacing line outright would pass every gate.
  // See docs/2026-08-20-pacing-capture-gap.md. Requires
  // scripts/seed-confirmed-race.ts to have run, BEFORE seed-two-race.ts (it
  // would otherwise delete that script's two-arc draft — see this script's
  // own file header).
  "train-race-pacing": "/train",
  // Coach is a multi-state surface behind one URL, and `/coach` alone renders
  // `messages.length === 0` — the empty state. Until slice 4, every message
  // bubble, the timestamp, ArtifactCard, the typing indicator and the error
  // banner had never been captured or axe-audited, and neither had the
  // History panel. Same gap slice 2 closed for Train's tabs and slice 3 for
  // Body's; found the same way, by asking which state a PNG was actually of.
  // The thread surface cannot be a literal — its id is a uuid — so it is
  // resolved through the UI in main(); see resolveCoachThreadPath.
  coach: "/coach",
  "coach-history": "/coach?history=1",
  // Body is FOUR tabs behind one path and `/body` alone captures only the
  // first (Trends). Sleep, Journal and Labs had never been captured or
  // axe-audited by this script before v0.99 slice 3 — the same gap slice 2
  // closed for Train's four tabs, found the same way: by asking which tab a
  // PNG was actually of.
  body: "/body",
  "body-sleep": "/body?tab=sleep",
  "body-journal": "/body?tab=journal",
  "body-labs": "/body?tab=labs",
  // Settings is FIVE <Collapsible> sections behind one path, all closed on
  // load, and `/settings` alone captures none of their contents. Integrations
  // (six connector cards), AI & Coach, App and Data had never been captured or
  // axe-audited before v0.99 slice 5 — the fifth, Advanced / API, only ever
  // opened inside captureTokenCreated's own click. The same gap slice 2 closed
  // for Train's tabs and slice 3 for Body's, at four times the size.
  // `settings` is kept as the collapsed landing state; `settings-expanded`
  // opens all five (see SURFACE_PREPARE).
  settings: "/settings",
  "settings-expanded": "/settings",
  // The three OAuth failure branches. page.tsx reads strava_error, whoop_error
  // and withings_error from searchParams and hands each to a card's errorParam
  // prop; they render for nothing else, so no capture had ever reached them.
  // One load sets all three — they are independent cards on one page, and
  // three loads would audit the same DOM three times for one branch each.
  //
  // RESOLVED (v0.106 slice 5 Settings redesign, task 11, 2026-08-17): the
  // params above read `access_denied`, but all three cards' ERROR_MESSAGES
  // maps (strava-card.tsx, whoop-card.tsx, withings-card.tsx) key on
  // `denied`, not `access_denied` — `state_mismatch`, `rejected` and `failed`
  // are the other three keys, none of them this either. The lookup returned
  // undefined and every card fell through to its
  // `Last error: ${connection?.lastError}` fallback, which for the soak DB's
  // already-connected demo accounts prints the literal string
  // `Last error: null`. So since this surface shipped in v0.105.0 it has
  // audited that fallback string, never the three OAuth error messages it
  // exists to check — a true confirmed=0 that proved less than it claimed.
  // Changed to `denied` below, which is a real key in all three maps.
  "settings-connect-errors":
    "/settings?strava_error=denied&whoop_error=denied&withings_error=denied",
  admin: "/admin",
  import: "/import",
  // activity-log is the manual-entry form, not the detail page an athlete
  // opens on a ride. The activity id is a per-database uuid, so that page
  // cannot be a literal SURFACES entry — it is resolved through the UI in
  // main() by resolveActivityDetailPath, the same shape as coach-thread.
  "activity-log": "/activity/log",
  login: "/login",
  /**
   * The check-in sheet, which no capture has ever opened either — the same
   * gap debrief-sheet carried until v0.108 slice 6, found the same way: by
   * asking which states of Today have actually been rendered.
   *
   * `docs/ROADMAP.md` recorded it under 2b.4 slice 1 as "dark-only and below
   * the 12px floor", and the v0.111.0 sweep fixed both — there is no
   * dark-only literal and no arbitrary type size left in the file. What the
   * roadmap line did not say, and what mattered more, is that the surface was
   * never CAPTURED, so "0 confirmed axe nodes" had never included it. Fixed
   * defects nobody has looked at are still unverified.
   *
   * A literal, unlike debrief-sheet: `?sheet=checkin` needs no id, because
   * SheetHost reads the athlete's own recent wellness rows.
   */
  "checkin-sheet": "/?sheet=checkin",
  // The debrief sheet, which no capture has ever opened. It is a <Sheet>,
  // closed on load, reached only by ?sheet=debrief — so slice 1 declared
  // Today clean in v0.100.0 without it ever having been rendered, and
  // slice 6 inherits it. debrief-sheet.tsx is the largest single offender
  // in Activity's chain (11 arbitrary sizes, 17 ad-hoc alphas, 15 bare
  // whites) and is shared between Today and /activity/[id].
  //
  // Deep-linked with an explicit activity id rather than bare
  // ?sheet=debrief: SheetHost's no-id path looks for debriefState
  // "pending", which is NULL on every seeded row. The id is not a literal
  // either — it is wired in main() from resolveActivityDetailPath's
  // return value, same as activity-detail.
};

/**
 * Which TodayState each Today surface is standing in for — the key
 * assertBlockOrder needs to look up the right row of BLOCK_ORDER. Kept next
 * to SURFACES rather than re-deriving it from the `?state=` query string, so
 * adding a fourth Today surface later is a one-line addition here rather
 * than a URL-parsing exercise.
 */
const TODAY_STATE_BY_SURFACE: Record<string, TodayState> = {
  today: "morning",
  "today-post-session": "post-session",
  "today-evening": "evening",
};

/**
 * Per-surface DOM preparation, run after the theme is forced and BEFORE both
 * the screenshot and the axe audit — so whatever it opens is photographed and
 * audited, not just one of the two.
 *
 * Settings needs this because its content lives in five <Collapsible> sections
 * that are closed on load. Integrations (six connector cards), AI & Coach, App
 * and Data had therefore never been photographed or audited at all, and
 * Advanced / API only ever inside captureTokenCreated. Same class of gap as
 * Train's tabs (slice 2), Body's tabs (slice 3) and Coach's thread state
 * (slice 4); found the same way, by asking which state a PNG was actually of.
 *
 * Both Settings surfaces that need content open share one opener: the error
 * branches live on cards inside the Integrations section, so
 * settings-connect-errors has to expand it too or it photographs a collapsed
 * page with three invisible error messages.
 */
/**
 * Wait until the full-page height stops changing, then screenshot.
 *
 * `page.screenshot({ fullPage: true })` snapshots whatever
 * `document.scrollHeight` is at that instant. Several surfaces open animated
 * containers first — `.collapsible-panel` carries `transition: height 0.3s
 * ease-out` (globals.css) — and the openers above wait for a child element to
 * become VISIBLE, which happens as soon as a panel starts expanding, not when
 * it has finished. Fire the shot in that window and the PNG is a short page.
 *
 * That is not hypothetical. Releasing v0.119.0 on 2026-08-24, one soak run
 * captured `settings-connect-errors` at 5217px in dark and 3649px in light —
 * the same surface, the same run — and `settings-expanded` came back ~1300px
 * shorter than the release before it, on a release that ADDED a settings
 * section. Nothing failed: a truncated full-page PNG is indistinguishable
 * from a passing one, which makes this precisely the class of blind spot
 * step 8 of docs/RELEASING.md exists to catch, and precisely the class it
 * cannot catch unaided.
 *
 * Polls scrollHeight until it repeats `STABLE_READINGS` times in a row, so a
 * mid-transition plateau does not read as settled. Falls through on timeout
 * rather than throwing: a slightly-early screenshot is worth strictly more
 * than no screenshot, and the surface guards elsewhere in this file already
 * refuse a page whose named content is missing.
 */
const HEIGHT_POLL_MS = 100;
const HEIGHT_STABLE_READINGS = 3;
const HEIGHT_TIMEOUT_MS = 5_000;

async function screenshotStable(
  page: Page,
  options: { path: string }
): Promise<void> {
  const deadline = Date.now() + HEIGHT_TIMEOUT_MS;
  let last = -1;
  let repeats = 0;
  while (Date.now() < deadline) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (h === last) {
      repeats += 1;
      if (repeats >= HEIGHT_STABLE_READINGS) break;
    } else {
      last = h;
      repeats = 0;
    }
    await page.waitForTimeout(HEIGHT_POLL_MS);
  }
  await page.screenshot({ path: options.path, fullPage: true });
}

async function expandSettingsSections(page: Page): Promise<void> {
  for (const label of [
    "Integrations",
    "AI & Coach",
    "Advanced / API",
    "App",
    "Data",
  ]) {
    const trigger = page.locator("button", { hasText: label }).first();
    await trigger.waitFor({ state: "visible", timeout: 10_000 });
    // Clicking an already-open section would close it, which is how a
    // "capture everything" step quietly captures less than the default one.
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
  }
  // The panels animate open. Wait for content from the LAST section rather
  // than a fixed sleep — Data holds the Export button.
  await page
    .getByRole("button", { name: "Export" })
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * Thrown by waitForDebriefSheetOpen when the debrief sheet did not actually
 * open. Named so it reads unambiguously in console output and in
 * axeReport's `error` field, rather than a generic Error that looks the
 * same as a timeout or a navigation failure.
 */
class SheetNotOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetNotOpenError";
  }
}

/**
 * Both sheet surfaces are captured at path "/" — the search params carry the
 * sheet state — and `assertOnSurface` in `captureWithRetry` compares pathname
 * only, deliberately, per its own doc comment, so a query string cannot make a
 * real navigation mismatch look like a pass.
 *
 * That means `assertOnSurface` CANNOT catch these surfaces' own failure mode.
 * If `SheetHost`'s branch for either sheet ever stops opening it — a renamed
 * param, the uuid check rejecting a valid id, the userId join finding nothing —
 * `assertOnSurface` still sees "/" and passes, and this script would silently
 * screenshot and axe-audit **Today itself**, then file the result under the
 * sheet's name. That is exactly the shape of the settings-connect-errors defect
 * (task 11 finding): a capture that reaches a page but not the state it exists
 * to measure, reporting a real number for the wrong thing all release.
 *
 * `[role="dialog"]` is BottomSheet's own root (`src/components/ui/bottom-
 * sheet.tsx`), shared by DebriefSheet and CheckinSheet. Only one of them can
 * render at any one of these URLs, and BlockSheet (train/week) is the only
 * other `role="dialog"` in the app and is unreachable from "/". Mirrors
 * `resolveActivityDetailPath`'s wait on `[data-stream-chart]`: prove the state
 * this surface names actually rendered before letting the screenshot or the
 * axe audit run.
 *
 * One factory rather than one function per sheet — the two bodies were
 * identical apart from the URL named in the message, which is the duplication
 * shape v0.112.0 spent a release removing.
 */
function sheetOpenGuard(
  surface: string,
  urlHint: string
): (page: Page) => Promise<void> {
  return async (page: Page) => {
    try {
      await page
        .locator('[role="dialog"]')
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
    } catch (err) {
      throw new SheetNotOpenError(
        `${surface}: no [role="dialog"] appeared after navigating to ` +
          `${urlHint}. SheetHost's branch did not open the sheet, so this ` +
          "run would otherwise capture and audit Today itself under the " +
          `name "${surface}" — refusing to capture. ` +
          `(${err instanceof Error ? err.message : String(err)})`
      );
    }
  };
}

/**
 * Coach has TWO History mechanisms, and only one of them is a URL.
 *
 * `chat-interface.tsx` renders a mobile header (`lg:hidden`) whose History
 * control is a `<Link href="/coach?history=1&thread=…">` — a real route — and
 * a desktop header (`hidden lg:flex`) whose control is a
 * `<button onClick={() => setShowThreadMenu(v => !v)}>` opening a dropdown
 * from client state. **The search param does nothing at lg+.**
 *
 * That is why `coach-history` was, until 2026-08-19, a false pass at desktop:
 * navigating to `?history=1` at 1440px rendered the ordinary empty Coach page,
 * `assertOnSurface` saw `/coach` and agreed, and the run filed a screenshot of
 * the suggestion chips under a name promising the History panel — auditing the
 * wrong DOM in both desktop themes for as long as the surface has existed. The
 * same defect shape as settings-connect-errors (task 11), found the same way:
 * by adding a guard that asserts the STATE rather than the path, and watching
 * it refuse.
 *
 * So this opens the panel by whichever mechanism the viewport actually has,
 * rather than assuming the URL did it.
 */
async function openHistoryPanel(page: Page): Promise<void> {
  const anyRow = page.locator("a[data-chat-thread]").first();
  if (await anyRow.isVisible().catch(() => false)) return; // mobile route

  // Desktop: the panel is client state behind the thread-title button.
  const trigger = page.locator('button[aria-haspopup="true"]').first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }

  /*
   * Then WAIT FOR THE ANIMATION, on the computed value rather than a sleep.
   *
   * `.menu-pop` is a 160ms fade from opacity 0 (globals.css). Playwright
   * calls an element "visible" as soon as it has a non-empty box, which is
   * true at opacity 0.02 — so the first version of this captured the panel
   * mid-fade. The PNG showed the chat bubbles apparently interleaved through
   * the panel's rows, which reads exactly like a z-index defect and is not
   * one: the panel was simply still see-through. Worth spelling out, because
   * a half-transparent panel is also what axe would have audited, and every
   * colour-contrast pair it computed would have been measured against a
   * background that is not the one an athlete ever sees.
   */
  const panel = page.locator(".menu-pop").first();
  if (await panel.isVisible().catch(() => false)) {
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(".menu-pop");
          return !!el && getComputedStyle(el).opacity === "1";
        },
        { timeout: 5_000 }
      )
      .catch(() => {
        /* fall through — the assertions below still gate the capture */
      });
  }
}

/**
 * `coach-history` — the panel open, no row selected.
 */
async function waitForHistoryPanel(page: Page): Promise<void> {
  await openHistoryPanel(page);
  try {
    await page
      .locator("a[data-chat-thread]")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  } catch (err) {
    throw new Error(
      "coach-history: no visible a[data-chat-thread] after opening the " +
        "History panel. At lg+ the panel is client state behind the " +
        "thread-title button, NOT the ?history=1 param — if that button " +
        "moved or lost aria-haspopup, this surface silently reverts to " +
        "capturing the ordinary Coach page. Refusing to capture. " +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * `coach-history-active` — the panel open AND a row actually selected.
 *
 * `coach-history` loads the panel with no `thread=`, so `activeThreadId` is
 * undefined and every row takes the inactive branch. The selected treatment —
 * `bg-surface-selected text-ink-primary` in `history-panel.tsx` — had never
 * appeared in a PNG or been seen by axe, on any surface, in either theme.
 * `docs/ROADMAP.md` recorded exactly this under 2b.4.
 */
async function waitForActiveThreadRow(page: Page): Promise<void> {
  await openHistoryPanel(page);
  try {
    const row = page.locator("a[data-chat-thread].bg-surface-selected").first();
    await row.waitFor({ state: "visible", timeout: 10_000 });
    /*
     * Then SCROLL IT INTO THE PANEL'S OWN VIEWPORT before the screenshot.
     *
     * The panel is `max-h-[70vh] overflow-auto` and lists inbox items above
     * chat threads, so on a seeded account the selected thread sits below the
     * fold. Playwright calls it "visible" — it is rendered and unhidden — but
     * the PNG would not contain it, which is the whole point of this surface.
     * A screenshot that omits the state its name promises is the failure this
     * file exists to prevent, one scroll offset further down than usual.
     */
    await row.scrollIntoViewIfNeeded({ timeout: 5_000 });
  } catch (err) {
    throw new Error(
      "coach-history-active: no VISIBLE a[data-chat-thread] carried " +
        "bg-surface-selected after opening the History panel. Either the " +
        "thread id no longer matches a row, history-panel's selected " +
        "treatment changed class, or the panel did not open for this " +
        "viewport (see openHistoryPanel — the param is mobile-only). " +
        "Capturing anyway would file an all-inactive list, or the ordinary " +
        `Coach page, under a name promising the selected row. (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * Assert the plan preview on screen is actually the TWO-ARC one.
 *
 * The card renders from whatever draft exists, and a single-race draft renders
 * a perfectly good preview — just not this surface's subject. Capturing that
 * under `train-plan-preview` would be the `coach-history` failure again: a
 * real page, a truthful path, and a name promising a state nobody verified.
 *
 * Segment 2's header is the cheapest positive proof, because Task 8 renders it
 * ONLY when `preview.phases` contains a segment-2 row.
 */
async function waitForTwoArcPreview(page: Page): Promise<void> {
  try {
    const header = page.locator('[data-testid="segment-2"]').first();
    await header.waitFor({ state: "visible", timeout: 10_000 });
    // And scroll it in, for the same reason coach-history-active does: the
    // phase table sits below the fold on a phone, and "visible" to Playwright
    // is not "in the PNG".
    await header.scrollIntoViewIfNeeded({ timeout: 5_000 });
  } catch (err) {
    throw new Error(
      "train-plan-preview: no visible [data-testid=segment-2] on /train. " +
        "Either no draft exists, the draft is single-race, or the segment " +
        "header stopped rendering. Run " +
        "`SEED_DEMO=1 DEMO_EMAIL=<owner> npx tsx scripts/seed-two-race.ts` " +
        "against this database first. Capturing anyway would file the " +
        "single-race preview under a name promising two arcs. " +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * Assert the race card on screen actually carries a rendered pacing line.
 *
 * `card.pacing?.available` is the whole branch — false, or no confirmed
 * plan at all, renders nothing here, and this surface would otherwise
 * silently capture whatever DID render (the plan-preview card, the empty
 * state, or the confirmed page minus its pacing line) under a name
 * promising the target-and-band text. Same failure shape as
 * `waitForTwoArcPreview` above, one state over.
 */
async function waitForRacePacing(page: Page): Promise<void> {
  try {
    const line = page.locator('[data-testid="race-pacing"]').first();
    await line.waitFor({ state: "visible", timeout: 10_000 });
    await line.scrollIntoViewIfNeeded({ timeout: 5_000 });
  } catch (err) {
    throw new Error(
      "train-race-pacing: no visible [data-testid=race-pacing] on /train. " +
        "Either there is no confirmed plan, the athlete's race is missing " +
        "or unavailable for pacing (triathlon/multi-day), or the derived " +
        "anchor could not resolve. Run `SEED_DEMO=1 DEMO_EMAIL=<owner> npx " +
        "tsx scripts/seed-confirmed-race.ts` against this database first — " +
        "BEFORE seed-two-race.ts. Capturing anyway would file the wrong " +
        `state under a name promising a rendered target. (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

const SURFACE_PREPARE: Record<string, (page: Page) => Promise<void>> = {
  "train-plan-preview": waitForTwoArcPreview,
  "train-race-pacing": waitForRacePacing,
  "settings-expanded": expandSettingsSections,
  "settings-connect-errors": expandSettingsSections,
  "debrief-sheet": sheetOpenGuard(
    "debrief-sheet",
    "?sheet=debrief&activity=<id>"
  ),
  "checkin-sheet": sheetOpenGuard("checkin-sheet", "?sheet=checkin"),
  "coach-history": waitForHistoryPanel,
  "coach-history-active": waitForActiveThreadRow,
};

// deviceScaleFactor lives here per-viewport (task-6 review, Finding 4) but is
// pulled back out before being handed to newContext — see main()'s loop.
// Playwright's newContext takes `viewport: {width, height}` and
// `deviceScaleFactor` as *separate, sibling* options; a previous version of
// this file nested deviceScaleFactor inside the viewport object, where
// newContext silently ignored it (TypeScript didn't catch it either,
// because the object reaches the call through a variable, not a literal, so
// the excess-property check never runs) and every capture was taken at 1x
// regardless of what was written here. Fixed by destructuring it out at the
// call site so phone captures now render at a real phone's 2x device pixel
// ratio; desktop stays 1x.
const VIEWPORTS: Record<
  string,
  { width: number; height: number; deviceScaleFactor: number }
> = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
};

const slice = process.argv[2];
if (!slice)
  throw new Error(
    "usage: npm run verify:surfaces -- <slice-name>  (or: npx tsx scripts/verify-surfaces.ts <slice-name>)"
  );

const outDir = join(process.cwd(), ".screenshots", slice);
mkdirSync(outDir, { recursive: true });
const axeReportPath = join(outDir, "axe-report.json");

/**
 * Surfaces main() resolves at RUNTIME rather than reading from SURFACES —
 * their paths are only knowable once a page has been driven (a coach thread
 * id, the newest activity, the sheet that activity opens, a freshly minted
 * token). They are listed here so --only/--except can name them and so a typo
 * in either is still rejected: 22 literal + these 5 is the whole surface set,
 * and 27 x 2 themes x 2 viewports is the 108 capture entries a full run
 * reports.
 */
const RESOLVED_SURFACES = [
  "coach-thread",
  "coach-history-active",
  "activity-detail",
  "debrief-sheet",
  "settings-token-created",
] as const;

function flagList(name: string): string[] | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  return arg
    .slice(name.length + 3)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const SELECTED_SURFACES = new Set(
  selectSurfaces([...Object.keys(SURFACES), ...RESOLVED_SURFACES], {
    only: flagList("only"),
    except: flagList("except"),
  })
);

/**
 * Off in CI, where the ratchet adjudicates the axe totals over BOTH captures
 * summed. On everywhere else, so a person running this still gets a non-zero
 * exit for a confirmed defect. Hard failures ignore this entirely.
 */
const AXE_GATE = axeGateEnabled(process.argv);

/**
 * The single filter point. Every capture in main() goes through either
 * captureResolved or captureTokenCreated, so gating those two gates all 27
 * surfaces — a filter applied only to the SURFACES loop would let both
 * capture jobs record the runtime-resolved surfaces, and the ratchet sums
 * both reports.
 */
function isSelected(name: string): boolean {
  return SELECTED_SURFACES.has(name);
}

/**
 * See scripts/lib/axe-report.ts for the full split rationale (task-7
 * review, Finding 1). `confirmed` gates `process.exitCode`; `indeterminate`
 * never does. `skipped`/`error` are set instead of `confirmed`/
 * `indeterminate` when this surface's audit never ran at all — see
 * captureTokenCreated and main()'s handling of it (task-7 review, Finding 2)
 * for why a surface's entry must always exist rather than silently vanish.
 */
interface AxeReportEntry {
  surface: string;
  theme: "light" | "dark";
  viewport: string;
  confirmed: AxeFinding[];
  indeterminate: AxeFinding[];
  /**
   * Set when this optional surface's state genuinely could not be reached
   * (task-7 review, Finding 2) — e.g. the settings UI needed to create a
   * token wasn't available. Acceptable: does NOT gate the exit code, but the
   * surface is still recorded here instead of silently missing.
   */
  skipped?: true;
  skipReason?: string;
  /**
   * Set when this surface WAS reached but the audit or capture step then
   * failed (task-7 review, Finding 2) — not acceptable, DOES gate the exit
   * code (see main()'s hardFailures handling). Recorded so the surface is
   * visibly failed rather than silently absent from the report.
   */
  error?: string;
}

/**
 * Filled in across the whole run and written to disk after every entry, not
 * just once at the end (task-7 review, Finding 4) — see writeReport below.
 */
const axeReport: AxeReportEntry[] = [];

/**
 * Persists the report collected so far. Called after every audited surface
 * (and every skip/error record) so a crash partway through a ~40-surface
 * run still leaves everything captured up to that point on disk, instead of
 * losing it all to whatever comes after the single end-of-main() write this
 * used to be (task-7 review, Finding 4). Cheap enough to call this often —
 * the report is at most a few hundred KB.
 */
function writeReport(): void {
  const totals = computeTotals(axeReport);
  writeFileSync(
    axeReportPath,
    JSON.stringify({ totals, entries: axeReport }, null, 2)
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Today's three states must actually have produced three different images.
 *
 * WHY THIS IS NOT OPTIONAL POLISH. `assertOnSurface` compares **pathname
 * only** — deliberately, so a query string cannot make a surface look like a
 * navigation mismatch. But that means `/?state=evening` is checked against
 * `/` and passes no matter what the query string did. If the `?state=`
 * override ever stops taking effect (renamed param, a gate that starts
 * refusing outside production too, a page that stops reading searchParams),
 * this script would capture the morning state three times, write three files
 * with three different names, and report a clean run. That is a silent pass
 * on precisely the thing these two surfaces exist to prove.
 *
 * Checksums are the only thing that notices. Compared within a theme and
 * viewport pair, never across — two themes SHOULD differ, which would make a
 * cross-pair comparison pass for the wrong reason.
 *
 * Fails the run the way the rest of main() does (exit code + a named error)
 * rather than throwing, so the remaining end-of-run diagnostics still print.
 */
function assertTodayStatesDiffer(): void {
  const states = ["today", "today-post-session", "today-evening"];
  for (const vpName of Object.keys(VIEWPORTS)) {
    for (const theme of ["light", "dark"] as const) {
      const digests = new Map<string, string>();
      for (const name of states) {
        const file = join(outDir, `${name}-${theme}-${vpName}.png`);
        let bytes: Buffer;
        try {
          bytes = readFileSync(file);
        } catch {
          // A capture that never happened is already failed elsewhere in
          // this run; don't turn a missing file into a confusing duplicate
          // report on top of it.
          continue;
        }
        digests.set(name, createHash("sha256").update(bytes).digest("hex"));
      }
      const seen = new Map<string, string>();
      for (const [name, digest] of digests) {
        const twin = seen.get(digest);
        if (twin) {
          console.error(
            `\nToday's states "${twin}" and "${name}" produced BYTE-IDENTICAL ` +
              `captures at ${theme}/${vpName}. The ?state= override is not ` +
              `taking effect, so these are the same page saved twice under ` +
              `different names. assertOnSurface cannot see this because it ` +
              `compares pathname only. Refusing to report a pass.`
          );
          process.exitCode = 1;
        }
        seen.set(digest, name);
      }
    }
  }
}

/**
 * The one computed style this file trusts to actually differ between
 * themes: body's resolved background-color, which chains through
 * globals.css as `bg-background` → `--background` → `--surface-base`. Read
 * from the same CSS the contrast guard (tests/contrast-guard.test.ts) reads,
 * via src/lib/design/tokens.ts, rather than a second hardcoded copy of the
 * hex values — a copy is exactly what could drift silently if the tokens
 * ever change.
 */
const EXPECTED_BODY_BACKGROUND: Record<"light" | "dark", string> = (() => {
  const tokens = resolvedThemeTokens();
  const rgb = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    light: rgb(tokens.light["surface-base"]),
    dark: rgb(tokens.dark["surface-base"]),
  };
})();

/**
 * Sign in through the real form and return reusable storage state. Do NOT
 * fabricate a session cookie — a hand-made cookie that better-auth rejects
 * produces a login page in every capture, which looks like a styling bug.
 * Clicking before hydration silently posts nothing and waitForURL times out,
 * which reads like bad credentials — wait for the button, then pause.
 * Wrapped in a retry: a single blip signing in against a local dev server
 * that just started is not evidence of a real problem.
 */
async function signIn(browser: import("playwright-core").Browser) {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) {
    throw new Error("OWNER_EMAIL and OWNER_PASSWORD must be set.");
  }

  const attempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.phone });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.waitForSelector('button[type="submit"]:not([disabled])');
      await page.waitForTimeout(500);
      await page.click('button[type="submit"]');
      await page.waitForURL(`${BASE_URL}/`, { timeout: 15_000 });
      const storageState = await ctx.storageState();
      await ctx.close();
      return storageState;
    } catch (err) {
      lastErr = err;
      console.warn(
        `sign-in attempt ${attempt}/${attempts} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      await ctx.close();
      await sleep(1000);
    }
  }
  throw new Error(
    `sign-in failed after ${attempts} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

/**
 * Confirms `page` actually landed on `routePath` before anything captures
 * it (task-6 review, Finding 2). `page.goto()` does not throw on a redirect
 * or a 404 — only the initial sign-in checked for a login page, so a
 * session expiring mid-run, or a route redirecting for any other reason,
 * would previously save the login (or wrong) page as though it were the
 * requested surface. Checks the final path and explicitly detects landing
 * on /login when /login wasn't what was asked for, which is the specific
 * failure a mid-run session expiry produces.
 */
function assertOnSurface(
  page: Page,
  routePath: string,
  surfaceName: string
): void {
  const actual = new URL(page.url());
  const expectedPath = new URL(routePath, BASE_URL).pathname;
  const landedOnLoginUnexpectedly =
    actual.pathname === "/login" && expectedPath !== "/login";

  if (actual.pathname !== expectedPath || landedOnLoginUnexpectedly) {
    throw new Error(
      `navigation mismatch capturing "${surfaceName}": requested ` +
        `${expectedPath}, landed on ${actual.pathname}${actual.search}` +
        (landedOnLoginUnexpectedly
          ? " (looks like the session expired mid-run)"
          : "") +
        " — refusing to capture."
    );
  }
}

/**
 * Confirms the REAL RENDERED DOM of a captured Today state matches
 * BLOCK_ORDER, in order (I1, whole-branch review 2026-08-12).
 *
 * WHY THIS EXISTS ON TOP OF block-order.test.ts. That file proved, by
 * source inspection, that BLOCK_ORDER's object contains a property named
 * `heroRecap:` (etc.) for each state — but the reviewer showed that
 * replacing that property's VALUE with `null` (deleting the readiness
 * recap from the evening state — exactly what "reorder, never hide" exists
 * to prevent) left every existing test green. Nothing was checking what
 * actually renders.
 *
 * page.tsx now stamps `data-block={key}` on the wrapper div for every
 * BLOCK_ORDER entry, so this reads the real page's `[data-block]` elements
 * and diffs their order against `BLOCK_ORDER[state]` — imported, not
 * restated, so this can never drift from the list page.tsx itself claims
 * to render from.
 *
 * This is a presence-and-order check, not a non-emptiness check: it would
 * not by itself distinguish a wrapper that renders real content from one
 * whose block happens to render nothing for this account's data (several
 * blocks are legitimately null depending on account state — see
 * block-order.ts's MOMENT_ONLY and the calibration/coach/raceChip guards
 * in page.tsx). What it DOES catch is the DOM's structure drifting from
 * BLOCK_ORDER at all — a dropped, duplicated, or reordered wrapper — which
 * is the class of bug a source-only test cannot see. Complements, not
 * replaces, assertTodayStatesDiffer's checksum: that catches "?state=
 * stopped taking effect" (three identical renders); this catches "the DOM
 * stopped matching BLOCK_ORDER" even when the three captures still differ
 * from each other. Keep both — belt and braces.
 *
 * Fails the run the way assertTodayStatesDiffer does — console.error plus
 * process.exitCode = 1 — rather than throwing, so a mismatch on one
 * surface does not abort the rest of the run's diagnostics.
 */
async function assertBlockOrder(
  page: Page,
  surfaceName: string,
  state: TodayState
): Promise<void> {
  const expected = BLOCK_ORDER[state];
  const actual = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-block]")).map((el) =>
      el.getAttribute("data-block")
    )
  );
  const matches =
    actual.length === expected.length &&
    actual.every((key: string | null, i: number) => key === expected[i]);
  if (!matches) {
    console.error(
      `\nBLOCK ORDER MISMATCH capturing "${surfaceName}": ` +
        `BLOCK_ORDER.${state} names [${expected.join(", ")}], but the ` +
        `rendered page's [data-block] wrappers were [${actual.join(", ")}]. ` +
        `page.tsx's rendered DOM has drifted from ` +
        `src/lib/today/block-order.ts's BLOCK_ORDER — a block was dropped, ` +
        `duplicated, or reordered without BLOCK_ORDER changing to match, ` +
        `or vice versa.`
    );
    process.exitCode = 1;
  }
}

/**
 * ThemeProvider is forced to dark (`forcedTheme="dark"`, see
 * theme-provider.tsx) until slice 9. next-themes applies that forced class
 * TWICE: once synchronously during HTML parsing (the anti-flicker script,
 * well before our addInitScript's DOMContentLoaded listener can act), and
 * again from a React mount effect that fires ~300-500ms *after*
 * DOMContentLoaded.
 *
 * task-6 review, Finding 1: an earlier version of this function set the
 * class once, right after `networkidle`, and trusted that the mount-effect
 * clobber had already fired by then. That held only because this app's
 * DB-backed fetches make `networkidle` slow enough that the ~300-500ms
 * window always closes first. A faster surface in a later slice would let
 * our one-shot toggle win the race and then get silently clobbered after
 * we'd already moved on to `page.screenshot()` — a light capture that is
 * actually dark, reported as a success, with nothing in the run's output to
 * say so.
 *
 * Fixed by verifying instead of assuming: after (re)asserting the class,
 * poll — without touching the DOM again — for a window longer than the
 * measured clobber delay, checking both the class *and* a computed style
 * that genuinely differs between themes (body's resolved background-color;
 * see EXPECTED_BODY_BACKGROUND). Any deviation during that window throws
 * immediately. Nothing is ever screenshotted on an unconfirmed theme.
 */
async function forceThemeVerified(page: Page, dark: boolean): Promise<void> {
  const theme: "light" | "dark" = dark ? "dark" : "light";
  const expectedBackground = EXPECTED_BODY_BACKGROUND[theme];

  await page.evaluate(
    (d: boolean) => document.documentElement.classList.toggle("dark", d),
    dark
  );

  const POLL_MS = 50;
  // Measured mount-effect clobber: 300-500ms after DOMContentLoaded. 800ms
  // of silent, untouched polling leaves clear margin either side of that.
  const WINDOW_MS = 800;
  const samples = Math.ceil(WINDOW_MS / POLL_MS);

  for (let i = 0; i < samples; i++) {
    const state = await page.evaluate(() => ({
      hasDarkClass: document.documentElement.classList.contains("dark"),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    }));
    if (
      state.hasDarkClass !== dark ||
      state.bodyBackground !== expectedBackground
    ) {
      throw new Error(
        `theme verification failed: expected ${theme} (class dark=${dark}, ` +
          `body background ${expectedBackground}) but observed class ` +
          `dark=${state.hasDarkClass}, body background ` +
          `${state.bodyBackground} at t=${i * POLL_MS}ms into the hold — ` +
          `refusing to capture.`
      );
    }
    if (i < samples - 1) await sleep(POLL_MS);
  }
}

/**
 * Runs axe-core against whatever `page` currently has loaded — after
 * navigation, theme-forcing and (where relevant) any client-state setup —
 * and appends one entry to the module-level `axeReport`. Injected fresh via
 * `addScriptTag` on every call rather than once per page/context: axe-core
 * does not persist across `page.goto()` navigations, and this function is
 * always called immediately after the page has settled on the surface being
 * audited, so re-injecting here is the simplest thing that is always
 * correct rather than depending on caller discipline.
 *
 * See the header comment for why this runs against the real browser rather
 * than as a vitest-axe unit test: jsdom cannot render nine of these
 * surfaces at all, and computes no layout for the ones it can, so it cannot
 * see a contrast or overlap violation regardless.
 *
 * DELIBERATE DEVIATION from the brief's sample code, recorded here rather
 * than shipped quietly: the brief's snippet requests only
 * `resultTypes: ["violations"]`. Four of the nine surfaces (today, train,
 * coach, body) render every element inside a full-page decorative CSS
 * gradient background. axe-core's color-contrast rule cannot algebraically
 * resolve a composited background through a gradient, so on those surfaces
 * it downgrades the check from "violation" to "incomplete" — a "needs a
 * human to confirm" bucket — for nearly every text node on the page,
 * regardless of whether the text is actually readable. A first pass with
 * only `resultTypes: ["violations"]` returned 2 total findings across all
 * 40 surface/theme/viewport combinations; manually inspecting the
 * "incomplete" results it had discarded turned up axe-reported 1:1
 * (invisible) contrast on `text-white/50` and `text-white/80` elements on
 * the Today page in light mode — a real instance of exactly the defect
 * this release exists to fix, silently dropped by the brief's literal
 * filter. Requesting "incomplete" too is what actually exercises these four
 * surfaces; splitFindings() (scripts/lib/axe-report.ts) is what then tells
 * apart the "incomplete" results axe actually computed a failure for from
 * the ones it genuinely could not resolve — see that file's header for why
 * that split matters and must not be re-collapsed.
 */
async function auditPage(
  page: Page,
  surface: string,
  theme: "light" | "dark",
  vpName: string
): Promise<void> {
  // TEST HOOK (task-7 review, Finding 2 proof) — see
  // docs/axe-baseline-2026-08-11-seeded.md for the reproducible demo this
  // supports. Deliberately throws instead of running axe, but ONLY for the
  // one surface and ONLY when explicitly asked, so this never fires in a
  // real run. Proves that a failure reached *after* captureTokenCreated's
  // optional state was successfully reached (as opposed to never being
  // reached at all — see that function's own TEST HOOK) is NOT swallowed:
  // main() must record it loudly and fail the run's exit code rather than
  // silently continuing as if the surface were never audited.
  if (
    process.env.VERIFY_SURFACES_TEST_TOKEN_FAILURE_MODE === "hard" &&
    surface === "settings-token-created"
  ) {
    throw new Error(
      "TEST HOOK: simulated axe-audit failure after the token-created state was reached (Finding 2 proof)"
    );
  }

  await page.addScriptTag({
    path: require.resolve("axe-core/axe.min.js"),
  });
  const result = await page.evaluate(async () => {
    // @ts-expect-error — axe-core's browser build attaches itself to
    // `window`; the package ships no ambient type declarations for that
    // global, only the Node-facing ones used above to type this file's own
    // report entries.
    return await window.axe.run(document, {
      resultTypes: ["violations", "incomplete"],
    });
  });
  const { confirmed, indeterminate } = splitFindings(
    result.violations as Axe.Result[],
    result.incomplete as Axe.Result[]
  );
  axeReport.push({
    surface,
    theme,
    viewport: vpName,
    confirmed,
    indeterminate,
  });
  writeReport();
}

/**
 * A single patched Chromium hitting one local Next.js + Postgres process
 * back to back will occasionally produce one bad capture that is fine on a
 * retry (known flakiness, not the app's fault). Retry once before giving up.
 */
async function captureWithRetry(
  page: Page,
  surfaceName: string,
  routePath: string,
  filePath: string,
  dark: boolean,
  theme: "light" | "dark",
  vpName: string
) {
  const url = `${BASE_URL}${routePath}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
      assertOnSurface(page, routePath, surfaceName);
      await forceThemeVerified(page, dark);
      const prepare = SURFACE_PREPARE[surfaceName];
      if (prepare) await prepare(page);
      await screenshotStable(page, { path: filePath });
      await auditPage(page, surfaceName, theme, vpName);
      const todayState = TODAY_STATE_BY_SURFACE[surfaceName];
      if (todayState) await assertBlockOrder(page, surfaceName, todayState);
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      console.warn(
        `capture retry for ${url}: ${err instanceof Error ? err.message : String(err)}`
      );
      await sleep(1000);
    }
  }
}

/** Labels of tokens created by captureTokenCreated whose auto-revoke failed. */
const leakedTokenLabels: string[] = [];

/**
 * Thrown by captureTokenCreated only when its optional "reach the
 * token-created state" phase fails BEFORE a real token has been created
 * (task-7 review, Finding 2). This is the one acceptable failure mode: no
 * side effect happened, nothing to clean up, and main() records it as a
 * skipped entry rather than failing the run. Any other error thrown by
 * captureTokenCreated means the state WAS reached and something after that
 * point broke — main() must treat that as a hard failure instead.
 */
class TokenStateUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenStateUnreachableError";
  }
}

/**
 * Settings-specific extra capture. Global constraint (Task 2 finding):
 * applying `.dark` for the first time activated 14 distinct previously-dead
 * `dark:` utilities over 21 occurrences in 4 files (corrected from "11" by
 * the whole-branch review, I3), including the "token created" success box in
 * api-tokens-card.tsx (green-50/white → green-950/black). That box only
 * renders as client component state right after a real creation — it is
 * never derived from the server-rendered token list — so it must be reached
 * through the real form, screenshotted, and cleaned up via the real Revoke
 * button so the run leaves no debris in the account's settings.
 *
 * task-6 review, Finding 3: a previous version had no try/finally, so a
 * failure between creation and revocation (a selector renamed, a slow
 * server, anything) leaked a real API token *and* killed every remaining
 * surface for the rest of the run. Revocation now runs in a `finally` and
 * this whole capture is optional from the caller's point of view — see
 * main(), which catches and logs rather than letting this abort the loop.
 * If revocation itself fails, that is never allowed to be silent: it is
 * logged loudly here and the label is collected so main() can summarize and
 * fail the run's exit code at the very end (after every other capture has
 * still been attempted).
 *
 * Also the only place axe ever sees the success box and its `<code>` block
 * (the four newly-activated `dark:` utilities that live in
 * `api-tokens-card.tsx` — bg-green-950, border-green-800, text-green-200,
 * bg-black): the box is client-component state rendered right
 * after a real token creation, never server-rendered, so the plain
 * `/settings` capture in captureWithRetry never reaches it. Audited here,
 * right after the screenshot, while the box is still on screen and before
 * the `finally` block below revokes the token and removes it.
 *
 * task-7 review, Finding 2: this surface is the ONLY place axe ever sees six
 * of the 14 `dark:` utilities this slice newly activated — the four above
 * plus `dark:bg-input/30` and `dark:border-input`, which need an <Input> and
 * an outline <Button> on screen and the plain /settings capture (a collapsed
 * Menu) has neither — and it now
 * carries a real accessibility check, not just a bonus screenshot — the
 * previous "log and continue" posture (still what main() does, but see the
 * distinction below) let a flaky axe injection here drop this surface from
 * the report entirely while the run kept exiting 0. Fixed by distinguishing
 * two failure shapes, thrown differently so main() can tell them apart:
 *   - Could not REACH the state at all (anything up to and including
 *     waiting for "Copy this token now" to appear) — no token exists, no
 *     side effect, nothing to clean up. Acceptable: thrown as
 *     TokenStateUnreachableError, and main() records it as `skipped` rather
 *     than failing the run.
 *   - REACHED the state and something after that then failed (theme
 *     re-verification, the screenshot, or auditPage itself) — a real token
 *     now exists and the `finally` block below must still run to revoke it,
 *     but this is NOT acceptable: it propagates as an ordinary Error, and
 *     main() must fail the run's exit code and record it as `error` rather
 *     than silently continuing as if this surface were never audited.
 */
async function captureTokenCreated(
  page: Page,
  theme: "light" | "dark",
  vpName: string,
  dark: boolean
): Promise<void> {
  const label = `screenshot-verify-${theme}-${vpName}-${Date.now()}`;
  let tokenCreated = false;
  try {
    try {
      // TEST HOOK (task-7 review, Finding 2 proof) — see
      // docs/axe-baseline-2026-08-11-seeded.md. Deliberately fails the
      // "reach" phase before any token exists, so this always resolves to
      // TokenStateUnreachableError below and never fires outside an
      // explicit proof run.
      if (
        process.env.VERIFY_SURFACES_TEST_TOKEN_FAILURE_MODE === "unreachable"
      ) {
        throw new Error(
          "TEST HOOK: simulated failure to reach the token-created state (Finding 2 proof)"
        );
      }
      await page.goto(`${BASE_URL}/settings`, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      assertOnSurface(page, "/settings", "settings-token-created");
      await forceThemeVerified(page, dark);
      // ApiTokensCard lives inside the collapsed-by-default "Advanced / API"
      // section; open it before the form inside becomes actionable.
      await page.locator('button:has-text("Advanced / API")').click();
      await page.waitForSelector("#tokenLabel", { state: "visible" });
      await page.fill("#tokenLabel", label);
      await page.click('button[type="submit"]:has-text("Create token")');
      await page.waitForSelector("text=Copy this token now", {
        timeout: 10_000,
      });
    } catch (err) {
      throw new TokenStateUnreachableError(
        `could not reach the "token created" state for ${theme}/${vpName}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
    // From here on a real token exists on the account — the finally block
    // below must run no matter what happens next, and any failure from
    // here on is NOT wrapped as TokenStateUnreachableError: the state WAS
    // reached, so main() must treat it as a hard failure (see doc comment).
    tokenCreated = true;
    // Let the revalidated server data settle, then reassert+reverify the
    // theme — cheap insurance against the same forcedTheme re-render race
    // forceThemeVerified guards against generally.
    await page.waitForTimeout(300);
    await forceThemeVerified(page, dark);
    await screenshotStable(page, {
      path: join(outDir, `settings-token-created-${theme}-${vpName}.png`),
    });
    await auditPage(page, "settings-token-created", theme, vpName);
  } finally {
    if (tokenCreated) {
      try {
        // Clean up through the real UI so the account is left as found.
        const row = page.locator("div.flex.items-center.justify-between", {
          has: page.getByText(label, { exact: true }),
        });
        await row.getByRole("button", { name: "Revoke" }).click();
        await page.waitForTimeout(500);
      } catch (revokeErr) {
        leakedTokenLabels.push(label);
        console.error(
          `LEAKED API TOKEN "${label}": automatic revoke failed after this ` +
            `capture and must be removed by hand (Settings → Advanced / ` +
            `API). Cause: ${
              revokeErr instanceof Error ? revokeErr.message : String(revokeErr)
            }`
        );
      }
    }
  }
}

/**
 * The seeded chat thread's id is a uuid, so `/coach?thread=…` cannot live in
 * SURFACES as a literal. Read it off the History panel's own chat-thread
 * link.
 *
 * DELIBERATELY NOT `a[href^="/coach?thread="]`: HistoryPanel renders TWO
 * kinds of link with that identical href shape — coach-inbox items under
 * "From your coach" (rendered FIRST in DOM order, with the one seeded unread
 * item on top) and the athlete's own chat threads under "Chats". A plain
 * href-prefix selector's `.first()` always lands on the inbox item, capturing
 * a single assistant bubble instead of the multi-turn conversation this
 * surface exists to exercise — and, as a side effect, calls markThreadRead
 * on that inbox thread and permanently flips the seed's one deliberately
 * unread item to read. `data-chat-thread` (history-panel.tsx) is a bare
 * marker present ONLY on the `chats.map(...)` links, so this always resolves
 * a real `kind: "chat"` thread.
 *
 * Throws rather than returning null: a missing thread link means the seeded
 * CHAT thread is missing (run scripts/seed-demo.ts), and silently falling
 * back to an inbox thread would restore exactly the blind spot this slice
 * exists to close — this run refuses to silently capture an inbox thread
 * instead.
 *
 * NOT TRUSTED ON DOM ORDER ALONE. `.first()` picks whichever `kind: "chat"`
 * thread HistoryPanel happens to render first — ordered by updatedAt
 * descending — which is a fine selector for "some real chat thread" but no
 * guarantee it is a MULTI-TURN one. A dev DB can (and did: two single-message
 * "How should I train today?" rows outranked the seeded four-message thread
 * by updatedAt before they were deleted) hold stray one-message chat threads
 * that sort ahead of the real conversation this surface exists to capture.
 * capturing one of those would produce a coach-thread screenshot showing a
 * single bubble — passing every check in this file while silently defeating
 * the surface's entire purpose.
 *
 * This project's standing lesson (see file header, "axe baseline" section,
 * and the whole-branch reviews referenced throughout this file) is that a
 * run which emits files is not evidence — a script that writes a PNG and
 * exits 0 has proven nothing about what is IN the PNG. So this function does
 * not stop at resolving an href: it navigates to the resolved thread and
 * reads the real rendered DOM for both bubble classes chat-interface.tsx
 * emits (`.chat-bubble-user` for the athlete's turn, `.chat-bubble-ai` for
 * the coach's reply — confirmed against that file, not assumed). Only a
 * thread that actually rendered both is accepted; anything else throws
 * rather than letting main() screenshot and audit a single bubble under the
 * "coach-thread" name.
 */
async function resolveCoachThreadPath(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/coach?history=1`, {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  const href = await page
    .locator("a[data-chat-thread]")
    .first()
    .getAttribute("href", { timeout: 10_000 });
  if (!href) {
    throw new Error(
      "no a[data-chat-thread] link on /coach?history=1 — the seeded CHAT " +
        "thread ('Should I go hard today?') is missing. Run " +
        "scripts/seed-demo.ts against the dev DB (5434) first. Refusing to " +
        'fall back to a[href^="/coach?thread="]: that would silently ' +
        "capture an inbox thread instead of the seeded chat thread, which " +
        "is the exact bug this resolver exists to avoid."
    );
  }

  // PROVE it, don't trust DOM order: navigate to the resolved thread and
  // check the real rendered page for both bubble classes before handing the
  // href back to main() for capture.
  //
  // `networkidle` below only proves the network went quiet — it tracks
  // connections, not React hydration/commit timing. The message list is NOT
  // server-rendered: chat-interface.tsx fetches it client-side
  // (fetchThreadMessages) from a mount-only useEffect that reads the
  // deep-link thread id from props
  // (src/components/coach/chat-interface.tsx:209-239). That fetch can
  // legitimately still be in flight, or its response still uncommitted to
  // the DOM, at the instant `networkidle` resolves — so an immediate
  // `.count()` right after goto() would be a race, not a real assertion.
  // Wait (bounded, not a fixed sleep, not an unbounded one either) for at
  // least one bubble of each class to attach before reading counts.
  await page.goto(`${BASE_URL}${href}`, {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  await Promise.allSettled([
    page
      .locator(".chat-bubble-user")
      .first()
      .waitFor({ state: "attached", timeout: 10_000 }),
    page
      .locator(".chat-bubble-ai")
      .first()
      .waitFor({ state: "attached", timeout: 10_000 }),
  ]);
  const [userBubbles, aiBubbles] = await Promise.all([
    page.locator(".chat-bubble-user").count(),
    page.locator(".chat-bubble-ai").count(),
  ]);
  if (userBubbles === 0 || aiBubbles === 0) {
    throw new Error(
      `resolved coach thread ${href} is not multi-turn: waited up to 10s ` +
        "for both bubble classes to attach (chat-interface.tsx fetches " +
        "messages client-side after mount, so they are not guaranteed to " +
        "exist at first paint) and still found only " +
        `${userBubbles} .chat-bubble-user and ${aiBubbles} .chat-bubble-ai ` +
        "node(s) on its rendered page — either a genuine render stall past " +
        "10s, or (far more likely) this thread really only has one " +
        "message. The coach-thread surface exists to capture a real " +
        "conversation — a user bubble AND an assistant bubble, plus the " +
        "message-list chrome around them — not a single message. " +
        "`.first()` over data-chat-thread links picks whichever chat " +
        "thread sorts first by updatedAt, which is not by itself proof it " +
        "is the multi-turn seeded conversation (a stray one-message dev " +
        "thread can and has outranked it). Capturing this thread anyway " +
        "would silently reduce the coach-thread surface to a single bubble " +
        "while the run still exits as though the surface were fully " +
        "covered — exactly the kind of run-emits-files-but-proves-nothing " +
        "result this project has been burned by before. Refusing to " +
        "capture. Fix: delete stray single-message chat threads for this " +
        "account, or re-run scripts/seed-demo.ts."
    );
  }

  return href;
}

/**
 * Resolve a real activity detail path. The id is a per-database UUID, so
 * this cannot be a literal SURFACES entry.
 *
 * Resolves through /train?tab=history — the list that links to detail pages
 * — then PROVES the resolved page rendered the detail view before handing
 * the path back, the same discipline resolveCoachThreadPath earned across
 * three wrong threads. An activity with no cached streams renders
 * StreamDataEmpty instead of charts, which is a legitimate state but not
 * the one this surface exists to audit, so the check below demands the
 * charts.
 *
 * `a[href^="/activity/"]` ALONE also matches TrainHeader's "Log activity"
 * link (`href="/activity/log"`, src/app/train/page.tsx), which renders
 * before HistoryList's rows in DOM order — so `.first()` over that selector
 * picked it every time, a plausible-looking wrong match discovered running
 * this exact resolver, the same shape of trap resolveCoachThreadPath's
 * three attempts document. `/activity/log` is excluded explicitly rather
 * than trusted to sort second.
 */
async function resolveActivityDetailPath(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/train?tab=history`, {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  const href = await page
    .locator('a[href^="/activity/"]:not([href="/activity/log"])')
    .first()
    .getAttribute("href", { timeout: 10_000 });
  if (!href) {
    throw new Error(
      'no a[href^="/activity/"] link (other than /activity/log) on ' +
        "/train?tab=history — the seeded activities are missing. Run " +
        "scripts/seed-demo.ts against the target database first."
    );
  }

  await page.goto(`${BASE_URL}${href}`, {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  const charts = await page.locator("[data-stream-chart]").count();
  if (charts === 0) {
    throw new Error(
      `${href} rendered no [data-stream-chart]. activity_streams is empty ` +
        "for this activity, so getOrFetchActivityDetail fell back to " +
        "intervals.icu, which dev has no credentials for. Seed streams " +
        "(Task 3) before capturing this surface — otherwise it audits " +
        "StreamDataEmpty and reports a number for a page that is not the " +
        "one this surface names."
    );
  }
  return href;
}

/**
 * Messages describing surfaces that WERE reached but then failed (task-7
 * review, Finding 2) — as opposed to leakedTokenLabels (cleanup-only
 * failures) or a skipped-but-acceptable "could not reach" — any entry here
 * fails the run's exit code.
 */
const hardFailures: string[] = [];

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
  });

  const storageState = await signIn(browser);

  let total = 0;
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    const { deviceScaleFactor, ...size } = viewport;
    for (const theme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({
        storageState,
        viewport: size,
        deviceScaleFactor,
      });
      // ThemeProvider forces dark until slice 9, so set the class directly
      // on every document rather than driving the UI control.
      await ctx.addInitScript(`
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.classList.toggle("dark", ${theme === "dark"});
        });
      `);
      const dark = theme === "dark";
      const p = await ctx.newPage();

      /**
       * EVERY captured surface goes through here: the literal SURFACES map,
       * and coach-thread / activity-detail / debrief-sheet, which differ only
       * in their name and in how their path is resolved. Capture, record the
       * hard failure, file an empty axe entry so a failed surface is not
       * merely absent from the report, flush. Those three each carried their
       * own ~30-line copy of it until v0.108.0.
       *
       * THE SURFACES LOOP USED NOT TO BE CONTAINED, and that is what made one
       * bad surface expensive: captureWithRetry rethrows after its second
       * attempt, the throw escaped main(), and every LATER surface and every
       * later theme/viewport combo was lost with no axe entry filed for any of
       * them. In v0.108.0 a demo user seeded as `member` redirected /admin and
       * killed a 35-minute run 16 surfaces in. That seed bug is fixed, but the
       * amplifier was this loop — so a run now finishes and reports what
       * failed instead of stopping at the first unreachable page.
       * `hardFailures` still makes the exit non-zero.
       *
       * The path arrives as a thunk rather than a string so a caller can do
       * work that must happen inside the try: activity-detail keeps the id it
       * resolved, and debrief-sheet throws from inside its own resolver when
       * that id never arrived.
       */
      const captureResolved = async (
        name: string,
        resolvePath: () => Promise<string>
      ) => {
        if (!isSelected(name)) return;
        try {
          const path = await resolvePath();
          await captureWithRetry(
            p,
            name,
            path,
            join(outDir, `${name}-${theme}-${vpName}.png`),
            dark,
            theme,
            vpName
          );
          total++;
        } catch (err) {
          const message =
            `${name} FAILED for ${theme}/${vpName}: ` +
            `${err instanceof Error ? err.message : String(err)}`;
          console.error(message);
          hardFailures.push(message);
          axeReport.push({
            surface: name,
            theme,
            viewport: vpName,
            confirmed: [],
            indeterminate: [],
            error: err instanceof Error ? err.message : String(err),
          });
          writeReport();
        }
      };

      for (const [name, path] of Object.entries(SURFACES)) {
        await captureResolved(name, async () => path);
      }

      // Resolved per context: the storage state is fresh each time and the
      // href is cheap to re-read. A failure here is hard — see the resolver.
      // The resolved href is `/coach?thread=<id>`; the id is reused below for
      // coach-history-active, so it is captured into a variable rather than
      // only a path — same shape as activity-detail feeding debrief-sheet.
      let threadId: string | undefined;
      await captureResolved("coach-thread", async () => {
        const threadPath = await resolveCoachThreadPath(p);
        threadId = new URL(threadPath, BASE_URL).searchParams.get(
          "thread"
        ) as string;
        return threadPath;
      });

      // The History panel with a row actually selected — the state
      // `coach-history` cannot reach, because without `thread=` every row
      // takes the inactive branch. Recorded as open under 2b.4 in
      // docs/ROADMAP.md until this surface existed.
      await captureResolved("coach-history-active", async () => {
        if (!threadId) {
          throw new Error(
            "no thread id available — resolveCoachThreadPath did not " +
              "resolve one for this theme/viewport (see the coach-thread " +
              "failure above)."
          );
        }
        return `/coach?history=1&thread=${threadId}`;
      });

      // Resolved per context, same reasoning as coach-thread above: the
      // storage state is fresh each time and the href is cheap to re-read.
      // A failure here is hard — see resolveActivityDetailPath. The
      // resolved activity id is also reused below for debrief-sheet's deep
      // link, so it is captured into a variable rather than only a path.
      let activityId: string | undefined;
      await captureResolved("activity-detail", async () => {
        const detailPath = await resolveActivityDetailPath(p);
        activityId = detailPath.replace(/^\/activity\//, "");
        return detailPath;
      });

      // debrief-sheet reuses activity-detail's resolved id (Task 2 brief) —
      // deep-linked explicitly rather than bare ?sheet=debrief because
      // SheetHost's no-id path looks for debriefState "pending", which is
      // NULL on every seeded row. If activity-detail's resolver failed
      // above, there is no id to link to, so this is recorded as a hard
      // failure too rather than silently vanishing from the report.
      await captureResolved("debrief-sheet", async () => {
        if (!activityId) {
          throw new Error(
            "no activity id available — resolveActivityDetailPath did not " +
              "resolve one for this theme/viewport (see the activity-detail " +
              "failure above)."
          );
        }
        return `/?sheet=debrief&activity=${activityId}`;
      });

      // Reach and capture the api-tokens-card "token created" state, once
      // per theme/viewport combination, then clean up via the real UI.
      // task-7 review, Finding 2: this surface must never simply vanish
      // from the report. Two distinguishable outcomes:
      //   - TokenStateUnreachableError: the state itself could not be
      //     reached — acceptable, recorded as `skipped`, does not fail the
      //     run (this preserves the original task-6 posture: one flaky UI
      //     interaction shouldn't cost every other surface).
      //   - anything else: the state WAS reached and the audit/capture then
      //     failed — NOT acceptable now that this is the only place axe
      //     ever sees six of this slice's 14 newly-activated `dark:`
      //     utilities. Recorded as `error` AND collected into
      //     hardFailures so the run's exit code reflects it.
      try {
        if (isSelected("settings-token-created")) {
          await captureTokenCreated(p, theme, vpName, dark);
          total++;
        }
      } catch (err) {
        if (err instanceof TokenStateUnreachableError) {
          console.warn(
            `SKIPPED settings-token-created for ${theme}/${vpName}: ` +
              `${err.message} — this optional state could not be reached; ` +
              `recorded as skipped (not a failure), run continues.`
          );
          axeReport.push({
            surface: "settings-token-created",
            theme,
            viewport: vpName,
            confirmed: [],
            indeterminate: [],
            skipped: true,
            skipReason: err.message,
          });
        } else {
          const message =
            `settings-token-created FAILED for ${theme}/${vpName} AFTER ` +
            `reaching the state (the audit or capture step itself broke, ` +
            `not merely "could not reach") — this WILL fail the run's ` +
            `exit code: ${err instanceof Error ? err.message : String(err)}`;
          console.error(message);
          hardFailures.push(message);
          axeReport.push({
            surface: "settings-token-created",
            theme,
            viewport: vpName,
            confirmed: [],
            indeterminate: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
        writeReport();
      }

      await ctx.close();
    }
  }

  await browser.close();
  console.log(`captured ${total} images → ${outDir}`);

  // Final write is a formality — writeReport() already ran after every
  // audited/skipped/errored surface (task-7 review, Finding 4) — but cheap
  // insurance that the very last entry's totals are on disk too.
  writeReport();
  console.log(`axe report (${axeReport.length} entries) → ${axeReportPath}`);

  assertTodayStatesDiffer();

  const totals = computeTotals(axeReport);
  const withConfirmed = axeReport.filter((e) => e.confirmed.length > 0);
  const withIndeterminate = axeReport.filter((e) => e.indeterminate.length > 0);
  const skippedEntries = axeReport.filter((e) => e.skipped);
  const erroredEntries = axeReport.filter((e) => e.error);

  // Node-level counts lead (task-7 review — a seeded-data re-measurement
  // found the rule-row count move 46→44 while the node count moved
  // 1398→1687, +20.7%, hiding a real regression; see
  // docs/axe-baseline-2026-08-11-seeded.md). Both numbers are printed, both
  // clearly labelled, so neither can be mistaken for the other.
  console.log(
    `\n=== axe summary (NODE-level counts lead; rule-row counts are the ` +
      `secondary, more easily-gamed number) ===\n` +
      `CONFIRMED DEFECTS (gates the exit code): ${totals.confirmedNodes} ` +
      `node(s) across ${totals.confirmedRuleRows} rule finding(s), in ` +
      `${withConfirmed.length}/${axeReport.length} surface/theme/viewport combinations.\n` +
      `INDETERMINATE (axe could not compute a ratio; reported, does NOT ` +
      `gate the exit code): ${totals.indeterminateNodes} node(s) across ` +
      `${totals.indeterminateRuleRows} rule finding(s), in ` +
      `${withIndeterminate.length}/${axeReport.length} combinations.`
  );

  for (const entry of axeReport) {
    if (entry.skipped) {
      console.log(
        `  ${entry.surface} — ${entry.theme}/${entry.viewport}: SKIPPED (${entry.skipReason})`
      );
      continue;
    }
    if (entry.error) {
      console.log(
        `  ${entry.surface} — ${entry.theme}/${entry.viewport}: ERROR (${entry.error})`
      );
      continue;
    }
    if (entry.confirmed.length === 0 && entry.indeterminate.length === 0)
      continue;
    const confirmedIds = entry.confirmed.map((v) => v.id).join(", ") || "—";
    const indeterminateIds =
      entry.indeterminate.map((v) => v.id).join(", ") || "—";
    console.log(
      `  ${entry.surface} — ${entry.theme}/${entry.viewport}: ` +
        `confirmed ${entry.confirmed.reduce((s, f) => s + f.nodes.length, 0)} node(s) (${confirmedIds}); ` +
        `indeterminate ${entry.indeterminate.reduce((s, f) => s + f.nodes.length, 0)} node(s) (${indeterminateIds})`
    );
  }

  // Exit code gates ONLY on confirmed defects — never on indeterminate
  // findings (see file header and scripts/lib/axe-report.ts for why: the
  // four gradient-background surfaces can never resolve those, which would
  // make the exit code unfalsifiable).
  //
  // --no-axe-gate hands that decision downstream. See scripts/lib/axe-gate.ts:
  // in surfaces.yml the ratchet is the gate, and it needs both captures to
  // have finished in order to sum them.
  if (totals.confirmedNodes > 0) {
    if (AXE_GATE) {
      process.exitCode = 1;
    } else {
      console.log(
        `\n--no-axe-gate: ${totals.confirmedNodes} confirmed node(s) do not ` +
          `fail this run. The ratchet adjudicates them against ` +
          `surface-ceilings.json once every capture has finished.`
      );
    }
  }

  if (erroredEntries.length > 0 || hardFailures.length > 0) {
    console.error(
      `\n${hardFailures.length} surface(s) were reached but then failed ` +
        `(not merely skipped) — this fails the run regardless of the axe ` +
        `totals above:\n${hardFailures.map((m) => `  - ${m}`).join("\n")}`
    );
    process.exitCode = 1;
  }

  if (skippedEntries.length > 0) {
    console.warn(
      `\n${skippedEntries.length} optional surface(s) were skipped (state ` +
        `could not be reached) — does not affect the exit code, but check ` +
        `these were not supposed to be reachable: ` +
        `${skippedEntries.map((e) => `${e.theme}/${e.viewport}`).join(", ")}`
    );
  }

  if (leakedTokenLabels.length > 0) {
    console.error(
      `\n${leakedTokenLabels.length} API token(s) could not be auto-revoked ` +
        `and are still live on the account: ${leakedTokenLabels.join(", ")}. ` +
        `Revoke them by hand in Settings → Advanced / API.`
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
