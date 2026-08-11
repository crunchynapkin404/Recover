# Phase 2b.4 — the app you can read — design

**Date:** 2026-08-11
**Status:** Design, approved
**Phase:** 2b.4, the last open item in Phase 2
**Release:** v0.99.0, one release, ten internally-gated slices
**Predecessor:** `docs/specs/2026-08-11-2b2-settle-the-ia-design.md` (v0.98.0) —
settled the component tree this redesigns against

## Premise

The app has no typographic system and no legibility floor.

**Type.** 300 hardcoded pixel sizes across `src/**/*.tsx`, spread over sixteen
distinct values. **239 of them are 11px or smaller**; 31 are 9px or smaller;
the bottom nav's labels are `text-[8px]`. `docs/design-system.md` documents 83
colour and radius tokens and not one typographic token, because none exist.

**Ink.** Eight ad-hoc alpha levels on `text-white/N`. Three of them —
`/40` (93 uses), `/35` (22) and `/30` (19) — compute to roughly **3.8:1, 3.1:1
and 2.6:1** against `#0a0a0a`, all below the 4.5:1 AA floor for normal text.
**134 usages**, and worse in practice: most sit on `bg-white/5` cards, which
lifts the background and narrows the gap further.

**Method, so this is not overclaimed.** Those ratios are computed analytically
from WCAG 2.x relative luminance against the stated surface, not sampled from a
rendered page. The real composite is per-surface. Making them binding is the
contrast guard's job, not this paragraph's.

Two more defects surfaced while checking the theming plumbing:

- `src/app/layout.tsx` sets `maximumScale: 1, userScalable: false`.
  **Pinch-zoom is disabled app-wide** — WCAG 1.4.4. On a release about
  legibility this is the sharpest contradiction available: the athlete who
  cannot read the 10px label is actively prevented from magnifying it.
- `themeColor` is hardcoded `#0a0a0a`, so the PWA status bar cannot follow a
  theme.

**The driver is ergonomics.** This is not a restyle that happens to improve
contrast; it is a redesign around the four moments the phone is actually in the
athlete's hand — morning, post-session, evening, weekly planning — and the
restyle of all twelve routes is part of it, not instead of it.

## Scope

Rebuild the visual foundations (type scale, ink scale, spacing, both themes),
reflow all nine authenticated surfaces around the four moments, restyle all
twelve routes.

### Non-goals

- **No IA change.** Nav stays Today/Train/Coach/Body/Menu; every route keeps its
  URL; no route is retired. Reflow happens _within_ the shape. This was chosen
  deliberately over full latitude: bookmarks, the PWA shell and one athlete's
  muscle memory all survive.
- **Presentation may change, claims may not** — Phase 2's standing non-goal,
  unchanged. No new figure, and no existing figure claiming more than 2a can
  source. See "What is not guarded" below for how this is enforced, and how it
  is not.
- **No visual-regression baseline.** Worth building _after_ this lands. A
  redesign changes every pixel by definition, so a baseline committed now is
  worth nothing and noisy to maintain.
- **No feature work.** Nothing new appears that an athlete could not do before.

## Decisions

| Question          | Decision                                        | Why                                                                                 |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Driver            | Ergonomics — the four moments                   | Chosen over craft, page-shape and legibility framings; the restyle rides along      |
| Moments           | All four, one release                           | Ordering them by priority was rejected: all four are real                           |
| Release shape     | One release, ten gated slices                   | One athlete-visible change and one deploy; slices keep rollback at one `git revert` |
| IA latitude       | Reflow within the shape                         | Fixes the measured failure without retiring routes or relearning the nav            |
| Visual direction  | Evolve the foundations, add light mode          | Light mode is what forces every hardcoded value to become a token                   |
| Type floor        | 12px, 7 steps                                   | Nothing below 12px exists as a token, so `text-[8px]` becomes unwriteable           |
| Ink               | 4 semantic steps, per-theme values              | Three of today's eight alphas fail AA; naming them by role stops the drift          |
| Theme control     | System default, manual override                 | Tracks sunset and the OS schedule for free; the override is for when that is wrong  |
| Theme persistence | `next-themes`, localStorage                     | Already a dependency and unused; theme is device-local by nature                    |
| Verification      | Build-failing guards + real-browser screenshots | The measurable half mechanically, the judgement half by eye, before merge           |
| Design source     | System first, two reference surfaces            | Front-loads the decisions that are expensive to change late                         |

## The visual system

### Type — 12px floor, 7 steps

`12 · 14 · 16 · 20 · 24 · 30 · 44`, plus a mono numeric variant for figures.
Declared as Tailwind v4 `@theme` tokens so each step is a utility and arbitrary
values become unnecessary.

(The screen this was approved on listed six sizes and called it a seven-step
scale. The seventh is `24`, added here rather than quietly dropping the count —
the dense surfaces need a step between `20` and `30`.)

**The consequence, stated up front:** 239 usages get larger. Cards that fit
today will not fit tomorrow. Content gets cut, stacked or moved — the dense
surfaces (Train's week rows, Body's Labs table) will need real editorial
decisions, not reflow. That is the redesign doing its job, and it is the single
largest source of work in this release.

Micro-labels get their quietness from weight, tracking and ink — never from
size below 12px.

### Ink — four steps, each with a job

| Token           | Dark      | Light     | Ratio (dark / light) | Allowed on                                       |
| --------------- | --------- | --------- | -------------------- | ------------------------------------------------ |
| `ink-primary`   | `#f5f5f5` | `#171717` | 16.6 / 17.9          | anything                                         |
| `ink-secondary` | `#b4b4b4` | `#4a4a4a` | 8.7 / 8.9            | anything                                         |
| `ink-muted`     | `#8a8a8a` | `#6e6e6e` | 5.2 / 5.1            | the floor for any text                           |
| `hairline`      | `#6b6b6b` | `#8a8a8a` | 3.1 / 3.2            | **never text** — dividers, borders, icon strokes |

Ratios are against the **worst-case** surface each token must survive —
`#1f1f1f` (dark overlay) and `#f6f6f6` (light base) — not against the most
flattering one. The light `hairline` was `#949494` in the approved screen;
recomputed against `surface-base` rather than white it measures 2.81:1 and
fails its own floor, so it is `#8a8a8a` here. The tightest pair in the system
is light `ink-muted` on `surface-base` at 4.72:1.

`hairline` is deliberately named for its role rather than as an ink step, so
that reaching for it as text colour reads as wrong at the call site. It clears
WCAG 1.4.11's 3:1 for non-text, which is what it is for.

### Surfaces — glass stops being the substrate

70 uses of `bg-white/5` currently _are_ the card. Translucent white over white
is invisible, so every one of them breaks in light mode. Surfaces become real
per-theme tokens — `surface-base`, `surface-raised`, `surface-overlay` — and
glass is reserved for elements genuinely floating over content: the nav pill,
bottom sheets.

This is why light mode could not have been a token swap on top of the current
CSS, and why it is load-bearing rather than additive.

### The accent changes value between themes

`--primary: #10b981` measures **7.1:1 on dark and 2.5:1 on white**. Light mode
needs a darker emerald — `#047857`, 5.5:1. Same token name, different value per
theme. This is the clearest single proof that light mode forces real tokens.

### Spacing and radius

A 4px-base spacing scale as tokens: `4 · 8 · 12 · 16 · 24 · 32 · 48`. Radius is
already tokenised (7 steps off `--radius`) and stays, trimmed to the steps
actually used.

## Theme mechanics

`next-themes@^0.4.6` — **already in `package.json` and entirely unused**, since
no `.dark` class exists in `globals.css`. Wiring it costs no new dependency and
gives us the pre-paint inline script, localStorage persistence, cross-tab sync
and OS-change listening as library behaviour rather than code we maintain.

- `attribute="class"`, `defaultTheme="system"`.
- Token sets declared on `:root` and `.dark`.
- A Light / Dark / System control in Menu.
- `themeColor` becomes two `media`-scoped entries; `appleWebApp.statusBarStyle`
  follows.
- `maximumScale` and `userScalable` are removed from the viewport export.

**Persistence is localStorage, not Postgres.** Theme is device-local by nature —
the phone in sunlight and the desktop indoors legitimately want different
answers, and a synced preference would fight that. It also avoids a migration
and a known trap: a new _table_ is not covered by the `Carried<>` import/export
guard (that gap is recorded and unbuilt), so a `display_prefs` table would drop
silently on export until someone noticed. The counter-argument, recorded because
it is real: `journalPrefs` set a house precedent that a new preference category
gets its own table, and everything else about this athlete lives in Postgres.

## The moments

Nav and routes are frozen, so the ergonomics come from what each surface leads
with. Three moments live on Today; the fourth stays on Train.

**Today becomes state-aware.** Same route, same blocks, same numbers — the block
that answers the moment comes first and the rest keep their place below.

- **Morning** — readiness leads, then today's session.
- **After a session lands** — the activity leads: what it cost against what was
  asked, the debrief, and a direct route into laps and streams.
- **Evening** — the day's log, then tomorrow's session and bed time.

**Weekly planning stays on Train**, which the telemetry already supports: Train
is the second-most-used surface at 53 views.

### The cost, recorded

Today is no longer the same page twice. Three states means three times the
design, test and screenshot work on the app's most-used surface, and the state
logic is itself a thing that can be wrong. Accepted deliberately: it is the only
option on the table that fixes the post-session failure without touching the IA.

## Two corrections to the record

**1. The two zeros are two findings, not one.** `docs/ROADMAP.md` and the 2b.2
spec both cite "`activity` and `activity-log` recorded zero views" as a single
signal. They are not the same signal:

- **`/activity/log` is the manual-entry form** for a ride that did not sync —
  not a log of activities. It is linked from exactly one place,
  `src/app/train/page.tsx`, inside the History tab. A synced athlete never needs
  it, so **its zero is uninformative** — the same class of non-evidence as
  `import`'s zero, which the roadmap is careful about but does not extend here.
- **`/activity/[id]` is the real finding.** It is reachable from exactly two
  places: a row in Train → History (`src/components/train/history-list.tsx`) and
  the debrief sheet's close link. Seeing your own laps and streams after a ride
  costs Today → Train → History → find the row → tap. Four activities landed in
  the telemetry window and the athlete took that path zero times.

Only the second is a problem, and the state-aware Today's post-session block is
what fixes it — the first direct route into `/activity/[id]` that does not run
through Train.

**2. The read-site guard does not cover "no new figure."** This design initially
assumed it would. It does not: `tests/read-site-guard.test.ts` pins exactly one
column pair (`wellness_daily.ctl/.atl`) and states explicitly that a broad list
would mean guessing which pairs matter. Recorded because the assumption is an
easy one to make again.

## Guards and verification

### Guards that fail the build

1. **Type-scale guard.** No arbitrary type or ink utilities in `src/**`.
   **This guard is sound, not best-effort:** Tailwind v4 compiles only classes
   that appear literally in source, so an arbitrary `text-[9px]` that is not a
   literal string never renders. Anything that can reach the screen is therefore
   findable by scanning. That soundness argument is what the deleted
   `import-week-plan-column-parity` test lacked.
2. **Contrast guard.** Parses tokens out of `src/app/globals.css` — the file
   that ships, not a copy — computes WCAG relative luminance, and asserts every
   ink×surface pair legal for text clears 4.5:1 **in both themes**, and that
   `hairline` clears 3.0:1 and is excluded from text roles. Mutation-checked:
   change one hex, the test must fail.
3. **Axe, nine surfaces × two themes** — 18 tests, up from the single
   `journal-form.axe.test.tsx` that exists today.

Existing guards that must still pass and must not be weakened:
`uncertainty-dialects-guard`, `dead-component-guard` (`KNOWN_ORPHANS` stays
empty), `ia-directory-guard`, `route-guard`.

### Real-browser screenshots

A local pre-merge step, not CI: headless Chromium against a dev server with
seeded data, at a phone and a desktop viewport, reviewed and attached to the PR.
CI has no browser, and seeding it realistically is its own project.

**28 captures per viewport**, counted rather than estimated: nine authenticated
surfaces × two themes (18), plus Today's two additional states × two themes (4),
plus three pre-auth routes × two themes (6).

The roadmap's reason for insisting: **the v0.23 redesign shipped three bugs that
only a real browser caught.**

### What is not guarded

**"No new figure" has no mechanical guard.** It rests on per-slice review and on
the screenshots, where a figure that was not there before is visible. Stated
plainly rather than implied, because a redesign is exactly where a number
appears to make a card look balanced.

## Slices

One branch, `v0.99-the-app-you-can-read`; one PR; one deploy. Each slice is its
own commit with its own screenshots and axe pass, so a defect found after deploy
costs one `git revert`, not the release.

| #   | Slice                            | Notes                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Foundations**                  | Both token sets, type and spacing scales, `next-themes` wiring, pinch-zoom and `themeColor` fixes, all three guards including mutation checks. No surface changes. Ends with mockups of **Today and Train** — the smallest and largest surfaces — as proof the system survives both extremes before slice 1 begins. |
| 1   | **Today**                        | Three states. Plus tests for `today-hero`, `week-row`, `session-card` — this slice rewrites all three, and they are the roadmap's three untested Today components.                                                                                                                                                  |
| 2   | **Train**                        | 1,537 lines of `page.tsx`, the densest surface. The hard one.                                                                                                                                                                                                                                                       |
| 3   | **Body**                         | 839 lines, four tabs.                                                                                                                                                                                                                                                                                               |
| 4   | **Coach**                        | Three components, 1,031 lines — the chat surface is dense in a different way: long-form prose, not figures.                                                                                                                                                                                                         |
| 5   | **Settings / Menu**              | Gains the theme control.                                                                                                                                                                                                                                                                                            |
| 6   | **Activity detail + manual log** | The post-session destination the Today block now routes into.                                                                                                                                                                                                                                                       |
| 7   | **Admin + Import**               | Owner-only and once-ever respectively; lowest traffic, but both still need both themes.                                                                                                                                                                                                                             |
| 8   | **Pre-auth**                     | `login`, `join/[code]`, the `/wellness` redirect stub — they need the themes too.                                                                                                                                                                                                                                   |
| 9   | **Sweep**                        | Duplicate-data scan on every page touched; the `/body` ÷ `/train` tab-pattern decision (both standing roadmap riders); `design-system.md` rewritten prescriptive; roadmap ticked.                                                                                                                                   |

Separately and **first**, as a docs-only commit: four corrections to
`docs/ROADMAP.md` — the "only open item in Phase 2" line that omits 2b.4's three
riders, and two stale dead-component-sweep entries (§Sequencing item 3 and the
Phase 4 bullet) that v0.98.0 completed. Working against a roadmap that still
lists a finished sweep as available work is how the v0.87.0 mistake happened.

## Risks

| Risk                                                               | Mitigation                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| The 12px floor forces content cuts on dense surfaces               | Editorial decisions are made per slice, in review, with screenshots — not deferred to the end          |
| A new figure appears to balance a layout                           | Per-slice review; screenshots; the non-goal is stated in the PR template for each slice                |
| Light mode ships half-done on a surface nobody re-checked          | Every slice's screenshot set is both themes; axe runs in both                                          |
| Today's state logic is wrong at a boundary (midnight, a late ride) | Unit tests on the state selector, not just on the components; note the `mockClear` lesson from v0.36.1 |
| One release means one deploy and no partial rollback               | Per-slice commits; a bad surface is one revert                                                         |
| Scope creep from ten surfaces into "while we're here"              | Non-goals above; anything found gets a roadmap line, not a commit                                      |

## What this unblocks

**Phase 2 closes.** 2a, 2c and 2d are already closed; 2b.1, 2b.2 and 2b.3 are
done; this is the last open item, and its three riders close with it. After it,
`docs/BASELINE.md` — pinned at v0.65.0 — can be re-measured against a Phase 2
that is actually finished, and Phase 3 begins with multi-A-race seasons, the
244-vote request skipped at v0.53.
