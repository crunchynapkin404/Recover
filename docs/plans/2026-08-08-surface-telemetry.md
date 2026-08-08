# Surface Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record, locally and privately, which surfaces of the app actually get opened, so the deferred IA decision (Phase 2b.2) rests on evidence rather than recall.

**Architecture:** One table `surface_views` keyed `(user_id, surface, day)` with an integer counter, incremented by a single helper called from each authenticated page's server component. Surface keys are a closed set, never raw pathnames. Reads are owner-only on the existing `/admin` page.

**Tech Stack:** Next.js 16 (server components), Drizzle + Postgres, Vitest.

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`. This is the
first of two plans from that spec; the uncertainty vocabulary is the second and
shares no code with this one.

## Global Constraints

- **The data never leaves the instance.** No external calls, no aggregation service.
- **Counts only.** No timings, no event streams, no funnels, no referrers.
- **Surface keys are a closed union**, never a raw pathname — dynamic segments would make the set unbounded.
- **Recording must never break a page render.** Every write is wrapped and failures are logged, not thrown.
- **No athlete-facing figure is added.** Phase 2's constraint bars new claims; this is instrumentation and is visible owner-only.
- **DB-touching tests carry `describe.skipIf(!hasDb)`** and must delete both their rows _and_ their seeded test user in `afterAll` — two `*.invalid` users are currently sitting in the live database because an earlier test did not.
- Node 22 is on PATH; run tests with `set -a; . ./.env; set +a` so `DATABASE_URL` points at the dev DB on `127.0.0.1:5435` (container `recover-devdb`), never the live DB on `:5434`.

---

### Task 1: `surface_views` table and the `recordSurfaceView` helper

**Files:**

- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0040_surface_views.sql` (generated)
- Create: `src/lib/telemetry.ts`
- Test: `src/lib/telemetry.test.ts`

**Interfaces:**

- Consumes: `db`, `schema` from `@/lib/db`; `localYmd` from `@/lib/charts`; `logger` from `@/lib/logger`.
- Produces: `SURFACES` (readonly tuple), `type Surface`, and
  `recordSurfaceView(userId: string, surface: Surface): Promise<void>`.
  Task 2 calls `recordSurfaceView`. Task 3 references `schema.surfaceViews`.
  Task 4 calls `pruneSurfaceViews(olderThanDays: number): Promise<number>`.

- [ ] **Step 1: Add the table to the schema**

Append to `src/lib/db/schema.ts` (after `journalPrefs`, keeping the file's
existing grouping of small preference/telemetry tables):

```ts
// v0.66 Phase 2b: local-only record of which surfaces get opened, so the IA
// decision rests on evidence rather than recall. Counts only — no timings, no
// event stream. `surface` is a closed union from src/lib/telemetry.ts, never a
// raw pathname: dynamic segments like /activity/[id] would make it unbounded.
export const surfaceViews = pgTable(
  "surface_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    day: text("day").notNull(), // local calendar day, "YYYY-MM-DD"
    count: integer("count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("surface_views_user_surface_day_uq").on(
      t.userId,
      t.surface,
      t.day
    ),
  ]
);
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name surface_views`

Expected: one new file `drizzle/0040_surface_views.sql` containing exactly one
`CREATE TABLE "surface_views"` and one `CREATE UNIQUE INDEX`. The snapshot
chain is clean as of `v0.65.0`, so nothing from 0032–0039 should be re-emitted.
If any earlier migration reappears in the file, stop and report it rather than
committing.

- [ ] **Step 3: Apply it to the dev DB**

```bash
set -a; . ./.env; set +a
node scripts/migrate.mjs
```

Expected: `migrations applied`

- [ ] **Step 4: Write the failing test**

Create `src/lib/telemetry.test.ts`:

```ts
import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localYmd } from "@/lib/charts";
import { recordSurfaceView } from "./telemetry";

const TEST_USER = "test-telemetry-user";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("recordSurfaceView", () => {
  // surfaceViews.userId is a real FK, so the test user must exist in `users`
  // or the insert throws 23503. Seed it, and delete it again in afterAll —
  // leaving test users behind is how two *.invalid rows ended up live.
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Test Telemetry User",
        email: `${TEST_USER}@example.invalid`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.surfaceViews)
      .where(eq(schema.surfaceViews.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  beforeEach(async () => {
    await db
      .delete(schema.surfaceViews)
      .where(eq(schema.surfaceViews.userId, TEST_USER));
  });

  it("writes one row with count 1 on first view", async () => {
    await recordSurfaceView(TEST_USER, "today");

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].surface).toBe("today");
    expect(rows[0].count).toBe(1);
    expect(rows[0].day).toBe(localYmd(new Date()));
  });

  it("increments in place rather than inserting a second row", async () => {
    await recordSurfaceView(TEST_USER, "train");
    await recordSurfaceView(TEST_USER, "train");
    await recordSurfaceView(TEST_USER, "train");

    const rows = await db.query.surfaceViews.findMany({
      where: and(
        eq(schema.surfaceViews.userId, TEST_USER),
        eq(schema.surfaceViews.surface, "train")
      ),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
  });

  it("keeps surfaces separate", async () => {
    await recordSurfaceView(TEST_USER, "today");
    await recordSurfaceView(TEST_USER, "body");

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.surface).sort()).toEqual(["body", "today"]);
  });

  it("never throws when the write fails", async () => {
    // A user id with no row in `users` violates the FK. The page render must
    // survive it; a missing count is always preferable to a 500.
    await expect(
      recordSurfaceView("test-telemetry-nonexistent", "today")
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
set -a; . ./.env; set +a
npx vitest run src/lib/telemetry.test.ts
```

Expected: FAIL — `Failed to resolve import "./telemetry"`

- [ ] **Step 6: Write the implementation**

Create `src/lib/telemetry.ts`:

```ts
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localYmd } from "@/lib/charts";
import { logger } from "@/lib/logger";

/**
 * Every surface the app records a view for. A closed set, not raw pathnames:
 * `/activity/[id]` as a pathname would produce one key per activity and make
 * the table unbounded. Adding a page means adding a key here deliberately.
 */
export const SURFACES = [
  "today",
  "train",
  "coach",
  "body",
  "settings",
  "admin",
  "import",
  "activity",
  "activity-log",
] as const;

export type Surface = (typeof SURFACES)[number];

/**
 * Increment today's counter for one surface. Local-only; nothing leaves the
 * instance.
 *
 * Deliberately swallows its own errors: this runs inside a page render, and a
 * telemetry write must never be the reason an athlete sees a 500. A missing
 * count is a smaller loss than a broken page.
 */
export async function recordSurfaceView(
  userId: string,
  surface: Surface
): Promise<void> {
  try {
    await db
      .insert(schema.surfaceViews)
      .values({ userId, surface, day: localYmd(new Date()), count: 1 })
      .onConflictDoUpdate({
        target: [
          schema.surfaceViews.userId,
          schema.surfaceViews.surface,
          schema.surfaceViews.day,
        ],
        set: { count: sql`${schema.surfaceViews.count} + 1` },
      });
  } catch (err) {
    logger.warn("surface view not recorded", {
      surface,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
set -a; . ./.env; set +a
npx vitest run src/lib/telemetry.test.ts
```

Expected: PASS — 4 passed

- [ ] **Step 8: Verify the test is not vacuous**

Temporarily change `set: { count: sql\`${schema.surfaceViews.count} + 1\` }`to`set: { count: 1 }`, re-run, and confirm "increments in place" fails with
`expected 1 to be 3`. Restore the line afterwards and re-run to confirm 4 passed.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ src/lib/telemetry.ts src/lib/telemetry.test.ts
git commit -m "feat(telemetry): local-only surface view counts"
```

---

### Task 2: Record a view on every authenticated page

**Files:**

- Modify: `src/app/page.tsx`, `src/app/train/page.tsx`, `src/app/coach/page.tsx`, `src/app/body/page.tsx`, `src/app/settings/page.tsx`, `src/app/admin/page.tsx`, `src/app/import/page.tsx`, `src/app/activity/[id]/page.tsx`, `src/app/activity/log/page.tsx`
- Test: `src/lib/telemetry.surfaces.test.ts`

**Interfaces:**

- Consumes: `recordSurfaceView`, `SURFACES`, `type Surface` from `@/lib/telemetry` (Task 1).
- Produces: nothing new. Task 5 reads the rows this task creates.

- [ ] **Step 1: Write the failing test**

Create `src/lib/telemetry.surfaces.test.ts`. This guards the mapping, not the
write — it fails when a page is added without a key, which is the mistake this
design is most likely to suffer.

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SURFACES } from "./telemetry";

/** Every page.tsx under src/app, as repo-relative paths. */
function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pageFiles(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

describe("surface instrumentation", () => {
  it("records a view on every authenticated page", () => {
    const missing: string[] = [];
    for (const file of pageFiles("src/app")) {
      const src = readFileSync(file, "utf8");
      const authenticated =
        src.includes("requireUser()") || src.includes("requireSession()");
      if (!authenticated) continue;
      if (!src.includes("recordSurfaceView(")) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  it("uses only keys declared in SURFACES", () => {
    const used = new Set<string>();
    for (const file of pageFiles("src/app")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/recordSurfaceView\([^,]+,\s*"([^"]+)"/g)) {
        used.add(m[1]);
      }
    }
    const declared = new Set<string>(SURFACES);
    expect([...used].filter((s) => !declared.has(s))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/telemetry.surfaces.test.ts`
Expected: FAIL — the first test lists all nine authenticated pages.

- [ ] **Step 3: Instrument the eight `requireUser()` pages**

In each of `src/app/page.tsx`, `src/app/train/page.tsx`,
`src/app/coach/page.tsx`, `src/app/body/page.tsx`, `src/app/admin/page.tsx`,
`src/app/import/page.tsx`, `src/app/activity/[id]/page.tsx` and
`src/app/activity/log/page.tsx`: add the import

```ts
import { recordSurfaceView } from "@/lib/telemetry";
```

and immediately after that file's existing `const user = await requireUser();`
line, add the matching call:

| File                             | Call                                                |
| -------------------------------- | --------------------------------------------------- |
| `src/app/page.tsx`               | `await recordSurfaceView(user.id, "today");`        |
| `src/app/train/page.tsx`         | `await recordSurfaceView(user.id, "train");`        |
| `src/app/coach/page.tsx`         | `await recordSurfaceView(user.id, "coach");`        |
| `src/app/body/page.tsx`          | `await recordSurfaceView(user.id, "body");`         |
| `src/app/admin/page.tsx`         | `await recordSurfaceView(user.id, "admin");`        |
| `src/app/import/page.tsx`        | `await recordSurfaceView(user.id, "import");`       |
| `src/app/activity/[id]/page.tsx` | `await recordSurfaceView(user.id, "activity");`     |
| `src/app/activity/log/page.tsx`  | `await recordSurfaceView(user.id, "activity-log");` |

In `src/app/admin/page.tsx` the call goes **after** the
`if (user.role !== "owner") redirect("/");` guard, so a redirected non-owner
does not register an admin view.

- [ ] **Step 4: Instrument the `requireSession()` page**

`src/app/settings/page.tsx` authenticates differently. Add the same import, and
after its existing `const user = session.user;` line (currently line 53) add:

```ts
await recordSurfaceView(user.id, "settings");
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/telemetry.surfaces.test.ts`
Expected: PASS — 2 passed

- [ ] **Step 6: Verify typecheck and build**

```bash
npm run typecheck
set -a; . ./.env; set +a && npm run build
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/app src/lib/telemetry.surfaces.test.ts
git commit -m "feat(telemetry): record a view on every authenticated page"
```

---

### Task 3: Include the counts in the GDPR export and import

**Files:**

- Modify: `src/lib/export/export-user.ts`
- Modify: `src/lib/export/import-user.ts`
- Test: `src/lib/export/export-user.test.ts` (existing file — add a case)

**Interfaces:**

- Consumes: `schema.surfaceViews` (Task 1).
- Produces: a `surface_views` key in the export payload.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/export/export-user.test.ts`, inside its existing top-level
`describe`:

```ts
it("includes surface_views in the export payload", async () => {
  const data = await exportUserData(db, USER);
  expect(data).toHaveProperty("surface_views");
  expect(Array.isArray(data.surface_views)).toBe(true);
});
```

The exported function is `exportUserData(db, userId)` — it takes the database
handle first. The file's existing user constant is `USER = "test-export-user"`
(line 10); reuse it rather than seeding a second test user.

- [ ] **Step 2: Run it to verify it fails**

```bash
set -a; . ./.env; set +a
npx vitest run src/lib/export/export-user.test.ts
```

Expected: FAIL — `expected {...} to have property "surface_views"`

- [ ] **Step 3: Add it to the export type and query**

In `src/lib/export/export-user.ts`, add to the payload interface alongside
`journal_prefs` (near line 128):

```ts
  surface_views: (typeof schema.surfaceViews.$inferSelect)[];
```

Add `surfaceViews` to the destructured names in the parallel query block
(after `journalPrefs`, near line 183), and add the matching query after the
`db.query.journalPrefs.findMany(...)` call at line 221 — the destructured names
and the query list are positional, so both must be inserted at the same index:

```ts
    db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, userId),
    }),
```

Then add to the returned object, after `notification_prefs` (near line 318):

```ts
    surface_views: surfaceViews,
```

- [ ] **Step 4: Add the import side**

In `src/lib/export/import-user.ts`, alongside the existing `journalPrefs`
insert block (near line 278), add:

```ts
if (data.surface_views.length > 0) {
  await tx.insert(schema.surfaceViews).values(
    data.surface_views.map((r): Carried<typeof schema.surfaceViews, "id"> => ({
      userId,
      surface: r.surface,
      day: r.day,
      count: r.count,
    }))
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
set -a; . ./.env; set +a
npx vitest run src/lib/export/export-user.test.ts
```

Expected: PASS

- [ ] **Step 6: Run the round-trip drill**

```bash
./scripts/export-import-drill.sh
```

Expected: the drill completes and reports success. It spins its own scratch
Postgres from empty and sets its own `DATABASE_URL` — do not run the `.ts`
directly.

- [ ] **Step 7: Commit**

```bash
git add src/lib/export
git commit -m "feat(telemetry): carry surface views through export and import"
```

---

### Task 4: Prune old rows in the scheduler tick

**Files:**

- Modify: `src/lib/telemetry.ts`
- Modify: `src/lib/sync/scheduler.ts`
- Test: `src/lib/telemetry.test.ts` (existing file from Task 1 — add a case)

**Interfaces:**

- Consumes: `schema.surfaceViews` (Task 1).
- Produces: `pruneSurfaceViews(olderThanDays: number): Promise<number>`, called by the tick.

- [ ] **Step 1: Write the failing test**

Add to the `describe.skipIf(!hasDb)` block in `src/lib/telemetry.test.ts`:

```ts
it("prunes rows older than the retention window and leaves recent ones", async () => {
  const old = "2020-01-01";
  await db.insert(schema.surfaceViews).values({
    userId: TEST_USER,
    surface: "today",
    day: old,
    count: 5,
  });
  await recordSurfaceView(TEST_USER, "train");

  const deleted = await pruneSurfaceViews(180);
  expect(deleted).toBeGreaterThanOrEqual(1);

  const rows = await db.query.surfaceViews.findMany({
    where: eq(schema.surfaceViews.userId, TEST_USER),
  });
  expect(rows.map((r) => r.day)).not.toContain(old);
  expect(rows.map((r) => r.surface)).toContain("train");
});
```

Add `pruneSurfaceViews` to the existing import from `./telemetry` at the top of
the file.

- [ ] **Step 2: Run it to verify it fails**

```bash
set -a; . ./.env; set +a
npx vitest run src/lib/telemetry.test.ts
```

Expected: FAIL — `pruneSurfaceViews is not a function`

- [ ] **Step 3: Implement the prune**

Append to `src/lib/telemetry.ts`, changing its existing
`import { sql } from "drizzle-orm";` to `import { lt, sql } from "drizzle-orm";`:

```ts
/**
 * Drop counts older than the retention window. Bounded growth matters here
 * because the table gains a row per surface per day per user forever
 * otherwise. Returns the number of rows removed.
 */
export async function pruneSurfaceViews(
  olderThanDays: number
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const deleted = await db
    .delete(schema.surfaceViews)
    .where(lt(schema.surfaceViews.day, localYmd(cutoff)))
    .returning({ id: schema.surfaceViews.id });
  return deleted.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
set -a; . ./.env; set +a
npx vitest run src/lib/telemetry.test.ts
```

Expected: PASS — 5 passed

- [ ] **Step 5: Call it from the tick**

In `src/lib/sync/scheduler.ts`, immediately after the ghost-thread housekeeping
block (which ends around line 448), add the same guarded shape so a telemetry
failure can never break the tick:

```ts
// Surface-view retention — guarded like the ghost purge above.
try {
  const pruned = await pruneSurfaceViews(180);
  if (pruned > 0) logger.info("surface views pruned", { pruned });
} catch (err) {
  logger.error("surface view prune failed", {
    message: err instanceof Error ? err.message : String(err),
  });
}
```

Add `pruneSurfaceViews` to the file's imports from `@/lib/telemetry`.

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/telemetry.ts src/lib/telemetry.test.ts src/lib/sync/scheduler.ts
git commit -m "feat(telemetry): prune surface views past the retention window"
```

---

### Task 5: Owner-only view of the counts on `/admin`

**Files:**

- Create: `src/components/admin/surface-views-card.tsx`
- Test: `src/components/admin/surface-views-card.test.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**

- Consumes: `schema.surfaceViews` (Task 1); the `/admin` owner guard already in `src/app/admin/page.tsx:12`.
- Produces: `<SurfaceViewsCard rows={...} />` where `rows` is `{ surface: string; total: number }[]`, sorted by `total` descending.

- [ ] **Step 1: Write the failing test**

Create `src/components/admin/surface-views-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SurfaceViewsCard } from "./surface-views-card";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(rows: { surface: string; total: number }[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SurfaceViewsCard rows={rows} />));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SurfaceViewsCard", () => {
  it("lists surfaces with their totals", () => {
    render([
      { surface: "today", total: 42 },
      { surface: "train", total: 7 },
    ]);
    expect(container.textContent).toContain("today");
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("train");
  });

  it("says so plainly when nothing has been recorded yet", () => {
    render([]);
    expect(container.textContent).toContain("No views recorded yet");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/admin/surface-views-card.test.tsx`
Expected: FAIL — `Failed to resolve import "./surface-views-card"`

- [ ] **Step 3: Write the component**

Create `src/components/admin/surface-views-card.tsx`:

```tsx
/**
 * Owner-only. Instrumentation for the Phase 2b.2 IA decision, not an athlete
 * metric — it says what was opened, nothing about training.
 */
export function SurfaceViewsCard({
  rows,
}: {
  rows: { surface: string; total: number }[];
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="label-micro mb-3">Surface views</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-white/50">No views recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.surface}
              className="flex items-baseline justify-between text-xs"
            >
              <span className="text-white/70">{r.surface}</span>
              <span className="font-mono tabular-nums text-white">
                {r.total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/admin/surface-views-card.test.tsx`
Expected: PASS — 2 passed

- [ ] **Step 5: Mount it on `/admin`**

In `src/app/admin/page.tsx`, add the imports:

```ts
import { sql } from "drizzle-orm";
import { SurfaceViewsCard } from "@/components/admin/surface-views-card";
```

After the owner guard and the `recordSurfaceView` call from Task 2, aggregate
across all users — this is an instance-owner view, not a per-athlete one:

```ts
const surfaceRows = await db
  .select({
    surface: schema.surfaceViews.surface,
    total: sql<number>`sum(${schema.surfaceViews.count})::int`,
  })
  .from(schema.surfaceViews)
  .groupBy(schema.surfaceViews.surface)
  .orderBy(sql`sum(${schema.surfaceViews.count}) desc`);
```

Render `<SurfaceViewsCard rows={surfaceRows} />` alongside the page's existing
cards.

- [ ] **Step 6: Verify the whole gate**

```bash
npm run typecheck && npm run lint && npm run format:check
set -a; . ./.env; set +a && npx vitest run && npm run build
```

Expected: typecheck clean, lint 0 problems, format clean, full suite passing
with 5 more tests than at `v0.65.0`'s 2044, build clean.

- [ ] **Step 7: Verify it renders in a real browser**

Start the app, sign in as the owner, visit `/admin`, and confirm the card shows
non-zero counts for the surfaces you just visited. Reload `/train` twice and
confirm its count rises by two. A green suite is not evidence a server
component renders — the v0.23 redesign shipped three bugs only a browser caught.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin src/app/admin/page.tsx
git commit -m "feat(telemetry): owner-only surface view counts on /admin"
```

---

## After this plan

The four-week window for the Phase 2b.2 IA decision starts when this reaches
the live instance, i.e. the trigger date is four weeks from the deploy, not
from the merge. Record the deploy date in `docs/ROADMAP.md` under Phase 2b.2 so
the trigger is unambiguous.

The second plan from this spec — the `Figure<T>` uncertainty vocabulary and its
~121 call sites — is independent of this one and can be written next.
