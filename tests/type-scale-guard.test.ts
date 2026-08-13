// tests/type-scale-guard.test.ts — Phase 2b.4's second guardrail.
//
// v0.99.0's premise: 300 hardcoded pixel sizes over 16 distinct values, 239
// of them 11px or smaller, and 8 ad-hoc ink alphas of which three fail AA.
//
// WHY A SOURCE SCAN IS SOUND FOR TAILWIND UTILITIES, unlike the
// source-parsing guard v0.39 deleted: Tailwind v4 only compiles classes that
// appear as literal strings in source. An arbitrary `text-[9px]` that is not
// a literal never renders, so a class assembled at runtime cannot defeat the
// scan — such a class produces no CSS either.
//
// WHAT THAT ARGUMENT DOES *NOT* COVER, corrected (C2, whole-branch review
// 2026-08-11). The version of this comment that shipped generalised the
// sentence above into "anything that can reach the screen is findable by
// scanning". That is false, and the falsification was live in three files
// this guard already opened and read: an inline `style={{ color:
// "rgba(255,255,255,0.4)" }}` reaches the screen with no Tailwind
// involvement at all. `src/components/train/fitness-tiles.tsx` was painting
// context labels at 3.77:1 — the exact value `.label-micro` was fixed from —
// while every assertion in this file passed.
//
// What is actually covered, and by what:
//   - Tailwind utility classes in src/**\/*.tsx — the three scans below.
//   - Declarations in globals.css outside the token blocks — the raw-colour
//     scan further down, syntax-agnostic since C1.
//   - Declarations inside the token blocks — tests/contrast-guard.test.ts,
//     which reads every one of the six blocks.
//   - Inline `style={{ … }}` object literals — the two assertions added for
//     C2, and nothing more than these two:
//       (a) a hard AA floor on inline TEXT colour: every colour literal
//           written out in a text-painting declaration, and every var()
//           token it references, measured worst-case against every
//           `--surface-*` of every theme `renderableThemes()` says the app
//           can actually render. That is `dark` alone while
//           theme-provider.tsx forces it, and BOTH themes the moment it does
//           not — which is what makes the theme-blind literals in the
//           inventory (2.28:1 and 2.52:1 in light) fail on the day light
//           mode becomes reachable, with nobody having to remember.
//       (b) an exact inventory that cannot grow, holding what no ratio can
//           be computed for: values assembled at runtime (`t.color`,
//           `rgb(${style.hue})`), non-text inline colour, and any `style=`
//           prop that is not an object literal at all. Recorded, not
//           checked — but it cannot change or grow silently.
//
// What is still NOT covered, so that this comment stops overclaiming: colour
// literals living in ordinary TypeScript values outside a `style={{ … }}` —
// constant maps like `BAND_COLOR` and `KIND_STYLE`, `color="#a78bfa"` props
// passed into chart components, SVG `stroke`/`fill` presentation attributes.
// 142 of them across 26 non-test files in src/ as of v0.99.0
// (`grep -ohE '#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(' <non-test sources>`;
// the inline-style subset above is included in that count). They reach the
// screen and this file does not see them; slices 1–9 migrate them surface by
// surface, and the axe pass — which reads the rendered DOM instead of the
// source — is what looks at them until then.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CSS_PATH,
  readScaleTokens,
  readThemeTokens,
  renderableThemes,
  resolveToken,
  resolvedThemeTokens,
  roleOfToken,
  type ThemeName,
} from "../src/lib/design/tokens";
import {
  compositeOver,
  findColorLiterals,
  isNeutral,
  type Rgba,
} from "../src/lib/design/color-literals";
import {
  findInlineStyleEntries,
  propertyRole,
  styleValueColors,
} from "../src/lib/design/inline-styles";
import { contrastRatio } from "../src/lib/design/contrast";
import {
  ARBITRARY_TYPE,
  ADHOC_INK,
} from "../src/lib/design/type-scale-patterns";

const SRC = join(process.cwd(), "src");

/** hairline is a non-text token; using it as text colour is the one misuse. */
const HAIRLINE_AS_TEXT = /\btext-hairline\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full))
      out.push(full);
  }
  return out;
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n").entries()) {
      const [i, content] = line;
      const matches = content.match(new RegExp(pattern.source, "g"));
      if (matches) {
        found.push(
          `${relative(process.cwd(), file)}:${i + 1} — ${matches.join(", ")}`
        );
      }
    }
  }
  return found;
}

/** Total individual matches, not offending lines — one line can hold several. */
function occurrences(pattern: RegExp): number {
  let total = 0;
  for (const file of walk(SRC)) {
    for (const content of readFileSync(file, "utf8").split("\n")) {
      total += content.match(new RegExp(pattern.source, "g"))?.length ?? 0;
    }
  }
  return total;
}

/* ── THE RATCHET (I5, whole-branch review 2026-08-11) ───────────────────────
 * The two `it.fails` assertions below are deliberate and stay — the offenders
 * cannot be gone until the last surface migrates. But `it.fails` passes on
 * ANY failure, and `[…395 offenders]` fails a `toEqual([])` exactly as well
 * as `[…600 offenders]` does. So between slice 0 and slice 9 an implementer
 * could ADD arbitrary type sizes and ad-hoc ink alphas freely — for eight
 * slices, on a release whose entire premise is that these counts are too
 * high — and this file would stay green. The only signal `it.fails` gives
 * fires at exactly zero: the moment before the goal is met, and never once on
 * the way there.
 *
 * These ceilings are the missing signal. Measured, pinned, and asserted by
 * real `it()`s so a rise is a red suite immediately.
 *
 * TWO-SIDED ON PURPOSE. A pure upper bound goes stale: a slice that removes
 * 300 offenders and leaves the ceiling at 395 hands the next implementer 300
 * free offenders back. So each ceiling must also stay CLOSE to the real count
 * — within RATCHET_SLACK — which forces the slice that drives a number down
 * to re-pin it here. That re-pinning is the per-slice evidence the plan asks
 * for ("the number each slice must drive down"), recorded in the one place a
 * later slice cannot avoid reading.
 *
 * TO UPDATE: run the suite, read the actual count out of the failure message,
 * and put it here. Lowering a ceiling is routine and needs no ceremony.
 * RAISING one is a decision that needs a reason in the commit message, and
 * on this release there is unlikely to be a good one.
 */
const RATCHET_SLACK = 25;
const OFFENDER_CEILINGS: Record<string, number> = {
  // 137 occurrences, unchanged, measured 2026-08-13 after v0.102 (Body slice)
  // task 11 (the sweep) — re-pinned, not moved. Task 11's own sweep grep,
  // scoped to every file that renders on any of Body's four tabs (not just
  // src/components/body/), found TOTAL 0 0 for both patterns across:
  // src/app/body/page.tsx, src/components/body/*.tsx,
  // src/components/app-shell.tsx, src/components/bottom-nav.tsx,
  // src/components/sidebar-nav.tsx, src/components/ui/empty-state.tsx,
  // src/components/ui/collapsible.tsx. journal-form.tsx's mood-picker emoji
  // size (bare text-2xl, an un-tokenised Tailwind step this pattern's own
  // regex — text-\[…px|rem|em\] — cannot see, since it only matches arbitrary
  // bracket values) was migrated to text-heading, its exact 24px equivalent;
  // that fix does not move this count either, for the same reason. See the
  // sibling ceiling below for the ad-hoc-alpha half of this task's sweep.
  // 137 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 10 —
  // health-upload.tsx and health-manual-entry.tsx (both folded behind
  // Collapsible in the same task) migrated 13 text-[Npx] sites:
  // health-upload.tsx (7) — the intro paragraph (text-[12px] →
  // text-label), the file input's own file:text-[10px] (→ file:text-label),
  // the Extract button (text-[10px] → text-label), the
  // parsed-without-a-model warning (text-[11px] → text-label), the review
  // table's header row (text-[10px] → text-label), and the Save/Discard
  // pair below the table (each its own text-[10px] → text-label);
  // health-manual-entry.tsx (6) — the four field labels (Birth year, Date,
  // Systolic, Diastolic; text-[11px] x4 → text-label) and the two Save
  // buttons (each its own text-[10px] → text-label). text-sm stayed on the
  // two headings (now text-caption, and h3 not h2 — the trigger's own h3
  // wrapper must not sit under a higher heading level) and on the
  // textarea/date/number inputs (now text-caption); text-xs stayed on the
  // file input's base size, the error line, the confidence cell and the
  // Measured/saveMsg text (now text-label or font-numeric text-label).
  // Neither text-sm nor text-xs is arbitrary, so none of those move this
  // count.
  // Was 150 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 9 —
  // the Labs tab's four reading blocks migrated 13 text-[Npx] sites:
  // labs-tiles.tsx (7) — both tile eyebrows (text-[8.5px] x2 → label-micro),
  // the age figure (text-[22px] → text-title), the delta (text-[11px] →
  // text-label), the unavailable line (text-[11px] → text-caption), the
  // biomarker count (text-[12.5px] → text-caption) and the draw date
  // (text-[10.5px] → text-label); bio-age-card.tsx (2) — the unavailable
  // line (text-[11px] → text-caption) and the component row (text-[11px] →
  // text-label); blood-pressure-card.tsx (2) — the readings/direction line
  // (text-[11px] → text-label) and the average (text-[11px] → text-caption);
  // biomarker-list.tsx (2) — the category heading (text-[10px] →
  // text-label) and the unit (text-[11px] → text-label). text-4xl, text-3xl,
  // text-sm and text-xs are named Tailwind sizes, not arbitrary, so they
  // don't move this count.
  // Was 163 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 8 —
  // correlation-rows.tsx migrated its 6 text-[Npx] sites: the "90-day
  // correlations" heading eyebrow (text-[9.5px] → label-micro), the
  // behaviour-name row (text-[12px] → text-caption), the "auto" marker
  // (text-[9px] → text-label) and the three badge states — unavailable
  // (text-[11px]), no-effect (text-[11.5px]) and the signed finding
  // (text-[11.5px]) — all three collapsed onto the one text-label size, the
  // three states now told apart by wording and ink/weight alone
  // (unavailable: text-ink-muted; no effect: font-medium text-ink-secondary;
  // finding: font-bold text-chart-2/text-chart-5). milestones-card.tsx had
  // no arbitrary sizes to begin with (it used text-xs), so it does not move
  // this count.
  // Was 169 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 7 —
  // journal-form.tsx migrated the rest of the file (the manual-vitals
  // panel, behavior tags, day flags, notes and the submit button) and
  // dropped 10 text-[Npx] sites: the vitals intro paragraph and its four
  // input labels (text-[10px] x5 → text-label), the tag-group heading
  // (text-[9px] → text-label), the tag pills and day-flag pills (each
  // text-[10px] → text-label), the "remember these as usual" button
  // (text-[10px] → text-label) and the day-flags footnote (text-[10px] →
  // text-label).
  // Was 179 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 6 —
  // journal-form.tsx migrated 6 text-[Npx] sites: two went with the deleted
  // header (the "Logging Streak" eyebrow's text-[10px] and the streak
  // ring's text-[8px] fraction — the owner decision to drop the form's own
  // duplicate header, since the page header's chip is the single streak on
  // screen), the calendar strip's day label (text-[9px] → text-label), and
  // the sliders' low/high end labels (text-[9px] x2 → text-label).
  // Was 185 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 5 —
  // body-battery.tsx migrated 5 text-[Npx] sites: the modelled-from line
  // (text-[11px] → text-label), both tag-pill branches' text-[9px], hoisted
  // into one BatteryTags component and reduced to a single text-label
  // occurrence, the checkpoint grid wrapper's text-[10px] (dropped, the
  // token now lives on the tile's own label/value spans) and the axis row's
  // text-[10px] → text-label.
  // Was 190 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 4 —
  // the Sleep tab (sleep-night-card.tsx, sleep-history-strip.tsx and
  // page.tsx's consistency/chronotype rhythm row) migrated 14 text-[Npx]
  // sites: sleep-night-card.tsx's heading eyebrow (9.5px → label-micro), the
  // four nav-arrow spans (13px → text-caption), the bed-window line (11px →
  // text-label), the stage-legend li (9.5px → text-label), the fallback
  // paragraph (11px → text-caption) and the bedtime line (11px →
  // text-caption); sleep-history-strip.tsx's weekday initial (8px →
  // text-label) and day-number (11px → text-label); and page.tsx's
  // Consistency/Chronotype labels (11px x2) and the "last 30 nights"
  // caption (10px), all three → text-label.
  // Was 204 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 3 —
  // baseline-trend-card.tsx migrated 4 text-[Npx] sites: the eyebrow
  // (text-[9.5px] → label-micro, which already carries text-label) and the
  // reading row (text-[11px] → text-label, text-[12px] → text-caption, and
  // the empty-state text-[11px] → text-caption).
  // Was 208 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 2 —
  // page.tsx's header (the h1 and the streak chip) plus the two new
  // components it now delegates to, body-tabs.tsx and range-tabs.tsx —
  // migrated 4 text-[Npx] sites: text-[22px] (h1 → text-title), text-[10.5px]
  // (streak chip → text-label), text-[11px] (Body's tab-row labels →
  // text-label) and text-[10px] (Trends' range-pill labels → text-label).
  // Was 212 occurrences, measured 2026-08-13 in v0.101.1 (whole-branch review 2,
  // C1). The "Train is now at ZERO offenders" line directly below, written
  // after task 12, was false: task 12's Step-1 sweep grep never covered
  // sidebar-nav.tsx (the desktop, lg-and-above nav — the exact complement of
  // bottom-nav.tsx's lg-and-below half, which the sweep DID add) or
  // empty-state.tsx (rendered at five Train call sites). Both render on
  // every Train tab via AppShell. sidebar-nav.tsx alone carried 4 arbitrary
  // pixel sizes — including one site below the 12px floor — plus 8 ad-hoc
  // white-alpha utilities; empty-state.tsx carried 2 more ad-hoc alphas.
  // Ten live offender lines the sweep's scope never reached. Both files are
  // migrated to the token scale now, and both are added to the sweep's own
  // grep (docs/plans/2026-08-12-v099-slice2-train.md, Task 12 Step 1) so a
  // later slice re-running it cannot repeat the miss. With the sweep's true
  // scope, the Train surface is at zero offenders with exactly one
  // deliberate exclusion: block-sheet.tsx's modal scrim, which is neither
  // ink nor surface and has no token.
  // 217 occurrences, measured 2026-08-13 after task 12 (the sweep — the two
  // header control switches season-mode-switch.tsx and plan-style-switch.tsx,
  // which no earlier task owned, plus bottom-nav.tsx and plan-empty.tsx)
  // migrated 6 text-[Npx] sites. CORRECTION (v0.101.1, above): the claim
  // that followed here — that the Train surface was at zero offenders with
  // one exclusion — was false; the sweep's grep never reached
  // sidebar-nav.tsx or empty-state.tsx.
  // Was 223 occurrences, measured 2026-08-13 after task 11 (Fitness —
  // fitness-tiles.tsx, pmc-chart.tsx, fitness-stats-row.tsx and page.tsx's
  // Fitness half) migrated 6 text-[Npx] sites: the tile label, value and
  // context in fitness-tiles.tsx, the Stat label in pmc-chart.tsx, the
  // eFTP/Max Power/W'/Ramp label in fitness-stats-row.tsx, and the CTL/ATL/
  // TSB legend row in page.tsx.
  // Was 229 occurrences, measured 2026-08-13 after task 10 (Season — the
  // season-timeline-card.tsx restructure) migrated 6 text-[Npx] sites: the
  // eyebrow, the three stat tiles' shared text-[10px] wrapper, and the
  // closing note and empty state, one each. The per-bar week (9px) and
  // session-count (8px) labels were not migrated to a token — they were
  // deleted outright, replaced by the axis ticks and the detail readout.
  // Was 235 occurrences, measured 2026-08-13 after task 9 (History — the
  // day-grouped rows in history-list.tsx, the summary strip in
  // history-stat-strip.tsx, and the Log-activity link and sport filter
  // pills in page.tsx's History half) migrated 9 text-[Npx] sites.
  // Was 244 after task 8 (races-section.tsx and plan-preview-card.tsx —
  // the A/B/C priority chips, the add-race and demand-edit forms, the
  // phase table and week list) migrated 21 text-[Npx] sites.
  // 265 after task 7 (the availability intake path — intake-form.tsx,
  // block-sheet.tsx, standard-week.tsx and availability-week-switcher.tsx)
  // migrated 23 text-[Npx] sites. 288 after task 6 (the week tab's
  // page-level chrome in page.tsx itself — the adjustments panel, the
  // remaining-skeleton table, the start-week form, the next-week note and
  // the race chip's goal note) migrated 14 text-[Npx] sites. 302 after task
  // 5 (the week tab's prose blocks — day-actions.tsx's pills and selects,
  // fuelling-card.tsx's card and confidence chip, week-rationale.tsx's
  // shortfall/reason prose, and event-readiness.tsx's verdict/demand prose)
  // migrated 31 text-[Npx] sites. 333 after task 4 (the next-week preview
  // collapse — the new next-week-summary.tsx and the wiring changes in
  // week-day-list.tsx and page.tsx are all token utilities, so the count did
  // not move there), 343 after task 2, 351 after the whole-branch-review
  // fixes, 355 right after slice 1, 395 at slice 0.
  "arbitrary type sizes": 137,
  // 311 occurrences, unchanged, measured 2026-08-13 after v0.102 (Body slice)
  // task 11 (the sweep) — re-pinned, not moved. Task 11's own sweep grep
  // (same file list as the sibling ceiling above: src/app/body/page.tsx,
  // src/components/body/*.tsx, src/components/app-shell.tsx,
  // src/components/bottom-nav.tsx, src/components/sidebar-nav.tsx,
  // src/components/ui/empty-state.tsx, src/components/ui/collapsible.tsx)
  // found TOTAL 0 0 for both patterns. journal-form.tsx's CheckCircle badge
  // on the "Subjective feeling" step (text-emerald-500 → text-chart-2) was
  // migrated in the same commit — an unguarded colour literal this pattern's
  // own regex cannot see, since it only matches white/black alpha utilities,
  // not a bare Tailwind palette colour — so it does not move this count
  // either. Two items checked and deliberately left: .tag-active on the
  // journal's tag/day-flag pills (journal-form.tsx) hardcodes the dark accent
  // as a recorded deferral to slice 9 (docs/v0.99-redesign-handoff.md), and
  // ui/unavailable.tsx's one text-white/50 belongs to its <Unavailable>
  // component, which no Body file renders — confirmed with
  // `grep -rn "<Unavailable" src/`, which finds it only in
  // unavailable.test.tsx — Body calls only the unavailableMessage() string
  // helper. Neither is this task's to fix.
  // 311 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 10 —
  // health-upload.tsx and health-manual-entry.tsx migrated 35 text-white/N,
  // bg-white/N and border-white/N sites: health-upload.tsx (19) — the intro
  // paragraph's text-white/50, the textarea's border-white/10 + bg-white/5,
  // the file input's own text-white/60 + file:bg-white/10 + file:text-white/80
  // (3), the review table's header row text-white/40, the row divider's
  // border-white/5, the three editable cells' shared bg-white/5 (displayName/
  // value/unit, 3), the confidence cell's low-confidence-else text-white/50,
  // the remove button's text-white/40, the "Measured" label's text-white/60,
  // its date input's border-white/10 + bg-white/5, the Discard button's
  // text-white/40 + hover:text-white/70 (2), and the save-message
  // paragraph's text-white/60 — all → text-ink-muted / text-ink-secondary /
  // border-hairline / bg-surface-overlay as the per-site ink weight called
  // for; health-manual-entry.tsx (16) — the four field labels' shared
  // text-white/50 (4), the four inputs' shared border-white/10 + bg-white/5
  // (8), the birth-year Save button's border-white/10 + bg-white/5 (2), the
  // section divider's border-white/5, and the message paragraph's
  // text-white/60 — all → text-ink-muted / border-hairline /
  // bg-surface-overlay. Neither file's Save/Extract buttons move this
  // count: `bg-emerald-500`/`text-black` are opaque, not an alpha utility
  // (the buttons move to `bg-accent`/`text-primary-foreground` as tokens,
  // which this guard does not scan for — it only flags the ad-hoc
  // white/black alpha this task is eliminating).
  // Was 346 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 9 —
  // the Labs tab's four reading blocks migrated 20 text-white/N and
  // bg-white/N sites: labs-tiles.tsx (9) — both tiles' border-white/[0.09] +
  // bg-white/[0.04] pairs (→ `glass`, 4), both eyebrows' text-white/40
  // (dropped with the move to `label-micro`, 2), the unavailable line and
  // the delta's non-younger branch (both text-white/50 → text-ink-muted, 2)
  // and the draw date's text-white/45 (→ text-ink-muted, 1); bio-age-card.tsx
  // (4) — the "Not enough inputs yet" line's text-white/70 (→
  // text-ink-secondary), the unavailable detail and component label's
  // text-white/50 (both → text-ink-muted) and the zero-offset branch's
  // text-white/40 (→ text-ink-muted); blood-pressure-card.tsx (3) — the
  // readings/direction line and unit's text-white/40 and the average's
  // text-white/50 (all → text-ink-muted); biomarker-list.tsx (4) — the
  // category heading's text-white/40, the divider's divide-white/5 (→
  // divide-hairline), the marker name's text-white/80 (→ text-ink-secondary,
  // the per-pair override: name and unit sat in different alpha buckets and
  // the unit, the subordinate, takes text-ink-muted rather than the nearer
  // text-ink-secondary) and the unit's text-white/40. The five BAND_COLOR
  // values (text-emerald-400/text-yellow-400/text-amber-400/
  // text-orange-400/text-red-400 → text-chart-2/text-chart-3/text-chart-5)
  // and labs-tiles.tsx's/bio-age-card.tsx's text-emerald-400 (→
  // text-chart-2) were never white/black alpha, so they don't move this
  // count.
  // Was 366 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 8 —
  // correlation-rows.tsx migrated 8 text-white/N, bg-white/N and
  // border-white/N sites: the card wrapper's border-white/[0.08] +
  // bg-white/[0.03] (→ `glass`), the row divider's border-white/[0.06] (→
  // `border-hairline`), the behaviour-name ink (text-white/85 →
  // text-ink-secondary), the "auto" marker (text-white/30 → text-ink-muted)
  // and the heading eyebrow (text-white/40, dropped with the move to
  // `label-micro`) plus the unavailable and no-effect badges' text-white/40
  // and text-white/70 (→ text-ink-muted / text-ink-secondary). The signed
  // finding badge's text-emerald-400/text-red-400 moved to
  // text-chart-2/text-chart-5 but was never white/black alpha, so it does
  // not move this count. milestones-card.tsx migrated 3 more: the row
  // label's text-white/70 (→ text-ink-secondary), the em-dash placeholder's
  // text-white/30 and the detail's text-white/40 (both → text-ink-muted —
  // the per-pair override: the row label and its detail sat in different
  // alpha buckets, and the quieter one takes ink-muted even though
  // nearest-value would put it on ink-secondary).
  // Was 377 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 7 —
  // journal-form.tsx migrated 26 text-white/N, bg-white/N and
  // border-white/N sites: the manual-vitals panel (17) — the intro
  // paragraph and four labels' text-white/50 (→ text-ink-muted), and each
  // of the four inputs' border-white/10 + bg-white/5 +
  // placeholder:text-white/30 trio (→ border-hairline + bg-surface-overlay
  // + placeholder:text-ink-muted; the bare `text-white` on each input has
  // no alpha, so it does not move this count — it moved to text-ink-primary
  // in the same edit); the tag-group heading's text-white/50 (1); the tag
  // pills' and day-flag pills' border-white/10 (2, one source occurrence
  // each, both → border-hairline, both still `glass`); the "remember these
  // as usual" button's bg-white/5 + text-white/60 + hover:bg-white/10 trio
  // (3, → bg-surface-overlay / text-ink-secondary / hover:bg-surface-raised);
  // the footnote's text-white/50 (1); and the notes textarea's
  // text-white/80 + placeholder:text-white/40 pair (2, →
  // text-ink-secondary / placeholder:text-ink-muted). `tag-active` on the
  // tag/flag pills is untouched — it hardcodes the dark accent as a
  // deliberate deferral to slice 9 (docs/v0.99-redesign-handoff.md).
  // Was 403 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 6 —
  // journal-form.tsx migrated 11 text-white/N, bg-white/N and border-white/N
  // sites: three went with the deleted header (the eyebrow's text-white/50,
  // the streak ring's border-white/10 and its track circle's text-white/5);
  // the calendar strip's day label and day circle inactive states (both
  // text-white/50 → text-ink-muted, active states moved to
  // text-chart-2/text-ink-primary); the slider label (text-white/80 →
  // text-ink-secondary) and value's unanswered state (text-white/40 →
  // text-ink-muted); the Continue button's trio (bg-white/5 +
  // hover:bg-white/10 → bg-surface-overlay/hover:bg-surface-raised,
  // text-white/70 → text-ink-secondary); and the "intervals.icu synced"
  // chip (text-white/40 → text-ink-muted). The low/high end labels'
  // text-emerald-400/60 and text-red-400/60 moved to text-chart-2 /
  // text-chart-5 (alphas dropped) but were never white/black, so they don't
  // move this count.
  // Was 414 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 5 —
  // body-battery.tsx migrated 14 text-white/N, bg-white/N and border-white/N
  // sites: the unavailable-state paragraph's text-white/50 (→
  // text-ink-muted), both tag-pill branches' border-white/10 + bg-white/5 +
  // text-white/55 trio (6 matches total), hoisted into the single
  // BatteryTags component and reduced to zero — border-hairline,
  // bg-surface-overlay and text-ink-secondary carry no ad-hoc alpha; the
  // "% now" readout's text-white/80 (→ text-ink-secondary); the
  // modelled-from line's text-white/40 (→ text-ink-muted); the checkpoint
  // tile's border-white/10 + bg-white/5 (→ border-hairline +
  // bg-surface-overlay), its label's text-white/35 and value's text-white/85
  // (both → the ink scale); and the axis row's text-white/50 (→
  // text-ink-muted).
  // Was 428 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 4 —
  // the same three files migrated 27 text-white/N, bg-white/N and
  // border-white/N sites: sleep-night-card.tsx (13) — the card wrapper's
  // border-white/[0.08] + bg-white/[0.03] (→ `glass`), the heading ink, both
  // nav-arrow link/disabled pairs, the bed-window ink, the legend ink, the
  // fallback-paragraph ink and the divider border (→ `border-hairline`);
  // sleep-history-strip.tsx (7) — the cell's selected/unselected
  // border+background trio (→ `border-ink-muted`/`bg-surface-overlay`), the
  // weekday-initial ink, the day-number selected/unselected pair and the
  // no-stages bar fill (→ `bg-surface-overlay`); and page.tsx's rhythm row
  // (7) — the card wrapper's border + background (→ `glass`) and the
  // text-white/50 (x2) + text-white/85 (x2) + text-white/30 ink sites (all →
  // `text-ink-muted`/`text-ink-secondary`).
  // Was 455 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 3 —
  // baseline-trend-card.tsx migrated 6 text-white/N, bg-white/N and
  // border-white/N sites: the card wrapper's border-white/[0.08] +
  // bg-white/[0.03] (→ `glass`) and four text-white/N ink sites (the
  // eyebrow, the reading row's font-mono wrapper, the unit and the empty
  // state, all → text-ink-muted). All 16 call sites' hex `color`/`bandFill`
  // props do not move this count — this guard only scans Tailwind utility
  // classes, and those were props, not classes; they are the 32 raw colour
  // literals tests/type-scale-guard.test.ts's own header comment already
  // says it cannot see (`color="#a78bfa"` props passed into chart
  // components), now replaced by the four chart tokens in trend-tone.ts.
  // Was 461 occurrences, measured 2026-08-13 after v0.102 (Body slice) task 2
  // migrated 8 text-white/N, bg-white/N and border-white/N sites: 4 in
  // page.tsx's own header markup before it was replaced (bg-white/[0.12] +
  // text-white, and bg-white/[0.04] + text-white/50 + hover:text-white/80 —
  // that one line alone is 3 matches) and the same 4-match shape again in the
  // range-pill row, both now on body-tabs.tsx / range-tabs.tsx's
  // bg-surface-overlay / bg-surface-raised / text-ink-primary /
  // text-ink-muted instead. The streak chip's border-emerald-500/30 and
  // bg-emerald-500/[0.08] moved to border-accent/30 / bg-accent/10 in the
  // same diff but were never ad-hoc WHITE/BLACK alpha, so they don't move
  // this count.
  // Was 469 occurrences, measured 2026-08-13 in v0.101.1 (whole-branch review 2,
  // C1). sidebar-nav.tsx and empty-state.tsx were outside task 12's sweep
  // scope (see the matching correction on "arbitrary type sizes" above) and
  // together carried 10 ad-hoc white-alpha utilities that this patch
  // migrated to the ink scale: 8 in sidebar-nav.tsx (the nav rail's border
  // and fill, the wordmark, the active/inactive item pair, the settings
  // row's border and hover state, and the pinned user row's name) plus 2 in
  // empty-state.tsx (the icon and the message). Was 480 occurrences,
  // measured 2026-08-13 after task 12 migrated 16 text-white/N, bg-white/N
  // and border-white/N sites: plan-style-switch.tsx (6) +
  // season-mode-switch.tsx (8) + bottom-nav.tsx (2). block-sheet.tsx's diff
  // that task was comment-only — its scrim is the one deliberate exclusion,
  // not a migrated site.
  // Was 496 occurrences, measured 2026-08-13 after task 11 migrated 13
  // text-white/N, bg-white/N and border-white/N sites across
  // fitness-tiles.tsx (the tile card, which moved to `bg-surface-overlay`,
  // and the label ink), pmc-chart.tsx (the calibrating message, the Stat
  // block's divider and label ink), fitness-stats-row.tsx (the label ink)
  // and page.tsx's Fitness half (both cards, which moved to `glass`, the
  // legend divider and its ink; the legend's swatch colour itself moved off
  // inline style entirely, onto `bg-chart-1`/`bg-chart-5`/`bg-chart-2`).
  // Was 509 occurrences, measured 2026-08-13 after task 10 migrated 20
  // text-white/N, bg-white/N and border-white/N sites in
  // season-timeline-card.tsx (including the card, which moved to `glass`,
  // and the three stat tiles plus the bar-pair wrapper, which moved to
  // `bg-surface-overlay`; the target/actual bar fills moved to the named
  // `bg-ink-muted`/`bg-chart-2` tokens, not an alpha bucket).
  // Was 529 occurrences, measured 2026-08-13 after task 9 migrated 19
  // text-white/N, bg-white/N and border-white/N sites across
  // history-list.tsx, history-stat-strip.tsx and page.tsx's History half
  // (including both cards, which moved to `glass`, and the row's hover,
  // which moved to `bg-surface-overlay`).
  // Was 548 after task 8 migrated 65 text-white/N, bg-white/N and
  // border-white/N sites across races-section.tsx and
  // plan-preview-card.tsx (including the two cards that were already
  // `glass` and needed no change, and the demand-edit form's tile, which
  // moved to `bg-surface-overlay`).
  // 613 after task 7 migrated 38 text-white/N, bg-white/N and
  // border-white/N sites across the same four availability-intake
  // components (including block-sheet.tsx's sheet panel, which moved to
  // `glass`, and its nested block tile, which moved to `bg-surface-overlay`).
  // 651 after task 6 migrated 18 text-white/N, bg-white/N and
  // border-white/N sites in the same page.tsx chrome (including the
  // skeleton table's own scroll wrapper and the start-week form's card,
  // which moved to `glass`). 669 after task 5 migrated 40 text-white/N,
  // bg-white/N and border-white/N sites across the same four components
  // (including the card wrappers that moved to `glass` and the nested
  // fuelling tile that moved to `bg-surface-overlay`). 709 after task 4,
  // for the same reason task 4 didn't move it — 729 after task 2, 738 after
  // the whole-branch-review fixes, 749 right after slice 1, 806 at slice 0.
  "ad-hoc white/black alpha utilities": 311,
};

function expectRatchet(name: string, pattern: RegExp): void {
  const ceiling = OFFENDER_CEILINGS[name];
  const actual = occurrences(pattern);
  expect(
    actual,
    `${name}: ${actual} occurrences, ceiling ${ceiling}. This count must ` +
      `only ever go DOWN. If you added one, use the type/ink scale instead; ` +
      `the sibling it.fails cannot catch you because it fails either way.`
  ).toBeLessThanOrEqual(ceiling);
  expect(
    ceiling - actual,
    `${name}: the ceiling (${ceiling}) is now ${ceiling - actual} above the ` +
      `real count (${actual}), which is more than RATCHET_SLACK ` +
      `(${RATCHET_SLACK}) — that headroom is free offenders for the next ` +
      `slice. Re-pin OFFENDER_CEILINGS["${name}"] to ${actual}.`
  ).toBeLessThanOrEqual(RATCHET_SLACK);
}

/**
 * This file's own blind spot, closed (Task 6b, 2026-08-11): everything above
 * scans src/**\/*.tsx because Tailwind only compiles classes that appear
 * literally in source — sound for utilities, silent about raw CSS. A
 * `color: rgba(255,255,255,0.4)` inside globals.css's component classes was
 * invisible to it: a light-mode capture run found the "Welcome to Recover"
 * heading unreadable, caused by exactly this class of hardcoded dark-only
 * value living outside the token blocks.
 *
 * ── AND THE HOLE IN THAT CLOSURE (C1, whole-branch review 2026-08-11) ─────
 * The first version of the scan enumerated two `rgba()` spellings plus the
 * literal hex values of the ink/surface tokens. `rgb(255 255 255 / 40%)`,
 * `#ffffff66`, `hsl(0 0% 100%)`, `color-mix(in srgb, white 40%, transparent)`
 * and the bare keyword `white` — which was live in `.nav-active-dot` the
 * whole time — all walked through it. The scan is now syntax-agnostic:
 * src/lib/design/color-literals.ts recognises *that a colour literal is
 * present* from CSS's own closed grammar (any-length hex, colour functions by
 * NAME so every argument spelling is covered, neutral colour keywords) and
 * then judges what it MEANS rather than how it was spelled. See that file's
 * header for why the shape is inverted.
 *
 * Still deliberately scoped to ink/surface, not brand: a literal that reduces
 * to a chromatic colour (there are five today — the two 8%-alpha mesh blooms
 * and `.tag-active`/`.login-input:focus`'s emerald, all pre-existing and out
 * of this task's scope) does not trip this guard. That scope is now derived
 * from the colour itself — achromatic within NEUTRAL_TOLERANCE — instead of
 * from a hand-copied hex list, so it holds for syntaxes nobody has written
 * yet. It is a real, different, smaller bug — not this one.
 *
 * Masking the `:root`/`.dark` blocks is legitimate now that it was not
 * before: tests/contrast-guard.test.ts reads every one of the six blocks and
 * requires every declaration in them to be checked, aliased or waived by
 * name. When this comment was first written that claim was false for four of
 * the six.
 */
const GLOBALS_CSS = readFileSync(CSS_PATH, "utf8");

/**
 * Blanks out every `:root { … }` / `.dark { … }` block, and every `/* … *\/`
 * comment, character by character (newlines preserved) so line numbers in
 * the remaining text still match the real file. Comments must be masked too
 * — this guard's own doc comments quote the historical rgba() values they
 * replaced, which would otherwise self-trigger. A raw colour anywhere left
 * standing after both maskings is a live declaration outside the token
 * blocks, by construction.
 */
function maskTokenBlocksAndComments(css: string): string {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, " ")
  );
  return noComments.replace(/^(?::root|\.dark)\s*\{[\s\S]*?^\}/gm, (block) =>
    block.replace(/[^\n]/g, " ")
  );
}

/**
 * A CSS declaration, anchored to the `{` or `;` that must precede one. This
 * is what separates a *value* from a selector, so `.glass:hover {` and
 * `@media (hover: hover)` are not mistaken for declarations and — the part a
 * line-by-line scan got wrong — the continuation lines of a multi-line value
 * (`.mesh-gradient`'s three stacked gradients) are still read.
 */
const CSS_DECLARATION = /(?:^|[;{}])\s*((?:--)?[-a-zA-Z]+)\s*:\s*([^;{}]*)/g;

function globalsCssOffenders(): string[] {
  const masked = maskTokenBlocksAndComments(GLOBALS_CSS);
  const found: string[] = [];
  for (const m of masked.matchAll(CSS_DECLARATION)) {
    const [property, value] = [m[1], m[2]];
    const valueStart = m.index + m[0].length - value.length;
    for (const literal of findColorLiterals(value)) {
      // Chromatic literals are brand colour, out of this guard's scope. An
      // unparseable one (`oklch()`, `color-mix()`) is an offender: a raw
      // colour nobody can evaluate is exactly what belongs behind a token.
      if (literal.rgba && !isNeutral(literal.rgba)) continue;
      const line = masked
        .slice(0, valueStart + literal.index)
        .split("\n").length;
      found.push(`src/app/globals.css:${line} — ${property}: ${literal.text}`);
    }
  }
  return found;
}

/* ── INLINE `style={{ … }}` (C2) ────────────────────────────────────────────
 * The third path to the screen, and the one that made this file's old
 * soundness claim false. src/lib/design/inline-styles.ts finds the
 * declarations; src/lib/design/color-literals.ts recognises the colours in
 * them — the same module the globals.css scan uses, so both paths learn every
 * syntax at once rather than one of them going stale.
 *
 * Two assertions, because a source scan can make exactly two honest claims
 * about an inline colour:
 *
 *  1. A literal WRITTEN OUT in a text-painting declaration has a determinate
 *     ratio on every declared surface, so it carries the AA floor — measured
 *     worst-case, like every ratio in tests/contrast-guard.test.ts.
 *  2. A value ASSEMBLED AT RUNTIME (`t.color`, `rgb(${style.hue})`) has none,
 *     and no scan can give it one. Those are pinned in an exact inventory
 *     instead, alongside every non-text inline colour and every style prop
 *     this scan cannot read at all — so the set of inline colours cannot grow
 *     without a deliberate edit here, and the ones nothing can check are
 *     written down rather than merely unmentioned.
 */
const TEXT_FLOOR = 4.5; // WCAG 2.2 SC 1.4.3, normal text
const OPAQUE_HEX = /^#[0-9a-fA-F]{6}$/;
const RENDERABLE_THEMES = renderableThemes();
const RESOLVED_TOKENS = resolvedThemeTokens(GLOBALS_CSS);
const RAW_TOKENS = readThemeTokens(GLOBALS_CSS);

/**
 * C1, whole-branch review 2026-08-12: the floor token values themselves,
 * not a copy of them. This used to be a hand-written `SCALE_PX` literal —
 * changing `--text-label` in globals.css could not turn this file red,
 * because nothing here read the CSS. Demonstrated: dropping `--text-label`
 * to 0.625rem (10px) in globals.css and re-running the old literal table
 * produced zero offenders. Parsed fresh out of the `@theme inline { … }`
 * block on every run instead, so it cannot go stale relative to what ships.
 * `readScaleTokens` itself throws on a `--text-*` it cannot resolve to px —
 * see its doc comment in src/lib/design/tokens.ts.
 */
const SCALE_PX = readScaleTokens(GLOBALS_CSS);

/** Every opaque ground a theme declares — what a ratio is measured against. */
function surfacesOf(theme: ThemeName): string[] {
  const hexes = [
    ...new Set(
      Object.entries(RESOLVED_TOKENS[theme])
        .filter(([token]) => roleOfToken(token) === "surface")
        .map(([, value]) => value)
        .filter((value) => OPAQUE_HEX.test(value))
    ),
  ];
  if (hexes.length === 0) {
    throw new Error(
      `no opaque --surface-* token in the ${theme} theme — this guard would ` +
        `measure nothing. tests/contrast-guard.test.ts asserts they exist.`
    );
  }
  return hexes;
}

/** The lowest ratio a literal reaches on any surface of a theme. */
function worstOn(rgba: Rgba, theme: ThemeName): { ratio: number; on: string } {
  let worst = { ratio: Number.POSITIVE_INFINITY, on: "" };
  for (const surface of surfacesOf(theme)) {
    const ratio = contrastRatio(compositeOver(rgba, surface), surface);
    if (ratio < worst.ratio) worst = { ratio, on: surface };
  }
  return worst;
}

/** True when a var() chain lands on a token whose NAME says it carries text. */
function tokenCarriesText(token: string, theme: ThemeName): boolean {
  const chain = resolveToken(RAW_TOKENS[theme], token)?.chain;
  return chain != null && chain.some((t) => roleOfToken(t) === "text");
}

interface InlineSite {
  file: string;
  entry: ReturnType<typeof findInlineStyleEntries>[number];
}

const INLINE_SITES: InlineSite[] = walk(SRC).flatMap((file) =>
  findInlineStyleEntries(readFileSync(file, "utf8")).map((entry) => ({
    file: relative(process.cwd(), file),
    entry,
  }))
);

function inlineTextColorOffenders(): string[] {
  const found: string[] = [];
  for (const { file, entry } of INLINE_SITES) {
    if (entry.kind !== "declaration") continue;
    if (propertyRole(entry.property) !== "text") continue;
    const where = `${file}:${entry.line} — ${entry.property}: ${entry.value}`;
    const { literals, tokens } = styleValueColors(entry.value);
    for (const literal of literals) {
      if (!literal.rgba) {
        found.push(`${where} — ${literal.text} cannot be evaluated`);
        continue;
      }
      for (const theme of RENDERABLE_THEMES) {
        const { ratio, on } = worstOn(literal.rgba, theme);
        if (ratio < TEXT_FLOOR) {
          found.push(
            `${where} — ${literal.text} is ${ratio.toFixed(2)}:1 on ${on} (${theme})`
          );
        }
      }
    }
    for (const token of tokens) {
      for (const theme of RENDERABLE_THEMES) {
        if (!tokenCarriesText(token, theme)) {
          found.push(`${where} — --${token} is not a text token in ${theme}`);
        }
      }
    }
  }
  return found;
}

/** Every colour-valued inline declaration, and every unreadable style prop. */
function inlineColorInventory(): string[] {
  const found: string[] = [];
  for (const { file, entry } of INLINE_SITES) {
    if (entry.kind === "opaque") {
      found.push(`${file} — unreadable style value: ${entry.value}`);
      continue;
    }
    if (propertyRole(entry.property) === null) continue;
    found.push(`${file} — ${entry.property}: ${entry.value}`);
  }
  return found.sort();
}

/**
 * THE RECORD, not a waiver list. Every inline colour in the app, deliberately
 * without line numbers so ordinary edits above one do not churn it — the
 * failure message carries file:line for whatever moved. An entry here is an
 * item slices 1-9 migrate to a token; a NEW entry is a decision someone has
 * to write down.
 *
 * Regenerate by copying the `actual` array out of this assertion's failure
 * message — it is the scan's own output, sorted, so it cannot drift from what
 * the guard reads.
 */
const INLINE_COLOR_INVENTORY: readonly string[] = [
  "src/components/body/sleep-history-strip.tsx — background: s.color",
  "src/components/body/sleep-night-card.tsx — background: s.color",
  "src/components/body/sleep-night-card.tsx — background: s.color",
  "src/components/coach/history-panel.tsx — background: `rgba(${style.hue},0.12)`",
  "src/components/coach/history-panel.tsx — borderColor: `rgba(${style.hue},0.3)`",
  "src/components/coach/history-panel.tsx — color: `rgb(${style.hue})`",
  "src/components/today/today-hero.tsx — boxShadow: `0 0 60px -20px ${BAND_GLOW[band]}`",
  "src/components/train/fitness-tiles.tsx — color: t.color",
  'src/components/train/fitness-tiles.tsx — color: t.contextColor ?? "var(--ink-muted)"',
  "src/components/train/history-list.tsx — background: railColor(a.sport)",
  'src/components/ui/bottom-sheet.tsx — boxShadow: "0 -20px 60px rgba(0,0,0,0.6)"',
  'src/components/week/day-actions.tsx — background: "rgba(139,92,246,0.1)"',
  'src/components/week/day-actions.tsx — borderColor: "rgba(139,92,246,0.3)"',
  'src/components/week/day-actions.tsx — color: "#a78bfa"',
];

describe("type-scale guard", () => {
  // Not an `it.fails` — this pins that the scan actually walked a plausible
  // source tree, rather than silently measuring nothing. `it.fails` cannot
  // tell "scanned everything and found real offenders" apart from "walk() or
  // readFileSync threw / src/ was renamed / SRC resolved to an empty dir" —
  // both report as an expected failure either way. src/ has 392 non-test
  // .ts/.tsx files today; 100 is comfortably below that so this cannot pass
  // vacuously on a handful of files, while staying well clear of flaking on
  // ordinary file-count drift as the app grows.
  it("walks a real, non-trivial source tree", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100);
  });

  // TODO(slice-9): flip to `it(` once the last surface is migrated. Tracked
  // in docs/plans/2026-08-11-v099-slice0-foundations.md. Do NOT delete these
  // — a skipped guard that is deleted is a guard that never lands.
  //
  // This one is paired with a real ratcheted assertion below (I5). On its own
  // it is satisfied by ANY non-empty offender list, so it cannot tell 395
  // offenders from 600 and would stay green for eight slices while the count
  // rose. The ceiling is what actually binds until this flips.
  it.fails("has no arbitrary type sizes — use the scale", () => {
    expect(offenders(ARBITRARY_TYPE), "use text-label … text-hero").toEqual([]);
  });

  it("arbitrary type sizes stay at or below the recorded ceiling", () => {
    expectRatchet("arbitrary type sizes", ARBITRARY_TYPE);
  });

  // TODO(slice-9): flip to `it(` once the last surface is migrated. Tracked
  // in docs/plans/2026-08-11-v099-slice0-foundations.md. Do NOT delete these
  // — a skipped guard that is deleted is a guard that never lands.
  //
  // Same pairing as above: the it.fails proves the goal is not met yet, the
  // ratchet below is the only thing that notices the count moving the wrong
  // way in the meantime.
  it.fails("has no ad-hoc white/black alpha utilities — use the tokens", () => {
    expect(
      offenders(ADHOC_INK),
      "use ink-primary / ink-secondary / ink-muted / hairline / surface-*"
    ).toEqual([]);
  });

  it("ad-hoc ink alphas stay at or below the recorded ceiling", () => {
    expectRatchet("ad-hoc white/black alpha utilities", ADHOC_INK);
  });

  // Unlike the two guards above, this one has zero offenders today — nothing
  // in src/ currently misuses hairline as a text colour — so it is a real,
  // currently-passing assertion rather than an expected failure. Per Step 5:
  // an it.fails that unexpectedly passes is the signal to flip it; this is
  // that flip, done at implementation time instead of at slice-9 time.
  it("never uses hairline as a text colour", () => {
    expect(
      offenders(HAIRLINE_AS_TEXT),
      "hairline is 3.0:1 — legal for dividers and strokes, never for text"
    ).toEqual([]);
  });

  // A real assertion, not it.fails: Task 6b brought globals.css to zero
  // offenders as part of landing this guard, so — unlike the two scale
  // guards above — there is nothing left to grow into. See the block
  // comment above describe() for why src/**/*.tsx scanning alone missed
  // this class of defect for the whole life of the file until now.
  it("has no hardcoded ink or surface colour in globals.css outside :root/.dark", () => {
    expect(
      globalsCssOffenders(),
      "a raw neutral colour — in ANY syntax: hex of any length, any colour " +
        "function, a keyword like `white` — belongs only inside :root/.dark, " +
        "where tests/contrast-guard.test.ts governs it. Reference the token " +
        "with var(--…) from the component class instead"
    ).toEqual([]);
  });

  // A real assertion, not it.fails. The one live offender it found —
  // fitness-tiles.tsx's `rgba(255,255,255,0.4)` context label, 3.77:1 at its
  // worst — is fixed in the same commit that added this, so there is nothing
  // left for it to grow into.
  it(`every inline text colour clears ${TEXT_FLOOR}:1 on every surface it can render on`, () => {
    expect(
      inlineTextColorOffenders(),
      `inline text is measured against every --surface-* token of every theme ` +
        `the app can render (${RENDERABLE_THEMES.join(", ")} — see ` +
        `renderableThemes()). Reference a text token instead: ` +
        `style={{ color: "var(--ink-muted)" }} is the floor, and --hairline ` +
        `is 3.0:1 — never legal on text`
    ).toEqual([]);
  });

  // The other half: what no ratio can be computed for. Pinned exactly, so an
  // inline colour cannot be ADDED without this list being edited on purpose.
  it("has exactly the recorded inventory of inline colours — no more", () => {
    expect(
      inlineColorInventory(),
      "an inline colour was added, changed or moved to another file. If it " +
        "paints text, prefer var(--…) and the assertion above will check it; " +
        "if it cannot be checked (a runtime value, a fill, a shadow), add it " +
        "to INLINE_COLOR_INVENTORY so it is at least recorded"
    ).toEqual(INLINE_COLOR_INVENTORY);
  });

  // The assertion that did not exist before this fix: every parsed scale
  // token held to the floor in its OWN right, independent of whether
  // anything in globals.css currently references it via var(). Without
  // this, a floor token could drop below 12px and nothing here would
  // notice until (if ever) a font-size: var(--text-x) declaration happened
  // to use it.
  it("every --text-* scale token is at or above the 12px floor", () => {
    const offenders = Object.entries(SCALE_PX)
      .filter(([, px]) => px < 12)
      .map(([token, px]) => `${token}: ${px}px`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /**
   * The floor is a property of the app, not of Tailwind. `.label-micro`
   * hardcoded `font-size: 10px` right through slices 0 and 1 — a second,
   * uncoordinated floor that no utility scan could see, backing labels on
   * seven surfaces. This reads every font-size declaration in the file,
   * resolves the ones written as tokens, and holds them all to 12px. An
   * unknown `--text-*` token (typo, renamed, never declared) fails loudly
   * as "unresolvable" rather than silently passing on `undefined < 12`
   * being false.
   */
  it("declares no font-size below the 12px floor in globals.css", () => {
    const css = GLOBALS_CSS;
    const found: string[] = [];
    for (const m of css.matchAll(/^\s*font-size:\s*([^;]+);/gm)) {
      const raw = m[1].trim();
      const line = css.slice(0, m.index).split("\n").length;
      const tokenMatch = /^var\((--text-[a-z-]+)\)$/.exec(raw);
      const px = tokenMatch
        ? (SCALE_PX[tokenMatch[1]] ?? null)
        : /^([\d.]+)px$/.test(raw)
          ? Number(/^([\d.]+)px$/.exec(raw)![1])
          : /^([\d.]+)rem$/.test(raw)
            ? Number(/^([\d.]+)rem$/.exec(raw)![1]) * 16
            : null;
      if (px == null) {
        found.push(`globals.css:${line} — unresolvable font-size: ${raw}`);
      } else if (px < 12) {
        found.push(
          `globals.css:${line} — font-size: ${raw} (${px}px) is below the floor`
        );
      }
    }
    expect(found, found.join("\n")).toEqual([]);
  });
});
