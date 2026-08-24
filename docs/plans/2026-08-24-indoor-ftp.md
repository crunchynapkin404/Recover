# Indoor FTP Fallback Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an athlete record an indoor FTP separate from their (outdoor)
FTP, and have race-day pacing and feasibility/demand estimates fall back to
it — at explicitly lower confidence — when no outdoor FTP is set.

**Architecture:** One new nullable `bodyPrefs` column. One new pure resolver,
`resolveFtpAnchor()`, replacing two independent, drifting inline
fallback-resolution blocks in `pacingAnchors()` and `volume-inputs.ts`. The
FTP anchor's `athleteSet: boolean` becomes a `source: "outdoor" | "indoor" |
"synced"` tri-state everywhere it's threaded (`pacing.ts`, `demand.ts`), which
both consumers already have a confidence/why-text branch point for — this
adds one more branch to an existing pattern, not a new code path.

**Tech Stack:** TypeScript, vitest, drizzle-kit (migration), Next.js server
actions (Settings UI).

**Spec:** `docs/specs/2026-08-24-indoor-ftp-design.md`

## Global Constraints

- **Additive only.** `bodyPrefs.ftpWatts` keeps its name and meaning
  (outdoor/default). No renames, no data migration, no MCP tool schema
  changes.
- **FTP anchor only.** `runPace`/`swimPace`'s `athleteSet: boolean` fields are
  untouched — this plan is scoped to FTP.
- **Fallback order:** outdoor (athlete-set) → indoor (athlete-set) → synced
  eFTP (derived) → `null`. Never reordered, never skips a tier.
- **`source === "indoor"` always forces `confidence: "low"`** in both
  `pacing.ts` and `demand.ts`, and always adds an explicit why-text fragment
  naming the approximation. Mirrors the existing `derived`/`"synced"` branch
  exactly — same mechanism, one more tier.
- **Out of scope, explicitly: `training-load.ts`.** Do not touch it. Its
  per-activity historical intensity calc keeps using one FTP, unchanged.
- **Every existing test must still pass.** This plan renames a field
  (`athleteSet` → `source`) on a type used by dozens of existing fixtures in
  `demand.test.ts` — `npx tsc --noEmit` is the exhaustive checklist of what
  still needs updating after each type change; run it after every step that
  touches a shared type.

---

## File Structure

| Path                                              | Responsibility                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/db/schema.ts`                            | `bodyPrefs.ftpWattsIndoor` column.                                                 |
| `drizzle/*.sql` (generated)                       | Additive migration.                                                                |
| `src/lib/race/service.ts`                         | `FtpSource`, `FtpAnchor`, `resolveFtpAnchor()`; `pacingAnchors()` wired to it.     |
| `src/lib/race/service.test.ts`                    | Unit tests for `resolveFtpAnchor()`.                                               |
| `src/lib/race/outlook.test.ts`                    | DB-gated: `raceCard()` end-to-end with only indoor FTP set.                        |
| `src/lib/race/pacing.ts`                          | `PacingInput.ftpSource`, indoor branch (why-text + confidence).                    |
| `src/lib/race/pacing.test.ts`                     | Rename `ftpAthleteSet` fixture; new indoor-fallback test.                          |
| `src/lib/race/outlook.ts`                         | Pass `ftpSource` instead of `ftpAthleteSet` (mechanical).                          |
| `src/lib/tools/get-race-pacing.ts`                | Same mechanical rename.                                                            |
| `src/lib/race/demand.ts`                          | `EventDemandInput.ftp.source`, `Priced.weakestAnchorSource`, `ANCHOR_INDOOR_COPY`. |
| `src/lib/race/demand.test.ts`                     | 7 fixture sites renamed; 2 new indoor tests.                                       |
| `src/lib/week-plan/volume-inputs.ts`              | Calls `resolveFtpAnchor()` instead of its own inline fallback.                     |
| `src/lib/week-plan/volume-inputs.test.ts`         | DB-gated: indoor-fallback wiring test.                                             |
| `src/components/settings/body-prefs-card.tsx`     | Second FTP input, relabeled.                                                       |
| `src/app/settings/body-actions.ts`                | `ftpWattsIndoor` in `setBodyPrefs` input + validation.                             |
| `src/app/settings/page.tsx`                       | Passes `bodyPrefsRow?.ftpWattsIndoor` to `BodyPrefsCard`.                          |
| `src/lib/export/import-user.ts`                   | Round-trips the new column (export side is schema-inferred, needs no change).      |
| `src/lib/export/import-user.test.ts`              | Round-trip assertion for the new field.                                            |
| `CHANGELOG.md`, `docs/ROADMAP.md`, `package.json` | Release bookkeeping, per `docs/RELEASING.md` step 1/2.                             |

---

### Task 1: Schema and migration

**Files:**

- Modify: `src/lib/db/schema.ts:588` (inside `bodyPrefs`)
- Create: `drizzle/*.sql` (generated by `drizzle-kit`)

**Interfaces:**

- Produces: `bodyPrefs.ftpWattsIndoor: number | null`, readable via
  `db.query.bodyPrefs.findFirst(...)` with no `columns` allowlist change
  needed anywhere (every existing `bodyPrefs` read already returns the whole
  row).

- [ ] **Step 1: Add the column**

In `src/lib/db/schema.ts`, immediately after line 588
(`ftpWatts: integer("ftp_watts"),`):

```ts
  ftpWatts: integer("ftp_watts"),
  /**
   * v0.117: the indoor/trainer FTP, distinct from the outdoor one above.
   * null = not set. Used ONLY as a fallback anchor when ftpWatts is null —
   * races have no indoor concept in this app, so this can never mean "use it
   * for race day" directly. See docs/specs/2026-08-24-indoor-ftp-design.md.
   */
  ftpWattsIndoor: integer("ftp_watts_indoor"),
```

- [ ] **Step 2: Generate the migration**

Run (with `DATABASE_URL` set — any value works, `drizzle-kit generate` diffs
the local schema against `drizzle/meta`, it does not connect):

```bash
npm run db:generate
```

Expect a new `drizzle/NNNN_<slug>.sql` containing exactly:

```sql
ALTER TABLE "body_prefs" ADD COLUMN "ftp_watts_indoor" integer;
```

If it contains anything else, stop and re-check Step 1 — an unrelated diff
means the schema file had a prior uncommitted change.

- [ ] **Step 3: Verify the migration applies cleanly**

Against a scratch database (see `docs/2026-08-20-demand-map-handoff.md`'s
"With a database" recipe for the exact docker command):

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  node scripts/migrate.mjs
```

Expect: `migrations applied`, no errors.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expect: PASS (drizzle infers `ftpWattsIndoor: number | null` on
`bodyPrefs.$inferSelect` automatically from the schema; nothing consumes it
yet, so nothing else should change).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(schema): add bodyPrefs.ftpWattsIndoor

Additive column, no consumer yet — see docs/specs/2026-08-24-indoor-ftp-design.md."
```

---

### Task 2: `resolveFtpAnchor()`, wired into `pacingAnchors()`

**Files:**

- Modify: `src/lib/race/service.ts` (new exports near the top, `pacingAnchors` at line 424)
- Modify: `src/lib/race/service.test.ts` (new test file section)

**Interfaces:**

- Consumes: nothing new — `resolveFtpAnchor` is pure, no imports beyond what's already in `service.ts`.
- Produces: `export type FtpSource = "outdoor" | "indoor" | "synced";`,
  `export interface FtpAnchor { watts: number; source: FtpSource }`,
  `export function resolveFtpAnchor(prefs: { ftpWatts: number | null; ftpWattsIndoor: number | null } | null, latestEftp: number | null): FtpAnchor | null`.
  `pacingAnchors()`'s return type drops `ftpAthleteSet: boolean` and gains
  `ftpSource: FtpSource` — **Task 3 depends on this exact field name.**

- [ ] **Step 1: Write the failing unit tests**

Create a new `describe` block at the top of `src/lib/race/service.test.ts`
(after the existing imports, before the existing `describe.skipIf(!hasDb)`
block — these four tests need no database):

```ts
import { resolveFtpAnchor } from "./service";

describe("resolveFtpAnchor", () => {
  it("prefers outdoor over everything else", () => {
    const result = resolveFtpAnchor(
      { ftpWatts: 250, ftpWattsIndoor: 230 },
      240
    );
    expect(result).toEqual({ watts: 250, source: "outdoor" });
  });

  it("falls back to indoor when outdoor is unset", () => {
    const result = resolveFtpAnchor(
      { ftpWatts: null, ftpWattsIndoor: 230 },
      240
    );
    expect(result).toEqual({ watts: 230, source: "indoor" });
  });

  it("falls back to synced eFTP when neither is set", () => {
    const result = resolveFtpAnchor(
      { ftpWatts: null, ftpWattsIndoor: null },
      240
    );
    expect(result).toEqual({ watts: 240, source: "synced" });
  });

  it("returns null when there is nothing to anchor on", () => {
    const result = resolveFtpAnchor(
      { ftpWatts: null, ftpWattsIndoor: null },
      null
    );
    expect(result).toBeNull();
    expect(resolveFtpAnchor(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
npx vitest run src/lib/race/service.test.ts -t "resolveFtpAnchor"
```

Expected: FAIL — `resolveFtpAnchor` is not exported from `./service`.

- [ ] **Step 3: Implement `resolveFtpAnchor`**

In `src/lib/race/service.ts`, add near the top of the file (after the
existing imports, before `pacingAnchors`):

```ts
export type FtpSource = "outdoor" | "indoor" | "synced";

export interface FtpAnchor {
  watts: number;
  source: FtpSource;
}

/**
 * The one place "which FTP does this athlete mean" gets decided.
 * `pacingAnchors()` and `volume-inputs.ts` used to resolve this
 * independently — see docs/specs/2026-08-24-indoor-ftp-design.md for why
 * that was a drift risk this closes.
 *
 * Pure — no I/O. Callers fetch `prefs`/`latestEftp` themselves.
 */
export function resolveFtpAnchor(
  prefs: { ftpWatts: number | null; ftpWattsIndoor: number | null } | null,
  latestEftp: number | null
): FtpAnchor | null {
  if (prefs?.ftpWatts != null) {
    return { watts: prefs.ftpWatts, source: "outdoor" };
  }
  if (prefs?.ftpWattsIndoor != null) {
    return { watts: prefs.ftpWattsIndoor, source: "indoor" };
  }
  if (latestEftp != null) {
    return { watts: Math.round(latestEftp), source: "synced" };
  }
  return null;
}
```

- [ ] **Step 4: Run the unit tests again, confirm they pass**

```bash
npx vitest run src/lib/race/service.test.ts -t "resolveFtpAnchor"
```

Expected: PASS, all 4 tests.

- [ ] **Step 5: Write the failing integration test**

`pacingAnchors()` doesn't have direct test coverage today (it's read out of
`service.ts:424`; nothing in `service.test.ts` calls it). Add one, in the
same new `describe` region — it needs a database, so it goes in a
`describe.skipIf(!hasDb)` block:

```ts
describe.skipIf(!hasDb)("pacingAnchors — indoor fallback", () => {
  const INDOOR_USER = "test-pacing-anchors-indoor-user";

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: INDOOR_USER,
        name: "Test Pacing Anchors Indoor User",
        email: `${INDOOR_USER}@example.invalid`,
      })
      .onConflictDoNothing();
    await db.insert(schema.bodyPrefs).values({
      userId: INDOOR_USER,
      ftpWatts: null,
      ftpWattsIndoor: 235,
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.bodyPrefs)
      .where(eq(schema.bodyPrefs.userId, INDOOR_USER));
    await db.delete(schema.users).where(eq(schema.users.id, INDOOR_USER));
  });

  it("uses indoor FTP when outdoor is unset", async () => {
    const anchors = await pacingAnchors(INDOOR_USER);
    expect(anchors.ftpWatts).toBe(235);
    expect(anchors.ftpSource).toBe("indoor");
  });
});
```

This matches the exact `users`-insert shape (`id`/`name`/`email`,
`.onConflictDoNothing()`) and `afterAll` teardown style the file's existing
`describe.skipIf(!hasDb)` block already uses (lines 42-116) — reusing the
established pattern rather than inventing a new one. Add `pacingAnchors` to
this file's existing `import { assembleForecastInputs } from "./service";`
line (it becomes `import { assembleForecastInputs, pacingAnchors } from
"./service";`), and `schema.bodyPrefs` needs no new import — `schema` is
already imported as a namespace from `@/lib/db` (line 3).

- [ ] **Step 6: Run it, confirm it fails correctly**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/race/service.test.ts -t "indoor fallback"
```

Expected: FAIL — `anchors.ftpSource` is `undefined` (`pacingAnchors` still
returns `ftpAthleteSet`, not `ftpSource`).

- [ ] **Step 7: Wire `pacingAnchors()` to `resolveFtpAnchor()`**

In `src/lib/race/service.ts`, replace the function's signature and its FTP
handling (currently lines 424-476):

```ts
export async function pacingAnchors(userId: string): Promise<{
  ftpWatts: number | null;
  massKg: number | null;
  thresholdPaceSecPerKm: number | null;
  ftpSource: FtpSource;
  runPaceAthleteSet: boolean;
}> {
  const prefs = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, userId),
  });
  const latest = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: [desc(schema.wellnessDaily.date)],
    limit: 60,
  });

  const eftp = latest.find((w) => w.eftp != null)?.eftp ?? null;
  const weightKg = latest.find((w) => w.weightKg != null)?.weightKg ?? null;

  const runPaceSet = prefs?.thresholdPaceSecPerKm ?? null;
  let runPaceDerived: number | null = null;
  if (runPaceSet == null) {
    const floor = new Date();
    floor.setDate(floor.getDate() - ANCHOR_CONSTANTS.WINDOW_DAYS);
    const anchorRows = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        gte(schema.activities.startDate, floor)
      ),
      columns: { sport: true, distanceM: true, durationS: true },
    });
    runPaceDerived = thresholdPaceFromHistory(anchorRows);
  }

  const ftpAnchor = resolveFtpAnchor(prefs ?? null, eftp);

  return {
    ftpWatts: ftpAnchor?.watts ?? null,
    ftpSource: ftpAnchor?.source ?? "synced",
    runPaceAthleteSet: runPaceSet != null,
    massKg: weightKg != null ? weightKg + 8 : null,
    thresholdPaceSecPerKm: runPaceSet ?? runPaceDerived,
  };
}
```

`ftpSource` defaults to `"synced"` when `ftpAnchor` is `null` (no anchor at
all) purely so the field is never `undefined` — `pacing.ts`'s `missingInput`
branch (checked before `ftpSource` is ever read) already refuses in that
case, so the value is never actually consulted.

The doc comment above `pacingAnchors` (the one starting "The three anchors
pacing needs...") stays — its "Athlete-set values win over synced ones"
sentence is still accurate, just now mediated by `resolveFtpAnchor`.

- [ ] **Step 8: Run the integration test, confirm it passes**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/race/service.test.ts
```

Expected: PASS. This will also show compile errors from `outlook.ts` and
`get-race-pacing.ts` (Task 3) if you run `npm run typecheck` at this point —
that's expected and resolved in Task 3, not a regression here.

- [ ] **Step 9: Commit**

```bash
git add src/lib/race/service.ts src/lib/race/service.test.ts
git commit -m "feat(race): resolveFtpAnchor(), wired into pacingAnchors

Replaces pacingAnchors' inline FTP fallback. Callers still reference
the old ftpAthleteSet field and won't typecheck until the next commit
- expected, not a regression."
```

---

### Task 3: `pacing.ts` gets the indoor branch; fix its two callers

**Files:**

- Modify: `src/lib/race/pacing.ts:39-163`
- Modify: `src/lib/race/pacing.test.ts:266-296`
- Modify: `src/lib/race/outlook.ts:78`
- Modify: `src/lib/tools/get-race-pacing.ts:23`
- Modify: `src/lib/race/outlook.test.ts` (new end-to-end test)

**Interfaces:**

- Consumes: `FtpSource` type from `./service` (type-only import — `pacing.ts`
  stays pure/no-I/O; a type import has zero runtime cost).
- Produces: `PacingInput.ftpSource?: FtpSource` (replaces `ftpAthleteSet?:
boolean`). `PacingTarget`'s shape is unchanged — only `why`/`confidence`
  text differs for the new tier.

- [ ] **Step 1: Write the failing test**

In `src/lib/race/pacing.test.ts`, add after the existing "drops a bike to low
confidence when the FTP was not set" test (currently ending at line 280):

```ts
it("drops a bike to low confidence and names the indoor anchor, when FTP is indoor-sourced", () => {
  const r = racePacing({
    sport: "Bike",
    distanceKm: 90,
    elevationM: 900,
    eventDays: 1,
    ftpWatts: 235,
    massKg: 75,
    thresholdPaceSecPerKm: null,
    ftpSource: "indoor",
  });
  expect(r.available).toBe(true);
  if (!r.available) return;
  expect(r.confidence).toBe("low");
  expect(r.why).toMatch(/indoor/i);
});

it("does not call a synced FTP 'indoor'", () => {
  const r = racePacing({
    sport: "Bike",
    distanceKm: 90,
    elevationM: 900,
    eventDays: 1,
    ftpWatts: 250,
    massKg: 75,
    thresholdPaceSecPerKm: null,
    ftpSource: "synced",
  });
  expect(r.available).toBe(true);
  if (!r.available) return;
  expect(r.confidence).toBe("low");
  expect(r.why).not.toMatch(/indoor/i);
});
```

- [ ] **Step 2: Run tests, confirm they fail on a type error**

```bash
npx vitest run src/lib/race/pacing.test.ts
```

Expected: FAIL — `ftpSource` does not exist on `PacingInput` (TypeScript
error surfaced through vitest, or the property is silently dropped and
`why` never matches `/indoor/i` — either way, red).

- [ ] **Step 3: Update `PacingInput` and the bike branch**

In `src/lib/race/pacing.ts`, add the type-only import at the top (after the
existing `import { Figure } ...` line):

```ts
import type { FtpSource } from "./service";
```

Replace `ftpAthleteSet?: boolean;` (line 55) with:

```ts
  /**
   * Which FTP this anchor is. Omitted defaults to the same "treat as best
   * case" behavior `ftpAthleteSet`'s absence used to have — an omitted flag
   * must never silently downgrade an existing caller.
   */
  ftpSource?: FtpSource;
```

Add a new constant near `DERIVED_ANCHOR_WHY` (line 87):

```ts
const INDOOR_ANCHOR_WHY = "Uses your indoor FTP — outdoor effort may differ.";
```

Replace the bike branch's confidence logic (lines 143-150):

```ts
const derived = input.ftpSource === "synced";
const indoorFallback = input.ftpSource === "indoor";
const why = [
  BIKE_WHY,
  long ? LONG_EVENT_WHY : null,
  indoorFallback ? INDOOR_ANCHOR_WHY : null,
  derived ? DERIVED_ANCHOR_WHY : null,
]
  .filter(Boolean)
  .join(" ");
```

And its confidence return (line 161, `long || derived ? "low" : "medium"`):

```ts
      long || derived || indoorFallback ? "low" : "medium",
```

- [ ] **Step 4: Run the pacing tests, confirm they pass**

```bash
npx vitest run src/lib/race/pacing.test.ts
```

Expected: PASS, including the two new tests and the pre-existing "treats an
unspecified flag as athlete-set" test (which never sets `ftpSource` at all —
confirming the safe default still holds).

- [ ] **Step 5: Fix the two callers**

`src/lib/race/outlook.ts:78` — inside `raceCard`'s `racePacing({...})` call,
replace:

```ts
    ftpAthleteSet: anchors.ftpAthleteSet,
```

with:

```ts
    ftpSource: anchors.ftpSource,
```

`src/lib/tools/get-race-pacing.ts:23` — same replacement, same line shape,
inside its own `racePacing({...})` call.

- [ ] **Step 6: Typecheck the whole repo**

```bash
npm run typecheck
```

Expected: PASS. If anything else references `ftpAthleteSet`, this is what
catches it — grep once more to confirm zero remaining hits:

```bash
grep -rn "ftpAthleteSet" src/
```

Expected: no output.

- [ ] **Step 7: Write the failing end-to-end test**

In `src/lib/race/outlook.test.ts`, inside the existing
`describe.skipIf(!hasDb)("raceCard", () => { ... })` block, add:

This file already defines `seedUser(id)` (line 40) — reuse it. `raceCard`'s
pacing figure does not require a training plan (only `outlook` does; `pacing`
is computed unconditionally from the race + anchors), so this test skips
`seedPlan` entirely and inserts a race directly, since `seedRace` (line 47)
sets no `distanceKm` and pacing needs one:

```ts
it("uses indoor FTP for race pacing when outdoor is unset", async () => {
  const userId = "test-race-card-indoor-ftp-user";
  await seedUser(userId);
  await db.insert(schema.races).values({
    userId,
    name: "Test Bike Race",
    raceType: "gran_fondo",
    sport: "Bike",
    date: "2026-12-01",
    priority: "A",
    distanceKm: 90,
    elevationM: 900,
  });
  await db.insert(schema.bodyPrefs).values({
    userId,
    ftpWatts: null,
    ftpWattsIndoor: 235,
  });

  const card = await raceCard(userId, new Date("2026-08-01"));
  expect(card.pacing?.available).toBe(true);
  if (!card.pacing?.available) return;
  expect(card.pacing.confidence).toBe("low");
  expect(card.pacing.why).toMatch(/indoor/i);

  await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, userId));
  await db.delete(schema.races).where(eq(schema.races.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
});
```

This file's current import line is `import { inArray } from "drizzle-orm";`
— add `eq` to it: `import { eq, inArray } from "drizzle-orm";`.

- [ ] **Step 8: Run it, confirm it fails, then implement/adjust until it passes**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/race/outlook.test.ts
```

By this point in the plan the underlying wiring (Task 2) and `pacing.ts`
(this task, Steps 1-6) are both already correct, so this test should pass on
the first real run once the fixture setup (race + user, matching the
surrounding block's existing pattern) is right — treat a failure here as a
fixture-setup bug, not a production-code bug.

- [ ] **Step 9: Commit**

```bash
git add src/lib/race/pacing.ts src/lib/race/pacing.test.ts \
  src/lib/race/outlook.ts src/lib/race/outlook.test.ts \
  src/lib/tools/get-race-pacing.ts
git commit -m "feat(race): race pacing falls back to indoor FTP, at low confidence"
```

---

### Task 4: `demand.ts` gets the indoor branch, and its tests

**Files:**

- Modify: `src/lib/race/demand.ts` (lines 20, 49, 130-268, 338-361)
- Modify: `src/lib/race/demand.test.ts` (7 exact fixture sites + 2 new tests)

**Interfaces:**

- Consumes: `FtpSource` from `./service` (type-only import).
- Produces: `EventDemandInput.ftp: { watts: number; source: FtpSource } |
null` (was `{ watts: number; athleteSet: boolean }`). `runPace`/`swimPace`
  are unchanged. **Task 5 depends on this exact field name.**

- [ ] **Step 1: Update the type and imports**

In `src/lib/race/demand.ts`, add after line 20's `PlanSport` import:

```ts
import type { FtpSource } from "./service";
```

Replace line 49:

```ts
  ftp: { watts: number; source: FtpSource } | null;
```

- [ ] **Step 2: Add the copy table and the triathlon rank helper**

After the existing `ANCHOR_DERIVED_COPY` constant (ending at line 155), add:

```ts
/**
 * Confidence copy when the weakest anchor used was an athlete-set INDOOR
 * FTP — not derived, but a real approximation for an outdoor estimate, so it
 * gets its own sentence rather than folding into ANCHOR_DERIVED_COPY's
 * "estimated" framing (indoor FTP is measured, just for the wrong venue).
 *
 * `Run`'s entry is unreachable in practice — a pure Run event's
 * `weakestAnchorSource` only ever consults `runPace.athleteSet`, which has no
 * indoor tier — kept anyway, same reasoning ANCHOR_SET_COPY's Triathlon
 * entry gives for its own unreachable-until case.
 */
const ANCHOR_INDOOR_COPY: Record<PlanSport, string> = {
  Bike: "Modelled from your indoor FTP — outdoor effort may differ. Set an outdoor FTP in Settings for a sharper figure.",
  Run: "Modelled from your threshold pace and the course profile.",
  Triathlon:
    "Modelled partly from your indoor FTP — outdoor effort may differ. Set an outdoor FTP in Settings for a sharper figure.",
};

const FTP_SOURCE_RANK: Record<FtpSource, 0 | 1 | 2> = {
  outdoor: 0,
  indoor: 1,
  synced: 2,
};
const FTP_SOURCE_BY_RANK: readonly FtpSource[] = [
  "outdoor",
  "indoor",
  "synced",
];

/**
 * A triathlon's weakestAnchorSource combines the FTP anchor's tri-state
 * `source` with `runPace`/`swimPace`'s plain `athleteSet` booleans onto one
 * scale. A boolean anchor is as good as `"outdoor"` when athlete-set, as bad
 * as `"synced"` when derived — it never earns the `"indoor"` middle rank,
 * which only an FTP anchor can.
 */
function weakestOfTriathlonAnchors(
  swimAthleteSet: boolean,
  ftp: { source: FtpSource } | null,
  runAthleteSet: boolean
): FtpSource {
  const ranks: (0 | 1 | 2)[] = [
    swimAthleteSet ? 0 : 2,
    ftp ? FTP_SOURCE_RANK[ftp.source] : 2,
    runAthleteSet ? 0 : 2,
  ];
  return FTP_SOURCE_BY_RANK[Math.max(...ranks)];
}
```

- [ ] **Step 3: Update `Priced` and its three call sites**

Replace `Priced.allAnchorsAthleteSet: boolean` (line 186) with
`weakestAnchorSource: FtpSource;` (keep its doc comment, updated to describe
the new field instead of the old boolean).

Line 235 (stated finish time — unconditional, matches the old `true`):

```ts
      weakestAnchorSource: "outdoor",
```

Lines 264-267 (triathlon branch):

```ts
      weakestAnchorSource: weakestOfTriathlonAnchors(
        input.swimPace!.athleteSet,
        input.ftp,
        input.runPace?.athleteSet ?? false
      ),
```

Lines 342-345 (single-sport branch):

```ts
      weakestAnchorSource:
        sport === "Bike"
          ? (input.ftp?.source ?? "synced")
          : input.runPace?.athleteSet
            ? "outdoor"
            : "synced",
```

- [ ] **Step 4: Update the confidence-building block**

Replace lines 357-361:

```ts
if (confidence == null) {
  confidence = priced.weakestAnchorSource === "outdoor" ? "medium" : "low";
  confidenceReason =
    priced.weakestAnchorSource === "outdoor"
      ? ANCHOR_SET_COPY[input.sport]
      : priced.weakestAnchorSource === "indoor"
        ? ANCHOR_INDOOR_COPY[input.sport]
        : ANCHOR_DERIVED_COPY[input.sport];
}
```

- [ ] **Step 5: Typecheck — this is the checklist for Step 6**

```bash
npm run typecheck
```

Expected: FAIL, listing every fixture in `demand.test.ts` still using
`athleteSet` on an `ftp` object. This list IS the work for the next step —
do not guess at what needs fixing, read it off the compiler.

- [ ] **Step 6: Fix every `ftp` fixture in `demand.test.ts`**

Exactly 7 sites use `ftp: { watts: N, athleteSet: true }` today — all `true`,
none `false` (verified by reading the file; there is no existing "derived
Bike FTP" fixture to preserve). Change each to
`ftp: { watts: N, source: "outdoor" }`, keeping `N` unchanged:

| Line | Before                                   | After                                     |
| ---: | ---------------------------------------- | ----------------------------------------- |
|    6 | `ftp: { watts: 310, athleteSet: true }`  | `ftp: { watts: 310, source: "outdoor" }`  |
|  315 | `ftp: { watts: 310, athleteSet: true },` | `ftp: { watts: 310, source: "outdoor" },` |
|  508 | `ftp: { watts: 310, athleteSet: true },` | `ftp: { watts: 310, source: "outdoor" },` |
|  531 | `ftp: { watts: 310, athleteSet: true },` | `ftp: { watts: 310, source: "outdoor" },` |
|  547 | `ftp: { watts: 310, athleteSet: true },` | `ftp: { watts: 310, source: "outdoor" },` |
|  569 | `ftp: { watts: 310, athleteSet: true },` | `ftp: { watts: 310, source: "outdoor" },` |
|  610 | `ftp: { watts: 310, athleteSet: true },` | `ftp: { watts: 310, source: "outdoor" },` |

`ftp: null` at lines 186 and 458 needs no change — `null` is still a valid
`EventDemandInput.ftp` value. Every `runPace`/`swimPace` fixture (their own
`athleteSet` fields) is unchanged — this rename is FTP-only.

- [ ] **Step 7: Typecheck again, confirm clean**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Run the existing demand tests, confirm they still pass**

```bash
npx vitest run src/lib/race/demand.test.ts
```

Expected: PASS, same test count as before this task (this step is a pure
rename — no behavior change yet for any existing case, since every renamed
fixture used `athleteSet: true` → `source: "outdoor"`, which takes the exact
same "medium"/`ANCHOR_SET_COPY` path as before).

- [ ] **Step 9: Write the two new failing indoor tests**

Add to `src/lib/race/demand.test.ts`, in the `describe("eventDemand
confidence ...")`-style block that contains the existing "is low when any
anchor used was derived" test (around line 492 — match whichever `describe`
that test is actually inside):

```ts
it("is low, and names the indoor anchor, when the FTP used was indoor", () => {
  const result = eventDemand({
    ...BASE,
    sport: "Bike",
    ftp: { watts: 235, source: "indoor" },
    runPace: null,
  });
  expect(result.available).toBe(true);
  if (!result.available) return;
  expect(result.confidence).toBe("low");
  expect(result.confidenceReason).toMatch(/indoor/i);
});

it("does not call a synced FTP 'indoor'", () => {
  const result = eventDemand({
    ...BASE,
    sport: "Bike",
    ftp: { watts: 250, source: "synced" },
    runPace: null,
  });
  expect(result.available).toBe(true);
  if (!result.available) return;
  expect(result.confidence).toBe("low");
  expect(result.confidenceReason).not.toMatch(/indoor/i);
});
```

`BASE` (defined at line 449) is `sport: "Run"` by default — both new tests
override `sport: "Bike"` and must also override `runPace: null` (`BASE`'s
`runPace` is athlete-set, and a Bike leg ignores `runPace` entirely, but
leaving a stale `Run`-shaped value in a `Bike`-sport fixture reads as a
copy-paste bug to the next person editing this file — set it to `null`
explicitly so the fixture only carries what a real Bike event would have).

- [ ] **Step 10: Run them, confirm they fail, then pass**

```bash
npx vitest run src/lib/race/demand.test.ts -t "indoor"
```

First run: FAIL (before Step 2-4's implementation — if you're following this
plan in order, this should already be GREEN, since Steps 2-4 ran first; if
you jumped ahead, go back and do Steps 2-4 before this one reads green for
the right reason).

- [ ] **Step 11: Full test file run**

```bash
npx vitest run src/lib/race/demand.test.ts
```

Expected: PASS, previous count + 2.

- [ ] **Step 12: Commit**

```bash
git add src/lib/race/demand.ts src/lib/race/demand.test.ts
git commit -m "feat(race): demand model falls back to indoor FTP, at low confidence"
```

---

### Task 5: Wire `resolveFtpAnchor()` into `volume-inputs.ts`

**Files:**

- Modify: `src/lib/week-plan/volume-inputs.ts:263-284`
- Modify: `src/lib/week-plan/volume-inputs.test.ts`

**Interfaces:**

- Consumes: `resolveFtpAnchor` from `@/lib/race/service` (already exists, Task 2).

- [ ] **Step 1: Write the failing integration test**

`assembleVolumeInputs(userId, now): Promise<VolumeInputsResult>` where
`VolumeInputsResult.demand: EventDemandResult | null` (`volume-inputs.ts:131`)
— the same `EventDemandResult` Task 4 already covers, so this test needs only
a user, one upcoming Bike race with a real `distanceKm`, and a `bodyPrefs`
row with indoor-only FTP; no activities/wellness/dailyMetrics rows are
needed (`assembleVolumeInputs` handles empty history gracefully — it's
CTL/level fields that would be unresolved, not `demand`, which this test
doesn't touch). Add to `src/lib/week-plan/volume-inputs.test.ts`, after the
existing `describe.skipIf(!hasDb)("assembleVolumeInputs — CTL source
(v0.92)", ...)` block:

```ts
describe.skipIf(!hasDb)("assembleVolumeInputs — indoor FTP fallback", () => {
  const USER = "test-volume-inputs-indoor-ftp-user";
  const now = new Date(2026, 7, 1);

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Volume Inputs Indoor FTP Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
    await db.insert(schema.races).values({
      userId: USER,
      name: "Test Gran Fondo",
      raceType: "gran_fondo",
      sport: "Bike",
      date: "2026-12-01",
      priority: "A",
      distanceKm: 130,
      elevationM: 4000,
    });
    await db.insert(schema.bodyPrefs).values({
      userId: USER,
      ftpWatts: null,
      ftpWattsIndoor: 235,
    });
  });

  afterAll(async () => {
    await db.delete(schema.races).where(eq(schema.races.userId, USER));
    await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("uses indoor FTP for demand when outdoor is unset", async () => {
    const result = await assembleVolumeInputs(USER, now);
    expect(result.demand?.available).toBe(true);
    if (!result.demand?.available) return;
    expect(result.demand.confidence).toBe("low");
    expect(result.demand.confidenceReason).toMatch(/indoor/i);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/week-plan/volume-inputs.test.ts -t "indoor"
```

Expected: FAIL (or the assertion is unreachable because `assembleVolumeInputs`
still resolves FTP its own way and never reads `ftpWattsIndoor`).

- [ ] **Step 3: Replace the inline resolution**

In `src/lib/week-plan/volume-inputs.ts`, add to the imports (near the
existing `import { eventDemand, ... } from "@/lib/race/demand";` line):

```ts
import { resolveFtpAnchor } from "@/lib/race/service";
```

Replace lines 263-264:

```ts
const ftpSet = prefs?.ftpWatts ?? null;
const ftpSynced = latestEftp != null ? Math.round(latestEftp) : null;
```

with:

```ts
const ftpAnchor = resolveFtpAnchor(prefs ?? null, latestEftp);
```

Replace the `ftp:` field in the `eventDemand({...})` call (currently lines
279-284):

```ts
      ftp: ftpAnchor,
```

(`resolveFtpAnchor` already returns `{ watts, source } | null` — exactly
`EventDemandInput.ftp`'s type, so this is a direct substitution, not a
reshaping.)

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run the test, confirm it passes**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/week-plan/volume-inputs.test.ts
```

Expected: PASS, full file, no regressions in the pre-existing CTL-source tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/week-plan/volume-inputs.ts src/lib/week-plan/volume-inputs.test.ts
git commit -m "feat(week-plan): feasibility/demand uses the shared FTP resolver

volume-inputs.ts no longer resolves FTP independently from
pacingAnchors() -- both now agree on outdoor/indoor/synced precedence."
```

---

### Task 6: Settings UI

**Files:**

- Modify: `src/components/settings/body-prefs-card.tsx`
- Modify: `src/app/settings/body-actions.ts`
- Modify: `src/app/settings/page.tsx:498-506`

**Interfaces:**

- Produces: an athlete can set/clear indoor FTP from Settings, validated
  50-600W (same bounds as outdoor), persisted to
  `bodyPrefs.ftpWattsIndoor`.

- [ ] **Step 1: `body-prefs-card.tsx` — relabel outdoor, add indoor field**

In `src/components/settings/body-prefs-card.tsx`:

Add `ftpWattsIndoor: number | null;` to the `Props` interface (after
`ftpWatts: number | null;`, line 10).

Add the matching destructured prop (line 21) and state hook (after line 27):

```ts
  ftpWattsIndoor,
```

```ts
const [ftpIndoor, setFtpIndoor] = useState(ftpWattsIndoor?.toString() ?? "");
```

In `save()`'s `setBodyPrefs({...})` call (lines 36-44), add after the
existing `ftpWatts` line:

```ts
        ftpWattsIndoor: ftpIndoor.trim() ? Number(ftpIndoor) : null,
```

Relabel the existing FTP label (line 110) from `"FTP (watts)"` to `"FTP
(watts) — outdoor"`.

Add a fourth `<label>` block after the existing FTP one (after line 120's
closing `</label>`, still inside the `grid-cols-3` div — it wraps to its own
row, which is fine, no grid-column change needed):

```tsx
<label className="block">
  <span className="label-micro mb-1 block">
    FTP (watts) — indoor (optional)
  </span>
  <input
    type="number"
    min={50}
    max={600}
    value={ftpIndoor}
    onChange={(e) => setFtpIndoor(e.target.value)}
    placeholder="e.g. 235"
    className={inputClass}
  />
</label>
```

- [ ] **Step 2: `body-actions.ts` — validation and persistence**

In `src/app/settings/body-actions.ts`, add `ftpWattsIndoor: number | null;`
to `setBodyPrefs`'s input type (after `ftpWatts: number | null;`).

After the existing FTP validation block (ending at line 61), add the same
shape for the new field:

```ts
if (
  input.ftpWattsIndoor != null &&
  (!Number.isInteger(input.ftpWattsIndoor) ||
    input.ftpWattsIndoor < MIN_FTP ||
    input.ftpWattsIndoor > MAX_FTP)
) {
  return {
    ok: false,
    message: "Indoor FTP must be between 50 and 600 watts.",
  };
}
```

Add to the `values` object (line 78-84):

```ts
    ftpWattsIndoor: input.ftpWattsIndoor,
```

Do **not** add `ftpWattsIndoor` to the `computeDailyMetrics` recompute
trigger (lines 95-98) — that recompute is for `training-load.ts`'s
per-activity intensity, which is explicitly out of scope (Global
Constraints) and does not read `ftpWattsIndoor`.

- [ ] **Step 3: `settings/page.tsx` — pass the prop**

In `src/app/settings/page.tsx`, inside the `<BodyPrefsCard ... />` call
(lines 498-506), add after the existing `ftpWatts={...}` line:

```tsx
                ftpWattsIndoor={bodyPrefsRow?.ftpWattsIndoor ?? null}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Manual verification in a real browser**

Per this repo's own convention (`docs/RELEASING.md` step 4: "Assert wiring at
the surface, not at the component"), settings forms have no existing
automated test — verify by hand against a scratch database:

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 TRUSTED_ORIGINS=http://localhost:3200 \
  npx next dev -p 3200
```

Sign in as the seeded owner, open Settings, confirm: the existing FTP field
now reads "FTP (watts) — outdoor", a new "FTP (watts) — indoor (optional)"
field appears beside it, saving a value in each persists across a reload,
and clearing the indoor field (empty string, not `0`) saves `null`.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/body-prefs-card.tsx \
  src/app/settings/body-actions.ts src/app/settings/page.tsx
git commit -m "feat(settings): indoor FTP field, outdoor FTP relabeled"
```

---

### Task 7: Export/import round-trip

**Files:**

- Modify: `src/lib/export/import-user.ts:251`
- Modify: `src/lib/export/import-user.test.ts`

**Interfaces:**

- `export-user.ts` needs **no change** — it infers `body_prefs`'s shape
  directly from `schema.bodyPrefs.$inferSelect` (line 126) and passes rows
  through unchanged (line 322), so the new column is already included in
  every export produced after Task 1.

- [ ] **Step 1: Write the failing test**

Find the existing `bodyPrefs` round-trip test in
`src/lib/export/import-user.test.ts` (search for `ftpWatts` — it's covered
by whatever test inserts a `bodyPrefs` row and re-imports it, likely near
the existing `schema.bodyPrefs` insert at line 57 in the test file for a
different suite; find the one that specifically imports and re-checks
`ftpWatts`). Extend that fixture's inserted row and its assertions to also
carry `ftpWattsIndoor`:

```ts
// In the export payload fixture this test builds:
ftpWattsIndoor: 235,
```

```ts
// In the post-import assertion:
expect(imported?.ftpWattsIndoor).toBe(235);
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/export/import-user.test.ts
```

Expected: FAIL — `imported.ftpWattsIndoor` is `undefined`, since
`import-user.ts` doesn't copy it yet.

- [ ] **Step 3: Add the field to the import**

In `src/lib/export/import-user.ts`, after line 251
(`ftpWatts: r.ftpWatts,`):

```ts
          ftpWattsIndoor: r.ftpWattsIndoor,
```

- [ ] **Step 4: Run it, confirm it passes**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run src/lib/export/import-user.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/import-user.ts src/lib/export/import-user.test.ts
git commit -m "feat(export): round-trip ftpWattsIndoor on import"
```

---

### Task 8: Release bookkeeping

Per `docs/RELEASING.md` step 1/2 — done in the same branch, before merge, not
by automation.

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run the full local gate**

```bash
npm run lint && npm run typecheck && node scripts/migrate.mjs && \
  npm run format:check && npm run build
```

Then, separately, the full test suite against the scratch database (see
Task 1's docker command if it's not already running):

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 \
  npx vitest run
```

Expected: everything green. Fix anything red before proceeding — this task
is bookkeeping, not a place to discover new bugs.

- [ ] **Step 2: Mutation-check the new confidence branches**

Per `docs/RELEASING.md` step 3 ("A surviving mutation is a finding"): in
`src/lib/race/pacing.ts`, temporarily change `indoorFallback ? "low" :
"medium"`'s `indoorFallback` reference to always `false`, run
`npx vitest run src/lib/race/pacing.test.ts`, confirm the new "drops a bike
to low confidence and names the indoor anchor" test fails, then revert. Do
the same for `demand.ts`'s `priced.weakestAnchorSource === "indoor"` branch
against its own new test. If either mutation does NOT cause its test to
fail, the test is not actually pinning the behavior it claims to — fix the
test, not the mutation.

- [ ] **Step 3: Bump the version**

In `package.json`:

```json
  "version": "0.118.0",
```

(Check `main`'s current `package.json` version first — if another release
landed on `main` since this branch started, use the next number after that,
not necessarily `0.118.0`.)

- [ ] **Step 4: CHANGELOG entry**

Add to the top of `CHANGELOG.md`, following the exact voice/structure of the
neighboring `v0.117.0`/`v0.116.0` entries (one-sentence hook, then sections
with bold lead-ins, then a `### Migrations` section). Cover: what indoor FTP
is for, the fallback order, that it's scoped to race-day/planning and
explicitly not historical load, and the shared-resolver cleanup. State
`### Migrations` as **additive only** — one new nullable column, no backfill.

- [ ] **Step 5: ROADMAP entry**

In `docs/ROADMAP.md`, find the demand-map row from
`docs/2026-08-20-demand-map-handoff.md` ("Different FTPs indoor/outdoor —
105 votes") and mark it shipped, in the same `- [x] **Title — vX.Y.Z.**`
style the neighboring `Race pacing` and `The release path runs itself`
entries use (search for `Remainder of the demand map, by votes` — the new
entry goes as a sibling bullet near it, following the same list structure).

- [ ] **Step 6: Format check**

```bash
npm run format:check
```

Fix with `npx prettier --write <file>` if it fails on the CHANGELOG/ROADMAP
edits (markdown formatting sometimes needs a second pass — see
`docs/2026-08-20-demand-map-handoff.md`'s "Traps found" section).

- [ ] **Step 7: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.118.0 — indoor FTP fallback anchor"
```

- [ ] **Step 8: Push and open the PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(race): indoor FTP fallback anchor" --body "..."
```

Wait for `ci.yml` and `surfaces.yml` to go green on the PR before merging —
this plan changes no rendered surface's visible shape (Settings gets a new
field, which is a real UI change with no automated capture coverage; see
Task 6 Step 5's manual verification), so a green `surfaces.yml` run mainly
confirms nothing else regressed.

---

## Self-Review Notes

**Spec coverage:** D1 (schema) → Task 1. D2 (shared resolver) → Task 2. D3
(fallback order) → Task 2's `resolveFtpAnchor`. D4 (tri-state `source`) →
Tasks 2-5. D5 (confidence/why-text) → Tasks 3-4. D6 (no MCP schema change) →
verified by Task 3 touching only `get-race-pacing.ts`'s internal call, not
its `parameters`/output shape. Settings UI → Task 6. Export/import symmetry
→ Task 7. Release bookkeeping → Task 8.

**Correction from the spec's touch-point list:** `icu-sport-settings-shape.ts`
is dropped — on inspection it shapes intervals.icu's own sport-settings API
response, unrelated to `bodyPrefs`. Not included in any task above.
