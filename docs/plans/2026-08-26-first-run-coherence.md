# First-Run Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Train, Body and Coach speak the same first-run language as
Today, so a new athlete who clicks around before connecting anything always
gets told what is missing and how to fix it — instead of four different
flavours of nothing.

**Architecture:** One exported predicate replaces an inline condition in
`src/app/page.tsx`. Three tabs render the house `<Unavailable full>` with
`kind: "missing_input"` and a `fix` link back to Today. No new mechanism is
built: `src/lib/uncertainty.ts` and `src/components/ui/unavailable.tsx`
already do all of it. Plus the capture coverage that has never existed for a
dataless account.

**Tech Stack:** TypeScript, Next.js App Router (server components), vitest,
Playwright (surface capture), prettier.

**Spec:** `docs/specs/2026-08-26-first-run-coherence-design.md`

## Global Constraints

- **First-run is gated on no connection AND no wellness — and "no wellness"
  means EVER, not recently.** See the correction below; this is the single
  most important requirement in the plan.
- **The negative direction matters more than the positive one.** An
  established athlete viewing an empty range must keep today's wording. "Not
  enough readings in this range yet" is CORRECT for someone with a gap in a
  30-day window. Every task that changes an empty state must test both
  directions, and the reviewer should attack the negative one hardest.
- **Build no new empty-state mechanism.** Use `<Unavailable full>` and
  `src/lib/uncertainty.ts`'s existing `missing_input` + `fix` shape. Phase 2b
  spent a release collapsing six "we don't know" dialects into one; adding a
  seventh would undo it.
- **Do not redesign Today's welcome card.** Its gate is corrected (below); its
  markup and copy are not touched.
- **Every `fix` link points to `/`** — Today, where the three data paths live.
- **Prettier is enforced.** `npx prettier --write` on every file touched, then
  `npm run format:check`.
- DB-gated tests need:
  `DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef BETTER_AUTH_URL=http://localhost:3200`

---

## A correction to the spec, found while planning

The spec says first-run means "no connection and no wellness rows at all".
Today's existing gate does **not** mean that. `src/app/page.tsx:118-124`
queries wellness with `gte(schema.wellnessDaily.date, daysAgo(90))`, so
`wellness.length === 0` at line 280 means **"no wellness in the last 90
days"**.

Those differ for a real athlete: someone who logged for a year, stopped, and
returns 100 days later currently gets the welcome card as though they were
new.

**Ruling, carried into Task 1:** the shared predicate means **no wellness
ever** — a `count`, not the windowed list. It is the stricter, safer reading
and the one D2's safety argument depends on. **Today adopts the shared
predicate too**, which is a small behaviour change to Today: a long-absent
athlete stops being shown the welcome card. That is a correction, not a
redesign, and D5 ("do not touch the welcome card") binds its markup and copy,
not the correctness of its gate.

If Today kept its 90-day gate while the other tabs used "ever", a returning
athlete would see the welcome on Today and normal empty states elsewhere —
which is precisely the incoherence this strand exists to remove.

---

## File Structure

| Path                                          | Responsibility                                                     |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/first-run.ts` (new)                  | The predicate. One source of truth for "this athlete has nothing". |
| `src/lib/first-run.test.ts` (new)             | Its unit tests, both directions.                                   |
| `src/app/page.tsx`                            | Uses the predicate instead of its inline condition.                |
| `src/app/train/page.tsx`                      | First-run branch.                                                  |
| `src/app/body/page.tsx`                       | First-run branch; suppresses the per-card repetition.              |
| `src/components/body/baseline-trend-card.tsx` | Accepts a prop letting the page silence its own empty message.     |
| `src/app/coach/page.tsx`                      | First-run branch ahead of the LLM-key wall.                        |
| `scripts/seed-fresh-owner.ts` (new)           | A dataless owner, for capture.                                     |
| `scripts/verify-surfaces.ts`                  | Four `first-run-*` surfaces.                                       |
| `.github/workflows/surfaces.yml`              | A second capture pass against the dataless account.                |

---

### Task 1: The predicate

**Files:**

- Create: `src/lib/first-run.ts`, `src/lib/first-run.test.ts`

**Interfaces:**

- Produces: `export async function isFirstRun(userId: string): Promise<boolean>`
  — **Tasks 2–5 all call this exact name.**

- [ ] **Step 1: Write the failing tests**

Create `src/lib/first-run.test.ts`. These are DB-gated; follow the
`describe.skipIf(!hasDb)` pattern used across this repo (see
`src/lib/race/service.test.ts` for the exact import/teardown shape to copy).

```ts
describe.skipIf(!hasDb)("isFirstRun", () => {
  it("is true for an owner with no connection and no wellness", async () => {
    // seed a bare user, nothing else
    expect(await isFirstRun(BARE_USER)).toBe(true);
  });

  it("is false once any connection exists, even with no wellness", async () => {
    // seed a user + one connections row (status "active")
    expect(await isFirstRun(CONNECTED_USER)).toBe(false);
  });

  it("is false once any wellness row exists, even with no connection", async () => {
    // seed a user + one wellnessDaily row
    expect(await isFirstRun(LOGGED_USER)).toBe(false);
  });

  it("is false for wellness OLDER than 90 days — 'ever', not 'recently'", async () => {
    // seed a user + one wellnessDaily row dated 200 days ago, no connection.
    // This is the case Today's old inline gate got wrong: it windowed to 90
    // days, so a returning athlete was treated as brand new.
    expect(await isFirstRun(RETURNING_USER)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3200 npx vitest run src/lib/first-run.test.ts
```

Expected: FAIL — `src/lib/first-run` does not exist.

- [ ] **Step 3: Implement**

```ts
/**
 * Has this athlete got nothing at all yet?
 *
 * One source of truth for the first-run question, because four surfaces now
 * ask it. The same "one resolver, not two" reasoning as resolveFtpAnchor().
 *
 * "No wellness" means EVER, not recently. src/app/page.tsx used to decide
 * this inline against a 90-day window, which treated an athlete who logged
 * for a year, stopped, and came back as brand new. Counting all of history
 * is the stricter reading, and it is what makes the first-run treatment safe
 * to show: it can never tell an established athlete to go connect a device.
 */
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export async function isFirstRun(userId: string): Promise<boolean> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });
  if (connection) return false;

  const anyWellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    columns: { id: true },
  });
  return anyWellness == null;
}
```

If `wellnessDaily` has no `id` column, use whatever its primary key is —
check `src/lib/db/schema.ts` and adjust the `columns` allowlist; the point is
to avoid selecting the whole row.

- [ ] **Step 4: Run them, confirm they pass**

Same command as Step 2. Expected: PASS, 4 tests.

- [ ] **Step 5: Mutation-check the "ever" semantics**

Per `docs/RELEASING.md` step 3. Change the wellness query to window on the
last 90 days (`gte(schema.wellnessDaily.date, daysAgo(90))`), re-run, and
confirm the "older than 90 days" test FAILS. Revert. If it still passes, that
test cannot tell the two readings apart and is not pinning the ruling — fix
the fixture so its row is genuinely older than the window.

- [ ] **Step 6: Commit**

```bash
git add src/lib/first-run.ts src/lib/first-run.test.ts
git commit -m "feat(first-run): one predicate for 'this athlete has nothing yet'

Counts wellness across all of history, not a 90-day window: the inline
condition in page.tsx treated a returning athlete as brand new."
```

---

### Task 2: Today uses the predicate

**Files:**

- Modify: `src/app/page.tsx:280` (the `if (!connection && wellness.length === 0)` branch)

**Interfaces:**

- Consumes: `isFirstRun` from `@/lib/first-run` (Task 1).

- [ ] **Step 1: Replace the inline condition**

In `src/app/page.tsx`, add the import and call the predicate before the
onboarding branch:

```ts
import { isFirstRun } from "@/lib/first-run";
```

Replace `if (!connection && wellness.length === 0) {` with:

```ts
  // The shared predicate, not an inline condition — three other tabs now ask
  // the same question, and this one used a 90-day window that treated a
  // returning athlete as new. See src/lib/first-run.ts.
  if (await isFirstRun(user.id)) {
```

**Change nothing inside the branch.** The welcome card's markup and copy are
explicitly out of scope; only the condition guarding it changes.

- [ ] **Step 2: Typecheck and run Today's tests**

```bash
npm run typecheck && npx vitest run src/app
```

Expected: PASS. If a test asserted the welcome card for an athlete with
wellness older than 90 days, it encoded the old windowed behaviour — update
it and **say so explicitly in your report**, because that is a real behaviour
change, not a test tidy-up.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor(today): use the shared first-run predicate"
```

---

### Task 3: Train's first-run branch

**Files:**

- Modify: `src/app/train/page.tsx`
- Modify: `src/components/train/plan-empty.test.tsx` (or add a page-level test)

**Interfaces:**

- Consumes: `isFirstRun` (Task 1).

- [ ] **Step 1: Write the failing test**

Train's existing empty state is `components/train/plan-empty.tsx:11` — "No
plan yet — generate one from a race goal, or plan just this week." That
wording is correct for an established athlete between seasons and **must
survive**. Add a test asserting both directions. Match the render helper
already used in `src/components/train/plan-empty.test.tsx`:

```ts
it("first-run shows a way back to the data paths", async () => {
  // render Train for an athlete where isFirstRun is true
  expect(html).toMatch(/Connect a device|add your first/i);
  expect(html).toContain('href="/"');
});

it("an established athlete between seasons keeps today's wording", async () => {
  // isFirstRun false, but no plan
  expect(html).toContain(
    "No plan yet — generate one from a race goal, or plan just this week."
  );
  expect(html).not.toMatch(/Connect a device/i);
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
npx vitest run src/components/train/
```

Expected: FAIL — first-run currently renders the same "No plan yet" wording.

- [ ] **Step 3: Add the branch**

In `src/app/train/page.tsx`, before the existing plan-empty path, render the
house component when first-run:

```tsx
{firstRun ? (
  <Unavailable
    full
    state={{
      kind: "missing_input",
      needs: "wellness data before it can plan your week",
      fix: { label: "Connect a device or log manually", href: "/" },
    }}
  />
) : (
  /* the existing PlanEmpty path, unchanged */
)}
```

Import `Unavailable` from `@/components/ui/unavailable` and compute `firstRun`
with `await isFirstRun(userId)` alongside the page's existing queries.

- [ ] **Step 4: Run the tests, confirm both pass**

```bash
npx vitest run src/components/train/ src/app
```

Expected: PASS both directions.

- [ ] **Step 5: Commit**

```bash
git add src/app/train/page.tsx src/components/train/
git commit -m "feat(train): first-run routes back to the data paths"
```

---

### Task 4: Body's first-run branch and the four-fold repetition

The clearest defect in the strand: a dataless Body screen currently says the
same thing four times.

**Files:**

- Modify: `src/app/body/page.tsx:371`
- Modify: `src/components/body/baseline-trend-card.tsx:88-92`
- Modify: `src/components/body/baseline-trend-card.test.tsx`

**Interfaces:**

- Consumes: `isFirstRun` (Task 1).
- Produces: `BaselineTrendCard` gains an optional prop
  `suppressEmptyMessage?: boolean` — **default `false`, so every existing
  caller is unchanged.**

- [ ] **Step 1: Write the failing tests**

```ts
it("still says 'not enough readings' by default", () => {
  // existing behaviour, unchanged — an established athlete with a gap in
  // the selected range. This is the assertion that protects them.
  expect(html).toContain("Not enough readings in this range yet.");
});

it("falls silent when the page has already said it", () => {
  // suppressEmptyMessage
  expect(html).not.toContain("Not enough readings in this range yet.");
});
```

Plus a page-level test that a first-run Body renders exactly **one** absence
statement:

```ts
it("says it once on first run, not four times", async () => {
  const matches = html.match(/Not enough readings|No wellness readings/g) ?? [];
  expect(matches).toHaveLength(0); // the first-run panel replaces them all
  expect(html).toContain('href="/"');
});
```

- [ ] **Step 2: Run them, confirm they fail**

```bash
npx vitest run src/components/body/
```

- [ ] **Step 3: Implement**

In `baseline-trend-card.tsx`, gate the existing message (lines 88-92):

```tsx
{nums.length < 2 ? (
  suppressEmptyMessage ? null : (
    <p className="py-6 text-center text-caption text-ink-muted">
      Not enough readings in this range yet.
    </p>
  )
) : (
```

In `src/app/body/page.tsx`, when first-run, render the house component in
place of the trends section rather than the three cards plus the page-level
`message="No wellness readings in this range yet."` at line 371:

```tsx
<Unavailable
  full
  state={{
    kind: "missing_input",
    needs: "HRV and resting heart rate readings",
    fix: { label: "Connect a device or log manually", href: "/" },
  }}
/>
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run src/components/body/ src/app
```

- [ ] **Step 5: Commit**

```bash
git add src/app/body/page.tsx src/components/body/
git commit -m "feat(body): one absence statement on first run, not four"
```

---

### Task 5: Coach's wall becomes a door

**Files:**

- Modify: `src/app/coach/page.tsx`
- Modify: `src/components/coach/chat-interface.tsx:327` (only if the branch must move)
- Modify: `src/components/coach/chat-interface.test.tsx`

**Interfaces:**

- Consumes: `isFirstRun` (Task 1).

- [ ] **Step 1: Write the failing test**

The existing message — "The AI coach needs an LLM key to work. Add your
Anthropic API key or configure a local Ollama endpoint in Settings." — is
**correct and must survive** for an established athlete who has data but no
key. Only the first-run case changes.

```ts
it("keeps the LLM-key message for an athlete with data but no key", () => {
  expect(html).toContain("needs an LLM key");
});

it("first-run points at the data paths, not just the key", async () => {
  expect(html).toContain('href="/"');
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
npx vitest run src/components/coach/
```

- [ ] **Step 3: Add the branch**

In `src/app/coach/page.tsx`, when first-run, render the house component ahead
of the chat interface:

```tsx
<Unavailable
  full
  state={{
    kind: "missing_input",
    needs: "some training data before the coach has anything to talk about",
    fix: { label: "Connect a device or log manually", href: "/" },
  }}
/>
```

Leave `chat-interface.tsx:327`'s LLM-key branch exactly as it is — it is the
right message for its own case.

- [ ] **Step 4: Run the tests, confirm both pass**

```bash
npx vitest run src/components/coach/ src/app
```

- [ ] **Step 5: Commit**

```bash
git add src/app/coach/page.tsx src/components/coach/
git commit -m "feat(coach): first-run offers a way in, not only a key"
```

---

### Task 6: Capture coverage for a dataless account

The task the spec calls non-negotiable. **No capture has ever photographed a
dataless account** — every surface seeds `seed-demo.ts` first — which is
exactly why the welcome card silently kept pre-redesign styling until a
whole-branch review caught it.

**Files:**

- Create: `scripts/seed-fresh-owner.ts`
- Modify: `scripts/verify-surfaces.ts`
- Modify: `.github/workflows/surfaces.yml`

**Interfaces:**

- Produces: surfaces `first-run-today`, `first-run-train`, `first-run-body`,
  `first-run-coach`.

- [ ] **Step 1: Write the seed script**

`scripts/seed-fresh-owner.ts` creates an owner with **no** connections and
**no** wellness. Follow `scripts/seed-owner.ts`'s shape (it creates the user
through the auth API rather than inserting directly). Read that file first
and copy its account-creation path exactly; do not hand-insert a users row,
because the password hash has to be produced the way Better Auth expects.

Give it a distinct email so it cannot collide with the demo owner — e.g.
`OWNER_EMAIL` with a `fresh-` prefix — and make the script refuse loudly if
that account already has wellness rows, since a polluted fixture would make
these surfaces silently capture the wrong state.

- [ ] **Step 2: Resolve the ordering constraint deliberately**

**This is the design decision the spec flagged, and it must be made
explicitly, not discovered.** The existing surfaces need an account WITH
data; these need one WITHOUT. They cannot share an athlete.

Pick one and say which in your report:

- **A second seeded user** plus a capture pass that signs in as them. Check
  how `verify-surfaces.ts` authenticates (it mints an `api_tokens` row per
  theme/viewport around line 118) and whether that generalises to a second
  account.
- **A separate capture pass** against a database seeded only with the fresh
  owner, run before the demo seeding.

Prefer whichever requires no change to how existing surfaces authenticate. If
both do, take the separate pass — a clash between the two fixtures is the
failure mode with the highest cost, and separate passes cannot clash.

- [ ] **Step 3: Add the four surfaces**

In `scripts/verify-surfaces.ts`, register `first-run-today` → `/`,
`first-run-train` → `/train`, `first-run-body` → `/body`, `first-run-coach` →
`/coach`, in the same `SURFACE_ROUTES` map the others use.

**Guard each one**, the way `train-race-pacing` guards on
`data-testid="race-pacing"`: a capture that reaches the page but not the
first-run state must fail loudly rather than file the wrong state under this
name. Add a `data-slot` or `data-testid` to the first-run panel in Tasks 3–5
if none exists, and assert it in a `SURFACE_PREPARE` entry.

- [ ] **Step 4: Wire the workflow**

In `.github/workflows/surfaces.yml`, add the fresh-owner seeding and the
capture pass chosen in Step 2. Follow the existing comment style around lines
105–128, which documents _why_ the seed order matters — that comment block
exists because `seed-confirmed-race.ts` and `seed-two-race.ts` collided, and
the same class of clash is what Step 2 is avoiding.

- [ ] **Step 5: Run the capture locally and OPEN THE PNGs**

Per `docs/RELEASING.md` step 8. `CONTRIBUTING.md` has the long form for
running a capture locally (seeded database, running server, Chromium).
Actually look at all four images. A first-run screen that renders but reads
badly is exactly what this strand exists to prevent, and no test will tell
you.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-fresh-owner.ts scripts/verify-surfaces.ts \
  .github/workflows/surfaces.yml
git commit -m "test(surfaces): capture the first-run state

No capture had ever photographed a dataless account, which is why the
welcome card kept pre-redesign styling until a review caught it."
```

---

### Task 7: Release bookkeeping

**Files:**

- Modify: `package.json`, `CHANGELOG.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Run everything CI runs**

```bash
npm run lint && npm run typecheck && node scripts/migrate.mjs \
  && npm run format:check && npm run build
```

Then the full suite with the DB env from Global Constraints. Expect the
baseline (2963 total) plus this branch's new tests.

- [ ] **Step 2: Confirm the mutation check ran**

Task 1 Step 5 specifies one. If it was skipped, run it now. A surviving
mutation is a finding — fix the test and name it in the CHANGELOG.

- [ ] **Step 3: Bump the version**

Check `main`'s current `package.json` first, then set the next minor.

- [ ] **Step 4: CHANGELOG entry**

Follow the voice of the neighbouring entries. It must cover: that onboarding
already existed on Today and this makes the other three tabs agree with it;
that Body said the same thing four times and now says it once; **the
behaviour change to Today** (a returning athlete with wellness older than 90
days is no longer shown the welcome card); and `### Migrations` — **none**,
no file added to `drizzle/`.

- [ ] **Step 5: ROADMAP entry**

Tick Phase 6's "First run and onboarding" item and describe what shipped,
matching the style of Phase 5's completed entries.

- [ ] **Step 6: Format, commit, push, open the PR**

```bash
npm run format:check
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): vX.Y.Z — first-run coherence"
git push -u origin <branch-name>
```

Wait for `ci.yml` and `surfaces.yml` green. **Open the new `first-run-*`
captures from the PR's own run** — this branch's whole point is four screens
nobody has ever photographed.

---

## Self-Review Notes

**Spec coverage.** D1 → Task 1. D2 → Task 1's tests plus the negative-direction
test in every one of Tasks 3–5. D3 → Tasks 3–5. D4 → Task 4. D5 → Task 2
changes only the condition, never the branch body. D6 → Task 6. The spec's
testing section → the both-directions tests throughout, plus Task 6.

**The spec correction** (90-day window vs. "ever") is documented in its own
section above rather than applied silently, because it carries a real
behaviour change to Today that a reviewer should see and can reject.

**Placeholder scan.** Task 6 Steps 2 and 3 deliberately leave a decision to
the implementer rather than pre-specifying it — which is not a placeholder:
the choice depends on how `verify-surfaces.ts` authenticates, the plan says
exactly what to check, gives a tie-break rule, and requires the choice be
named in the report. Task 1 Step 3 flags the `columns` allowlist may need
adjusting to the real primary key, with the reason.

**Type consistency.** `isFirstRun(userId: string): Promise<boolean>` is used
under that exact name in Tasks 2, 3, 4 and 5. `suppressEmptyMessage?: boolean`
appears only in Task 4. All four `fix` links use `href: "/"` per the Global
Constraints.

**Ordering.** Task 1 must precede 2–5. Task 6 must follow 3–5, because it
guards on markers those tasks introduce. Task 7 is last.
