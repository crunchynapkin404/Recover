# Uncertainty Vocabulary — Coach / Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the coach's two hardcoded "calibrating" sentences
(`morning-insight.ts`) and one hardcoded "calibrating" line
(`coach-context.ts`) to the `Figure<T>` uncertainty vocabulary — the sixth
slice of Phase 2b.3, and the first to touch the AI coach itself rather than
a UI component. Also fixes a real conflation bug found while investigating
(see Findings), the same class of bug the v0.70.0 final review caught in
`BodyBatteryCurve`.

**Architecture:** No prop-type changes — both files build plain strings
(a chat message, an LLM system-prompt line), not React props, so the
"treatment" here is calling `unavailableMessage()` on a locally-constructed
`Figure` and interpolating the result into the existing string-building
logic, mirroring `correlationFigure`'s pattern more than any UI component's.
Each file gets its own new, narrow `calibrationProgress()`-backed query
(`src/lib/calibration.ts`, already shared by Today's hero and the v0.70.0
Estimated Energy fix) — deliberately NOT reusing either file's existing
wellness fetch (`morning-insight.ts` has none at the needed width;
`coach-context.ts`'s `wellness7` is a 7-day window used for unrelated trend
math, and widening it would silently change that trend math's window too).

**Tech Stack:** TypeScript 5, Vitest. `morning-insight.ts` is exercised by
`tests/morning-insight.test.ts`, a DB-backed integration suite (Postgres) —
**not** a `renderToString` component test like every prior slice. `docs/RELEASING.md`'s
gate (`npm test`) skips this suite locally unless `DATABASE_URL`+`DATABASE_DRIVER=pg`
point at a real Postgres; verify against an isolated throwaway container
(matching `.github/workflows/ci.yml`'s service exactly), never the
`recover-db-1` container also present in this environment — that one is the
live production database. `coach-context.ts` has no existing test file; add
one in `tests/` (whole-tree convention, matches how DB-backed suites are
organized — see the original plan's Global Constraints).

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`. Continues
`docs/plans/2026-08-08-uncertainty-vocabulary.md`'s "Coach / Journal"
backlog item — corrected after verification, same as every prior slice.

## Findings — before writing this plan

The original backlog named 3 files: `morning-insight.ts`, `coach-context.ts`,
`journal-form.tsx`. All three are live.

- **`journal-form.tsx`'s only dash is an interactive slider's live value**
  (energy/soreness/stress, 1–10), not a claim about the world — aria-label
  already says `"{label}: not answered"` when null. This is the exact same
  pattern the vitals slice already excluded in `checkin-sheet.tsx`
  ("the live current value of an interactive form control before the
  athlete has touched it... not an epistemic claim"). Same reasoning, same
  exclusion. Untouched by this plan.
- **`coach-context.ts`'s athlete-facing dashes (`cs.hrv != null ? ... : "—"`,
  etc.) are dense per-field data-snapshot placeholders, not headline
  claims** — the same reasoning that excluded `laps-table.tsx`'s per-cell
  dashes in the Log/Activity slice applies here too: this text is never
  read directly by the athlete (it's an LLM system-prompt data table,
  already framed "real, verified — do NOT override or invent different
  numbers"), and wrapping each of ~7 per-field dashes in full
  `unavailableMessage()` sentences would make the line unparseable for
  the LLM for no real gain. Only the one line that already uses a **named
  retired dialect word** — `"**Readiness:** Calibrating (needs 14+ days of
data)"` — is in scope; every other dash on this surface stays as-is.
- **Found and fixed: the same calibrating-vs-gap conflation the v0.70.0
  final review caught in `BodyBatteryCurve`, here in two more places.**
  `morning-insight.ts`'s `metric?.readiness == null` and
  `coach-context.ts`'s `!latest` both fire for two different reasons: a
  genuinely new athlete still inside the 14-day baseline window, **or** an
  already-calibrated athlete whose readiness simply didn't compute today
  (no HRV/RHR synced) — `src/lib/readiness.ts`'s own logic makes no
  distinction (see `docs/plans/2026-08-09-uncertainty-vocabulary-body-health.md`'s
  Findings for the full trace). Both files currently say "calibrating" —
  or a static, never-updating "needs 14+ days of data" — regardless of
  which is true. Fixed the same way: gate on a real `calibrationProgress()`
  count's `remaining > 0`, falling back to `Figure.missingInput` for the
  gap case. This is the coach _telling the athlete something false_
  ("you're new here" to someone who has trained for years) — higher-stakes
  than a UI label, since it's delivered as the coach's own voice.
- **Not touched:** the LLM _instruction_ strings (the prompts sent to the
  LLM, e.g. `"readiness calibrating — do not invent a number"`) — these
  already achieve the goal's honesty requirement via bespoke prompt
  wording, are never shown to the athlete directly (the LLM's own response
  is), and aren't the kind of repeated athlete-facing text the shared
  vocabulary exists to unify. Only the **deterministic template** text
  (shown verbatim when no LLM is configured, or the LLM call fails/returns
  empty) is in scope — same "no new figures, treat what's already
  rendered" boundary every prior slice has kept.

## Global Constraints

- **No new figures, no IA changes** — Phase 2's standing constraint.
- **Do not touch `journal-form.tsx`** or `coach-context.ts`'s per-field
  dashes — see Findings.
- **Do not widen `coach-context.ts`'s `wellness7`** to serve the
  calibration check — it backs unrelated 7-day trend math elsewhere in the
  same function; use a separate, dedicated query.
- **Fail closed on the new queries**, matching `morning-insight.ts`'s own
  existing `wellnessToday` try/catch immediately above the edit site: on a
  query error, fall back to the most conservative reading
  (`Figure.calibrating` with zero days-with-signal) rather than throwing —
  a forced backstop brief must still post.
- **Confidence is not applicable here** — these are `Unavailable` states
  (`calibrating`/`missing_input`), not `Figure.available` values; no
  confidence tier to choose.
- Test convention for this surface: `tests/morning-insight.test.ts` and the
  new `tests/coach-context.test.ts` are DB-backed integration tests
  (`describe`/`it` against a real Postgres via Drizzle), not
  `renderToString`. Verify against an isolated throwaway Postgres container,
  never the live production one.

---

### Task 1: `morning-insight.ts` — name the actual reason, not just "calibrating"

**Files:**

- Modify: `src/lib/morning-insight.ts`
- Modify: `tests/morning-insight.test.ts`

**Interfaces:**

- Consumes: `calibrationProgress`, `CALIBRATION_TARGET_DAYS` from
  `@/lib/calibration` (shipped v0.11); `Figure` from `@/lib/uncertainty`;
  `unavailableMessage` from `@/components/ui/unavailable` (both shipped
  v0.67.0).
- Produces: nothing new — only the two hardcoded "calibrating" template
  sentences change source.

- [ ] **Step 1: Establish a safe local test database**

Do **not** use the `recover-db-1` container already running in this
environment (production). Start an isolated one:

```bash
docker run -d --name recover-test-db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=ci -p 127.0.0.1:5433:5432 postgres:16-alpine
DATABASE_URL="postgres://ci:ci@localhost:5433/ci" DATABASE_DRIVER=pg node scripts/migrate.mjs
```

- [ ] **Step 2: Confirm the existing suite is green before changing anything**

```bash
DATABASE_URL="postgres://ci:ci@localhost:5433/ci" DATABASE_DRIVER=pg npx vitest run tests/morning-insight.test.ts
```

Expected: 24 passed (baseline).

- [ ] **Step 3: Implement**

Add to the top-level imports (after the `fetchAthleteContext` import):

```ts
import {
  calibrationProgress,
  CALIBRATION_TARGET_DAYS,
} from "@/lib/calibration";
import { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";
```

Immediately before `const raceTemplate = raceToday`, insert:

```ts
// Readiness null covers two different situations: genuine first-run
// calibration, or an already-calibrated athlete with no HRV/RHR reading
// today (same distinction the Estimated Energy card's v0.70.0 fix made).
// Fail closed on a query error, same reasoning as wellnessToday above: a
// forced backstop brief must still post rather than throw.
let readinessWindow: (typeof schema.wellnessDaily.$inferSelect)[] = [];
try {
  readinessWindow = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(
        schema.wellnessDaily.date,
        addDaysYmd(today, -CALIBRATION_TARGET_DAYS)
      )
    ),
  });
} catch (err) {
  logger.error("readiness-calibration read failed", {
    userId,
    message: err instanceof Error ? err.message : String(err),
  });
}
const readinessCalibration = calibrationProgress(
  readinessWindow.map((w) => ({ hrvMs: w.hrvMs, restingHr: w.restingHr }))
);
const readinessGap = unavailableMessage(
  readinessCalibration.remaining > 0
    ? Figure.calibrating(
        readinessCalibration.daysWithSignal,
        readinessCalibration.target,
        "days"
      )
    : Figure.missingInput("a readiness score today")
);
```

Change (inside `raceTemplate`):

```ts
      (metric?.readiness != null
        ? `Readiness ${Math.round(metric.readiness)} (${metric.band}). `
        : `Readiness still calibrating — trust your taper. `) +
```

to:

```ts
      (metric?.readiness != null
        ? `Readiness ${Math.round(metric.readiness)} (${metric.band}). `
        : `Readiness: ${readinessGap} — trust your taper. `) +
```

Change (inside `templateBody`):

```ts
      metric?.readiness != null
        ? `Readiness ${Math.round(metric.readiness)} (${metric.band}).` +
          (metric.tsb != null ? ` TSB ${Math.round(metric.tsb)}.` : "")
        : `Still calibrating — not enough data yet for a readiness score today.`,
```

to:

```ts
      metric?.readiness != null
        ? `Readiness ${Math.round(metric.readiness)} (${metric.band}).` +
          (metric.tsb != null ? ` TSB ${Math.round(metric.tsb)}.` : "")
        : `${readinessGap}.`,
```

Leave `calibratingNoRace` and everything else in the function unchanged —
it keys off `metric?.readiness == null`, which is still the right signal
for "does the template already name the gap," regardless of which reason.

- [ ] **Step 4: Update existing test assertions**

Every existing assertion of the literal substring `"Still calibrating"` in
`tests/morning-insight.test.ts` exercises a **fresh test user with zero
prior `wellness_daily` rows** (confirm this by reading each test's setup
before editing — do not assume) — under the new logic these are still the
_genuine calibrating_ case (`remaining > 0` with zero history), so update
each assertion from `"Still calibrating"` to
`"Calibrating — day 0 of 14 days"` (the exact new output for zero history).
Grep the file for `Still calibrating` first to find every occurrence
(expect around 4–5) and update each in place; do not change any other part
of those tests.

- [ ] **Step 5: Add a new test for the gap case**

Add a new test in the same top-level `describe` block as
`"force:true posts a degraded brief when calibrating..."` (read that test
first to match its setup style):

```ts
it("force:true names a same-day reading gap, not calibrating, for an already-calibrated athlete", async () => {
  const { db, schema } = await import("@/lib/db");
  const { generateMorningInsight } = await import("@/lib/morning-insight");
  // 14 days of real HRV/RHR history, ending yesterday — genuinely
  // calibrated — but no row at all for today.
  const today = new Date();
  await db.insert(schema.wellnessDaily).values(
    Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (14 - i));
      return { userId: USER, date: localYmd(d), hrvMs: 60, restingHr: 50 };
    })
  );
  // No seedMetric() call and no today wellness row → readiness null today.

  const forced = await generateMorningInsight(USER, { force: true });
  expect(forced).not.toBe("skipped");
  if (forced === "skipped") throw new Error("unreachable");
  expect(forced.text).toContain("Needs a readiness score today");
  expect(forced.text).not.toContain("Calibrating");
});
```

- [ ] **Step 6: Run the suite to verify it passes**

```bash
DATABASE_URL="postgres://ci:ci@localhost:5433/ci" DATABASE_DRIVER=pg npx vitest run tests/morning-insight.test.ts
```

Expected: 25 passed (24 updated/unchanged + 1 new).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/lib/morning-insight.ts tests/morning-insight.test.ts
git commit -m "feat(uncertainty): distinguish a same-day reading gap from genuine calibration in the morning brief"
```

---

### Task 2: `coach-context.ts` — the same fix for the LLM data snapshot

**Files:**

- Modify: `src/lib/coach-context.ts`
- Create: `tests/coach-context.test.ts`

**Interfaces:**

- Consumes: same three imports as Task 1.
- Produces: nothing new — only the one hardcoded line changes.

- [ ] **Step 1: Write the failing test**

Create `tests/coach-context.test.ts` (mirror `tests/morning-insight.test.ts`'s
`hasDb` guard and cleanup style — read that file's top ~40 lines first):

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-coach-context-user";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
}

describe.skipIf(!hasDb)("fetchAthleteContext", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("names a same-day reading gap, not calibrating, for an already-calibrated athlete", async () => {
    const { db, schema } = await import("@/lib/db");
    const { fetchAthleteContext } = await import("@/lib/coach-context");
    const today = new Date();
    await db.insert(schema.wellnessDaily).values(
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (14 - i));
        return { userId: USER, date: localYmd(d), hrvMs: 60, restingHr: 50 };
      })
    );
    // No daily_metrics row at all → no readiness computed today.

    const context = await fetchAthleteContext(USER, db);
    expect(context).toContain("Needs a readiness score today");
    expect(context).not.toContain("Calibrating");
  });

  it("still says calibrating for a genuinely new athlete", async () => {
    const { db } = await import("@/lib/db");
    const { fetchAthleteContext } = await import("@/lib/coach-context");
    // No wellness_daily or daily_metrics rows at all.
    const context = await fetchAthleteContext(USER, db);
    expect(context).toContain("Calibrating — day 0 of 14 days");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
DATABASE_URL="postgres://ci:ci@localhost:5433/ci" DATABASE_DRIVER=pg npx vitest run tests/coach-context.test.ts
```

Expected: FAIL — the line still reads
`"Calibrating (needs 14+ days of data)"` verbatim.

- [ ] **Step 3: Implement**

Add to the top-level imports:

```ts
import {
  calibrationProgress,
  CALIBRATION_TARGET_DAYS,
} from "@/lib/calibration";
import { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";
```

Change:

```ts
  } else {
    lines.push("**Readiness:** Calibrating (needs 14+ days of data)");
  }
```

to:

```ts
  } else {
    // Fail closed on a query error: the most conservative reading
    // (calibrating, zero days) rather than throwing into a coach reply.
    let calibrationWindow: Awaited<
      ReturnType<typeof db.query.wellnessDaily.findMany>
    > = [];
    try {
      calibrationWindow = await db.query.wellnessDaily.findMany({
        where: and(
          eq(schema.wellnessDaily.userId, userId),
          gte(schema.wellnessDaily.date, daysAgo(CALIBRATION_TARGET_DAYS))
        ),
      });
    } catch {
      // calibrationWindow stays [] — see comment above.
    }
    const calibration = calibrationProgress(
      calibrationWindow.map((w) => ({ hrvMs: w.hrvMs, restingHr: w.restingHr }))
    );
    lines.push(
      `**Readiness:** ${unavailableMessage(
        calibration.remaining > 0
          ? Figure.calibrating(
              calibration.daysWithSignal,
              calibration.target,
              "days"
            )
          : Figure.missingInput("a readiness score today")
      )}`
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
DATABASE_URL="postgres://ci:ci@localhost:5433/ci" DATABASE_DRIVER=pg npx vitest run tests/coach-context.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/lib/coach-context.ts tests/coach-context.test.ts
git commit -m "feat(uncertainty): distinguish a same-day reading gap from genuine calibration in the coach's data snapshot"
```

---

### Task 3: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.71.0"` to `"version": "0.72.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.71.0` entry:

```markdown
## v0.72.0 — 2026-08-09 — Uncertainty vocabulary (Coach / Journal)

The sixth slice of Phase 2b.3 — the first to touch the AI coach itself
rather than a UI component.

- `morning-insight.ts`'s deterministic template (shown when no LLM is
  configured, or the LLM call fails/returns empty) and `coach-context.ts`'s
  LLM data snapshot both said "calibrating" (or a static, never-updating
  "needs 14+ days of data") any time readiness was null — conflating a
  genuinely new athlete with an already-calibrated athlete who simply
  didn't sync today. Same class of bug the v0.70.0 final review caught in
  `BodyBatteryCurve`, found here in two more places while migrating this
  surface. Both now gate on a real `calibrationProgress()` count, naming
  the actual reason via `unavailableMessage()`.
- Investigated and left alone: `journal-form.tsx`'s slider dash (live
  interactive input state, same exclusion as the vitals slice's
  `checkin-sheet.tsx`) and `coach-context.ts`'s per-field dashes (dense
  LLM-context data placeholders, same reasoning that excluded
  `laps-table.tsx` in the Log/Activity slice).
- No dead components found on this surface.
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, find the 2b.3 bullet's inline status note and read its
current exact text first. Extend it to mention v0.72.0, still without
checking the box (Admin/misc is the only surface remaining).

- [ ] **Step 4: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
DATABASE_URL="postgres://ci:ci@localhost:5433/ci" DATABASE_DRIVER=pg npx vitest run tests/morning-insight.test.ts tests/coach-context.test.ts
```

(The plain `npm test` run will report the DB-backed suites as skipped, same
as always locally — the second command is what actually re-verifies them.)

If `format:check` fails, run
`npx prettier --write package.json CHANGELOG.md docs/ROADMAP.md` and
re-verify.

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.72.0 — uncertainty vocabulary, Coach/Journal"
```

- [ ] **Step 6: Tear down the throwaway test database**

```bash
docker rm -f recover-test-db
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.
