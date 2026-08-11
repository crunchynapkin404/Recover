// scripts/screenshot.ts — Phase 2b.4 verification.
// Captures each surface in both themes at two viewports. Light mode is
// forced by setting the class directly, which is why ThemeProvider's
// forcedTheme="dark" does not blind us to it.
//
// Usage: npx tsx scripts/screenshot.ts <slice-name>
//
// Requires, per docs/plans/2026-08-11-v099-slice0-foundations.md Task 6:
//   CHROME_PATH, LD_LIBRARY_PATH (cached sysdeps), and a dev server started
//   with BETTER_AUTH_URL=http://localhost:<port> — without it, secure-cookie
//   mode drops the session and every authenticated capture is a login page.
//
// SMOKE_EMAIL / SMOKE_PASSWORD must be a real, seeded account on the DEV
// database. SCREENSHOT_BASE_URL overrides the default localhost:3000 target
// — needed on machines (this one included) where port 3000 is permanently
// occupied by a live production instance that must never be touched. Point
// the dev server started for this script at whatever port you choose and
// pass the same origin here.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

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

const VIEWPORTS = {
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
 * Sign in through the real form and return reusable storage state. Do NOT
 * fabricate a session cookie — a hand-made cookie that better-auth rejects
 * produces a login page in every capture, which looks like a styling bug.
 * Clicking before hydration silently posts nothing and waitForURL times out,
 * which reads like bad credentials — wait for the button, then pause.
 * Wrapped in a retry: a single blip signing in against a local dev server
 * that just started is not evidence of a real problem.
 */
async function signIn(browser: import("playwright-core").Browser) {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) {
    throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD must be set.");
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
 * ThemeProvider is forced to dark (`forcedTheme="dark"`, see
 * theme-provider.tsx) until slice 9. next-themes applies that forced class
 * TWICE: once synchronously during HTML parsing (the anti-flicker script,
 * well before our addInitScript's DOMContentLoaded listener can act), and
 * again from a React mount effect that fires ~0.3-0.5s *after*
 * DOMContentLoaded — after our one-shot toggle already ran, silently
 * clobbering it back to dark. Verified interactively: a class removed at
 * DOMContentLoaded is back within 500ms with no observable DOM mutation
 * event (React sets it via a path a MutationObserver in the init script
 * never caught either). The addInitScript below still runs (harmless, and
 * it's what the brief specifies), but the reliable fix is reasserting the
 * class from the driving script itself, after `networkidle` — by then
 * hydration and every mount effect are long done and nothing fires again to
 * undo it. Confirmed empirically: applying the toggle post-networkidle held
 * for 3+ seconds with zero reversion across repeated checks.
 */
async function forceTheme(page: Page, dark: boolean) {
  await page.evaluate(
    (d: boolean) => document.documentElement.classList.toggle("dark", d),
    dark
  );
}

/**
 * A single patched Chromium hitting one local Next.js + Postgres process
 * back to back will occasionally produce one bad capture that is fine on a
 * retry (known flakiness, not the app's fault). Retry once before giving up.
 */
async function captureWithRetry(
  page: Page,
  url: string,
  path: string,
  dark: boolean
) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
      await forceTheme(page, dark);
      await page.screenshot({ path, fullPage: true });
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

/**
 * Settings-specific extra capture. Global constraint (Task 2 finding):
 * applying `.dark` for the first time activated 11 previously-dead
 * `dark:` utilities, including the "token created" success box in
 * api-tokens-card.tsx (green-50/white → green-950/black). That box only
 * renders as client component state right after a real creation — it is
 * never derived from the server-rendered token list — so it must be reached
 * through the real form, screenshotted, and cleaned up via the real Revoke
 * button so the run leaves no debris in the account's settings.
 */
async function captureTokenCreated(
  page: Page,
  theme: string,
  vpName: string,
  dark: boolean
) {
  const label = `screenshot-verify-${theme}-${vpName}-${Date.now()}`;
  await page.goto(`${BASE_URL}/settings`, {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  await forceTheme(page, dark);
  // ApiTokensCard lives inside the collapsed-by-default "Advanced / API"
  // section; open it before the form inside becomes actionable.
  await page.locator('button:has-text("Advanced / API")').click();
  await page.waitForSelector("#tokenLabel", { state: "visible" });
  await page.fill("#tokenLabel", label);
  await page.click('button[type="submit"]:has-text("Create token")');
  await page.waitForSelector("text=Copy this token now", { timeout: 10_000 });
  // Let the revalidated server data settle, then reassert the theme —
  // cheap insurance against the same forcedTheme re-render race
  // captureWithRetry works around (see forceTheme's comment).
  await page.waitForTimeout(300);
  await forceTheme(page, dark);
  await page.screenshot({
    path: join(outDir, `settings-token-created-${theme}-${vpName}.png`),
    fullPage: true,
  });

  // Clean up through the real UI so the account is left as found.
  const row = page.locator("div.flex.items-center.justify-between", {
    has: page.getByText(label, { exact: true }),
  });
  await row.getByRole("button", { name: "Revoke" }).click();
  await page.waitForTimeout(500);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
  });

  const storageState = await signIn(browser);

  let total = 0;
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    for (const theme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ storageState, viewport });
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
          `${BASE_URL}${path}`,
          join(outDir, `${name}-${theme}-${vpName}.png`),
          dark
        );
        total++;
      }

      // Reach and capture the api-tokens-card "token created" state, once
      // per theme/viewport combination, then clean up via the real UI.
      await captureTokenCreated(p, theme, vpName, dark);
      total++;

      await ctx.close();
    }
  }

  await browser.close();
  console.log(`captured ${total} images → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
