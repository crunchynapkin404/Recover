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
> `scripts/verify-surfaces.ts`'s header for the full rationale). **§9 below
> has the corrected, current baseline — read that section, not the "44"
> figure below, when comparing a future slice's numbers against this one.**
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

**This is the baseline slices 1–8 should be measured against — lead with the
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
