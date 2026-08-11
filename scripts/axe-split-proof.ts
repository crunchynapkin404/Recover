// scripts/axe-split-proof.ts — task-7 review, Finding 1: a checked-in,
// re-runnable, real-browser proof that the confirmed/indeterminate split
// (scripts/lib/axe-report.ts) discriminates in BOTH directions, using the
// exact same real headless Chromium + real axe-core this repo's
// verify-surfaces.ts uses — not a mock, not a synthetic Axe.Result object
// (that version lives in tests/axe-report-split.test.ts as the fast,
// deterministic companion proof; this one exists because the review that
// asked for this said the previous throwaway version "was thrown away and
// could not be verified" — this one is committed instead).
//
// Three synthetic pages, chosen because they reproduce the exact real
// failure modes this app hits (verified empirically — see each HTML_*
// constant's comment):
//   A — opaque white-on-white text. Confirmed defect, but notably filed by
//       axe under the "incomplete" bucket (messageKey "equalRatio",
//       contrastRatio 1) rather than "violations" — this is the case a
//       naive "trust the bucket name" split would get wrong.
//   B — plausible-looking text over a CSS gradient background, exactly this
//       app's today/train/coach/body pattern. axe cannot compute a ratio at
//       all (messageKey "bgGradient", contrastRatio 0) — indeterminate,
//       must NOT gate the exit code.
//   E — opaque, low-but-nonzero contrast. A plain axe-certain violation —
//       confirmed via the ordinary "violations" bucket path.
//
// Usage: CHROME_PATH=... LD_LIBRARY_PATH=... npx tsx scripts/axe-split-proof.ts
// Exits 0 if the split behaves correctly in both directions, 1 otherwise —
// so this file is itself a regression check, not just a demo.
import type Axe from "axe-core";
import { splitFindings, computeTotals } from "./lib/axe-report";

const PLAYWRIGHT_CORE =
  process.env.PLAYWRIGHT_CORE ??
  `${process.env.HOME}/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core`;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require(
  PLAYWRIGHT_CORE
) as typeof import("playwright-core");

// lang + title + a heading/landmark on every page below: isolates the
// color-contrast behavior under test from unrelated real axe rules
// (document-title, html-has-lang, landmark-one-main, page-has-heading-one,
// region) that a genuinely bare HTML skeleton also trips — those are real
// findings too, just not the ones this proof is about.
const HTML_A_CONFIRMED_VIA_EQUAL_RATIO = `<!doctype html><html lang="en"><head><title>Proof A</title></head><body>
<main><h1>Proof A</h1>
<p style="color:#ffffff;background:#ffffff;">white on white, opaque, confirmed</p>
</main></body></html>`;

const HTML_B_INDETERMINATE_GRADIENT = `<!doctype html><html lang="en"><head><title>Proof B</title></head><body>
<main><h1>Proof B</h1>
<div style="min-height:50vh;background:linear-gradient(135deg,#111,#333);">
  <p style="color:#e5e5e5;">gray text on a dark gradient — this app's exact today/train/coach/body pattern</p>
</div>
</main></body></html>`;

const HTML_E_CONFIRMED_VIA_VIOLATION = `<!doctype html><html lang="en"><head><title>Proof E</title></head><body>
<main><h1>Proof E</h1>
<p style="color:#777777;background:#666666;">low but nonzero contrast, opaque, resolvable</p>
</main></body></html>`;

async function runAxe(
  browser: import("playwright-core").Browser,
  html: string
): Promise<{ violations: Axe.Result[]; incomplete: Axe.Result[] }> {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const result = await page.evaluate(async () => {
      // @ts-expect-error — see verify-surfaces.ts's auditPage for why.
      return await window.axe.run(document, {
        resultTypes: ["violations", "incomplete"],
      });
    });
    return {
      violations: result.violations as Axe.Result[],
      incomplete: result.incomplete as Axe.Result[],
    };
  } finally {
    await page.close();
  }
}

/** Mirrors verify-surfaces.ts main()'s actual exit-code decision: non-zero iff any confirmed node exists anywhere in the run. */
function wouldExitNonZero(
  entries: {
    confirmed: ReturnType<typeof splitFindings>["confirmed"];
    indeterminate: ReturnType<typeof splitFindings>["indeterminate"];
  }[]
): boolean {
  return computeTotals(entries).confirmedNodes > 0;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
  });

  let ok = true;

  // --- FAIL half #1: confirmed defect filed under axe's "incomplete" bucket (equalRatio/1) ---
  {
    const { violations, incomplete } = await runAxe(
      browser,
      HTML_A_CONFIRMED_VIA_EQUAL_RATIO
    );
    const split = splitFindings(violations, incomplete);
    const exitNonZero = wouldExitNonZero([split]);
    console.log(
      `\n[A] white-on-white (opaque, axe files under "incomplete"/equalRatio):\n` +
        `  confirmed: ${split.confirmed.length} rule row(s), ${split.confirmed.reduce((s, f) => s + f.nodes.length, 0)} node(s)\n` +
        `  indeterminate: ${split.indeterminate.length} rule row(s)\n` +
        `  would exit non-zero: ${exitNonZero}`
    );
    if (!exitNonZero || split.confirmed.length === 0) {
      console.error(
        "  FAIL: expected a confirmed defect to gate the exit code non-zero."
      );
      ok = false;
    } else {
      console.log(
        "  PASS: confirmed defect correctly gates the exit code non-zero."
      );
    }
  }

  // --- FAIL half #2: confirmed defect via the ordinary "violations" bucket ---
  {
    const { violations, incomplete } = await runAxe(
      browser,
      HTML_E_CONFIRMED_VIA_VIOLATION
    );
    const split = splitFindings(violations, incomplete);
    const exitNonZero = wouldExitNonZero([split]);
    console.log(
      `\n[E] low-contrast opaque text (axe-certain "violations" bucket):\n` +
        `  confirmed: ${split.confirmed.length} rule row(s)\n` +
        `  would exit non-zero: ${exitNonZero}`
    );
    if (!exitNonZero || split.confirmed.length === 0) {
      console.error(
        "  FAIL: expected a plain violation to gate the exit code non-zero."
      );
      ok = false;
    } else {
      console.log(
        "  PASS: plain violation correctly gates the exit code non-zero."
      );
    }
  }

  // --- PASS half: indeterminate-only result must NOT gate the exit code ---
  {
    const { violations, incomplete } = await runAxe(
      browser,
      HTML_B_INDETERMINATE_GRADIENT
    );
    const split = splitFindings(violations, incomplete);
    const exitNonZero = wouldExitNonZero([split]);
    console.log(
      `\n[B] gradient background, plausible text (axe cannot compute a ratio at all):\n` +
        `  confirmed: ${split.confirmed.length} rule row(s)\n` +
        `  indeterminate: ${split.indeterminate.length} rule row(s), ${split.indeterminate.reduce((s, f) => s + f.nodes.length, 0)} node(s)\n` +
        `  would exit non-zero: ${exitNonZero}`
    );
    if (
      exitNonZero ||
      split.confirmed.length !== 0 ||
      split.indeterminate.length === 0
    ) {
      console.error(
        "  FAIL: expected an indeterminate-only result to leave the exit code at zero."
      );
      ok = false;
    } else {
      console.log(
        "  PASS: indeterminate-only result correctly does NOT gate the exit code."
      );
    }
  }

  await browser.close();

  console.log(
    `\n${ok ? "ALL PROOFS PASSED" : "PROOF FAILED"} — exiting ${ok ? 0 : 1}`
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
