# Roadmap and README Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive the completed v0.65-era roadmap, replace it with a short
forward-looking one organised around stability, experience and calibration, and
rewrite a README whose status section is sixty-nine releases stale.

**Architecture:** Documentation only — no code, no tests, no migrations. Three
files change: `docs/ROADMAP.md` is archived and rewritten, `README.md` is
rewritten in place. The verification bar is **factual traceability**, not a
test suite: every claim must trace to code, a workflow file, or the live
demand board.

**Tech Stack:** Markdown, prettier.

**Spec:** `docs/specs/2026-08-24-roadmap-and-readme-reset-design.md`

## Global Constraints

- **No code changes.** If a factual claim turns out to be wrong, fix the
  _claim_, not the code. Discovering a real code defect is a finding to
  report, not to fix in this branch.
- **Every factual claim must be verified before it is written.** This plan
  supplies a verified-facts table (Task 0). Use those numbers verbatim. If a
  number you want to write is not in that table, verify it yourself and say so
  in your report — do not estimate, and do not copy a figure from an existing
  document, because stale figures in existing documents are the reason this
  work exists.
- **The goal statement and the three pillars are copied VERBATIM** from the
  current `docs/ROADMAP.md` (lines 11–39). Do not reword them. They are
  load-bearing and the drift they prevent is exactly the risk of a rewrite.
- **The corrected vote figures come from the structured scrape**, not the
  flattened-text one. The flattened scrape misaligned votes by one row and is
  the error this work corrects; do not re-derive numbers from it.
- **Prettier is enforced.** Run `npx prettier --write` on every file touched.
  Markdown tables frequently need a second pass — run `npm run format:check`
  and re-run `--write` until clean.
- **No document may link to a heading that moved into the archive.** The
  cross-reference sweep in Task 4 is what enforces this.

---

## Task 0 — The verified facts (read-only, no commit)

Not a work task. This is the fact table Tasks 2 and 3 draw from, so that no
implementer has to re-derive a number or is tempted to copy a stale one.

**Current state, verified 2026-08-24:**

| Fact                       | Value                                                                            |
| -------------------------- | -------------------------------------------------------------------------------- |
| Current release            | **v0.119.0**, in production                                                      |
| Tests                      | **2961 passed**, 1 expected fail, 1 skipped                                      |
| Migrations                 | 45 files in `drizzle/`                                                           |
| MCP tool surface           | **59**, frozen (`docs/API-STABILITY.md`)                                         |
| Accessibility              | **0 confirmed axe violations** app-wide                                          |
| Design tokens              | 83, documented in `docs/design-system.md`                                        |
| Engine constant confidence | **102 Low, 16 Medium, 2 High**                                                   |
| Wellness/activity sources  | intervals.icu, Strava, Whoop, Oura, Apple Health, Withings (**6**)               |
| Phase completion           | Phase 1 complete; Phase 2 **24/24**; Phase 3 **7/8**; Phase 4 mostly conditional |
| Never-read field           | `races.resultActivityId` — stored, exposed over MCP, round-tripped, unused       |
| Rollback                   | Designed and documented, **never exercised against prod**                        |
| `docs/ROADMAP.md` length   | 1390 lines                                                                       |
| `README.md` length         | 286 lines; its status section claims **v0.50.0**                                 |
| Existing archive precedent | `docs/archive/ROADMAP-through-v0.65.md`, 1469 lines                              |

**Corrected demand board (structured scrape, 2026-08-24).** Format on the
board is `TITLE · category · comments · votes`:

| Votes | Request                                       | Recover                         |
| ----: | --------------------------------------------- | ------------------------------- |
|   304 | Multiple goals (sub-goals in one plan)        | **Leads** — multi-A-race + A/B  |
|   284 | Integration with intervals.icu                | **Leads** — two-way             |
|   283 | Health data integration (WHOOP/Apple/Garmin)  | **Leads** — six sources         |
|   280 | Training History                              | Has                             |
|   280 | Multiple availabilities per day               | **Leads**                       |
|   199 | Plan activity further in the future           | **Leads**                       |
|   164 | Add running workout                           | Has                             |
|   161 | Choosing new goal before the last is finished | Shipped (v0.114.0)              |
|   155 | Availability beyond one week ahead            | **Leads**                       |
|   155 | Add length filter when browsing workouts      | n/a — no workout library        |
|   125 | Strength training                             | Shipped (v0.119.0)              |
|   123 | Calendar                                      | **Partial — ICS export absent** |
|   107 | Show target cadence in workout                | n/a — no workout player         |
|    65 | Different FTPs indoor/outdoor                 | Shipped (v0.118.0)              |
|    52 | A more specific skills/power profile overview | Partial — power/pace curves     |
|    45 | Landscape mode                                | n/a — no workout player         |
|    33 | Indoor–outdoor switch                         | Partial — see v0.118.0          |
|    33 | Import completed activity FIT files           | Partial — CSV only              |

**The prior error, for the record:** the 2026-08-24 refresh read the number
_preceding_ each title instead of the one following it. It recorded Strength at
155 and Calendar at 125; the true figures are 125 and 123. It also tracked only
the board's "In Review" column, so the 304/284/283/280 rows were absent, and
"Multiple time blocks within a day" was recorded at **7** votes when the board's
equivalent row reads **280**.

---

## File Structure

| Path                                     | Responsibility                                       |
| ---------------------------------------- | ---------------------------------------------------- |
| `docs/archive/ROADMAP-through-v0.119.md` | The completed record. Never scheduled, never edited. |
| `docs/ROADMAP.md`                        | The forward plan only. Target ~150 lines.            |
| `README.md`                              | The project's front door. Rewritten against reality. |

---

### Task 1: Archive the completed roadmap

**Files:**

- Create: `docs/archive/ROADMAP-through-v0.119.md` (via `git mv`)
- Delete: `docs/ROADMAP.md` (recreated in Task 2)

**Interfaces:**

- Produces: the archive path `docs/archive/ROADMAP-through-v0.119.md`, which
  Task 2's new roadmap links to and Task 4 sweeps for.

- [ ] **Step 1: Move the file, preserving history**

```bash
git mv docs/ROADMAP.md docs/archive/ROADMAP-through-v0.119.md
```

Using `git mv` rather than copy-and-delete keeps `git log --follow` working on
the archived content.

- [ ] **Step 2: Add the archive header**

Insert at the very top of `docs/archive/ROADMAP-through-v0.119.md`, above the
existing `# Roadmap` line, matching the framing the v0.65 archive already uses:

```markdown
> **Archived 2026-08-24 at v0.119.0.** This was `docs/ROADMAP.md` from v0.65.0
> through v0.119.0, covering Phases 1–4: the goal and pillars, proving the
> existing numbers correct, and closing the highest-ranked demand gaps. All of
> it is complete.
>
> **It is a record, not a plan — nothing here is scheduled.** The live roadmap
> is [`docs/ROADMAP.md`](../ROADMAP.md). Documents written before this date
> cite this file's contents by line number under its old path; those citations
> resolve here.
```

- [ ] **Step 3: Verify nothing was lost**

```bash
git show HEAD:docs/ROADMAP.md | wc -l
wc -l docs/archive/ROADMAP-through-v0.119.md
```

Expected: the archive is the original line count **plus 9** (the header block).
Any other delta means content was altered — investigate before continuing.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write docs/archive/ROADMAP-through-v0.119.md
npm run format:check
git add -A docs/
git commit -m "docs(roadmap): archive the completed v0.65-v0.119 roadmap

Phases 1-4 are complete. Same move, and same framing, as the v0.65
archive: a record, not a plan."
```

---

### Task 2: Write the new roadmap

**Files:**

- Create: `docs/ROADMAP.md`

**Interfaces:**

- Consumes: the archive path from Task 1; the fact tables from Task 0.
- Produces: `docs/ROADMAP.md` with the section headings `## The goal`,
  `## The three pillars`, `## Where Recover stands`, `## Phase 5 — Stability`,
  `## Phase 6 — Experience`, `## Phase 7 — Learn from results`,
  `## Not scheduled`. **Task 3's README links to
  `docs/ROADMAP.md` and must not link to any heading not in that list.**

- [ ] **Step 1: Recover the goal and pillars verbatim**

```bash
git show HEAD~1:docs/ROADMAP.md | sed -n '11,55p' > /tmp/goal-and-pillars.md
```

That range is `## The goal`, `## The three pillars`, and `### Why this is
written down`. Copy all three sections into the new file **unchanged**, with
two exceptions, both of which are factual corrections rather than rewording:

1. In `## The goal`, the paragraph beginning "The second clause is deliberately
   testable. At v0.65.0 it does not hold: 72 of 77 exported engine constants
   carry no source and no confidence. Phase 2 exists to make it true."
   — replace with a sentence stating that Phase 2 made every constant carry a
   source and a confidence, that **102 of 120 are still Low**, and that Phase 7
   exists to earn the raises. The clause is still testable; what it tests
   changed.
2. Delete the trailing `A proposal that does not serve that sentence does not
belong on this roadmap.` only if it reads oddly after (1); otherwise keep it.
   Prefer keeping it.

- [ ] **Step 2: Write the header**

```markdown
# Roadmap

Current release: **v0.119.0**. History through v0.119 is preserved in
[`docs/archive/ROADMAP-through-v0.119.md`](archive/ROADMAP-through-v0.119.md) —
Phases 1–4, all complete. It is a record, not a plan.

The programme that roadmap encoded — prove the numbers, then close the
ranked gaps — is finished. What follows is organised differently, and the
reason is in "Where Recover stands" below.
```

- [ ] **Step 3: Write `## Where Recover stands`**

Three short paragraphs then the table. The paragraphs state, using only Task
0's verified figures: what is feature-complete; what is mechanically sound
(tests, migrations, axe, tokens, MCP surface, automated release path); and that
the remaining debt is epistemic (102 Low constants; `resultActivityId` stored
and never read).

Then the corrected demand table from Task 0, verbatim, under a note in this
shape — the note is required, and must say the table was wrong, not merely that
it is now right:

```markdown
Board re-read 2026-08-24 with a structured scrape. **An earlier refresh the
same day was wrong** — it read each card's vote count from the row above,
understating some figures and overstating others, and tracked only the board's
"In Review" column. The figures below are per-card (`title · category ·
comments · votes`) across every column.
```

Close the section with the narrow-gap finding: "Calendar" splits into
vacation-planning (led, via availability overrides) and **ICS export**
(absent) — so the one genuine gap is ICS export, not a calendar subsystem.

- [ ] **Step 4: Write the three phases**

Content comes from the spec's Phase 5/6/7 sections. Requirements:

- **Phase 5 — Stability.** Six checkbox items, each a named defect, all
  unchecked: the three parked v0.119.0 doc-accuracy findings; the soak capture
  flakiness (state the evidence — the same surface rendered 5217 px dark and
  3649 px light in one run, and a truncated PNG is indistinguishable from a
  passing one); recording the previous digest in `docs/ENVIRONMENTS.md`;
  rollback never exercised against prod; `scripts/repair-plan-sport.ts`
  refusing two-race plans; triathlon and multi-day pacing refusals never seen
  rendered.
- **Phase 6 — Experience.** Four unchecked items — first run and onboarding,
  information architecture, flow and friction, visual polish and motion. Each
  must say it is a brainstorm → spec → plan cycle in its own right, citing
  Phase 2b as the precedent. Include the ratchet sentence: zero confirmed axe
  violations is a floor no experience work may regress.
- **Phase 7 — Learn from results.** Three unchecked items — compare predicted
  pacing against the result activity; compare demand/feasibility against
  outcome; surface the comparison to the athlete. Include the honesty
  discipline verbatim in substance: a calibration pass that concludes "still
  Low" is a successful pass, citing the taper/transition evidence slices as the
  model. State that it overlaps Phase 6 rather than queueing behind it.

- [ ] **Step 5: Write `## Not scheduled`**

Four items, explicitly uncommitted: ICS export (name the traps — timezones,
recurrence, and a feed URL that is a bearer credential in a query string); MCP
contract freeze; on-ramps for the three dormant-but-kept features; Fitbit /
Google Health direct and Cycle-Aware. One line each. Open the section by saying
these are named so they are not rediscovered, and unscheduled so they are not
promises.

- [ ] **Step 6: Check the length and the links**

```bash
wc -l docs/ROADMAP.md
grep -n "](" docs/ROADMAP.md
```

Target ~150 lines; anything past ~200 means history crept back in — cut it.
Every relative link must resolve from `docs/`. Verify each by hand:

```bash
ls docs/archive/ROADMAP-through-v0.119.md docs/design-system.md \
   docs/API-STABILITY.md docs/RELEASING.md docs/ENVIRONMENTS.md
```

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write docs/ROADMAP.md
npm run format:check
git add docs/ROADMAP.md
git commit -m "docs(roadmap): a forward-looking roadmap

Stability, then experience as the maximum focus, plus one capability
bet: calibrating predictions against race results already stored.
Corrects the demand table, and records that it was wrong."
```

---

### Task 3: Rewrite the README

**Files:**

- Modify: `README.md` (full rewrite, same skeleton)

**Interfaces:**

- Consumes: Task 0's fact table; `docs/ROADMAP.md` from Task 2.

- [ ] **Step 1: Keep what is good**

Read `README.md` first. These stay, essentially unchanged — they are the
strongest parts and rewriting them is not the job:

- The centred logo, title, tagline, and the three badges.
- The four screenshots (`docs/screenshots/*.png`).
- The `## Your Claude, your training data` section and its sample dialogue —
  the MCP-first pitch is the project's real differentiator.
- `## Quickstart`, `## Connect Claude`, `## Stack`, `## License` — verify each
  command and version still matches the repo, correct anything stale, but do
  not restructure.

- [ ] **Step 2: Rewrite `## Features`**

Verify every existing bullet against the code before keeping it. Add strength
training (v0.119.0): per-lift 1RMs, periodized sessions following the plan's
phase, 2×/week dropping to 1× in taper and none on a race week, opt-in — with
no 1RM set the plan is unchanged. Correct any stated MCP tool count to **59**.

- [ ] **Step 3: Replace `## Status & roadmap` entirely**

The current section claims v0.50.0 and carries a highlights trail from
v0.21–v0.50. Delete all of it. Replace with a short section that states the
current release (**v0.119.0**), links to `docs/ROADMAP.md` and to the GitHub
releases page, and says what the project is focused on next in one sentence
(stability, then experience). **Do not restate the roadmap** — a release trail
in a README goes stale by construction, which is precisely how this one reached
sixty-nine releases out of date.

- [ ] **Step 4: Add the competitive claim**

Somewhere prominent — end of the intro or a short section of its own — state
the strongest true thing about the project, which the README does not currently
say: Recover leads or ships nearly every top-ranked row on the largest public
demand board in this category, while staying self-hosted and free.

**Keep it defensible.** Say "leads or ships nearly every top-ranked row", not
"beats" any named product. Link to the board. The one genuine gap (ICS export)
should be findable in the roadmap rather than hidden.

- [ ] **Step 5: Verify every factual claim**

```bash
grep -n "v0\.\|[0-9][0-9]* tools\|[0-9][0-9]* tests" README.md
```

Check each hit against Task 0's table. Any number not in that table must be
verified against the code and the verification named in your report.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write README.md
npm run format:check
git add README.md
git commit -m "docs(readme): rewrite against the current release

The status section claimed v0.50.0, sixty-nine releases stale. Adds
strength training, corrects the tool count, and states the competitive
position the README never made."
```

---

### Task 4: Cross-reference sweep and verification

**Files:**

- Modify: any document found to link into a moved heading (expected: none or
  few)

- [ ] **Step 1: Find every reference to the roadmap**

```bash
grep -rn "ROADMAP" --include=*.md --include=*.ts --include=*.tsx \
  --include=*.yml . 2>/dev/null | grep -v node_modules \
  | grep -v "docs/archive/" | grep -v "^./docs/ROADMAP.md"
```

- [ ] **Step 2: Triage each hit**

Three categories, and they are treated differently:

1. **Dated handoff documents** (`docs/2026-08-*-handoff.md`, `docs/PLAN.md`)
   citing `ROADMAP.md` by line number — e.g. `ROADMAP.md:55`, `:572`, `:581`,
   `:643`. **Leave these alone.** They are dated snapshots citing a dated
   state, and the archive header added in Task 1 Step 2 tells a reader where
   those line numbers resolve. Editing historical handoffs to chase line
   numbers would falsify them.
2. **Live documents** (`docs/RELEASING.md`, `CONTRIBUTING.md`, `README.md`)
   linking to `docs/ROADMAP.md` generally, without a line number — verify the
   link still resolves and the surrounding sentence is still true. `docs/RELEASING.md:70`
   instructs updating `docs/ROADMAP.md` as part of a release; that instruction
   remains correct.
3. **Anything pointing at a specific heading** that no longer exists in the new
   roadmap — fix to point at the archive.

- [ ] **Step 3: Verify the whole set formats and links resolve**

```bash
npm run format:check
```

Then confirm the three files exist and the archive link resolves:

```bash
ls -la README.md docs/ROADMAP.md docs/archive/ROADMAP-through-v0.119.md
grep -c "" docs/ROADMAP.md
```

- [ ] **Step 4: Confirm no code changed**

```bash
git diff --stat main...HEAD -- src/ scripts/ drizzle/ .github/
```

Expected: **empty**. This branch is documentation only. Any output is a
finding — report it rather than continuing.

- [ ] **Step 5: Commit any sweep fixes and open the PR**

```bash
git add -A
git commit -m "docs: fix roadmap cross-references after the archive"
git push -u origin <branch-name>
gh pr create --title "docs: roadmap and README reset" --body "..."
```

CI will run but exercises nothing here beyond `format:check` — a green run
confirms only that nothing else regressed.

---

## Self-Review Notes

**Spec coverage.** D1 (archive + fresh file) → Tasks 1 and 2. D2 (goal and
pillars verbatim) → Task 2 Step 1, with the one factual correction called out
explicitly so an implementer does not silently reword more. D3 (demand demoted
to a scoreboard) → Task 2 Step 3. D4 (three phases) → Task 2 Step 4. D5 (Phase
6 items are spec cycles) → Task 2 Step 4's Phase 6 requirements. D6 (Phase 7
overlaps 6) → same. D7 (not scheduled) → Task 2 Step 5. D8 (README rewrite) →
Task 3. The spec's testing section (factual traceability, format:check, no
links into the archive, figures from the structured scrape) → Task 4 plus the
Global Constraints.

**One thing the spec did not anticipate,** found while writing this plan and
handled in Task 4 Step 2: several dated handoff documents cite `ROADMAP.md` by
**line number** (`:55`, `:572`, `:581`, `:643`). Archiving invalidates those
line numbers. The resolution — leave dated snapshots alone and let the archive
header explain where they resolve — is a judgment call worth a reviewer's
attention rather than a silent edit.

**Placeholder scan.** No TBDs. The prose sections specify structure, required
content and binding facts rather than final wording, which for a
documentation deliverable is the correct level: specifying every word here
would mean writing both documents twice. The facts are exact and binding; the
prose is the implementer's.

**Length target.** ~150 lines for the new roadmap is a target, not a gate; Task
2 Step 6 treats ~200 as the signal that history crept back in.
