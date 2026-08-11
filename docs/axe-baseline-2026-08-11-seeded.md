# Axe baseline, re-measured against a seeded account — 2026-08-11

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
