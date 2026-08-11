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
// Five synthetic pages, chosen because they reproduce the exact real
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
//   C — ONE CHARACTER on an opaque background at 3.45:1 (C3, whole-branch
//       review 2026-08-11). axe resolves both colours, computes the ratio,
//       and STILL files it as "incomplete" with messageKey
//       "shortTextContent" purely because the text is one character long.
//       Confirmed defect: `%`, `·`, lone digits and single-letter axis and
//       weekday labels are the densest content on this app's Train and Body
//       surfaces. Before the fix this page exited 0.
//   D — the SAME one character over a gradient. Same messageKey as C, but
//       `contrastRatio: 0`, because axe never resolved the background.
//       Indeterminate — which is why the split is drawn at "is there a
//       number", not at a messageKey.
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

// #8a8a8a is this app's own --hairline (light) / --ink-muted (dark) value;
// on white it measures 3.45:1, and one character is all it takes for axe to
// downgrade a computed failure to "incomplete".
const HTML_C_CONFIRMED_VIA_SHORT_TEXT = `<!doctype html><html lang="en"><head><title>Proof C</title></head><body>
<main><h1>Proof C</h1>
<p style="color:#8a8a8a;background:#ffffff;">7</p>
</main></body></html>`;

const HTML_D_INDETERMINATE_SHORT_TEXT_ON_GRADIENT = `<!doctype html><html lang="en"><head><title>Proof D</title></head><body>
<main><h1>Proof D</h1>
<div style="min-height:50vh;background:linear-gradient(135deg,#111,#333);">
  <p style="color:#e5e5e5;">7</p>
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

/** The five cases, and what each one must do to the exit code. */
const CASES: {
  label: string;
  html: string;
  /** true = this page's defect MUST gate the exit code non-zero. */
  gates: boolean;
}[] = [
  {
    label:
      '[A] white-on-white, opaque (axe files it under "incomplete"/equalRatio)',
    html: HTML_A_CONFIRMED_VIA_EQUAL_RATIO,
    gates: true,
  },
  {
    label:
      '[E] low-contrast opaque text (axe-certain, ordinary "violations" bucket)',
    html: HTML_E_CONFIRMED_VIA_VIOLATION,
    gates: true,
  },
  {
    label:
      '[C] ONE CHARACTER, opaque, computed 3.45:1 ("incomplete"/shortTextContent) — C3',
    html: HTML_C_CONFIRMED_VIA_SHORT_TEXT,
    gates: true,
  },
  {
    label:
      "[B] gradient background, plausible text (axe cannot compute a ratio at all)",
    html: HTML_B_INDETERMINATE_GRADIENT,
    gates: false,
  },
  {
    label:
      "[D] the same ONE CHARACTER over a gradient (same messageKey as C, no ratio)",
    html: HTML_D_INDETERMINATE_SHORT_TEXT_ON_GRADIENT,
    gates: false,
  },
];

/** The colour-contrast `data` axe attached, so the output evidences itself. */
function contrastData(
  findings: ReturnType<typeof splitFindings>["confirmed"]
): string {
  const parts: string[] = [];
  for (const f of findings) {
    if (f.id !== "color-contrast") continue;
    for (const n of f.nodes) {
      for (const check of n.any) {
        const d = check.data as {
          contrastRatio?: number;
          messageKey?: string | null;
          expectedContrastRatio?: string;
        } | null;
        if (!d) continue;
        parts.push(
          `${d.contrastRatio ?? "—"}:1 vs ${d.expectedContrastRatio ?? "—"} (${d.messageKey ?? "no messageKey"})`
        );
      }
    }
  }
  return parts.join("; ") || "—";
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
  });

  let ok = true;

  for (const c of CASES) {
    const { violations, incomplete } = await runAxe(browser, c.html);
    const split = splitFindings(violations, incomplete);
    const exitNonZero = wouldExitNonZero([split]);
    const totals = computeTotals([split]);
    console.log(
      `\n${c.label}:\n` +
        `  confirmed: ${split.confirmed.length} rule row(s), ${totals.confirmedNodes} node(s) — ${contrastData(split.confirmed)}\n` +
        `  indeterminate: ${split.indeterminate.length} rule row(s), ${totals.indeterminateNodes} node(s) — ${contrastData(split.indeterminate)}\n` +
        `  would exit non-zero: ${exitNonZero} (must be ${c.gates})`
    );
    const passed = c.gates
      ? exitNonZero && split.confirmed.length > 0
      : !exitNonZero &&
        split.confirmed.length === 0 &&
        split.indeterminate.length > 0;
    if (passed) {
      console.log(
        c.gates
          ? "  PASS: confirmed defect correctly gates the exit code non-zero."
          : "  PASS: indeterminate-only result correctly does NOT gate the exit code."
      );
    } else {
      console.error(
        c.gates
          ? "  FAIL: expected this defect to gate the exit code non-zero."
          : "  FAIL: expected an indeterminate-only result to leave the exit code at zero."
      );
      ok = false;
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
