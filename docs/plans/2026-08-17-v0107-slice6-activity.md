# v0.107.0 — 2b.4 slice 6, Activity — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Activity surface to the v0.99 foundations — 12px floor,
token ramps, zero confirmed axe findings — starting with the page an athlete
actually looks at a ride on, which no capture has ever opened.

**Architecture:** Phase A makes the surface visible to the tooling and records
an honest baseline: the activity detail page and the debrief sheet become real
captured surfaces, and the streams they need get seeded. Phase B is the
redesign, and its scope is decided by phase A's number rather than guessed at
now.

**Tech Stack:** Next.js 16.2.10 (App Router), React 19.2.4, Tailwind v4
(`@theme` tokens in `src/app/globals.css`), Vitest 4 + jsdom + `vitest-axe`,
Playwright via `scripts/verify-surfaces.ts`.

**Spec:** `docs/specs/2026-08-11-2b4-visual-redesign-design.md` (2b.4, the
design authority for every slice)
**Predecessor:** `docs/plans/2026-08-17-v0106-slice5-settings-redesign.md`
(slice 5, shipped as v0.106.0)
**Gate:** ships through `docs/RELEASING.md`'s RC → soak → promote.

---

## Global Constraints

- **Branch:** `v0.107-activity` off `main`.
- **The 12px floor is hard.** No `text-[Npx]` below 12px survives, and a value
  that cannot be lifted gets **deleted or restated**, not shrunk — slice 4
  deleted a per-message timestamp rather than enlarge it; slice 5 deleted a
  `(example data)` span rather than give it a below-floor ink.
- **`hairline` is never text.** `tests/type-scale-guard.test.ts` fails the build
  on `text-hairline`.
- **Bare `text-white` / `bg-white` are in scope and no guard matches them.**
  `ADHOC_INK` requires a `/N` alpha. Slice 5 found 8 such sites; Activity has
  **~50**, its single largest offender class. Every per-task check below carries
  `\b(text|bg)-white\b` for exactly this reason.
- **Dev never holds real connector credentials** (`docs/ENVIRONMENTS.md`).
- **Five green checks:** `npm test`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm run format:check`.
- **Light mode stays unreachable** (`forcedTheme="dark"`) until slice 9. Light
  values are still written and still guarded.
- **Capture command** (production build from source; the RC image cannot serve
  `?state=`, which the Today surfaces need):

  ```bash
  set -a; . ./.env; set +a
  TRUSTED_ORIGINS=http://localhost:3200 npx next start -p 3200
  SCREENSHOT_BASE_URL=http://localhost:3200 npm run verify:surfaces -- v0107-activity
  ```

  **Capture against the DEV database (port 5434), which is what `.env` already
  names — do not override `DATABASE_URL` to 5435 here.** That was this plan's
  first mistake: `set -a; . ./.env; set +a` re-sources `.env` and overwrites any
  `DATABASE_URL` exported before it, so a command that _looks_ like it targets
  the soak stack seeds and reads the dev box instead. `scripts/seed-demo.ts`
  writes wherever `.env` points, so dev is where phase A's seeded streams live.
  The soak stack (5435) is a separate, restore-only database
  (`docs/ENVIRONMENTS.md`); it gets its own seeding run at release time, as
  `docs/RELEASING.md` step 11 describes.

  `TRUSTED_ORIGINS` is required on any non-default port — Better Auth refuses
  sign-in otherwise. Learned in v0.106.0 and not yet in `docs/RELEASING.md`.

- **The capture argument is the output directory, not a surface filter**
  (`scripts/verify-surfaces.ts:371`). Every run captures every surface, and a
  non-zero exit is expected while `admin` still carries its debt.

---

## What is actually there, measured 2026-08-17

`SURFACES` maps `activity-log` → `/activity/log`, and that page renders exactly
two components: `ActivityLogForm` and `ActivityLogEmpty`. **That is the whole
of what the 46-node baseline describes — the manual-entry form.**

**The activity detail page is not a captured surface at all.** `/activity/[id]`
— where an athlete opens a ride — has no `SURFACES` entry. Nothing in its
render chain has ever been photographed or axe-audited:

| File                                                  | arbitrary type | ad-hoc ink | default scale | bare white |
| ----------------------------------------------------- | -------------: | ---------: | ------------: | ---------: |
| `src/components/debrief/debrief-sheet.tsx`            |             11 |         17 |             0 |         15 |
| `src/app/activity/[id]/page.tsx`                      |              6 |          7 |             0 |          7 |
| `src/components/debrief/activity-debrief-section.tsx` |              5 |          5 |             0 |          4 |
| `src/components/activity/laps-table.tsx`              |              3 |          6 |             0 |          5 |
| `src/components/activity/stream-chart.tsx`            |              2 |          3 |             0 |          2 |
| `src/components/activity/delete-activity-button.tsx`  |              0 |          1 |             0 |          1 |
| `src/components/activity/stream-data-empty.tsx`       |              0 |          0 |             0 |          0 |
| **captured today —** `activity-log-form.tsx`          |              0 |         15 |            13 |         16 |
| **captured today —** `activity-log-empty.tsx`         |              0 |          0 |             0 |          0 |
| **Total**                                             |         **27** |     **54** |        **13** |     **50** |

**~144 class-site edits.** The largest single class is **bare `text-white` /
`bg-white`** — 50 of them, which no guard pattern sees. That is six times what
slice 5 found, and it is the exact defect still open on Today.

**20 of the 27 arbitrary sizes are below the 12px floor**, and they go lower
than anything Settings had: 6 × `text-[11px]`, 5 × `text-[11.5px]`,
3 × `text-[9.5px]`, 2 × `text-[10px]`, 2 × `text-[10.5px]`, 1 × `text-[9px]`,
1 × `text-[8.5px]`.

**Two states cannot render on any seeded database.**

1. **`activity_streams` is 0** against 114 activities. `getOrFetchActivityDetail`
   falls back to fetching from intervals.icu, which dev has no credentials for,
   so it returns `reason: "unavailable"` and `StreamChart` renders nothing —
   `StreamDataEmpty` is the only reachable state. Same defect shape as slice 5's
   six connector cards stuck on "Not connected".
2. **`debrief_state` is NULL on all 114 rows.** `SheetHost` with `?sheet=debrief`
   and no activity id looks for `debriefState: "pending"` and finds none, so the
   sheet renders nothing.

**The debrief sheet reaches back into a shipped slice.**
`src/components/debrief/debrief-sheet.tsx` is imported by
`src/components/today/sheet-host.tsx` — Today, slice 1, declared clean in
v0.100.0. It is a sheet, closed on load, and no Today capture has ever opened
it. This is the fifth consecutive slice to find a surface whose number described
its content closed. **It is deep-linkable** (`?sheet=debrief&activity=<id>`), so
reaching it costs a query parameter, not a click script.

### The baseline this must drive to zero

`activity-log` at **46 confirmed nodes** (23 light/phone + 23 light/desktop,
0 dark), re-derived correctly on 2026-08-17 and matching
`docs/axe-baseline-2026-08-11-seeded.md` exactly. The detail page and the
debrief sheet have **no baseline at all** — Phase A creates one.

---

## Phase A — make the surface visible

### Task 1: Capture the activity detail page

**Files:**

- Modify: `scripts/verify-surfaces.ts` — `SURFACES` (~line 302) and `main()`

**Interfaces:**

- Produces: an `activity-detail` surface whose path is resolved at run time by
  `resolveActivityDetailPath(page)`, consumed by `main()`'s capture loop.

The activity id is a UUID that differs per database, so the surface cannot be a
literal path. `resolveCoachThreadPath` (`scripts/verify-surfaces.ts:1058`) is
the established pattern for exactly this, and its hard-won lesson applies:
**resolve through the UI, then navigate and prove the rendered DOM is the state
you wanted before capturing it.** That resolver went through three attempts
because DOM order kept selecting a plausible-looking wrong thread.

- [ ] **Step 1: Write the resolver**

Insert next to `resolveCoachThreadPath`:

```typescript
/**
 * Resolve a real activity detail path. The id is a per-database UUID, so
 * this cannot be a literal SURFACES entry.
 *
 * Resolves through /train?tab=history — the list that links to detail pages
 * — then PROVES the resolved page rendered the detail view before handing
 * the path back, the same discipline resolveCoachThreadPath earned across
 * three wrong threads. An activity with no cached streams renders
 * StreamDataEmpty instead of charts, which is a legitimate state but not
 * the one this surface exists to audit, so the check below demands the
 * charts.
 */
async function resolveActivityDetailPath(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/train?tab=history`, {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  const href = await page
    .locator('a[href^="/activity/"]')
    .first()
    .getAttribute("href", { timeout: 10_000 });
  if (!href) {
    throw new Error(
      'no a[href^="/activity/"] link on /train?tab=history — the seeded ' +
        "activities are missing. Run scripts/seed-demo.ts against the " +
        "target database first."
    );
  }

  await page.goto(`${BASE_URL}${href}`, {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  const charts = await page.locator("[data-stream-chart]").count();
  if (charts === 0) {
    throw new Error(
      `${href} rendered no [data-stream-chart]. activity_streams is empty ` +
        "for this activity, so getOrFetchActivityDetail fell back to " +
        "intervals.icu, which dev has no credentials for. Seed streams " +
        "(Task 3) before capturing this surface — otherwise it audits " +
        "StreamDataEmpty and reports a number for a page that is not the " +
        "one this surface names."
    );
  }
  return href;
}
```

- [ ] **Step 2: Give `StreamChart` the marker the resolver asserts on**

`src/components/activity/stream-chart.tsx` renders an `<svg>` with no stable
hook. Add `data-stream-chart` to its root element. This is a test seam, and it
is the same shape as `data-chat-thread`, which `history-panel.tsx` gained in
slice 4 for the identical reason.

- [ ] **Step 3: Register the surface and wire the resolver**

`activity-detail` cannot go in `SURFACES` as a literal. Follow how
`coach-thread` is handled in `main()` — it is captured after the `SURFACES`
loop, using its resolver's return value. Add the same for `activity-detail`,
and add its entry to the axe report so a skipped or failed capture still
produces a row rather than vanishing (see `AxeReportEntry`'s `skipped`/`error`
fields and the comment at `scripts/verify-surfaces.ts:~380` explaining why a
surface's entry must always exist).

- [ ] **Step 4: Run it and confirm the page is the right one**

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3200 npm run verify:surfaces -- v0107-activity 2>&1 | grep -i activity
```

Expected: `activity-detail-*.png` exists. **Open
`.screenshots/v0107-activity/activity-detail-dark-desktop.png` and confirm it
shows stream charts and a laps table**, not the empty state. If Task 3 has not
run yet, the resolver throws by design — that is the check working.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-surfaces.ts src/components/activity/stream-chart.tsx
git commit -m "test(activity): capture the detail page nobody had ever opened

SURFACES mapped activity-log to /activity/log, which renders only the
manual-entry form — so the page an athlete actually opens a ride on has
never been photographed or axe-audited. Its render chain is six
components carrying 27 arbitrary type sizes, 20 of them below the 12px
floor, down to text-[8.5px]. Same gap slice 2 closed for Train's tabs,
slice 3 for Body's, slice 4 for Coach's thread and slice 5 for
Settings' collapsed sections."
```

### Task 2: Capture the debrief sheet

**Files:**

- Modify: `scripts/verify-surfaces.ts` — `SURFACES`

**Interfaces:**

- Consumes: `resolveActivityDetailPath`'s activity id (Task 1), reused to build
  the sheet's deep link.

`SheetHost` renders the debrief sheet for `?sheet=debrief&activity=<id>`
(`src/components/today/sheet-host.tsx`). With no `activity` param it looks for
an activity whose `debriefState` is `"pending"`, and every seeded row has NULL
— so the explicit id is the reliable form and does not depend on Task 3's
`debriefState` seeding landing first.

- [ ] **Step 1: Add the surface**

The sheet is reachable from Today, which is where `SheetHost` lives. Capture it
there, so the surface also covers the Today render chain the sheet sits in:

```typescript
  // The debrief sheet, which no capture has ever opened. It is a <Sheet>,
  // closed on load, reached only by ?sheet=debrief — so slice 1 declared
  // Today clean in v0.100.0 without it ever having been rendered, and
  // slice 6 inherits it. debrief-sheet.tsx is the largest single offender
  // in Activity's chain (11 arbitrary sizes, 17 ad-hoc alphas, 15 bare
  // whites) and is shared between Today and /activity/[id].
  //
  // Deep-linked with an explicit activity id rather than bare
  // ?sheet=debrief: SheetHost's no-id path looks for debriefState
  // "pending", which is NULL on every seeded row.
  "debrief-sheet": "/?sheet=debrief&activity=<resolved>",
```

`<resolved>` is not a literal — wire it the same way as `activity-detail` in
Task 1, from the resolver's id.

- [ ] **Step 2: Confirm the sheet actually opened**

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3200 npm run verify:surfaces -- v0107-activity 2>&1 | grep -i debrief
```

Then **open `.screenshots/v0107-activity/debrief-sheet-dark-desktop.png` and
confirm a sheet is on screen with the activity's name and metrics in it.** A
screenshot of Today with no sheet is the failure this step exists to catch —
and it is exactly what slice 5's `settings-connect-errors` did for a whole
release before anyone looked.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-surfaces.ts
git commit -m "test(debrief): open the sheet Today and Activity both hide

debrief-sheet.tsx is imported by today/sheet-host.tsx and by
/activity/[id], and it is a sheet — closed on load, reached only by
?sheet=debrief. So slice 1 signed Today off as clean in v0.100.0
without this component ever having been rendered to a camera or an axe
audit. It carries 11 arbitrary type sizes and 15 bare text-white/bg-white
that no guard pattern matches."
```

### Task 3: Seed the states the detail page needs

**Files:**

- Modify: `scripts/seed-demo.ts`

**Interfaces:**

- Produces: `activity_streams` rows for at least one activity, so
  `getOrFetchActivityDetail` returns cached streams instead of attempting an
  intervals.icu fetch dev cannot make.

**Read `scripts/seed-demo.ts`'s existing idempotency style first** — it is
re-runnable and guards its inserts; match how it does that. v0.105.0's Task 3
added the Settings seeding to this same file and is the closest example.

`activity_streams` (`src/lib/db/schema.ts`) is
`{ activityId, type, data }` with a unique index on `(activityId, type)`.
`src/lib/activity-streams.ts` reads these types: `time`, `heartrate`, `watts`,
`velocity`, `altitude`, and **laps under `type: "intervals"`** (`LAPS_TYPE`).

- [ ] **Step 1: Read the reader before writing the writer**

```bash
grep -n "LAPS_TYPE\|fromRows\|ActivityLap" src/lib/activity-streams.ts | head -20
```

Write the seeded `data` payloads against the shapes `fromRows` actually parses
— do not assume. `ActivityLap`'s fields are declared in that file.

- [ ] **Step 2: Seed streams for the most recent activity**

Generate plausible series rather than constants: a flat line makes
`StreamChart` render a degenerate chart (`nums.length < 2` returns null, and a
zero range is clamped to 1), which would photograph as a straight line and
prove nothing about the component. Seed `time`, `heartrate`, `watts`,
`velocity` and `altitude` with ~300 points of varying values, plus an
`intervals` row holding 3–5 laps.

- [ ] **Step 3: Set one activity's `debriefState` to `"pending"`**

So `?sheet=debrief` with no id also resolves, and Today's own pending-debrief
path becomes reachable. This is a one-column update on the same activity.

- [ ] **Step 4: Re-seed and confirm the counts moved**

```bash
# .env already names the dev database (5434); do not override it here.
set -a; . ./.env; set +a
SEED_DEMO=1 DEMO_EMAIL="$OWNER_EMAIL" npm run db:seed-demo
docker exec recover-db-1 psql -U recover -d recover -tAc "
select 'streams', count(*) from activity_streams
union all select 'pending_debrief', count(*) from activities where debrief_state='pending';"
```

Expected: `streams` ≥ 6, `pending_debrief` ≥ 1.

- [ ] **Step 5: Confirm the UI changed, not just the table**

Re-run the capture and open
`.screenshots/v0107-activity/activity-detail-dark-desktop.png`. The charts and
laps table must be on screen. **A row count alone does not prove the seeding
reached the UI** — that is the step v0.105.0's plan called out by name.

- [ ] **Step 6: Five green checks and commit**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
set -a; . ./.env; set +a; npx vitest run
git add scripts/seed-demo.ts
git commit -m "feat(seed): give the activity detail page its populated states

activity_streams was empty on every seeded database, so
getOrFetchActivityDetail fell through to an intervals.icu fetch dev has
no credentials for and the detail page could only ever render
StreamDataEmpty. Same fix slice 4 made for the coach inbox and slice 5
for the six connector cards."
```

### Task 4: Record the honest baseline, then decide the split

- [ ] **Step 1: Full capture run**

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3200 npm run verify:surfaces -- v0107-activity 2>&1 | tail -40
```

- [ ] **Step 2: Extract the per-surface numbers — counting NODES, not rules**

```bash
python3 - <<'PY'
import json
d = json.load(open(".screenshots/v0107-activity/axe-report.json"))
es = d if isinstance(d, list) else d.get("entries", d.get("results", []))
def nodes(x):
    if isinstance(x, int): return x
    return sum(len(r.get("nodes", [])) if isinstance(r, dict) else 1 for r in (x or []))
agg = {}
for e in es:
    s = e["surface"]; a = agg.setdefault(s, {"conf":0,"rules":0,"aud":0,"skip":0})
    if e.get("skipped"): a["skip"] += 1; continue
    a["aud"] += 1
    a["conf"] += nodes(e.get("confirmed"))
    a["rules"] += len(e.get("confirmed") or [])
for s, v in sorted(agg.items(), key=lambda kv: -kv[1]["conf"]):
    print(f"{s:26} nodes={v['conf']:>4} rules={v['rules']:>3} audited={v['aud']} skipped={v['skip']}")
PY
```

**`confirmed` is a list of rule objects, each holding its own `nodes` array.**
Taking `len(confirmed)` counts rules and under-reports badly — it reported
`admin` as 4 when it was 208 during v0.106.0, and that wrong number reached the
CHANGELOG and the roadmap before it was caught. Count nodes. Also assert
`skipped == 0`: a skipped combo has no `confirmed` key and scores 0, which is
indistinguishable from a clean pass.

- [ ] **Step 3: Write the finding into this plan and take the scope decision**

Record the numbers under a new "Phase A result" heading, then apply the rule
agreed before starting, which is slice 5's rule unchanged:

- **Total confirmed < 30** → phase B continues in this same release, v0.107.0.
- **Total confirmed ≥ 30** → **phase A ships alone as v0.107.0** and the
  redesign becomes v0.108.0. Precedent: slice 5 split at 86.

State the decision and the number that drove it. Do not carry it in your head —
the roadmap has now been wrong three times from summarising counts from memory,
most recently in v0.106.0's own release notes.

- [ ] **Step 4: Update `docs/axe-baseline-2026-08-11-seeded.md`**

Append a section recording that `activity-log`'s 46 was measured against the
manual-entry form alone, give the new per-surface numbers for
`activity-detail` and `debrief-sheet`, and state that Today's slice-1 clean
verdict never included the debrief sheet.

---

## Phase B — the redesign

**Scope confirmed by Task 4, not before.** The work itself, in the order slices
1–5 used:

1. Tokenise the type scale: 27 arbitrary sizes to the seven-step scale, with the
   20 sub-floor values **deleted or restated** rather than shrunk. `text-[8.5px]`
   and `text-[9px]` are the smallest this release has met; expect at least one
   editorial cut.
2. Tokenise the ink: 54 ad-hoc alphas onto the four-step ramp, **and the 50 bare
   `text-white`/`bg-white` no guard sees** — the largest single class here.
3. Tokenise the 13 default-scale utilities in `activity-log-form.tsx`, the
   standard slices 1–5 set (Coach, Body, Train and Settings all end at zero).
4. Give any tone colours a light expression. `stream-chart.tsx` is called with
   literal hex colours from `[id]/page.tsx` (`#f87171` heart rate, `#a78bfa`
   power) — chart colours are waived from the text floor by name in
   `tests/type-scale-guard.test.ts`, so confirm which side of that line these
   fall on before minting tokens for them.
5. Drive confirmed axe to zero across `activity-log`, `activity-detail` and
   `debrief-sheet`.
6. Re-pin the guard ceilings (`OFFENDER_CEILINGS`, currently **52** and **127**)
   and tick the roadmap.

**Carried in, to close in whichever slice reaches it:**

- **Today's two light-only nodes** — a raw `text-white` readiness sentence,
  recorded in `docs/axe-baseline-2026-08-11-seeded.md` for the slice 9 sweep.
  This slice migrates `debrief-sheet.tsx`, which Today also renders, so Today's
  number will move; re-measure it rather than assume.
- **`src/components/ui/inline-markdown.tsx:31`'s `text-[0.95em]`** — a relative
  em with no fixed-step equivalent, deliberately left since slice 4.
- **Two false comments shipped in v0.106.0** — `notifications-card.tsx:155` and
  `body-prefs-card.tsx:145` claim the accent swap is "byte-identical" to
  `bg-emerald-500`; Tailwind v4 ships that as `oklch(69.6% 0.17 162.48)` against
  `--accent`'s `#10b981`. One line each, fix on next touch.

## Self-review

- **Spec coverage.** Type scale → phase B item 1; ink ramp → items 2–3;
  surfaces → the class mapping slices 1–5 established, reused verbatim; tone
  colours with a light expression → item 4; confirmed axe to zero → item 5;
  guard re-pin → item 6. Phase A's four tasks cover the spec's "verified in a
  real browser" requirement, which is the part that has caught something in
  every slice so far.
- **Placeholders.** Three steps deliberately say "read the file first" rather
  than carry code — Task 1 Step 3's `main()` wiring, Task 3 Step 1's stream
  payload shapes, and Task 3 Step 2's `ActivityLap` fields — because inventing
  a shape the reader does not parse is worse than naming the check. Everything
  else carries its actual content.
- **Type consistency.** `resolveActivityDetailPath(page: Page): Promise<string>`
  is declared in Task 1 and consumed under that name in Task 2. The
  `data-stream-chart` marker is added in Task 1 Step 2 and asserted in Task 1
  Step 1's resolver.
- **Numbers.** Every count came from a grep or a query run on 2026-08-17, not
  from a predecessor document. `activity-log`'s 46 was re-derived with
  node-counting after v0.106.0's counting bug and matches the baseline exactly.
