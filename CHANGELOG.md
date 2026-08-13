# Changelog

## v0.101.1 — 2026-08-13 — Zero means zero

A same-day patch on v0.101.0. A second whole-branch review, covering the
sixteen commits that landed after the first one ran, found two Criticals.
Both were seams: neither was visible from inside any single task, and neither
could have been caught by the test suite or by the browser pass.

**The "zero offenders" claim was false, and the miss was in the desktop nav.**
v0.101.0 stated the Train surface held no sub-floor type and no ad-hoc ink
outside one documented exclusion. The sweep's grep covered `bottom-nav.tsx` —
the `lg:hidden` half of Train's chrome — but never its complement
`sidebar-nav.tsx` (`hidden … lg:flex`), nor `ui/empty-state.tsx`, which has
five Train call sites. Eight offender lines were live in the sidebar,
including a `10px` label at **3.77:1** — below the 12px floor and below AA —
in the navigation that renders on Train at every desktop width.

The axe pass could not have found it either: the sidebar's translucent ground
makes `color-contrast` resolve as _indeterminate_, which never gates. That is
the same blindness `globals.css` already documents for translucent light
glass. Both files are now on the token scale, and the sweep's own grep names
them so a later slice cannot repeat the omission.

**`.glass` was nested inside `.glass` again, four commits after the same rule
got another component reverted.** The Fitness tab's PMC wrapper is a glass
section whose empty branch rendered `EmptyState`, whose own root is glass — so
any install without training-load data composited glass on glass. That is an
undeclared ground, measured at 4.61:1 with 0.11 of margin, and it falsified
`glass-contrast-guard`'s own comment claiming its grounds were "verified
against the tree". The section now renders only when there is a series, so the
empty state falls outside it.

**That rule is now a guard rather than a comment.** `glass-contrast-guard`
gained an AST-based nesting check over `src/**/*.tsx` that resolves a
component's root class, not just literal `className` strings — so
`<EmptyState>` inside a glass wrapper is caught, not only a literal nested
`div`. It ships with three self-tests proving it discriminates: it must catch
native nesting, must catch component-root nesting, and must not flag siblings
or `glass-no-hover`. Verified by re-introducing the exact defect and watching
it fail with the right file:line.

The guard immediately found **two more pre-existing sites** outside Train —
`body/biomarker-list.tsx` and `body/journal-form.tsx`, both from July and
untouched by this release. They are pinned in an exact allowlist rather than
fixed, because they belong to the Body slice. The allowlist cannot grow.

Offender ceilings: **217 → 212** arbitrary type sizes, **480 → 469** ad-hoc
ink alphas.

## v0.101.0 — 2026-08-13 — Train, at the floor

Phase 2b.4 slice 2 of 10. The Train surface — four tabs, 22 components and a
1,537-line page — moves onto the v0.99 token system at a hard 12px floor. It
was the largest surface in the app by a wide margin: 133 arbitrary type sizes
and 255 ad-hoc ink alphas when the slice opened, roughly a third of everything
left in the codebase.

**Three editorial cuts, because the floor genuinely did not fit.** The week day
row's spelled-out status pill is gone — it needed ~90-110px at 12px bold tracked
type on a 380px row that also carries a weekday and the workout text, and the
week strip directly above it already renders the same vocabulary as a colour dot
with `sr-only` text. Next week's seven provisional rows collapse to one summary
line that opens on demand; committed data stays fully expanded, a forecast is
the right thing to demote. And the season timeline's 24 per-bar micro-labels —
9px week plus 8px session count, the smallest text in the app — could not fit a
phone at any boundary; it is now an axis tick every third week, one always-legible
readout, and a strip that scrolls rather than compressing bars below legibility.

**Race day has a token.** `--ink-race` replaces the literal `text-fuchsia-300`
that shipped in two files. Named `ink-race` deliberately: `roleOfToken()`
classifies by name, so the token registers itself with both contrast guards with
no guard edit. Dark resolves to the exact hex the literal already rendered, so
dark's pixels do not move; light gains a value that clears 4.5:1.

**The second 10px floor is retired.** `.label-micro` hardcoded `font-size: 10px`
behind 53 call sites across seven surfaces. It now sits on `--text-label`.

**History's rows size to their content** instead of clipping at a hardcoded 56px,
and the fitness tiles drop the category word the chart's own legend states one
panel below.

### Guards

**The 12px floor was not actually enforced, and this release is what exposed it.**
The seven scale tokens live in `@theme inline`, which `extractThemeBlocks()` never
matched — so the floor was checked against a hand-copied table of px values inside
a test. Setting `--text-label: 0.625rem` left the entire suite green while 145
`text-label` sites and every `.label-micro` rendered at 10px. It is now derived
from the stylesheet, with a new assertion that each `--text-*` clears 12px in its
own right, and the reader throws rather than returning nothing if the block moves.

`tests/glass-contrast-guard.test.ts` derived its ink list from a hand-written
array that silently excluded `coach-ink` and `accent` — both real text tokens
rendered on glass. Now role-derived with an exact seven-member inventory.

`src/app/train/skeleton-table.test.ts` held page.tsx to the floor with regexes
narrower than the guard it inherits from, missing `rem`/`em` units and the
`ring`/`divide`/`fill`/`stroke` prefixes. It now imports the shared patterns.

Offender ceilings: **351 → 217** arbitrary type sizes, **738 → 480** ad-hoc ink
alphas, each read from the guard's own count.

### Fixed

- The global bottom nav overflowed on common phones: 8px → 12px labels kept
  `uppercase tracking-widest`, costing 62px at 320pt and 22px at 360pt, where
  "MENU" rendered outside the pill and Settings became unreachable. The design
  reference had already dropped the tracking at this size.
- The next-week summary printed a raw quotient — `of 7.916666666666667h target`
  — while the block below rendered the same figure as `7.9h`. Every test used
  whole numbers.
- The weekly load chart rendered upside-down: each bar sits in an `h-full`
  column whose default `justify-start` pinned it to the top, so the parent's
  `items-end` never reached it. Pre-existing.
- `sidebar-nav`'s avatar was a measured 1:1 contrast failure in light and below
  the floor. It renders on eight surfaces, so fixing it took Today's three
  states and Body to zero confirmed findings alongside Train's four tabs.
- `block-sheet`'s energy and sport chips lost their selected state: active and
  inactive both resolved to their container's own fill, leaving text colour as
  the only cue.
- Train printed next week's planned-vs-target twice, and the season timeline
  printed latest target and actual twice.

### Verification

`scripts/verify-surfaces.ts` mapped Train to `/train`, which is the Week tab
alone — History, Season and Fitness were unreachable by the tool meant to check
them. All four are now captured. **Axe reports 0 confirmed nodes on all four
tabs, in both themes, at both viewports.**

Light mode stays unreachable (`forcedTheme="dark"`) until slice 9, and 2b.4
stays open — it closes at slice 9, not here.

### Also in this release

One unrelated commit: `src/lib/tools/get-wellness.test.ts` hardcoded three
fixture dates against a 7-day query window and began failing every run on
2026-08-13. A permanently red gate costs more than the two tests it fails, so it
was fixed before the remaining tasks ran. It is isolated on
`fix/get-wellness-date-rot` off main.

## v0.100.1 — 2026-08-12 — The glass comes back

A same-day patch on v0.100.0, on owner feedback after using the live app.

**The page had stopped matching its own sheets.** Slice 0 decided glass would
stop being a substrate, and slice 1's Today then moved its blocks onto opaque
surface tokens. But the bottom sheets and the nav pill are still `.glass`, and
so are 44 component files across every other surface — so on the live dark app
the popup was frosted while the page behind it had gone flat. Today's blocks
are back on `.glass`: the hero, the session card, the just-landed block, the
day log, the bed-by card, the week row, the calibration bar, the vitals tiles,
the coach brief, the race and debrief chips, the onboarding card and the header
avatar. Static blocks use `glass-no-hover`; the tappable ones keep the lift
every other page already has.

**The readiness ring is back in the demoted states.** The compact hero shipped
as a bare numeral, and `51` on its own read as one stat among others rather
than as the app's headline signal. It returns at roughly half scale, so the
post-session and evening states still demote it — the ride and the day's log
still lead — without the number losing its identity.

**Light mode's glass is deliberately NOT retuned, and the reason is measured.**
Making it translucent was tried and reverted in the same session: it takes the
axe pass from **378 confirmed / 1559 indeterminate to 8 / 2372**. Nothing was
fixed — 370 findings simply stopped being computable, because axe cannot
resolve a contrast ratio through a translucent background, and `indeterminate`
never gates the exit code. The proof it is blindness rather than success:
`sidebar-nav`'s avatar is a real white-on-white failure on eight light
surfaces, and it moved from `confirmed` to `indeterminate` while staying
exactly as unreadable. Slices 2-8 would have inherited a gate reporting almost
nothing. Dark glass has always been translucent, so putting Today's cards back
on it costs +167 indeterminate and keeps all 378 confirmed findings computable.
Slice 9 lifts `forcedTheme="dark"` and owns light mode; it should set the
retuned value there and re-baseline axe in the same commit.

**A new guard for a hole that has now been opened deliberately.**
`tests/glass-contrast-guard.test.ts` — `--glass-bg` is not a `--surface-*`
token and is not opaque, so `contrast-guard` never read it, and it is once
again the substrate most of Today's text sits on. The new guard composites the
fill over each ground it can sit on and holds every text ink to the same 4.5:1
floor. It also pins two things rather than hiding them: why glass may not sit
on an overlay ground in dark (4.16:1 for muted ink), and the light-mode
deferral above.

## v0.100.0 — 2026-08-12 — Today knows what time it is (Phase 2b.4, slice 1 of 10)

**The first redesigned surface.** Today becomes state-aware: same route, same
blocks, same numbers — only the order and the emphasis change. Morning leads
with readiness. After a session lands, the ride leads. In the evening, the
day's log leads. Nothing is a new figure; every number here was already
computed and displayed somewhere in the app.

**The measured finding that justifies the post-session state.**
`/activity/[id]` was reachable from exactly two places — a row inside Train →
History, and the debrief sheet's close link. Seeing your own laps and streams
after a ride cost Today → Train → History → find the row → tap. Four
activities landed in the telemetry window and the athlete took that path
**zero** times. Today's new "Just landed" block is the first direct route into
that page that does not run through Train.

**Today never fetches.** The block appears exactly when the stream cache is
cold, so a naive implementation would have put a third-party intervals.icu
call and a write burst on the app's most-loaded surface. `getCachedActivityDetail`
is a read-only sibling that returns what is cached and never calls out; a cold
cache simply means no stream sparklines, and the CTA warms it on the
destination page where the wait is expected. That property now has its own
DB-gated regression test, because it is the whole reason the function exists.

**Reorder, never hide.** No state may make content unreachable that another
state shows. `src/lib/today/block-order.ts` owns the sequence and is tested
against _concepts_ rather than raw keys — `heroFull`/`heroCompact`/`heroRecap`
are one block at three emphases. Writing that test immediately caught that
tomorrow's session is a different **day**, not another emphasis of today's,
which is why the evening legitimately renders both.

**Three untested components now have tests** — `today-hero` (which renders the
readiness ring, the app's primary number), `week-row` and `session-card`. That
closes a standing 2b.4 rider from v0.98.0.

**Four defects the whole-branch review caught, each proven by execution:**

1. `variant="done"` announced "✓ Done" for **any** slot during the
   post-session window — a 20-minute commute would have Today claim a planned
   90-minute threshold session was complete, while removing the "Mark done"
   and move/swap/skip controls that would let the athlete correct it.
2. The 12px floor collided the four-across vitals grid inside the morning
   desktop column. Fixed with a container query, not by shrinking type.
3. Today's first-run onboarding branch was never migrated — invisible to every
   capture, because they all ran against an account that has data.
4. "Today's log" could describe a ride from up to 47 hours earlier: the
   post-session window deliberately spans midnight, so it cannot also be
   trusted to mean "today". The day log now carries its own local-day filter.

**Two defects only a human eye could find.** The sync micro-label rendered
near-invisible in light mode, and the week strip's day labels collided into
"MOTUWETHFRSASU" once the floor widened them. Axe reports neither: over this
app's gradient backgrounds `color-contrast` resolves as _indeterminate_, which
never gates. Today measures **0 confirmed axe nodes in dark** across all three
states and both viewports, and it measured that while both defects were live.

**A shared formatter, because two copies had already diverged.** Sleep debt
was formatted by one function in `page.tsx` and a corrected copy in the new
bed-by card; they disagreed on 442 of 6631 minute-values (6.7%) through a
floating-point rounding difference, and both render on the evening screen.
`formatSleepDebt` now lives in `src/lib/sleep-debt.ts` and both call sites use
it.

**A new token, `--coach-ink`.** The mockup paints coach text and the race
outlook with `--chart-4`, which is 4.16:1 on `--surface-raised` in dark —
below the floor this release exists to enforce, and invisible to both guards
(the contrast guard waives `--chart-*` by name; the type-scale guard's AA
floor reads inline styles only). The `--*-ink` suffix puts the new token under
the contrast guard automatically, with no list to maintain.

**Offender counts, the per-slice evidence:** arbitrary type sizes **395 → 351**,
ad-hoc `white`/`black` alpha utilities **806 → 738**.

**Scope, stated plainly.** Two shared components changed because Today embeds
them: `week-strip.tsx` (also on Train) and `race-chip.tsx`, whose block spacing
moved to its call sites — Train's own call site was updated to keep its layout
byte-identical. No route, nav, layout or middleware file was touched. Light
mode stays unreachable (`forcedTheme="dark"`) until slice 9.

**Known and deliberately not fixed here:** `today/checkin-sheet.tsx` is still
dark-only and below the floor (it is an overlay, never captured), and
`sidebar-nav.tsx`'s avatar is a live light-mode contrast failure on eight
surfaces — pre-existing, shared chrome, and not this slice's to migrate.

## v0.99.0 — 2026-08-12 — The app you can read (Phase 2b.4, slice 0 of 10)

**This is the system, not the redesign. No surface was redesigned.** Phase 2b.4
splits into ten slices; this is slice 0, the foundations every later slice is
verified against. The nav, the routes, the tabs and the content of all twelve
pages are untouched.

**The measured finding that justifies it.** The app had no typographic system
and no legibility floor: **395** hardcoded pixel sizes over **26** distinct
values, **284** of them 11px or smaller, the bottom nav at `text-[8px]`. Ink was
eighteen ad-hoc alpha levels on `text-white/N` alone across 447 occurrences,
three of which — `/40`, `/35`, `/30` — compute to **3.77:1, 3.15:1 and 2.61:1**
against `#0a0a0a`, all under the 4.5:1 AA floor. `docs/design-system.md`
documented 83 colour and radius tokens and not one typographic token, because
none existed.

**A real bug this fixes, found by comparing against `main`.** The API-token
success box rendered its _light_ styles, because `.dark` had never been applied
anywhere: token text at **1.02:1**, independently confirmed at 1.04:1 as the
only confirmed node in `main`'s own axe baseline. The box says "Copy this token
now — it won't be shown again." There was nothing legible to copy.

**Pinch-zoom is restored.** It was blocked in **two** places — `layout.tsx`'s
`maximumScale: 1, userScalable: false` and `globals.css`'s
`html { touch-action: pan-x pan-y }` — so removing either alone left zoom broken
while looking finished. WCAG 1.4.4, shipping since v0.1, on an app whose labels
are 10px.

**What shipped:** two complete token sets (`:root` light, `.dark` dark) with
`next-themes` wiring pinned to dark until the final slice; a seven-step type
scale with a hard 12px floor (`12 · 14 · 16 · 20 · 24 · 30 · 44`); a four-step
ink ramp where every text step clears AA in both themes and `hairline` is
structurally barred from text; a 4px spacing scale; four guards; and the
headless-browser capture-and-audit tooling (`npm run verify:surfaces`,
`npm run verify:axe`) that the nine remaining slices are verified with.

**Five deliberate visible changes, each recorded rather than absorbed.**
Presentation may change, claims may not — no figure was added and none claims
more than v0.94 can source.

1. Pinch-zoom works (behavioural).
2. Applying `.dark` for the first time activated **14 `dark:` utilities across
   21 occurrences in 4 files** that had been dead code — including the token box
   above, and `ui/input.tsx`'s `dark:bg-input/30`, which reaches 10 `<Input>`
   uses in 5 settings files (79 raw `<input>` elements are untouched).
3. `.label-micro` (~3.8:1) and `--viz-muted-ink` (~2.7:1) were sub-AA **in dark
   too**; both now resolve to `--ink-muted`, so dark changes.
4. `fitness-tiles` and `train/page.tsx` painted CTL context labels at
   **3.77:1** — the identical value `.label-micro` was fixed from, written in
   two places. Both now `--ink-muted`.
5. `.nav-active-dot`'s `white` → `var(--ink-primary)`, on five phone surfaces.

Dark mode also shifts on **15 token values**, measured exactly against `main`
(`docs/dark-mode-delta-vs-main.md`). The two that matter: `--border` and
`--input` were **1.26:1** against the page — failing WCAG 1.4.11's 3:1 for a UI
component boundary — and are now 3.09:1 worst-case; and `--muted-foreground`
lightens across 21 sites, which is the `.label-micro` fix on a far larger
surface. The app's borders were invisible by the exact standard this release
exists to enforce.

**Verification.** 1730 tests, typecheck, eslint, prettier and `npm run build`
all green. Every guard mutation-checked. A rendered surface-by-surface
comparison against a `main` worktree found **no layout shift on any of 18
comparable surfaces** — every difference is a recolour in place — and no
unexpected change.

**Four things this release knowingly does not cover**, stated because the
alternative is implying otherwise: light mode is unreachable
(`forcedTheme="dark"` until the last slice); the axe pass is a local pre-merge
step, not CI, and its baseline is deliberately non-zero; ~142 colour literals
living outside `style={{}}` are unguarded; and `/activity/[id]` — which the spec
calls "the real finding" — is not audited.

**The process finding, which is the most transferable thing here.** Twenty-four
commits of per-task review, each with a fresh implementer and an independent
reviewer, missed **all five Criticals** that a single whole-branch review then
caught. Every one was a seam or a scope question — a guard that read only the
first of six token blocks; a soundness argument true for Tailwind utilities and
false for inline styles; an exit gate that excluded real failures; a script
defaulting to the live production container; and a constraint nobody had ever
tested against `main`. None was visible from inside a single task.

## v0.98.0 — 2026-08-11 — The tree tells the truth about the IA

Phase **2b.2**, the last item blocking 2b.4 (the visual redesign). No
athlete-visible change: same nav, same routes, same tabs, same pixels.
Design: `docs/specs/2026-08-11-2b2-settle-the-ia-design.md`.

`src/components/` described an information architecture the app stopped having
in **v0.23**. Five directories — `dashboard/`, `plan/`, `log/`, `journal/`,
`health/` — were named for routes that no longer exist and held **41 files: 14
dead and 27 live**. The live ones were the larger problem: dead code is inert,
but **live code at the wrong address is read, reasoned about and maintained**.
`plan/today-card.tsx` proved it — edited on 2026-07-27 by a week-plan refactor
while rendering nowhere at all.

**22 dead components deleted.** Every one had a named live successor, verified
to exist on disk, and four were dead _chains_ removed as units. **No feature
went with them** — the post-ride debrief popup is untouched
(`debrief-sheet.tsx`, `activity-debrief-section.tsx`, `today/sheet-host.tsx`
are all live); the two deleted debrief files were the pre-v0.25.2 inline form
and dashboard card that release had already replaced. Correlations still
render through `body/correlation-rows.tsx`.

`KNOWN_ORPHANS` is now **empty** in both guards. The dead-component guard
stops being a record of 22 tolerated exceptions and becomes a zero-tolerance
ratchet: a new orphan fails with no precedent to point at.

**27 live components relocated.** The rule: a component reached by exactly one
surface lives in that surface's directory; one reached by two or more lives in
a directory named for its domain. Ownership was computed by **transitive
reachability from each `page.tsx`, not by filename** — 22 had one owner, 5 had
two. Those five are week-plan UI drawn by both Today and Train, and they went
to a new `week/`, which carries a README explaining why it is the one
directory not named for a surface. `health/` contained **zero** dead
components: five live files at an address the IA removed, the sharpest single
illustration of the problem.

Every relocation was `git mv`, so history follows and the review question is
sharp: any content change in that diff is a defect. Three relocated files did
change one line each — `availability-week-switcher`, its test, and
`standard-week`, whose relative `./intake-form` and `./block-sheet` imports
became cross-directory when their siblings moved to `week/`.

**A structural guard** (`tests/ia-directory-guard.test.ts`) now fails the build
if any of the five retired directories returns. The tree drifted from the IA in
v0.21 and again in v0.23, both times because nothing prevented it;
documentation did not hold. Its first assertion checks a component tree exists
at all, so moving `src/components/` cannot make it pass vacuously.
Mutation-checked twice, including against an **empty** leftover directory —
`git mv` does not remove the directory it empties, which bit this release
during execution.

**The plan's test inventory was wrong, twice.** It globbed `<name>.test.tsx`
under `src/components/` only. That missed a non-colocated test in `tests/`, an
`.axe.test.tsx`, and a `.test.ts` — three orphaned files that survived the
first deletion pass and were caught by `typecheck`, not by the inventory. The
same blind spot would have stranded `journal-form.axe.test.tsx` and three of
`races-section`'s **four** test files during relocation; the fix was to move
with a prefix glob, verified not to over-match. 12 test files were deleted, not
the 9 planned, and the total suite fell by 50 tests — all of which covered
deleted code.

**Shipped as one release rather than the planned two.** The split existed to
keep deletion and relocation attributable, and that is preserved by five
separate, independently-gated commits. Two tags for two zero-behaviour
refactors would have meant two image builds and two live deploys for nothing.

**Recorded, not fixed:** `today/today-hero`, `today/week-row` and
`today/session-card` have no tests. Five of the nine deleted tests belonged to
their dead predecessors, so removing them cost no effective coverage — but it
made visible that the component rendering the readiness ring, the app's primary
number, is untested. Noted against 2b.4, which redesigns all three.

## v0.97.0 — 2026-08-11 — Score whichever HRV metric arrived

The athlete's HRV reaches Recover by **two independent paths from the same
watch**, at different speeds and in different units:

```text
Zepp → Apple Health → intervals.icu Companion → intervals.icu → Recover
   hrvSDNN → wellness_daily.hrv_sdnn_ms      lands ~06:14 every morning
Zepp → intervals.icu direct                → Recover
   hrv (rMSSD) → wellness_daily.hrv_ms      lands the NEXT morning
```

Recover read only `hrv_ms`. Two consequences, both measured live:

1. **The Today tile blanked every morning.** `latest` was the newest row
   carrying HRV _or_ resting HR. Resting HR arrives on time and rMSSD does
   not, so at ~06:14 `latest` flipped to today's row and the tile went from
   yesterday's real number to "no HRV reading" — **the sync was what made HRV
   disappear.**
2. **Readiness silently dropped its heaviest input.** HRV carries weight
   `0.40`. `computeReadiness` renormalized over the surviving components and
   said nothing. On 2026-08-11 the day scored 68 without HRV and 77 once
   rMSSD landed. Saying nothing is precisely what the goal sentence forbids.

**The two metrics are not interchangeable.** Over the 17 days carrying both,
log-correlation is **r = 0.67** — under half the variance explained — and the
ratio ranges 0.96–1.67. On 2026-08-11, rMSSD 152 sat ~2.5σ above its own
baseline and maxed the HRV component at 100 while SDNN 91 sat ~0.9σ above its
own and scored ~68. **So each metric is scored against a baseline built from
itself.** Substituting SDNN into an rMSSD baseline reads as a crash. Same rule
`resolveEffectiveLoad` already enforces for CTL/ATL: pairs are never mixed.

`resolveEffectiveHrv` (`src/lib/hrv-source.ts`) picks the pair; the winner is
persisted as `daily_metrics.hrv_metric` (migration `0041`, additive) exactly as
`load_source` records which load series won. **`computeReadiness` is
unchanged** — it still takes one value and one baseline and never learns there
are two metrics.

**The Today tile and hero read the stored decision** rather than re-resolving,
so tile and ring cannot name different metrics. Value, 7-day delta and
sparkline all read the same column; the hero's baseline is now
`exp(hrv_baseline_mean)` — the stats of whichever baseline scored the day —
where it used to be a raw 7-day mean of the rMSSD column, which beside an SDNN
reading printed "HRV 91 vs 97 baseline" and invented a deficit. On the SDNN
fallback the tile is labelled **HRV · SDNN**, confidence drops to medium, and
it says why. `calibrationProgress` counts SDNN too — an SDNN-only athlete was
being told "day 0 of 14" while readiness was already scoring them.

**Two defects this branch created and independent review caught**, both worth
recording because neither could fail a test:

- **The tile blanked a real reading while calibrating.** `hrv_metric` is null
  in two different situations — no reading at all, and a real reading whose
  baseline is still short — and treating both as `missing_input` told an
  athlete who measured 88 ms that morning "needs an HRV reading". False, a
  regression on the old tile, and inconsistent with the RHR tile beside it.
  `Figure.calibrating()` was considered and rejected: it is `available: false`
  and would still hide a real measurement. The tile shows a **measurement**,
  not a score — so the value is shown at low confidence with the reason, and
  `missing_input` now means genuinely no reading in either column.
- **`calibrationProgress` has four callers and only one was updated.** The
  widened field was written `hrvSdnnMs?` — optional — so the three stale
  callers compiled clean. An SDNN-only athlete would have seen Today report a
  scored readiness while `/body`, the coach context and the morning brief all
  said "still calibrating", on the same morning. The field is now **required**,
  which turns that silent divergence into a build error; the compiler found all
  four. Same blind spot as the nullable-column trap v0.39 fixed: an optional
  field means omission compiles.

**A pre-existing mislabel, fixed at the source.** HealthKit defines exactly one
HRV quantity type — SDNN — and `apple-health.ts` mapped it into `hrvMs`. An
existing test asserted the bug and had locked it in; it was corrected rather
than worked around. The connector is dormant (its feed died 2026-07-29), so
this fixes it before anyone revives it.

**Four live rows carry SDNN posing as rMSSD** and sit inside the active 60-day
baseline window, skewing rMSSD z-scores today.
`scripts/repair-apple-health-hrv.ts` relocates or clears them — dry-run by
default, `--user` mandatory, no `--all`, `field_sources` written as a jsonb
delta. **Not applied.** That is an operator step on real health data, after
merge. The dry-run matches the measured table exactly: 07-25 relocate 107.54,
then 07-26 / 07-28 / 07-29 clear.

**Published readiness scores can move overnight.** A day scored on SDNN and
recomputed when rMSSD lands will change after the athlete has seen it, and the
coach may already have quoted the old number. Accepted deliberately — Recover
has been bitten by the inverse, a corrected database behind a stale
athlete-facing message — but coach surfaces are out of scope here and will
still quote whatever was current when they wrote.

Not in scope: the coach, MCP tools, `/body` trends, merging the two series, or
reweighting readiness because SDNN is a weaker proxy. Measured against its own
baseline a z-score is a z-score, and a discount would be another uncited
constant. Upstream, the Zepp → intervals.icu pull not firing on its own is real
and not fixable in this codebase.

## v0.96.0 — 2026-08-11 — The guard was counting dead code as alive

Tests, CI config and docs. No product code, no behaviour, no numbers.

**Phase 2d's dead-component guard was under-reporting by seven.** It shipped in
v0.91.0 asking "does any non-test file under `src/` reference this component?"
That question has two holes, both of which hide dead code rather than invent
it, and both were live in the tree:

1. **A reference from a file that is itself dead counted as liveness.** Six of
   the seven. They form chains, not pairs, so one hop would not have been
   enough — `dashboard/animated-counter.tsx` was dead at depth three, behind
   `readiness-rings.tsx` behind `hero-readiness.tsx`. Five of the six were
   imported by a component **already sitting in the guard's own allowlist**,
   so the guard was reading its known-dead entries as evidence of life.
2. **The basename fallback matched a same-named sibling in another
   directory.** `dashboard/vitals-grid.tsx` looked referenced because
   `src/app/page.tsx` imports `@/components/today/vitals-grid`. The guard
   documented an "unrelated string" hazard; this is not that. It is the
   predictable consequence of the unfinished v0.23 migration, which duplicated
   `dashboard/` names into `today/`.

**The fix is a different question, not a patched regex.** The guard now asks
whether a component is _reachable_ from a real entry point — anything under
`src/app` plus the root-level runtime files — resolving specifiers to actual
files on disk and following them transitively. A sibling of the same name can
never stand in, and a chain of dead components cannot hold itself up.
`KNOWN_ORPHANS` goes **15 → 22**.

Neither hole was cosmetic. Had 2b.2 deleted the 15, these 7 would have turned
from invisible into a red build.

**Mutation-tested, because a passing guard proves nothing.** Three mutations,
each confirmed to fail: dropping `vitals-grid` from the allowlist (the
basename-collision case), dropping `animated-counter` (dead at depth three),
and wiring an allowlisted orphan into a live page (the ratchet direction,
which correctly reported it "now reachable from an entry point").

**The counts in `ROADMAP.md` were wrong in both directions** and are now
replaced by a pointer to the mechanism. The item claimed 12 orphans, or 19
counting "PR #86's seven sleep-cards" — five of those seven no longer exist
and the two that remain are live and never were orphans, while the real number
was higher than anything written down. A count summarised into prose goes
stale silently; the guard recomputes its list on every run.

**The bigger finding, for 2b.2 rather than for this release:** 22 components
are dead, but **27 _live_ ones sit in directories the v0.23 IA retired** —
`dashboard/` 5, `plan/` 11, `log/` 5, `journal/` 1, `health/` 5. `health/` has
no dead components at all; the whole directory is live code at an address the
IA no longer has. "Remove the orphans" is the smaller half of 2b.2.

**`docs/specs/2026-08-11-2b2-inputs.md`** collects what that cycle starts
from: the telemetry reading with its three binding caveats, the IA as built,
both lists, the traps (an orphan can still own a type something live imports —
v0.87.0 hit exactly that), and six open questions it deliberately does not
answer. It is an evidence pack, not a design spec.

**CI actions unpinned from Node 20.** `actions/checkout` and
`actions/setup-node` v4 → v7; GitHub was already force-running them on Node 24
and warning on every job. `actions/upload-artifact` and
`download-artifact` deliberately stay at v4 with a comment saying why: they
carry the digest hand-off between the two matrix build legs and the manifest
merge, and the only way to verify a major bump there is a real tag push — a
green PR proves nothing about it.

**Also recorded, not fixed:** three non-component files are unreachable from
any entry point and live only for their own tests — `lib/week-plan/repair.ts`,
`lib/workout-export/week.ts`, `lib/workout-export/zwo.ts`. The last two form a
cluster whose only non-test consumer is each other, which reads as an
unshipped feature rather than debris. The guard covers `src/components/**`
only, so nothing watches this today. Phase 4.

## v0.95.0 — 2026-08-11 — The telemetry gate, lifted at day 4

Docs only. No code, no behaviour, no numbers. A minor rather than a patch
because it changes the roadmap's sequencing: the largest remaining item in
Phase 2 stops being date-blocked.

**The 2026-09-05 gate is gone.** Phase 2b.2 — settle the IA — was held until
four weeks of `surface_views` telemetry had accumulated, a window that opened
on 2026-08-08. The owner lifted that gate at **day 4 of the planned 28**.
This release removes it from every place it was still binding and records why,
because the reasoning for ending a gate deserves to be as legible as the
reasoning for setting one.

**Final reading, 2026-08-11.** 177 views over four days: today 69, train 53,
body 31, coach 13, settings 8, admin 3. Every surface appears on all four days
except settings (3) and admin (2), and the ranking is stable day over day —
today, train and body are the top three on each of the four. Three
instrumented surfaces recorded **zero**: `activity`, `activity-log`, `import`.

**Why four days settle what twenty-eight were budgeted for.** Three arguments:

1. **n=1 does not converge.** The instance has exactly one user. More days add
   observations of the same person, not more people. The window was budgeted
   as though it were a sample; it is a census, and a census is complete on the
   day it is taken.
2. **The zeros were tested, not merely absent.** Four activities landed inside
   the window — two on 2026-08-08, two on 2026-08-09. The athlete trained and
   still never opened `activity` or `activity-log`. That is behaviour, not the
   artefact of a quiet week, and it is exactly the distinction the window
   existed to establish.
3. **The window already spans the weekly cadence.** 2026-08-08 was a Saturday,
   so four days cover a weekend and a Sunday, the weekly review's own beat. No
   surface has a monthly-only cadence — the monthly report lands in the coach
   inbox, counted as `coach`.

**What the lift does not buy, stated so it is not quietly assumed later.**
`import` read zero and that is **not** evidence it is unused: it is a
once-ever surface and would read zero at 28 days too. 2b.2 may not conclude
otherwise from it. The developer-bias caveat the spec demanded still binds in
full — the sole user is also the developer, so the counts show what was being
built — and was never something more days would have fixed. Nothing here
supports a claim about athletes in general; this telemetry could not carry one
at any window length. **If a second user ever joins this instance the census
argument expires**, the counts become a sample of one, and the question should
be reopened rather than settled by citing this reading.

**The gate was documentary, not executing.** Verified before removing it:
nothing in code enforced the date. The reference in
`tests/dead-component-guard.test.ts` is a comment, and that guard remains
shrink-only either way. Removed or annotated in `docs/ROADMAP.md` (the 2b.2
item, the 2d guard entry and the Sequencing section),
`docs/design-system.md`, both affected specs, both uncertainty-vocabulary
plan docs, and that test comment. The two specs are **annotated rather than
rewritten** — the reason the trigger was set is still the right reason, and
deciding without any telemetry would still have been recall dressed as
evidence. What changed is the reading of how much telemetry this particular
question needs. Prior CHANGELOG entries are left untouched as history.

**2b.2 is now the head of the Phase 2 queue**, and per the roadmap it is a
brainstorm → spec → plan cycle in its own right rather than direct
implementation. 2b.4 remains behind it, but on a dependency now instead of a
date: it still redesigns against an IA 2b.2 has to settle first. The four
items previously listed as designated fill stop being fill — the queue is no
longer empty, so they go back to being ranked on their own merits, and the
first of them (`executeIcuTool()` across the icu\_ cluster) is a real defect
that does not become less real for having been listed as something to do
while waiting.

## v0.94.1 — 2026-08-11 — The telemetry window, checked at day 4

Docs only. No code, no behaviour, no numbers.

2b.2 cannot settle before **2026-09-05**, when the four-week `surface_views`
window closes. Reading it now, at day 4 of 28, found nothing wrong — which is
worth recording, because the alternative was discovering a gap in September
with no way to recover the lost weeks.

**160 views so far:** today 67, train 50, body 25, coach 11, settings 6,
admin 1. Three instrumented surfaces recorded **zero** — `activity`,
`activity-log`, `import`. That is real signal rather than a blind spot: they
are wired up and simply not visited, which is exactly the distinction the
window exists to establish.

**Instrumentation is complete.** Every authenticated page calls
`recordSurfaceView`. The only three that do not are `login` and
`join/[code]`, both pre-auth with no user to attribute, and
`src/app/wellness/page.tsx` — a seven-line redirect stub to
`/body?tab=journal` kept for old bookmarks, which has no auth lookup, renders
nothing, and forwards to a page that already records.

That last one was briefly reported as an uninstrumented real page and a
three-line fix was proposed for it. It was not: the claim came from matching
the page list against the instrumentation list without opening the file. The
correction is recorded rather than quietly dropped, because the same
list-matching would produce the same false gap again.

**n=1 is a census, not a sample.** The owner has confirmed they are the only
user of this instance. The existing developer-bias caveat stands — the sole
user is also the developer, so the counts show what was being built — but the
_sample-size_ worry does not apply: one user is 100% of the population. The
question 2b.2 answers is "which surfaces does the only athlete actually use",
and the data answers exactly that. It will not support a general claim about
athletes and must not be written as one.

Retention is 180 days, so nothing expires before the gate.

## v0.94.0 — 2026-08-11 — Every number, not just the exported ones

Phase 2a swept the repo's **77 exported constants** and closed on that basis.
The roadmap recorded, in its own item, that the sweep never reached numbers
written **inline** — which carry exactly the same claims. This is that sweep,
and it closes 2a.

**No number changed value.** Only provenance is new. Where the sourcing showed
a number sits outside published guidance, that is reported below rather than
quietly corrected.

### The item's own example was already fixed

It named `clamp(50 + 2.5 · tsb, 10, 90)` and the green/amber/red thresholds.
v0.87.0 had already given `formScore()` one owner, named
`FORM_BAND_THRESHOLDS`, and sourced both. `blood-pressure.ts` likewise already
cites the 2017 ACC/AHA guideline. Both recorded so they are not swept a third
time.

### Fuelling had no provenance at all

`src/lib/fuelling/` contained **zero `Source:` anywhere** — roughly 20
nutrition figures rendered on the Train page and handed to the coach through
`get_week_plan`. It had no exported constants, which is precisely why 2a
missed it.

Most turned out **genuinely sourceable**, checked against the literature
rather than asserted: during-session carbohydrate sits on Jeukendrup's
per-duration guidance, the 90 g/h clamp is the published ceiling for multiple
transportable carbohydrates, and the post-session g/kg factors track the
glycogen-resynthesis evidence. Fluid volumes are the weak ones and are
labelled Invented/Low — requirement is sweat-rate driven, and Recover does not
measure sweat rate.

Worth recording: the model's **structure** matches the evidence too. It uses
deliberately sub-optimal post-session carbohydrate for short sessions _and_
always adds protein — exactly the case where co-ingestion is documented to
help.

### The session-distribution model, and two findings it produced

The ratios deciding how long the long run is and how a triathlete's hours
divide sat inline in `training-plan.ts`, **beside exported constants in the
same file that each carried a full `Source:` block**. The clearest possible
illustration of the gap.

Two findings are reported, not fixed:

- **The triathlon split matches no published distribution.** Recover uses
  20/40/40; published splits put bike at 40–50% (most say 50) and run at
  20–30%, so Recover's running share is roughly double the cited figure.
- **`RUN_LONG_FRACTION` is not the binding bound for most athletes.** A
  previously undocumented `Math.min` caps the long run at 180 minutes (60 in
  taper), which binds above **9.375 h/week** — so for any higher-volume
  runner the documented "32% of the week" has no effect whatsoever.

Both are now named, documented and pinned. Changing a training prescription
needs its own release, its own view on athletes already mid-plan, and a
decision about varying by race distance.

### Mutation-checking earned this release three times over

- **Nothing pinned any of it.** Raising the long-run share from 32% to 50% of
  the week passed the whole suite. **Inverting the triathlon split entirely**,
  to 50/30/20, also passed.
- **The fuelling tests asserted floors, not values.** Raising the
  long-session carbohydrate recommendation from 60 to 75 g/h — real
  athlete-facing nutrition advice — passed all five.
- **The first fix's own tests could not fail.** They asserted
  `toBe(RUN_LONG_CAP_MINS)` and `toBeCloseTo(TRI_SPLIT.swim)` — expectations
  read from the constant under test, which move with the mutation. Both cap
  mutations survived; the split mutation was caught only by rounding drift.
  Now pinned to literals.

One further note, kept because it is the same shape as v0.88.0's latent
triathlon downgrade: the 90 g/h carbohydrate ceiling is **unreachable**. The
model's maximum is 60 + 15 = 75, so the clamp never fires, and the obvious
assertion (`<= 90`) was vacuous. The test pins the real bound at 75 and the
constant is documented as a pre-placed guard.

## v0.93.2 — 2026-08-11 — Live-DB hygiene, executed

Docs only. No code, no behaviour, no numbers.

v0.93.0 shipped `scripts/live-db-hygiene.sh` and deliberately did not run it,
because writing to the live database is the owner's call rather than a
release step. **The owner ran it with `--apply` on 2026-08-11.** The roadmap
said "deliberately not executed", which is no longer true, so it now records
what actually happened.

`DELETE 2`, `UPDATE 1`, one transaction. Verified independently afterwards
rather than read off the script's own output:

- zero `*.invalid` users remain; three real users
- **zero orphaned `chat_threads` or `chat_messages`** — the `ON DELETE
CASCADE` chain worked as the dry run predicted
- zero stale open weeks, and exactly one open week left: the owner's current
  one, which the date-scoping correctly did not touch

That scoping was the only part of the script able to do real harm — a
mis-scoped `UPDATE` would have closed a live athlete's current week — and it
behaved.

**Two findings this item surfaced that it does not close**, both Phase 4's
measurement and ops work rather than 2d's:

- The instance reports `backupAgeS` as `null`. No successful backup has ever
  been recorded, so there was nothing to restore from had this gone wrong.
- The `*.invalid` rows were a **symptom, not the defect**. Something pointed
  a test run at production on 2026-07-27; deleting the rows removed the
  evidence without removing the cause. This machine's `.env` points at 5435,
  so it was not a plain local `npm test`.

## v0.93.1 — 2026-08-11 — Correcting v0.93.0's completeness claim

Docs only. No code, no behaviour, no numbers.

v0.93.0 said Phase 2's pre-gate work was finished, and that "2a, 2c and 2d
are all closed". 2c and 2d are. **2a is not.**

2a's sweep of all 77 exported engine constants closed, and the roadmap
records — deliberately, in its own item — that the sweep never reached
numbers written **inline**, which carry the same claims. `clamp(50 + 2.5 ·
tsb, 10, 90)` and the `>= 67` / `>= 34` band thresholds decide whether an
athlete sees green, amber or red, and they carry no source and no confidence
while every exported constant does. That item is open, and it is **not**
gated on the 2026-09-05 telemetry date. It is the next thing to take.

The failure is worth more than the fix: an item written down expressly so
this would not happen was skipped anyway, because the summary line was
composed from memory of the last release rather than by re-reading the
checkboxes. The same line had already been stale for three releases when
v0.88.0 corrected it from "four remaining slices". Both corrections are kept
in place in `docs/ROADMAP.md`, and the instruction to re-read before
summarising is now written into that section.

## v0.93.0 — 2026-08-11 — Phase 2's pre-gate work closes

The last two items in 2d, which closes 2d.

Ships no application code.

**Correction to this entry as first written**, made the same day and left
here rather than edited away, because the mistake is the one the roadmap
exists to prevent. It claimed Phase 2's pre-gate work was finished and that
"2a, 2c and 2d are closed". 2c and 2d are. **2a is not:** its
exported-constant sweep closed, but the inline numeric literals item it
deliberately left open — the one recording that
`clamp(50 + 2.5 · tsb, 10, 90)` and the green/amber/red band thresholds
carry no source while all 77 exported constants do — is still open, and is
not gated on the telemetry date. It is the next thing to take.

The roadmap's sequencing line has now been wrong twice in six releases, both
times by summarising the checkbox list from memory of the last release
instead of re-reading it. That instruction is now written into the section
itself.

### Into `RELEASING.md`

Three steps, each carrying the evidence from v0.87–v0.92 rather than stated as
principle.

**Mutation-check every test that guards a bound.** It caught something reading
the test could not **three times in six releases**: a fixture whose value
equalled the default it existed to beat (v0.89.0); a hardcoded `stale: false`
that passed because the tested path genuinely was fresh (v0.90.0); and a
`Map.get(k)?.ctl` indirection invisible to a guard's detector (v0.92.0). The
recurring cause is now named — a fixture that cannot distinguish the two
things the test exists to tell apart — and a surviving mutation is framed as
a finding worth the release notes, not a nuisance.

**Assert wiring at the surface, not at the component.** A component test
proves the component renders what it is handed; it cannot prove the page or
the MCP tool hands it the right thing. Points at `tests/curve-tools.test.ts`
as the pattern for running the real path, and requires an untestable surface
to be **said out loud** in the notes rather than implied covered.

**Write release notes from the diff, not the plan.** Every release in that run
had a headline its plan did not contain.

### Live-DB hygiene

Both flagged items were confirmed against the live database, read-only:

- `test-coach-inbox-user` and `test-coach-inbox-other-user` were created in
  **production** on 2026-07-27, carrying one chat thread and one message. Every
  FK to `users` involved is `ON DELETE CASCADE`, so removal is contained.
- The demo account's `2026-07-13` week is the only `open` week older than the
  current one. The owner's July weeks all closed on cadence.

`scripts/live-db-hygiene.sh` does both. It **defaults to a dry run**, printing
exactly what it would change and writing nothing without `--apply`, and its
`UPDATE` is scoped by date so it can never close a current week for anyone.

**It was deliberately not executed.** Writing to the live database is the
owner's call, not a release step — and the instance still reports
`backupAgeS` as `null`, meaning no successful backup has ever been recorded.
Worth fixing before running any destructive script, this one included.

## v0.92.0 — 2026-08-11 — The read-site guard, and a plan's starting load

Phase 2d's second guardrail, plus the four read sites building it uncovered.

`daily_metrics.ctl` is the resolved authority: the provider's value wins when
present, and Recover's native engine fills the gap from activities.
`wellness_daily.ctl` arrives from intervals.icu and nowhere else. So an
athlete with **no intervals.icu connection** has a real, computed
`daily_metrics.ctl` and an empty `wellness_daily.ctl`.

v0.86.0 migrated five coach- and MCP-facing surfaces off `wellness_daily`. It
migrated no UI surface, and four sites were left.

**A plan's starting load was a guess for these athletes.** The most
consequential of the four, `week-plan/start-state.ts`, read `wellness_daily`
for a plan's starting CTL/ATL. Null for a manual-only athlete, so the tier
cascade fell through to a rolling estimate or — failing that — the hardcoded
`GLOBAL_FALLBACK` pair of **30/40**, a constant standing in for a figure
Recover had already computed. The other three sites only showed a blank; this
one fed plan generation.

The other three: the Train page's CTL/ATL/TSB tiles and 28-day delta, the PMC
chart fed by the same array, and `volume-inputs.ts`'s `ctlBuckets`, which
feeds `athleteLevel()`. That last one degraded honestly rather than wrongly —
`peakOf()` treats an all-zero window as `null`, so the athlete read
"calibrating" rather than a wrongly-low level — but they stayed calibrating
**forever**, and never earned a computed volume ceiling.

**An athlete with intervals.icu connected sees no change**, since the
provider's value already wins inside `daily_metrics`.

### The guard found the fourth site itself

The survey that preceded it found three. `start-state.ts` restricted its
query — `columns: { ctl: true, atl: true }` — rather than reading `.ctl`, so
a grep for read sites had nothing to match. The guard's binding-aware
detector saw it at once.

That detector is deliberately not a substring match. A bare `.ctl` scan flags
`daily_metrics` rows, which is the _correct_ code; a "queries wellnessDaily
and mentions `.ctl`" heuristic flags `train/page.tsx` and `volume-inputs.ts`,
which legitimately read both tables, sometimes through a loop variable of the
same name. So it tracks which locals are bound to a `wellnessDaily` result
and checks only scopes derived from that binding, plus two unambiguous forms.

`strava-describer.ts` is allowlisted rather than migrated, with the reason in
the file: its path is gated twice on `provider === "intervals_icu"`, so an
athlete reaching it necessarily has the connection.

### One mutation survived

Removing `metrics.ts` from the allowlist initially passed — its
`byDate.get(date)?.ctl` Map indirection was invisible to the detector, a
shape that could have been reintroduced anywhere undetected. The detector now
traces that hop, re-verified across every non-test file in `src/` with no new
false positives.

`tests/training-plan.test.ts` seeded only `wellness_daily` and asserted a
starting CTL of 55; without a `daily_metrics` row it now returns the 30
fallback. That is the defect stated as a test, and the fixture seeds both.

## v0.91.0 — 2026-08-11 — The dead-component guard

Phase 2d's first guardrail. Two tests, and the second is what keeps the first
honest.

The first walks every non-test `.tsx` under `src/components` and fails when
nothing else under `src/` references it. The second is a **ratchet**: every
entry in the allowlist must still _be_ orphaned, so an allowlisted component
that gains a render site — or gets deleted — fails the build until its entry
goes. The list can only shrink. That is the difference between an allowlist
and a dumping ground.

It ships with **15** entries, because a guard that fails on day one is a
guard someone deletes. That count was scanned fresh rather than carried
over: earlier notes said 19, which predates v0.87.0 deleting
`RaceCountdownCard` and other removals since.

**These are superseded predecessors, not lost features.** Spot-checked rather
than assumed — debriefs still render through `today/debrief-chip.tsx` and
`activity-debrief-section.tsx`, so `pending-debrief-card.tsx` is a leftover
rather than a feature that silently stopped appearing. No athlete is missing
anything because of this list.

**The cost is real anyway, and `plan/today-card.tsx` is the proof.** It was
edited on 2026-07-27 by _"refactor(week-plan): a day carries blocks and a
list of workouts"_ — someone read it, reasoned about it and updated it, for a
component that renders nowhere. Dead components do not sit quietly; they get
maintained.

`src/components/ui/` is in scope rather than exempt. An unused vendored
primitive is still code that is typechecked, linted and read by people.

**Deleting the 15 is deliberately not in this release.** Disposal is Phase
2b.2's decision, which cannot settle before 2026-09-05 — it depends on the
four-week `surface_views` telemetry window that opened on 2026-08-08. Some
may be worth reviving rather than deleting, and that is a product call made
with usage data, not a cleanup decided by a guard test. The guard's job is to
stop the list growing.

Mutation-checked, all four caught: a new unreferenced component; removing a
genuinely-orphaned entry from the allowlist; allowlisting a component that is
referenced (the ratchet names the referencing file); and allowlisting a path
that does not exist.

Its limitation is stated in the file rather than implied, as the uncertainty
guard states its own: reference detection is a text match, so it misses a
component reached only through a dynamically-built import. A pass is evidence
against the common case, not proof of liveness.

## v0.90.0 — 2026-08-11 — Athlete curves, and 2c closes

The last slice on Phase 2c's enumerated list. **Every number slice is now
ticked**, which means the sweep that produced that list on 2026-08-10 — all
57 registry tools plus the UI and coach-context surfaces — has been worked
through end to end.

The sweep expected this slice to be verification-only, and was nearly right.
`athlete-curves.ts` is one owner, the cache is documented in `schema.ts`, and
`available`/`stale`/`fetched_at` were already an explicit unknown state.
`tests/athlete-curves.test.ts` already covered cache miss, fresh hit, TTL
expiry and stale-on-error.

**What was missing was condition 4.** The three MCP tools exposing these
figures — `get_power_curve`, `get_pace_curve`, `get_best_efforts` — had no
tests at all. Nothing asserted the shape the coach actually receives: the
rounding each tool applies, the passthrough of `stale` and `fetched_at`, or
`get_best_efforts`' case-insensitive sport filter and its `count`.

The new tests run the **real** read path rather than mocking the owner. A
seeded connection plus a fresh `athlete_curves` row makes `cachedFetch()`
short-circuit before any fetch, so the tool, the owner and the database all
execute with no network. Mocking `@/lib/athlete-curves` would have proved
nothing about the read path, which is exactly what condition 4 exists to
test.

**One mutation survived, and it was worth the slice on its own.** Hardcoding
`stale: false` in `get_power_curve` passed every assertion — on a fresh-cache
hit `stale` is genuinely `false`, so the test could not tell a wired flag
from a constant. A coach reading a curve has no way to know it is hours or
days old if that flag is dead.

Seeding a row past the TTL fixes it: the real fetcher runs and fails under
the test suite's network block — which is the production shape of
intervals.icu being unreachable — and the owner serves the expired row with
`stale: true`. The data still comes through, because a stale PR curve beats
silence. That mutation now fails.

This is the third release in four where mutation-checking found something
reading the test could not.

## v0.89.0 — 2026-08-11 — Display-derived figures

Phase 2c's second-to-last number slice. **No athlete sees a different number
after this release** — both duplications were checked for divergence and
neither had produced one. This is a drift guard, and saying otherwise would
overclaim.

Two of the four figures in this slice were already sound, re-verified and
recorded so they are not swept a third time: **body battery** has one
consumer, and **correlations** has one producer. The other two were the same
assembly written twice.

**Sleep debt** was built independently by `app/page.tsx` and
`app/body/page.tsx` — character-identical apart from variable names.
`body/page.tsx` carried a comment asserting the two "can't disagree", which
was true by coincidence rather than by construction. `sleepDebtFrom()` makes
it structural.

That consolidation surfaced a genuine trap. `computeSleepDebt()` truncates
its input with `slice(-DEBT_WINDOW_DAYS)` — the last 14 **elements** — while
both call sites filtered on **date**. Those agree only when wellness rows are
dense; with gaps (a provider outage, a new athlete, anyone who does not sync
daily) fourteen rows can span months, and a caller who reasonably assumed the
function owned its own window would get a quietly wrong figure. The date
filter now lives in the owner; the slice stays as a safety net rather than
the definition.

**Bio-age** was built independently by `app/body/page.tsx` and the
`get_biomarkers` MCP tool — the same ~20 lines, including the
`reverse().find()` latest-non-null searches and the 30-day sleep-consistency
window. This is the UI-vs-MCP divergence shape v0.86 removed from five
surfaces, caught this time before it produced a discrepancy. Both were
checked for the difference that would have made it a live bug — an unequal
query window — and both fetch 90 days and filter nights to 30.

Each surface keeps its own presentation: `Figure<BioAgeResult>` on the page,
`{ status: "insufficient" }` on the tool. Collapsing those would be a surface
change, which Phase 2's non-goals rule out.

**Mutation-checked**, and one mutation **survived on the first attempt**: a
fixture's custom sleep need happened to equal `DEFAULT_SLEEP_NEED_SECS`, so
an owner that ignored the athlete's preference entirely was invisible to the
test. The fixture now uses a distinct value chosen to produce a different
outcome. A test whose fixture coincides with the default it is meant to
distinguish is not a test — worth recording, because reading it would never
have shown that.

## v0.88.0 — 2026-08-11 — Event demand

Phase 2c's **Event demand** number slice. The survey expected it to be short,
and the ownership half of it was: `eventDemand()` already had one owner, one
call site (`week-plan/volume-inputs.ts`), and an explicit rendered unknown
state — conditions 1, 2 and 5 held before this release began. What the slice
found instead was a claim nobody had ever tested.

**A triathlete was being told to fix something that has no fix.** When a
triathlon's demand figure came back at low confidence, the sentence shipped
with it read _"set your thresholds in Settings for a sharper figure"_. An
athlete who had already set their FTP and their threshold pace would read
that as advice to redo what they had done — and it could not have raised the
rating anyway. A triathlon's confidence requires `swimPace.athleteSet`, and
there is **no athlete-set swim pace anywhere in this codebase**: no
`body_prefs` column beside `ftpWatts` and `thresholdPaceSecPerKm`, no
Settings control, and `volume-inputs.ts` supplies swim pace only from
`swimPaceFromHistory()`. The sport is structurally pinned at low.

The sentence now names the swim as the anchor that is always derived, and
keeps the nudge toward FTP and threshold pace — which genuinely do sharpen
the bike and run legs — without promising a better rating. It had no test,
which is how it stayed wrong.

**The salvaged triathlon downgrade is unreachable, and is kept as a latent
guard rather than shipped as live behaviour.** The rule rescued from
`feat/v0.65-mcp-contract-hardening` before that branch was deleted drops a
fully anchored triathlon from medium to low, because swim, bike and run
anchors interact. It fires only on medium — which, per the pin above, a
triathlon cannot currently reach. The disposition doc said neither the code
nor its test would be adopted without review; this is that review finding
something. It is kept, and documented as latent, because the day a swim
anchor is added the sport would jump from low straight to medium as a side
effect of an unrelated feature, and this is what stops that silent
promotion.

**Condition 4 — asserted at the surface.** `get_races` gained two seeded
athletes, one per outcome, both running the real path through Postgres:

- A Bike athlete with an athlete-set FTP reads `medium`. **Nothing had ever
  exercised that branch.** Both existing users have no set anchors, so a
  regression mapping every FTP to `athleteSet: false` would have passed the
  entire file. This was not found by reading — it was found by mutation:
  retargeting the downgrade from `"Triathlon"` to `"Bike"` killed one test
  where it should have killed two.
- A triathlete who has set everything settable still reads `low`, and the
  note names the swim.

**Condition 6 — mutation-checked**, six mutations, all killed: removing the
downgrade; inverting `allAnchorsAthleteSet`; retargeting the downgrade's
sport; mapping an athlete-set FTP to `athleteSet: false`; rewriting
`ANCHOR_SET_COPY.Bike`; and restoring the old triathlon sentence.

Also in `docs/RELEASING.md`: vitest does not load `.env`, so a bare local
`npm test` silently skips every DB-gated suite. That is the mechanism behind
v0.87.0's false CI finding, and it was not written down anywhere.

## v0.87.2 — 2026-08-10 — Correcting v0.87.0's CI claim

Docs only. No code, no behaviour, no numbers.

**v0.87.0's release notes, its PR, `docs/ROADMAP.md` and `docs/RELEASING.md`
all asserted something false:** that `raceCard()` and `simulateRaceForm()`
had zero executing coverage in CI "because their only tests are DB-gated and
CI runs without a database". CI has a `postgres:16-alpine` service and runs
all 2163 tests with **zero skipped** — and has since 2026-08-04, commit
`62c3ab2`, _"ci: give the test job a database"_. Both owners were guarded the
whole time.

The error came from a reviewer running the suite locally with `DATABASE_URL`
unset, calling that "the CI condition", and nobody opening `ci.yml`. It was
checked against a note about the CI config written 2026-08-02 — two days
before the database was added — rather than against the file. The reviewer
even recorded that the mutation _fails_ when a database is present, which is
exactly CI, and that reading was missed.

Withdrawn with it: the generalisation that every earlier slice behind a DB
gate has the same hole. It does not. That claim was about to scope a release
of guard work against a problem that does not exist.

`src/lib/race/outlook-figure.ts` — the pure `ForecastResult → Figure` mapping
extracted in response — is kept. Separating the mapping from DB assembly is
defensible on its own merits. It fixed nothing, and the record now says so.

`RELEASING.md` gains what should have been there instead: what CI actually
is, that a `skipIf(!hasDb)` block **is** a real guard there, and that a local
run with `DATABASE_URL` unset is the weaker run rather than the authoritative
one. The v0.87.0 roadmap entry keeps its false finding, marked as corrected,
because how it survived a whole-branch review is more useful than the claim.

## v0.87.1 — 2026-08-10 — The Train header fits a phone

The planning switches outgrew the slot they were in. `TrainHeader` lays the
title row out as `justify-between` with a single right-aligned `action`, and
that slot had accumulated three controls: the week chip, Style and Season —
roughly 300px of pills that cannot shrink or wrap. On a 390px phone they ran
off the right edge, collided with the "Train" heading, and "Block-lite"
wrapped inside its own pill.

`action` now takes one compact element and is marked `shrink-0`. A new
`controls` slot renders a full-width wrapping row beneath the title, above
the tabs, and both switches moved there. Verified in a real headless browser
at 390px against the app's own compiled stylesheet — the layout is the kind
of thing this project has shipped bugs in twice by reasoning about CSS
instead of looking at it.

Also says what the switches do, which they never have. Both write plan
constraints and stop; the open week is already materialized in `week_plans`
and nothing recomputes it, so this week keeps the sessions it has. The
next-week preview lower down the page _does_ re-read constraints, so the
effect is visible immediately — just not where an athlete would look first.
The controls now carry one line saying so: **"Applies from next week — this
week is already planned."** Presentation only; no behaviour and no number
changes.

## v0.87.0 — 2026-08-10 — One source of truth: race-day form and feasibility

Fifth number slice of Phase 2c (`docs/ROADMAP.md`). Design:
`docs/specs/2026-08-10-race-form-projection-feasibility-ownership-design.md`.

This slice was not in 2c's original six entries. The 2026-08-10 sweep of all
57 registry tools against 2c's own definition of an athlete-facing number
found it missing, and it turned out to hold the largest remaining defect.

**The projection was computed once and rendered four ways.** `forecastForm()`
was already pure and single-owner; every problem sat above it. `page.tsx` and
`train/page.tsx` each built the race card inline — the same ~35 lines,
character-identical apart from variable names — while `plan/actions.ts`
flattened "no projection" to a boolean with nulled fields and the
`simulate_plan_change` tool wrote its own prose for it. Four encodings of one
unknown state. New `raceCard()` and `simulateRaceForm()` in
`src/lib/race/outlook.ts` own both paths; the two pages and the two what-if
callers are now thin.

**A qualification that had been lost is back.** `forecastForm()` sets
`capped` when the plan ends before race day, which means the figure is the
projection at plan end, not at the race. `RaceCountdownCard` used to say so;
the `RaceChip` that superseded it dropped the caveat, so Today and Train
showed a plan-end TSB labelled as race-day form. It is rendered again, on
every surface — the chip, the day-actions preview, and the MCP tool — and
this time a test fails if it disappears. `RaceCountdownCard` itself is
deleted: zero non-test render sites, kept alive only by its own test suite,
and the last thing blocking the dead-component sweep from touching it.

**Feasibility says which input is missing.** `assessFeasibility()` returned
`null` both when there was no tracked race and when there was no measured
training history, and three call sites wrote the same guard inline. New
`feasibilityFor()` returns `Figure<Feasibility>` naming the actual reason —
a tracked race with computable demand, a race date to count back from, or
measured training history — and the Train surface states it instead of
rendering nothing. `assessFeasibility()` itself is unchanged.

**One owner for the form score.** `clamp(50 + 2.5 · tsb, 10, 90)` was written
out in both `readiness.ts` and `race/forecast.ts`. Both now call
`formScore()`. The band cutoffs get one owner too, documented as a scale
applied to two different scores — the composite readiness and the form score
alone — rather than one figure computed twice: a green form outlook and a
green readiness are different claims wearing the same colour. Both were
inline numeric literals, which is why Phase 2a's sweep of _exported_
constants never reached them; both now carry source and confidence, and the
gap is recorded as an open 2a item.

The projection is rated **Confidence: Low**, and the release writes down why:
Medium-confidence EMA constants, a definitional TSB, then two unsourced
transforms, planned loads that may not be executed, and a horizon that may
not reach the race. Low is the honest ceiling.

**Athlete-visible changes are limited to two additions and one restoration.**
The capped qualification, the split feasibility reasons, and `loadDelta` —
which is computed from planned loads alone and so is knowable without
CTL/ATL, but had been lost from the preview's unavailable state. No band,
TSB or verdict changes value.

### Verification

- Equivalence pinned, not assumed: a permanent un-gated test reconstructs the
  three pre-migration feasibility guards from the pre-migration commit and
  asserts they agree with `feasibilityFor()` across every missing-input branch
  and every verdict rung. Swapping two arguments inside the owner fails it.
- Mutation-checked throughout: breaking `formScore`'s slope fails tests in both
  files that now share it; deleting any of `feasibilityFor()`'s three guards
  fails a different named test; removing the capped caveat fails at both the
  mapping and the component.
- The whole-branch review caught what the per-task reviews structurally could
  not: `raceCard()` and `simulateRaceForm()` had **zero executing coverage in
  CI**, because their only tests are DB-gated and CI runs without a database —
  hard-coding `capped: false` left the suite byte-identically green. The pure
  `ForecastResult → Figure` mapping now lives in `race/outlook-figure.ts`,
  which reaches no database and is therefore tested un-gated. The mutation now
  fails without a database, which is the condition that matters.
- Full suite with `DATABASE_URL` unset: 1652 passed, 511 skipped, no crash.
  With a database: 2162 passed, 1 skipped.

## v0.86.0 — 2026-08-10 — One source of truth: CTL/ATL/TSB and readiness

Fourth number slice of Phase 2c (`docs/ROADMAP.md`). Investigated broadly
first (`docs/specs/2026-08-10-ctl-atl-tsb-readiness-ownership-design.md`):
readiness (`computeReadiness()`) was already single-owner — no change
needed there.

Two real issues found and fixed in CTL/ATL/TSB:

- The EMA recurrence itself (`x = x + (load - x) / days`) was duplicated
  three times: `training-load.ts`'s historical fill, `race/forecast.ts`'s
  future projection, and `morning-insight.ts`'s single decay step.
  Consolidated into one `advanceLoadEma()` function all three call.
  Behavior-preserving — verified against existing test suites, including
  the DB-backed morning-insight integration test.
- Five surfaces read `wellness_daily.ctl`/`.atl` directly instead of the
  resolved `daily_metrics` figure (provider value, or the native engine's
  honest computation when there's no intervals.icu sync) — the same
  "manual-only athlete gets nothing" defect class v0.10 (Honest Load)
  fixed for the dashboard, recurring in coach- and MCP-facing surfaces
  that were never migrated:
  - `get_fitness_summary` and `get_training_load_summary` (MCP tools):
    returned `null` for a manual-only or Strava-only athlete.
  - `weekly-review.ts`: worse — `?? 0` fallbacks meant a **fabricated
    zero** CTL/ATL/TSB in the weekly review message.
  - `coach-context.ts`: the coach's own system-prompt Training Load
    section was omitted whenever the athlete's most recent HRV/RHR/sleep
    row happened to lack ctl/atl, even on a day the native engine had
    resolved a real number.
  - `get_wellness` (MCP tool): returned the raw per-day provider figure
    instead of the resolved one.

  All five now read `daily_metrics`. `eftp` (intervals.icu-only, no
  native equivalent) still reads from `wellness_daily`.

Two new MCP tool test files and a new coach-context test (previously
zero coverage of this code path) — proved via git-stash mutation testing
that reverting the fixes reproduces the exact old bugs with clean,
isolated test failures. A pre-existing test (`tests/load-summary.test.ts`)
updated to seed `daily_metrics` instead of `wellness_daily`, matching the
new read path.

Verified against a real isolated Postgres (matching CI's service config):
full suite 2130 passed / 1 skipped (2131 total). Independent review —
including an exhaustive final sweep of every remaining `wellness_daily`
read in the codebase — found zero remaining instances of this defect
class and no issues with the fix.

## v0.85.0 — 2026-08-10 — One source of truth: adherence and completion

Third number slice of Phase 2c (`docs/ROADMAP.md`). Investigated broadly
first (`docs/specs/2026-08-10-adherence-and-completion-ownership-design.md`):
`weekAdherencePct()`, `weekActuals()`/`deriveDayActuals()`/
`bookWeekActuals()`, and the cache-only
`trainingBlocks.actualLoad`/`actualSessions`/`adherencePct` columns were
already single-owner since v0.44.0/earlier work — no duplication found.

- Found and fixed a real bug: the Train page's season timeline computed a
  season-to-date adherence percentage by summing every week's target and
  actual load, but a week with an unknown target contributed 0 to the
  target sum while its real actual load still landed in the actual sum
  unconditionally — silently inflating the figure for any week trained
  without a materialized plan target.
- Fixed to exclude such weeks from both sums (pairwise), not zero-fill
  one side. Verified the new test genuinely catches the bug: reverting
  the fix reproduces the old (wrong) 125% instead of the correct 75% on
  the same fixture.
- 2 new tests. Zero regressions: same-environment before/after 1622 →
  1624 passed, 495 skipped unchanged.

## v0.84.0 — 2026-08-10 — One source of truth: volume and hours

Second number slice of Phase 2c (`docs/ROADMAP.md`). Investigated broadly
first (`docs/specs/2026-08-10-volume-and-hours-ownership-design.md`):
planned minutes (`plannedMins()`) and target hours
(`weeklyTargetHours()`/`assembleWeeklyTarget()`) were already single-owner
since v0.38.0. `constraints.hoursPerWeek`'s ~60 read sites were audited and
left alone — a genuinely different question (the plan's own configuration,
not what a given week holds).

- Found and fixed the one real duplication: `src/app/page.tsx` and
  `src/app/train/page.tsx` both independently summed
  `days[].availableMins` into hours as the `availabilityHours` input to
  `assembleWeeklyTarget` — the same drift risk `plannedMins()` was created
  to prevent in v0.38.0, recurring for availability instead of planned
  minutes.
- New `availableMins(days)` in `week-plan/fill.ts`, alongside
  `plannedMins()`. Both call sites migrated. No behavior change — verified
  mathematically identical and via a same-environment before/after test run
  (1619 → 1622 passed, +3 new tests, zero regressions).

## v0.83.0 — 2026-08-10 — One source of truth: week target load (slices 2-4)

Closes Phase 2c's first number slice (`docs/ROADMAP.md`) — slices 2, 3, and
4 shipped together in one release. Every display, MCP tool, and coach-facing
read site for "what does this week target" now resolves through
`weekTargetLoad()` (slice 1, v0.82.0) instead of reading
`trainingBlocks.targetLoadTotal` or `weekPlans.effectiveTarget` directly.

Real bugs fixed — a materialized week's more accurate effective target was
being shadowed by its un-tapered skeleton value:

- `get_training_plan` (MCP tool): both the week-detail and plan-overview
  responses now report the resolved target.
- `get_plan_drift` (MCP tool): the open week's reported target was named
  `skeletonTarget` but the tool's own description promised "effective
  target" — it now actually resolves and reports that figure, renamed to
  match. Previously had zero test coverage; now has two tests.
- Weekly review's plan-adherence percentage no longer computes from the
  block's skeleton target alone — it can now reflect a taper or
  low-adherence adjustment the skeleton value doesn't carry.
- The Train page's "remaining weeks" table showed the open week's skeleton
  value even after it materialized with a different effective target.

New `resolveBlockTargets()` in `week-plan/service.ts` batches the
resolution across a plan's blocks in one query, shared by both MCP tools.

Deliberately unchanged, with reasoning documented at each site:
`race/debrief.ts`'s taper-execution stat (uses the week's final
post-adjustment figure, a different and already-correct question),
`get_plan_drift`'s past-week drift comparison (measures drift FROM the
original skeleton on purpose), `update-training-plan.ts`'s block-target
write path (the week quick actions' underlying mechanism — its re-enable
decision stays deferred), and the export/import round-trip (a backup
should restore raw values, not a resolved derivative).

`docs/BASELINE.md` updated: the quick-actions decision is now cleanly
answerable, but picking it up is still a deliberate follow-up.

Full design: `docs/specs/2026-08-10-week-target-load-ownership-design.md`.
Verified against a real isolated Postgres (matching CI's own service
config), not just typecheck: full suite 2113 passed / 1 skipped (2114
total), zero regressions. Independent review re-derived every claim from
the diffs and source files directly, including the two highest-risk
correctness questions (the weekly-review timing of `activePlan.currentWeek`,
and the plan-drift tool's deliberately-unchanged skeleton comparison) — no
issues found.

## v0.82.0 — 2026-08-10 — One source of truth: week target load (slice 1)

First number slice of Phase 2c (`docs/ROADMAP.md`): `weekTargetLoad()`, a
new shared read path in `week-plan/volume.ts` for "what does this week
target" outside adherence. Prefers `weekPlans.effectiveTarget` once a week
has materialized, falls back to `trainingBlocks.targetLoadTotal` for weeks
that haven't — the same fallback `weekAdherencePct` already used, now
shared via one private helper instead of duplicated. Returns
`Figure<number>` (the Phase 2b.3 uncertainty vocabulary) so "neither
resolves" is explicit rather than a silent null.

- `weekAdherencePct` refactored to call the same shared resolver — zero
  behavior change, its existing tests pass unchanged.
- `trainingBlocks.targetLoadTotal` and `weekPlans.effectiveTarget` documented
  in `schema.ts` as cache/authority: the block target is authoritative only
  until a week materializes, after which the week's own frozen figure wins.
- This slice does not yet migrate any of the 87 existing read sites (race
  domain, MCP tools, weekly review, UI, export) — that is slices 2-4. The
  week quick actions (Ease/Deload/Boost/Skip) re-enable decision stays
  deferred, a product choice this work unblocks but doesn't make.

Full design: `docs/specs/2026-08-10-week-target-load-ownership-design.md`.
No regressions: full suite 1619 passed / 493 skipped (2112 total), +4 tests.

## v0.81.0 — 2026-08-10 — Provenance: closing Phase 2a

Eighth and final slice of Phase 2a (`docs/ROADMAP.md`): source, confidence,
and scope for 12 exported constants across `coach-memory.ts`, `recall.ts`,
`debrief/lifecycle.ts`, `debrief/ride-review.ts`, `race/debrief.ts`,
`weekly-review.ts`, `athlete-curves.ts`, and `availability/types.ts` — the
remaining scattered long-tail files named in v0.80.0's forward estimate.
No values changed — documentation only.

- All 12 constants are labelled **Invented**, Confidence: Low, each traced
  to the design doc that originally set it (v0.4a coach-core, v0.4c MCP
  depth, v0.14 race-ready, v0.15 coach-remembers, or the availability
  scheduling redesign) rather than external research.
- `export/export-user.ts`'s `EXPORT_VERSION` and
  `components/plan/wheel-column.tsx`'s `ITEM_HEIGHT` — both "to be
  confirmed" in v0.80.0's forward estimate — resolved to zero in-scope
  constants: a schema/format-version identifier and a UI layout pixel
  value, neither a numeric behavioral claim.
- `weekly-review.ts`'s `WEEKLY_THREAD_TITLE` and `availability/types.ts`'s
  `ENERGY_CEILING`/`SUBSTITUTE_TO` were deliberately excluded — categorical
  mappings and a display identifier, not numeric claims.

Every exported engine constant surveyed since v0.74.0 now carries source,
confidence and scope, or an explicit documented exclusion. Phase 2a is
closed.

## v0.80.0 — 2026-08-09 — Provenance: plan/prediction engine constants

Seventh slice of Phase 2a (`docs/ROADMAP.md`), the second into the long
tail: source, confidence, and scope for 12 exported constants across
`insights/correlations.ts`, `week-plan/anchors.ts`,
`week-plan/ctl-projection.ts`, and `training-plan.ts` — grouped as
"how much data (or session length) before this number can be trusted"
gates inside the plan/prediction engine. No values changed —
documentation only.

- All 12 constants are labelled **Invented**, Confidence: Low.
  `insights/correlations.ts`'s `MIN_EVENTS`/`WINDOW_DAYS` are retained
  conventions from an earlier version, not freshly derived.
  `week-plan/anchors.ts`'s `ANCHOR_CONSTANTS` transcribes ratings already
  published in an earlier evidence doc. `training-plan.ts`'s bound
  constants trace to an uncited cycling-coaching convention; the rest are
  explicitly retained legacy values that introduce no new claim.
- `training-plan.ts`'s `PURPOSE_BY_TYPE` (categorical mapping) was
  deliberately excluded — not a numeric behavioral claim.

A precise re-survey (not carried forward as an approximation) puts the
remaining Phase 2a backlog at ~10 constants across ~10 files, closing out
the phase once shipped.

## v0.79.0 — 2026-08-09 — Provenance: health-metrics domain constants

Sixth slice of Phase 2a (`docs/ROADMAP.md`), the first into the long tail
(all previously-named domain groups are done as of v0.78.0): source,
confidence, and scope for 8 exported constants across
`biological-age.ts`, `blood-pressure.ts`, `body-battery.ts`, and
`overtraining.ts`. No values changed — documentation only.

- All 8 constants are labelled **Invented**, Confidence: Low, each traced
  to an existing design doc for its reasoning, not external research.
- `body-battery.ts`'s `AWAKE_DRAIN_TOTAL` and `DRAIN_PER_LOAD` are
  explicitly called "first-pass calibrations" by their own design doc,
  headed for revisiting once compared against real activity/readiness
  data (a future correlation-engine question).
- `blood-pressure.ts`'s `BP_LABELS` (display copy) was deliberately
  excluded — not a numeric behavioral claim.

Remaining Phase 2a backlog: ~12 constants across ~10 other files.

## v0.78.0 — 2026-08-09 — Provenance: sync/polling domain constants

Fifth slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for 11 exported constants across `sync/activity-poll.ts`,
`sync/wellness-refresh.ts`, `sync/strava-webhook.ts`, and
`sync/intervals-backfill.ts`. No values changed — documentation only.

- All 11 constants are labelled **Invented**, Confidence: Low — operational
  judgement calls for polling a free, single-developer API (intervals.icu),
  each traced to an existing design doc for its reasoning, not external
  research: `wellness-sync-interval-design.md`,
  `intervals-wellness-expansion-design.md`,
  `event-driven-sync-triggers-design.md`, and
  `wellness-history-backfill-design.md`.
- `MAX_BACKFILL_YEARS` (20) is a safety ceiling a production dry run
  confirmed necessary — real accounts carry pre-2019 CTL/ATL-only filler
  data (3,111 rows found) this cap must outlast.

Remaining Phase 2a backlog: ~20 constants across ~14 other files.

## v0.77.0 — 2026-08-09 — Provenance: race/taper domain constants

Fourth slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for 11 exported constants across `race/taper.ts`, `race/forecast.ts`, and
`race/feasibility.ts`, plus one gap found while scanning the directory
(`race/triathlon-legs.ts`). No values changed — documentation only.

- All 11 domain constants (taper windows/fractions/opener cap, adherence
  forecast clamp, feasibility margin) are labelled **Invented**,
  Confidence: Low — each traces to the design doc that decided it
  (`docs/specs/2026-07-19-v0.14-race-ready-design.md`), not to external
  taper-physiology research.
- `LONGEST_RIDE_FRACTION` already carried extensive in-code and
  evidence-doc documentation; this slice added the explicit confidence
  sentence its evidence doc already rates it at: "Low, unvalidated
  outside cycling."
- `TRIATHLON_LEGS` (governing-body course distances) was missed by the
  original 91-constant survey. Rated **High — definitional**, not an
  estimate.

Remaining Phase 2a backlog: ~31 constants across ~18 other files.

## v0.76.0 — 2026-08-09 — Provenance: sleep & readiness window constants

Third slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for 11 exported constants across `readiness.ts`, `sleep-debt.ts`,
`sleep-insights.ts`, and `sleep-history.ts`. No values changed —
documentation only.

- 10 of 11 constants are design trade-offs or data-sufficiency gates with
  no cited external research — labelled **Invented**, Confidence: Low,
  including `readiness.ts`'s `MIN_BASELINE_DAYS`/`BASELINE_WINDOW_DAYS`
  (both have real documented design reasoning in
  `docs/specs/2026-07-15-v0.7-score-integrity-design.md`, just not an
  external citation).
- `DEFAULT_SLEEP_NEED_SECS` (8h) is the exception: 8 hours sits inside the
  commonly-cited 7-9h/night range recommended for adults, though the
  origin spec is explicit it's an editable default, not a personalized
  claim. Confidence: Medium.

Remaining Phase 2a backlog: ~42 constants across ~21 other files.

## v0.75.0 — 2026-08-09 — Provenance: training-load constants

Second slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for `src/lib/training-load.ts`'s 8 exported constants. No values changed —
documentation only.

- `CTL_DAYS = 42` and `ATL_DAYS = 7` — the industry-standard Coggan/Banister
  EMA time constants every mainstream training-load tool uses. Confidence:
  Medium (widely-adopted convention, not head-to-head validated as optimal).
- `LTHR_HRR_FRACTION = 0.85` — the origin design spec states this without
  citing a source; labelled a coaching convention rather than attaching an
  invented citation. Confidence: Low.
- The remaining 5 constants (`MIN_LOAD_DAYS`, `MAX_HR_IF`,
  `DURATION_TSS_PER_HOUR`, `DEDUP_START_WINDOW_MS`,
  `DEDUP_DURATION_TOLERANCE`) are engineering thresholds with no
  physiological claim — labelled **Invented**, Confidence: Low.

Remaining Phase 2a backlog: ~53 constants across ~25 other files.

## v0.74.0 — 2026-08-09 — Provenance: athlete level & week-plan constants

First slice of Phase 2a (`docs/ROADMAP.md`): source, confidence, and scope
for `athlete-level.ts`'s `LEVEL_CONSTANTS` and `week-plan/types.ts`'s 11
exported constants. No values changed — documentation only.

- Settles the correction owed since 2026-08-05: `HEADROOM` and
  `RAMP_CLAMP_PCT` now read Confidence: Low in the code itself, not just in
  prose docs — the ACWR anchor that previously justified High confidence
  doesn't hold (not supported by the literature, and never actually an ACWR
  calculation to begin with).
- `MAINTENANCE_FLOOR`, `HOURS_BANDS`, and `CTL_BANDS` transcribed from
  already-existing research in
  `docs/specs/2026-07-28-training-volume-evidence.md` — Confidence:
  High/Medium/Medium respectively.
- The other 10 week-plan constants (adaptive-week tuning thresholds) have
  no research backing and are labelled **Invented**, Confidence: Low, per
  the roadmap's own instruction that this is "an acceptable answer, and far
  better than silence."

Remaining Phase 2a backlog: ~61 constants across ~26 other files — see
`docs/plans/2026-08-09-provenance-athlete-level-week-plan.md`'s Findings for
the grouped list.

## v0.73.0 — 2026-08-09 — Uncertainty vocabulary (Admin / misc), Phase 2b.3 complete

The seventh and final slice of Phase 2b.3 — investigation-only, no code
change. `security-events.tsx`, `artifact-card.tsx`, and `health-upload.tsx`
were the last three files in the backlog; none contained any of the six
retired dialect words. Each dash was read individually and found to be
either "not applicable" (an audit event with no client IP to record), an
internal chart-rendering robustness fallback (unrelated series lengths in
an AI-generated `ChartSpec` table), or a raw continuous confidence
percentage that doesn't map cleanly onto the vocabulary's 3-tier
`Confidence` without inventing a threshold — the same category of judgment
call that already excluded `milestones-card.tsx`, `checkin-sheet.tsx`, and
`laps-table.tsx` in earlier slices. See
`docs/plans/2026-08-09-uncertainty-vocabulary-admin-misc.md` for the full
reasoning.

Phase 2b.3 (`docs/ROADMAP.md`) is now complete: six slices (v0.67.0–v0.72.0)
migrated every real call site across seven surfaces, and all four
distinctions the phase named — calibrating, insufficient, low confidence,
and no-figure-plus-reason — have real, shipped call sites.

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

## v0.71.0 — 2026-08-09 — Uncertainty vocabulary (Log / Activity)

The fifth slice of Phase 2b.3 — small by design, per verification (see the
plan's Findings).

- `PmcChart`'s "Not enough data yet for this range." is now
  `unavailableMessage()`'s `calibrating` phrasing ("Calibrating — day N of 2
  days"), the same treatment `correlationFigure` already gives a thin
  sample.
- Investigated and left alone: `laps-table.tsx`'s per-cell em-dashes (a
  historical sensor absence with no "fix," and disproportionate to wrap at
  table-cell density — see the plan's Findings) and `PmcChart`'s dead
  `showStats` prop (inert, not a wrong message — general-cleanup territory,
  not 2b.3).
- Confirmed dead: `wellness-trends.tsx` (zero import sites, superseded by
  `BaselineTrendCard`) — belongs to Phase 2b.2's orphan cleanup.

## v0.70.0 — 2026-08-09 — Uncertainty vocabulary (Body / Health)

The fourth slice of Phase 2b.3: biological age and the Estimated Energy
(body battery) card migrated to the `Figure<T>` vocabulary.

- `LabsTiles.bioAge` and `BioAgeCard.result` are now `Figure<BioAgeResult>`;
  the hand-written "Add: X, Y." sentence is now `unavailableMessage()`'s
  `missing_input` phrasing, computed once in `LabsTab` and shared by both
  components.
- `BodyBatteryCurve.current` is now `Figure<number>`, using
  `calibrationProgress()` (the same "day N of 14" helper Today's hero uses)
  for its `have`/`need` — the first use of `Figure.calibrating` outside the
  90-day correlations surface. It only claims `calibrating` while
  `calibration.remaining > 0`, the same second gate Today's hero applies —
  a null readiness reading also happens on any single day an already-
  calibrated athlete has no HRV/RHR sync, which is a `missing_input` gap,
  not a false "day 14 of 14" claim to a veteran athlete. (Caught in final
  review, fixed before merge.)
- Fixed: the Estimated Energy card no longer disappears entirely while
  readiness calibrates. `SleepTab` guarded its render with
  `battery.current != null`, so the component's own "not enough data"
  message — already written, already tested — was unreachable. Removed the
  guard; the card now always renders, honestly, per the goal's "when it does
  not know, it says so."
- Investigated `src/lib/race/forecast.ts`'s "insufficient" kind (named in
  the original backlog) and found nothing left to migrate: its one
  rendering path, `RaceChip`, already omits the form clause silently rather
  than showing a placeholder — the same honest-by-omission design the last
  two slices found in `today-hero.tsx` and `milestones-card.tsx`.
- No dead components found on this surface (unlike the first two slices).

## v0.69.0 — 2026-08-09 — Uncertainty vocabulary (Train)

The third slice of Phase 2b.3: the Train page's CTL/ATL/TSB fitness tiles,
and `DayActions`' preview, migrated to the `Figure<T>` vocabulary.

- `FitnessTile.value` is now `Figure<string>`, matching the vitals grid's
  v0.68.0 shape exactly, including its accessibility pattern (`title` +
  `sr-only` span, built in from the start this time rather than added in a
  follow-up).
- `DayActions`' preview now says "Needs more training history to project
  form." instead of the bare "No projection — calibrating." — the same
  underlying `forecastForm` signal the vitals grid's Form · TSB tile and the
  live `RaceChip` already treat as `missing_input`.
- Investigated `season-timeline-card.tsx`'s `"unknown"`/`"—"` and
  `train/page.tsx`'s remaining-weeks skeleton `"—"` and left both alone:
  the first reads `weekPlans.effectiveTarget`, a per-week snapshot derived
  from `trainingBlocks.targetLoadTotal` at materialization; the second
  reads that column directly. Same family, the value `docs/ROADMAP.md`
  names as Phase 2c's first number slice ("3 producers... caused four
  shipped bugs"). Touching either rendering before 2c assigns the family
  one owner risks becoming the fifth instance of `docs/BASELINE.md`'s
  layer-confusion lesson. Also left alone: the Train page's readiness
  header chip, a terse band-verdict label like `today-hero.tsx`'s, not a
  value placeholder.
- No dead components found on this surface (unlike the last two slices).

## v0.68.0 — 2026-08-09 — Uncertainty vocabulary (vitals grid)

The second slice of Phase 2b.3: Today's vitals grid (HRV, RHR, Sleep,
Form · TSB) migrated to the `Figure<T>` vocabulary v0.67.0 shipped.

- `VitalTile.value` is now `Figure<string>` instead of a pre-formatted
  string; each tile still shows the same `"—"` it always has when a reading
  is missing, now backed by a typed reason surfaced as a `title` attribute
  and an `sr-only` span — not just a bare glyph, and not sighted-mouse-only.
- The sleep tile's low-confidence suffix (`"· limited data"`) is now a
  `<ConfidenceChip>` in the delta row instead of a string concatenation.
- No visual regression: same glyph, same layout, same conditions for when
  the confidence chip appears.
- Investigated three more sites in the same surface and left them alone,
  each for a documented reason (see
  `docs/plans/2026-08-09-uncertainty-vocabulary-vitals.md`): a milestones
  count where `"—"` means zero, not unknown; a form slider's own input
  state; and the Today hero's calibrating state, which already avoids
  duplicating the adjacent calibration-progress card.
- Found 5 more confirmed-dead components while verifying this surface
  (`hero-readiness.tsx`, `readiness-rings.tsx`, `race-countdown.tsx`'s
  component body, `recent-sessions-accordion.tsx`, dashboard's
  `vitals-grid.tsx`) — not touched here; tracked for Phase 2b.2's cleanup.

## v0.67.0 — 2026-08-08 — Uncertainty vocabulary (phase one)

Phase 2b.1, and the first slice of 2b.3: a shared type for "the app doesn't
know" states, and the first surface migrated to it.

- Added `src/lib/uncertainty.ts`: `Figure<T>`, `Unavailable` and
  `Confidence`, with `Figure.available/.calibrating/.missingInput/.notApplicable`
  constructors — the discriminated-union shape `src/lib/race/demand.ts`
  already proved for one number, promoted to house style.
- Added two rendering primitives on top of existing `src/components/ui/`
  pieces: `<ConfidenceChip>` (a badge for below-high confidence) and
  `<Unavailable>` (inline or full-panel empty state).
- Fixed the 90-day correlation rows' conflation the goal forbids: "limited
  evidence" (not enough tagged days) and "inconclusive" (a real,
  high-confidence finding of no effect) rendered identically. They now
  render as calibrating and as a real finding respectively, and a guard
  test fails if either retired string returns.
- Added `docs/design-system.md`: a descriptive catalog of the 83 tokens in
  `globals.css`, the 16 `src/components/ui/` primitives, and the IA as
  built.
- No new figures, no IA changes — Phase 2's constraint holds. The remaining
  five dialects and roughly 20 other call sites are unmigrated; tracked as a
  backlog in `docs/plans/2026-08-08-uncertainty-vocabulary.md`, not this
  release.

## v0.66.0 — 2026-08-08 — Surface view telemetry

The app's information architecture is up for a decision (Phase 2b.2), and the
call was to make it from real usage rather than recall — but until now there
was no usage data to make it from. This release adds that data source. It
does not change the IA, and it adds nothing an athlete sees.

- Added a `surface_views` table and a guarded `recordSurfaceView` helper:
  one counter per user, per surface, per local day. The write never throws —
  a failed count is preferred over a broken page render.
- Instrumented all nine authenticated pages (Today, Train, Coach, Body,
  Settings, Admin, Import, Activity, Activity Log) behind a closed set of
  surface keys, never raw pathnames, so the table can't grow unbounded.
- Old counts are pruned on a retention window in the existing scheduler
  tick, and the counts ride through the existing GDPR export/import
  pipeline like every other user-owned table.
- Added an owner-only aggregate card on `/admin` showing total views per
  surface across all users — nothing scoped to, or visible to, any one
  athlete.
- The data never leaves the instance: no external calls, no timings, no
  event streams, just counts.

## v0.65.0 — 2026-08-08 — Audit remediation (v0.55–v0.64)

An audit of the ten releases shipped on the night of 7 August found one
safety regression, several features wired to nothing, and a release that was
tagged from a red build. This release repairs them and puts a gate in front
of the process that let them through. No new features.

**Safety**

- Reverted the v0.61 "bounded adaptive week autopilot" in full. It set a flag
  that skipped the ±20% ramp clamp, so an athlete who completed 200 of a
  planned 400 was handed 340 instead of the clamped 240 — in the branch meant
  to back off. It survived review because v0.61 rewrote the test that
  protected the clamp rather than adding one. The clamp is unconditional
  again, and a sweep now asserts it binds under every rule combination.
- Reverting also removed the hard `completionPct: 0` written at rollover when
  a block was missing, which `?? adherencePct` could not catch and which
  scored a 99%-adherence week at 0.693 — a 15% cut for a week nearly nailed.

**Features that were not connected**

- The body battery's sleep-debt penalty and "sleep debt" tag were dead:
  `computeBodyBattery` accepts `sleepDebtSecs` and `/body` never passed it,
  though the value sat computed 40 lines above the call. Now passed.
- Body battery checkpoints were read out of the 15-minute sample grid by
  exact minute, so any wake time off :00/:15/:30/:45 made Morning, Midday and
  Evening show one identical number. They are now evaluated at their real
  minute through the same function that draws the curve.
- The Train week quick actions (Ease/Deload/Boost/Skip) wrote only
  `trainingBlocks.targetLoadTotal`, which the open week never reads — it is
  recomputed from `periodize()` on the spot. The buttons moved the number
  everywhere the plan is _reported_ (blocks table, `get_training_plan`,
  `get_plan_drift`, race forecasting) and nowhere it is _executed_. The
  switch is no longer rendered pending a real design; `update_training_plan`
  now refuses a proportional action against a block with no target instead of
  silently writing 0, and the quick-action wrappers log their failures rather
  than presenting them as success.

**Correctness**

- v0.64 renamed the thin-evidence correlation label but left the test
  asserting the old string, which is why `main` was red. Fixed, and the
  strong-but-inconclusive branch — the only one that renders the word
  "inconclusive" — now has coverage for the first time.
- Both correlation surfaces rendered "limited evidence· 12 events": the label
  and count sit on separate JSX lines and the newline collapsed away.

**Process**

- `release.yml` now refuses to publish when the tagged commit's CI is not
  green. v0.63.0 and v0.64.0 were tagged from a commit whose test suite had
  already failed, and both point at that same commit, so `git diff
v0.63.0..v0.64.0` is empty.

## v0.64.0 — 2026-08-08 — Correlation engine v2 (confidence-aware)

This release makes readiness correlations safer to trust by surfacing sample
strength and low-evidence states instead of implying certainty from sparse
data.

- Added evidence levels to correlation outputs so rows and split views can say
  when a result is limited versus strong.
- Kept the core effect-size and confidence-band math intact while adding
  minimum-sample guardrails to the rendered claim state.
- Updated correlation UI surfaces to show "limited evidence" instead of a
  generic inconclusive label when sample strength is still thin.
- Added regression coverage for evidence-tier output and the updated UI copy.

## v0.63.0 — 2026-08-08 — Body battery daily energy curve

This release adds an explicit daily energy model so the app can show a
readable day shape instead of implying a hidden measurement.

- Added day-shape annotations to the body battery model: morning, midday, and
  evening checkpoints plus deterministic day tags.
- Threaded sleep debt into the modeled starting charge so sparse recovery days
  are represented more conservatively.
- Updated the body battery card and recovery accordion to render the new day
  tags and checkpoint readouts.
- Added focused tests for curve classification, day-shape labeling, and the
  updated UI rendering.

## v0.62.0 — 2026-08-08 — Sleep debt confidence guidance

This release improves sleep guidance clarity by showing how trustworthy the
sleep debt estimate is for the current window.

- Added confidence levels to sleep debt computation output:
  `none`, `low`, `medium`, and `high` based on counted nights.
- Kept sleep debt and bedtime recommendation math unchanged while improving
  explainability of sparse-window estimates.
- Added confidence display in the Sleep card when debt is available.
- Added low-confidence "limited data" labeling to the Today sleep vital delta.
- Added focused tests for confidence level calculation and rendering.

## v0.61.0 — 2026-08-08 — Adaptive week autopilot (MVP)

This release introduces deterministic weekly autopilot load adjustment based on
prior-week adherence and completion signals.

- Added bounded weekly autopilot behavior in week materialization:
  - high adherence: `+10%`
  - low adherence: `-15%`
  - neutral: no baseline change
- Added explicit autopilot rationale code prefixes in adjustment reasoning:
  `AUTO_HIGH_ADHERENCE`, `AUTO_LOW_ADHERENCE`, `AUTO_NEUTRAL`.
- Threaded previous-week completion percentage through rollover input so
  autopilot decisions combine adherence and completion deterministically.
- Updated focused week-plan tests to assert new bounded behavior and reason
  outputs.

## v0.60.0 — 2026-08-08 — Week action legend

This release adds an always-visible legend for Train week quick actions so
their deterministic effects are readable without hover.

- Added a compact legend row below week action controls:
  `Ease -30% · Deload -50% · Boost +10% · Skip 0`.
- Kept per-button `title` and `aria-label` effect hints from v0.59.
- Added focused UI test coverage for visible legend text.

## v0.59.0 — 2026-08-08 — Week action effect hints

This release improves week-action clarity in Train with deterministic effect
hints on each quick-action button.

- Added per-action hint text in Train week controls:
  - Ease week: `-30%`
  - Deload week: `-50%`
  - Boost week: `+10%`
  - Skip week: `set to 0`
- Added button `title` and `aria-label` metadata so action outcomes are
  discoverable and accessible before submit.
- Added focused UI test coverage for rendered effect hints.

## v0.58.0 — 2026-08-07 — Week action freshness guardrails

This release prevents stale Train week-action submissions from mutating the
wrong week after a rollover.

- Added an open-week guard in `setWeekAdjustmentQuick` so week actions only
  execute when the submitted `weekNumber` matches the current open
  `skeletonWeek`.
- Added a deterministic stale-submission refusal path,
  `stale_week_adjustment`, for mismatched week posts.
- Added focused action-layer tests proving stale submissions are rejected and
  leave existing week targets unchanged.

## v0.57.0 — 2026-08-07 — Deload week quick action

This release extends Train week quick actions with a deterministic deload
control.

- Added a new Train week quick action, Deload week, alongside ease, boost,
  and skip.
- Added server-action handling and MCP tool support for `deload_week`.
- Added deterministic deload behavior that halves the selected open week's
  target load and records an explicit adjustment note.
- Added focused tests for Train UI wiring, server action parsing, and
  `update_training_plan` action-schema coverage.

## v0.51.0 — 2026-08-07 — Plan styles and blocks

This release adds selectable planning styles while preserving safety and
deterministic behavior.

- Added plan style contract with `balanced` default and `block_lite` option.
- Added deterministic style-aware week materialization tie-breaks that apply
  only after legality and safety admission checks.
- Added effective style threading through plan constraints and week planning
  orchestration paths.
- Added tool/API parity for style controls and visibility:
  `generate_training_plan` accepts optional `planStyle`,
  `update_training_plan` adds `set_style`, and plan/week reads expose
  `effectiveStyle`.
- Added focused tests and updated frozen tool-surface snapshots for the new
  schema fields.

Released as tag `v0.51.0` from merged PR #58.

## v0.50.0 — 2026-08-07 — Workout export v1 (.zwo deterministic)

This release adds deterministic workout export primitives for cycling sessions.

- Added a pure `.zwo` exporter that produces byte-identical output for
  identical session inputs.
- Added explicit refusal responses for unsupported sports instead of producing
  malformed or misleading exports.
- Added deterministic weekly batch export helper with stable ordering and
  predictable file naming.
- Added focused tests for XML shape contracts, determinism, and refusal cases.

Released as tag `v0.50.0` from merged PR #57.

## v0.49.0 — 2026-08-07 — Fuelling Lite

This release starts breadth with deterministic, session-aware fuelling guidance.

- Added a shared fuelling engine based on session duration, intensity, and
  optional body mass.
- Added Train fuelling cards with confidence labels and explicit assumptions.
- Added parity output in `get_week_plan` so coach/tool responses and UI use the
  same guidance source.
- Added targeted tests across fuelling calculator, session mapping, Train card,
  and week-plan tool wiring.

Released as tag `v0.49.0` from merged PR #56.

## v0.48.0 — 2026-08-07 — Season target vs actual timeline

This release adds a Season view in Train to compare plan intent against
executed work week by week.

- Added a new Train tab, Season, with preserved URL state across tab switches.
- Added a mobile-first season timeline card with weekly target vs actual load,
  latest-week stats, and adherence summary.
- Added pure chart helper logic to align weekly targets and actual activity
  summaries by Monday week starts.
- Added focused tests for season href behavior, target/actual merge logic, and
  season timeline rendering states.

## v0.47.0 — 2026-08-07 — Plan knows how you start

This release makes opening-week planning state-aware and conservative when the
recent signal says caution is warranted.

- Added a start-state provenance resolver for opening CTL/ATL/TSB so week one
  can explain where its inputs came from.
- Added opening-week form branching (red/amber/green) with safer first-72h
  workout rules under negative form.
- Added conservative illness comeback mode with load and intensity caps when
  recent illness or disruption is detected.
- Added B/C race mini-taper behavior that eases race week without applying
  full A-race taper logic.
- Added safety-precedence observability and a generation fallback that
  materializes recovery-biased sessions if workout generation fails.
- Added an explicit v0.47 acceptance matrix test suite and follow-up ramp
  regression coverage.

Released as tag `v0.47.0` from merged PR #53.

## v0.46.0 — 2026-08-07 — Demand knows its sport

`eventDemand`, the function every race-driven training target is built on,
priced every event with `estimateRidingHours` — the cycling drag equation —
regardless of what sport the race actually was. `races.sport` has been a
stored, validated `["Bike","Run","Triathlon"]` enum since v0.42, and nothing
on the demand path read it. A runner with an FTP set had their marathon
priced as roughly 1.2 h of cycling against a real 3–4 h run, silently wrong by
a factor of three. A runner with no FTP got `null`, and the entire
race-driven volume feature quietly reverted to the athlete's flat weekly
availability with no word on any screen. **Cyclists' demand figures do not
move at all** — `src/lib/race/demand.test.ts` pins the reporting athlete's
130 km / 4000 m gran fondo to the exact pre-release figures
(`totalHours = 6.337242282842961`), and the demand sweep
(`scripts/demand-sweep.ts`, `npx tsx scripts/demand-sweep.ts`) confirms it by
printing the live number, not just asserting it.

**One cycling-visible change does follow from the longest-session fix, and it
is named here rather than covered by that guarantee**, which pins the demand
figure only. A cyclist whose longest logged activity was not a ride — a hike,
a long walk, anything the sport map does not recognise — was previously
credited with it toward their longest-ride readiness, and no longer is. Their
`/train` verdict can therefore soften by one rung. That is the point of the
fix rather than a side effect of it, but it is a number moving for a cyclist,
and the freeze test does not cover it.

Runners now get a real model. `estimateRunningHours`
(`src/lib/race/running-time.ts`) prices distance and elevation against a
threshold pace using Riegel's endurance formula (`T₂ = T₁ × (D₂/D₁)^1.06`,
Riegel 1981) and the ITRA km-effort convention for climbing (100 m of ascent
priced as one flat km). The threshold pace comes from `body_prefs` when the
athlete has set one, or — new in this release — from their own run history:
the fastest pace held over at least 5 km in the trailing 180 days. **That
derived anchor is a floor on the athlete's ability, not a measurement of
it** — nothing in the activity history distinguishes a genuine hard effort
from an easy long run recorded at a similar pace, so an athlete who has not
raced or pushed recently will be under-anchored. The error runs in the safe
direction (demand comes out understated, never overstated), but it is still
an assumption, not a fact, and is recorded as Low confidence on every screen
that shows it.

Triathletes get three legs summed, not one. The bike and run legs reuse the
cycling and running models unchanged; the swim leg is priced from the
athlete's own swim pace — the median across swims of at least 400 m in the
trailing 180 days — with **no race-day adjustment of any kind**. That is
deliberate, not an oversight: open-water conditions and race-day effort pull
in opposite directions, and no published magnitude for the net effect was
found, so the honest choice was to price the leg at the athlete's own
training pace and say so in prose, rather than multiply by an invented
constant dressed up as a correction. Leg distances (Ironman 3.8/180/42.2 km,
70.3 1.9/90/21.1 km, Olympic, Sprint) come from a fixed lookup keyed to the
race's format, because those distances are definitional — "Ironman" fixes a
course length the way "marathon" does. **A triathlete with no swim history
and no stated finish time gets no figure at all** — the model refuses rather
than guessing a swim pace, naming the fix (add an expected finish time or a
recent tracked swim) in the same sentence.

A new `races.expected_finish_hours` lets the athlete's own stated time win
outright over every model, needing no anchor at all. This is what rescues
every refusal case above: an unrecognised triathlon format, missing swim
history, or no threshold pace are all answered by one number the athlete
already knows. A figure produced this way is marked **high** confidence; one
built entirely from athlete-set anchors (a typed FTP or threshold pace) is
**medium**; one that leaned on any derived or synced anchor is **low**. Every
demand figure shown to the athlete, and the same figure handed to the coach,
now carries a one-sentence reason for its confidence — the two surfaces
cannot say different things, by the same discipline `assembleWeeklyTarget`
already enforces for the hours number itself.

`eventDemand` no longer returns a bare `null` on failure. A discriminated
`EventDemandResult` forces every caller to handle an explicit
`{ available: false, reason }` branch — closed to `no_cycling_anchor`,
`no_running_anchor`, `no_swim_anchor`, `unknown_triathlon_format`, and
`no_distance` — so a missing anchor cannot silently fall through to a
fallback the way it did before. To be precise about what changed: the
weekly target still falls back to the plan's stored hours when no figure can
be produced. What no longer happens is the _silence_ — `/train` now renders
the reason beside it, and the coach receives the same sentence. The
discriminated type is what makes that unavoidable: a caller cannot reach the
fallback without having handled the branch that explains it. The
longest-session check that feeds
feasibility now filters by the race's own sport too
(`longestSessionHoursOf`, replacing a `longestRideHoursOf` that returned the
longest activity of _any_ kind): a triathlete's readiness is no longer
judged against a long walk that happened to outlast every ride they own.
`/train` now says "longest run" to a runner and "longest ride" to a cyclist
instead of hardcoding "ride" for everyone.

**Two limits do not get fixed here, and are named rather than implied
away.** `FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION` (0.8) is sourced
entirely from cycling coaching literature that is itself contested — gran
fondo coaching calls the long ride the single biggest predictor of
finishing, CTS disputes it directly. This release routes running and
triathlon feasibility through the same function, and **the identical
fraction is now applied to a runner's longest run and a triathlete's longest
brick session with no supporting evidence in either sport** — not because it
was validated there, but because no better number was found. The rule's
existing guard rail (it can soften a verdict by at most one rung and can
never by itself produce "not_realistic") limits the damage a wrong fraction
can do, but it does not make the fraction right. Recorded in
`docs/specs/2026-08-07-race-demand-evidence.md`, alongside every other new
constant's source and confidence, and the two rejected alternatives: a
Minetti-derived elevation model (needs a grade distribution the race form
does not collect) and a default swim pace (would put an unsourced number
into a training target for exactly the athletes who most need an honest
refusal instead).

The second limit is the same shape, and was found by reading the demand
sweep's printed output rather than by reviewing code. `eventDemand` turns an
event's duration into a weekly target by dividing by `EVENT_TO_WEEKLY_1DAY`
(0.6), a constant whose own justification is a **bike race** — "a long
sportive is about half a training week" — together with a multi-day exponent
fitted to two cycling anchors. Until this release every event reaching that
line was a bike ride, so it did not matter. **It now converts marathons and
Ironmans as well**, on no evidence that one ratio should govern three sports:
an 11-hour Ironman is not "about half a training week" in the sense that
comment describes. The resulting figures do land in defensible ranges (6.3
h/week for a recreational marathon, 18.5 h/week for an Ironman), and the
number is an upper bound that is then clamped against the athlete's own
12-week measured peak and their stated availability — so it cannot by itself
prescribe a week they have never approached. It is recorded as Low
confidence, unvalidated outside cycling, rather than re-derived, because
inventing two more numbers with no better evidence than the one being
replaced would trade a documented weak assumption for an undocumented one.

One smaller rider, carried from v0.45: the weekly review's CTL-delta
sentence compared `latestWellness.ctl` against a rolling 7-day lookback
while the load figure next to it in the same sentence used the calendar
week. Both now read from the same calendar-week window, so "CTL 62 (+3)"
sits next to a load number computed on its own boundary rather than a
different one.

Migration 0039 (`drizzle/0039_demand_knows_its_sport.sql`) adds
`body_prefs.threshold_pace_sec_per_km` and `races.expected_finish_hours`,
both nullable and additive-only.

## v0.45.0 — 2026-08-06 — Every number has a source

`periodize()`, the skeleton generator behind every training plan, runs on
twenty-two numeric constants — phase splits, progression rates, a recovery
cadence, hours multipliers. None of them had ever been written down anywhere.
A phase share of 0.4, a progression rate of 1.08, a recovery fraction of 0.6:
each looked deliberate, and none were sourced. This release gives every one
of them a name, a value, a source and a confidence rating, in
`src/lib/plan-constants.ts` and its companion evidence document,
`docs/specs/2026-08-06-periodize-evidence.md`. Most are rated Low confidence
— coaching convention with no comparative evidence — and the two Mediums
(`CTL_TO_WEEKLY_LOAD`, `RECOVERY_FRACTION`) rest on arithmetic and a
detraining-literature band, not on findings about this app's own athletes.
`src/lib/plan-constants.test.ts` fails CI if a constant is missing a doc row
or a confidence rating, and it is deliberately not database-gated, so it
actually runs on every PR rather than joining the 89 of 245 test files a
DATABASE_URL-less CI run already skips. What it proves is narrower than it
sounds, though: it checks that a constant is **named and has a summary-table
row**. It does **not** check that the documented value is correct or that the
confidence rating is honest — a constant could carry a fabricated citation
and this test would still pass.

While sourcing the recovery cadence we found a bug in it. "Recovery every
Nth week" — three loading weeks then one recovery in base phase (3:1), two
loading weeks then one recovery elsewhere (2:1) — was counted from zero at
every phase boundary, so a 3-week base phase produced no recovery week at all
(3 % 4 ≠ 0) and build started counting from scratch: six straight loading
weeks with no recovery between them, purely because of where a phase line
happened to fall. The counter now carries across phase boundaries, so cadence
depends on how many loading weeks have actually passed, not on the nearest
phase boundary. **This does not change how hard anyone trains.** An earlier
draft of the fix also lengthened every mesocycle by a week (3:1 → 4:1 in
base, 2:1 → 3:1 in build/peak); that was caught in review and reverted. The
prescription an athlete receives is unchanged in density — only the position
of misplaced recovery weeks moves.

The taper had the opposite problem: two authorities computing two different
numbers for the same week. `periodize()` used to decay load 25%/week and
hours 0.7→0.6→0.5 in its own taper weeks, independently of
`materializeWeek`, which separately applied the real ladder from
`src/lib/race/taper.ts` (0.45/0.65/0.80, by proximity to race day) whenever
it had a genuine load anchor to scale. The two rates diverged every taper
week. The skeleton's own decay is gone; `periodize()` now reads the same
three fractions `race/taper.ts` already owns, so there is one set of ladder
values instead of two independently invented rates. This does not guarantee
the skeleton and `materializeWeek` always land on the identical number for a
given week — they still key off different things, plan position versus the
real race date — but they now share the same ladder to do it with. One case
needed a fix of its own on top: when a week has neither a previous week's
actual load nor a synced CTL, `materializeWeek` used to multiply the
skeleton's already-laddered number by the real-date fraction a second time —
race week landing near 0.20 of true load instead of 0.45. It now keeps
`periodize()`'s number as final in that case instead of rescaling it. That
path is **not limited to a brand-new athlete's first week**: `hasActualLoad`
is false whenever the previous week is missing _or_ its actual load is
zero, so any athlete with no synced CTL hits it again after a missed week.

Nothing bounded the skeleton's week-over-week compounding against what the
athlete's own fitness could plausibly support. `effectiveWeekLoad`'s existing
ramp guard clamps to ±20% of last week's _actual_ load, but the skeleton
progresses at up to 8%/week, and 8 < 20 — so that clamp never fired against
it, and the error compounded: `1.08^20` is 4.7×. A new bound,
`CTL_RAMP_PER_WEEK = 5` TSS/week (the Coggan/Friel ramp-rate guidance —
defensible coaching practice, **not** a validated injury threshold), now caps
each week's load at `(startingCtl + 5 × weekNumber) × 7`. The bound is real
but narrow, and its two figures are not the same figure: the algebraic
crossover, where the plan's own step cap would start to outrun the bound's
fixed rate, is `startingCtl > 50` — necessary but not sufficient, because a
plan runs at most 52 weeks and needs that long for the gap to compound into
a visible breach. An exhaustive sweep of every integer starting CTL against
every plan length found the bound first actually changes a plan's output at
`startingCtl = 68`, removing at most 9 TSS; at CTL 67 it removes 0. The bound
is also floored at `MIN_WEEKLY_LOAD`, so it can only cap a runaway, never cut
below the plan's existing minimum — a low-CTL athlete's opening week is
unchanged.

A B or C priority race still gets no _race-driven_ taper. `materializeWeek`
only ever reshapes a week for a priority-A race, and that part is unchanged
by this release. It is not true that B/C gets no reduction at all, though:
periodize()'s own end-of-plan taper phase still reduces those weeks — Task 4
replaced its decay rate, not its existence — and `effectiveWeekLoad`'s
pre-existing ramp guard then clamps that reduction upward toward last week's
actual load, so what an athlete actually sees is a partial reduction, not
the ladder's intended race-week number. **This interaction is unchanged from
before v0.45**: the old skeleton decay hit the identical clamp and produced
the identical number on the project's pinned 12-week fixture (463/370 either
way) — this release changed the rate feeding the clamp, not the clamp
itself, so no athlete's outcome moved. What changed is that the gap is now
recorded instead of silent: a week that falls inside a B/C race's own taper
window logs an adjustment describing the shortfall, in words a coach or
athlete can read. **This release makes the gap visible; it does not close
it.** A real B/C mini-taper — one that survives the ramp guard — is
scheduled for v0.47.

The weekly review's headline load figure now comes from the same derivation
the week's own rollover uses — `deriveDayActuals`, bucketed to the calendar
week (Monday through Sunday) — rather than a rolling 7-day window measured
off raw `activities.start_date` that also skipped the
`coalesce(start_date_local, start_date)` every other surface already reads.
The two numbers describing the same week no longer disagree by construction.
Two things in the same message were deliberately **not** touched. The CTL
delta still compares today's CTL to CTL from 7 days ago on the old rolling
window, not the calendar week the load figure now uses — so "CTL 62 (+3)"
sits next to a load number computed on a different boundary than its own
delta. That is a known gap, not fixed here; see v0.46. And `actualSessions`
still means two different things in two different places — an activity count
in this message, plan-sessions-completed in `training_blocks` — deliberately:
forcing them equal would have been the wrong fix. Instead the weekly review's
write to `training_blocks.actualLoad`/`actualSessions` is deleted outright,
so `rolloverWeekPlan` is now the only writer and there is nothing left to
diverge.

`docs/specs/2026-07-28-training-volume-evidence.md` previously rated
`HEADROOM` (the 1.3× volume ceiling) and `RAMP_CLAMP_PCT` (the 0.2
week-over-week ramp clamp) **High** confidence, anchored to the acute:chronic
workload ratio's published 0.8–1.3 "safe zone." That anchor does not hold.
Impellizzeri et al. 2020 (IJSPP) finds no evidence supporting ACWR for load
management at all — the ratio is mathematically coupled, since the acute
window sits inside the chronic one, producing spurious correlation on its
own. Separately, `HEADROOM` was never actually an ACWR to begin with: an
ACWR is acute 7-day load over chronic 28-day load, while `HEADROOM` is this
week's hours over a 12-week rolling _peak_ — a different ratio that reused
the number without inheriting the definition. **The values themselves did
not move** — `HEADROOM` stays 1.3, `RAMP_CLAMP_PCT` stays 0.2 — only their
confidence (High → Low) and their justification, now stated honestly as
empirical guard-rails calibrated by feel, not validated thresholds. The
coach's system prompt was softened to match: "ATL/CTL 0.8-1.3 is a rough
guide, not a validated threshold" replaces language that called anything
above 1.5 an injury risk.

`scripts/repair-plan-blocks.ts` recomputes an active plan's stale training
blocks against the fixed `periodize()` — dry run by default, `--apply` to
write, mandatory `--user`/`--all` scope, one transaction per plan. It only
ever touches weeks strictly **after** `plan.currentWeek`: the current week
and every earlier one back a frozen `effectiveTarget` that gates the
low-adherence safety rail, and rewriting either would corrupt an athlete's
already-recorded adherence to fix a forecast. **A week the athlete has
already started or completed is not re-scored by this script** — "repairs
your plan" should not be read to mean otherwise. The live run is the
operator's own to make, dry run first.

No migrations in this release.

## v0.44.0 — 2026-08-06 — No Training Is Lost

The week of 2026-07-27 closed with a training load of 314. The athlete had
really done 783. Nothing failed, nothing errored, and no sync was missing —
469 units of real training were simply written nowhere.

`runDailyAdaptation` booked a day's load in two branches, and only ever for
yesterday: a day whose status was `planned`, `moved` or `adapted` got the load
of an activity whose sport matched the planned session, and a day whose status
was `rest` or `race` got the sum of everything on it. `DayStatus` has seven
members. Those branches cover five. `completed` and `missed` were covered by
neither, so a day in either state booked nothing at all — and `completed` is
what the app's own "Mark done" button sets. Pressing the button the interface
offers deleted that day's load from the week.

`markDayDone` promised otherwise in its own doc comment: "if the ride later
syncs, adaptDay attaches the real load." No branch would ever look at that day
again. The guarantee had never been true.

Four more holes shared the same shape. Work done after a day was written off
as missed booked nowhere. A planned day trained as a different sport booked
nowhere, because the only path to booking it was gated behind the same
sport-matched query that decided whether the session had happened. A second
session on a planned day was dropped, because that branch took the first
matching activity while the other summed. And an activity that synced two days
late was lost for good, because a day was considered exactly once, on the one
morning it was yesterday.

The cause of all five was one query answering two unrelated questions. "Did
yesterday's planned session happen?" needs the sport match, the settled-sync
guard, and yesterday alone, because it feeds the missed-workout handling.
"What work happened?" needs no sport test and no status gate, and applies to
every past day of the week. Separating them is the fix; the rest is
consequence.

The stored actuals are now a pure function of the `activities` table. One
derivation answers what happened on each local day; one rule decides which
field receives it — work the plan asked for lands in `actualLoad`, work it did
not lands in `unplannedLoad`, and both are rewritten together on every pass so
a day that changes which way it routes can never count twice. Days with no
activity have their fields cleared rather than zeroed, so a deleted activity
stops counting and re-running the pass is a no-op.

The week's close had a hole of its own, and it was worse than a race. It
summed whatever the day slots already held, so the numbers depended on whether
an adaptation pass had run first — and nothing sequences the two. But the
week's _final_ day was not merely racy, it was unbookable: booking it would
need a call where today is the day after the week's last day, and by then the
rollover has closed the week, the open-week lookup returns its successor, and
the adaptation pass skips out before it reaches its booking step. Every week
closed with its last day at zero. The close now re-derives the whole week.

`/train` had carried its own copy of this aggregation all along, and was the
one place showing the athlete the truth — its own comment said so, and said it
existed because the stored numbers could not be trusted. It now reads the same
derivation the plan books from, so the screen and the stored week agree by
construction rather than by coincidence.

The two copies had drifted in one respect: the local one filtered on
`start_date` where the shared one filters on
`coalesce(start_date_local, start_date)`, and had no upper bound at all. Tested
directly rather than assumed, that difference is inert for current data — the
connector writes both columns at the same instant, so the two filters select
identically, and the unbounded query's extra rows were bucketed to dates the
week never displayed. It is not inert for rows written either side of the
container's move from UTC to Europe/Amsterdam on 2026-07-27, where the two
columns genuinely disagree. Those rows are a connector-level problem, recorded
and not fixed here.

`scripts/repair-week-actuals.ts` replays the derivation over already-stored
weeks. It is a dry run unless given `--apply`, refuses to run without an
explicit `--user` or `--all`, never touches the `activities` table, and never
re-materialises or re-targets a week. Both of its writes go in one
transaction, because its own skip-if-unchanged check reads only the day data —
a half-finished run would otherwise leave the block totals stale in a way
re-running could not detect.

Expect it to correct in both directions. Weeks that lost load recover it, and
weeks carrying inflated figures come down — from `unplannedLoad` compounding
across repeated passes, which v0.28.1 first guarded and v0.31.0 replaced with
recomputation, and from stale `actualLoad` left behind on a day that later
became `missed` and was never revisited.

No migration: `actualLoad` and `unplannedLoad` already existed on the day slot.

Still one-shot, and deliberately left for v0.45: whether the planned session
happened is judged once, on the morning that day is yesterday. If the activity
sync has not settled by then, no later pass asks again. The day's load books
correctly, so no training is lost, but a cross-sport day whose sync was late
records against the planned session rather than beside it, and the week's
session count under-reports.

## v0.43.0 — 2026-08-05 — The Plan You Can See Before You Get It

v0.42 fixed why that gran fondo plan was full of running workouts. This one
fixes why nobody found out until the athlete went for a ride.

`generateTrainingPlan` committed as it went. From a single tool call it
archived every existing active plan, then created a race, inserted the plan
row, seeded the athlete's standard week and inserted twenty-four sessions.
There was no point in that sequence where a human saw the result before it was
already their plan. The archive also came _first_, so any failure in the
inserts behind it left the athlete with no active plan at all — a window that
had been open since the function was written.

A plan is now proposed before it is given. `previewTrainingPlan` writes a
`draft` and nothing else: no race, no availability defaults, no week plan, and
no status change to any plan the athlete already has. That is what makes a
draft safe to walk away from. `confirmTrainingPlan` turns it into their plan
inside one `db.transaction` — archive, create the race if the draft has none,
activate, seed availability — so the window between archiving the old plan and
having a new one no longer exists. `rolloverWeekPlan` stays outside that
transaction and keeps its `try`/`catch`, because a materialisation failure must
not roll back a good plan.

`training_plans.status` gains `draft`, which needed no migration: the column is
plain `text` with no check constraint. Adding a lifecycle state means every
query that reads training plans has to be asked whether it meant to include
one, and four had never been asked. `planIdForRace` returned a draft as a
race's plan. `projectWeek` projected a week onto one. `assembleForecastInputs`
built a forecast from one. `getMilestones` counted a draft's blocks as
completed training weeks. All four now exclude `draft` and only `draft` —
`ne(status, "draft")` rather than `eq(status, "active")`, because an archived
plan legitimately backs an older week and a finished plan's completed weeks are
still completed. Export and import stay deliberately unfiltered, so a backup
carries a draft like anything else.

The preview leads with arithmetic, because that is what athletes cannot
reconcile. `periodize` substitutes recovery weeks _inside_ a phase's span, so
"base, eight weeks" and "eight base weeks" are different numbers; on the
equivalent feature elsewhere this produced six separate threads of people
unable to work out why a date range gave them sixteen weeks instead of
twenty-three. `buildPhases` gives recovery its own row and the rows sum to the
plan's own week count, with the total on screen next to them.

Eight warnings say the things the preview would otherwise go quiet about: that
starting fitness was assumed rather than measured, that the weekly-hours figure
fell back to something typed in, that availability is capping the target, that
the event is tight or not realistic in the time left, that confirming will also
create the race or a standard week, that a race under four weeks out gets a
shortened plan rather than a progression. Each is one sentence naming the input
at fault. The feasibility verdict is deliberately silent on `ready` and
`on_track` — those are confirmations, not warnings — and silent again when it
cannot be assessed at all, which is a different thing from reassurance. That
three-way silence is an exhaustive `switch` with a `never` guard, so a fifth
verdict is a compile error rather than a fall-through into quiet.

The coach can now only propose. `generate_training_plan` returns the preview and
activates nothing; a new `confirm_training_plan` activates a reviewed draft and
archives the previous plan. Refusals come back as sentences rather than enum
values, so a failed call is not narrated by whatever the model improvises. The
system prompt was saying the old thing — that `generate_training_plan` creates
a plan, with no mention of confirming — which is the two-authorities pattern
v0.42 existed to cure, so it now describes both steps. Because that guarantee
lives entirely in prose, and the frozen-tools snapshot deliberately excludes
descriptions, the wording itself is now pinned by test.

One gap only the split could open: a draft freezes the sport it was built for,
and `upsert_race` can change a race's sport afterwards. A plan proposed for a
Bike race could have been confirmed against a race since corrected to Run —
v0.42's defect reached through a door neither release owned. Confirmation now
compares the race's live sport against the draft's and refuses, rather than
quietly swapping the sport of a plan the athlete already agreed to.

On `/train` the athlete gets the phase table with its total, the week list,
the warnings, and three decisions: start it, or change days and hours and
rebuild. Nothing about the periodization is editable. It gets an explanation
instead, because the one athlete who left a comparable product in the survey
behind this work left over configuration burden, not missing features.

Two things worth recording because review caught them rather than tests.
The per-week hours figure was back-calculated from a week-one load-per-hour
ratio, which assumes load per hour is constant across a plan; it is not, and
the preview was reporting 15.7 hours at peak against 8.8 actually scheduled,
and 9.2 on race week against 4.0. A fabricated headline number is the same
class of defect as an unseen plan, so it now sums the sessions themselves. The
Rebuild inputs also showed 5 days and 8 hours whatever the draft was built
from, silently discarding a stated preference; they now carry the draft's real
values.

`generateTrainingPlan` is still present and still commits directly, but nothing
calls it any more. Retiring it belongs to a later release. `previewFromDraft`
also duplicates the per-week mapping rather than sharing a helper with
`previewTrainingPlan`, whose "writes nothing but the draft" guarantee was held
untouched for the duration of this release; the two cannot drift today, and the
extraction is owed.

## v0.42.0 — 2026-08-05 — One Sport, Decided Once

An athlete entered a six-day Dolomites gran fondo and got a training plan made
entirely of running workouts. All six blocks, twenty-four sessions. Nothing
failed: the plan was internally consistent, the database was happy, and every
test passed.

Four separate code paths fell back to running when they could not tell what
sport a plan was for. `inferSports` returned an explicit override verbatim, so
a sports list holding the provider's word — `Ride`, not `Bike` — sailed past
the race-type inference that would have been right. `generateWorkouts` then
tested that value with a raw equality against `"Bike"`, failed, and fell
through to a catch-all that built running. The weekly rollover had a third,
`raceWeekWorkouts(sports[0] ?? "Run", …)`, so the wrong plan rebuilt itself
every week. A fourth, quieter than the other three because it lived in the
constraints reader rather than the generator, turned up while threading the
plan's sport through that rollover: `planConstraints` turned an absent or
empty sports list into `["Run"]` before anything downstream even ran.

`canonicalSport("Ride") → "Bike"` has existed since v0.27.0. It was wired into
activity matching — deciding whether a synced ride completed a planned session
— and never into the planner's own input. Half the translation was done.

The same untranslated comparison surfaced a second place, found in pre-flight
review rather than by riding: `race/debrief.ts` and `debrief/ride-review.ts`
both matched a race's activity by testing
`inferSports(race.raceType).includes(a.sport)` — the planner's word against
the provider's, exactly what `canonicalSport` exists to translate away.
`["Bike"].includes("Ride")` is false for every cyclist who has used this app,
so a race debrief never found the athlete's own race activity, and the
ride-review's race-day skip guard never fired for one. Both now compare
`disciplinesOf(requirePlanSport(race.sport))` against
`canonicalSport(activity.sport)` — both sides in the planner's vocabulary.

The race now decides. `races.sport` is a required closed set of `Bike`, `Run`
and `Triathlon` with no database default, because a default is a silent
decision and silent decisions are the entire defect. Every plan
`generateTrainingPlan` builds has a race behind it — it creates one when given
none — so the authority is there to read at the moment a plan is made. (Not
every plan already in the database can say the same; the repair script below
skips one with no race rather than guessing.) The athlete picks the sport on
the race form, pre-selected from the race type but visible and changeable.

Swim is deliberately not on that list. There is no swim-only branch in the
generator, so offering it would have produced running workouts under a
different label. Triathlon plans do include swim sessions.

`generateWorkouts` now dispatches on sport alone and throws on anything it
cannot build. Both fallbacks are deleted, and so is the second authority:
triathlon used to be routed by race type while cycling was routed by the sports
list, which meant a race whose sport said Triathlon but whose type was spelled
unusually produced running. `generate_training_plan` loses its `sports`
parameter entirely — it is how `Ride` got in, and its documented default
("the athlete profile") describes something that has never existed in this
schema.

The throw should be unreachable through this app's own code paths: every
writer runs the value through `requirePlanSport`/`toPlanSport` first, and the
column is `NOT NULL`. That guarantee is TypeScript/Zod-level, not
database-enforced — `races.sport` has no `CHECK` constraint, so a raw insert
(a script, a hand-run migration, a future service) could still write a string
this app never validated. This release's own premise is that an overclaimed
guarantee is itself a defect, so the throw stays as the backstop for that gap,
not as evidence the gap is closed. It is there so that if it is ever reached,
it is loud. A plan for the wrong sport should fail, not ship.

## v0.41.0 — 2026-08-04 — The Coach Can See The Race

An athlete could file a four-day stage race with the distance and climbing of
every day, ask the coach how to train for it, and get an answer formed without
any of it. `get_races` projected a hand-written list of nine fields, and the
race table had grown past it: v0.28 added event days, total distance, total
elevation and a weekly-hours override so the planner could size the week from
what the event demands — and `race_stages`, the per-day detail, was never
queried at all. The planner read all of it. The coach discussing that plan read
none of it.

Nothing failed, which is why it lasted nineteen tagged releases, v0.28.0
through v0.40.1. A projection that stops mirroring its table does not throw;
the coach simply answers with less, fluently, and the omission is invisible
unless you already know what it should have said. That is the same defect
v0.39 found in the importer, where four of six commits to one file had been
fixes for the same silent drift.

So the fix is a type rather than a longer list. `Projected<>` is the read-side
twin of v0.39's `Carried<>`: it requires every column of a table except an
explicit exemption union, each exemption carrying a reason about what the coach
needs. A column added to `races` from now on either reaches the coach or fails
to compile. Four columns are withheld — the ownership key, the debrief
scheduler's bookkeeping, and the two row timestamps. `resultActivityId` is not:
it is the coach's only route from "how did the race go?" to the ride itself.

Stages are returned inline rather than behind a new tool. A second call is one
the model may simply not make, which would reproduce the bug with extra steps.
An empty stage list is ambiguous by nature — a one-day race and a four-day
event nobody detailed both produce one — so the tool description now says so
outright, because a coach reading "no stages" as "no climbing" would be worse
than the gap this closes.

Second, a race's goal could only ever be set while creating it. The edit form
covered distance, elevation and stages but not `goalNote`, so when the coach
asked what the goal was, there was nowhere to put the answer. The field now
sits on the form that already existed. It stays free text: the coach reads
prose, and a schema for goals would be guessing at what an athlete types before
anyone has typed one.

## v0.40.1 — 2026-08-04 — Pushes Leave a Record

A push left a line on stdout and nothing else. Watchtower recreates the
container on every deploy, so `docker logs` restarts empty each release, and
the evidence for anything that happened before the last deploy is simply gone.
That is why a double ride-debrief notification reported on 30 July went five
days without an answer: the only surviving copy was in the host's journald,
and reading it needed root. A question about a push five days ago should be
answerable from the database.

Every push now writes a `push_sent` row carrying the tag, the subscription
count, and how many were sent and pruned — the same figures the log line
already had, and no more. The notification's title and body are personal data
and stay out of both.

Those rows live in `audit_log`, which until now held only security events. A
push is operational rather than security-relevant, so the owner's "Recent
security events" view is now filtered to security kinds. It shows the fifty
most recent rows, and at a few pushes per user per day an unfiltered list
would have been nothing but pushes within a day, burying the logins and token
grants it exists to surface.

The split between the two kinds is a type witness rather than a hand-written
list, so adding a new audited event without deciding which side it falls on is
a compile error instead of a silent omission from the view. Writing it that
way immediately surfaced a latent bug: `audit_log.event` carries its own enum
in the schema that has to mirror the event type, and it did not include the new
kind — an insert that worked at runtime and failed the build, because that
constraint is type-level only. No migration; the column is plain text.

On the double push that prompted this: it is not reproducing. Seven days of
retained logs contain two ride-debrief pushes, for different rides, each one
send to one subscription with nothing pruned — no activity notified twice — and
the athlete confirms receiving a single notification for the most recent ride.
The app is not sending twice.

What caused the original report on 30 July is now undetermined and likely to
stay that way: it predates the retained logs, so there is nothing left to read.
Either the compare-and-swap that v0.30.1 added to the debrief claim closed a
real race, or the phone displayed one notification twice. The honest answer is
that we cannot tell, and the reason we cannot tell is the gap this release
closes.

## v0.40.0 — 2026-08-04 — Tests That Bind in CI

`npm test` ran in CI with no database. The environment block that supplied
one was attached to the build step alone, and the workflow declared no
Postgres service, so every suite behind a `skipIf(!hasDb)` guard skipped on
every pull request — and had done for the project's entire history. That is
**71 test files and 405 tests, 23% of the suite**, covering the importer, the
scheduler, the week planner, the sync connectors and the export round trip. A
green check has never meant more than 77% of the tests, and the missing
quarter was the database-backed part, which is where this project's defects
have actually lived.

The test job now runs a Postgres service, and migrations are applied by
`scripts/migrate.mjs` — the same runner the container executes on every real
deploy, so a migration that would fail on deploy now fails the pull request
first. Nothing else had to change: the suite passes against a fresh, empty,
migrated database exactly as it stands, because the tests seed everything
they need. The whole run costs eighteen seconds more than before. A new
test, `tests/ci-has-database.test.ts`, guards this from regressing silently
a second time: the `hasDb` check is presence-based, not connectivity-based,
so a future edit that re-scoped the env block back down to a single step
would put the suite back to skipping while the job stayed green, and this
test fails CI loudly if that ever happens.

Separately, tests can no longer reach the real network. Nothing had enforced
that, though nothing currently depends on it being enforced: the tick's
provider passes are already switched off under vitest, and every test that
drives the scheduler tick hands it a stub processor rather than the real
one, so the one suite that seeds an active intervals.icu connection never
actually runs a tick over that user. The real exposure sits downstream of
that guard, in the tick's post-job hooks — weekly review, race debriefs,
auto-describe — which run with real imports inside `try/catch` and are not
gated the same way; this project has already had one of those hooks bill a
real LLM call into the owner's own coaching thread. A global guard now
blocks any outbound `fetch` and rejects, naming the URL it tried to reach —
no bytes leave the machine either way, though a caller whose `catch`
swallows the rejection will not itself go red.

## v0.39.0 — 2026-08-04 — The Importer Carries Everything

Importing an exported account silently discarded fourteen columns across
five tables. Six wellness fields — sleeping heart rate, HRV SDNN, readiness,
hydration, steps and sleep quality — were dropped, which is the entire yield
of the Apple Health route. So were the four race fields that weekly training
volume is derived from, meaning an imported account's plan was built from a
different event than the athlete had entered; a manual athlete-level
override; the inbox's read state; and the two availability timestamps
v0.38.0 had already identified and deferred. Every one of these is
documented by the export side as carried verbatim.

The importer lists each table's columns in a hand-written object literal,
and Drizzle marks a column optional in its insert type whenever the column
is nullable or has a default — which is nearly all of them. Omitting one
therefore compiled cleanly and lost data at runtime. This was not a rare
slip: four of the six commits that file has ever received were fixes for
exactly this, and the wellness table lost columns twice.

So this release changes the mechanism rather than the list. Every insert now
carries a type requiring each column the export emits, with a small explicit
exemption list — regenerated row ids, and the two fields the export
deliberately strips because they are a bulky provider payload and a
credential. Leaving a column out is now a compile error naming the missing
field, caught by CI on every pull request, and adding a column to the
schema without carrying it through cannot pass the build. The two
export-stripped exemptions carry their own guard: if the export ever starts
emitting one of them, the exemption stops compiling. The export → wipe →
import drill
(`scripts/export-import-drill.ts`) was also extended to content-compare all
eighteen of its importable tables, not six — week_plans, home to two of this
release's fourteen columns, was among the twelve the drill had never
actually compared, so nothing had verified those columns' survival through a
real round trip until now.

There is no repair path for accounts imported before this release. The data
was discarded at insert time and nothing holds a copy. An operator who still
has the original export file can import it into a fresh account; importing
it again into the same account would duplicate every row, since import is
additive rather than a replace. No migration, and no change to what the
export emits.

## v0.38.0 — 2026-08-04 — The Week's Target Follows the Week

A week's target load, `week_plans.effective_target`, is written once, at the
moment the week is materialized, and never updated again. But the replan
ladder keeps reshaping that same week all week long — shrinking it when
readiness drops, growing it when the athlete frees up time — so the stored
number drifts away from the week it actually describes, in both directions.
Three readers were treating that stale figure as if it still described the
current week: the race-day forecast, the CTL projection on `/train`, and the
taper-execution stat in the race debrief.

A new column, `week_plans.materialized_mins`, records the week's planned
minutes at that same materialization moment, alongside the target load
already captured there. `effective_target / materialized_mins` is therefore
a load-per-minute rate fixed to what the week was actually built at, and the
forecast, the CTL projection, and the taper stat now derive their numbers
from that rate applied to the week as it currently stands, rather than from
the frozen total. A day's projected load now depends only on that day's own
minutes — the old forecast formula divided the frozen week total by the
remaining days' minutes, so completing a day inflated every remaining day's
projected load. That redistribution is gone.

Adherence and next week's progression deliberately keep reading the frozen
`effective_target`, unchanged. That number gates the low-adherence safety
rail that stops the planner handing a full week to an athlete who has just
had a bad one, and scoring it against a rate would let a week that shrank
mid-week read back as if it had been fully met. This is a split by design,
not a leftover inconsistency.

The user-visible change: a week containing completed days now projects
_less_ future load than before, because future days no longer inherit the
load share of days already completed. That is the correction this release
makes, not a regression.

One additive migration, `materialized_mins`, nullable, with no backfill —
existing rows read NULL and every consumer falls back to its prior
behaviour exactly. Account import now carries the column through as well,
so an imported account's weeks are not stranded on the fallback path
forever.

## v0.37.1 — 2026-08-03 — Legacy blocks can be given times

An availability block migrated from the pre-block model carries its duration
in `mins` alone, with its start and end both empty. There was no way to give
such a block real clock times through the block editor at all — the edit was
always rejected and the field reverted, and the only way forward was to delete
the block and add a new one, losing whatever duration it held.

The block editor validates that a block's start and end are either both times
or both empty, and it commits after every single field edit. Setting just the
start therefore landed on the half-set shape the validator refuses, so the
change never committed. Editing one field of a two-field value could not
succeed.

Setting either end of such a block now fills in the other, derived from the
duration the block already carries: a 90-minute block given a start of 18:00
becomes 18:00–19:30, keeping the athlete's stored minutes rather than
replacing them with the default. A window that would run past midnight ends
at 23:59 and its duration follows, rather than the edit being refused.

Found by the release verification for v0.37.0; the defect predates it and is
unrelated to the fill rung. No migrations.

## v0.37.0 — 2026-08-03 — The Week Can Grow

Every rung of `replanWeek`'s ladder — move, compress, substitute, drop — could
only shrink a week. An athlete who freed up time mid-week, clearing a
Saturday or extending a Wednesday, got nothing back for it: the plan could
shed load when time disappeared but never reclaim it when time reappeared.

- **A fifth rung, fill, now runs last** in the ladder, on the settled result
  of the other four, so it sees where displaced sessions actually landed
  before deciding what room is really free. It does two things, in order.
  First it grows an existing endurance session into the room **its own
  block** gained — never a roomier sibling block elsewhere on the day, the
  same rule the rest of the ladder already enforces. Then, if the week is
  still short, it adds **at most one** new endurance session into a free,
  admitting block. One availability edit yields at most one new session;
  an athlete making three edits gets at most three — rather than one edit
  conjuring an entire week's worth of training.
- **Fill is bounded by the live target**, the same `assembleWeeklyTarget`
  figure the dashboard's WeekRow and `/train`'s WeekRationale already show
  the athlete — not the stored `effectiveTarget`, which goes stale the
  moment conditions change. That figure already carries the ACWR ceiling, so
  fill cannot outrun safe progression; it has no ceiling of its own to get
  wrong.
- **Intensity is never added or grown.** Stretching a VO2max or tempo block
  changes what the session is, not just its length — v0.30.0 settled that
  for the generator, and fill honors the same rule. Only `aerobic_base` and
  `long` sessions are ever placed or extended.
- **Running never receives a long run, and swimming is untouched by fill
  entirely** — in both cases because this codebase has no defensible bound
  for them yet, not because they were judged unimportant. Running's real
  single-session rule is athlete-relative (exceeding your own recent longest
  run by 10–30% raises injury risk) rather than a flat figure, and no swim
  duration bound exists anywhere in this codebase. Fill invents no constant
  of its own; every ceiling it applies is one the generator already uses for
  that sport and purpose.
- **The pre-race rest day is now marked** (`restIntent: "pre_race"`) so fill
  knows to leave it alone. Building this surfaced a latent gap in the mark
  itself: it had only ever been set for B-priority races, never A — exactly
  the races the pre-race taper protection exists for. Fixed alongside fill
  rather than left for a separate release, since fill would otherwise have
  filled the one day A-race protection most needs untouched.
- **Fill declines entirely on a taper or race week — not a smaller bound for
  those weeks, no fill at all.** `materializeWeek` deliberately shrinks a
  taper or race week's target (`taperFractionForWeek`), but neither fill's
  own ceiling nor the live target it fills toward has any notion of phase or
  race proximity to shrink back to — `restIntent` only ever protected the
  single day immediately before the race, leaving the rest of that week
  fillable against a target that still reads close to peak. Rather than
  invent a taper bound it cannot defend, fill refuses the whole week — the
  same "decline outright" reasoning that already keeps it off long runs and
  out of swimming, applied here to the week as a unit instead of a session.

No migrations. The one new `DaySlot` field, `restIntent`, lives inside the
existing `week_plans.days` jsonb.

## v0.36.0 — 2026-08-02 — Wellness History Backfill

Two independent losses in how Recover syncs intervals.icu wellness, neither
visible from the daily sync. First: every wellness row has always stored the
provider's full payload in `raw`, but the columns were only ever written by
whatever mapping existed at sync time — v0.33 added mappings for steps,
SpO2, VO2max, sleep quality, sleeping HR, body fat and hydration, and only
the 7-day incremental overlap ever flowed through them. Second: the first
sync was capped at 365 days and every sync since re-fetched a 7-day overlap,
so anything older than that first year was never fetched at all.

- **Phase A re-maps what's already local.** `remapStoredWellness(userId)`
  walks every stored row's `raw` payload back through the current mapping —
  no network calls. On the account this shipped against, it recovers ~245
  days of steps, ~230 of sleep quality, ~147 of SpO2, ~77 of VO2max, ~33 of
  sleeping HR, ~21 of body fat and ~10 of hydration.
- **Phase B fetches what was never pulled.** `runIntervalsBackfill` walks
  intervals.icu history backward one calendar year per request from the
  oldest date Recover holds. A dry run against a copy of production data
  found the original stop rule — the first year to come back empty — never
  fires on real accounts: intervals.icu synthesizes a wellness row for
  _every_ calendar day back to account creation, carrying only CTL/ATL decay
  (3,111 such rows, 2010–2018, `ctl` exactly 0.0, on the account this shipped
  against). The walk now **also** stops at the first chunk that holds
  nothing beyond intervals.icu's own training-load fields (`ctl`, `atl`,
  `rampRate`, `eftp`, `pMax`, `wPrime`) — that chunk is discarded, not
  written, ending the walk there instead of at account creation. A chunk with
  any other field populated is still written in full, filler days included,
  and the walk keeps going. `MAX_BACKFILL_YEARS = 20` remains the hard safety
  stop; `BackfillResult.truncated` now reports whether the walk hit that cap
  instead of a real stop condition, so a truncated run is distinguishable
  from one that genuinely reached the athlete's history floor. Both phases
  write through `applyWellnessPatch`, so a backfilled day can never outrank a
  better source, and a single `computeDailyMetrics` pass runs once over
  everything either phase touched rather than once per phase.
- **A "Backfill full history" button** on the intervals.icu settings card
  triggers it, queuing a `sync_jobs` row with the previously unused
  `backfill` kind.
- **The scheduler now routes backfill jobs** before provider dispatch, and
  heartbeats while one runs, so the 15-minute stale-reclaim can't start a
  second copy mid-run. Phase C — the metrics recompute — is heartbeated too
  now: `computeDailyMetrics` takes an optional `onProgress` callback, fired
  every 250 processed dates, and the backfill wires it to the same
  heartbeat. At real-account scale Phase C is thousands of sequential
  upserts, by far the largest previously-unheartbeated span in the job. None
  of this touches `connections.last_sync_at` — that cursor is the
  incremental sync's window, untouched by history recovery.
- **Recovery scores shift once this runs.** Older history changes the
  trailing baselines readiness is measured against. The button says so.

No migrations — `sync_jobs.kind` already carried the `backfill` enum value
and `wellness_daily` already had every column this fills.

Verified against a copy of the live database: `connections.last_sync_at`
came back byte-identical before and after a real run, and the corrected walk
stopped after 2018 — dropping all 3,111 filler rows while keeping every real
measurement, including 2019–2020's roughly 550 sleep nights that a
zero-rows-only stop condition would have missed entirely (the pre-fix walk
did not stop until 2010). 239 test files, 1647 tests, green; the suite was
also re-run with `DATABASE_URL` unset to confirm the DB-gated suites report
skipped rather than crashing.

## v0.36.1 — 2026-08-02 — CI stops going red at midnight

`main` failed CI for four hours a day. `tests/wellness-changed.test.ts` is not
DB-gated, so unlike most of this repo's suites it runs in GitHub Actions — and
between 00:00 and 03:59 UTC it failed deterministically. Every green run
outside that window said less than it appeared to, and a red run at 01:00 was
more likely to be this than the branch under test.

The cause was a test that read the real clock. "never throws when a sub-step
rejects" queued three `mockRejectedValueOnce` values and called
`onWellnessDataChanged` with no `now`, so production's 04:00 floor
(`wellness-changed.ts`) returned early inside the window — leaving the last
two rejections unconsumed. `mockClear` in `beforeEach` wipes call history but
**not** a queued `once` implementation, so the second rejection leaked into
"does not apply the 4am floor when force is true", which then saw its mock
reject instead of resolve and reported `skipped` where it expected `fired`.

- **The leaking test is pinned to 09:00** and now asserts all three sub-steps
  were actually called. Inside the window it had been exercising one of the
  three guards it claims to cover — and still passing.
- **Every mock in the file uses `mockReset`, not `mockClear`**, so an
  unconsumed `once` queue can never leak forward again. `mockReset` also
  discards the declaration-site default, so each default is re-established in
  `beforeEach`. Both layers were mutation-tested: with the pin reverted, the
  reset contains the leak and the new assertions fail at the source instead.
- **`tests/morning-hook.test.ts` had the same class of bug** — DB-gated, so it
  skipped in CI and only failed locally. The tick's post-job hook calls
  `onWellnessDataChanged` with no `now`, so the same floor suppressed the
  push. It now fakes `Date` only (real timers must survive for the pg driver),
  pins 09:00 on today's real date so the completeness-gate fixture still
  matches, and carries a 20s timeout — the full post-job hook chain takes ~5s
  and previously fitted under the 5s default only by luck.

Verified by running the whole suite with `DATABASE_URL` unset at a timezone
inside the window: 1 failed / 1243 passed before, 1244 passed after.

## v0.35.1 — 2026-08-02 — Tests stop calling providers for real

The scheduler tick's DB-wide provider passes ran during test runs. This
repo's DB-gated tests execute against a database holding real connection
rows — there is no separate test database — so every suite run that touched
`runSchedulerTick` made live intervals.icu requests on behalf of real
athletes.

It was not only network traffic. On 2026-08-02 a suite run generated a real
LLM ride review — `llm_usage` recorded haiku at 3027 input / 233 output
tokens — and wrote a Dutch coaching message into the owner's actual debrief
thread. Bounded by the existing `reviewedAt` guard, so it fired once rather
than per run, but it would fire again for every new un-reviewed activity.

- **Both provider passes now sit behind one predicate**, `providerPassesEnabled()`,
  false under vitest. v0.33 had already guarded the wellness refresh this
  way; the activity poll was left unguarded, and keeping the decision in one
  place stops the two drifting again.
- **No coverage is lost.** `runActivityPolls` and `runWellnessRefresh` keep
  their own tests, which scope the query with `userIds` and inject a fetcher.
  Only the tick's unscoped, DB-wide call is suppressed.
- **Pinned by a regression test** that mocks both modules and asserts the tick
  calls neither. Verified empirically too: a full 1614-test run no longer
  advances `connections.last_activity_poll_at`, where before it moved every
  run.

## v0.35.0 — 2026-08-02 — Sleep History

The Sleep tab showed exactly one night: the newest with a duration.
Everything else in the 90-day window it already loaded was unreachable. That
turned into a real complaint the day sleep stages started arriving, because
the Intervals.icu Companion writes a night's duration before it writes that
night's stages — so the tab reliably landed on the one night without stages
and reported that the provider sends none, with five complete nights sitting
one click away and no click to make.

- **A strip of recent nights, newest first.** Fourteen nights, each with a
  mini stage bar, above the night card. A night with a duration but no stages
  gets a dimmed bar rather than being hidden — that state is the whole reason
  this exists, so it has to be visible.
- **Prev/next arrows** on the card, stepping through the same list the strip
  shows, so the two controls can never disagree.
- **Deep-linkable.** `?night=YYYY-MM-DD`, carried through the shared href
  builder so changing tab or range keeps your place and vice versa. The
  parameter is validated against the nights actually loaded; anything else
  falls back to the latest night rather than reaching a query.
- **The no-stages message tells the truth now.** "Your provider doesn't send
  sleep stages" is kept only when no night in the window has them. A night
  missing them while its neighbours have them says "No stages recorded for
  this night yet."
- **Consistency and chronotype moved out of the night card.** They are 30-day
  aggregates and never described the night above them; with navigation they
  would have looked like they changed per night. Tonight's recommended bedtime
  is hidden entirely unless you are looking at the latest night — advising a
  bedtime for a night eleven days gone is nonsense.
- **Fixed a duration that could render as `0:60`.** Hours and minutes were
  computed independently, so a 3597-second deep-sleep block rounded its minute
  part up to 60 without carrying the hour. Rounding to whole minutes first
  fixes it; a real value from the athlete's own data is now pinned by test.

Two of these were found only by driving the page in a real browser: the
`0:60` rendering, and a strip that put the selected night off-screen at
x=528 on a 420px viewport, where it was invisible and unclickable while every
unit test passed.

## v0.34.0 — 2026-08-02 — Wellness Sync Interval

v0.33's morning re-pull solved sleep arriving a day late, and did it with a
stop condition: done for the day once yesterday has a duration and a stage.
Correct for sleep, wrong for everything else — it halted wellness polling
around 07:00 while the Companion kept writing steps, SpO2, respiratory rate
and hydration all day, none of which reached Recover until the next morning.

- **How often wellness syncs is now yours to choose.** A select on the
  intervals.icu settings card: daily only, or every 60 / 30 / 15 minutes,
  stored per connection alongside the poll cursor. The card also shows when
  wellness was last checked, so the cadence is visible rather than implied.
- **The stop condition is gone.** `yesterdaySettled()` and its query are
  deleted. Sleep arrival is still served — any interval polls more often in
  the morning than the old fixed 30-minute throttle did.
- **The window covers the waking day.** 05:00–23:00 instead of 05:00–12:00,
  still quiet overnight, where polling buys nothing: the athlete is asleep,
  the Companion has not written the night yet, and the 05:00 daily sync covers
  the boundary.
- **The default stays at 30 minutes.** Upgrading an instance never silently
  increases load on intervals.icu, which is free and run by one developer.
  "Daily only" is offered for anyone who wants none of this.
- **Awake sleep time is documented as underivable, not computed.** It is
  tempting to derive it as total minus the three stages. On this feed that
  residual is exactly zero on 31 of 31 nights, because the total _is_ asleep
  time rather than in-bed time — so the subtraction would render a guaranteed
  0 as though a night with no awakenings had been measured. Real awake time
  needs an in-bed window, which only a direct HealthKit push carries.
- Migration 0036 adds one nullable column. Additive-only, no backfill.
- The activity poll is untouched: still 15 minutes, still quiet 23:00–06:00.

## v0.33.0 — 2026-08-02 — Wellness Expansion

Health Auto Export's REST automation is a paid feature. The trial ended on
2026-07-29 and the Apple Health connector went quiet — five days of sleep
stages, blood oxygen and respiratory rate, then nothing. The replacement
sender is the free Intervals.icu Companion iOS app, which reads HealthKit via
background delivery and writes into the intervals.icu wellness log Recover
already syncs. That exposed how much of that log Recover was throwing away.

- **Twelve wellness fields now arrive instead of none.** `fetchDailyWellness`
  mapped 13 fields and dropped the rest into `raw`. Six of the discarded ones
  already had live columns waiting for them — blood oxygen (166 days of it),
  respiratory rate, body fat, and the three sleep stages. Six more now have
  columns: sleeping HR, HRV SDNN, readiness, hydration, steps, sleep quality.
  Every key, unit and scale was read off the live account rather than guessed.
- **Sleep stages, from a platform that has no sleep stages.** intervals.icu
  has no native stage model, so the Companion writes them as custom wellness
  fields. Those are renameable in the intervals.icu UI, and a rename would
  turn the mapping into permanent nulls with no other symptom — so a row with
  a sleep duration but no stages now logs a warning once per sync.
- **Last night's sleep arrives this morning, not tomorrow.** The daily sync
  runs at 05:00; the Companion writes around 06:40. A bounded morning re-pull
  (05:00–12:00, at most every 30 min, last 3 days, stopping once yesterday has
  a duration and a stage) closes the ~95-minute miss and fires the same
  wellness-changed hook, so the morning brief reflects the night it describes.
- **A silent push connector stops looking healthy.** The Apple Health card
  reported "Push via Health Auto Export" for days after the trial lapsed,
  because "connected" only ever meant "a connection row exists". After three
  days of silence it now says so. A push source has no failure signal of its
  own; it just stops.
- **Blood oxygen is stored as the percentage it already is.** intervals.icu
  reports 95.9–97.5; Apple Health reports the same measurement as a 0–1
  fraction needing ×100. Applying the Apple rule to the intervals feed would
  have stored 9650%.
- **Sleep quality is stored but not shown.** Its 1–5 scale direction is
  contested between intervals.icu's own metadata and this project's notes, and
  rendering it inverted would flip a recovery signal rather than merely look
  wrong.
- Migration 0035 adds six nullable columns plus a wellness-poll cursor.
  Additive-only, no backfill.

## v0.32.0 — 2026-08-01 — One Plan, One Answer

Three `active` training plans sat on one account, left by a single plan
creation retried twice on 2026-07-15. Seven code paths ask which plan the
athlete is on; five of them asked with an unordered query, which Postgres
answers in heap order.

- **The coach and the training engine agreed on a plan again.** The coach
  reported week 1 of a nine-week century block while the week engine was
  running week 4 — not a display bug, two different rows. Every surface now
  resolves the athlete's plan through one `getActivePlan`, which takes the
  most recently created active plan. That was already the rule the engine
  paths used, so the engine's behaviour is unchanged and the coach and
  dashboard moved onto its answer.
- **Asking the coach to change your plan changes your plan.**
  `update_training_plan` resolved the same arbitrary way, so its writes could
  land on a row nothing else read: it reported success and the athlete saw
  nothing. It now writes to the plan the engine runs.
- **Duplicate plans leave a trace.** The resolver logs a warning naming the
  count and the row it chose, rather than silently picking. The ambiguity here
  was invisible for two weeks precisely because nothing said anything.
- **The stored data agrees with the code.** Migration 0034 archives every
  active plan except the newest per athlete — exactly what the resolver
  already decides, so nothing observable changes; the ambiguity behind it goes
  away. Plan creation has archived the previous plan since 2026-07-15, ten
  hours after these rows were made, so this is a one-time cleanup rather than
  a recurring repair.
- **A backfill script for the four missing release pages is staged, not run.**
  `v0.28.0`, `v0.28.1`, `v0.29.0` and `v0.30.0` are tagged and deployed with no
  GitHub release object; `scripts/backfill-release-objects.sh` creates all
  four, but nothing in this branch or in CI calls it — it is a hand-run
  follow-up, not a completed fix.

## v0.31.0 — 2026-07-30 — Rides Get Counted

Reported: "the trainings of today do not show in the train agenda of today."
Today's slot read `status: rest, workouts: []` while two rides sat in the
activities table. Three defects behind it, one of them counting load wrong
for every multi-ride day.

- **A day you trained on no longer reads as an empty rest day.** The week
  agenda renders planned workouts, and an unplanned ride is by definition not
  one — so a rest day with two rides on it looked exactly like a rest day
  spent on the couch. Days the plan left empty now carry a line saying what
  actually happened (`✓ 2 sessions · 1:37 · 130 load`). It is read from the
  activities table, not from the day slot's stored `unplannedLoad`, because
  `runDailyAdaptation` books that onto YESTERDAY — a ride done today would
  otherwise not reach its own row until tomorrow. Planned days are untouched:
  a completed session already says so through its status chip, and repeating
  the ride underneath it would be the duplicated-data problem this project
  keeps having to undo.
- **Every ride of a multi-ride day is counted, not just the last one.** The
  unplanned-load matcher was a `findFirst` ordered by `startDate desc`.
  Because the pass runs the following day, every ride has long since synced by
  then, so it saw only the most recent and dropped the rest — permanently.
  Live evidence 2026-07-30: two rides, loads 63 and 67, of which only 67 would
  ever have counted. It now sums the day. There _was_ a test for the second
  ride, but it inserted the two activities with an adaptation run in between,
  which is not how a real day arrives — so it passed throughout.
- **The booking is now idempotent by recomputation rather than by refusing to
  look.** `recordUnplannedLoad` SETS the day's total instead of adding to it,
  and the caller recomputes that total from the activities table on every
  pass. This replaces an `activityId` guard that kept the figure from
  compounding (a real run reached `unplannedLoad` 600 over six invocations)
  but did so by never looking again — which is the same reason a second ride
  could never be added once the first had claimed the slot.
- **The week plan no longer books Strava-derived load.** Neither matcher
  filtered `provider='strava'`. Every ride exists twice, once per connector,
  with an identical `start_date` and no tie-break — so which row won came down
  to heap order, and the two loads diverge badly (live: 184 vs 83, 67 vs 95).
  Beyond being the wrong number, the week plan is read by the coach through
  `get_week_plan`, making this the same firewall class as the v0.5
  weekly-review and v0.12.2 metrics fixes. Both matchers now exclude Strava.

## v0.30.1 — 2026-07-30 — Pushes Leave a Trace

Reported symptom: two identical "Ride synced — how did it go?" notifications
for a single ride, minutes apart. This release does not claim to have fixed
that — it makes it diagnosable, and closes the one hole the investigation
did prove.

- **Every push now logs a line.** `sendToUser` is the single chokepoint all
  notifications funnel through, but logging was bolted on per-caller and only
  two of its four callers did it: the morning readiness push and the weekly
  availability prompt logged `{sent, pruned}`, while the ride-debrief push and
  the settings test push logged nothing at all on success. A debrief
  notification therefore left no trace whatsoever, which is exactly why "why
  did I get two?" could not be answered from `docker logs`. The record now
  lives in `sendToUser` itself — `{userId, tag, subscriptions, sent, pruned}`,
  plus any caller context (the debrief send passes its `activityId`) — so
  every push type gets it for free. Payload content stays out: ride names and
  debrief notes are personal data, and the tag is enough to tell sends apart.
- **A pruned subscription no longer disappears silently.** `sendToUser`
  deletes a subscription on 404/410 or an unrecoverable VAPID mismatch, and
  did so with no log line anywhere — the athlete simply stops receiving
  notifications and nothing says why. This is very close to the silent push
  death chased twice in v0.25. Each prune now logs a warning naming the
  endpoint's owner, the status, and whether it was `gone` or
  `vapid-mismatch`.
- **Promoting a ride to a pending debrief is now a compare-and-swap.** The
  promotion read "is anything pending?", then ran `UPDATE ... WHERE id = X`
  with no state guard, then sent the push — a check-then-set. A single ride
  starts several lifecycle passes within minutes of each other (Strava fires
  `create` and `update` webhooks and each schedules its own intervals
  catch-up sync; the 15-minute activity poll sweeps independently; both
  provider sync jobs run the post-sync chain; and `/api/sync/now` runs a full
  scheduler tick on pull-to-refresh), so two overlapping passes could each
  clear that read and each notify for the same ride. The new
  `claimPendingDebrief` makes the state transition itself decide, and the
  push only fires for the pass that won the row. The window this closes is
  narrow — microseconds between the read and the write, which is why two
  in-process passes could not be made to reproduce it deterministically, and
  why it does not on its own explain notifications arriving minutes apart.
  The logging above is what will settle that.

## v0.30.0 — 2026-07-29 — The Whole Target

- **Cycling weeks now schedule the hours they were actually targeting.**
  `generateCyclingWorkouts` capped every endurance ride at 90 minutes and the
  long ride at a flat 240, and whatever a cap removed was simply discarded
  rather than moved anywhere else. Live evidence: a 12.5h target was landing
  as an 8.75h week — roughly 30% gone before the athlete ever saw a session.
  Minutes a cap removes are now redistributed onto rides that still have
  room, so the week delivers the number it was already given. Intensity
  sessions (intervals, tempo) never absorb this — stretching a VO2max block
  to soak up volume would change what the session is.
- **Long rides now build toward the hardest day of your event, not a fixed
  four hours.** The long ride's cap is derived from `queenStageHours` — the
  single hardest day your target race actually demands — within a
  documented 120–360 minute range, instead of an unsourced flat 240. An
  8-day mountain tour raises the cap to 294 minutes; a criterium's short
  queen stage keeps it down near the 120-minute floor rather than
  stretching to fill four hours it doesn't need.
- **Redistribution, not the long-ride bound, is why this affects every
  athlete.** With no race entered, or no FTP on file, there's no event
  evidence to size the long ride against, so its cap keeps exactly the
  previous 240 minutes. But redistribution — the fix above — doesn't check
  for a race before it runs, and it's the larger source of the extra volume.
  A 4-session build week targeting 10.3h/week scheduled 526 minutes before
  this release (a 235-minute long ride, 111-minute intervals, and two
  endurance rides clamped from 136 down to 90 each) and schedules the full
  618 after — a ~17% increase in weekly volume for an athlete with no race
  and no FTP at all.
- **The weekly total itself is unchanged — only whether the week actually
  delivers it.** The hours a week aims for are already bounded before the
  session generator sees them (the ACWR ceiling, the ramp guard); this
  release doesn't raise that number, it stops throwing part of it away.
- **The next-week preview now says what it planned against its target**,
  the same line the current week's rationale panel already showed.

**Cycling only.** Running and triathlon workout generation still discard
whatever a cap removes — that's deliberately untouched here. Running's
correct fix is a different rule entirely: a study of over 5,200 runners
found that exceeding your own recent longest run by 10–30% raises injury
risk by 64%, which is an athlete-relative spike rule, not an event-relative
one. Borrowing cycling's fix across sports is the same mistake that
produced this defect in the first place.

## v0.29.0 — 2026-07-29 — Past Sunday

- **The week doesn't end at Sunday anymore.** `/train`'s day list now rolls
  from today straight into next week, with a visible boundary marking where
  one ends and the other begins — no more staring at a blank Monday wondering
  what's coming. Days before today drop off the list; today never does.
- **Next week is a forecast, and it says so.** Every day in next week's
  section renders provisional, because it is one: the projection assumes
  this week closes out to plan rather than reacting to what you've actually
  done so far this week — reacting to a half-finished week would otherwise
  drag the forecast downward early on, for reasons that have nothing to do
  with anything you decided. It firms up for real the moment Monday's
  rollover runs. A day you've already pinned availability for renders firm
  instead of provisional, because that part genuinely is decided.
- **You can set next week's availability now, not just this week's.** A
  `This week | Next week` switcher on the availability form — also reachable
  directly at `?availability=next` — lets you pin next week's days early.
  Next week gets its own resolved availability, its own pinned days, and its
  own verdict; it is not this week's numbers with the date changed.
  Submitting availability for a future week writes your overrides and
  replans nothing. Only submitting for the current week replans, same as
  always.
- **The next-week entry point survives the week.** Availability for next
  week stays enterable all the way through, even after this week's own
  availability has frozen for the week already underway (unchanged: that
  freeze has always happened once Monday's session completes). An early
  entry point that vanished by Wednesday wouldn't be one.
- **Nothing is persisted for a week that hasn't happened.** The preview is
  computed fresh on every render from your plan, your standard week, and any
  pinned overrides — there is no draft row quietly going stale in the
  database while nobody's looking.

**Deliberately not in this release:** projecting more than one week out;
editing next week's individual sessions; a "fill" rung that adds training
back once availability opens up mid-week; reconciling a week's plan against
load that arrives after the week has already closed; and cleaning up stale
open weeks or the rare account carrying more than one active plan.

## v0.28.1 — 2026-07-29 — Stopping The Compounding

- **Fixed: the daily adaptation was compounding readiness scaling on every
  run instead of applying it once.** `onWellnessDataChanged` calls
  `runDailyAdaptation` from five call sites by design — every wellness
  write, every scheduler sync job, the 09:00 backstop, every Apple Health
  push ("roughly hourly" per its own comment), and CSV import. The readiness
  scaler read its own already-shrunk output back as its input each time it
  ran, so amber (×0.85) and red (×0.70) kept multiplying onto a session that
  had already been multiplied. A separate bug judged yesterday "missed"
  before the day's ride had a chance to sync, and a third rebooked a
  rest-day bonus ride's load on every repeat run instead of once.
- **What that cost a real athlete.** A 137-minute Long ride was ground down
  to 8 minutes on 2026-07-24 (six amber scalings then six red — 0.85⁶ ×
  0.70⁶ = 0.0445) and to 60 minutes on 2026-07-28 (five amber runs, 0.85⁵ =
  0.4437). The missed-too-early bug dropped a session the athlete had
  actually ridden — 1.94h at 18:50 the evening before — because the
  adaptation ran at 04:50, ahead of the sync. That closed three consecutive
  weeks (2026-07-13, -20, -27) as "fully missed" while the athlete was
  riding roughly 7 hours a week, each one restarting the next at 60% of
  skeleton. The rebooking bug counted a single rest-day ride's load
  anywhere from 5 to 15× over, depending on how many runs hit it before the
  ride was replaced by something else, inflating the following week's
  ramp-clamp target with the inflated total.
- **The readiness adaptation is now a function of the originally planned
  session and today's band — never of its own previous output.** Each day
  remembers what it was adapted from; a second run for the same band is a
  no-op, a worsening band recomputes from the original rather than scaling
  what's already scaled, and a recovery to green restores the session
  outright. A session is only judged missed once activity data for that day
  is actually settled — an activity-providing connection has synced since,
  or the athlete has none at all — and a connection that will provably
  never sync again, or has gone quiet for 3 days, no longer freezes that
  judgement forever. A rest/race-day activity is now booked once, guarded
  on its own id. An availability resolution that hasn't actually changed no
  longer triggers a replan or logs a no-op adjustment.
- **Already-corrupted weeks have a way back.**
  `scripts/repair-corrupted-week.ts` recomputes what an open week should
  hold using the exact same derivation the weekly rollover uses, and
  replaces every day that isn't already completed, missed, or a race —
  clearing the stale readiness anchor so the next adaptation starts from the
  restored session, not the corrupted one. Real synced activity load is
  never touched, on any day. Dry-run by default and prints a per-day
  before/after table; `--apply` writes, `--user` scopes to one athlete;
  running it twice makes no further change the second time.
- **This corruption was ours.** The adaptation re-derived itself from its
  own output for multiple release cycles without anyone noticing, because
  any single run looked reasonable in isolation — it was the accumulation
  across five call sites firing all day, every day, that ground a real
  athlete's week down to nothing.

## v0.28.0 — 2026-07-29 — The Race Sets the Week

- **Your weekly hours now come from the event you're training for**, not from a
  number typed once when the plan was created. Enter a race's days, distance and
  climbing — optionally day by day — and the app estimates what it physically
  asks, then derives a weekly target from it.
- **Bounded by your own history, in both directions.** The target is capped at
  1.3× your rolling 12-week peak (the acute:chronic workload ratio's safe-zone
  bound) and floored at 0.6× it, so a low-volume event like a criterium can't
  prescribe a detraining week. **With no measured history there is no ceiling and
  no race-driven target at all** — the plan's own figure stands. Absent evidence,
  the app says nothing rather than guessing.
- **Availability is a ceiling, never a target.** A free week does not become a
  bigger prescription.
- **The week now explains itself.** The engine has always logged its own
  arithmetic accurately — "last week was fully missed — restarting at 60% of the
  skeleton target", "3.1h available instead of 6.0h" — and nothing ever showed
  it. A small week read as a bug. Those reasons now appear under the week grid,
  alongside what was planned against what was targeted.
- **A readiness verdict for the event itself**: ready / on track / tight / not
  realistic, judged on volume _and_ on longest ride, because eleven hours a week
  ridden as five short sessions does not prepare anyone for a seven-hour mountain
  day. It informs and never blocks — you can still enter anything you like,
  having been told plainly what it asks.
- **The skeleton is recomputed every rollover** rather than read from the stored
  plan. A stored target going stale is what this release exists to end.
- **The dashboard and Train now show the same target.** They previously
  disagreed, and the dashboard's was the stale number.

**Honest about its limits.** `HEADROOM` and the maintenance floor come from
published research; `REAL_WORLD_FACTOR` and `CLIMB_GRADIENT` are calibration
constants with **no published basis**, and the longest-ride fraction is
**contested** — sources contradict each other, so it can soften a verdict but
never declare an event impossible on its own. Every constant and its confidence
level is recorded in `docs/specs/2026-07-28-training-volume-evidence.md`.

**One known gap, deliberately not closed here.** The workout generator caps
individual sessions, so a week saturates around 9.8 hours no matter how high the
target goes. The engine now _says so_ when that happens rather than showing an
unexplained deficit; actually lifting the cap means rewriting the generator, and
that is its own release.

**Caught before it shipped.** The final review found that an athlete with no
recent training and a logged event would have been prescribed a **zero-hour
week** — the "no measured ceiling" safety branch was unreachable, because the
hours-history builder returns twelve zeros rather than an empty list, so a peak
of zero read as a real measurement. It would have hit new users and anyone
returning from injury: exactly who that ceiling protects.

## v0.27.0 — 2026-07-28 — The Planner Can See You Ride

- **Fixed: no cycling session was ever recorded as completed.** The plan
  describes a bike session as `Bike`; every provider stores the ride itself as
  `Ride` (or `VirtualRide`). The completion matcher compared the two with a raw
  equality, so across 219 rides it never matched once. Runners were unaffected —
  `Run` happened to equal `Run` — which is why it survived every review.
- **What that cost.** With nothing ever matched, each day kept `actualLoad`
  empty, so every week closed with zero actual load and was read as "last week
  was fully missed". The next week then restarted at 60% of its target. Week
  after week, compounding. Landing on a scheduled recovery week (a further 60%)
  it produced a **4.9-hour plan for an athlete training ~9 hours and offering
  12.5**. The reasons were logged accurately the whole time; nothing surfaced
  them.
- **Sport is now read through one shared vocabulary**
  (`src/lib/canonical-sport.ts`), used by the matcher and its tests alike.
  Unfamiliar activity types pass through untouched rather than being forced into
  the nearest training sport — a tennis match must never book as a completed
  ride.
- **Days already behind you have been repaired.**
  `scripts/backfill-day-load.ts` books the open and most recently closed week
  using exactly the rules the daily adaptation uses, collapsing rides synced from
  both intervals.icu and Strava so they count once. It leaves a matched activity
  whose load has not yet been computed for a later run rather than booking a
  zero. Idempotent.
- **Expect a gradual recovery, not a jump.** Week-over-week load is still
  clamped to ±20% of what you actually did, so a plan climbs back over two to
  three weeks. The difference is that the figure it climbs from is now real.

## v0.26.1 — 2026-07-28 — Editing Your Standard Week Replans It

- **Fixed: changing your standard week updated the availability card but not
  the plan.** The card shows your standard week merged with any pinned dates,
  so it moved the moment you saved — while the week below it still showed the
  sessions from before. Zeroing a Friday made Friday read "Rest" with a
  session still sitting on it. Saving a weekday now replans the open week the
  same way editing a single date already did; pinned dates keep winning, and
  nothing else in the week moves. The same gap is fixed in the coach's
  `set_standard_week` tool.

## v0.26.0 — 2026-07-28 — Availability, Block By Block

- **Your availability is a standard week now, with per-date exceptions on
  top.** You set each weekday once — that's the shape of a normal week — and
  a change to a single date is pinned to that date. The pin always beats the
  default and survives later changes to it, so a one-off is a one-off again:
  moving next Tuesday's ride no longer quietly becomes every Tuesday's new
  normal. Editing a pinned date back to match the standard week un-pins it.

- **A day is a list of time blocks, not a bucket of minutes.** Forty-five
  minutes before work and an hour in the evening are two training
  opportunities, not one 105-minute one — and the planner no longer pretends
  otherwise. Sessions are placed into a specific block and must fit _that_
  block whole. Two blocks can carry two sessions on the same day.

- **Each block carries the energy you expect to have, and optionally which
  sport.** An easy block will take a recovery, endurance or long ride;
  a normal one adds threshold work; only a full block gets intervals or a
  brick. A block marked for one sport won't be handed a session from
  another. Both constrain what may be scheduled there — they are not hints.

- **Changing your availability no longer regenerates the week.** Only the
  sessions actually displaced by the change move, along a fixed ladder: move
  to another day that fits it whole, shorten it while keeping its purpose,
  substitute a session that still works at the length available, and only
  then drop it. Everything the change didn't touch stays exactly where it
  was, and every automatic change is logged with the reason it happened.

- **A session is never truncated below the point where it stops working.**
  Twenty minutes of a ninety-minute long ride is not a short long ride, it's
  nothing — so the planner substitutes something that does deliver at that
  length instead of shipping you a stub.

- **Unplanned work counts toward the week without eating the plan.** A bonus
  ride on a rest day is recorded against the week's actuals; it never
  removes a session you were meant to do.

- **One prompt a week to confirm your training time**, and a warning when
  the time you gave can't hold the fitness you have — measured against your
  own CTL, not a generic table. It stays silent until there are 28 days of
  load history behind it, and it stops asking once you've answered or once
  the week is more than half gone.

- **"No time today"** on a day's action menu pins that date to zero and
  replans around it.

- **The coach can manage all of this too.** `set_week_availability` now
  takes time blocks (and still accepts the old seven-integers form, so
  existing conversations keep working), joined by two new tools:
  `set_standard_week` for one weekday of the standard week, and
  `clear_availability_override` to un-pin a date. A change the coach makes
  is pinned exactly as one of yours is, so it survives the next replan.

- **Breaking, for MCP clients only: `get_week_plan` and
  `set_week_availability` changed their output shape.** Each day now reports
  `availableBlocks` (a list of blocks) instead of `availableMins`, and
  `workouts` (a list) instead of a single `workout`. Anything reading those
  two fields must be updated. Tool _inputs_ are unaffected — the frozen
  surface grows from 54 to 56 tools and `set_week_availability`'s schema
  change is additive, so existing calls keep working (see
  `docs/API-STABILITY.md`).

## v0.25.19 — 2026-07-27 — Every Trend Against Your Own Normal

- **Every chart on Body now shows the band it's being judged against.** HRV
  and resting HR have always been drawn against your own baseline; sleep
  duration, sleep score, weight, VO2max, blood oxygen, wrist temperature,
  BMI, lean body mass and waist circumference were bare lines you had to
  eyeball. They now carry the same shaded band and dashed centreline, with
  `mean ± sd` in the card header. The band is your own trailing 60 days,
  under the same rules the readiness engine uses: days you flagged (🤒 ill,
  ✈️ travel, 🏔️ altitude) are left out, and the current reading is not
  counted in the normal it's compared to. Nothing here is a population norm.

  Two deliberate silences: fewer than 14 readings shows no band rather than
  inventing a normal from four days, and a perfectly flat history (a VO2max
  that hasn't moved in two months) shows no band rather than a hairline you
  fall outside of every day.

- **The 30-day view no longer shrinks the baseline to fit.** The band is a
  fixed 60-day reference, so the shorter ranges now read the full window
  instead of whatever happened to be on screen — the same metric no longer
  reports a different "normal" at 30d than at 90d.

## v0.25.18 — 2026-07-27 — Notifications, Clocks And Language

- **One way push notifications could die silently is closed off.** A missing
  or malformed `ENCRYPTION_KEY` — a configuration hiccup, with the stored key
  itself perfectly intact — was enough to make the app throw away the
  instance's push keypair, which unsubscribed every device at once. Recovery
  meant re-enabling notifications by hand, and nothing announced that it had
  happened. That fault is now told apart from a genuinely unreadable key:
  the keypair is kept and the error surfaces instead.

  _Corrected after release:_ this was **not** the cause of the repeated
  orphaning actually seen in the wild. That turned out to be a test
  overwriting the live instance's keypair on every full-suite run, fixed
  separately in `ae0d1df` — after v0.25.18 had already shipped, and not part
  of it. The guard above is still right, but it does not by itself mean push
  can no longer be orphaned silently.

- **Bed and wake times now show your clock, not the server's.** A 23:32
  bedtime was displayed as "21:32" and a 07:53 wake as "05:52". The times
  were recorded correctly all along — they were being read back in the
  wrong timezone. Sleep midpoint, chronotype, consistency, social jetlag
  and the recommended bedtime were shifted by the same amount. Set `TZ` in
  your `.env` (defaults to UTC, so existing installs are unchanged); it
  also puts the daily sync, the morning brief and the 09:00 backstop on
  your local clock rather than the server's.
- **The coaching language setting now holds on the coach's own messages.**
  With the language pinned to Dutch, a morning brief could still come back
  in English — the setting was applied, but the instruction behind it was
  written in English and the model followed that instead. The chosen
  language now travels with the instruction on all five coach-written
  surfaces: morning brief, weekly review, monthly report, ride debrief and
  race debrief. Automatic mode is unchanged.

## v0.25.17 — 2026-07-27 — Brief Waits For Real Data

- **The morning brief now waits until last night's HRV and sleep have
  actually arrived.** Those two carry 60% of the readiness weight between
  them, but the engine would happily score without either — so a brief
  could fire on resting heart rate alone and read "green, good day for
  intensity" while the completed data said amber. It now holds until the
  overnight measurement is in.
- **When it can't wait, it says so.** For athletes with a connected data
  source, if the data still hasn't arrived by the 09:00 backstop, the brief
  still appears but names exactly which signals are missing and what the
  number leans on instead, rather than presenting a partial reading as a
  whole one.
- **An incomplete brief gets one silent correction.** If the real data
  lands later that morning, the brief is replaced in place — one message,
  no second notification — so the day never ends on advice the app already
  knows is wrong. A brief that was complete to begin with is never touched.

## v0.25.16 — 2026-07-26 — Event-Driven Sync Triggers

- **The morning brief no longer waits on the fixed 05:00 provider sync.**
  It now fires as soon as enough of today's data has landed — from an
  Apple Health push, any provider sync, or a manual wellness entry,
  whichever arrives first — instead of only reacting to the once-daily
  intervals.icu/Strava/Whoop/Oura/Withings sync. A new 09:00 server-local
  backstop still posts a brief with whatever's available if nothing has
  fired by then, so the athlete never goes without one.
- **Weekly and monthly review now land on the day they're actually due,
  not a day late.** Both already defaulted to 07:00 (unchanged by this
  release) — but the old sync-only trigger only checked whether a review
  was due when the once-daily sync ran, at 05:00, two hours before that
  07:00 slot on the due day itself. Checked at 05:00, the slot always read
  as "not due yet," so detection silently deferred to the _next_ day's
  sync: the weekly review landed every Tuesday instead of Monday, and the
  monthly report on the 2nd instead of the 1st. Both are now also
  re-checked on every scheduler tick past the new 09:00 backstop hour —
  safely after 07:00 — so the due check runs on the correct day for the
  first time. A user-set `weeklyReviewHour` preference still overrides the
  default exactly as before.

## v0.25.15 — 2026-07-26 — Apple Health Metric-Name Diagnostic

- **Temporary diagnostic logging** for the Apple Health ingest endpoint: logs
  the metric type identifiers present in each Health Auto Export payload
  (never values). v0.25.14's VO2max mapping isn't populating despite the
  athlete confirming VO2 data is tracked and selected for sync, while the
  same release's blood-oxygen mapping works correctly — this log will show
  the real metric name Health Auto Export sends so the guessed `"vo2_max"`
  case can be corrected if wrong. To be removed once confirmed.

## v0.25.14 — 2026-07-26 — Apple Health Hybrid Vitals

- **Apple Health now outranks intervals_icu for physiology and body-composition
  fields.** intervals.icu's wellness sync runs once a day; Apple Health can
  push every 15 minutes via Health Auto Export. Previously `apple_health`
  ranked lowest in the wellness merge-priority ladder, so any same-day
  freshness advantage got silently overwritten each morning by the next
  intervals_icu sync. `apple_health` now ranks just above `intervals_icu` in
  both the physiology (HRV, sleep, resting HR, etc.) and body-composition
  (weight, body fat, blood pressure) priority ladders — still below manual
  entry and any dedicated wearable/scale.
- **Six new Apple Health metrics mapped**: VO2max, blood oxygen, wrist
  temperature, BMI, lean body mass, and waist circumference now flow from
  Health Auto Export into `wellness_daily` and appear as new trend cards on
  the `/body` page. Wrist temperature is stored as its own absolute value —
  not conflated with Oura's baseline-relative temperature deviation, which
  uses a different scale entirely.
- **Fixed a GDPR export/import round-trip gap**: the account-import path was
  silently dropping 9 `wellness_daily` columns on restore (this release's 5
  new fields, plus 4 from an earlier release — `vo2max`, `rampRate`, `pMax`,
  `wPrime` — that had the same gap since v0.22). Export already carried every
  column; import now does too.

## v0.25.13 — 2026-07-26 — Apple Health Ingest 405 Fix

- **Fixed the Apple Health (Health Auto Export) ingest endpoint returning
  405 to the iOS app.** `src/proxy.ts`'s session-cookie auth guard excludes
  token-authenticated external endpoints (`/api/mcp`, `/api/cron`,
  `/api/webhooks`) since they have no browser session to check — but
  `/api/connections/apple-health/ingest` (authenticated by a per-user
  ingest token, not a cookie) was never added to that list. An
  unauthenticated POST got 307-redirected to `/login`, which preserves the
  POST method; `/login` is a GET-only page route, so the redirected
  request came back as 405 — the symptom the app actually showed, not
  anything from the ingest handler itself. Added the route to the proxy's
  bypass list (matcher regex + inline check), matching how the other
  token-authenticated endpoints are handled.

## v0.25.12 — 2026-07-25 — Availability Sheet Can Be Closed

- **Added a visible "Done" button to the weekly-availability bottom
  sheet.** It previously only closed by tapping the dim backdrop, which
  the preset chips and hour/minute wheels left little to no visible room
  for — there was no discoverable way to close it after entering hours
  for a day.

## v0.25.11 — 2026-07-25 — Lock Mobile Pinch-Zoom

- **Disabled pinch-to-zoom and double-tap zoom on mobile.** The viewport
  meta tag now sets `maximum-scale=1, user-scalable=no` (in addition to
  the existing `viewport-fit=cover`), and `html` gets
  `touch-action: pan-x pan-y` as a backup for browsers that don't fully
  honor the meta tag's scale lock. Layout now stays fixed at its intended
  scale regardless of touch gestures.

## v0.25.10 — 2026-07-25 — Coaching Language Actually Saves

Live-testing v0.25.9's new Coaching language setting immediately after
release surfaced two real bugs in it.

- **Fixed the Personality/Coaching-language dropdowns appearing to not
  save.** They used `defaultValue` inside a `<form action={...}>` bound
  via `useActionState`. React 19's form-action submission path calls the
  DOM's native `form.reset()` once the action settles, which snaps every
  `<select>` back to whichever `<option>` has no explicit HTML `selected`
  attribute (the first option in the list) — not whatever was just picked.
  The save always persisted correctly server-side; only the displayed
  value was wrong, making the setting look impossible to save. Fixed by
  submitting imperatively instead of via the form's `action` prop, which
  avoids the native reset path entirely.
- **Fixed chat suggestion chips staying in English regardless of the
  pinned coaching language**, and — because the save bug above meant the
  language setting was never actually sticking — using one of those
  English-worded suggestions always got an English reply even with a
  language pinned, which read as "the pinned language doesn't work" when
  the underlying prompt rule was fine all along. Suggestion chip text is
  now localized to the pinned language (21 languages, "auto" or an
  unrecognized code falls back to English).

## v0.25.9 — 2026-07-25 — Coach Language Setting

- **New "Coaching language" setting in Settings**, next to Personality,
  using the same dropdown pattern and saving in one submit. Previously the
  coach only ever matched whatever language the athlete last typed in
  chat — with no way to pin it, and no signal at all for the five
  proactive/no-input surfaces (morning insight, weekly review, monthly
  report, ride debrief, race debrief), whose output language was an
  unconstrained LLM guess. Defaults to "Automatic" (today's match-the-
  athlete behavior); once pinned to a specific language, the coach replies
  in it everywhere, chat included, even if the athlete writes in a
  different language. Supports 21 languages. An unrecognized/stale
  language code anywhere falls back to the automatic rule rather than
  erroring. Round-trips through GDPR export/import like every other coach
  setting. Spec: `docs/specs/2026-07-24-coach-language-setting-design.md`.

## v0.25.8 — 2026-07-24 — Availability Picker, Bigger Health Exports, and Chart Fixes

- **New tap-to-open Availability Picker.** The weekly plan intake step's
  7-day "minutes available" grid used raw `<input type="number">` fields —
  slow and fiddly on a mobile numeric keypad. Each day is now a tap target
  showing its value as a pill ("1h 30m" / "Rest"); tapping opens a bottom
  sheet with one-tap preset chips (Rest, 30m, 45m, 1h, 1h30, 2h, 2h30) plus
  a scroll-snap hour/minute wheel for anything else, both auto-saving with
  no Done button, and a live weekly-total footer. 15-minute granularity
  throughout, replacing the old 5-minute step. Spec:
  `docs/specs/2026-07-24-availability-picker-design.md`.
- **Apple Health ingest cap raised 10MB → 50MB.** Health Auto Export's
  all-metric/multi-day exports were hitting the old cap on both Next's
  middleware body limit and the route's own `MAX_BODY_BYTES`, silently
  dropping every sync attempt (`last_sync_at` never advanced, zero new
  `wellness_daily` rows, no error surfaced to the user).
- **Fixed the bar chart's invisible weekly-load bars.** Train → Fitness →
  Weekly load rendered every bar at `0px`, even though the underlying data
  was correct. Each week's bar wrapper sat in a row-flex container using
  `items-end` (not `stretch`), so the wrapper never inherited a definite
  height — its own height stayed intrinsic, which for a single child whose
  height is itself a percentage resolves to `0`. The bar's `height: X%` was
  then a percentage of a `0px` box, so it also rendered at `0px` regardless
  of the (correct) load value or color. Fixed by giving each wrapper
  `h-full` so it takes the full height of the chart's fixed-height
  container, letting the inline percentage heights resolve against a real
  number.
- **Fixed sync gaps compressing instead of showing as gaps** on the Body
  page's HRV/RHR/weight/sleep trend charts. `BaselineTrendCard` positions
  points by array index, but the Sleep/Trends tabs built values by mapping
  over the sparse wellness query result — days with no synced row were
  silently omitted rather than represented as gaps, so any sync hole
  compressed that stretch of time in the chart instead of showing a break.
  A new `fillDailyGaps()` helper now builds one entry per calendar day
  across the window, with explicit nulls for missing days.

## v0.25.7 — 2026-07-24 — Activity Times Are Stored in True UTC, Not Local-Time-Mislabeled-As-UTC

The root cause behind this session's whole run of timezone symptoms
(v0.25.2 through v0.25.6): `activities.startDate` was never storing a true
UTC instant. `fetchActivities()` preferred intervals.icu's
`start_date_local` — the athlete's wall-clock time with no offset suffix
(e.g. `"2026-07-21T18:50:01"`) — and `new Date()` parses an unsuffixed
string as UTC, so a ride that really started at 18:50 local (16:50 true
UTC for a UTC+2 athlete) got stored as if it started at 18:50 UTC: two
hours in the future relative to reality. This canceled out by coincidence
for local-day/hour bucketing, because every reader in the app also ran
`.getHours()`/`.getDate()` in the same always-UTC production container —
but it broke outright for any real elapsed-time comparison against
`Date.now()`, which is what actually produced the debrief-promotion delay,
the future-dated `isAwaitingReview` gate, and auto-describe racing ahead
of the debrief.

- **New `activities.start_date_local` column** (additive-only) stores the
  athlete's wall-clock string separately from `start_date`, so the two
  concerns — "what instant did this happen" and "what was the athlete's
  local day/hour" — are no longer conflated in one field.
- **`start_date` now stores the true UTC instant** for both the
  intervals.icu and Strava connectors (Strava attaches a misleading
  trailing `Z` to its own `start_date_local`, which is stripped before
  parsing rather than trusted).
- **Every local-day/hour call site across the app** (training load, debrief
  lifecycle, scheduling boundaries, insights auto-tagging, the weekly
  train view, activity display) now reads `startDateLocal` instead of
  reading local getters off `startDate` — the fix that actually closes the
  loop without regressing calendar-day bucketing.
- **GDPR export/import** round-trips `startDateLocal` too, so a
  re-imported account doesn't silently lose the distinction.
- **New backfill script** (`scripts/backfill-start-date-local.ts`)
  recomputes both fields for existing rows from each activity's stored raw
  provider JSON, using the same precedence as the connector fix. Its
  wall-clock parse is anchored explicitly to UTC
  (`parseWallClockAsUtc`) rather than relying on the parsing process's
  host timezone, since — unlike the always-UTC production container — the
  script may be run from any operator machine.

## v0.25.6 — 2026-07-23 — Auto-Describe No Longer Races the Debrief

Auto-describe's `isAwaitingReview` gate assumed a null `debriefState` always
meant "this activity was never debrief-eligible" — true for historical
imports, but no longer true now that the webhook (v0.25.1) syncs a ride
within seconds. A Strava-sourced stub's `startDate` can still land in the
future for a while (the timezone quirk noted in v0.25.2/v0.25.3 — real
`start_date` is withheld, and the local-time fallback lands ~the athlete's
UTC offset ahead), which blocks debrief promotion until real time catches
up. Auto-describe raced ahead of that delay, describing the ride before it
ever had a chance to be promoted — and because a description write is
permanent (the marker blocks all future writes), that ride's Strava
description could never be updated with RPE/feel once the athlete actually
answered the debrief later.

- `isAwaitingReview` now also waits for a Strava-sourced stub whose
  `startDate` is still in the future — bounded, not indefinite: once real
  time passes it, the lifecycle has had its fair shot either way and
  describing proceeds exactly as before.

## v0.25.5 — 2026-07-23 — Push Notifications Actually Deliver

The test-notification button reported nothing failing, but no push ever
arrived. Root cause: the server's VAPID key pair had changed at some point
(exact trigger unconfirmed — no error was ever logged for it, so it
predates the retention window), which cryptographically orphaned every
existing browser subscription. Apple and Mozilla each reported this
clearly (`VapidPkHashMismatch` / `"VAPID public key mismatch"`) — but
`sendToUser` only ever pruned a subscription on 404/410, so these just
failed silently on every send, forever, with `sendTestNotification`
reporting the misleading "no active subscription" message.

- **`sendToUser` now also prunes on an unrecoverable VAPID key mismatch**
  (matched specifically, not a blanket "any 400/401" — a generic 400 stays
  logged-and-retried, since it might be transient).
- **The bigger fix: re-enabling notifications couldn't actually fix this.**
  The browser's Push API silently returns an _existing_ subscription from
  `pushManager.subscribe()` rather than creating a new one — even when it
  no longer matches the server's key — so clicking "Enable" again kept
  saving the same broken subscription. It now unsubscribes any existing
  one first, guaranteeing a fresh subscription tied to the current key.

## v0.25.4 — 2026-07-23 — Deleted Activities Don't Linger

An activity removed at the source stayed in Recover forever — nothing ever
told it the ride was gone.

- **Deleting an activity on Strava now deletes it here too.** Strava's
  webhook already sends `aspect_type: "delete"` events; Recover received
  them but silently did nothing. It now removes both the native
  `provider: "strava"` sync row and any `provider: "intervals_icu"` row
  sourced from that same Strava activity (matched the same way
  auto-describe resolves a Strava id from an intervals.icu row — see
  v0.25.3).
- **New manual "Delete activity" action** on the activity page (trash icon
  next to the title, confirm-before-delete) covers what no webhook ever
  can: intervals.icu itself has no webhooks at all, so a ride removed there
  can only be caught by hand.

## v0.25.3 — 2026-07-23 — Auto-Describe Reaches Strava-Sourced Rides

Same root cause as v0.25.2's debrief gap, this time hitting Strava
auto-describe: intervals.icu withholds `strava_id`/`strava_activity_id` for
any activity it sourced from Strava, so a completed ride review could never
find where to write the description — `describeActivityOnStrava` silently
skipped every one with `reason: "no_strava_id"`, and would have forever.

- **New `resolveStravaId()`** falls back to the activity's own
  intervals.icu `externalId` when `raw.source === "STRAVA"` — confirmed 1:1
  against the sibling native `provider: "strava"` sync row's `externalId`
  for the same ride, since intervals.icu borrows the Strava id as its own
  for activities it can't otherwise access. Used by both the post-sync
  auto-describe path and the `describe_strava_activity` coach tool.
- **The settings preview no longer picks a Strava-sourced stub** as its
  "most recent activity" sample — those carry almost no fields to render
  (only CTL/TSB survive, from wellness data, not the activity itself),
  which made the preview look broken even with every field enabled. It now
  skips straight to a real data-bearing ride, same as before this gap was
  introduced.

## v0.25.2 — 2026-07-23 — Ride Review Actually Pops Up

Two gaps kept the post-ride debrief from ever reaching the athlete in
practice: it only ever showed as a Today-dashboard chip or push-notification
deep link, never on the ride's own page, and rendered as a form buried in
the page flow rather than the bottom-sheet popup used everywhere else in the
app. Opening a ride with a pending debrief now pops the same sheet.

- **`debriefEligible` no longer permanently excludes Strava-sourced rides.**
  intervals.icu withholds `duration`/`load` for any activity it sourced from
  Strava (own API note: "STRAVA activities are not available via the API"),
  which previously failed the 15-minute-minimum check forever, with no
  retry that could ever fix it. A real webhook-triggered create event is
  already proof of a genuine ride, so an unknowable duration no longer
  blocks it — a plain not-yet-synced null duration (any other provider)
  still waits its turn as before.
- **The activity page now mounts the real `DebriefSheet` popup** for a
  pending debrief instead of the old inline `DebriefForm`, matching the
  sheet already used for the dashboard chip and push-notification deep
  link. Metric formatting (`formatActivityMetrics`) is now shared between
  both entry points instead of duplicated.

## v0.25.1 — 2026-07-23 — Webhook Callback Fix

v0.25.0 added `/api/webhooks/strava` but never actually made it reachable:
the session-redirect proxy 307'd every unauthenticated request to `/login`,
including Strava's own verification handshake and every subsequent event
POST — so the webhook shipped dead on arrival.

- **`/api/webhooks/*` now bypasses the session gate**, alongside the
  existing `/api/mcp`/`/api/cron` bearer-auth routes — verified live via
  Strava's actual push-subscription creation, not just a local curl.

## v0.25.0 — 2026-07-23 — Strava-Triggered Intervals Sync

intervals.icu has no webhooks, so a new ride only ever showed up after the
daily 5am sync, the 15-min ride-debrief poll, or a manual "Sync now" click
— nothing pushed a fresh ride to an open dashboard tab.

- **New `/api/webhooks/strava` endpoint.** Strava does support push
  subscriptions; on an activity-create event we now schedule an
  intervals.icu catch-up sync ~90s later (giving intervals.icu's own
  Strava ingestion a head start) instead of waiting on the poll or daily
  sync. intervals.icu stays the ride source of truth — Strava rows are
  still excluded from every AI/MCP surface, unchanged.
- **The sync chip now polls `/api/sync/status` every 45s** and refreshes
  the dashboard when a background or webhook-triggered sync lands, so a
  new ride shows up without a manual reload.
- New `STRAVA_WEBHOOK_VERIFY_TOKEN` env var; one-time subscription
  registration `curl` documented in the webhook route's file header.

## v0.24.0 — 2026-07-23 — Strava Auto-Describe Fixes & Fields

VO2max was effectively always blank on Strava descriptions — it only ever
read the per-activity intervals.icu payload, which rarely carries an
estimate. Worse, auto-describe used to write the Strava description in
the same tick a ride was promoted to a pending debrief, before the
athlete had even seen the popup; because the write is append-once
(marker-gated), that meant the ride review could never be added
afterward, no matter when the athlete answered.

- **VO2max now falls back to the daily wellness value** (`wellnessDaily.vo2max`)
  when the activity itself doesn't carry an estimate — same pattern as the
  existing eFTP fallback. The coach's `get_biomarkers` tool had the same
  bug (hardcoded `vo2max: null`) despite already fetching the data; fixed.
- **Auto-describe now waits for the debrief to resolve.** `describeActivityOnStrava`
  gates on `debriefState`/`reviewedAt`; the Strava write fires the moment
  the ride review actually posts (from the popup submit, the debrief
  lifecycle retry, or a race debrief) instead of racing it or waiting for
  the next daily sweep.
- **Two new opt-in description fields**, same per-field settings toggle as
  the rest: **Ride review** (short AI-generated summary, ~140 chars) and
  **RPE / feel** (the athlete's own debrief answer, shown alongside it).

## v0.23.1 — 2026-07-23 — Coach Composer & History

Follow-up to v0.23.0's inbox. The composer was `fixed left-0 w-full`, so
it could slide under the desktop sidebar or sit off-center; it now lives
in normal flow (`h-svh` column: header → scrollable messages →
composer), so it can't drift regardless of viewport width.

- **Chat|Inbox segments, the Chat History and Quick Context
  collapsibles, and the pill row above the composer are gone.**
  Suggestions now show only on an empty chat (max 3), and clicking one
  sends it immediately instead of just filling the input.
- **Inbox merges into one History surface**: "From your coach"
  (system-thread messages, unread dots, kind tiles) above "Chats" — a
  bottom sheet on mobile, a dropdown from the thread-title button on
  desktop. `/coach?tab=inbox` now redirects to `/coach`.
- Input is now an auto-growing textarea (Enter sends, Shift+Enter
  newlines) instead of a single-line field.

## v0.23.0 — 2026-07-23 — IA & Navigation Redesign

Every route gets a job, duplicated modules get one home, and the nav is
renamed to match: `Home / Plan / Log / Coach / Journal / Menu` becomes
`Today / Train / Coach / Body / Menu`. Handoff:
`docs/design_handoff_ia_redesign/README.md` (mockups, rationale, screen
specs for every screen below).

- **Today rebuilt**: one glass hero (readiness ring, band verdict, a
  numeric why-line, Recovery/Sleep legend), a 2×2 (4-across on desktop)
  vitals grid with 7-day sparklines, a session card whose **Mark done**
  button is now real — `markDayDone` records the athlete's word as status
  only (no invented load, no synthetic activity), so week adherence still
  reflects only what actually synced.
- **`/plan` and `/log` merge into `/train`** (Week · History · Fitness
  tabs): the week becomes one grouped hairline-row surface instead of
  seven glass cards; History gets a 7-day stat strip over compact rows;
  Fitness gets CTL/ATL/TSB tiles above the PMC chart. `/plan` and `/log`
  retire as framework-level 308s to `/train`.
- **`/journal`, `/health`, and `/log`'s wellness half merge into `/body`**
  (Trends · Sleep · Journal · Labs): HRV/RHR trends render against the
  athlete's own baseline band instead of a population norm; sleep gets its
  real stage breakdown, consistency, chronotype and tonight's recommended
  bedtime. `/journal` and `/health` retire as 308s to `/body`.
- **Coach gains an inbox** (`Chat | Inbox · n`): a chronological rail of
  every morning brief, ride debrief, weekly review, and overtraining
  warning the coach has written, sourced from the existing system-thread
  messages — no new tables. Migration `0024` adds one additive column,
  `chat_messages.read_at`.
- **Two new URL-driven bottom sheets** replace the morning check-in and
  post-ride debrief inline forms: `?sheet=checkin` and
  `?sheet=debrief&activity=…`, so both push notifications now deep-link
  straight into an open sheet instead of the dashboard or the activity
  page.
- **Menu and activity detail restyled**: collapsed settings groups now
  carry a real summary line (`Claude · deep · 1 memory`,
  `push on · wake 06:00 · FTP 310`); activity detail gets a 3×2 stat-tile
  grid and an emerald-tinted debrief card quoting the athlete and the
  coach in turn.
- **A real desktop layout**: Today splits into a 7fr/5fr grid at `lg+`
  (150px readiness ring, a week-progress row, an inbox teaser on the
  coach brief), and the sidebar gets its spec'd 216px width with a pinned
  account row.
- **Duplicate data removed** along the way: the PMC chart's own CTL/ATL/TSB
  readout (now redundant with the tiles above it), biological age printed
  in both a new tile and `BioAgeCard`'s headline, and the next race
  appearing both as a chip and as a list row on Train.
- **Fixed while touching the surfaces that exposed them**: the coach
  writes markdown that had never been rendered anywhere in the app (chat,
  ride reviews, inbox previews all showed raw `**`); TSB and sleep-debt
  tiles that printed raw floats and triple-digit minute counts; a sheet
  backdrop that was unclickable on desktop (a stacking-context bug that
  trapped it under the sidebar); a malformed activity id in a sheet URL or
  route param that 500'd instead of 404ing; neither nav marking its
  active item `aria-current`.

## v0.22.0 — 2026-07-22 — Wellness Fitness Metrics

intervals.icu was already sending `vo2max`, `rampRate`, and per-sport
`pMax`/`wPrime` in the daily wellness payload we fetch nightly — none of
the four made it into a typed column. Design:
`docs/specs/2026-07-22-v0.22-wellness-fitness-metrics-design.md`.

- **Bio-Age's dormant VO2max slot filled**: the health page's `vo2max`
  input was hardcoded `null` with a comment claiming no provider carried
  it — the data has been in the raw payload since day one. Now wired from
  the athlete's most recent Garmin-synced reading.
- **New Log page stat row**: eFTP, max power, and W′ (anaerobic capacity)
  now render next to the PMC chart, alongside a sign-aware CTL ramp-rate
  trend label (Ramping / Tapering / Steady). Each stat hides itself when
  the athlete has no real value for it — no zero, no placeholder.
- **Data layer**: `vo2max`/`rampRate`/`pMax`/`wPrime` added to
  `wellness_daily`, the intervals.icu connector, and the per-field wellness
  merge policy (`vo2max` under the physiology priority ladder, the other
  three under the intervals.icu-only training-load ladder, same bucket as
  `eftp`).

## v0.21.0 — 2026-07-22 — Design Consistency

A second Superdesign pass extends v0.19's dark-glass visual language to
every remaining route, including the five pages v0.19 already restyled.
Presentation only — no new data, metrics, features, or migrations. Design:
`docs/specs/2026-07-21-full-design-update-design.md`, implementation:
`docs/specs/2026-07-22-full-design-update-implementation.md`.

- **Dashboard hero rebuilt**: concentric Apple-Watch-style `ReadinessRings`
  (center readiness number, nested Recovery/Sleep/Strain rings, each
  independently calibrating) replace the old single ring. `StrainBudget`
  (a duplicate of `strainFraction`) and the now-superseded `ScoreRing` are
  both deleted.
- **Hairline-restraint tier** (Settings, Health, Admin, Import): a new
  `.hairline-list` CSS utility flattens nested glass-in-glass card stacks
  into hairline-divided rows. Applied to Settings and Import; Health and
  Admin's existing structure was already consistent and left unchanged.
- **Glass-tile tier** (Log, Activity detail, Coach, Journal, Plan): dedup
  and header-consistency pass. Log's duplicate TSB display and Journal's
  duplicate logging streak are resolved — the streak now hides on the
  shared `MilestonesCard` via a `hideStreak` prop (still shown on
  Dashboard, its other consumer).
- **Login copy fix**: removed invented "Premium Athlete Edition" /
  "Forgot Access Key?" language that didn't correspond to any real
  feature. Join was already honest and needed no change.
- **Final whole-branch review fixes**: closed a pre-existing SSR/hydration
  relative-time mismatch in the dashboard's sync chip
  (`useSyncExternalStore`-backed mount gate, avoiding the
  `react-hooks/set-state-in-effect` trap a naive effect-based fix would
  hit); deleted the `GlassTile` primitive, which ended up with no
  production consumer once the concentric-rings direction was chosen;
  restored three `WeeklySummary` regression tests that had been dropped
  as collateral damage of the `ScoreRing` cleanup.

## v0.20.0 — 2026-07-21 — Final Sweep

Closes out the current roadmap in one release: cross-cutting polish, the
v0.17 operations track, and the remainder of v0.18's 1.0-hardening list.
Nothing net-new in user-facing scope — every item here finishes a
half-done backlog line or makes what already exists more trustable.
Stronger Together (v0.16, social/sharing) is explicitly deferred to a new
roadmap rather than squeezed in here. Design:
`docs/specs/2026-07-21-v0.20-final-sweep-design.md`.

### Track 1 — Polish

- **Empty states and loading skeletons** on the four pages v0.19's
  restructuring skipped (`plan`, `activity/[id]`, `activity/log`,
  `health`, `import`) — reusing the shared `EmptyState` primitive and
  matching layout-stable skeletons, including a fix for `plan/loading.tsx`
  missing `RacesSection`'s always-rendered "add race" bar (content would
  otherwise shift on stream-in).
- **Chart consistency**: one shared token + axis/legend grammar
  (`CHART_TOKENS`, `formatChartValue` in `src/lib/charts.ts`) across
  `stream-chart`, `wellness-trends`, `weekly-load-bars`, the dashboard
  sparklines, and the coach `artifact-card` — hand-rolled SVG stays
  hand-rolled, this is a token unification, not a chart-engine rewrite.
  An unwired `axisTicks` helper and an unused `fontSize.tick` token added
  during the migration were caught in review and removed rather than left
  as dead code.
- **Default journal entries**: frequent _behavioural_ tags now pre-toggle
  from a "remember these as usual" setting — the energy/soreness/stress
  sliders are untouched by this and still write nothing when left
  unanswered, preserving the v0.7 score-integrity contract.
- **Performance-log filters**: verified end-to-end (view/month/range/sport
  all round-trip through one shared href-builder, extracted to
  `src/lib/log-href.ts` with a new regression test) — confirmed already
  correct since v0.19, no functional gap found.

### Track 2 — Ops / Self-Hosted Citizen

- **Prometheus `/metrics`** (`METRICS_TOKEN`-gated, timing-safe compare,
  404 when unset) and a richer `/api/health`: sync staleness, sync-job
  queue depth (pending/running/failed), backup age, and push-subscription
  count — all instance-wide aggregates, backed by one shared
  `getOpsSnapshot()` helper so the two endpoints can't drift.
- **`POST /api/internal/backup-complete`**: `BACKUP_NOTIFY_SECRET`
  shared-secret gate (timing-safe), called by `scripts/backup.sh` after
  every successful rotation; records backup freshness and fires the new
  `backup_completed` webhook.
- **Signed outbound webhooks** (migration `0021`,
  `webhook_subscriptions` / `webhook_deliveries`): HMAC-SHA256-signed
  POSTs on `readiness_computed`, `band_changed`, and `backup_completed`,
  with bounded retry (4 attempts, capped exponential backoff) and a
  per-attempt fetch timeout so a hung target can't stall the scheduler's
  sequential tick loop. Per-user dispatch is strictly scoped to the
  subscription owner's `userId`; `backup_completed` alone is deliberately
  instance-wide (it's not per-user data). Create/revoke are self-service
  and now audit-logged, matching the existing API-token audit pattern.
- **Sync-jobs admin panel**: owner-only view of every user's sync jobs
  (queue/running/failed) with manual retry (resets `runAfter` to now, not
  just `status`, so a backed-off job is actually picked up again) and a
  per-user "kick" — both re-gated independently of the page-level guard.
- **Complete GDPR export** across every user-owned table (journal,
  biomarkers, coach memories, chat messages, connections/settings, races,
  training plans, week plans, adjustments, token metadata — secrets
  stripped, never decrypted) plus a matching **import** path
  (`POST /api/import-account`, session-gated, always writes to
  `session.user.id`). `scripts/export-import-drill.sh` proves the
  export → wipe → import round trip is lossless against an ephemeral
  scratch database — never the live DB.
- **Native `ubuntu-24.04-arm` release runners**: multi-arch images
  restored (amd64 + arm64 native + manifest merge) without the ~50-minute
  QEMU cost that got arm64 dropped in v0.8.
- **Vercel + Neon deployment guide** (`docs/DEPLOY-VERCEL.md`): corrects
  prior guidance that told Neon deployers to omit `DATABASE_DRIVER`
  (which silently disables the scheduler's advisory locks); documents the
  correct pooled-connection + `DATABASE_DRIVER=pg` setup and a known gap
  (Vercel's native GET-only Cron Jobs can't reach `/api/cron`, which is
  POST-only — use an external scheduler).

### Track 3 — Hardening

- **Accessibility sweep**: a check-and-close pass over navigation,
  `ScoreRing`, the dashboard hero, journal form, settings accordions, and
  the coach composer — real, targeted gaps fixed (a missing
  `aria-hidden` on `ScoreRing`'s decorative subtree, three unlabeled
  icon-only buttons in the chat composer, several sub-AA-contrast text
  labels bumped `/30`→`/50`, three textareas/inputs with `outline-none`
  and zero replacement focus style). Full writeup and contrast math in
  `docs/a11y-sweep-2026-07.md`.
- **Session-management UI**: list active sessions/devices and revoke one
  or all-others, backed by Better Auth's own `sessions` table and
  `revokeSession`/`revokeOtherSessions` APIs, with an explicit
  self-ownership check and a guard against revoking your own current
  session. No 2FA/passkeys — deliberately out of scope for this
  deployment model (self-hosted, invite-only, behind a tunnel; see
  `docs/ROADMAP.md`'s v0.18 section for the reasoning).
- **Upgrade guarantees**: `scripts/migration-drill.sh` restores a real
  nightly `pg_dump` into a scratch Postgres and runs migrations against
  it, plus runs the full migration chain against an empty scratch DB —
  both scratch-only, never the live database. Documented rollback
  procedure and a backup-compatibility matrix in `docs/UPGRADING.md`.
- **Performance pass**: a dashboard cold-load budget plus a query audit
  found and fixed real N+1/missing-index gaps on the hot path. Findings
  and methodology in `docs/perf-pass-2026-07.md`.
- **API/MCP stability freeze**: the 54-tool surface in
  `src/lib/tools/registry.ts` (names and schemas, including per-field
  descriptions) is now frozen with a snapshot test and a published
  deprecation policy — see `docs/API-STABILITY.md`.
- **Docs reviewed end-to-end**: doc claims re-verified against code
  rather than trusted as-is (tool count, connector list, env-var names);
  fixed a real drift (`.env.example` was missing the Whoop and Withings
  OAuth env vars entirely) and filled gaps in `docs/SELF-HOSTING.md` for
  every surface this release added.
- **Final security review**: re-ran the v0.18.0 per-user-isolation lens
  over every surface this release added — `/metrics`,
  `/api/internal/backup-complete`, webhook dispatch, the account-import
  route, and the sync-jobs admin panel. **Zero gaps found** — full
  evidence trail in `docs/security/2026-07-21-v0.20-review.md`. The
  import route in particular was re-confirmed to write only to
  `session.user.id`, never a caller-supplied target.

## v0.18.0 — 2026-07-21 — Security Hardening

The first slice of the roadmap's "1.0 Hardening" epic — shipped after
v0.19.0 because v0.19 jumped this slot's place in the queue for a design
pass (see that entry below). Cheap high-value web-security fixes, a light
auth/token/connection audit log, and an exhaustive per-user isolation and
input audit over the full post-v0.19 codebase. Design:
`docs/specs/2026-07-20-v0.18-security-hardening-design.md`.

### Added

- **HTTP security headers** on every response: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, HSTS, a pragmatic
  `Content-Security-Policy` (`frame-ancestors 'none'`), and a
  Permissions-Policy that deliberately does not deny microphone — v0.15's
  voice dictation needs it. `src/middleware.ts` renamed to `src/proxy.ts`
  per Next.js 16's convention.
- **Login rate-limiting** (20 requests/60s) and boot-time
  `BETTER_AUTH_SECRET` validation — the app now fails loud at startup on a
  missing or too-short secret instead of silently degrading session
  security, mirroring the existing `ENCRYPTION_KEY` check.
- **Security event audit log**: a new `audit_log` table records
  login success/failure, API token creation/revocation, and connection
  add/remove events (7 providers) — never a secret value, only labels and
  provider names. Owner-only "Recent security events" list on `/admin`.
- **Exhaustive per-user isolation & input audit**: every route handler,
  server action, MCP tool (all 54), OAuth callback, and webhook checked
  for cross-user data leaks; the LLM biomarker-extraction and file-upload
  paths re-confirmed against their original no-tools/bounded-parsing
  guarantees. Zero gaps found — the full checklist and reasoning live at
  `docs/security/2026-07-20-isolation-audit.md`. Backed by new regression
  tests proving MCP token isolation, export-endpoint scoping, and a
  representative server action's cross-user denial.

### Fixed

- **Apple Health ingest**: `Referrer-Policy: no-referrer` and
  `Cache-Control: no-store` on every response (the ingest token can arrive
  via a `?token=` URL parameter), and the size cap is now enforced by
  actually counting bytes read instead of trusting the client-supplied
  `content-length` header, which can be omitted or understated.
- Two moderate `npm audit` advisories (a nested build-time `postcss` copy
  in `next`, a dev-only `esbuild` pulled in transitively by `drizzle-kit`)
  investigated to root cause and confirmed unreachable at runtime; not
  forced via a breaking major downgrade.

Deferred past this slice, still open in the roadmap: passkeys/TOTP 2FA,
full session-management UI, a strict `script-src` CSP.

## v0.19.0 — 2026-07-20 — Design Refresh

A Superdesign pass rethought the dashboard, coach, log, journal, and
settings screens around progressive disclosure — collapsed-by-default
sections instead of everything rendered flat. Purely structural: same data,
same queries, same features. Design:
`docs/specs/2026-07-20-v0.19-design-refresh-design.md`.

### Added

- **Shared `Collapsible` and `EmptyState` primitives** (`@base-ui/react`,
  the `render`-prop convention) — one disclosure grammar used consistently
  across all five restructured pages instead of five ad hoc ones.
- **Dashboard**: one animated Readiness ring as the page's single focal
  metric; Recovery/Sleep/Strain demoted to a compact stat row; "Recovery
  Metrics" and "Recent Sessions" become collapsed-by-default accordions.
- **Settings**: one accordion per domain (Integrations, AI & Tech,
  Advanced/API, App, About) — only Profile stays always-open. Closes the
  "Settings information architecture" backlog item.
- **Log**: Today/Week/Month time-range navigation (plus a month strip)
  replaces the old Training/Wellness content toggle; the Performance Trends
  (PMC) and Wellness Trends panels are now always-present, independently
  collapsible sections instead of one being reachable only via a tab.
- **Journal**: stepped check-in (mood → wellness sliders → vitals, one step
  open at a time, completed steps collapse to a checkmark); correlation
  insights promoted above the form; the honest-input contract (v0.7) is
  unchanged — no step can force-fill an untouched field.
- **Coach**: collapsible Chat History and Quick Context panels; quick-reply
  chips above the composer (fill the input, never auto-send, matching the
  voice-dictation rule).
- Honest empty states and layout-stable loading skeletons on all five
  touched pages.

### Fixed

- Screen-reader heading navigation for every new collapsible section (all
  five pages) — the shared trigger now sits inside a semantic heading.

## v0.15.0 — 2026-07-20 — The Coach Remembers

Coach memory held structured facts; it still couldn't recall what was
actually said, and every ride ended in silence. Design:
`docs/specs/2026-07-19-v0.15-coach-remembers-design.md`.

### Added

- **Recall over history**: `recall_history` coach tool (53 → 54) — Postgres
  full-text search ('simple' config for mixed Dutch/English) across past
  conversations, weekly/monthly reviews, ride debriefs, and journal notes.
  The coach cites results with dates and says so when it finds nothing.
  Ghost threads are excluded — they were promised to vanish.
- **Post-ride loop**: a 15-minute intervals.icu activity poll (no webhooks
  exist; quiet 23:00–06:00) detects a fresh ride, a debrief card asks RPE /
  feel / notes (untouched fields write nothing; intervals.icu RPE prefills),
  and the coach writes a ride review reconciling the numbers with the
  athlete's own words — quoted, never paraphrased. Skipped or expired
  debriefs get a data-only review that says no feedback was given. Strava
  activities are excluded end-to-end (API AI clause). Opt-in push.
- **Monthly report**: the weekly review's big sibling — load vs previous
  month, readiness trend, milestones, biomarkers logged, races — at-most-once
  per calendar month, sections omitted when the data isn't there.
- **Voice input**: mic in the chat composer (Web Speech API) — dictation
  fills the box, never auto-sends, with an honest note that the browser
  vendor may process the audio. Recover never sees or stores audio.
- **Token transparency**: `llm_usage` rows at every real LLM call site;
  settings shows this and last month by model and purpose. Tokens, never
  cost estimates.

### Changed

- Cycle-Aware Readiness deferred (roadmap): no athlete on a running instance
  generates cycle data; later versions renumbered (v0.16 Stronger Together,
  v0.17 Good Self-Hosted Citizen, v0.18 1.0 Hardening).
- Migration 0018: FTS columns + GIN indexes, debrief state on activities,
  `llm_usage`, poll cursor, debrief prefs.

## v0.14.0 — 2026-07-19 — Race Ready

The adaptive week manages training; race day is why it exists. Everything
here stands on v0.10's honest load engine — forecasting from fabricated CTL
would be fabrication with extra steps. Design:
`docs/specs/2026-07-19-v0.14-race-ready-design.md`.

### Added

- **Race calendar**: a `races` table (migration 0016) makes A/B/C races
  first-class entities, with `training_plans.race_id` linking a plan to its
  goal race. Generating a plan without an explicit race implicitly creates
  the A race from the plan's target date, so coach memory's informal race
  knowledge finally has a real row behind it.
- **Taper engine** (`materializeWeek`): the living week reshapes into a taper
  as race day approaches — window length by race distance (21/14/10 days)
  and weekly load fractions (45%/65%/80%) — and the ramp guard's downward
  clamp steps aside during taper weeks so the drop isn't fought as an
  anomaly. Race-week openers keep the taper from feeling like a dead stop,
  and race-day slots are untouchable by adaptation or manual moves.
- **B/C race convention**: B races get a protected pre-race ease-off (a rest
  day the day before, no quality work two days out); C races are training
  days like any other and the plan trains straight through them.
- **Readiness forecast** (`src/lib/race/forecast.ts`): a pure EMA
  forward-simulation of CTL/ATL over the planned week, reported as an honest
  two-scenario band — full execution vs trailing-adherence-scaled, floored
  at 50% — and only ever FORM (TSB), never a projected readiness score. Falls
  back to an explicit `insufficient` state when load history isn't
  calibrated yet instead of guessing.
- **What-if simulator** (`simulatePlanChange`): move/swap/skip previews on
  `/plan` show the load and TSB impact before the change is saved, gated
  behind a confirmation dialog when the delta is material, plus a read-only
  `simulate_plan_change` coach tool for the same preview in chat.
- **Race-day brief & post-race debrief**: the morning coach thread leads
  with the race on race day; afterward, a debrief links the result activity,
  closes the race, and — if no result has landed after 48 hours — says so
  honestly instead of stalling silently. Both are transactional and
  idempotent. The debrief links to Strava's results but keeps Strava's own
  stats out of the AI narrative, per the existing firewall.
- **Dashboard `RaceCountdownCard`**: next race, days out, and a projected
  form-outlook band range, with honest `insufficient`/no-plan states instead
  of a blank or fabricated card.
- 4 new coach/MCP tools (49 → 53 total): `get_races`, `upsert_race`,
  `delete_race`, `simulate_plan_change`.

## v0.13.0 — 2026-07-19 — Deep Biology

Long-horizon health metrics, finally data-backed: v0.11's Withings
connector and this release's blood-test extraction fix the input side that
kept this deferred. Design:
`docs/specs/2026-07-18-v0.13-deep-biology-design.md`.

### Added

- **Health Records** (`/health`): upload a blood-test PDF/photo or paste
  the values → your own LLM extracts biomarkers with a per-value confidence
  → an editable review screen → the `biomarkers` table. Nothing is stored
  unconfirmed. With no LLM configured, pasted text still parses via a
  deterministic line parser. Migration 0015 (additive).
- **Biological age** (`src/lib/biological-age.ts`): a transparent composite
  — chronological age plus a small capped offset per honest signal (resting
  HR, HRV, sleep consistency, VO₂max, body fat). Below three signals or
  without a birth year it shows an "insufficient inputs" state naming
  what's missing, never a guessed number.
- **Blood pressure** (`src/lib/blood-pressure.ts`): manual entry plus
  Withings sync (v0.11), classified against the 2017 ACC/AHA bands with a
  recent-average trend and direction.
- **Coach visibility**: a `get_biomarkers` tool (registry 48 → 49) surfaces
  latest values, BP classification, and the bio-age summary to the coach,
  bounded to reference trends only — it never diagnoses or recommends
  treatment.

## v0.12.2 — 2026-07-19 — Audit Fixes

A post-merge audit of v0.10–v0.12 (which shipped without the usual
per-task review trail) and a pre-merge review of v0.13. The engines held
up; four fixes came out of it.

### Fixed

- **Strava firewall**: the v0.10 native load engine fed
  `provider='strava'` activities into the stored CTL/ATL series, which
  reaches coach context and MCP tools through readiness — the aggregate
  path the Nov-2024 Strava agreement closes. Strava rows are now excluded
  from the native series (the dashboard-only weekly rings still count
  them); a Strava-only athlete honestly stays `calibrating`.
- **Concurrent wellness writes**: `field_sources` ownership is written as
  a jsonb union of the changed fields instead of a full-map overwrite, so
  an Apple Health webhook landing mid-sync can no longer erase another
  provider's ownership records.
- **EMA decay**: a scheduler pass recomputes today's metrics once per day
  for users no sync touches — a manual-only athlete's CTL/ATL now decay
  through restful days instead of freezing at the last entry.
- **Apple Health ingest**: payloads over 10 MB are rejected before
  parsing.

## v0.12.1 — 2026-07-18

Packaging release, no code changes: the first tagged image since v0.9.5,
delivering v0.10.0, v0.11.0, and v0.12.0 (merged without tags) to
Watchtower-updated instances.

## v0.12.0 — 2026-07-18 — Sleep Intelligence

v0.9.0 deleted the fabricated sleep cards; v0.11 started ingesting real
stage data. This release earns the cards back — only for athletes whose
provider actually sends them — and gives the whole app a desktop layout.
Design: `docs/specs/2026-07-18-v0.12-sleep-intelligence-design.md`.

### Added

- **Sleep stages, for real** (`src/lib/sleep-insights.ts` + `SleepStagesCard`):
  a stacked deep/REM/light/awake bar with per-stage minutes and the bed
  window, rendered only when the provider sent stage data. A manual athlete
  sees nothing invented — the card doesn't mount.
- **Sleep consistency**: a 0–100 regularity score from the circular SD of
  sleep midpoint over the trailing month — the metric the literature ranks
  above duration — gated on enough real bed/wake nights.
- **Chronotype & social jetlag**: mean sleep midpoint plus the weekday vs
  free-day gap, so a shifting weekend schedule shows its cost.
- **Bedtime target v2**: when a provider sends real bed times, the nightly
  bedtime target anchors on the athlete's habitual bedtime nudged by sleep
  debt; the manual wake-time path is unchanged for everyone else.
- **Desktop shell**: a persistent sidebar nav and a wider, two-column
  dashboard at `lg`+, replacing the phone-stripe-on-a-monitor `max-w-lg`
  layout. The floating bottom tab bar stays on small screens.

## v0.11.0 — 2026-07-18 — Wearable Connectors

intervals.icu stops being the only automatic pipe. Whoop and Oura bring
back the staged sleep and bed/wake data v0.9.0 had to delete cards for,
Withings adds body composition and blood pressure, and Apple Health lets
anything on an iPhone push in. Two providers reporting the same morning
now resolve by an explicit per-field priority instead of last-writer-wins.
Design: `docs/specs/2026-07-18-v0.11-wearable-connectors-design.md`.

### Added

- **Per-field wellness merge** (`src/lib/wellness-merge.ts`): every
  provider write goes through one priority policy that records which
  source owns each field (`wellness_daily.field_sources`). Manual entry
  always wins; dedicated wearables beat intervals.icu on physiology;
  Withings wins body composition & BP; training-load fields stay
  intervals.icu-only; a null from any provider never erases existing data.
  Migration 0014 is additive (staged-sleep, bed-window, temperature,
  respiration, BP, and body-fat columns plus `field_sources`).
- **Whoop** (OAuth2, `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET`): recovery
  HRV & resting HR joined to staged sleep, mapped to the wake date.
- **Oura** (Personal Access Token pasted in Settings — no OAuth app
  needed): staged sleep, HRV/RHR, sleep score, and temperature deviation.
- **Apple Health**: token-authed Health Auto Export webhook plus a one-off
  JSON file upload — sleep stages, HRV, resting HR, respiration, blood
  pressure, and body composition, no Apple API required.
- **Withings** (OAuth2, `WITHINGS_CLIENT_ID`/`WITHINGS_CLIENT_SECRET`):
  weight, body-fat ratio, and blood pressure.
- **Guided first run**: the onboarding screen is now a source picker
  (connect a device / log manually / import CSV), and the calibrating
  readiness ring shows an honest "day N of 14" progress bar with a
  next-step prompt instead of a bare label.

### Changed

- The intervals.icu sync and the manual journal writer now route through
  the per-field merge, so a second provider can no longer clobber their
  fields on the same day.

## v0.10.0 — 2026-07-18 — Honest Load

Recover stops borrowing its training-load math. CTL/ATL/TSB are now
computed natively from the athlete's own sessions when intervals.icu
doesn't provide them, and every score that used to be invented from
missing data now says `calibrating` instead. Design:
`docs/specs/2026-07-18-v0.10-honest-load-design.md`.

### Added

- **Native load engine** (`src/lib/training-load.ts`): per-activity load
  in TSS-like units via a first-match ladder — provider load → power TSS
  (needs FTP) → heart-rate TSS (needs max HR + resting-HR baseline) →
  honest duration fallback (an unlabeled hour counts as easy) — with
  cross-provider dedup, then CTL (42d) / ATL (7d) EMAs over the daily
  sums. Works for every source: manual, CSV, Strava, intervals.icu.
- **Source precedence**: intervals.icu's precomputed ctl/atl keep winning
  when present; native values fill the gaps and are labelled `computed`
  on the new `daily_metrics.ctl/atl/load_source` columns (migration 0013,
  additive). Readiness's form component now works for manual-only
  athletes.
- **Training thresholds** in Settings → Body: optional max HR and FTP
  feed the HR/power rungs; changing them recomputes the recent window.
- **"This Week" rings wired**: the hardcoded `0.7`/`0.8` fractions are
  replaced by real targets — planned week volume and the active block's
  target load, falling back to trailing 28-day averages — and the rings
  simply don't render when no honest target exists.

### Fixed

- **Recovery & Strain are no longer invented**: the dashboard read
  `latest?.atl ?? 0` / `latest?.ctl ?? 0`, giving a no-integration
  athlete a hero "Recovery 60" and "Strain 0.0" from zero data. Both
  rings, the strain budget, and the narrative now use the effective
  (provider-or-computed) values and show `calibrating` until at least 7
  activity days exist in the trailing 6 weeks. Closes the last two
  honesty-debt items.
- The Training Status tile's fabricated "Optimal load intensity" caption
  now shows the real CTL (marked `computed` when native) or nothing.
- Manual activity logging and CSV import now recompute daily metrics, so
  a logged workout shows up in load immediately (imports batch into one
  recompute).

## v0.9.6 — 2026-07-18 — Absorb intervals-icu MCP

24 new intervals.icu tools (23 `icu_*` tools plus a `get_workout_syntax`
reference) bring the standalone intervals-icu-mcp server's capabilities
into Recover's own MCP endpoint and the in-app coach, so the separate
server can be retired. Design:
`docs/specs/2026-07-17-v0.9.6-absorb-intervals-mcp-design.md`.

### Added

- **Live intervals.icu tools** (registry 24 → 48): calendar events
  (list/get/create/update/delete/bulk/duplicate), activity edits and
  messages, wellness push, sport settings, an apply-training-plan action,
  per-activity histograms (HR/power/pace/GAP), activity search and
  intervals, the workout library, and a workout-syntax reference. Writes
  require a new `write:icu` MCP token scope; the in-app coach can use them
  under your session.

### Changed

- The standalone `intervals-icu-mcp` server is no longer needed — its
  curated tool set now ships inside Recover. The standalone repos
  (`intervals-icu-mcp` and its `-deploy` counterpart) can be decommissioned.

## v0.9.5 — 2026-07-17 — Nightly Backups

The database now backs itself up, and one command proves a backup
restores. Design: `docs/specs/2026-07-17-v0.9.5-backups-design.md`.

### Added

- **Nightly backups**: a default-on `backup` sidecar (`postgres:16-alpine`
  and crond) runs `pg_dump -Fc` at 03:30 into the new `recover-backups`
  volume, keeping the newest 14 dumps (`BACKUP_KEEP` to change). Dumps
  write to a temp name and rename on success; rotation runs only after a
  successful dump, so a failing backup can never eat the old ones.
- **Restore drill**: `scripts/restore-drill.sh` restores the latest dump
  into a disposable scratch Postgres, verifies core tables and row
  counts, prints data freshness, and tears everything down — unattended,
  exit 0/1. Documented in `docs/SELF-HOSTING.md` alongside the real
  disaster-recovery procedure.

### Changed

- Roadmap: the old v0.9.5 "Infrastructure" is split — backups shipped
  here; absorbing the standalone `intervals-icu-mcp` server moves to
  v0.9.6.

## v0.9.4 — 2026-07-17 — Deeper Insights

Auto-tags, honest confidence intervals, and real streaks. Everything is
pure and computed on read — no new tables, nothing stored that the data
could stop supporting. Design:
`docs/specs/2026-07-17-v0.9.4-deeper-insights-design.md`.

### Added

- **Auto-tags from activities** (never stored, Strava excluded):
  🔥 Hard session (own top-quartile load, silent under 20 training days),
  2️⃣ Double day, 😴 Rest day, 🌅 Morning training, 🌙 Late training. They
  join the journal's manual tags in the correlation analysis, marked
  "auto".
- **Correlations v2**: per-tag two-sample comparison (tagged vs untagged
  days) with a t-based 95% confidence interval. Rows whose CI crosses
  zero say "inconclusive · n events" instead of asserting an impact. Each
  row expands into weekday/weekend splits, gated at 5 events per side.
- **Milestones card** (dashboard + journal): real logging streak with
  best-ever, plan weeks completed at ≥70% adherence, plans completed.

### Fixed

- **The streaks are real now.** The dashboard's "N-day logging streak"
  was `Math.min(days logged in last 30, 30)` and the journal's was a
  7-day count — both now show the true consecutive run (today not yet
  logged doesn't break yesterday's run). Closes the honesty-debt item.

## v0.9.3 — 2026-07-17 — Week Starts Now

Patch release for the Adaptive Week: a plan's living week now begins the
moment the plan exists, not at the next Monday's weekly review. Claims the
v0.9.3 number, so the planned feature releases shift one patch digit
(Deeper Insights → v0.9.4, Infrastructure → v0.9.5).

### Fixed

- **New plans materialize their week immediately**: `generateTrainingPlan`
  rolls the current week over as its last step, so a plan created on a
  Thursday shows a living week that Thursday instead of a skeleton-only
  `/plan` page until Monday.
- **"Plan this week" button**: for plans that predate this patch (or any
  state where the current week is missing), the `/plan` empty state now
  offers to materialize the week on demand. Safe to press twice — the
  rollover stays idempotent per user-week.
- **Regenerating a plan mid-week no longer shadows it**: the archived plan's
  open week row used to block the new plan's week until next Monday; the
  rollover now replaces that row (adjustments cascade) and logs a
  "plan changed" adjustment so the timeline explains the swap.
- **Mid-week starts don't invent the past**: days already behind the clock
  get zero availability, so a Thursday start plans Thu–Sun instead of
  backfilling fictional workouts onto Mon–Wed. On the normal Monday
  rollover this is a no-op.

## v0.9.2 — 2026-07-17 — Adaptive Week

JOIN-style rolling week on the v0.5d skeleton: workouts materialize one week
at a time from an availability intake and adapt every morning to measured
readiness and available time, with every automatic change logged and
explainable. Design: `docs/specs/2026-07-17-v0.9.2-adaptive-week-design.md`.

### Added

- **Living week tables**: `week_plans` (one open row per user-week, 7 JSON
  day slots) and `plan_adjustments` (one row per automatic change — trigger,
  action, before/after, deterministic reason). Purely additive migration.
- **Two pure engines** in `src/lib/week-plan/`: `materializeWeek` lays the
  skeleton week onto real availability (adherence rule below 70%, readiness
  suppression at ≥4 amber-or-worse days, ±20% ramp guard, a fully missed
  week restarts at 60% of skeleton instead of freezing at ±20%-of-zero);
  `adaptDay` handles each morning (missed quality sessions move once then
  drop with capped redistribution; red replaces quality with 30min recovery
  and shortens endurance 30%; amber steps intensity down at 85% duration;
  `calibrating` never triggers readiness changes; availability always wins
  first).
- **Weekly rollover** wired into the weekly review: closes last week's plan,
  writes actual load/sessions/adherence back to its skeleton block, and
  materializes the new week. **Daily adaptation** runs in the post-sync
  morning pipeline before the morning insight, so the insight quotes today's
  adjustment reasons verbatim instead of inventing them.
- **Availability intake with calendar prefill**: `/plan` suggests minutes
  per day from last week's pattern, halving days with ≥8h of calendar
  meetings (Google Calendar connection optional — a hint, never a blocker).
- **Coach tools**: `get_week_plan`, `set_week_availability` (write:plan),
  `get_plan_drift`; `update_training_plan` gains day-level
  `move_workout`/`swap_workout` actions with the same adjacency and
  availability checks the engines use.
- **`/plan` page**: the living week day-by-day, an adjustments timeline
  ("what changed and why"), the remaining skeleton, and the intake form.
  Dashboard gains a Today card and a 7-dot week strip.

## v0.9.1 — 2026-07-16 — Honest Pixels

Small fixes in the same defect class v0.9.0 worked through: things on screen
claiming to be something they are not. No schema or behavior changes beyond
the pixels below. (The roadmap's planned "v0.9.1 — Smarter Coach" feature
release moves to v0.9.2; subsequent planned versions shift accordingly.)

### Fixed

- **The favicon was still the stock Next.js logo.** `src/app/favicon.ico`
  had never been replaced since project scaffolding, so browser tabs showed
  the Next triangle instead of the Recover ring (Safari masked this by
  preferring the apple-touch icon, which was correct). Replaced with a
  proper multi-size ICO (16/32/48) rendered from the logo on the app's dark
  tile, matching the home-screen icon.
- **The Sleep Score sparkline plotted the wrong series.** The tile's value
  read `sleepScore` (fixed in v0.9.0), but the sparkline under it still
  plotted raw `sleepSecs` — real data, wrong series. It now plots the
  7-day `sleepScore` history the label promises.
- **Sparklines fabricated a flat line from no data.** Fewer than two real
  data points rendered a horizontal line — a visual claim of stability made
  from nothing (the last dashboard item on the honesty-debt list that was
  fixable without the strain/recovery rework). `sparkPath` moved to
  `src/lib/sparkline.ts`, returns an empty path below two points, and the
  vitals grid renders no sparkline at all for an empty path.
- **`package.json` version drift**: it still said `0.8.0` while v0.8.1 and
  v0.9.0 were tagged. Now `0.9.1` and part of the release checklist.

## v0.9.0 — 2026-07-16 — Honest Body Intelligence

v0.7 fixed fabricated data in the database. It never reached the dashboard:
a hardcoded body-battery curve every athlete saw identically, a sleep card
showing a 47%-REM stage breakdown every night no matter what, a
`"22:30 – 23:00"` bedtime string literal, and a "Sleep Score" tile that was
actually `sleepHours / 9 * 100` — while the real `sleepScore` column the
provider sends (populated on the large majority of days) was read nowhere on
the dashboard. Verified against the live DB: intervals.icu's 46-key wellness
payload carries no sleep stages and no bed/wake times at all, so those cards
could not be fixed, only removed.

### Added

- **Body battery, for real**: the energy curve is now modelled from the
  day's actual readiness score and real activity loads at the times they
  happened, instead of a fixed decorative SVG path. Labelled "Estimated
  Energy"; renders an empty state instead of a curve when readiness is
  `calibrating`.
- **Sleep debt**: cumulative deficit over the last 14 recorded nights of
  real `sleepSecs`, measured against the athlete's own sleep-need target.
  Nights with no sleep row are skipped, never counted as a perfect night; a
  surplus night does not offset a prior deficit.
- **Bedtime target**: computed from tonight's debt repayment (capped at
  1h/night) plus the athlete's own wake time. No wake time set means a
  prompt to set one in Settings — never a guessed time.
- **`body_prefs`**: per-user wake time and sleep-need target.

### Fixed

- **The sleep card invented a stage breakdown.** "47% REM / 25% Core / 20%
  Deep / 8% Awake" was a hardcoded literal shown identically to every
  athlete, every night — no connected provider, intervals.icu included,
  returns sleep stages. Removed entirely; the `stages` prop no longer
  exists.
- **"Efficiency" was actually `sleepHours / 8`.** Removed from both the
  sleep card and the vitals grid — there is no time-in-bed data anywhere to
  compute a real efficiency from.
- **"Sleep Score" was actually `sleepHours / 9 * 100`,** never the real
  `sleep_score` column the provider returns. The vitals grid and sleep card
  now both read `latest.sleepScore` and show "—" when the provider gave
  none, rather than a formula standing in for a measurement.
- **The bedtime recommendation was a string literal**, `"22:30 – 23:00"`,
  shown to every athlete regardless of schedule. Replaced by a target
  computed from real sleep debt and the athlete's own wake time.
- **The body-battery curve was a fixed decorative SVG path**
  (`M0 40 Q50 30 80 45 ...`) that no caller ever overrode — every athlete
  saw the same fictional day regardless of readiness or training.

**Done when:** the five sleep/energy fabrications above — the stage
breakdown, the `"22:30 – 23:00"` bedtime literal, "Efficiency", the
`sleepHours / 9 * 100` Sleep Score, and the fixed body-battery SVG path,
spanning eight code sites — are gone from the dashboard; a day with training
shows a curve that drops when the athlete actually trained; an athlete with
no wake time set sees a prompt, not a bedtime.

This release deliberately scoped itself to the sleep and energy cards. It
does **not** claim the dashboard is now free of invented numbers — see below.

**Known remaining work — the dashboard still fabricates elsewhere.** These
are pre-existing on `main`, untouched by this release, and named here so the
ledger is honest rather than flattering:

- **Recovery and Strain are already fabricated for manual-only athletes.**
  `recoveryScore` and `strainFraction` (`src/app/page.tsx`) derive from
  `latest?.atl ?? 0` / `latest?.ctl ?? 0`. `atl`/`ctl` are nullable and
  written only by the intervals.icu sync, so an athlete on v0.8's
  no-integration path has both `null` — and the `?? 0` coalesce renders a
  hero **"Recovery 60"** and **"Strain 0.0"** built from zero training data.
  This is live today, in the page's most prominent cards (`ScoreRing`,
  `StrainBudget`) and in the narrative text. Fixing it needs an honest
  null-propagation path for CTL/ATL — the same `calibrating` treatment
  readiness already gets — which is a larger change than this release.
- **The "This Week" rings are hardcoded** to `ringOuter={0.7}` /
  `ringInner={0.8}` for every athlete, forever — the same defect class as
  the body-battery path removed above. They were left alone rather than
  wired to `recoveryScore`/`strainFraction`, because doing so would only
  propagate the fabrication above into two more rings.
- **The logging "streak" is a count, not a streak** — `Math.min(window30.length, 30)`
  counts rows in a 30-day window, so 22 scattered days renders "22-day streak".
  Proper streak semantics land with Achievements in v0.9.2.

## v0.8.0 — 2026-07-16 — Data Freedom

Use Recover without any integrations. Log vitals and activities manually,
import CSV data, and unlock your readiness score from day one — no
intervals.icu required.

### Added

- **Manual-first onboarding**: the dashboard now offers three paths — start
  logging manually, connect intervals.icu, or import CSV data. No
  integration is required to begin.
- **Manual vitals entry**: when no integration is active, the journal form
  shows HRV, resting HR, sleep, and weight input fields. Synced values
  still auto-populate when an integration is connected.
- **Manual activity logging** (`/activity/log`): log rides, runs, swims, and
  other sessions with sport type, duration, distance, HR, power, elevation,
  and training load.
- **CSV import** (`/import`): upload wellness or activity CSVs with flexible
  column name mapping (supports common formats from Apple Health, Garmin,
  Whoop, and spreadsheets). Drag-and-drop upload, row preview, batch
  upsert.
- CSV parser tests (7 cases covering both wellness and activity formats).

### Fixed

- **Middleware was dead code**: `src/proxy.ts` exported a function named
  `proxy()` instead of `middleware()`, so Next.js never called it — no
  session redirects worked. Renamed to `src/middleware.ts` with the correct
  export. The route guard matcher (which correctly excludes `/api/mcp`,
  `/api/cron`, and public assets) is now active.
- **Behavior tag buttons did nothing**: dashboard tags were `<button>`
  elements with no click handler. Now link to the journal page.

## v0.7.0 — 2026-07-16 — Score Integrity

Stop the app from knowing things it doesn't know. Both fixes protect the
readiness score's foundation, which everything after this consumes.

### Fixed

- **The journal no longer invents answers.** Energy/soreness/stress
  initialized to 7/4/4 and were submitted on every save, so ticking a single
  behavior tag wrote three subjective numbers the athlete never gave —
  stored indistinguishably from real ones. Unanswered sliders now submit
  nothing, read `—`, and announce "not answered" to screen readers. A
  deliberate tap on the resting value is still kept.
- No existing data is deleted or altered: pre-v0.7 rows can't be separated
  from genuine answers, and destroying truth to hide a lie is worse.

### Added

- **Day flags** (🤒 ill, ✈️ travel, 🏔️ altitude): facts that invalidate a day
  as a baseline reference. Flagged days are excluded from the 60-day rolling
  baselines, so a week of flu no longer makes you read falsely green for the
  next two months.
- Flagged days are **still scored** — exclusion governs baseline membership
  only; an ill day should read red, it just shouldn't redefine "normal".
- Flagging a past day **retroactively repairs** every score after it.
- Over-flagging degrades honestly to `calibrating` rather than a confident
  wrong number.
- `get_wellness` returns day flags — the coach knowing you were ill changes
  its advice.

The readiness engine itself is unchanged: exclusion happens where the
baseline array is assembled, and `readiness.ts` and its tests are untouched.

## v0.6.2 — 2026-07-16 — Strava description fields

- **Field selection**: choose which metrics appear in your Strava descriptions, with a live preview rendered against your most recent activity
- Users who never customize keep the full v0.6 template unchanged
- Disabling every field skips the Strava write instead of publishing a bare marker

## v0.6.1 — 2026-07-15

Post-review fixes for v0.2–v0.5.

### Fixed

- **Strava AI firewall**: Strava-sourced activities were reaching two AI surfaces (coach context injection and weekly-review aggregates) — now excluded everywhere, per the Strava API terms.
- **Weekly review scheduling**: never fired under default settings (exact-hour match against the overnight sync). Now uses due-since-slot logic; default review slot Monday 04:00.
- **Weekly review visibility**: was stored with a role the thread view hides, so the dashboard link opened an empty thread. Now rendered.
- **Google Calendar**: access token now refreshes on expiry (the tool broke ~1 h after connecting); OAuth scope narrowed to FreeBusy-only.
- **Training plan**: removed adjustment actions that reported success without changing anything; plan writes made idempotent (at most one active plan; guarded week advance).
- **MCP tokens**: `write:plan` and `write:memory` scopes are now mintable, so all write-capable tools are authorizable.
- **OAuth redirects** use the public origin / `BETTER_AUTH_URL` rather than the container hostname; coach responses match the athlete's language.

## v0.6.0 — 2026-07-15 — Strava AI Descriptions

- **Strava write-back**: opt-in `activity:write` OAuth upgrade; auto-generates an emoji-rich metrics block (load, IF, TRIMP, form, PRs) from intervals.icu data and appends it below a `---` separator after sync, with a skip marker to prevent double-writes. Manual `describe_strava_activity` coach tool.

## v0.5.0 — Training Intelligence

- **Artifacts engine**: coach can output inline SVG charts (line, bar, area, table) in chat — collapsed preview with expand-on-click
- **Weekly review**: proactive weekly training summary with load comparison chart, configurable day/time
- **Calendar integration**: intervals.icu planned workouts visible to coach; Google Calendar OAuth for busy/free awareness
- **Training plan generation**: periodized multi-week plans from race goals (4–52 weeks, multi-sport, periodization guardrails)
- **20 MCP tools** (was 14): `render_chart`, `get_planned_workouts`, `get_calendar_availability`, `generate_training_plan`, `get_training_plan`, `update_training_plan`

## v0.4.0 — Unreleased

Coach intelligence.

### Added

- MCP depth: `get_power_curve`, `get_pace_curve`, `get_best_efforts` (intervals.icu precomputed, 6 h cache, stale-if-error) and weekly-bucket `get_training_load_summary`.

## v0.3.0 — 2026-07-14

Analytics depth.

### Added

- **Activity detail page** (`/activity/[id]`): stream charts (heart rate,
  power, pace, elevation) and a laps/intervals table. Streams are fetched
  lazily from intervals.icu on first view and cached; Strava/manual
  activities show the summary with a "no detailed data" note.
- **Performance page tabs** (Training | Wellness) with a 30/90/180/365-day
  range selector, both linkable via URL params.
- **Training tab**: PMC chart now spans the selected range and draws TSB as
  a filled area around zero; 12-week load bars; history list grouped by day
  with "load more", each row linking to the activity detail.
- **Wellness tab**: HRV and resting-HR trends (daily line, 7-day rolling
  average, personal 60-day baseline band) and a sleep chart (duration bars,
  score line, 8 h guide).
- Dashboard recent activities now link to their detail pages.

## v0.2.0 — 2026-07-14

Phone & daily loop.

### Added

- **Installable PWA**: web manifest, app icons, minimal service worker with
  offline fallback.
- **Morning readiness push** (web-push/VAPID): sent right after the overnight
  sync computes the day's score — at most once per day, only when a score
  exists, skipped while calibrating. VAPID keys are auto-generated and stored
  in the database (private key encrypted); no new configuration.
- **Notifications settings card**: per-device subscribe/unsubscribe, morning
  push preference, send-test-notification, iOS install hint.
- **Manual resync**: dashboard sync chip ("Synced 12m ago ⟳") and
  pull-to-refresh in the installed app, backed by a rate-limited
  `/api/sync/now` (one per 2 minutes per user).

## v0.1.0 — 2026-07-14

First tagged release: the core loop works end-to-end, self-hosted.

### Added

- **intervals.icu sync** — wellness (HRV, resting HR, sleep), activities, and
  precomputed CTL/ATL, kept fresh by an in-process scheduler with idempotent
  jobs and a `/api/cron` fallback for serverless deploys.
- **Readiness engine** — daily score from 60-day rolling personal baselines
  (HRV 40%, resting HR 25%, sleep 20%, form/TSB 15%), with a calibrating
  state below 14 days of history and a persisted component breakdown.
- **Dashboard, performance log, and behavior journal** — readiness/recovery/
  strain rings, strain budget, training stress balance chart, wellness
  sliders, mood/tags/notes.
- **AI coach** — streaming chat with an evidence-based endurance-coach
  persona that cites real numbers via a shared tool registry. Bring your own
  key: Anthropic or any OpenAI-compatible endpoint (Ollama included). Keys
  encrypted at rest (AES-256-GCM).
- **MCP server** — stateless streamable-HTTP endpoint at `/api/mcp` with
  hashed, scoped (`read` / `write:wellness`), revocable bearer tokens and
  rate limiting, exposing nine tools shared with the coach.
- **Multi-user** — invite-only signup, owner/member roles, full per-user data
  isolation across web and MCP.
- **Strava OAuth** — second activity source with provenance tracking;
  excluded from AI/MCP context by default per Strava's API terms.
- **Self-hosting** — multi-stage Docker image (published to GHCR for
  amd64/arm64), docker-compose with Postgres 16 and optional Cloudflare
  tunnel profile, migrations applied automatically on boot.
- **Demo seed** — `SEED_DEMO=1 npm run db:seed-demo` generates 90 days of
  deterministic, plausible training history for demos and screenshots.
