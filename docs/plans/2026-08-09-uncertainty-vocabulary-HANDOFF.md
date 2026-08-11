# HANDOFF — Uncertainty vocabulary (Phase 2b.3), 2026-08-09

**Read this first.** Complete state of play for a fresh session continuing
Phase 2b.3 of `docs/ROADMAP.md`. Three slices have shipped today; the pattern
that works is established; the remaining backlog needs the same
verify-before-planning discipline each prior slice needed.

---

## Where things stand right now

|                 |                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `main`          | `d2ad72c`, tag `v0.69.0`, CI green (checks + docker)                                                                     |
| Release         | `v0.69.0` published, image built (amd64+arm64) and pushed to GHCR                                                        |
| Gate            | `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` — all green, 1607 tests passing |
| Working tree    | clean                                                                                                                    |
| Package version | `0.69.0`                                                                                                                 |

## What's shipped today (v0.67.0 → v0.69.0)

Each is its own plan doc, each already merged — read them for exact code
patterns, don't re-derive:

- **v0.67.0** — `docs/plans/2026-08-08-uncertainty-vocabulary.md`. Shipped
  `src/lib/uncertainty.ts` (`Figure<T>`, `Unavailable`, `Confidence`, the
  `Figure.available/.calibrating/.missingInput/.notApplicable` factories),
  `src/components/ui/confidence-chip.tsx` + `unavailable.tsx`
  (`ConfidenceChip`, `Unavailable`, `unavailableMessage`), fixed the 90-day
  correlations "limited evidence" vs "inconclusive" conflation, added
  `docs/design-system.md` (Phase 2b.1, now complete).
- **v0.68.0** — `docs/plans/2026-08-09-uncertainty-vocabulary-vitals.md`.
  Migrated Today's vitals grid (HRV/RHR/Sleep/TSB). Established the
  `title` + `sr-only` accessibility pattern for compact value tiles (added
  as a review follow-up here — bake it in from the start next time, see
  v0.69.0).
- **v0.69.0** — `docs/plans/2026-08-09-uncertainty-vocabulary-train.md`.
  Migrated Train's fitness tiles (CTL/ATL/TSB) and `DayActions`' preview
  state. Accessibility pattern built in from the first commit this time.

## THE NEXT TASK: continue Phase 2b.3's migration

`docs/ROADMAP.md`'s 2b.3 bullet (read its current exact text — it's been
extended after every slice) tracks the running total. As of v0.69.0: **four
dialects and roughly 11 other call sites remain**, backlog grouped by
surface in `docs/plans/2026-08-08-uncertainty-vocabulary.md`'s Appendix:

- **Body / Health** — `bio-age-card.tsx`, `labs-tiles.tsx`,
  `biological-age.ts`, `race/forecast.ts`, `dashboard/body-battery.tsx`
- **Log / Activity** — `log/pmc-chart.tsx`, `log/wellness-trends.tsx`,
  `activity/laps-table.tsx`
- **Coach / Journal** — `lib/morning-insight.ts`, `lib/coach-context.ts`,
  `journal/journal-form.tsx`
- **Admin / misc** — `admin/security-events.tsx`, `coach/artifact-card.tsx`,
  `health/health-upload.tsx`

**Do not trust this file list at face value.** Two of the last three
surfaces had dead components hiding in it (`correlation-insights.tsx` in
v0.67.0; `hero-readiness.tsx`, `readiness-rings.tsx`, `race-countdown.tsx`'s
component body, `recent-sessions-accordion.tsx`, dashboard's
`vitals-grid.tsx` in v0.68.0 — six total, none in this remaining list yet,
but that's exactly what the last two sessions assumed too). **Re-verify
every file's live/dead status before writing a task around it** — grep for
non-test imports, same as every prior slice did. This has been the single
highest-value step each time; don't skip it to save time.

### Decisions already made — do not re-litigate

1. **Not every `"—"`/`"calibrating"`/`"insufficient"` site is a real
   uncertainty dialect.** Three categories found so far that look like
   candidates but aren't, or aren't proportionate to fix in 2b.3:
   - **A dash meaning zero, not unknown** (`milestones-card.tsx`: a 0-day
     streak renders as `"—"` by UX convention — the app knows the value,
     it's choosing not to print "0"). Converting this would state something
     false. Check what the `null`/fallback branch's condition actually
     means before assuming it's "we don't know."
   - **An interactive control's own current state**, not a claim about the
     world (`checkin-sheet.tsx`'s slider). Form/input state ≠ epistemic
     state.
   - **A terse band-verdict label**, not a value placeholder
     (`today-hero.tsx`'s `BAND_VERDICT.calibrating`, Train's readiness
     header chip). Converting these either adds no value (a one-word label
     already unambiguous in context) or actively duplicates an adjacent
     card that already renders the detailed state accessibly (Today's
     `<CalibrationProgress>`) — `docs/ROADMAP.md`'s Phase 2b checklist
     explicitly asks reviewers to scan for and remove duplicated data.
2. **`trainingBlocks.targetLoadTotal` and `weekPlans.effectiveTarget`
   (a per-week snapshot derived from it at materialization — different
   columns, don't conflate them) are Phase 2c's territory, not 2b.3's.**
   `docs/ROADMAP.md` names this value as 2c's first number slice ("3
   producers... caused four shipped bugs"); `docs/BASELINE.md`'s structural
   lesson #5 is specifically about this stored-vs-recomputed pattern. If a
   new site reads either column, defer it the same way v0.69.0 did — don't
   wrap its rendering in `Figure<T>` before 2c assigns the family one
   owner.
3. **Confidence is `"high"` for direct readings and arithmetic on direct
   readings** (HRV, RHR, sleep, CTL/ATL/TSB) — established across all three
   slices, don't invent a lower tier without a real signal backing it
   (sleep debt's `"none"|"low"|"medium"|"high"` field from
   `computeSleepDebt` is the one place a real graduated signal already
   exists; reuse that pattern if a new site has something similar, don't
   invent one where there isn't).
4. **Nested `<Unavailable>` inside an existing `<Link>` produces invalid
   nested anchors.** Use `unavailableMessage()` directly (a plain string)
   for any tile/row that's already a link, as `vitals-grid.tsx` and
   `correlation-rows.tsx` both do.
5. **Accessibility (`title` + `sr-only` span) goes in from the first
   commit**, not as a review follow-up — v0.68.0 needed a fix-up for this,
   v0.69.0 built it in from the start. Keep doing that.

### Process that worked — repeat it

1. `using-superpowers` → since a design spec already exists
   (`docs/specs/2026-08-08-uncertainty-vocabulary-design.md`), skip
   brainstorming and go straight to `writing-plans`.
2. **Verify live/dead status of every file in the target surface first**
   (see above) — this reshapes scope before you write a single line of
   plan.
3. Write the plan to `docs/plans/YYYY-MM-DD-uncertainty-vocabulary-<surface>.md`,
   following the exact task template the three merged plans use (Global
   Constraints, Files/Interfaces per task, complete code in every step —
   see `docs/plans/2026-08-09-uncertainty-vocabulary-train.md` as the
   cleanest recent example). Self-review it (spec coverage, placeholder
   scan, type consistency), **then immediately run
   `npx prettier --write` on the new plan file** — it will fail
   `format:check` otherwise and this has happened on all three plans so
   far, always caught late.
4. Create a branch (`feat/v0.7X-uncertainty-vocabulary-<surface>`), commit
   the plan, record the base SHA.
5. `subagent-driven-development`: task briefs via the awk one-liner (the
   skill's own `task-brief` script lives on a `vscode-local:` URI not
   reachable from this container's terminal — replicate its logic
   directly):
   ````bash
   awk -v n="$N" '
     /^```/ { infence = !infence }
     !infence && /^#+[ \t]+Task[ \t]+[0-9]+/ {
       intask = ($0 ~ ("^#+[ \t]+Task[ \t]+" n "([^0-9]|$)"))
     }
     intask { print }
   ' "$PLAN" > ".superpowers/sdd/v0XX/task-${N}-brief.md"
   ````
   Workspace dir `.superpowers/sdd/v0XX/` (gitignored via
   `.superpowers/sdd/.gitignore` containing `*`, already present in this
   repo).
6. Dispatch one implementer subagent per task with an **explicit
   `git add <exact files>` list** in the prompt (never just "commit" —
   once left ambiguous, an implementer force-added its own scratch report
   file into history). Model: cheap tier (`GPT-5 mini (copilot)`) for
   mechanical tasks with complete code already in the brief; mid tier
   (`Claude Sonnet 4.5 (copilot)`) for anything touching existing
   files/tests with real integration judgment.
7. Generate a review package per task (`git log`/`diff --stat`/`diff -U10`
   between the task's base and head SHA) and dispatch a task reviewer
   (mid-tier model) — spec compliance + code quality, both verdicts.
   Fix Critical/Important findings (a fix subagent, or directly yourself if
   small and well-understood) and re-verify before moving on.
8. After all tasks: final whole-branch review on the most capable model
   (omit the `model` param to inherit the session's own) — every prior
   slice's final review caught at least one real issue (a discriminated
   union weakened to dodge a type error, a dropped markdown list marker, a
   missing accessibility affordance, a factual conflation between two
   similarly-named DB columns). Budget for this catching something.
9. Push, open a PR with a summary that includes what was migrated, what was
   found-and-excluded (with reasons), and verification evidence. **Pause
   here** — do not merge/tag/release without being asked.
10. On explicit request: merge (`gh pr merge --merge --delete-branch`),
    wait for CI on the merge commit, tag (`git tag -a vX.Y.Z -m "..." <sha>
&& git push origin vX.Y.Z`), wait for the `Release` workflow (verify →
    native amd64+arm64 build → manifest merge), then
    `gh release create vX.Y.Z --notes-file <extract from `git show
    vX.Y.Z:CHANGELOG.md`>` — extract from the **tagged commit**, not the
    working tree, in case anything changed on `main` after tagging.

### Gotchas hit this session, now fixed but worth knowing

- `npm run format` reformats the **whole repo**, not just the files you
  touched — if earlier tasks' files had drift, it sweeps them all into
  whatever commit runs it. Prefer `npx prettier --write <specific files>`
  when fixing a targeted `format:check` failure; reserve whole-repo
  `format`/`format:check` for the final gate run, and if THAT fails on
  files outside the current task, split the fix into its own `style:`
  commit rather than folding it into an unrelated task's commit.
- `github-pull-request_create_pull_request` intermittently needs the `repo`
  parameter passed explicitly (`{"name": "Recover", "owner":
"crunchynapkin404"}`) even though it should infer it from context — if
  the first call 404s, retry with `repo` set.
- Direct `git push` to `main` succeeds even with branch protection's
  required status check configured, if the pushing user has admin rights —
  it prints "Bypassed rule violations" rather than blocking. Don't rely on
  branch protection alone to prevent a direct push; treat "no PR" as a
  deliberate choice to flag, not something the platform prevents.

## Not in scope for 2b.3 — other open roadmap items

- **Phase 2a (provenance)** — source/confidence for 77 exported engine
  constants across 28 files, following `src/lib/plan-constants.ts`. Not
  started at all. Independent of 2b.3; could be picked up in parallel if
  the next session wants a change of pace.
- **Phase 2b.2 (settle the IA)** — was hard-gated until **2026-09-05** (four
  weeks of `surface_views` telemetry from the v0.66.0 live deploy). **That
  gate was lifted on 2026-08-11 (v0.95.0)** at day 4 of the window; 2b.2 is
  open and is the head of the Phase 2 queue. Read `docs/ROADMAP.md` for the
  reading it settles against — this handoff is a point-in-time note and the
  roadmap is the authority.
- **Phase 2b.4 (visual redesign)** — blocked behind 2b.1–2b.3 finishing.
- **feat/v0.65-mcp-contract-hardening** branch — still parked, unreviewed,
  explicitly "must not merge before 2d" per `docs/ROADMAP.md`. Not this
  session's concern, just don't be surprised it's still there.
