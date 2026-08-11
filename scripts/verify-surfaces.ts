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
// Usage: npx tsx scripts/verify-surfaces.ts <slice-name>
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
//   SCREENSHOT_BASE_URL Optional, default http://localhost:3000. Override
//                       whenever port 3000 is unavailable — on this machine
//                       it is *permanently* the live production container
//                       and must never be pointed at by this script. Start
//                       the dev server on another port (3100 is verified)
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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import type Axe from "axe-core";
import { hexToRgb } from "../src/lib/design/contrast";
import { resolvedThemeTokens } from "../src/lib/design/tokens";
import {
  splitFindings,
  computeTotals,
  type AxeFinding,
} from "./lib/axe-report";

// Playwright is not in node_modules — it lives only in the npx cache, at
// several versions, and only one matches the installed chromium revision.
// Resolve from the environment so no machine's home directory is baked into
// the repo, with the verified path as the documented default.
const PLAYWRIGHT_CORE =
  process.env.PLAYWRIGHT_CORE ??
  `${process.env.HOME}/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core`;
let chromium: typeof import("playwright-core").chromium;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ chromium } = require(PLAYWRIGHT_CORE));
} catch {
  throw new Error(
    `Cannot load playwright-core from ${PLAYWRIGHT_CORE}. Set PLAYWRIGHT_CORE to ` +
      `a copy whose playwright-core/browsers.json chromium revision matches a ` +
      `directory in ~/.cache/ms-playwright. See Task 6 Step 1.`
  );
}

// Default matches the brief; override when port 3000 is unavailable (see
// header comment) via SCREENSHOT_BASE_URL, and point the dev server's own
// BETTER_AUTH_URL at the same origin.
// FAILS CLOSED, DELIBERATELY. There is no default. This script signs in as
// the owner, walks every surface, and creates a real API token through the
// real UI — and on this machine port 3000 is the LIVE PRODUCTION container.
// An earlier version defaulted to exactly that, so running it with no env var
// would have driven all of the above against production and, if revocation
// failed, left a live API token behind. The plan document was corrected and
// this line was not; the final whole-branch review caught it. Nine more
// slices will run this script, so it must refuse rather than guess.
const BASE_URL = (() => {
  const url = process.env.SCREENSHOT_BASE_URL;
  if (!url) {
    throw new Error(
      "SCREENSHOT_BASE_URL is required — this script has no default on purpose.\n" +
        "Point it at a DEV server, never production:\n" +
        "  BETTER_AUTH_URL=http://localhost:3100 TRUSTED_ORIGINS=http://localhost:3100 npx next dev -p 3100\n" +
        "  SCREENSHOT_BASE_URL=http://localhost:3100 npx tsx scripts/verify-surfaces.ts <slice>\n" +
        "Port 3000 is the live production container on this machine."
    );
  }
  if (/localhost:3000|127\.0\.0\.1:3000/.test(url)) {
    throw new Error(
      `Refusing to run against ${url} — port 3000 is the live production ` +
        `container. This script creates real data. Use a dev server (3100).`
    );
  }
  return url;
})();

const SURFACES: Record<string, string> = {
  today: "/",
  train: "/train",
  coach: "/coach",
  body: "/body",
  settings: "/settings",
  admin: "/admin",
  import: "/import",
  "activity-log": "/activity/log",
  login: "/login",
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
  throw new Error("usage: tsx scripts/verify-surfaces.ts <slice-name>");

const outDir = join(process.cwd(), ".screenshots", slice);
mkdirSync(outDir, { recursive: true });
const axeReportPath = join(outDir, "axe-report.json");

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
      await page.screenshot({ path: filePath, fullPage: true });
      await auditPage(page, surfaceName, theme, vpName);
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
 * applying `.dark` for the first time activated 11 previously-dead
 * `dark:` utilities, including the "token created" success box in
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
 * (the two of the slice's 11 newly-activated `dark:` utilities that live in
 * `api-tokens-card.tsx`): the box is client-component state rendered right
 * after a real token creation, never server-rendered, so the plain
 * `/settings` capture in captureWithRetry never reaches it. Audited here,
 * right after the screenshot, while the box is still on screen and before
 * the `finally` block below revokes the token and removes it.
 *
 * task-7 review, Finding 2: this surface is the ONLY place axe ever sees two
 * of the eleven `dark:` utilities this slice newly activated, and it now
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
    await page.screenshot({
      path: join(outDir, `settings-token-created-${theme}-${vpName}.png`),
      fullPage: true,
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
      for (const [name, path] of Object.entries(SURFACES)) {
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
      }

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
      //     ever sees two of this slice's eleven newly-activated `dark:`
      //     utilities. Recorded as `error` AND collected into
      //     hardFailures so the run's exit code reflects it.
      try {
        await captureTokenCreated(p, theme, vpName, dark);
        total++;
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
  if (totals.confirmedNodes > 0) {
    process.exitCode = 1;
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
