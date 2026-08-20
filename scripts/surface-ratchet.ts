// scripts/surface-ratchet.ts
//
// Usage: npx tsx scripts/surface-ratchet.ts <slice> [<slice>...] [--update]
//
// Reads .screenshots/<slice>/axe-report.json for every slice named, SUMS their
// totals, and compares against surface-ceilings.json. --update rewrites the
// ceiling FROM THE REPORTS.
//
// Multiple slices because the capture cannot be one job (see
// scripts/lib/surface-select.ts). A ratchet over one job's surfaces would
// leave the other job's confirmed nodes ungated.
//
// The ceiling is never typed by hand. docs/2026-08-20-release-automation-handoff.md
// puts it plainly: point at the run, not at a figure in prose — this roadmap
// has been wrong about counts in both directions.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { checkRatchet, type Ceilings } from "./lib/surface-ratchet";
import type { ReportTotals } from "./lib/axe-report";

const CEILINGS_PATH = join(process.cwd(), "surface-ceilings.json");
const SLACK = 0;

function sumTotals(slices: readonly string[]): ReportTotals {
  const totals: ReportTotals = {
    confirmedRuleRows: 0,
    confirmedNodes: 0,
    indeterminateRuleRows: 0,
    indeterminateNodes: 0,
  };
  for (const slice of slices) {
    const path = join(process.cwd(), ".screenshots", slice, "axe-report.json");
    const report = JSON.parse(readFileSync(path, "utf8")) as {
      totals: ReportTotals;
    };
    totals.confirmedRuleRows += report.totals.confirmedRuleRows;
    totals.confirmedNodes += report.totals.confirmedNodes;
    totals.indeterminateRuleRows += report.totals.indeterminateRuleRows;
    totals.indeterminateNodes += report.totals.indeterminateNodes;
    console.log(`${slice}: ${report.totals.confirmedNodes} confirmed nodes`);
  }
  return totals;
}

/**
 * Written through the repo's own prettier config, not raw JSON.stringify.
 * stringify always expands arrays and prettier collapses short ones, so the
 * raw output produced a file `npm run format:check` rejected — every re-pin
 * would have failed CI on the very commit that re-pinned. Caught by run
 * 32372008291, where the only red step in the whole suite was format:check.
 */
async function writeCeilings(next: Ceilings & Record<string, unknown>) {
  const config = await resolveConfig(CEILINGS_PATH);
  const body = await format(JSON.stringify(next), {
    ...config,
    filepath: CEILINGS_PATH,
  });
  writeFileSync(CEILINGS_PATH, body);
}

async function main() {
  const slices = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (slices.length === 0) {
    throw new Error(
      "usage: npx tsx scripts/surface-ratchet.ts <slice> [<slice>...] [--update]"
    );
  }
  const update = process.argv.includes("--update");
  const totals = sumTotals(slices);

  if (update) {
    await writeCeilings({
      confirmedNodes: totals.confirmedNodes,
      measured: new Date().toISOString().slice(0, 10),
      slices,
    });
    console.log(
      `surface-ceilings.json updated from ${slices.join(" + ")}: ` +
        `confirmedNodes = ${totals.confirmedNodes}`
    );
    return;
  }

  const ceilings = JSON.parse(readFileSync(CEILINGS_PATH, "utf8")) as Ceilings;
  const result = checkRatchet(totals, ceilings, SLACK);

  console.log(result.message);
  console.log(
    `indeterminate (never gates): ${totals.indeterminateNodes} nodes, ` +
      `${totals.indeterminateRuleRows} rule rows`
  );
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
