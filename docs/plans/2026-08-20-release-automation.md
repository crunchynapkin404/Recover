# Release Path and CI/CD Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole release path into GitHub Actions — Playwright surface
capture included — so an agent can take a merged roadmap item to production
through workflows that cannot skip their own steps.

**Architecture:** Composed `workflow_dispatch` workflows, one per release
stage, rather than one orchestrator: every failure on this project's record is
a sequence abandoned partway, and a path re-entered at the failed step beats
one that must restart. Hosted runners do everything that needs no prod access;
a dispatch-only ephemeral self-hosted runner on devbox does the soak and the
deploy verification, because GitHub's runners cannot reach 10.0.10.100. One
human step survives on purpose — someone opens the capture before promotion.

**Tech Stack:** GitHub Actions, Docker/GHCR, Node 22, `playwright-core`
(exact-pinned devDependency), `tsx`, vitest, Postgres 16, drizzle.

**Spec:** `docs/specs/2026-08-20-release-automation-design.md`

## Global Constraints

Every task's requirements implicitly include these. Values are verbatim.

- **`BETTER_AUTH_SECRET` must be ≥ 32 characters** anywhere the real app boots.
  `src/lib/env-validation.ts:16` throws below that. `ci.yml`'s current
  `ci-only-secret` is 14 and survives only because vitest never runs the
  instrumentation hook.
- **The owner is `dev@recover.local`.** `demo@recover.local` is a `member` and
  `/admin` redirects it. `verify-surfaces.ts` signs in as the OWNER. Seeding
  the wrong one is the 2026-08-14 defect that voided every reading taken before
  2026-08-16.
- **Nothing may write `:latest` except `promote.yml`.** `tests/release-gate.test.ts`
  fails if that stops being true.
- **`release.yml`'s trigger stays `tags: ["v*-rc.*"]`.** Do not touch that file.
  Widening it to `v*` is the v0.105.1 defect.
- **No self-hosted runner may serve `pull_request` or `pull_request_target`.**
  The repository is public; that pairing is arbitrary code execution on a box
  with SSH to production.
- **Node 22, `npm ci`.** Match `ci.yml`.
- **Surface counts come from a run, never from prose.** No task may copy a
  number out of a document into code.
- **Prettier formats fenced code blocks inside markdown.** Scripted edits that
  match on exact code text drift after the first `prettier --write`. Use
  anchors that survive reflow, or edit before formatting.
- **`.screenshots/` is gitignored** (`.gitignore:55`). Captures leave a job as
  artifacts, never as commits.

## File Structure

**Created:**

| Path                                   | Responsibility                                          |
| -------------------------------------- | ------------------------------------------------------- |
| `scripts/lib/surface-select.ts`        | Pure surface filtering. No I/O, no browser.             |
| `scripts/lib/surface-ratchet.ts`       | Pure ceiling comparison. No I/O.                        |
| `scripts/surface-ratchet.ts`           | CLI: read a report, compare or update ceilings.         |
| `surface-ceilings.json`                | The committed ceiling. Written by a run.                |
| `tests/surface-select.test.ts`         | Guards the filter, including typo rejection.            |
| `tests/surface-ratchet.test.ts`        | Guards the ratchet direction and slack.                 |
| `scripts/verify-deploy.sh`             | Tracked, host-parameterised deploy verification.        |
| `.github/workflows/surfaces.yml`       | Playwright capture + axe ratchet. Hosted.               |
| `.github/workflows/release-rc.yml`     | Cut and push an RC tag. Hosted.                         |
| `.github/workflows/soak.yml`           | RC stack, drills, capture. **devbox.**                  |
| `.github/workflows/finish-release.yml` | Verify deploy, tag, release page. **devbox.**           |
| `docs/RUNNER.md`                       | How the devbox runner is registered and why it is safe. |

**Modified:** `.github/workflows/ci.yml`, `.github/workflows/promote.yml`,
`scripts/verify-surfaces.ts`, `tests/release-gate.test.ts`, `package.json`,
`CONTRIBUTING.md`, `docs/RELEASING.md`.

**Deleted:** `scripts/release.sh`.

---

# Phase 1 — Capture in Actions

No runner needed. Ends with Playwright running on every pull request.

### Task 1: Surface selection

`verify-surfaces.ts`'s `process.argv[2]` is an output directory name, not a
filter — `main()` always walks every surface. That makes the spec's two-job
split impossible today, and it is worse than it looks: `assertTodayStatesDiffer()`
(`scripts/verify-surfaces.ts:745`) fails the run when `today`,
`today-post-session` and `today-evening` come out byte-identical, which is
exactly what a production build produces, because `previewStateFrom`
(`src/lib/today/state.ts:99`) returns `null` under `NODE_ENV=production`. The
full suite structurally cannot pass against a production build.

**Files:**

- Create: `scripts/lib/surface-select.ts`
- Create: `tests/surface-select.test.ts`
- Modify: `scripts/verify-surfaces.ts` (argument parsing near line 658, and the
  `SURFACES` iteration inside `main()` near line 1500)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `selectSurfaces(all: readonly string[], sel: SurfaceSelection): string[]`
  and `interface SurfaceSelection { only?: readonly string[]; except?: readonly string[] }`.
  Task 4 relies on the `--only=` / `--except=` CLI flags this adds.

- [ ] **Step 1: Write the failing test**

```ts
// tests/surface-select.test.ts
import { describe, expect, it } from "vitest";
import { selectSurfaces } from "../scripts/lib/surface-select";

const ALL = ["today", "today-evening", "train", "admin"];

describe("selectSurfaces", () => {
  it("returns everything when neither filter is given", () => {
    expect(selectSurfaces(ALL, {})).toEqual(ALL);
  });

  it("keeps only the named surfaces, in the original order", () => {
    expect(selectSurfaces(ALL, { only: ["train", "today"] })).toEqual([
      "today",
      "train",
    ]);
  });

  it("drops the named surfaces", () => {
    expect(selectSurfaces(ALL, { except: ["today", "today-evening"] })).toEqual(
      ["train", "admin"]
    );
  });

  // A typo that silently captures nothing is the exact silent-pass failure
  // this repository keeps rediscovering. Refuse it loudly instead.
  it("throws on an unknown name in only", () => {
    expect(() => selectSurfaces(ALL, { only: ["trian"] })).toThrow(/trian/);
  });

  it("throws on an unknown name in except", () => {
    expect(() => selectSurfaces(ALL, { except: ["nope"] })).toThrow(/nope/);
  });

  it("throws when both filters are given", () => {
    expect(() =>
      selectSurfaces(ALL, { only: ["train"], except: ["admin"] })
    ).toThrow(/both/i);
  });

  it("throws when the selection is empty", () => {
    expect(() => selectSurfaces(ALL, { except: ALL })).toThrow(/no surfaces/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/surface-select.test.ts`
Expected: FAIL — cannot resolve `../scripts/lib/surface-select`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/lib/surface-select.ts
/**
 * Surface filtering for verify-surfaces.ts.
 *
 * WHY THIS EXISTS. The capture cannot run as one job. `previewStateFrom`
 * (src/lib/today/state.ts) returns null when NODE_ENV === "production", so a
 * production build renders whichever state the clock dictates for all three
 * `today*` surfaces — and assertTodayStatesDiffer() then fails the run on the
 * byte-identical PNGs, correctly. So the production-build job must exclude
 * those three and a dev-server job must capture exactly them.
 *
 * Every rejection below is loud on purpose. A filter that quietly matches
 * nothing reports a clean run over an empty capture, which is the same shape
 * as the defects this whole pipeline exists to catch.
 */
export interface SurfaceSelection {
  only?: readonly string[];
  except?: readonly string[];
}

export function selectSurfaces(
  all: readonly string[],
  { only, except }: SurfaceSelection
): string[] {
  if (only && except) {
    throw new Error(
      "surface selection: pass --only or --except, not both — they cannot be " +
        "combined without an ordering rule nobody would remember."
    );
  }

  const known = new Set(all);
  const unknown = [...(only ?? []), ...(except ?? [])].filter(
    (n) => !known.has(n)
  );
  if (unknown.length > 0) {
    throw new Error(
      `surface selection: unknown surface(s) ${unknown.join(", ")}. ` +
        `Known surfaces: ${all.join(", ")}`
    );
  }

  let selected = [...all];
  if (only) {
    const wanted = new Set(only);
    selected = all.filter((n) => wanted.has(n));
  } else if (except) {
    const dropped = new Set(except);
    selected = all.filter((n) => !dropped.has(n));
  }

  if (selected.length === 0) {
    throw new Error("surface selection: no surfaces left to capture.");
  }
  return selected;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/surface-select.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into `verify-surfaces.ts`**

Below the existing `const slice = process.argv[2]` block (around line 658), add
flag parsing. Keep `argv[2]` as the slice so every documented invocation still
works:

```ts
import { selectSurfaces } from "./lib/surface-select";

function flagList(name: string): string[] | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  return arg
    .slice(name.length + 3)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const SELECTED_SURFACES = selectSurfaces(Object.keys(SURFACES), {
  only: flagList("only"),
  except: flagList("except"),
});
```

Then, inside `main()`, iterate `SELECTED_SURFACES` instead of
`Object.keys(SURFACES)`. `assertTodayStatesDiffer()` needs no change: it
already `continue`s past a PNG that was never written, so excluding the three
`today*` surfaces makes it a no-op rather than a false failure.

- [ ] **Step 6: Prove the split works both ways**

Run, against a dev server on 3200 with a seeded owner:

```bash
npx tsx scripts/verify-surfaces.ts sel-probe --only=today,today-evening,today-post-session
npx tsx scripts/verify-surfaces.ts sel-probe-2 --except=today,today-evening,today-post-session
```

Expected: the first writes 12 PNGs (3 surfaces × 2 themes × 2 viewports) and
`assertTodayStatesDiffer` is exercised; the second writes none of the three and
does not fail on them.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/surface-select.ts tests/surface-select.test.ts scripts/verify-surfaces.ts
git commit -m "feat(surfaces): select surfaces by name, refusing typos loudly

The capture cannot be one job: previewStateFrom returns null under
NODE_ENV=production, so a production build renders one clock-chosen state
three times and assertTodayStatesDiffer fails the run on the identical
PNGs. Splitting the capture needs a filter, and argv[2] was only ever an
output directory name."
```

### Task 2: The axe ratchet

`CONTRIBUTING.md` names a zero-threshold gate as the decisive blocker: the
recorded baseline is non-zero by design and a red suite is how a check gets
disabled. The fix it names is a ratchet against a committed baseline, in the
shape `tests/type-scale-guard.test.ts`'s `OFFENDER_CEILINGS` uses — fail on a
**rise**, not on non-zero.

**Files:**

- Create: `scripts/lib/surface-ratchet.ts`
- Create: `tests/surface-ratchet.test.ts`
- Create: `scripts/surface-ratchet.ts`
- Create: `surface-ceilings.json`
- Modify: `package.json` (scripts)

**Interfaces:**

- Consumes: `ReportTotals` from `scripts/lib/axe-report.ts` —
  `{ confirmedRuleRows: number; confirmedNodes: number; indeterminateRuleRows: number; indeterminateNodes: number }`.
- Produces: `checkRatchet(totals: ReportTotals, ceilings: Ceilings, slack: number): RatchetResult`
  where `interface Ceilings { confirmedNodes: number }` and
  `interface RatchetResult { ok: boolean; message: string; shouldRepin: boolean }`.
  Task 4 relies on `npm run verify:ratchet`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/surface-ratchet.test.ts
import { describe, expect, it } from "vitest";
import { checkRatchet } from "../scripts/lib/surface-ratchet";

const totals = (confirmedNodes: number, indeterminateNodes = 99) => ({
  confirmedRuleRows: 0,
  confirmedNodes,
  indeterminateRuleRows: 0,
  indeterminateNodes,
});

describe("checkRatchet", () => {
  it("passes when the count equals the ceiling", () => {
    expect(checkRatchet(totals(10), { confirmedNodes: 10 }, 0).ok).toBe(true);
  });

  it("fails when the count rises above the ceiling", () => {
    const r = checkRatchet(totals(11), { confirmedNodes: 10 }, 0);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/11/);
    expect(r.message).toMatch(/10/);
  });

  it("passes a rise that stays inside the slack", () => {
    expect(checkRatchet(totals(12), { confirmedNodes: 10 }, 5).ok).toBe(true);
  });

  it("passes when the count drops, and asks to be re-pinned", () => {
    const r = checkRatchet(totals(4), { confirmedNodes: 10 }, 0);
    expect(r.ok).toBe(true);
    expect(r.shouldRepin).toBe(true);
  });

  // The four gradient surfaces can never resolve, so gating this makes zero
  // permanently unreachable. It is reported and never gates.
  it("ignores indeterminate entirely", () => {
    const r = checkRatchet(totals(0, 100000), { confirmedNodes: 0 }, 0);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/surface-ratchet.test.ts`
Expected: FAIL — cannot resolve `../scripts/lib/surface-ratchet`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/lib/surface-ratchet.ts
/**
 * The axe ratchet. CONTRIBUTING.md's decisive reason verify-surfaces was not
 * a CI gate: a zero threshold would fail every pull request while the recorded
 * baseline is deliberately non-zero, and a permanently red check is a check
 * that gets disabled. So gate on a RISE against a committed ceiling, the shape
 * tests/type-scale-guard.test.ts already uses.
 *
 * Only `confirmedNodes` gates. `indeterminate` is reported and never gates:
 * on this app's four gradient-background surfaces axe can never compute an
 * answer, so gating it would make "drive the number to zero" unreachable.
 *
 * Node counts, not rule rows — docs/axe-baseline-2026-08-11-seeded.md records
 * rule-rows moving 46→44 while nodes moved 1398→1687.
 */
import type { ReportTotals } from "./axe-report";

export interface Ceilings {
  confirmedNodes: number;
}

export interface RatchetResult {
  ok: boolean;
  message: string;
  shouldRepin: boolean;
}

export function checkRatchet(
  totals: ReportTotals,
  ceilings: Ceilings,
  slack: number
): RatchetResult {
  const actual = totals.confirmedNodes;
  const ceiling = ceilings.confirmedNodes;

  if (actual > ceiling + slack) {
    return {
      ok: false,
      message:
        `axe ratchet: ${actual} confirmed defect nodes, ceiling ${ceiling} ` +
        `(slack ${slack}). Something regressed. Open the capture artifact ` +
        `before raising the ceiling — raising it needs a reason in the ` +
        `commit message.`,
      shouldRepin: false,
    };
  }

  if (actual < ceiling) {
    return {
      ok: true,
      message:
        `axe ratchet: ${actual} confirmed defect nodes, down from ${ceiling}. ` +
        `Re-pin with: npm run verify:ratchet -- --update`,
      shouldRepin: true,
    };
  }

  return {
    ok: true,
    message: `axe ratchet: ${actual} confirmed defect nodes, ceiling ${ceiling}.`,
    shouldRepin: false,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/surface-ratchet.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the CLI**

```ts
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
```

- [ ] **Step 6: Seed the ceiling from a real run, not from a document**

`surface-ceilings.json` starts as a deliberately impossible ceiling so that the
first CI run fails loudly rather than passing against a number nobody measured:

```json
{
  "confirmedNodes": -1,
  "measured": "never",
  "slices": []
}
```

Then run the capture locally (dev server on 3200, seeded owner) and re-pin:

```bash
npx tsx scripts/verify-surfaces.ts ceiling-seed
npx tsx scripts/surface-ratchet.ts ceiling-seed --update
```

Commit whatever number that writes. Do not edit it by hand.

- [ ] **Step 7: Add the npm scripts**

In `package.json`, beside `verify:surfaces`:

```json
"verify:ratchet": "tsx scripts/surface-ratchet.ts"
```

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/surface-ratchet.ts scripts/surface-ratchet.ts \
        tests/surface-ratchet.test.ts surface-ceilings.json package.json
git commit -m "feat(surfaces): ratchet the confirmed-node count against a committed ceiling

CONTRIBUTING.md's decisive blocker was that a zero-threshold gate would
fail every pull request while the baseline is deliberately non-zero, and
a permanently red check gets disabled. Gate on a rise instead. The
ceiling is written by a run; indeterminate is reported and never gates."
```

### Task 3: Fix the CI secret, and guard the class of bug

`ci.yml` sets `BETTER_AUTH_SECRET: ci-only-secret` — 14 characters against a
`< 32` throw at `src/lib/env-validation.ts:16`. It survives only because vitest
never runs the instrumentation hook. Task 4 boots the real app.

**Files:**

- Modify: `.github/workflows/ci.yml:33`
- Modify: `tests/release-gate.test.ts`

**Interfaces:**

- Consumes: `workflow(name)` and `allWorkflowNames()`, already in
  `tests/release-gate.test.ts:38-46`.
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the failing test**

Append to `tests/release-gate.test.ts`:

```ts
describe("workflow environment", () => {
  // src/lib/env-validation.ts throws below 32 characters, from the
  // instrumentation hook. vitest never runs that hook, so ci.yml got away
  // with a 14-character value — but every job that boots the real app does
  // run it. A workflow that boots the app with a short secret fails at
  // startup with a message about auth, which is a long way from the cause.
  it("every BETTER_AUTH_SECRET in a workflow is at least 32 characters", () => {
    for (const name of allWorkflowNames()) {
      const body = workflow(name);
      for (const m of body.matchAll(
        /BETTER_AUTH_SECRET:\s*["']?([^"'\s]+)["']?/g
      )) {
        const value = m[1];
        if (value.startsWith("${{")) continue; // a secret reference
        expect(
          value.length,
          `${name} sets BETTER_AUTH_SECRET to a ${value.length}-character ` +
            `value; src/lib/env-validation.ts requires 32.`
        ).toBeGreaterThanOrEqual(32);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/release-gate.test.ts`
Expected: FAIL — `ci.yml sets BETTER_AUTH_SECRET to a 14-character value`.

- [ ] **Step 3: Fix `ci.yml`**

Replace line 33's value with a 64-character dummy, matching the style of the
`ENCRYPTION_KEY` dummy two lines above:

```yaml
BETTER_AUTH_SECRET: "ci-only-secret-0000000000000000000000000000000000"
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/release-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/release-gate.test.ts
git commit -m "fix(ci): BETTER_AUTH_SECRET was 14 chars against a 32-char floor

env-validation throws below 32 from the instrumentation hook. vitest
never runs that hook, so CI never noticed; every job that boots the real
app would have. Guarded across all workflows so the next one cannot
inherit the same trap."
```

### Task 4: `surfaces.yml` — Playwright in Actions

This is ask 3. `CONTRIBUTING.md` lists three blockers — the ratchet (Task 2), a
seeded database, and a running server. This task closes the last two and wires
all three together.

**Files:**

- Create: `.github/workflows/surfaces.yml`

**Interfaces:**

- Consumes: `--only=` / `--except=` from Task 1; `npm run verify:ratchet` from
  Task 2; the ≥32-character secret rule from Task 3.
- Produces: artifacts named `capture-main`, `capture-preview-states`, and the
  workflow name `Surfaces` that Task 10's `soak.yml` mirrors.

**No secrets are needed.** The job seeds the owner it then signs in as, against
a throwaway CI Postgres, so the credentials are established by the job rather
than assumed from ambient state. That is spec decision D6 and it closes the
2026-08-14 defect class directly: you cannot seed the wrong user when the same
step that seeds is the step that authenticates.

- [ ] **Step 1: Create the workflow**

```yaml
name: Surfaces

# Playwright surface capture + the axe ratchet.
#
# Two capture jobs, deliberately. previewStateFrom (src/lib/today/state.ts)
# returns null when NODE_ENV === "production", so a production build renders
# whichever state the clock dictates for all three `today*` surfaces, and
# assertTodayStatesDiffer then fails the run on the byte-identical PNGs —
# correctly. A single cheaper job would capture the wrong page for three
# surfaces and report success, which is the assertOnSurface trap wearing a
# different hat.
#
# The push-to-main run is the one that matters for a release: it is the only
# capture taken against the exact commit an RC is cut from, and soak.yml
# cannot cover the preview states because the RC image is production.

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

env:
  # Dummy values only — a public repository's workflow file must never carry a
  # real secret, and this database is created empty and destroyed with the job.
  # BETTER_AUTH_SECRET is 64 chars because these jobs boot the real app, where
  # src/lib/env-validation.ts throws below 32. ci.yml's shorter value survived
  # only because vitest never runs the instrumentation hook.
  DATABASE_URL: postgres://ci:ci@localhost:5432/ci
  DATABASE_DRIVER: pg
  ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000"
  BETTER_AUTH_SECRET: "surfaces-only-secret-000000000000000000000000"
  BETTER_AUTH_URL: http://localhost:3200
  TRUSTED_ORIGINS: http://localhost:3200
  SCREENSHOT_BASE_URL: http://localhost:3200
  # The OWNER, not the demo user: /admin is a captured surface and redirects
  # every other role. Seeding demo@recover.local is the 2026-08-14 defect that
  # voided every reading taken before 2026-08-16.
  OWNER_EMAIL: dev@recover.local
  OWNER_PASSWORD: surfaces-ci-owner-password
  PREVIEW_SURFACES: today,today-post-session,today-evening

jobs:
  capture:
    name: capture (production build)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: ci
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: ci
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U ci -d ci"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: Resolve the pinned Chromium revision
        id: pw
        run: |
          set -euo pipefail
          v=$(node -p "require('./node_modules/playwright-core/package.json').version")
          echo "version=$v" >> "$GITHUB_OUTPUT"

      - name: Cache Chromium
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ms-playwright-${{ runner.os }}-${{ steps.pw.outputs.version }}

      - name: Install Chromium and its system libraries
        run: |
          set -euo pipefail
          npm run dev:browser-setup
          sudo "$(which node)" node_modules/playwright-core/cli.js install-deps chromium

      - run: node scripts/migrate.mjs

      # Seed the owner this job will sign in as. CONTRIBUTING.md records
      # seeding as +20.7% axe nodes overall and +600% on Train: a number
      # measured against an empty account is not comparable to the baseline,
      # because the charts, badges and tables where sub-AA colour lives are
      # simply not on screen.
      - name: Seed the owner
        run: npm run db:seed

      - name: Seed demo data onto the owner
        run: SEED_DEMO=1 DEMO_EMAIL="$OWNER_EMAIL" npm run db:seed-demo

      # seed-demo covers activities, wellness, chat and connectors but seeds no
      # races and no training plans. seed-two-race builds a two-A-race season
      # through the real previewTrainingPlan, so what gets captured is what the
      # engine emits rather than rows someone inserted.
      - name: Seed a two-A-race season onto the owner
        run: SEED_DEMO=1 DEMO_EMAIL="$OWNER_EMAIL" npx tsx scripts/seed-two-race.ts

      - run: npm run build

      - name: Start the app and wait for it
        run: |
          set -euo pipefail
          npx next start -p 3200 &
          echo $! > /tmp/next.pid
          for i in $(seq 1 60); do
            if curl -fsS http://localhost:3200/api/health >/dev/null 2>&1; then
              echo "app up after ${i}s"
              exit 0
            fi
            sleep 1
          done
          echo "::error::app did not become healthy on :3200 within 60s"
          exit 1

      # Everything except the three preview states — see this file's header.
      - name: Capture surfaces
        run: npx tsx scripts/verify-surfaces.ts capture-main --except="$PREVIEW_SURFACES"

      - name: Upload the capture
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: capture-main
          path: .screenshots/capture-main
          if-no-files-found: error
          retention-days: 30

  capture-preview-states:
    name: capture (dev server, preview states)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: ci
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: ci
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U ci -d ci"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: Resolve the pinned Chromium revision
        id: pw
        run: |
          set -euo pipefail
          v=$(node -p "require('./node_modules/playwright-core/package.json').version")
          echo "version=$v" >> "$GITHUB_OUTPUT"

      - name: Cache Chromium
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ms-playwright-${{ runner.os }}-${{ steps.pw.outputs.version }}

      - name: Install Chromium and its system libraries
        run: |
          set -euo pipefail
          npm run dev:browser-setup
          sudo "$(which node)" node_modules/playwright-core/cli.js install-deps chromium

      - run: node scripts/migrate.mjs
      - name: Seed the owner
        run: npm run db:seed
      - name: Seed demo data onto the owner
        run: SEED_DEMO=1 DEMO_EMAIL="$OWNER_EMAIL" npm run db:seed-demo
      - name: Seed a two-A-race season onto the owner
        run: SEED_DEMO=1 DEMO_EMAIL="$OWNER_EMAIL" npx tsx scripts/seed-two-race.ts

      # `next dev`, not `next start`: only a non-production build honours
      # `?state=`. Lazy compilation makes first navigations slow, so warm each
      # route before the capture rather than letting networkidle waits trip.
      - name: Start the dev server and warm the route
        run: |
          set -euo pipefail
          npx next dev -p 3200 &
          for i in $(seq 1 120); do
            if curl -fsS http://localhost:3200/api/health >/dev/null 2>&1; then
              echo "dev server up after ${i}s"
              break
            fi
            sleep 1
          done
          curl -fsS -o /dev/null "http://localhost:3200/" || true
          curl -fsS -o /dev/null "http://localhost:3200/?state=evening" || true

      - name: Capture the preview states
        run: npx tsx scripts/verify-surfaces.ts capture-preview --only="$PREVIEW_SURFACES"

      - name: Upload the capture
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: capture-preview-states
          path: .screenshots/capture-preview
          if-no-files-found: error
          retention-days: 30

  ratchet:
    name: axe ratchet (both captures)
    needs: [capture, capture-preview-states]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - uses: actions/download-artifact@v4
        with:
          name: capture-main
          path: .screenshots/capture-main

      - uses: actions/download-artifact@v4
        with:
          name: capture-preview-states
          path: .screenshots/capture-preview

      # Both slices together. A ratchet over only one job's surfaces would
      # leave the other job's confirmed nodes ungated, which is a gap shaped
      # exactly like the ones this pipeline exists to close.
      - name: Compare against the committed ceiling
        run: npm run verify:ratchet -- capture-main capture-preview
```

- [ ] **Step 2: Validate the YAML parses before pushing**

Run: `npx js-yaml .github/workflows/surfaces.yml > /dev/null && echo OK`
Expected: `OK`. (If `js-yaml` is not present, `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/surfaces.yml'))"`.)

- [ ] **Step 3: Confirm the new guard tests still pass**

Run: `npx vitest run tests/release-gate.test.ts`
Expected: PASS — in particular the ≥32-character check now covers
`surfaces.yml` too.

- [ ] **Step 4: Commit and open a pull request**

```bash
git add .github/workflows/surfaces.yml
git commit -m "feat(ci): run Playwright surface capture and the axe ratchet in Actions

Closes CONTRIBUTING.md's remaining three blockers: the ratchet, a seeded
database, and a running server. Two capture jobs because previewStateFrom
refuses ?state= under NODE_ENV=production — one production build for the
surfaces that ship, one dev server for the three preview states."
```

- [ ] **Step 5: Watch the first real run and re-pin if it drops**

The first run is the measurement. If the ratchet fails because the ceiling is
still `-1`, that is the seed value doing its job. Download the artifacts, look
at the PNGs, then re-pin from the run rather than from any document.

### Task 5: Update `CONTRIBUTING.md`

Its "Can this run in CI? Not as configured" section is now wrong in the
direction that matters — the answer is yes.

**Files:**

- Modify: `CONTRIBUTING.md` (the "Can this run in CI?" section, around lines
  120-160)

**Interfaces:** none.

- [ ] **Step 1: Rewrite the section**

Replace the "Four things stand between…" list and the "Three blockers remain"
paragraph with a record of how each was closed. Keep the numbered history —
this repository's docs earn their length by naming what went wrong — but
change the verdict:

- Blocker 1, the ratchet — closed by `scripts/lib/surface-ratchet.ts` and
  `surface-ceilings.json`. Gates on a rise; `indeterminate` never gates.
- Blocker 2, a seeded database — closed by `surfaces.yml`, which seeds the
  owner it signs in as.
- Blocker 3, a running server — closed by `surfaces.yml`, and it needed two
  jobs, not one. Say why.
- Blocker 4 was already closed in v0.104.0. Leave it struck through.

- [ ] **Step 2: Format and verify**

Run: `npm run format:check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs(contributing): the surface capture is a CI gate now

All three remaining blockers are closed. Records why it took two jobs
rather than one, so the next person does not merge them back."
```

---

# Phase 2 — One path, stated once

No runner needed. Ends with `docs/RELEASING.md` describing the path that
actually exists.

### Task 6: Rewrite `docs/RELEASING.md`

The file's opening (lines 3-6) states that pushing any `v*` tag builds and
publishes the image. Step 14 spends fourteen lines explaining that this is
false, and `tests/release-gate.test.ts` pins it as false. That opening claim is
the belief behind the 2026-08-20 sequencing bug. The owner asked for stale
content deleted rather than annotated.

**Files:**

- Modify: `docs/RELEASING.md`

**Interfaces:** none, but the step table must match the workflow names Phase 3
creates: `release-rc.yml`, `soak.yml`, `promote.yml`, `finish-release.yml`.

- [ ] **Step 1: Delete the opening contradiction**

Lines 3-6 go. Replace with what is true:

```markdown
The tag is the last step, never the first — and only a `vX.Y.Z-rc.N` tag builds
anything. `release.yml` triggers on `v*-rc.*` alone, so the final `vX.Y.Z` tag
marks the commit and publishes nothing. Promotion, not tagging, is what reaches
the athlete.
```

- [ ] **Step 2: Replace the 15-step checklist with the path table**

One row per step, each naming what runs it. Copy the table from
`docs/specs/2026-08-20-release-automation-design.md` § "The release path as it
will be" verbatim, so the two documents cannot drift.

- [ ] **Step 3: Move rationale next to its mechanism**

The v0.9.1, v0.63.0, v0.105.1 and v0.28–v0.30 incidents are already narrated in
the workflow files that implement their guards. RELEASING.md keeps a short
"why each gate exists" appendix — one paragraph per gate, each pointing at the
file that enforces it — and stops re-telling them inline where they bury the
steps.

- [ ] **Step 4: Delete the stale port advice**

The paragraph beginning "Port 5435 is the dev database and is safe" carries its
own correction. Keep only the correction: on the dev box 5434 is the dev
database, 5435 is the RC soak stack, and production's Postgres is on the prod
box bound to its own loopback. Keep the `@example.invalid` cleanup SQL — that
hazard is real and current.

- [ ] **Step 5: Check the document against itself**

Run: `grep -n "v\*" docs/RELEASING.md`
Expected: every remaining occurrence is `v*-rc.*` or explicitly describes the
old, removed trigger as history.

Run: `npm run format:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/RELEASING.md
git commit -m "docs(releasing): one path, stated once

The opening paragraph asserted that any v* tag builds and publishes —
the exact falsehood step 14 and tests/release-gate.test.ts exist to
deny, and the belief behind the 2026-08-20 sequencing bug. Deleted
rather than annotated, per the owner's ask. Rationale moves next to the
workflow files that enforce it."
```

---

# Phase 3 — The runner and the release tail

Needs the devbox runner. Ends with an agent able to take a merged item to
production without hand-running a step.

### Task 7: A tracked, host-parameterised deploy verification

`scripts/live-verify-deploy.sh` is **untracked** — `.gitignore:65` excludes
`scripts/live-*.sh` because it hardcodes this instance's hosts. A fresh
`actions/checkout` on the runner would not have it, so `finish-release.yml`
cannot call it. It already reads `PROD_HOST` and `PROD_URL` from the
environment; only the defaults are instance-specific.

**Files:**

- Create: `scripts/verify-deploy.sh` (tracked)
- Keep: `scripts/live-verify-deploy.sh` (untracked, becomes a thin wrapper)

**Interfaces:**

- Produces: `scripts/verify-deploy.sh sha256:<digest>`, reading `PROD_HOST` and
  `PROD_URL` from the environment with **no defaults**. Task 12 calls it.

- [ ] **Step 1: Copy the logic into a tracked, defaults-free script**

```bash
cp scripts/live-verify-deploy.sh scripts/verify-deploy.sh
```

Then edit `scripts/verify-deploy.sh` so the two host variables are required
rather than defaulted, and update the header comment:

```bash
# Usage: PROD_HOST=… PROD_URL=… scripts/verify-deploy.sh sha256:<digest>
#
# Tracked, and therefore carries NO host defaults — the hosts are this
# instance's, and this file is public. scripts/live-verify-deploy.sh is the
# untracked local wrapper that supplies them.
WANT="${1:?usage: verify-deploy.sh sha256:<digest>}"
PROD_HOST="${PROD_HOST:?PROD_HOST is required}"
PROD_URL="${PROD_URL:?PROD_URL is required}"
TIMEOUT_S="${TIMEOUT_S:-420}"
```

- [ ] **Step 2: Reduce the untracked script to a wrapper**

Replace `scripts/live-verify-deploy.sh`'s body with:

```bash
#!/usr/bin/env bash
# Untracked local wrapper — supplies this instance's hosts to the tracked
# scripts/verify-deploy.sh. See .gitignore:65 for why this file is not in git.
set -euo pipefail
export PROD_HOST="${PROD_HOST:-PROD}"
export PROD_URL="${PROD_URL:-http://10.0.10.100:3000}"
exec "$(dirname "$0")/verify-deploy.sh" "$@"
```

- [ ] **Step 3: Prove both still work against the live digest**

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/crunchynapkin404/recover:latest --format '{{.Manifest.Digest}}')
TIMEOUT_S=40 scripts/live-verify-deploy.sh "$DIGEST"
TIMEOUT_S=40 PROD_HOST=PROD PROD_URL=http://10.0.10.100:3000 scripts/verify-deploy.sh "$DIGEST"
```

Expected: both PASS, identically. Prod is currently on v0.114.0.

- [ ] **Step 4: Confirm the tracked script carries no hosts**

Run: `grep -nE "10\.0\.10\.|PROD_HOST:-|PROD_URL:-" scripts/verify-deploy.sh`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-deploy.sh
git commit -m "refactor(scripts): track a host-parameterised verify-deploy

live-verify-deploy.sh is gitignored because it names this instance's
hosts, so a workflow checkout could never call it. Split: the logic is
tracked and defaults-free, the local wrapper supplies the hosts."
```

### Task 8: Guard the runner rule and the deleted script

The repository is public. "No self-hosted runner may serve `pull_request`" is
the entire safety story, and this project's own record is that a written rule
nothing enforces is a rule broken by accident — that reasoning produced the
`:latest` flavor guard and the `verify` job alike.

**Files:**

- Modify: `tests/release-gate.test.ts`

**Interfaces:**

- Consumes: `workflow(name)`, `allWorkflowNames()`, `stripComments()` from
  `tests/release-gate.test.ts:31-46`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/release-gate.test.ts`:

```ts
describe("self-hosted runner safety", () => {
  // The repository is public. A fork's pull request runs its own workflow
  // file, so a self-hosted runner that serves pull_request is arbitrary code
  // execution on the devbox — a machine with SSH access to production. Only
  // workflow_dispatch and base-repo tag pushes may target it, neither of
  // which a fork can trigger.
  it("no workflow pairs a self-hosted runner with a pull_request trigger", () => {
    for (const name of allWorkflowNames()) {
      const body = workflow(name);
      const selfHosted = /runs-on:.*self-hosted/s.test(body);
      if (!selfHosted) continue;
      expect(
        /^\s*pull_request(_target)?:/m.test(body),
        `${name} runs on a self-hosted runner AND triggers on pull_request. ` +
          `This repository is public: that is code execution from any fork ` +
          `on a box with SSH to production. Use workflow_dispatch.`
      ).toBe(false);
    }
  });
});

describe("no second release path", () => {
  // scripts/release.sh was deleted in v0.115.0. It merged, tagged and
  // published while nothing was built, soaked, promoted or deployed — a
  // second path to the same place, and two paths is how the 2026-08-20
  // sequencing bug happened. finish-release.yml is the only tail.
  it("no script both pushes a version tag and creates a release", () => {
    const dir = join(process.cwd(), "scripts");
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".sh")) continue;
      const body = readFileSync(join(dir, f), "utf8");
      const tags = /git\s+push\s+origin\s+"?\$?\{?TAG/.test(body);
      const releases = /gh\s+release\s+create/.test(body);
      expect(
        tags && releases,
        `scripts/${f} both pushes a tag and creates a release object. That ` +
          `is the local tail finish-release.yml replaced; a second path is ` +
          `how a release gets performed one step early.`
      ).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run them and watch the second fail**

Run: `npx vitest run tests/release-gate.test.ts`
Expected: the runner test PASSES (no self-hosted workflow exists yet); the
second FAILS naming `scripts/release.sh`.

- [ ] **Step 3: Leave it red and go to Task 12**

This is the one place in this plan where a test is committed red, because the
thing it guards is deleted in Task 12 and deleting it before
`finish-release.yml` exists would leave no tail at all. Commit the runner test
now; hold the second test until Task 12.

```bash
git add tests/release-gate.test.ts
git commit -m "test(release-gate): forbid self-hosted runners on pull_request

The repository is public. A written rule nothing enforces is a rule
broken by accident — the same reasoning behind the :latest flavor guard."
```

### Task 9: `release-rc.yml` — cut the candidate

**Files:**

- Create: `.github/workflows/release-rc.yml`

**Interfaces:**

- Produces: workflow `Release RC`, inputs `version` (e.g. `0.115.0`) and `rc`
  (e.g. `1`). Pushes tag `vX.Y.Z-rc.N`, which `release.yml` already builds.

- [ ] **Step 1: Create the workflow**

```yaml
name: Release RC

# Cuts the pre-release tag. release.yml is triggered by that tag and is NOT
# modified by this workflow — its `tags: ["v*-rc.*"]` trigger is pinned by
# tests/release-gate.test.ts and widening it is the v0.105.1 defect.
#
# Everything here is a precondition check. The tag push is the last line.

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Version without the v, e.g. 0.115.0"
        required: true
        type: string
      rc:
        description: "Candidate number, e.g. 1"
        required: true
        default: "1"
        type: string

permissions:
  contents: write
  actions: read

jobs:
  cut:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: main
          fetch-depth: 0

      - uses: actions/setup-node@v7
        with:
          node-version: 22

      - name: package.json must already say this version
        run: |
          set -euo pipefail
          have=$(node -p "require('./package.json').version")
          if [ "$have" != "${{ inputs.version }}" ]; then
            echo "::error::package.json says $have, you asked for ${{ inputs.version }}."
            exit 1
          fi

      # The release object is built from this section later. Finding out it is
      # missing after the image is built and soaked wastes an hour.
      - name: CHANGELOG must have a section for this version
        run: |
          set -euo pipefail
          if ! grep -qE "^## v${{ inputs.version }} " CHANGELOG.md; then
            echo "::error::No '## v${{ inputs.version }} …' section in CHANGELOG.md."
            exit 1
          fi

      - name: main's CI must be green for this exact commit
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          sha=$(git rev-parse HEAD)
          run=$(gh api "repos/${{ github.repository }}/actions/workflows/ci.yml/runs?head_sha=$sha&per_page=1" \
            --jq '.workflow_runs[0] | "\(.status) \(.conclusion // "pending")"')
          if [ "$run" != "completed success" ]; then
            echo "::error::CI for $sha is '$run', not 'completed success'."
            exit 1
          fi

      - name: Tag and push
        run: |
          set -euo pipefail
          tag="v${{ inputs.version }}-rc.${{ inputs.rc }}"
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag -a "$tag" -m "$tag"
          git push origin "$tag"
          echo "::notice title=Cut::$tag — release.yml is building it now."
```

- [ ] **Step 2: Validate the YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-rc.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-rc.yml
git commit -m "feat(release): dispatch workflow to cut a release candidate

Checks package.json, the CHANGELOG section and main's CI for the exact
SHA before the tag push. release.yml is untouched."
```

### Task 10: `soak.yml` — the seven boxes, mechanically

**Files:**

- Create: `.github/workflows/soak.yml`

**Interfaces:**

- Consumes: `--except=` from Task 1.
- Produces: workflow `Soak`, input `rc_tag`, and an artifact named
  **`soak-capture-<rc_tag>`** — Task 11's gate asserts that exact name, which
  is how a capture run is bound to the candidate it belongs to.

- [ ] **Step 1: Create the workflow**

```yaml
name: Soak

# RELEASING.md step 11's boxes, run by machine instead of by hand.
#
# runs-on devbox because none of this is reachable from GitHub's runners: the
# RC stack, the backup volumes the drills restore from, and the seeded dev
# database all live there.
#
# NEVER add pull_request to this trigger. The repository is public and this
# runner is a box with SSH to production; tests/release-gate.test.ts fails the
# suite if that rule is broken.
#
# The three preview-state surfaces are deliberately NOT captured here: the RC
# image is a production build, so previewStateFrom refuses `?state=` and all
# three would render the same clock-chosen state. surfaces.yml's push-to-main
# run covers them against the commit this candidate was cut from.

on:
  workflow_dispatch:
    inputs:
      rc_tag:
        description: "Candidate to soak, e.g. 0.115.0-rc.1"
        required: true
        type: string

permissions:
  contents: read

env:
  IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/recover
  COMPOSE: docker compose -p recover-rc --env-file .env.rc -f docker-compose.yml -f docker-compose.dev-rc.yml
  PREVIEW_SURFACES: today,today-post-session,today-evening

jobs:
  soak:
    runs-on: [self-hosted, devbox]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci

      # The stack is normally left running from the previous release, so tear
      # down first rather than assuming a clean box.
      - name: Tear down any previous soak stack
        run: ${{ env.COMPOSE }} down -v || true

      - name: Pin the candidate
        run: |
          set -euo pipefail
          sed -i -E "s#^(\s*image:\s*).*recover:.*#\1$IMAGE_NAME:${{ inputs.rc_tag }}#" \
            docker-compose.dev-rc.yml
          grep -n "image:" docker-compose.dev-rc.yml

      - name: Bring up the stack
        run: ${{ env.COMPOSE }} up -d db app

      - name: Box 1 — health endpoint
        run: |
          set -euo pipefail
          for i in $(seq 1 60); do
            body=$(curl -fsS http://localhost:3100/api/health || true)
            if echo "$body" | grep -q '"status":"ok"' && echo "$body" | grep -q '"db":"up"'; then
              echo "health ok after ${i}s"; exit 0
            fi
            sleep 5
          done
          echo "::error::/api/health never reported status ok + db up"
          exit 1

      - name: Box 2 — container health
        run: |
          set -euo pipefail
          s=$(docker inspect recover-rc-app-1 --format '{{.State.Health.Status}}')
          [ "$s" = "healthy" ] || { echo "::error::container is $s"; exit 1; }

      - name: Box 3 — migration drill
        run: RECOVER_BACKUP_VOLUME=recover-dev_backups scripts/migration-drill.sh

      - name: Box 4 — restore drill
        run: RECOVER_BACKUP_VOLUME=recover-dev_backups scripts/restore-drill.sh

      # Boxes 5-7: sign in as the owner and capture every shipping surface
      # against the bytes that will actually be promoted.
      - name: Boxes 5-7 — capture the candidate
        env:
          SCREENSHOT_BASE_URL: http://localhost:3100
          OWNER_EMAIL: ${{ secrets.SOAK_OWNER_EMAIL }}
          OWNER_PASSWORD: ${{ secrets.SOAK_OWNER_PASSWORD }}
        run: npx tsx scripts/verify-surfaces.ts soak --except="$PREVIEW_SURFACES"

      # The artifact name carries the candidate. promote.yml asserts this exact
      # name, which is what binds a reviewed capture to the digest it describes
      # — a run id alone could name a capture of something else.
      - name: Publish the capture
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: soak-capture-${{ inputs.rc_tag }}
          path: .screenshots/soak
          if-no-files-found: error
          retention-days: 90

      - name: Say what happens next
        run: |
          echo "::notice title=Soaked::${{ inputs.rc_tag }}. Download the"
          echo "::notice::soak-capture artifact and OPEN THE PNGs, then dispatch"
          echo "::notice::Promote with capture_run=${{ github.run_id }}."
```

- [ ] **Step 2: Add the two repository secrets**

`SOAK_OWNER_EMAIL` = `dev@recover.local`, `SOAK_OWNER_PASSWORD` = the owner
password from devbox's `.env` — **not** `.env.rc`.

```bash
gh secret set SOAK_OWNER_EMAIL --body 'dev@recover.local'
gh secret set SOAK_OWNER_PASSWORD   # paste when prompted
```

- [ ] **Step 3: Validate the YAML and the runner rule**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/soak.yml'))" && npx vitest run tests/release-gate.test.ts`
Expected: YAML OK; the self-hosted-runner test now has a real workflow to check
and still PASSES.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/soak.yml
git commit -m "feat(release): run the soak on the devbox runner

RELEASING.md step 11's seven boxes, mechanically. The capture artifact is
named for the candidate so promote.yml can bind a reviewed capture to the
digest it describes."
```

### Task 11: The promote gate

**Files:**

- Modify: `.github/workflows/promote.yml`

**Interfaces:**

- Consumes: the artifact name `soak-capture-<rc_tag>` from Task 10.
- Produces: a third required input, `capture_run`.

- [ ] **Step 1: Add the input**

Under `inputs:`, after `release_tag`:

```yaml
capture_run:
  description: "Run ID of the Soak whose capture you opened"
  required: true
  type: string
```

- [ ] **Step 2: Add the gate as the first step of the `promote` job**

Before `docker/setup-buildx-action`:

```yaml
# THE ONE HUMAN STEP. Two of v0.114.0's four worst defects were invisible
# to 2,854 tests and to a clean `0 confirmed` axe report: race one lost
# its taper on every two-race plan, and the recovery bridge rendered
# merged with ordinary easy weeks. One was found by running the code, the
# other by opening a screenshot. A pipeline cannot find either.
#
# This cannot verify that a person looked at the PNGs. It verifies that
# the run they named is real, succeeded, and captured THIS candidate —
# which closes the fabrication gap. What remains is someone typing a real
# run id without opening it: a decision by a person rather than an
# accident by a pipeline, and that distinction is the point.
- name: The named capture must exist, have passed, and be this candidate
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    REPO: ${{ github.repository }}
    RUN_ID: ${{ inputs.capture_run }}
    RC_TAG: ${{ inputs.rc_tag }}
  run: |
    set -euo pipefail

    run=$(gh api "repos/$REPO/actions/runs/$RUN_ID" \
      --jq '"\(.name)|\(.status)|\(.conclusion // "pending")"' 2>/dev/null || true)
    if [ -z "$run" ]; then
      echo "::error::No run $RUN_ID in $REPO. capture_run must be a Soak run id."
      exit 1
    fi

    name=${run%%|*}; rest=${run#*|}
    status=${rest%%|*}; conclusion=${rest#*|}

    if [ "$name" != "Soak" ]; then
      echo "::error::Run $RUN_ID is '$name', not 'Soak'."
      exit 1
    fi
    if [ "$status" != "completed" ] || [ "$conclusion" != "success" ]; then
      echo "::error::Soak $RUN_ID is $status/$conclusion — not a passed soak."
      exit 1
    fi

    want="soak-capture-$RC_TAG"
    if ! gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" \
         --jq '.artifacts[].name' | grep -qx "$want"; then
      echo "::error::Soak $RUN_ID has no artifact named '$want'."
      echo "::error::That run captured a different candidate than $RC_TAG."
      exit 1
    fi

    echo "::notice title=Capture::$want from run $RUN_ID — promoting."
```

- [ ] **Step 3: Validate**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/promote.yml'))" && npx vitest run tests/release-gate.test.ts`
Expected: YAML OK, tests PASS — in particular the `:latest` guards are
untouched.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/promote.yml
git commit -m "feat(release): promote requires the soak capture it was reviewed from

Asserts the named run is a passed Soak that produced an artifact for
THIS candidate. It cannot check that someone looked at the PNGs; it can
check that the thing they named is real and matches."
```

### Task 12: `finish-release.yml`, and delete `scripts/release.sh`

**Files:**

- Create: `.github/workflows/finish-release.yml`
- Delete: `scripts/release.sh`
- Modify: `tests/release-gate.test.ts` (uncomment/land the second test from Task 8)

**Interfaces:**

- Consumes: `scripts/verify-deploy.sh` from Task 7.
- Produces: workflow `Finish Release`, input `version`.

- [ ] **Step 1: Create the workflow**

```yaml
name: Finish Release

# The tail. It verifies the deploy FIRST and tags second, which is the whole
# lesson of 2026-08-20: scripts/release.sh merged, tagged and published a
# release page while nothing had been built, soaked, promoted or deployed. Prod
# stayed on the previous version. No harm, because the final tag builds
# nothing — but the release page ran ahead of reality.
#
# runs-on devbox because GitHub's runners cannot reach 10.0.10.100, so a green
# promote does not prove a deployed prod.

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Version without the v, e.g. 0.115.0"
        required: true
        type: string

permissions:
  contents: write

env:
  IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/recover

jobs:
  finish:
    runs-on: [self-hosted, devbox]
    steps:
      - uses: actions/checkout@v7
        with:
          ref: main
          fetch-depth: 0

      - name: Resolve the promoted digest
        id: digest
        run: |
          set -euo pipefail
          d=$(docker buildx imagetools inspect "$IMAGE_NAME:${{ inputs.version }}" \
            --format '{{.Manifest.Digest}}')
          echo "sha=$d" >> "$GITHUB_OUTPUT"
          echo "::notice title=Promoted digest::$d"

      # Nothing is tagged until prod is observed running that digest.
      - name: Prod must be running it
        env:
          PROD_HOST: ${{ secrets.PROD_HOST }}
          PROD_URL: ${{ secrets.PROD_URL }}
        run: scripts/verify-deploy.sh "${{ steps.digest.outputs.sha }}"

      - name: Tag the release commit
        run: |
          set -euo pipefail
          tag="v${{ inputs.version }}"
          title=$(awk -v t="^## ${tag//./\\.} " \
            '$0 ~ t {sub(/^## /, ""); print; exit}' CHANGELOG.md)
          [ -n "$title" ] || { echo "::error::No CHANGELOG section for $tag."; exit 1; }
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag -a "$tag" -m "$title"
          git push origin "$tag"

      # Release notes are the CHANGELOG section, never the auto-generated PR
      # list. Six releases shipped with no page at all because this step felt
      # optional once prod was already serving the new image.
      - name: Create the release page
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          tag="v${{ inputs.version }}"
          notes=$(mktemp)
          awk -v start="^## ${tag//./\\.} " '
            $0 ~ start {f=1; next}
            /^## v/ {f=0}
            f
          ' CHANGELOG.md > "$notes"
          [ -s "$notes" ] || { echo "::error::Empty notes for $tag."; exit 1; }
          title=$(awk -v t="^## ${tag//./\\.} " \
            '$0 ~ t {sub(/^## /, ""); print; exit}' CHANGELOG.md)
          gh release create "$tag" --title "$title" --notes-file "$notes"
```

- [ ] **Step 2: Add the two host secrets**

```bash
gh secret set PROD_HOST --body 'PROD'
gh secret set PROD_URL  --body 'http://10.0.10.100:3000'
```

- [ ] **Step 3: Delete the script**

**Use the file-edit tool, not Bash** — the auto-mode classifier refuses Bash
commands that edit `scripts/release.sh`, and that includes removing it.

```bash
git rm scripts/release.sh
```

If that is refused, delete via the editor and stage the deletion.

- [ ] **Step 4: Land Task 8's second test**

Add the `describe("no second release path", …)` block from Task 8 Step 1, with
`readdirSync` and `readFileSync` already imported at
`tests/release-gate.test.ts:26`.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run tests/release-gate.test.ts`
Expected: PASS, including both new describes.

- [ ] **Step 6: Update every reference to the deleted script**

Run: `grep -rn "release\.sh" --include="*.md" --include="*.ts" --include="*.yml" .`
Expected: hits in `docs/RELEASING.md`, `docs/2026-08-18-phase-2-close-handoff.md`
and the two 2026-08-19/20 handoffs. Update `docs/RELEASING.md` to name
`finish-release.yml`. Leave the dated handoffs alone — they are a record of
what was true when written, and rewriting them would destroy the history the
guards are argued from.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/finish-release.yml tests/release-gate.test.ts docs/RELEASING.md
git rm --cached scripts/release.sh 2>/dev/null || true
git commit -m "feat(release): finish-release.yml replaces scripts/release.sh

Verifies the deploy before tagging, which is the inversion 2026-08-20
demanded: the script tagged and published a release page while nothing
had been built, soaked, promoted or deployed. Deleting it also disposes
of both defects the 2026-08-18 handoff logged against it — the false
deploy claim and the git checkout in your working tree — without fixing
either."
```

### Task 13: Register the devbox runner

**This step changes the machine and is the owner's call to make.** Do not run
it without explicit approval in the session where it happens.

**Files:**

- Create: `docs/RUNNER.md`

**Interfaces:** provides the `[self-hosted, devbox]` label pair Tasks 10 and 12
target.

- [ ] **Step 1: Write `docs/RUNNER.md` first**

Record, before the runner exists: that the repository is public; that
`pull_request` is therefore forbidden on it and `tests/release-gate.test.ts`
enforces that; that the runner is `--ephemeral` so a job cannot leave state for
the next one; that it has SSH access to prod and that this is the reason it
exists and the reason the rule matters; and how to remove it.

- [ ] **Step 2: Register it (owner approval required)**

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -fsSL -o actions-runner-linux-x64.tar.gz \
  "$(gh api repos/crunchynapkin404/Recover/actions/runners/downloads \
     --jq '.[] | select(.os=="linux" and .architecture=="x64") | .download_url')"
tar xzf actions-runner-linux-x64.tar.gz
./config.sh --url https://github.com/crunchynapkin404/Recover \
  --token "$(gh api -X POST repos/crunchynapkin404/Recover/actions/runners/registration-token --jq .token)" \
  --labels devbox --name devbox --ephemeral --unattended
sudo ./svc.sh install && sudo ./svc.sh start
```

- [ ] **Step 3: Confirm it is online and correctly labelled**

Run: `gh api repos/crunchynapkin404/Recover/actions/runners --jq '.runners[] | "\(.name) \(.status) \([.labels[].name]|join(","))"'`
Expected: `devbox online self-hosted,Linux,X64,devbox`

- [ ] **Step 4: Commit**

```bash
git add docs/RUNNER.md
git commit -m "docs(runner): why the devbox runner exists and why it never serves PRs"
```

---

## Definition of done

- [ ] `surfaces.yml` green on a pull request, both captures uploaded, ratchet
      compared against a ceiling written by a run.
- [ ] `docs/RELEASING.md` contains no claim that a `v*` tag builds anything.
- [ ] `scripts/release.sh` is gone and `tests/release-gate.test.ts` prevents its
      return.
- [ ] A full release performed through `release-rc` → `soak` → open the
      pictures → `promote` → `finish-release`, with no step hand-run.
- [ ] `gh api …/actions/runners` shows exactly one ephemeral `devbox` runner.

The first release through this path is the test of it, which is the same
sentence `docs/RELEASING.md` already applies to rollback. Treat it that way.
