# Axe baseline, re-measured against a seeded account — 2026-08-11

> **CORRECTED, same day (task-7 review fix).** Everything below this notice
> describes the script as it existed before the review. The review found two
> problems with it: (1) `verify-surfaces.ts` bundled axe's `violations` and
> `incomplete` buckets into one `blocking` count that gated the exit code —
> but on this app's four gradient-background surfaces (today/train/coach/
> body), axe's color-contrast check can **never** resolve, so gating on it
> made "drive the number to zero" permanently unreachable; and (2) a silent
> failure in `captureTokenCreated` could drop that surface from the report
> entirely while the run still exited 0. Both are fixed
> (`scripts/lib/axe-report.ts`'s `splitFindings`; see that file and
> `scripts/verify-surfaces.ts`'s header for the full rationale). **§10 below
> has the current baseline — read that section, not the "44" figure below and
> not §9's now-superseded numbers, when comparing a future slice's numbers
> against this one.**
> The rest of this document is preserved for its account-selection and
> methodology reasoning, which is still accurate — only the metric
> definition changed.

The slice-0 axe baseline (`.screenshots/slice-0/axe-report.json`, 46
serious/critical findings) was captured signed in as `slice0@example.com`,
an owner account with **no activities and no wellness rows**. Today, Train,
Coach and Body rendered onboarding/empty states — the charts, badges, week
rows and data tables where most sub-AA colours actually live were never on
screen, so that baseline was never a real target list for slices 1–8.

This re-measures the same script, same nine surfaces, same two themes and
two viewports, against an account that actually has data.

## Account used

`demo@recover.local`, promoted to `owner` and (re)seeded with
`scripts/seed-demo.ts`'s 90-day synthetic training story:

```bash
export DATABASE_URL="postgres://recover:devpass@localhost:5435/recover" DATABASE_DRIVER=pg
OWNER_EMAIL=demo@recover.local OWNER_PASSWORD=recover-demo npx tsx scripts/seed-owner.ts
SEED_DEMO=1 DEMO_EMAIL=demo@recover.local DEMO_PASSWORD=recover-demo npx tsx scripts/seed-demo.ts
```

Chosen over the real `b.abraas@gmail.com` owner already present in the dev
DB (that account holds actual personal health history, not synthetic data,
and there was no need to touch it), and over minting a new account (this
one is the exact account CONTRIBUTING.md's "Demo data" section already
documents for UI/screenshot work). Result: owner role, 77 activities, 118
wellness rows, 118 computed daily-metrics rows with readiness/CTL/ATL/TSB,
a seeded coach thread. Confirmed by opening the PNGs directly against the
old baseline's: Today went from a bare "Connect a device" card to a full
readiness ring + metric tiles + sparklines; Train went from an empty card
and a "calibrating" badge to a full 7-day plan table with duration/intensity
badges; Body went from empty to three real HRV/RHR/weight trend charts.

## Results

|                                                                     | Old (`slice-0`, empty account) | New (`slice0-seeded-baseline`, seeded owner) |
| ------------------------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| Rule-level findings (the number `verify-surfaces.ts` itself prints) | **46**                         | **44**                                       |
| DOM nodes flagged across all findings                               | 1398                           | **1687 (+289, +20.7%)**                      |

**The rule-count barely moved, and that number is the wrong one to trust.**
`verify-surfaces.ts` counts one row per `(surface, theme, viewport, axe rule
id)`. On the four gradient-background surfaces (today/train/coach/body),
that row was already present in the empty-account baseline — the sidebar
nav sits on the same gradient on every page regardless of data. Real
content doesn't add new rule rows there, it adds more DOM nodes under the
_same_ row, because week-table cells, phase/status badges, and chart labels
use the identical low-opacity-white-on-gradient pattern the nav already
tripped. Counting nodes instead of rows shows what actually happened:

| Surface                   | Old nodes | New nodes | Delta                                                             |
| ------------------------- | --------- | --------- | ----------------------------------------------------------------- |
| **train**                 | 50        | 350       | **+300 (+600%)**                                                  |
| **today**                 | 40        | 136       | **+96 (+240%)**                                                   |
| coach                     | 26        | 47        | +21 (+81%)                                                        |
| body                      | 82        | 106       | +24 (+29%)                                                        |
| admin                     | 586       | 586       | 0 net (2 nodes moved incomplete → confirmed)                      |
| import / login / settings | unchanged | unchanged | 0                                                                 |
| activity-log              | 120       | 116       | −4                                                                |
| settings-token-created    | 336       | 188       | −148 (different account's stale token history, not a data effect) |
| **Total**                 | **1398**  | **1687**  | **+289 (+20.7%)**                                                 |

Example of what the extra 75 flagged nodes on Train (light/desktop, 17→92)
actually are — pulled from the axe report's own node HTML, not
paraphrased:

```
<p class="... text-white/50">marathon training plan · week 1 of 12 · base phase</p>
<span class="... text-white/40">Mo</span> / Tu / We / Th / Fr / Sa / Su
<p class="text-[12.5px] text-white/50">Rest<span class="... text-white/30">~0 min free</span></p>
<span class="... border-white/15 ... text-white/40">provisional</span>
```

## Two real, content-driven changes at the rule level

- **`train`, light theme: +1 confirmed violation.** `<summary
class="... text-emerald-400">+ Add race</summary>` fails `color-contrast`
  outright (not just "incomplete") — only reachable/meaningful once a real
  training week/plan exists to attach it to.
- **`admin`, light theme: same rule count, but 2 more confirmed-violation
  instances** (4 → 6 nodes) of the emerald role-badge contrast issue.

## One likely-noise change, flagged so it isn't misread

`coach` lost the `bypass` (WCAG 2.4.1 skip-link, `incomplete`) finding on
all 4 theme/viewport combinations. `grep -rn -i "skip.to\|skip-link" src`
returns nothing — there is no skip-navigation mechanism anywhere in this
app, on any page, in either run. Since the underlying condition is
identical everywhere and this finding never appeared on the other eight
surfaces in either run, its disappearance reads as axe's own
non-determinism on that specific check, not something seeding fixed.

## Takeaway for slices 1–8

Track both numbers, not just the one `verify-surfaces.ts` prints. Rule-count
is the right gate for "is this surface still flagged at all"
(`process.exitCode = 1` on any finding already enforces that). Node-count is
the truer measure of how much of the _actually-rendered_ UI is implicated —
a slice could drive rule-count to zero while still shipping hundreds of
individually-failing chart labels, badges and table cells that happen to
share a rule id with something already fixed elsewhere on the page.

Full evidence (seed command output, PNG-by-PNG comparison, per-surface/
theme rule tables, node dumps): `.superpowers/sdd/axe-baseline-seeded-report.md`
(not committed — local working notes). Raw screenshots and the full
`axe-report.json` for this run: `.screenshots/slice0-seeded-baseline/`
(gitignored, local only).

## 9. Corrected baseline (task-7 review fix) — the number to use going forward

Everything above predates the fix and mixes two things that should never
have shared one number: axe results it actually computed as failing, and
results it could not compute an answer for at all. `verify-surfaces.ts` now
reports these as two separate, clearly-labelled metrics
(`scripts/lib/axe-report.ts`'s `splitFindings`):

- **`confirmed`** — axe actually computed a failure (every `violations`-
  bucket result, plus `incomplete`-bucket nodes axe nonetheless computed as
  a definite 1:1 ratio). **This is what gates `process.exitCode`.**
- **`indeterminate`** — `incomplete`-bucket nodes axe could not compute an
  answer for at all (composited gradient backgrounds, partially-obscured
  elements, too-short text). Reported, but **never gates the exit code** —
  on this app's four gradient-background surfaces (today/train/coach/body)
  the color-contrast check can structurally never resolve, so gating on it
  would make "drive the number to zero" permanently unreachable no matter
  what a slice fixes. It is still a real, meaningful, trend-to-zero number:
  it counts text with no opaque backing, which is exactly what giving cards
  real surface tokens fixes.

Re-run against the same account/methodology as §1–§8 above
(`demo@recover.local`, seeded, owner role), same nine surfaces, same two
themes, same two viewports:

```
$ SCREENSHOT_BASE_URL=http://localhost:3100 OWNER_EMAIL=demo@recover.local OWNER_PASSWORD=recover-demo \
    npx tsx scripts/verify-surfaces.ts task7-fix-baseline
captured 40 images → .screenshots/task7-fix-baseline
axe report (40 entries) → .screenshots/task7-fix-baseline/axe-report.json

CONFIRMED DEFECTS (gates the exit code): 398 node(s) across 23 rule finding(s), in 19/40 combinations.
INDETERMINATE (does NOT gate the exit code): 1307 node(s) across 40 rule finding(s), in 40/40 combinations.
$ echo $?
1
```

> **SUPERSEDED by §10.** The classification this section's numbers were
> produced with excluded a whole class of real, axe-computed failures (C3).
> §10 re-derives the same measurement with the corrected rule. Its confirmed
> counts turn out identical, for a reason worth understanding — read §10.

**The baseline slices 1–8 should be measured against — lead with the
node counts:**

| Metric                     |    Value | Gates exit code? |
| -------------------------- | -------: | :--------------: |
| Confirmed defect nodes     |  **398** |       Yes        |
| Confirmed defect rule rows |       23 |       Yes        |
| Indeterminate nodes        | **1307** |        No        |
| Indeterminate rule rows    |       40 |        No        |

Per surface/theme (summed across both viewports; dark carries zero confirmed
defects on every surface, consistent with every prior baseline — dark is the
theme this app was actually tuned for):

| Surface                | Theme | Confirmed nodes (rows) | Indeterminate nodes (rows) |
| ---------------------- | ----- | ---------------------: | -------------------------: |
| today                  | light |                 10 (2) |                     58 (2) |
| today                  | dark  |                  0 (0) |                     68 (2) |
| train                  | light |                 62 (4) |                    110 (2) |
| train                  | dark  |                  0 (0) |                    178 (2) |
| coach                  | light |                  9 (2) |                     14 (2) |
| coach                  | dark  |                  0 (0) |                     24 (2) |
| body                   | light |                  1 (1) |                     52 (2) |
| body                   | dark  |                  0 (0) |                     53 (2) |
| settings               | light |                 22 (2) |                     21 (2) |
| settings               | dark  |                  0 (0) |                     43 (2) |
| admin                  | light |                212 (4) |                     10 (2) |
| admin                  | dark  |                  0 (0) |                    364 (2) |
| import                 | light |                 10 (2) |                     12 (2) |
| import                 | dark  |                  0 (0) |                     22 (2) |
| activity-log           | light |                 46 (2) |                     10 (2) |
| activity-log           | dark  |                  0 (0) |                     60 (2) |
| login                  | light |                  4 (2) |                      8 (2) |
| login                  | dark  |                  0 (0) |                     16 (2) |
| settings-token-created | light |                 22 (2) |                     80 (2) |
| settings-token-created | dark  |                  0 (0) |                    104 (2) |

Why this "23+40=63" rule-row total doesn't match the old "44": the split
itself creates more rows where a single old (mixed) row had both confirmed
and indeterminate nodes under one rule id — the 19 mixed cases documented in
`scripts/lib/axe-report.ts`'s doc comment. That is expected, by design, and
is exactly why the node counts (which don't change under the split, only get
correctly bucketed) are the numbers to trust, not a raw row count.

**Both directions of the split are proven, and the proof is committed, not
thrown away this time:** `tests/axe-report-split.test.ts` (fast, hand-built
fixtures matching axe-core's real output shapes) and
`scripts/axe-split-proof.ts` (slow, real headless-Chromium + real axe-core
end-to-end version of the same proof — run it directly to see the exit code
go non-zero for a confirmed defect and stay zero for an indeterminate-only
result).

## 10. Re-derived after the C3 fix (whole-branch review) — the current numbers

§9's `confirmed` bucket required `messageKey === "equalRatio" &&
contrastRatio === 1`: only _perfectly invisible_ text. axe's incomplete branch
also fires on `shortTextContent`, where axe resolved both colours and computed
a failing ratio and the only reason it says "incomplete" is that the text is
one character long. Proven in a real browser before the fix: a page whose sole
defect was a single digit at **3.45:1 exited 0**
(`scripts/axe-split-proof.ts`, case C). `isComputedFailure` now asks the only
question that separates the two situations — **did axe compute a number, and
does that number fail the threshold axe itself reports** — so the same
messageKey can land on either side of the line depending on whether there is a
ratio at all.

Re-run against the same account and methodology as §1–§9
(`demo@recover.local`, seeded, owner role), same nine surfaces, same two
themes, same two viewports:

```text
$ SCREENSHOT_BASE_URL=http://localhost:3100 OWNER_EMAIL=demo@recover.local OWNER_PASSWORD=recover-demo \
    npx tsx scripts/verify-surfaces.ts c3-fix-baseline
captured 40 images → .screenshots/c3-fix-baseline
axe report (40 entries) → .screenshots/c3-fix-baseline/axe-report.json

CONFIRMED DEFECTS (gates the exit code): 398 node(s) across 23 rule finding(s), in 19/40 combinations.
INDETERMINATE (does NOT gate the exit code): 1357 node(s) across 40 rule finding(s), in 40/40 combinations.
$ echo $?
1
```

| Metric                     |    Value | Gates exit code? |           vs §9 |
| -------------------------- | -------: | :--------------: | --------------: |
| Confirmed defect nodes     |  **398** |       Yes        |   0 (see below) |
| Confirmed defect rule rows |       23 |       Yes        |               0 |
| Indeterminate nodes        | **1357** |        No        | +50 (see below) |
| Indeterminate rule rows    |       40 |        No        |               0 |

**Why `confirmed` did not move, stated plainly rather than implied away.** The
widened rule catches nothing on this app _today_. Every one of the 398
confirmed nodes is either an `equalRatio`/1:1 incomplete node (390) or an
ordinary `violations`-bucket node (8, ratios 1.68 and 1.93) — the old rule and
the new rule classify all 398 identically. The app currently has **12
`shortTextContent` nodes and every one of them carries `contrastRatio: 0`**:
they are the one-character avatar initial (`text-white/80`) on the `.glass`
bubble and the header avatars, all sitting on this app's gradient/translucent
backgrounds, which axe cannot resolve. There is nothing yet for the wider rule
to promote.

**Which is exactly why the hole mattered.** Making card backgrounds opaque
`--surface-*` tokens is what slices 1–8 _are_, and an opaque background is
precisely what turns `contrastRatio: 0` into a real number. Every
single-character label the redesign lands on a real surface — `%`, `·`, lone
digits, single-letter weekday and axis labels, the densest content on Train
and Body — becomes an axe-computed ratio at that moment. Under §9's rule those
would all have been filed as "axe could not tell" and the gate would have
stayed green while the app got less readable. The trap was set to spring as
the release did its work.

**Where the +50 indeterminate nodes came from, and it is not the rule.**
Per-surface, this run is identical to §9's table on **18 of 20**
surface/theme rows. The two that moved are `settings-token-created`:
light 80 → 105 and dark 104 → 129, +25 each. That surface's node count scales
with how many rows the account's API-token list renders, and every run of this
script creates four more. Same artifact §1–§8 already recorded in the opposite
direction (−148, "different account's stale token history, not a data
effect"). Nothing else on any surface changed — including Train, whose
`fitness-tiles` context labels changed colour in this same review (C2): they
sit on the gradient, so they were `bgGradient`-indeterminate before and after.

Per surface/theme (summed across both viewports; dark still carries zero
confirmed defects on every surface):

| Surface                | Theme | Confirmed nodes (rows) | Indeterminate nodes (rows) |
| ---------------------- | ----- | ---------------------: | -------------------------: |
| today                  | light |                 10 (2) |                     58 (2) |
| today                  | dark  |                  0 (0) |                     68 (2) |
| train                  | light |                 62 (4) |                    110 (2) |
| train                  | dark  |                  0 (0) |                    178 (2) |
| coach                  | light |                  9 (2) |                     14 (2) |
| coach                  | dark  |                  0 (0) |                     24 (2) |
| body                   | light |                  1 (1) |                     52 (2) |
| body                   | dark  |                  0 (0) |                     53 (2) |
| settings               | light |                 22 (2) |                     21 (2) |
| settings               | dark  |                  0 (0) |                     43 (2) |
| admin                  | light |                212 (4) |                     10 (2) |
| admin                  | dark  |                  0 (0) |                    364 (2) |
| import                 | light |                 10 (2) |                     12 (2) |
| import                 | dark  |                  0 (0) |                     22 (2) |
| activity-log           | light |                 46 (2) |                     10 (2) |
| activity-log           | dark  |                  0 (0) |                     60 (2) |
| login                  | light |                  4 (2) |                      8 (2) |
| login                  | dark  |                  0 (0) |                     16 (2) |
| settings-token-created | light |                 22 (2) |                    105 (2) |
| settings-token-created | dark  |                  0 (0) |                    129 (2) |

Full breakdown of the classification, straight out of this run's
`axe-report.json` — the numbers the two rules disagree about are the
`shortTextContent` row, and it is currently all zeros:

| Bucket        | messageKey            | contrastRatio |  Nodes |
| ------------- | --------------------- | ------------- | -----: |
| confirmed     | equalRatio            | 1             |    390 |
| confirmed     | (none — violation)    | 1.68 / 1.93   |      8 |
| indeterminate | bgGradient            | 0             |   1248 |
| indeterminate | elmPartiallyObscured  | 0             |     55 |
| indeterminate | elmPartiallyObscuring | 0             |     34 |
| indeterminate | **shortTextContent**  | **0**         | **12** |
| indeterminate | imgNode               | 0             |      8 |

**Both directions of the widened rule are proven, in a real browser and in
unit tests:** `scripts/axe-split-proof.ts` now runs five cases, including
**C** (one character, opaque, computed 3.45:1 → confirmed, gates the exit
code) and **D** (the same one character over a gradient, same messageKey,
`contrastRatio: 0` → indeterminate, does not gate). Restoring the old
`equalRatio`-only rule makes case C print `would exit non-zero: false (must be
true)` and the script exit 1.
