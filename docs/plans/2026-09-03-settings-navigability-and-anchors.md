# Settings Navigability and Anchors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An athlete whose figures read "Low" because an anchor is unset is asked for it once, on Today, only if they do that sport — and every "Set it" link lands on the field itself rather than the top of a six-drawer page.

**Architecture:** Three independent pieces that meet at the deep link. (1) `missingAnchors()` — a new resolver beside `isFirstRun()`, answering "which anchors are unset AND relevant", sport-gated through `canonicalSport()`. (2) A Today block that renders it, dismissible, durable via one new `body_prefs` column. (3) Settings becomes predictable: badges name gaps, fields get ids so fragments work, Sessions leaves "Advanced / API" for its own "Security" section.

**Tech Stack:** Next.js 15 App Router (server components), Drizzle ORM + Postgres, Vitest (node env; `// @vitest-environment jsdom` opt-in per file), Tailwind v4, base-ui Collapsible.

**Spec:** `docs/specs/2026-09-03-settings-navigability-and-anchors-design.md`

## Global Constraints

- **Run `npx tsc --noEmit` after every task.** Vitest strips types; a green suite is not evidence the branch compiles. It has caught two things this week the suite did not.
- **Mutation-test every guard.** Break the thing the test names, confirm it goes red, revert. Two "tests" this week passed against their own mutation.
- **`lg:` is the only breakpoint this repo uses** for anything but the nav. Do not introduce `sm:`/`md:` without a stated reason; v0.133.0 fixed a cramped row by restructuring instead.
- **Never `git add -A`.** Another session may be editing this tree. Stage explicit paths, always.
- **Sport is never read raw.** `activities.sport` holds provider disciplines (`Ride`, `VirtualRide`, `GravelRide`). Always `canonicalSport(a.sport)`. A raw `sport = 'Bike'` comparison is silent, green, and wrong for every cyclist.
- **DB tests** follow `src/lib/first-run.test.ts`: `describe.skipIf(!hasDb)`, literal `test-*` user ids, full cleanup in `afterAll`. Local DB is `127.0.0.1:5434/recover`, `DATABASE_DRIVER=pg`.
- **Commit after every task**, explicit paths only.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/components/settings/body-prefs-card.tsx` | Modify: stable `id`/`htmlFor` per input | 1 |
| `src/app/settings/page.tsx` | Modify: section ids, honest badges, Security section | 2, 3, 4 |
| `src/app/settings/section-order.test.ts` | Modify: seven sections, deep-link assertions | 2, 4 |
| `scripts/verify-surfaces.ts` | Modify: `expandSettingsSections` click list | 4 |
| `src/lib/anchors-needed.ts` | **Create**: the resolver. One question, one module | 5 |
| `src/lib/anchors-needed.test.ts` | **Create**: DB-backed resolver tests | 5 |
| `src/lib/db/schema.ts` + `drizzle/0047_*.sql` | Modify/Create: `anchor_prompt_dismissed_at` | 6 |
| `src/app/settings/body-actions.ts` | Modify: `dismissAnchorPrompt()` | 6 |
| `src/components/today/anchor-prompt.tsx` | **Create**: the block | 7 |
| `src/components/today/anchor-prompt.test.tsx` | **Create**: render tests | 7 |
| `src/lib/today/block-order.ts` | Modify: `anchorPrompt` key in all three states | 7 |
| `src/app/page.tsx` | Modify: assemble and render the block | 7 |
| `src/lib/race/pacing.ts` | Modify: `ANCHOR_FIX` targets the field | 8 |
| `src/components/coach/chat-interface.tsx` | Modify: coach link targets its section | 8 |
| `docs/ROADMAP.md`, `docs/2026-08-26-ia-inventory.md` | Modify: migration count, strand note, struck finding | 9 |

---

### Task 1: Field ids in BodyPrefsCard

The prerequisite for every fragment link in Task 8. The card uses wrapping `<label className="block">` with **no `id` on any input**, so `#threshold-pace` currently targets nothing.

**Files:**
- Modify: `src/components/settings/body-prefs-card.tsx`
- Test: `src/components/settings/body-prefs-card.test.tsx` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: DOM ids `wake-time`, `sleep-target`, `max-hr`, `ftp-outdoor`, `ftp-indoor`, `threshold-pace`, `squat-1rm`, `bench-1rm`, `deadlift-1rm`, `ohp-1rm`. Task 8 links to `#threshold-pace` and `#ftp-outdoor`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BodyPrefsCard } from "./body-prefs-card";

const empty = {
  wakeTime: null, sleepNeedSecs: 28800, maxHr: null, ftpWatts: null,
  ftpWattsIndoor: null, thresholdPaceSecPerKm: null, squatOneRmKg: null,
  benchOneRmKg: null, deadliftOneRmKg: null, overheadPressOneRmKg: null,
};

describe("BodyPrefsCard field addressing", () => {
  // The anchor fix links land on a FIELD, not a page. Without ids the
  // fragment in `/settings?open=baselines#threshold-pace` targets nothing
  // and the athlete arrives at the top of the section, which is the defect
  // this whole change exists to fix.
  it("gives every anchor input a stable id its label points at", () => {
    const html = renderToString(<BodyPrefsCard {...empty} />);
    for (const id of ["threshold-pace", "ftp-outdoor", "ftp-indoor", "max-hr", "wake-time"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/settings/body-prefs-card.test.tsx`
Expected: FAIL — `id="threshold-pace"` not found.

- [ ] **Step 3: Add ids and htmlFor**

Convert each wrapping `<label className="block">` to a non-wrapping pair. Every field, same shape — this is the threshold-pace one:

```tsx
<div className="block">
  <label htmlFor="threshold-pace" className="label-micro mb-1 block">
    Threshold pace (sec/km)
  </label>
  <input
    id="threshold-pace"
    type="number"
    min={150}
    max={600}
    value={thresholdPace}
    onChange={(e) => setThresholdPace(e.target.value)}
    placeholder="e.g. 285"
    className={inputClass}
  />
</div>
```

Do the same for `wake-time` (the `type="time"` input), `sleep-target`, `max-hr`, `ftp-outdoor`, `ftp-indoor`, and the four 1RM inputs. Keep every existing class, `min`, `max`, `step`, `placeholder` and handler exactly as they are — this task changes addressing, nothing else.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/components/settings/body-prefs-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutation-test the guard**

Delete `id="threshold-pace"` from the input. Re-run — it MUST go red. Restore it.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/settings/body-prefs-card.tsx src/components/settings/body-prefs-card.test.tsx
git commit -m "Baseline fields get ids, so a fix link can land on one"
```

---

### Task 2: Section ids, so more than one section is addressable

`?open=` works and has exactly one caller. Only `baselines` carries an `id`. Task 8 needs `coach` too.

**Files:**
- Modify: `src/app/settings/page.tsx` (the AI & Coach `<Collapsible>`, ~line 455)
- Modify: `src/app/settings/section-order.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `/settings?open=coach#coach` opens and scrolls to AI & Coach. Task 8 uses it.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("settings sections")` block in `section-order.test.ts`:

```ts
  // Every section a fix link points at must be addressable. `baselines` was
  // the only one, and `chat-interface.tsx` sent "Configure AI Coach" to bare
  // /settings — six closed drawers, no indication which.
  it("makes every deep-linked section addressable", () => {
    for (const id of ["baselines", "coach"]) {
      expect(PAGE).toContain(`<Collapsible id="${id}"`);
      expect(PAGE).toContain(`defaultOpen={opened === "${id}"}`);
    }
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/settings/section-order.test.ts`
Expected: FAIL — `<Collapsible id="coach"` not found.

- [ ] **Step 3: Add the id**

In `src/app/settings/page.tsx`, the AI & Coach section:

```tsx
        {/* AI & Coach — addressable, because chat-interface.tsx sends an
            unconfigured coach here and "in Settings" is not a location. */}
        <Collapsible id="coach" defaultOpen={opened === "coach"}>
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/app/settings/section-order.test.ts`
Expected: PASS (all assertions in the file).

- [ ] **Step 5: Mutation-test**

Change `id="coach"` to `id="coach2"`. Re-run — MUST go red. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/settings/page.tsx src/app/settings/section-order.test.ts
git commit -m "A second settings section becomes addressable"
```

---

### Task 3: The badge names what is missing

`baselinesSummary` is built from `wakeTime · maxHr · ftpWatts` only. An athlete with FTP set and no threshold pace sees `FTP 250` — true, and it reads as done. This is the defect all three production users sit in.

**Files:**
- Modify: `src/app/settings/page.tsx:237-245`
- Create: `src/lib/settings/baselines-summary.ts`
- Create: `src/lib/settings/baselines-summary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `baselinesSummary(row: BaselinesRow | null | undefined): string`, where `BaselinesRow = { wakeTime, maxHr, ftpWatts, thresholdPaceSecPerKm }` with all fields `string | number | null`.

The logic moves out of the page into its own module so it can be tested without mocking Postgres — the same reasoning `section-order.test.ts` gives for reading source instead of rendering.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { baselinesSummary } from "./baselines-summary";

describe("baselinesSummary", () => {
  it("says nothing is set when nothing is", () => {
    expect(baselinesSummary(null)).toBe("not set");
  });

  it("states what IS set, so a closed section answers 'is this right?'", () => {
    expect(
      baselinesSummary({ wakeTime: "06:30", maxHr: 185, ftpWatts: 250, thresholdPaceSecPerKm: 285 })
    ).toBe("wake 06:30 · max HR 185 · FTP 250 · pace 4:45/km");
  });

  // THE POINT OF THIS MODULE. Every production user on 2026-09-02 was in
  // this state: an anchor set, the run anchor missing, and a badge that
  // read as finished. A summary listing only what is set is structurally
  // incapable of saying "not here".
  it("names the missing run anchor rather than reading as done", () => {
    expect(
      baselinesSummary({ wakeTime: null, maxHr: null, ftpWatts: 250, thresholdPaceSecPerKm: null })
    ).toBe("FTP 250 · no run pace");
  });

  it("names a missing FTP the same way", () => {
    expect(
      baselinesSummary({ wakeTime: null, maxHr: null, ftpWatts: null, thresholdPaceSecPerKm: 285 })
    ).toBe("pace 4:45/km · no FTP");
  });

  it("does not nag about both when neither is set — that is 'not set'", () => {
    expect(
      baselinesSummary({ wakeTime: "06:30", maxHr: null, ftpWatts: null, thresholdPaceSecPerKm: null })
    ).toBe("wake 06:30 · no FTP · no run pace");
  });

  it("formats pace as mm:ss/km, because sec/km is not a pace anyone reads", () => {
    expect(
      baselinesSummary({ wakeTime: null, maxHr: null, ftpWatts: null, thresholdPaceSecPerKm: 240 })
    ).toBe("pace 4:00/km · no FTP");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/settings/baselines-summary.test.ts`
Expected: FAIL — cannot resolve `./baselines-summary`.

- [ ] **Step 3: Implement**

```ts
/**
 * The badge on the collapsed "Your baselines" section.
 *
 * Built from what IS set AND what is missing, which is the whole change.
 * The old version listed `wakeTime · maxHr · ftpWatts` only, so an athlete
 * with FTP set and no threshold pace read "FTP 250" and stopped looking —
 * and on 2026-09-02 that was every user in production. A summary that can
 * only list present values can never say "not here", which is precisely the
 * answer that saves opening six drawers one at a time.
 *
 * Wake time and max HR are NOT reported as missing. They degrade gracefully
 * (no bedtime shown; unlabelled sessions count as easy time). The two
 * anchors do not: without them every race figure is Low by construction.
 */
export interface BaselinesRow {
  wakeTime: string | null;
  maxHr: number | null;
  ftpWatts: number | null;
  thresholdPaceSecPerKm: number | null;
}

/** Seconds per km → the mm:ss/km every runner actually reads. */
export function formatPace(secPerKm: number): string {
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

export function baselinesSummary(row: BaselinesRow | null | undefined): string {
  const set = [
    row?.wakeTime ? `wake ${row.wakeTime}` : null,
    row?.maxHr ? `max HR ${row.maxHr}` : null,
    row?.ftpWatts ? `FTP ${row.ftpWatts}` : null,
    row?.thresholdPaceSecPerKm
      ? `pace ${formatPace(row.thresholdPaceSecPerKm)}`
      : null,
  ].filter((p): p is string => p !== null);

  const missing = [
    row?.ftpWatts ? null : "no FTP",
    row?.thresholdPaceSecPerKm ? null : "no run pace",
  ].filter((p): p is string => p !== null);

  // Nothing at all set is "not set" — listing two absences on an empty
  // account states a gap the athlete has not yet had a chance to fill.
  if (set.length === 0) return "not set";

  return [...set, ...missing].join(" · ");
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/settings/baselines-summary.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into the page**

In `src/app/settings/page.tsx`, delete the inline `const baselinesSummary = [...]` block (lines ~237-245) and its comment, and replace with a call. Add the import beside the other `@/lib` imports:

```ts
import { baselinesSummary } from "@/lib/settings/baselines-summary";
```

```tsx
  // The figures the engine reads back. Names what is set AND what is not —
  // see the module header for why "FTP 250" alone was the defect.
  const baselines = baselinesSummary(bodyPrefsRow);
```

Then change the badge usage from `{baselinesSummary}` to `{baselines}` at the `Collapsible id="baselines"` trigger.

- [ ] **Step 6: Mutation-test the guard**

In `baselines-summary.ts`, delete the `missing` array from the returned join (`return set.join(" · ")`). Re-run — the "names the missing run anchor" test MUST go red. Restore.

- [ ] **Step 7: Typecheck, full suite, commit**

```bash
npx tsc --noEmit
npx vitest run src/app/settings src/lib/settings
git add src/lib/settings/baselines-summary.ts src/lib/settings/baselines-summary.test.ts src/app/settings/page.tsx
git commit -m "The baselines badge stops reading as done when it isn't"
```

---

### Task 4: Sessions leaves "Advanced / API" for "Security"

Inventory finding: *"'Advanced / API' holds Sessions, which is where an athlete signs other devices out. That is a security action, not an advanced one."*

**This is the riskiest edit in the plan, for a reason unrelated to users.** `section-order.test.ts` cross-checks the rendered labels against `expandSettingsSections`' hardcoded click list in `verify-surfaces.ts`. A section missing from that list does **not** fail loudly: it stays collapsed, the capture photographs a closed row, axe audits nothing inside it, and `settings-expanded` still passes. Both lists move in this commit.

**Files:**
- Modify: `src/app/settings/page.tsx` (Advanced section ~line 495; new section after it)
- Modify: `src/app/settings/section-order.test.ts`
- Modify: `scripts/verify-surfaces.ts` (`expandSettingsSections` label list)

**Interfaces:**
- Consumes: nothing.
- Produces: a seventh section labelled `Security`. Task 9 confirms it in a capture.

- [ ] **Step 1: Update the order test to the intended seven**

In `section-order.test.ts`, change the expected array:

```ts
    expect(renderedSections()).toEqual([
      "Integrations",
      "Your baselines",
      "AI & Coach",
      "Advanced / API",
      "Security",
      "App",
      "Data",
    ]);
```

Add a test recording why it exists:

```ts
  // Signing another device out is a security action, not an advanced one —
  // the IA inventory's finding (docs/2026-08-26-ia-inventory.md). Advanced
  // keeps tokens and webhooks, which really are for people wiring things up.
  it("keeps sessions out of Advanced, where a security control was buried", () => {
    const at = (needle: string) => PAGE.indexOf(needle);
    const sessions = at("<SessionsCard");
    const security = at("triggerLabelClass}>Security<");
    const app = at("triggerLabelClass}>App<");

    expect(security).toBeGreaterThan(-1);
    expect(sessions).toBeGreaterThan(security);
    expect(sessions).toBeLessThan(app);
    // And it is genuinely gone from Advanced, not merely duplicated.
    expect(at("triggerLabelClass}>Advanced / API<")).toBeLessThan(security);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/settings/section-order.test.ts`
Expected: FAIL — rendered sections are six, `Security` absent; and the "captured in full" test also fails because the script's list lacks it.

- [ ] **Step 3: Move the card and add the section**

In `src/app/settings/page.tsx`, remove `<SessionsCard sessions={activeSessions} />` from the Advanced panel, and add a new `<Collapsible>` immediately after the Advanced one closes:

```tsx
        {/* Security — Sessions was under "Advanced / API", which is where an
            athlete signs another device out. The IA inventory called that
            what it is: a security action filed under a label that predicts
            tokens and webhooks. A seventh row costs the 1.0-screen landing
            state almost nothing and buys a label that says what is behind
            it, which is the same argument the badges make one level down. */}
        <Collapsible>
          <CollapsibleTrigger
            badge={<span className={triggerBadgeClass}>{securitySummary}</span>}
          >
            <ShieldCheck aria-hidden className="size-[18px] text-ink-muted" />
            <span className={triggerLabelClass}>Security</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="hairline-list px-5 pb-3">
              <SessionsCard sessions={activeSessions} />
            </div>
          </CollapsiblePanel>
        </Collapsible>
```

Add `ShieldCheck` to the `lucide-react` import. Add the badge beside the other summaries, and drop sessions from `advancedSummary`:

```ts
  const advancedSummary = [
    `${apiTokens.length} ${apiTokens.length === 1 ? "token" : "tokens"}`,
    `${webhookSubscriptions.length} ${webhookSubscriptions.length === 1 ? "webhook" : "webhooks"}`,
  ].join(" · ");

  const securitySummary = `${activeSessions.length} ${
    activeSessions.length === 1 ? "session" : "sessions"
  }`;
```

- [ ] **Step 4: Update the capture script in the SAME commit**

In `scripts/verify-surfaces.ts`, find `expandSettingsSections`' hardcoded label list and add `"Security"` in DOM order, between `"Advanced / API"` and `"App"`.

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run src/app/settings/section-order.test.ts`
Expected: PASS — including "is captured in full" and "does not ask the script to open a section that no longer exists".

- [ ] **Step 6: Mutation-test the capture cross-check**

Remove `"Security"` from `verify-surfaces.ts`'s list only. Re-run — "is captured in full" MUST go red. Restore. **This is the silent failure the test exists for; confirm it is not silent.**

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/settings/page.tsx src/app/settings/section-order.test.ts scripts/verify-surfaces.ts
git commit -m "Signing a device out is a security control, not an advanced one"
```

---

### Task 5: The resolver — `missingAnchors()`

A second predicate beside `isFirstRun()`, not a widening of it. `isFirstRun` answers "has this athlete got nothing at all"; this answers "which anchors are unset **and** relevant to what they do".

**Files:**
- Create: `src/lib/anchors-needed.ts`
- Create: `src/lib/anchors-needed.test.ts`

**Interfaces:**
- Consumes: `canonicalSport` from `@/lib/canonical-sport`; `db`, `schema` from `@/lib/db`.
- Produces: `missingAnchors(userId: string): Promise<MissingAnchors>` where `MissingAnchors = { ftp: boolean; pace: boolean; dismissed: boolean }`. Task 7 renders it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { missingAnchors } from "./anchors-needed";

// requires Postgres; skips without DATABASE_URL. Same shape as first-run.test.ts.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const RUNNER = "test-anchors-runner";
const CYCLIST = "test-anchors-cyclist";
const ANCHORED = "test-anchors-anchored";
const DISMISSED = "test-anchors-dismissed";
const IDLE = "test-anchors-idle";
const ALL_USERS = [RUNNER, CYCLIST, ANCHORED, DISMISSED, IDLE];

function activity(userId: string, sport: string, externalId: string) {
  return {
    userId,
    provider: "intervals_icu" as const,
    externalId,
    startDate: new Date(),
    sport,
  };
}

describe.skipIf(!hasDb)("missingAnchors", () => {
  beforeAll(async () => {
    await db.insert(schema.users).values(
      ALL_USERS.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
      }))
    );
    await db.insert(schema.activities).values([
      activity(RUNNER, "Run", "a-run-1"),
      // THE GUARD: providers store "Ride", never "Bike". A resolver
      // comparing sport directly against the planner's vocabulary matches
      // nothing and the FTP prompt never fires for anyone who rides.
      activity(CYCLIST, "VirtualRide", "a-ride-1"),
      activity(ANCHORED, "Run", "a-run-2"),
      activity(DISMISSED, "Run", "a-run-3"),
    ]);
    await db.insert(schema.bodyPrefs).values([
      { userId: ANCHORED, thresholdPaceSecPerKm: 285, ftpWatts: 250 },
      { userId: DISMISSED, anchorPromptDismissedAt: new Date() },
    ]);
  });

  afterAll(async () => {
    for (const id of ALL_USERS) {
      await db.delete(schema.activities).where(eq(schema.activities.userId, id));
      await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
  });

  it("asks a runner with no pace for a pace, and not for an FTP", async () => {
    expect(await missingAnchors(RUNNER)).toEqual({
      ftp: false, pace: true, dismissed: false,
    });
  });

  // Reading `sport` raw would return ftp:false here and be green forever.
  it("asks a cyclist for an FTP even though the provider said VirtualRide", async () => {
    expect(await missingAnchors(CYCLIST)).toEqual({
      ftp: true, pace: false, dismissed: false,
    });
  });

  it("asks an anchored athlete for nothing", async () => {
    expect(await missingAnchors(ANCHORED)).toEqual({
      ftp: false, pace: false, dismissed: false,
    });
  });

  it("reports a dismissal without forgetting what is still missing", async () => {
    expect(await missingAnchors(DISMISSED)).toEqual({
      ftp: false, pace: true, dismissed: true,
    });
  });

  it("asks an athlete with no activity for nothing at all", async () => {
    expect(await missingAnchors(IDLE)).toEqual({
      ftp: false, pace: false, dismissed: false,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/anchors-needed.test.ts`
Expected: FAIL — cannot resolve `./anchors-needed` (and `anchorPromptDismissedAt` does not exist yet; Task 6 adds it. If the column blocks this task, do Task 6 first — they are adjacent on purpose).

- [ ] **Step 3: Implement**

```ts
/**
 * Which anchors is this athlete missing, that they actually need?
 *
 * A SECOND predicate beside isFirstRun(), deliberately not a widening of it.
 * isFirstRun() answers "has this athlete got nothing at all", and returns
 * false the moment a connection goes active — which is correct for its own
 * question and is exactly why nobody is ever asked for a number. Counted in
 * production on 2026-09-02: one user of three has a body_prefs row, and
 * NOBODY has a threshold pace, so every run figure is Low by construction.
 *
 * Widening isFirstRun() to demand anchors would put "Connect a device to
 * begin" in front of an athlete with 64 rides. Two questions, two resolvers.
 *
 * SPORT IS GATED, and that is the point rather than a refinement. Asking a
 * pure cyclist for a threshold pace is the same class of error as inventing
 * a wake time, which body_prefs' own schema comment records v0.9.0 removing.
 */
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { canonicalSport } from "@/lib/canonical-sport";

export interface MissingAnchors {
  /** Rides, and no athlete-set outdoor FTP. */
  ftp: boolean;
  /** Runs, and no threshold pace. */
  pace: boolean;
  /** Has said "not now" — the prompt stops, the badge does not. */
  dismissed: boolean;
}

export const NONE: MissingAnchors = {
  ftp: false,
  pace: false,
  dismissed: false,
};

export async function missingAnchors(userId: string): Promise<MissingAnchors> {
  const [prefs, activities] = await Promise.all([
    db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, userId),
      columns: {
        ftpWatts: true,
        thresholdPaceSecPerKm: true,
        anchorPromptDismissedAt: true,
      },
    }),
    // Sport only. The question is "does this athlete ride/run at all", so
    // history is not windowed — the same "ever, not recently" reading
    // isFirstRun() settled on, for the same reason: an athlete who ran all
    // last year and is building back still needs a threshold pace.
    db.query.activities.findMany({
      where: eq(schema.activities.userId, userId),
      columns: { sport: true },
    }),
  ]);

  const sports = new Set(activities.map((a) => canonicalSport(a.sport)));

  return {
    // ftpWattsIndoor deliberately does NOT satisfy this. Its schema comment
    // is explicit that it is a fallback anchor and "can never mean 'use it
    // for race day' directly" — which is the figure the prompt is about.
    ftp: sports.has("Bike") && prefs?.ftpWatts == null,
    pace: sports.has("Run") && prefs?.thresholdPaceSecPerKm == null,
    dismissed: prefs?.anchorPromptDismissedAt != null,
  };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/anchors-needed.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-test the sport guard — the important one**

Replace `canonicalSport(a.sport)` with `a.sport`. Re-run. The cyclist test MUST go red (`VirtualRide` never equals `Bike`). Restore. If it stays green, the test is worthless and the FTP prompt would never fire for a rider in production.

- [ ] **Step 6: Second mutation — the indoor fallback**

Change `prefs?.ftpWatts == null` to `prefs?.ftpWatts == null && prefs?.ftpWattsIndoor == null`. This should NOT change any test here; add a case if you want it guarded, or leave it — the module comment carries the reason. Restore either way.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/anchors-needed.ts src/lib/anchors-needed.test.ts
git commit -m "A second predicate: which anchors does this athlete actually need"
```

---

### Task 6: The dismissal column and action

**Files:**
- Modify: `src/lib/db/schema.ts` (`bodyPrefs`, after `thresholdPaceSecPerKm`)
- Create: `drizzle/0047_*.sql` (generated)
- Modify: `src/app/settings/body-actions.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/session`.
- Produces: column `body_prefs.anchor_prompt_dismissed_at` (`timestamp with time zone`, nullable); server action `dismissAnchorPrompt(): Promise<void>`. Task 7 calls it.

- [ ] **Step 1: Add the column**

In `src/lib/db/schema.ts`, inside `bodyPrefs`, after `thresholdPaceSecPerKm`:

```ts
  /**
   * v0.134: when the athlete said "not now" to the anchor prompt on Today.
   * null = never asked, or asked and not yet answered.
   *
   * Lives here rather than in a table of its own because the state is about
   * THIS ROW's own emptiness. A timestamp rather than a boolean because it
   * costs the same and answers "when" for free.
   *
   * CONSEQUENCE, recorded because a production count was run eight days
   * before this landed: dismissing CREATES a body_prefs row, so row
   * existence stops meaning "has set something". Any future count must read
   * the anchor columns, not `select count(*) from body_prefs`.
   */
  anchorPromptDismissedAt: timestamp("anchor_prompt_dismissed_at", {
    withTimezone: true,
  }),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0047_*.sql` containing `ALTER TABLE "body_prefs" ADD COLUMN "anchor_prompt_dismissed_at" timestamp with time zone;`

Read the generated SQL and confirm it is that one statement and nothing else. If drizzle-kit proposes a drop or a rename, stop — the schema and the DB have diverged and that is a different problem.

- [ ] **Step 3: Apply it locally**

Run: `npm run db:migrate`
Expected: applied cleanly against `127.0.0.1:5434/recover`.

- [ ] **Step 4: Add the server action**

Append to `src/app/settings/body-actions.ts`:

```ts
/**
 * "Not now" on the anchor prompt. Removes the NAG, never the INFORMATION:
 * the settings badge keeps naming the gap and every Low-confidence "Set it"
 * link keeps working, forever. Dismiss answers "stop asking me on Today",
 * not "tell me my numbers are fine".
 */
export async function dismissAnchorPrompt(): Promise<void> {
  const user = await requireUser();
  const dismissed = { anchorPromptDismissedAt: new Date() };
  await db
    .insert(schema.bodyPrefs)
    .values({ userId: user.id, ...dismissed })
    .onConflictDoUpdate({
      target: schema.bodyPrefs.userId,
      set: dismissed,
    });
  revalidatePath("/");
  revalidatePath("/settings");
}
```

- [ ] **Step 5: Confirm the round trip**

Run: `npx vitest run src/lib/anchors-needed.test.ts`
Expected: PASS — the `DISMISSED` case now has a real column to read.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/db/schema.ts drizzle/ src/app/settings/body-actions.ts
git commit -m "Somewhere to record 'not now'"
```

---

### Task 7: The prompt on Today

**Files:**
- Create: `src/components/today/anchor-prompt.tsx`
- Create: `src/components/today/anchor-prompt.test.tsx`
- Modify: `src/lib/today/block-order.ts`
- Modify: `src/lib/today/block-order.test.ts` (if the key list is asserted there)
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `MissingAnchors` from `@/lib/anchors-needed`; `dismissAnchorPrompt` from `@/app/settings/body-actions`.
- Produces: `<AnchorPrompt missing={MissingAnchors} />`, and the `BLOCK_ORDER` key `"anchorPrompt"`.

**The governing constraint:** `block-order.ts` declares *"REORDER, NEVER HIDE"* and `block-order.test.ts` enforces it. `anchorPrompt` is not moment-bound, so it does **not** belong in `MOMENT_ONLY` and **must** appear in all three state arrays. A two-state array fails the suite, correctly.

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AnchorPrompt } from "./anchor-prompt";

describe("AnchorPrompt", () => {
  it("renders nothing when no anchor is missing", () => {
    expect(
      renderToString(<AnchorPrompt missing={{ ftp: false, pace: false, dismissed: false }} />)
    ).toBe("");
  });

  // Dismiss removes the nag, not the information — the settings badge and
  // every "Set it" link keep working. This block is the only thing silenced.
  it("renders nothing once dismissed, even with an anchor still missing", () => {
    expect(
      renderToString(<AnchorPrompt missing={{ ftp: false, pace: true, dismissed: true }} />)
    ).toBe("");
  });

  it("asks a runner for a pace, and links to the field itself", () => {
    const html = renderToString(
      <AnchorPrompt missing={{ ftp: false, pace: true, dismissed: false }} />
    );
    expect(html).toContain("threshold pace");
    expect(html).toContain("/settings?open=baselines#threshold-pace");
    expect(html).not.toContain("FTP");
  });

  it("asks a cyclist for an FTP, and links to that field", () => {
    const html = renderToString(
      <AnchorPrompt missing={{ ftp: true, pace: false, dismissed: false }} />
    );
    expect(html).toContain("FTP");
    expect(html).toContain("/settings?open=baselines#ftp-outdoor");
    expect(html).not.toContain("threshold pace");
  });

  it("asks a duathlete for both in one block, not two stacked prompts", () => {
    const html = renderToString(
      <AnchorPrompt missing={{ ftp: true, pace: true, dismissed: false }} />
    );
    expect(html).toContain("FTP");
    expect(html).toContain("threshold pace");
    expect(html.match(/Not now/g) ?? []).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/today/anchor-prompt.test.tsx`
Expected: FAIL — cannot resolve `./anchor-prompt`.

- [ ] **Step 3: Implement the component**

```tsx
"use client";

import Link from "next/link";
import { useTransition } from "react";
import { dismissAnchorPrompt } from "@/app/settings/body-actions";
import type { MissingAnchors } from "@/lib/anchors-needed";

/**
 * The one place an athlete is asked for a number.
 *
 * isFirstRun() returns false the moment a connection goes active, so an
 * athlete who connected a device has never been asked for an anchor — and
 * in production on 2026-09-02, nobody had a threshold pace. Every run
 * figure was Low by construction and every "Set it" link landed on the top
 * of a six-drawer page.
 *
 * Sport-gated upstream in missingAnchors(): a cyclist is never asked for a
 * pace. Both gaps render as ONE block with one dismiss, because two stacked
 * prompts on Today is a nag rather than a question.
 */
const COPY = {
  pace: {
    noun: "threshold pace",
    href: "/settings?open=baselines#threshold-pace",
    why: "Your run figures are estimated from recent sessions rather than measured.",
  },
  ftp: {
    noun: "FTP",
    href: "/settings?open=baselines#ftp-outdoor",
    why: "Your ride targets fall back to a synced estimate rather than your own number.",
  },
} as const;

export function AnchorPrompt({ missing }: { missing: MissingAnchors }) {
  const [pending, startTransition] = useTransition();

  const gaps = [
    missing.pace ? COPY.pace : null,
    missing.ftp ? COPY.ftp : null,
  ].filter((g): g is (typeof COPY)["pace" | "ftp"] => g !== null);

  if (missing.dismissed || gaps.length === 0) return null;

  const nouns = gaps.map((g) => g.noun).join(" and a ");

  return (
    <div className="rounded-[20px] glass glass-no-hover p-4">
      <span className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
        Set your {gaps.length === 1 ? "anchor" : "anchors"}
      </span>
      <p className="mt-2 text-caption leading-relaxed text-ink-secondary">
        Recover has no {nouns} for you. {gaps.map((g) => g.why).join(" ")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {gaps.map((g) => (
          <Link
            key={g.noun}
            href={g.href}
            className="rounded-2xl bg-accent px-4 py-2 text-label font-bold text-accent-foreground transition-colors hover:bg-accent/90"
          >
            Set your {g.noun}
          </Link>
        ))}
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => startTransition(() => void dismissAnchorPrompt())}
          className="rounded-2xl px-4 py-2 text-label font-bold text-ink-muted transition-colors hover:text-ink-secondary disabled:opacity-60"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/components/today/anchor-prompt.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the block key to all three states**

In `src/lib/today/block-order.ts`, add `"anchorPrompt"` to `TodayBlockKey`, and place it in all three `BLOCK_ORDER` arrays directly after `"calibration"` (morning, post-session) and after `"calibration"` in evening too. Do **not** add it to `MOMENT_ONLY` — its subject is not a moment. Add the reasoning:

```ts
  // anchorPrompt sits beside calibration because both answer "why is this
  // number soft?" — calibration says "not enough history yet", this says
  // "no anchor to compute against". It renders null when nothing is
  // missing, so its place in every state costs an anchored athlete nothing,
  // the same argument dayLog and bedtime carry above.
```

- [ ] **Step 6: Run the ordering suite**

Run: `npx vitest run src/lib/today/block-order.test.ts`
Expected: PASS. If "every state shows every block" fails, the key is missing from a state array — that is the "REORDER, NEVER HIDE" rule doing its job. Fix the array, do not weaken the test.

- [ ] **Step 7: Wire it into the page**

In `src/app/page.tsx`, import the resolver and component, resolve it beside the other data, and add the slot:

```ts
import { missingAnchors } from "@/lib/anchors-needed";
import { AnchorPrompt } from "@/components/today/anchor-prompt";
```

```tsx
              anchorPrompt: <AnchorPrompt missing={anchors} />,
```

with `const anchors = await missingAnchors(user.id);` resolved alongside the existing awaits, **below** the `isFirstRun` early return so an athlete with nothing at all still gets the first-run treatment and never both.

- [ ] **Step 8: Mutation-test the dismiss guard**

In `anchor-prompt.tsx`, change `if (missing.dismissed || gaps.length === 0)` to `if (gaps.length === 0)`. Re-run — "renders nothing once dismissed" MUST go red. Restore.

- [ ] **Step 9: Typecheck, full suite, commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/today/anchor-prompt.tsx src/components/today/anchor-prompt.test.tsx src/lib/today/block-order.ts src/app/page.tsx
git commit -m "Ask once, on Today, and only for the sport they do"
```

---

### Task 8: The fix links land on the field

**Files:**
- Modify: `src/lib/race/pacing.ts:106`
- Modify: `src/components/coach/chat-interface.tsx:331`
- Modify: `src/lib/race/pacing.test.ts` (or create the assertion where pacing refusals are tested)

**Interfaces:**
- Consumes: the ids from Task 1, the section ids from Task 2.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Add to the pacing tests:

```ts
  // The fix link is the whole mechanism. Pointing it at bare /settings put
  // the athlete at the top of the app's longest surface with the drawer
  // they needed closed and badged "FTP 250" — which reads as done. The
  // deep link existed, was test-guarded, and had exactly one caller.
  it("sends 'Set it' to the field, not to the top of settings", () => {
    const figure = racePacing({
      sport: "Bike", distanceKm: 100, elevationM: 500,
      ftpWatts: null, massKg: 70, eventDays: 1,
    });
    expect(figure.available).toBe(false);
    if (figure.available) return;
    expect(figure.kind).toBe("missing_input");
    if (figure.kind !== "missing_input") return;
    expect(figure.fix?.href).toBe("/settings?open=baselines#ftp-outdoor");
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/race/pacing.test.ts`
Expected: FAIL — received `/settings`.

- [ ] **Step 3: Point the links at the fields**

`src/lib/race/pacing.ts`:

```ts
/**
 * Where an athlete sets both anchors: BodyPrefsCard on /settings.
 *
 * The SECTION and the FIELD, not the page. `?open=` opens the collapsed
 * section and the fragment scrolls to the input — both of which existed and
 * neither of which this link used, so "Set it" landed 7.8 screens from the
 * thing it named.
 */
const FTP_FIX = { label: "Set it", href: "/settings?open=baselines#ftp-outdoor" };
const PACE_FIX = { label: "Set it", href: "/settings?open=baselines#threshold-pace" };
```

Replace the `ANCHOR_FIX` usage at the FTP branch with `FTP_FIX`, and the run-anchor branch with `PACE_FIX`. Check every `ANCHOR_FIX` reference in the file and give each the anchor it actually names.

`src/components/coach/chat-interface.tsx:331`: change `href="/settings"` to `href="/settings?open=coach#coach"`.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/race`
Expected: PASS.

- [ ] **Step 5: Mutation-test**

Set `FTP_FIX.href` back to `"/settings"`. Re-run — MUST go red. Restore.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/race/pacing.ts src/lib/race/pacing.test.ts src/components/coach/chat-interface.tsx
git commit -m "Set it now means set THIS"
```

---

### Task 9: Docs, guarded figures, and looking at the pictures

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/2026-08-26-ia-inventory.md`
- Modify: `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Run the guarded-figures test to see what broke**

Run: `npx vitest run tests/roadmap-figures.test.ts`
Expected: FAIL on the migration count — the doc claims 47, `drizzle/*.sql` now holds 48.

- [ ] **Step 2: Fix the migration count**

Update the `N migrations` claim in the doc the test reads. Re-run until green.

- [ ] **Step 3: Record the strand honestly**

In `docs/ROADMAP.md`, under the Information Architecture item, add — and do **not** tick the checkbox:

```markdown
      **Settings navigability addressed in v0.134.0, and the strand stays
      open.** The measured symptom was never length: the inventory records
      Settings collapsed at 1.0 screen and 7.8 expanded, and says why —
      "the accordion labels do not predict their contents well enough to
      open only one". So the fix is prediction, not depth. Badges now name
      what is MISSING as well as what is set; the `?open=`/fragment deep
      link that existed with one caller became the app's anchor-fix
      vocabulary; and Sessions left "Advanced / API" for its own Security
      section. Settings expanded is still 7.8 screens and that is deliberate.
      **The two parked questions are untouched** — whether Season, Fitness,
      Sleep and Labs deserve to be tabs is still waiting on the counter, and
      claiming this strand closed on a Settings fix would be the third
      instance of a narrower true metric replacing the goal.
```

- [ ] **Step 4: Strike the finding that did not survive**

In `docs/2026-08-26-ia-inventory.md`, at the "Import has two doors" bullet, append:

```markdown
  **Struck 2026-09-03, on reading the code.** Today's `/import` link
  (`src/app/page.tsx:332`) is inside the `isFirstRun` branch that opens at
  `:291` — it is the onboarding door, beside "Log manually", for an athlete
  with no data at all. And Settings ▸ Data already renders Data export and
  Import CSV adjacent in one section under the badge `Export · Import CSV`.
  The two halves are already together and both doors are correct. See
  `docs/specs/2026-09-03-settings-navigability-and-anchors-design.md`.
```

- [ ] **Step 5: Full suite and typecheck**

```bash
npx vitest run
npx tsc --noEmit
```
Expected: all green. `.next/` generated-type parse errors are noise — re-run before bisecting your own diff.

- [ ] **Step 6: Capture and LOOK**

The seeds are already in the states that matter — `seed-demo.ts` writes no `body_prefs` row and the demo athlete is a marathon runner, so the prompt and the missing-pace badge fire on the existing `today`, `settings` and `settings-expanded` surfaces. `seed-cycling-owner.ts` writes `ftpWatts: 250` with no pace and no run activity, which photographs the sport gate refusing.

Capture those surfaces and **open the PNGs**. `truncate` is CSS, so a hidden badge is still in the DOM and a test cannot see what a screenshot can. Confirm by eye:
- the Today prompt reads at 390px wide without a new breakpoint;
- the baselines badge is not clipped at its longest (`wake 06:30 · max HR 185 · FTP 250 · no run pace`);
- the seventh section did not push anything off, and Security is open in `settings-expanded`.

If a new capture surface turns out to be needed, it goes in **`surfaces.yml` AND `soak.yml`** together — v0.127.0-rc.1 was killed by its own guard because #220 updated one and not the other.

- [ ] **Step 7: Changelog and commit**

```bash
git add docs/ROADMAP.md docs/2026-08-26-ia-inventory.md CHANGELOG.md
git commit -m "Record what moved, what is struck, and what stays parked"
```

---

## Self-review notes

**Spec coverage.** Decision 1 → Tasks 2, 8. Decision 2 → Task 3. Decision 3 → Task 1. Decisions 4 and 5 → Task 5. Decision 6 → Task 7 step 5. Decision 7 → Task 6. Decision 8 → Task 6 step 4 and Task 7 step 3. Decision 9 → Task 4. Decision 10 → Task 9 step 4 (struck, not built). Decision 11 → Task 9 step 3.

**Ordering dependency.** Task 5's test references `anchorPromptDismissedAt`, which Task 6 creates. They are adjacent deliberately; if the missing column blocks the resolver test, run Task 6 first. Nothing else depends on order beyond Tasks 1 and 2 preceding Task 8.

**Type consistency.** `MissingAnchors { ftp, pace, dismissed }` is used identically in Tasks 5 and 7. `baselinesSummary(row)` is a function in Task 3, replacing a `const` of the same name — the page's badge usage is renamed to `baselines` to avoid shadowing the import.
