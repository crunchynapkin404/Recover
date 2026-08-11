// scripts/screenshot.ts — Phase 2b.4 verification.
// Captures each surface in both themes at two viewports. Light mode is
// forced by setting the class directly, which is why ThemeProvider's
// forcedTheme="dark" does not blind us to it — see forceThemeVerified below
// for how that forcing is confirmed rather than assumed.
//
// Usage: npx tsx scripts/screenshot.ts <slice-name>
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
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { hexToRgb } from "../src/lib/design/contrast";
import { readTokenSets } from "../src/lib/design/tokens";

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
const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";

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
if (!slice) throw new Error("usage: tsx scripts/screenshot.ts <slice-name>");

const outDir = join(process.cwd(), ".screenshots", slice);
mkdirSync(outDir, { recursive: true });

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
  const sets = readTokenSets();
  const rgb = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    light: rgb(sets.light["surface-base"]),
    dark: rgb(sets.dark["surface-base"]),
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
 * A single patched Chromium hitting one local Next.js + Postgres process
 * back to back will occasionally produce one bad capture that is fine on a
 * retry (known flakiness, not the app's fault). Retry once before giving up.
 */
async function captureWithRetry(
  page: Page,
  surfaceName: string,
  routePath: string,
  filePath: string,
  dark: boolean
) {
  const url = `${BASE_URL}${routePath}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
      assertOnSurface(page, routePath, surfaceName);
      await forceThemeVerified(page, dark);
      await page.screenshot({ path: filePath, fullPage: true });
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
 */
async function captureTokenCreated(
  page: Page,
  theme: string,
  vpName: string,
  dark: boolean
): Promise<void> {
  const label = `screenshot-verify-${theme}-${vpName}-${Date.now()}`;
  let tokenCreated = false;
  try {
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
    await page.waitForSelector("text=Copy this token now", { timeout: 10_000 });
    // From here on a real token exists on the account — the finally block
    // below must run no matter what happens next.
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
          dark
        );
        total++;
      }

      // Reach and capture the api-tokens-card "token created" state, once
      // per theme/viewport combination, then clean up via the real UI.
      // Non-fatal: a failure here must not cost every other surface in the
      // run (Finding 3) — logged loudly and the loop continues.
      try {
        await captureTokenCreated(p, theme, vpName, dark);
        total++;
      } catch (err) {
        console.error(
          `settings-token-created capture failed for ${theme}/${vpName} ` +
            `(non-fatal, continuing with remaining surfaces): ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }

      await ctx.close();
    }
  }

  await browser.close();
  console.log(`captured ${total} images → ${outDir}`);

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
