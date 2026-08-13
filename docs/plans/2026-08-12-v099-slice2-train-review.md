# Whole-branch review: v0.99 slice 2 (Train)

Base `72fb55e` .. Head `65da0fd` — 24 commits.
Review started 2026-08-13. Findings appended incrementally, most-severe first within each section.

STATUS: complete. 3 Critical, 7 Important, 3 Minor. Verdict at the bottom.

---

## Findings

### C1 — CRITICAL — The 12px floor is asserted against a hand-copied table, and this branch is what made that the only check

**Where:** `tests/type-scale-guard.test.ts:571-603` (the `SCALE_PX` map at :573-581), against `src/app/globals.css:66-72`.

**Verified.** The seven type-scale tokens live in `@theme inline { … }` (globals.css:7, values at :66-72). No guard reads that block:

- `extractThemeBlocks()` (`src/lib/design/tokens.ts:65`) matches `/^(:root|\.dark)\s*\{/gm` only — `@theme inline {` never matches, so `contrast-guard`, `glass-contrast-guard` and the token-role machinery never see `--text-*` at all.
- `type-scale-guard`'s font-size test resolves `font-size: var(--text-label)` through `SCALE_PX`, a **hand-written literal copy** of the seven px values, not through the CSS.
- `grep -rn "text-label\|SCALE_PX\|@theme\|0.75rem" tests/ src/lib/design/ scripts/` returns only the guard's own two lines. Nothing else pins these numbers.

**Failure scenario (executed, not hypothesised).** I copied `globals.css` to a scratch file, changed `--text-label: 0.75rem` → `0.625rem` (10px), and re-ran the guard's font-size logic verbatim. Result: `offenders == []`. The guard is green while the floor token is 10px. In the real app that single edit renders **145 `text-label` utility sites plus all 53 `.label-micro` sites at 10px** — i.e. the entire premise of the slice silently reverted, with the whole suite green, `tsc` clean and `eslint` clean.

**Why this branch owns it.** Before `ef85477`, `.label-micro` was `font-size: 10px` — a literal the guard's _numeric_ branch caught directly. `ef85477` retargeted it to `font-size: var(--text-label)`, moving it from the checked branch to the hand-copied-table branch. The branch's own headline fix ("retire the second 10px floor") is the change that made the primary floor uncheckable. This is precisely the shape the previous whole-branch review named: a document (here, a literal table in a test) outliving the code it describes.

**Fix (small, derives instead of asserts):** parse the `@theme` block for `--text-*` declarations and (a) assert each is >= 12px in its own right, (b) build `SCALE_PX` from that parse rather than from a literal. `extractThemeBlocks` already has the shape; it needs `@theme[^{]*` added to the selector alternation, or a sibling `readScaleTokens()`. Then `resolveToken`-style unknown-token handling makes an unregistered `--text-*` fail loudly instead of yielding `undefined` (see C2).

### C2 — CRITICAL — `week-strip.tsx` moved to `.glass`, which breaks Today's card, contradicts the design authority, and falsifies the glass guard's own coverage claim

**Where:** `src/components/week/week-strip.tsx:38` (changed by Task 2, commit `241578b` range). Consumers: `src/components/today/week-row.tsx:38` (Today, `/`) and `src/app/train/page.tsx:788` (`/train`).

The change: `border border-hairline bg-surface-raised` → `glass`.

**Verified — three separate problems, one edit.**

**(a) A visible hover regression on Today, on the one surface that opted out.**
`src/components/today/week-row.tsx:32` is `<section className="… glass glass-no-hover …">` — Today's desktop week row deliberately suppresses the card lift. `globals.css:336-345` defines `.glass:hover { transform: translateY(-4px); box-shadow: … }` and `.glass-no-hover:hover { transform: none; box-shadow: none }` — equal specificity, later rule wins, **so the opt-out applies only to the element carrying it**. `WeekStrip` now carries bare `glass` with no `glass-no-hover` (week-strip.tsx:38), so hovering the day strip lifts it 4px and drops a shadow _inside_ its `items-center` parent, which stays put. `WeekRow` is `hidden … lg:flex` — desktop only — and the rule is inside `@media (hover: hover)`, so this fires exactly where it is guaranteed visible and nowhere else. 9 files use `glass-no-hover`; every other nested glass in `src/components/today/` has it. This one does not.

_Failure scenario:_ open `/` on any desktop ≥ lg, move the pointer across the "This week" row's day strip. The strip jumps up 4px and gains a drop shadow while the card around it is frozen. No test sees it — neither `week-strip.test.tsx` nor `week-row.test.tsx` was touched by this branch (`git diff --stat` over both returns nothing), and both assert only class _substrings_ (`bg-chart-2`, `text-label`), never the surface.

**(b) It contradicts the stated design authority, and is not covered by the one sanctioned deviation.**
`docs/design/v0.99-train.html:474-481` specifies `.week-strip { background: var(--surface-raised); border: 1px solid var(--hairline); }` — i.e. exactly what the code had _before_ this branch. The plan's glass deviation (plan:17-21) is scoped to "a Train **card** currently written `rounded-[18px] border border-white/[0.08] bg-white/[0.03]`" — the strip was already on tokens from slice 1 and matched the mockup. So this edit changed the material away from both the mockup and the pre-branch code, licensed by neither. Nothing in the plan, the ledger or the task-2 notes records the decision.

**(c) It creates glass-in-glass, a ground `tests/glass-contrast-guard.test.ts` explicitly claims to have enumerated.**
That guard's `GROUNDS` (glass-contrast-guard.test.ts:86) is `["surface-base","surface-raised"]`, introduced by a comment (`:74-85`) asserting these are "the opaque grounds glass ACTUALLY sits on, **verified against the tree** rather than guessed". As of this branch that sentence is false: glass now also sits on glass. Computed (dark, `--glass-bg: rgba(255,255,255,0.05)` over `--surface-base #0a0a0a`):

| ground                                             | composite   | `--ink-muted`                   |
| -------------------------------------------------- | ----------- | ------------------------------- |
| surface-base                                       | #161616     | 5.23:1 pass                     |
| surface-raised                                     | #222222     | 4.63:1 pass                     |
| **glass-in-glass (new, unguarded)**                | **#222222** | **4.61:1 pass, 0.11 of margin** |
| glass on surface-overlay (guard bans this by name) | #2a2a2a     | 4.15:1 fail                     |
| glass³                                             | #2d2d2d     | 3.99:1 fail                     |

So it does not ship a contrast failure _today_ — but the guard is now making a coverage claim it cannot support, with 0.11 of headroom, on a nesting depth nobody declared. One more level of glass nesting anywhere (slices 3-8 all migrate glass surfaces) lands at 3.99:1 with every guard green. That is the same shape as the "guard reading only the first of six token blocks".

**Also worth knowing (not itself a new defect):** in dark, the strip's boundary goes from `--hairline #6b6b6b` (~3.4:1, raised to that value by slice 0 specifically for WCAG 1.4.11) to `--glass-border rgba(255,255,255,0.1)` (~1.25:1). That is the house-wide dark glass edge and is waived by name in `contrast-guard.test.ts:105`, so it is consistent — but this element was compliant before and is not now.

**Recommended:** revert `week-strip.tsx:38` to `border border-hairline bg-surface-raised` (matches the mockup, restores Today, removes the nesting). If glass is genuinely wanted, it needs `glass-no-hover` **and** `"glass-over-glass"` added to `GROUNDS` with the 4.61 figure recorded.

### C3 — CRITICAL — `bottom-nav.tsx`'s label went 8px → 12px while keeping `uppercase tracking-widest`, overflowing the global nav on the common phone widths

**Where:** `src/components/bottom-nav.tsx:40` — `text-[8px]` → `text-label`, the branch's entire change to this file (commit in the Task 2 range). The surrounding classes `font-bold uppercase tracking-widest` were **not** touched.

**Verified by measurement.** I rebuilt the nav's exact box model in headless Chromium (`nav.className` at bottom-nav.tsx:26 — `w-[calc(100%-48px)] max-w-sm`, `px-4 py-3`, 1px border, `justify-between`; items `px-2`, `size-6` icon, label `text-label font-bold uppercase tracking-widest` = 12px/700/0.1em) and measured the flex content width against the available width at real device widths. Labels are single unbreakable words, so `min-width:auto` prevents any shrink — the overflow is hard.

| viewport                              | nav width | content needs | overflow | inter-item gap | last item past the pill's 16px right padding |
| ------------------------------------- | --------- | ------------- | -------- | -------------- | -------------------------------------------- |
| 320 (iPhone SE 1, older Android)      | 272       | 334           | **+62**  | 0              | **+79px**                                    |
| 360 (Galaxy S/A, very common Android) | 312       | 334           | **+22**  | 0              | **+39px**                                    |
| 375 (iPhone SE 2/3, 8, X, 12/13 mini) | 327       | 334           | **+7**   | 0              | **+24px**                                    |
| 390 (iPhone 12/13/14/15)              | 342       | 340           | −2       | **0**          | +9px                                         |
| 414 / 430                             | 366 / 382 | 364 / 380     | −2       | 4 / 8          | fits                                         |

The nav is `lg:hidden` — it exists _only_ at these widths.

_Failure scenario:_ open the app on a 360pt Android or a 375pt iPhone. "MENU" renders outside the rounded pill's right edge (past the padding, over the page background, un-rounded), and at 320 it is pushed off the viewport and clipped by `body { overflow-x: hidden }` (`globals.css:216`) — the Settings tab becomes unreachable. At 390 the five items sit flush with **zero** gap between them.

**Honesty about the measurement.** Webfonts would not load in this headless build, so the run used the system sans fallback, which is wider than Geist Sans. I re-ran the arithmetic with the label run 12% and 15% narrower to bound it: 320 still overflows by 44-51px, and 360 lands between +4 and +11px with zero inter-item gap either way. **The 320 and 360 breakages are robust to any plausible font-metric difference; 375 and 390 are marginal and font-dependent.** A real device/emulator check on 360 and 375 settles the marginal rows — that is Task 13's job and it has not run.

**The design reference already made the cut that fixes this, and the implementation dropped it.** `docs/design/v0.99-train.html:1020-1023`:

```css
.bottom-nav .item .lbl {
  font-size: var(--text-label);
  font-weight: 700;
}
```

— no `text-transform`, no `letter-spacing`. The mockup went to 12px _and_ removed uppercase and tracking; the code went to 12px and kept both. Measured, that editorial cut is worth 53px of label run (237.8px → 185px across the five labels), which is more than the worst overflow above. The plan's global constraint says "Build against the mockup, not against spec prose" (plan:15) and routes every doesn't-fit case to the mockup's decision table — this is a case where the mockup answered and the answer was not taken.

**Fix:** drop `uppercase tracking-widest` from bottom-nav.tsx:40, matching the design reference. That is one line and it restores clearance at every width.

**Same class, unmeasured:** `globals.css:348-355` retargets `.label-micro` from `10px` to `var(--text-label)`, and its own comment states this makes **17 call sites outside Train ~20% wider (uppercase at 0.2em tracking)** on surfaces this slice does not open or check. `.label-micro` has 53 call sites across `src/components/{body,settings,admin,activity,week}`, `src/app/{admin,login,join}`. The comment records the widening as known; nothing measured whether any of those 17 sites overflows. Given that the _one_ call site of the same pattern that was measured (this finding) does overflow, "their own slices will check them" is a weaker guarantee than it reads.

### I1 — IMPORTANT — `--ink-race`'s own doc comment names four surfaces; the token reaches three, and the fourth renders on the Train page beside them

**Where:** `src/app/globals.css:114-121` (the claim) vs `src/components/today/race-chip.tsx:40-49` (the code).

The token's comment, added by this branch, reads: _"Race day is its own vocabulary item on four surfaces (the week strip, the day list, **the race chip**, the races list) and had no token."_

**Verified.** `grep -rn "ink-race" src` returns exactly three non-test call sites: `week/week-strip.tsx:21`, `train/week-day-list.tsx:22` and `:113`, `train/races-section.tsx:64`. `race-chip.tsx` was **not modified by this branch** (`git diff --stat 72fb55e 65da0fd -- src/components/today/race-chip.tsx` is empty) and paints the race name `text-ink-primary`, the priority `text-ink-muted`, the outlook `text-coach-ink`. There is no `ink-race` in it.

**Why it matters beyond documentation.** `RaceChip` renders on `/train?tab=week` at `src/app/train/page.tsx:848`, roughly 200 lines above `WeekDayList`. So on one screen the same race appears twice: once in the chip as ordinary primary ink, and once in the day row at `week-day-list.tsx:113` as `text-ink-race`. The stated purpose of the token — "race day is its own vocabulary item" — is violated on the very surface this slice migrated, and the comment asserting otherwise is the kind of claim that will be read as verified.

_Failure scenario:_ an athlete with an upcoming race opens `/train?tab=week`. The race chip says the race name in white; four blocks down the same race name is fuchsia. A later reader greps `ink-race`, finds three sites, reads the comment saying four, and cannot tell whether the chip was missed or deliberately excluded.

**Two honest resolutions**, neither of which is "leave the comment": (a) migrate the chip's race name to `text-ink-race` — it is a two-token edit, but the chip is a Today component and slice 3 owns it, so that is a scope call; or (b) correct the comment to say three surfaces and record the chip as slice 3's. (b) is free and should happen before merge either way.

### I2 — IMPORTANT — `RangeTabs` is the third pill treatment on Train and matches neither of the other two

**Where:** `src/components/train/range-tabs.tsx:26-28`, against `src/components/train/train-tabs.tsx:30-34` and `src/components/train/view-tabs.tsx:52-56`.

The ledger records (`ledger:226-238`) that Task 2 already had to fix exactly this class of drift — _"Task 2's 'the same pill treatment' was ambiguous and left `ViewTabs`' inactive segment with no background while `TrainTabs` kept one"_, fixed in `241578b` — and states the house rule: **"active `overlay`, inactive `raised`"**, valid because active sits one step above inactive on the ladder `base → glass`/`raised` → `overlay`.

**Verified — the three now read:**

| component               | active                                | inactive                                    |
| ----------------------- | ------------------------------------- | ------------------------------------------- |
| `train-tabs.tsx:32-33`  | `bg-surface-overlay text-ink-primary` | `bg-surface-raised text-ink-muted`          |
| `view-tabs.tsx:54-55`   | `bg-surface-overlay text-ink-primary` | `bg-surface-raised text-ink-muted`          |
| **`range-tabs.tsx:27`** | **`bg-accent/20 text-accent`**        | **`text-ink-muted`** (no background at all) |

`RangeTabs` was migrated in the same Task 2 commit that fixed `ViewTabs`, and got neither half of the rule the fix established. The fix was applied to one of the two divergent components.

**Why it matters.** Inconsistency is the small half. The large half is that `bg-accent/20` is a **`token/alpha` fill carrying same-token text**, and that whole construction is outside every guard on this branch: `contrast-guard` checks ink against `--surface-*` only; `glass-contrast-guard` against `--glass-bg` only; the `ADHOC_INK` ratchet regex (`type-scale-guard.test.ts:93`) matches `white|black` alphas exclusively. `bg-accent/20` matches none of them. See I3 — this is now the branch's widest unguarded class, and the numbers are not comfortable.

**Recommended:** bring `RangeTabs` onto `bg-surface-overlay text-ink-primary` / `bg-surface-raised text-ink-muted` like its two siblings, or record in the plan why a range filter is a different kind of control.

### I3 — IMPORTANT — `text-<tone>` on `bg-<tone>/N` is a whole class no guard can see, it is now live on three Train sites, and half the token family fails AA in it

**Where (live, all touched by this branch):**

- `src/app/train/page.tsx:1165` — `bg-accent/10 … text-accent … hover:bg-accent/20`, carrying the text "Log activity"
- `src/components/week/block-sheet.tsx:185` — `hover:bg-chart-5/10 hover:text-chart-5` on a 14px `Trash2` icon
- `src/components/train/races-section.tsx:637` — same pair on a 16px `Trash2` icon
- `src/components/train/range-tabs.tsx:27` — `bg-accent/20 text-accent`

The ledger already noticed one of these and filed it as **deferred Minor 13** — _"`block-sheet`'s `hover:bg-chart-5/10` is a tone-background hover pattern used nowhere else in the codebase"_ — as a novelty observation. Nobody measured it.

**Measured (dark theme, every tone token, composited over each of the three surfaces):**

| pair                             | over base | over raised | over overlay |
| -------------------------------- | --------- | ----------- | ------------ |
| `text-accent` / `bg-accent/10`   | 6.98      | 6.20        | 5.58         |
| `text-accent` / `bg-accent/20`   | 5.86      | 5.16        | 4.65         |
| `text-chart-3` / `bg-chart-3/10` | 8.09      | 7.15        | 6.43         |
| `text-chart-5` / `bg-chart-5/10` | 4.88      | **4.38**    | **3.97**     |
| `text-chart-5` / `bg-chart-5/20` | **4.33**  | **3.86**    | **3.51**     |
| `text-chart-1` / `bg-chart-1/10` | 4.93      | **4.41**    | **3.98**     |
| `text-chart-1` / `bg-chart-1/20` | **4.33**  | **3.84**    | **3.47**     |
| `text-chart-4` / `bg-chart-4/10` | **4.33**  | **3.88**    | **3.51**     |
| `text-chart-4` / `bg-chart-4/20` | **3.86**  | **3.43**    | **3.11**     |

Bold = below the 4.5:1 text floor. **Three of the six tone tokens fail as text in this construction on most grounds, and `chart-4` fails on all six combinations.**

**Verified: nothing live is currently broken, and that is luck rather than design.** The two `chart-5` sites are `Trash2` icons, so they carry WCAG 1.4.11's 3:1 non-text floor, not 4.5 — 3.97 clears it. The one site with real text uses `accent`, the token that happens to pass. But no comment, test or plan line records that the `chart-5` sites are legal _because they are icons_, and nothing stops the next hand from putting a word there.

_Failure scenario:_ Task 12's sweep, or slice 3, adds a "coach note" pill as `bg-chart-4/10 text-chart-4` — the obvious extension of a pattern that now exists in three places on the Train surface. It renders at 3.88:1 inside any card. `tests/contrast-guard.test.ts` passes (`chart-4` is waived by name at `:95` as "chart series colour, not ink or surface"), `glass-contrast-guard` passes (`chart-4` is not `roleOfToken` `"text"`), the type-scale ratchet passes (the regex is `white|black` only), `tsc` and `eslint` pass. The release ships an AA failure with a green gate — the exact outcome this slice's guard suite exists to make impossible.

**Recommended:** extend `ADHOC_INK`'s sibling coverage with a `token/alpha` scan, or — cheaper and more in the spirit of the branch's other guards — add a derived assertion to `contrast-guard.test.ts` that composites every `roleOfToken`-classified colour token at the alphas actually used in `src/` over each surface, and fails any pair used as text below 4.5. The three live sites then have to be declared as non-text explicitly, which is the fact currently held only by luck.

### I4 — IMPORTANT — Task 12's checklist cannot find the 14 deferred ink sites, and nothing records where they are

**Where:** `docs/plans/2026-08-12-v099-slice2-train.md:1766-1815` (Task 12's steps) against `:93` (the deferral) and `ledger:151-153`.

The deferral is stated twice, in prose: plan `:93` — _"Fourteen sites across the six files migrated in Tasks 3–7 carried `/60` or `/65`. They are swept in **Task 12**"_ — and ledger `:151-153`.

**Verified: Task 12's own section never mentions them.** Its four steps are (1) a grep, (2) a duplicate-data scan, (3) apply removals, (4) verify and re-pin. The per-pair ink sweep is in none of them.

**And Step 1's grep structurally cannot find them** (`plan:1778-1780`):

```
grep -rnE 'text-\[[0-9.]+px\]|(text|bg|border|ring|from|to|via|fill|stroke)-white/' \
  src/app/train src/components/train src/components/week --include=*.tsx
```

The 14 sites are **already migrated** — they read `text-ink-secondary` today. They match neither alternative. An implementer who follows Task 12 as written gets "Expected: no output", ticks the box, does the duplicate scan, and commits. The sweep silently never happens, and the release ships with the flattened hierarchies the override was invented to repair.

**Worse: nobody wrote down which 14.** I had to re-derive them, and it takes a diff against the merge-base filtered by regex:

```
git diff 72fb55e 65da0fd -- <file> | grep '^-' | grep -oE 'text-white/(60|65)'
```

which yields, per file: `week-day-list.tsx` 1, `day-actions.tsx` 1, `fuelling-card.tsx` 1, `event-readiness.tsx` 4, `intake-form.tsx` 1, `app/train/page.tsx` 6 — **14 across exactly 6 files, so the ledger's count is correct**. But that derivation exists nowhere in the repo, it stops working once the branch is squashed or rebased, and after Task 12 lands there is no way to check whether the sweep found 14 or 9 — there is no test for the per-pair override, and by construction there cannot be a source-level one, because the "before" alpha is gone.

_Failure scenario:_ Task 12 runs, the grep is clean, the commit says "remove the figures Train was printing twice", and `fuelling-card`'s Before/During/After labels ship on the same ink as their body copy (the ledger's own deferred Minor 11) — a defect that was found, ruled on, scheduled, and then lost between two documents.

**Fix before Task 12 runs (cheap):** paste the enumerated file:line list into Task 12 Step 1 as a checklist, derived now while the diff is still addressable. Six files, fourteen lines.

**Verified good, for contrast:** Task 8 ran _after_ the override was adopted (`9e62253`) and applied it correctly. `plan-preview-card.tsx` moved `/80`→`ink-secondary` and its paired `/60`→**`ink-muted`** (the override), and `races-section.tsx:64`'s C badge stayed on `ink-secondary` per the ledger's closed ruling. Task 9 introduced no `/60`|`/65` at all. So the rule works when a task has it; the problem is only the retro batch.

### I5 — IMPORTANT — Task 12's "the surface must actually be at zero" grep does not cover the files this slice deliberately reached outside Train

**Where:** `docs/plans/2026-08-12-v099-slice2-train.md:1778-1780`.

The grep's scope is `src/app/train src/components/train src/components/week`. The slice deliberately changed three components outside those paths (plan's own scope note, and the ledger's task table): `src/components/bottom-nav.tsx`, `src/components/ui/collapsible.tsx`, `src/components/today/week-strip.tsx` — the last of which _is_ under `src/components/week`, but the first two are not.

**Verified.** `src/components/bottom-nav.tsx` still carries, at HEAD: `border-white/10` (`:26`), `text-white/50` and `hover:text-white` (`:36`). The nav renders on the Train surface at every viewport below `lg`. Task 12 will report "Expected: no output" and declare the surface at zero while the element sitting on top of it holds three unmigrated ink classes, one of which (`text-white/50`) is a live `ADHOC_INK` ratchet offender.

_Failure scenario:_ Task 12 passes its own exit criterion, the slice is declared complete at "zero offenders on the surface", and slice 9 later discovers Train was never at zero. This is the same shape as the previous slice's "exit gate excluding real failures".

**Fix:** add `src/components/bottom-nav.tsx src/components/ui/collapsible.tsx` to the grep's paths, or state in Task 12 that the three shared components are explicitly out of the zero claim and which slice owns each.

### I6 — IMPORTANT — the `it.fails` flip IS forced, but it fires on a weaker condition than the test claims to enforce

**Where:** `src/app/train/skeleton-table.test.ts:34-39`.

**The flip is genuinely forced — this part is fine.** Vitest's `it.fails` reports a _failure_ when the body passes. The moment Task 11 leaves `page.tsx` clean, all four `expect(...).not.toMatch(...)` succeed, the body stops throwing, and the suite goes red until someone changes `it.fails` to `it`. It cannot be silently forgotten. Good design; I checked it specifically because the brief asked.

**What is wrong is the condition it flips on.** The comment at `:27-28` calls this _"the only assertion that holds the WHOLE 1,537-line page.tsx to the 12px floor"_. Its four patterns are strictly narrower than the sibling guard's:

| concern        | `skeleton-table.test.ts:35-38`              | `type-scale-guard.test.ts:83,93`                                 |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| arbitrary type | `text-\[[\d.]+px\]`                         | `text-\[[^\]]*(?:px\|rem\|em)\]`                                 |
| ad-hoc ink     | `text-white/`, `bg-white/`, `border-white/` | `(text\|bg\|border\|fill\|stroke\|ring\|divide)-(white\|black)/` |

So `text-[0.6rem]` (9.6px), `ring-white/20`, `divide-white/5`, `fill-white/40` and every `*-black/N` all pass this test. The type-scale guard's own comment (`:88-90`) says a pattern that misses either opacity syntax or the `ring`/`divide` prefixes _"would let real offenders through undetected"_ — and then the page-level test that inherits the whole-file guarantee misses four prefixes and two units.

_Failure scenario:_ Task 11 migrates Fitness using `text-[0.6rem]` for one cramped column and `divide-white/5` for the table rules. `skeleton-table.test.ts` flips green, gets promoted to `it`, and page.tsx is certified "at the floor" with 9.6px type in it. The global ratchet would catch the _net_ addition (it counts `rem` and `divide`), but it is a count with 25 slack in principle and 0 today, so a swap — remove one offender elsewhere, add one here — is invisible to it and to this test.

**Fix:** import the two regexes from `tests/type-scale-guard.test.ts` (or lift them into `src/lib/design/`) instead of re-spelling them. That is the branch's own stated principle — derive, don't restate — applied to the one guard that restated.

**Related, already ledgered (deferred Minor 4):** `:15` uses a **non-global** `/<table className="([^"]*)"/.exec(SOURCE)`, so it checks the _first_ table in the file. There is exactly one today (`page.tsx:1018`), so it is correct now. Task 10 restructures the Season timeline and Task 11 the Fitness half — both above and below that line. If either lands a table earlier in the file, this assertion silently starts checking a different element and still passes. This is character-for-character the "guard reading only the first of six token blocks" defect from the previous slice, at a smaller scale.

### I7 — IMPORTANT — the surface ladder, this slice's central design rule, has no light-mode expression; the active/inactive pill is invisible in light

**Where:** `src/app/globals.css:98-100` (light) vs `:157-159` (dark). Consumers: `train-tabs.tsx:32-33`, `view-tabs.tsx:54-55`, `block-sheet.tsx:160,266`.

The ledger states the governing rule (`ledger:234-238`): _"The surface ladder is `base → glass`/`raised` → `overlay`. The house pill treatment (active `overlay`, inactive `raised`) works only because active sits one step **above** inactive."_

**Verified — in light there is no step:**

| theme     | `--surface-base` | `--surface-raised` | `--surface-overlay`               |
| --------- | ---------------- | ------------------ | --------------------------------- |
| dark      | `#0a0a0a`        | `#161616`          | `#1f1f1f` (three distinct)        |
| **light** | `#f6f6f6`        | `#ffffff`          | **`#ffffff`** (raised == overlay) |

So `bg-surface-overlay` (active) and `bg-surface-raised` (inactive) are the **same colour** in light. Both of Train's segmented controls and `block-sheet`'s chips lose their selected state entirely — the only remaining cue is `text-ink-primary` vs `text-ink-muted`, i.e. exactly the "selected state read through text colour alone" defect the ledger records Task 7 having to fix (`ledger:231-233`).

The ledger has this as **deferred Minor 8**, scoped to block-sheet and phrased as an observation to "check in the light PNGs". That undersells it: it is not a block-sheet problem, it is that the vocabulary this whole slice is built on is undefined in one of the two themes, and three components now depend on it.

_Failure scenario:_ slice 9 lifts `forcedTheme="dark"`. Every pill on Train (and everything slices 3-8 build on the same rule) ships with no visible selected state in light, and the fix is a palette change — `--surface-overlay` has to become a distinct light value — which then has to be re-verified against every ratio in `contrast-guard` and `glass-contrast-guard`, on nine slices' worth of components at once.

The brief's own framing applies: light being unreachable excuses nothing about correctness. **This should be a recorded slice-9 blocker with the palette fix named, not a "check the PNGs" minor.** A cheap guard exists too: assert in `contrast-guard.test.ts` that the three `--surface-*` values are pairwise distinct in every theme — three lines, and it fails today, which is the point.

### M1 — MINOR — the ledger contradicts itself about Task 9, in the commit that recorded Task 9

**Where:** `docs/plans/2026-08-12-v099-slice2-train-ledger.md:50` vs `:253`, both at HEAD (`65da0fd`, "docs(ledger): record task 9").

`:50` — Task 9 complete, commits `7001699..0e78437`, "clean after 1 fix". `:253` — _"Still owed: Tasks **9 (History)**, 10 (Season timeline), 11 …"_. The task table was updated; the "Still owed" list was not. The ledger is explicitly the handoff artefact for a session that lost its peer to a host crash (`:155-164`), so a reader arriving cold gets two answers to "is History done".

### M2 — MINOR — three `aria-current` spellings across three sibling controls

`train-tabs.tsx:29` uses `aria-current={… ? "page" : undefined}`; `view-tabs.tsx:51,68` and `range-tabs.tsx:25` use `"true"`. All four are `next/link` navigations that change the URL, so `"page"` is the correct token for all of them. Harmless today, but it is the same "same role, different rendering" drift the review was asked to look for, one layer down in the a11y tree.

### M3 — MINOR — the next-week disclosure's affordance never changes

`src/components/train/next-week-summary.tsx:70-72` renders `Show all 7 days →` inside the `<summary>`. A native `<details>` cannot change that text without JS, so once expanded the control still reads "Show all 7 days →" while all seven are on screen. A `details[open] summary .x { display: none }` rule (or an `::after` swap) fixes it in CSS with no client component. Worth folding into Task 12 or 13.

---

## The unrelated commit — `d611e0d` (merged as `64c78a8`)

**Verdict: it belongs on this branch. Keep it, flag it in the release notes as the ledger already says.**

Read in full. It replaces three `date: "2026-08-05"` fixtures in `src/lib/tools/get-wellness.test.ts` with `daysAgoYmd(2)` against the tool's `{ days: 7 }` window. Test-only, no production file touched, five days of slack so no timezone or run-boundary can push it out (the app container runs `TZ=Europe/Amsterdam`; even a UTC/local split moves it by one day inside a seven-day window).

The alternative was worse in a way that bears directly on this review: without it the suite is red from 2026-08-13 onward for a reason unrelated to the code, and every downstream statement of the form "the gate was green" becomes unverifiable. Nine per-task reviews on this branch rested on that gate.

Two things I checked rather than assumed: it is genuinely isolated (`fix/get-wellness-date-rot` off `main` holds the same SHA, so merging it to `main` separately later is a no-op, not a conflict), and it does not touch the DB-gated skip condition, so it behaves the same in CI as locally.

---

## Triage of the 15 deferred Minors

**Fix before merge (4).**

| #   | Ledger item                                    | Why it moves up                                                                                                                                                                                            |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SCALE_PX` hardcodes the seven px values       | **Escalate to Critical — this is C1.** Filed as "drifts silently"; it does more than drift, it is now the _only_ thing checking the 12px floor, and I demonstrated a green suite at a 10px floor.          |
| 4   | skeleton-table's positional `<table>` coupling | **Escalate to Important — part of I6.** "Sound today, fragile if a second table lands earlier" is exactly what Tasks 10 and 11 are about to do to that file. One-line fix (assert exactly one match).      |
| 7   | token-proof regexes miss bare `text-white`     | **Not hypothetical.** `bottom-nav.tsx:36` carries a live bare `text-white` and `hover:text-white`. The gap is the same narrowness as I6 and should be closed with it, in one edit.                         |
| 13  | `block-sheet`'s `hover:bg-chart-5/10`          | **Escalate to Important — this is I3.** Filed as "a pattern used nowhere else"; measured, the pattern is legal only because the two live sites are icons, and three of six tone tokens fail as text in it. |

**Escalate but do not block merge (1).**

| #   | Ledger item                                 | Disposition                                                                                                                                                                                                                                               |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | light `surface-raised` == `surface-overlay` | **This is I7.** Not a block-sheet observation — the ladder is undefined in light and three components depend on it. Record as a named slice-9 blocker with the palette fix, and add the three-line pairwise-distinct assertion so it is not rediscovered. |

**Ride (10).** All genuinely minor, none load-bearing:

- **2** (`declaredTokenNames()` duplicates three lines) — both copies derive from the CSS, so they cannot disagree about anything that matters. Cosmetic.
- **3** (TEXT_INKS comment omits `viz-muted-ink`) — the _list_ is derived and exact; only the prose is incomplete. Fold into any later touch of the file.
- **5** (day-actions / event-readiness token proofs cover one branch each) — the source-level ratchet covers the rest, as the ledger says. Correct call.
- **6** (block-sheet test covers energy chips only) — real gap, but the fixture is one extra sport away from closing it. Task 12 or whenever.
- **9** (readiness figure not `font-numeric`) — Task 13, visual.
- **10** (`border-current` on the calibrating chip) — Task 13, visual judgement with the PNG open.
- **11** (fuelling-card's flattened pair) — one of the 14; **its fate is decided by I4, not by this line.** If I4's enumeration lands, this rides safely; if it does not, this is the defect that ships.
- **12** (races-section B badge border) — Task 13, visual.
- **14** (`divide-hairline` first usage) — valid utility, no action.
- **15** (stale comment at `week-day-list.test.tsx:350`) — trivial.

---

## Merge verdict

**Not mergeable as-is. Nothing structural is wrong with the branch — the architecture, the ratchet design, the derived-token machinery and the ledger discipline are all better than the slice they follow — but three of the findings ship real defects and must land first.**

**Blocking, all small and local:**

1. **C3 — `bottom-nav.tsx:40`.** Drop `uppercase tracking-widest`, per the design reference. One line. This is a shipped layout break on the app's global navigation at 320/360/375pt, and the nav exists only at those widths.
2. **C2 — `week-strip.tsx:38`.** Revert to `border border-hairline bg-surface-raised`. One line. Restores the mockup, removes the hover regression on Today, and removes the undeclared glass-in-glass nesting.
3. **C1 — `type-scale-guard.test.ts:573-581`.** Derive `SCALE_PX` from the `@theme` block. Perhaps twenty lines. Without it the slice's headline guarantee is asserted by a literal that nothing keeps honest.

**Strongly recommended before merge (cheap, and each one is a guard that stops being false):**

4. **I4** — enumerate the 14 retro ink sites into Task 12 Step 1 _now_, while the diff is still addressable. This is the single highest-risk item on the branch's future: a ruled-on defect that the executing checklist cannot find.
5. **I5** — widen Task 12's zero-offender grep to the two shared components outside its paths.
6. **I6** — import the two offender regexes into `skeleton-table.test.ts` instead of re-spelling them narrower; assert exactly one `<table>`.
7. **I1** — correct the `--ink-race` comment to the three surfaces it actually reaches.

**Can ride to Tasks 10-13 or slice 9:** I2, I3 (record that the two `chart-5` sites are icons, then guard the class properly), I7 (as a named slice-9 blocker), M1-M3.

**On the question the review was commissioned to answer.** Every Critical here is a seam or a scope question invisible from inside one task, and the branch shows the pattern the previous review named still operating: C1 is a literal table outliving the CSS it copies; C2 is a guard comment ("verified against the tree") outliving the tree; I4 is a deferral recorded in prose that the checklist executing it cannot act on; I5 is an exit gate whose scope excludes files the slice deliberately changed. The _counter_-evidence is real too and worth saying: the ratchets are exact (235/235, 529/529, zero slack — I recounted both), the `it.fails` flip is genuinely forced, `renderableThemes()` fails closed as advertised, the `--ink-race` contrast figures in `globals.css:114-121` reproduce to two decimals, and the derived-`TEXT_INKS` fix from Task 1 is the right shape. The guards that _derive_ all held. Every finding above is against one that _asserts_.

**Tasks 10-12 landing does not change this verdict** — none of them touches `bottom-nav.tsx`, `week-strip.tsx` or `SCALE_PX`, and Task 12 is itself the subject of I4 and I5.
