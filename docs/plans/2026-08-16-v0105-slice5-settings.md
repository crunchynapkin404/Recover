# v0.105.0 — 2b.4 slice 5, Settings — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Settings surface to the v0.99 foundations — 12px floor,
token ramps, zero confirmed axe findings — starting with the four sections of
five that no capture has ever opened.

**Architecture:** Phase A makes the surface visible to the tooling and records
an honest baseline. Phase B is the redesign, and its scope is decided by phase
A's number rather than guessed at now.

**Spec:** `docs/specs/2026-08-11-2b4-visual-redesign-design.md` (2b.4, the
design authority for every slice)
**Predecessor:** `docs/plans/2026-08-13-v099-slice4-coach.md` (slice 4)
**Gate:** ships through `docs/RELEASING.md`'s RC → soak → promote, added in
v0.104.0. This is that gate's first real customer.

## Global Constraints

- **Branch:** `v0.105-settings-at-the-floor` off `main`.
- **The 12px floor is hard.** No `text-[Npx]` below 12px survives, and a value
  that cannot be lifted gets **deleted or restated**, not shrunk — see slice 4,
  which deleted a per-message timestamp rather than enlarge it.
- **Dev never holds real connector credentials** (`docs/ENVIRONMENTS.md`).
  Seeded `connections` rows carry throwaway ciphertext, never a real token.
- **Five green checks:** `npm test`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm run format:check`.
- **Soak database:** the RC stack's Postgres, seeded by copying devbox's
  (`docs/ENVIRONMENTS.md` § The RC soak stack). `npm run db:seed` alone does
  **not** produce a usable owner.
- **Capture command:**
  ```bash
  set -a; . ./.env; set +a
  SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- settings
  ```

## What is actually there, measured 2026-08-16

`src/app/settings/page.tsx` is 581 lines and holds **five `<Collapsible>`
sections**. `SURFACES` maps `settings` → `/settings`, and nothing opens them, so
every capture and every axe audit of this surface has seen one section's worth
of content:

| Line | Section        | Cards inside                                           | Ever audited                                                     |
| ---- | -------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| 261  | Integrations   | intervals, strava, whoop, withings, oura, apple-health | **No**                                                           |
| 379  | AI & Coach     | llm-settings, llm-usage, coach                         | **No**                                                           |
| 425  | Advanced / API | api-tokens, webhooks, sessions                         | Only inside `captureTokenCreated`, which clicks `Advanced / API` |
| 476  | App            | notifications, body-prefs, ride-debrief                | **No**                                                           |
| 522  | Data           | export, import                                         | **No**                                                           |

This is the gap slice 2 closed for Train's tabs, slice 3 for Body's (26
confirmed violations on a surface previously reported clean) and slice 4 for
Coach's thread and History states. Settings is the largest instance of it.

**Three OAuth error branches are also unreachable.** `page.tsx:56` reads
`strava_error`, `whoop_error` and `withings_error` from `searchParams` and
passes each to a card's `errorParam` prop (lines 299, 322, 362). No capture ever
sends them.

**And the populated states do not exist in the seed.** On devbox's seeded
database: `connections` 0, `webhook_subscriptions` 0, `push_subscriptions` 0,
`llm_usage` 0, `api_tokens` 0. `llm_settings` 1 and `sessions` 3 are the only
populated ones. So six connector cards can only render "Not connected"
(`strava-card.tsx:92`) even once the section is opened.

**The debt itself**, measured across `src/components/settings/*.tsx` and
`src/app/settings/*.tsx`: **59 hardcoded pixel sizes, 52 of them below the 12px
floor** — 48 × `text-[10px]`, 4 × `text-[8px]`, 1 × `text-[10.5px]` — plus **72
ad-hoc `text-white/N` alphas across 8 levels** (`/50` 25, `/80` 14, `/60` 13,
`/40` 9, `/35` 5, `/70` 4, `/45` 1, `/25` 1).

**Today's axe reading for `settings` is 1 confirmed node in light.** That number
describes the collapsed page and is not a baseline. Phase A replaces it.

---

## Phase A — make the surface visible

### Task 1: Open every section before capturing

**Files:**

- Modify: `scripts/verify-surfaces.ts` — `SURFACES` map (~line 270) and
  `captureWithRetry` (~line 751)

- [ ] **Step 1: Add a per-surface prepare hook**

Insert after the `TODAY_STATE_BY_SURFACE` map:

```typescript
/**
 * Per-surface DOM preparation, run after the theme is forced and before the
 * screenshot and the axe audit — so whatever it opens is both photographed
 * and audited.
 *
 * Settings needs this because its content lives in five <Collapsible>
 * sections that are closed on load. `SURFACES.settings` captured exactly one
 * of them (and only via captureTokenCreated's own click), so Integrations,
 * AI & Coach, App and Data had never been photographed or audited at all —
 * six connector cards, three AI cards, three app cards and the export/import
 * pair, invisible to this tool since it was written. Same class of gap as
 * Train's tabs (slice 2), Body's tabs (slice 3) and Coach's thread state
 * (slice 4); found the same way, by asking which state a PNG was actually of.
 */
const SURFACE_PREPARE: Record<string, (page: Page) => Promise<void>> = {
  "settings-expanded": async (page) => {
    // Open every collapsed section. The triggers are buttons carrying the
    // section label; clicking an already-open one would close it, so this
    // asserts the panel is closed first via aria-expanded.
    for (const label of [
      "Integrations",
      "AI & Coach",
      "Advanced / API",
      "App",
      "Data",
    ]) {
      const trigger = page.locator("button", { hasText: label }).first();
      await trigger.waitFor({ state: "visible", timeout: 10_000 });
      if ((await trigger.getAttribute("aria-expanded")) === "false") {
        await trigger.click();
      }
    }
    // The panels animate; wait for the last one's content rather than a fixed
    // sleep. Data is the last section and holds the Export button.
    await page
      .getByRole("button", { name: "Export" })
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  },
};
```

- [ ] **Step 2: Call it in `captureWithRetry`**

Between `forceThemeVerified` and the screenshot:

```typescript
await forceThemeVerified(page, dark);
const prepare = SURFACE_PREPARE[surfaceName];
if (prepare) await prepare(page);
await page.screenshot({ path: filePath, fullPage: true });
```

- [ ] **Step 3: Register the surface**

In `SURFACES`, replacing the bare `settings: "/settings",` line:

```typescript
  // Settings is FIVE <Collapsible> sections behind one path, all closed on
  // load, and `/settings` alone captures none of their contents. Integrations
  // (six connector cards), AI & Coach, App and Data had never been captured or
  // axe-audited before v0.99 slice 5. `settings` is kept as the collapsed
  // landing state; `settings-expanded` opens all five (see SURFACE_PREPARE).
  settings: "/settings",
  "settings-expanded": "/settings",
```

- [ ] **Step 4: Run it and confirm the sections actually opened**

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- settings 2>&1 | tail -30
```

Expected: `settings-expanded-*.png` files exist and are **visibly taller** than
`settings-*.png`. Compare byte sizes as a cheap proxy:

```bash
ls -la .screenshots/settings/settings-light-phone.png .screenshots/settings/settings-expanded-light-phone.png
```

A `settings-expanded` PNG that is not substantially larger means the clicks did
not land — fix that before trusting any number below.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-surfaces.ts
git commit -m "test(settings): capture the four sections nobody had ever opened

Settings is five <Collapsible> sections behind one path and the capture
opened none of them, so Integrations, AI & Coach, App and Data — six
connector cards, three AI cards, three app cards, export/import — had
never been photographed or audited. Same gap slice 2 closed for Train's
tabs and slice 3 for Body's."
```

### Task 2: Reach the three OAuth error branches

**Files:**

- Modify: `scripts/verify-surfaces.ts` — `SURFACES`

- [ ] **Step 1: Add the surface**

```typescript
  // The three OAuth failure branches (page.tsx reads strava_error, whoop_error
  // and withings_error from searchParams and hands each to a card's errorParam
  // prop). They render only for these query params, so no capture had ever
  // reached them. One load sets all three, because they are independent cards
  // on one page and three separate loads would audit the same DOM three times.
  "settings-connect-errors":
    "/settings?strava_error=access_denied&whoop_error=access_denied&withings_error=access_denied",
```

- [ ] **Step 2: Confirm the error text renders**

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- settings 2>&1 | grep -i "connect-errors"
```

Then confirm visually in
`.screenshots/settings/settings-connect-errors-dark-desktop.png` that three
error messages are on screen. **If they are not, the error branch may live
inside a collapsed section** — add `settings-connect-errors` to
`SURFACE_PREPARE` reusing the same opener as `settings-expanded`.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-surfaces.ts
git commit -m "test(settings): reach the three OAuth error branches

strava_error, whoop_error and withings_error render only for those query
params, so no capture had ever audited them."
```

### Task 3: Seed the states the cards need

**Files:**

- Modify: `scripts/seed-demo.ts`

**Interfaces:**

- Produces: `connections` rows for six providers, plus
  `webhook_subscriptions`, `push_subscriptions` and `llm_usage` rows, so the
  cards render populated rather than empty.

- [ ] **Step 1: Read how seed-demo writes and what schema these tables have**

```bash
grep -n "insert\|schema\." scripts/seed-demo.ts | head -30
grep -n "export const connections\|export const webhookSubscriptions\|export const pushSubscriptions\|export const llmUsage" src/lib/db/schema.ts
```

Write the inserts against the columns those definitions actually declare — do
not assume names.

- [ ] **Step 2: Add the seeding, guarded by the existing `SEED_DEMO` flag**

Follow `scripts/seed-demo.ts`'s existing idempotency style (it is re-runnable;
match how it guards its current inserts). Seed:

- **`connections`** — one row per provider: `intervals_icu`, `strava`, `whoop`,
  `withings`, `oura`, `apple_health`, each with `status: "active"` and an
  `encryptedAccessToken` produced by the app's own `encrypt()` from
  `src/lib/crypto.ts` over a **throwaway string** (`"seed-not-a-real-token"`).
  Using the real `encrypt()` keeps the row shape honest; the plaintext is
  deliberately worthless, per `docs/ENVIRONMENTS.md`'s rule that dev never
  holds real connector credentials.
- **`webhook_subscriptions`** — two rows, one enabled and one disabled, so the
  card renders both states.
- **`push_subscriptions`** — one row, so notifications-card renders subscribed.
- **`llm_usage`** — a handful of rows across two days so llm-usage-card renders
  a populated total rather than a zero.

- [ ] **Step 3: Re-seed the soak database and confirm the counts moved**

```bash
export DATABASE_URL="postgres://recover:recover@127.0.0.1:5435/recover" DATABASE_DRIVER=pg
SEED_DEMO=1 npm run db:seed-demo
docker exec recover-rc-db-1 psql -U recover -d recover -tAc "
select 'connections', count(*) from connections
union all select 'webhooks', count(*) from webhook_subscriptions
union all select 'push', count(*) from push_subscriptions
union all select 'llm_usage', count(*) from llm_usage order by 1;"
```

Expected: `connections` 6, `webhooks` 2, `push` 1, `llm_usage` > 0.

- [ ] **Step 4: Confirm the cards changed state**

Re-run the capture and confirm in
`.screenshots/settings/settings-expanded-dark-desktop.png` that the connector
cards read connected rather than "Not connected". **This is the step that
proves the seeding reached the UI** — a row count alone does not.

- [ ] **Step 5: Run the five green checks and commit**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
set -a; . ./.env; set +a; npx vitest run
git add scripts/seed-demo.ts
git commit -m "feat(seed): give Settings its populated states

Six connector cards could only ever render 'Not connected' because
connections was empty, and webhooks, push and llm-usage cards could only
render empty. Same fix slice 4 made for the coach inbox's five kinds.
Tokens are throwaway ciphertext through the app's own encrypt(): the row
shape is honest, the plaintext is worthless, and dev still holds no real
connector credential."
```

### Task 4: Record the honest baseline, then decide the split

- [ ] **Step 1: Full capture run**

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- settings 2>&1 | tail -40
```

- [ ] **Step 2: Extract the per-surface numbers**

```bash
python3 - <<'PY'
import json
d = json.load(open(".screenshots/settings/axe-report.json"))
entries = d if isinstance(d, list) else d.get("entries", d.get("results", []))
tot = {}
for e in entries:
    s = e.get("surface")
    c = e.get("confirmedNodes", e.get("confirmed", 0))
    c = c if isinstance(c, int) else len(c or [])
    tot[s] = tot.get(s, 0) + c
for s, c in sorted(tot.items(), key=lambda kv: -kv[1]):
    print(f"{s:28} {c}")
print("TOTAL", sum(tot.values()))
PY
```

- [ ] **Step 3: Write the finding into the plan and take the scope decision**

Record the numbers in this file under a new "Phase A result" heading, then
apply the rule agreed before starting:

- **Total confirmed < 30** → phase B continues in this same release, v0.105.0.
- **Total confirmed ≥ 30** (slice 3 found 26 on a smaller surface; Settings has
  52 sub-floor literals and four unaudited sections) → **phase A ships alone as
  v0.105.0** — visibility, seeding and an honest baseline — and the redesign
  becomes v0.106.0. Precedent: slice 0 shipped foundations alone as v0.99.0.

State the decision and the number that drove it. Do not carry the decision in
your head — the roadmap has been wrong twice from summarising counts from
memory.

- [ ] **Step 4: Update `docs/axe-baseline-2026-08-11-seeded.md`**

Append a section recording that the `settings` rows in that document were
measured against a page with four of five sections collapsed, give the new
per-surface numbers, and state that the old `settings` figures are not
comparable to the new ones.

---

## Phase A result — measured 2026-08-16, and the scope decision

**94 confirmed nodes on Settings**, against the 1 the collapsed capture
reported this morning. By rule: **color-contrast 86 (serious), label 8
(critical)**.

| Surface                   | light/phone | light/desktop | dark/phone | dark/desktop |
| ------------------------- | ----------: | ------------: | ---------: | -----------: |
| `settings`                |          10 |            11 |          0 |            0 |
| `settings-expanded`       |          12 |            12 |          1 |            1 |
| `settings-connect-errors` |          12 |            12 |          1 |            1 |
| `settings-token-created`  |          10 |            11 |          0 |            0 |

Indeterminate rose from 7 to **106** on the expanded surface, and two rules
appear that no Settings capture had ever produced: `label` and
`duplicate-id-aria`.

**SCOPE DECISION: phase A ships alone as v0.105.0; the redesign becomes
v0.106.0.** The rule agreed before starting was ≥30 confirmed splits the
release, and 94 is more than triple it — on a surface with 52 sub-floor
literals across 18 components, four sections of which had never been audited.
Precedent: slice 0 shipped foundations alone as v0.99.0.

**The finding that matters more than the count.** One of the eight `label`
nodes is **theme-independent and therefore live in production today**:

```
<input accept="application/json,.json" class="… file:text-[10px] …">
```

The Data section's Import control is a file input with **no accessible name**,
axe impact **critical**, present in `dark` — the only theme
`forcedTheme="dark"` lets the athlete see. It is not a light-mode problem
waiting for slice 9; a screen-reader user cannot identify that control right
now. It has been that way since the control was written, invisible because the
section it lives in was never opened.

This is the same defect shape slice 3 recorded — "one of the 26 was
theme-independent — an `<input type="file">` with no accessible name — and
would have survived the migration untouched" — in a different section of a
different surface, found by the same act of opening something.

**The other 86 are color-contrast and 85 of them are light-only**, so they
behave exactly like every prior slice's debt: invisible until `forcedTheme`
lifts at slice 9, and fixed by tokenising.

---

## Phase B — the redesign

**Scope confirmed by Task 4, not before.** The work itself, in the order slices
1–4 used:

1. Tokenise the type scale: 52 sub-floor literals to the seven-step scale, with
   anything that cannot be lifted **deleted or restated** rather than shrunk.
2. Tokenise the ink: 72 `text-white/N` alphas onto the four-step ramp.
3. Give any tone colours a light expression — slice 4's five inbox tiles are the
   pattern, and light mode stays unreachable until slice 9 regardless.
4. Drive confirmed axe to zero across all four Settings surfaces.
5. Re-pin the guard ceilings (`tests/type-scale-guard.test.ts`'s
   `OFFENDER_CEILINGS` and the contrast guards) and tick the roadmap.

**Carried in from v0.104.0, to close in whichever slice reaches it:**
`coach-thread` cannot be captured on any seeded database — `seed-demo.ts` gives
its six chat threads to `demo@recover.local` while the capture signs in as the
owner, so `a[data-chat-thread]` never appears. Task 3 touches the same file and
is the cheapest opportunity to fix it.
