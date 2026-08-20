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
import { checkRatchet, type Ceilings } from "./lib/surface-ratchet";
import type { ReportTotals } from "./lib/axe-report";

const slices = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (slices.length === 0) {
  throw new Error(
    "usage: npx tsx scripts/surface-ratchet.ts <slice> [<slice>...] [--update]"
  );
}
const update = process.argv.includes("--update");

const CEILINGS_PATH = join(process.cwd(), "surface-ceilings.json");

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

if (update) {
  const next = {
    confirmedNodes: totals.confirmedNodes,
    measured: new Date().toISOString().slice(0, 10),
    slices,
  };
  writeFileSync(CEILINGS_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `surface-ceilings.json updated from ${slices.join(" + ")}: ` +
      `confirmedNodes = ${totals.confirmedNodes}`
  );
  process.exit(0);
}

const ceilings = JSON.parse(readFileSync(CEILINGS_PATH, "utf8")) as Ceilings;
const SLACK = 0;
const result = checkRatchet(totals, ceilings, SLACK);

console.log(result.message);
console.log(
  `indeterminate (never gates): ${totals.indeterminateNodes} nodes, ` +
    `${totals.indeterminateRuleRows} rule rows`
);
if (!result.ok) process.exit(1);
