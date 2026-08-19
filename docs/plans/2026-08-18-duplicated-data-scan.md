# The duplicated-data scan — `docs/ROADMAP.md:572`

> "On every page touched: scan for and remove duplicated data — the same
> value shown twice. A standing finding from prior redesigns here."

Scanned all 12 pages on 2026-08-18 from `fbdc028` (v0.111.0). Baseline before
any change: **2201 pass, 1 expected fail**. After: **2213 pass, 1 expected
fail** — the +12 are this slice's own new tests.

The test used to separate a finding from a coincidence is the v0.84.0 one:
**one specific value stated in two places, where drift is a bug the athlete
can see.** Generic helpers applied to different inputs are not that, and were
deliberately left — the `constraints.hoursPerWeek` precedent.

---

## Removed

### 1. Activity stat tiles — the only finding that had already drifted

`/activity/[id]` and Today's "just landed" block each built the same six
tiles (Duration · Distance · Load · Avg HR · Avg Power · Climb) from their own
literal — same fields, same order, same rounding, same units — while
`JustLandedCard`'s doc comment asserted they could not disagree: *"Every
figure here is one `/activity/[id]` already renders."*

They already disagreed. The provenance line was the visible half:

| provider        | `/activity/[id]`   | Today (before)   |
| --------------- | ------------------ | ---------------- |
| `intervals_icu` | `intervals.icu`    | `intervals.icu`  |
| `manual`        | **logged by hand** | **manual**       |
| `strava`        | `Strava`           | `strava` †       |

† unreachable — Today's `recentActivity` query excludes Strava rows. `manual`
was reachable, so one hand-logged ride carried two names across two surfaces.

Now `src/lib/activity-stats.ts` — `activityStats()` and `activityMeta()`, with
`PROVIDER_LABEL` (the considered spelling) surviving as the single one. Six
tests, including one pinning all three provider spellings so the drift cannot
reopen silently.

### 2. `RANGES` — a triple, not the pair recorded in the handoff

The third copy was the load-bearing one. `train/page.tsx:104` **validated**
`?range=` against its own list while `train/range-tabs.tsx:4` **rendered** the
pills from another. A range in the tab bar that the page did not accept would
fall back to 90 with nothing to say why.

Now `src/lib/log-href.ts`, beside `BODY_TABS`, `TRAIN_TABS` and
`TRAIN_DEFAULTS.range = 90` — the fallback that is itself a member of the
list. All four call sites read it; pages narrow through the new `isRange()`.

### 3. `STATUS_DOT` — duplicated, and the code said so

`week-strip.tsx` and `week-day-list.tsx` held seven identical keys and values
and render **in the same viewport** on Train → Week. week-strip carried a
comment promising to keep its copy in sync by hand. Now
`src/lib/status-color.ts`, following `band-color.ts` — "so a status never
means two colours."

### 4. `NAV_ITEMS` ×2 → `src/lib/nav-items.ts`

Verbatim in `bottom-nav.tsx` and `sidebar-nav.tsx`, including the active-route
predicate; sidebar-nav's comment read "mirrors BottomNav", which is a
duplication with a note attached. The module owns the data and the predicate;
the two renderers keep their own layout, which is the part that legitimately
differs.

### 5. Weekday vocabulary ×6 → `src/lib/weekdays.ts`

Three full-name arrays (two components, one MCP tool), two `Mon`–`Sun`, one
`Mo`–`Su`, and no canonical home. Folded in the seventh — `sleep-history-strip`
held the app's only **Sunday-first** array, indexed by `getUTCDay()`; it now
reads `weekdayIndex()` like everything else. Six tests, the load-bearing one
asserting the four lengths agree about which day each index is.

### 6. Avatar initial ×3 → `avatarInitial()` in `app-shell.tsx`

Identical four-line derivation in Today, Settings and SidebarNav — two of
which render the same letter in the same viewport at lg+.

### 7. `admin/page.tsx` — `u.name || u.email` computed twice, 65 lines apart,
both feeding `SyncJobsPanel`. One `userLabels` list now serves both props.

**Net −155 lines across 19 files**, plus four new owning modules and two new
test files.

---

## Open — the owner's call

Three findings are the same shape as the Sleep-tab one already recorded at
`ROADMAP.md` under 2b.3, and are held on that precedent rather than resolved
unilaterally.

- **Today's hero why-line against the vitals grid.**
  `HRV 91 vs 97 baseline · RHR 48 · slept 7:12 · TSB −1.9` renders directly
  above tiles carrying the same four numbers in the same formats — adjacent,
  same column, on both `morning` and `post-session`. They match because
  `hoursToClock` (`page.tsx`) and `fmtClock` (`today-hero.tsx`) are the same
  function twice. Note `evening` **already de-dupes**: `staleLabel` drops the
  why line.
- **`JustLandedCard` states Duration, Load and Avg HR twice inside one card** —
  the `Delivered:` line and the stats grid ~10px below it. Unlike
  Asked/Delivered, these two are not different frames.
- **The Sleep tab's `LAST NIGHT · 6:51` against the sleep-duration trend's
  `6.9h`** — already recorded, unchanged.

Train's Fitness tab is the precedent for resolving them: `showStats={false}`,
commented *"the tiles above already carry CTL/ATL/TSB."*

---

## Found, but a different item

Not "the same value shown twice", so out of scope here — recorded so the next
scan does not re-derive them:

- **`localYmd` — 23 definitions** (plus 31 inline equivalents) while
  `charts.ts:190` already exports one.
- **`clock(secs)` ×5 that are not all the same function.** `laps-table`'s is
  `m:ss`; the rest are `h:mm`. Three of the `h:mm` copies print `0:60` for
  3599.7s where `sleep-night-card`'s — which rounds to whole minutes first —
  correctly gives `1:00`.
- Generic helpers: `addDays`/`addDaysYmd` ×9, `round1` ×5, `daysAgo` ×5,
  `clamp` ×4, `shapeBucket` ×4, `mean` ×3 (`insights/stats.ts` exports one),
  `downsample` ×2, `UUID` ×2, `MINUTES_PER_DAY` ×4.

## Verified

- `npx tsc --noEmit` — clean. `npm run lint` — clean.
- `npx vitest run` — 2213 pass, 1 expected fail. Guards unchanged: ad-hoc
  alpha still ZERO, arbitrary type sizes still at ceiling 1.
- `npm run build` — clean, **and the emitted CSS was checked**: moving Tailwind
  class literals into `src/lib/` is safe under v4's automatic content
  detection. `bg-ink-race` now has exactly one source in the tree
  (`src/lib/status-color.ts`) and appears in `.next/static/chunks/*.css`.
- `verify-surfaces.ts` — **96/96 captured, 0 failures, 0 confirmed axe
  defects** (`.screenshots/v0112-dupscan`), 2026-08-19. Indeterminate 2578
  nodes across 94 combinations, all `color-contrast` over this app's gradient
  backgrounds — the bucket that never gates, unchanged in shape from the
  recorded baseline.

  **The PNGs were opened**, and two of them are the evidence:

  - `body-sleep-dark-phone` — the sleep strip reads T·18 M·17 S·16 S·15 F·14
    T·13 W·12 T·11, and Aug 2026 agrees on all eight. This was the one change
    that could not be checked any other way: the strip held the app's only
    Sunday-first array, indexed by `getUTCDay()`, and now reads the
    Monday-first `weekdayIndex()`. An off-by-one here renders cleanly and is
    wrong, so axe would have passed it.
  - `activity-detail-dark-phone` against `today-post-session-dark-phone` —
    the seeded athlete's latest activity is a **manual** one, which is exactly
    the reachable half of the drift. Both surfaces now say *logged by hand*
    (Today used to say *manual*), and the six tiles agree figure for figure:
    1h 20m · 40.0 km · 91 · 153 bpm · 230 W · 480 m.

  Also visible in that second PNG, and left open on purpose: `Delivered:
  1h 20m · 91 load · avg HR 153bpm` sits directly above tiles carrying the
  same three numbers — the JustLandedCard finding recorded under *Open*.

- **What the capture does NOT cover.** On the seeded demo database Train →
  Week renders `No plan yet`, so `week-strip`, `week-day-list`,
  `standard-week` and `intake-form` — findings 3 and 5 — are absent from every
  PNG. `seed-demo.ts` seeds 90 days of history but no forward plan. Those four
  components are covered by their own render tests
  (`week-strip.test.tsx`, `week-day-list.test.tsx`, `standard-week.test.tsx`,
  `intake-form.test.tsx`); they are not covered visually, and calling this
  slice "captured" without saying so would overstate it.
