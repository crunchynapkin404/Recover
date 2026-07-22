# Recover — Full Design Update: Implementation (v0.21.0 "Design Consistency")

**Date:** 2026-07-22
**Status:** Approved — ready for planning
**Design source:** `docs/specs/2026-07-21-full-design-update-design.md` (the
visual direction, per-page treatment tiers, and honesty principle are fixed
there and are NOT re-decided here).

## Why this document exists

The original full-design-update plan
(`docs/superpowers/plans/2026-07-21-full-design-update.md`) drove the paid
Superdesign CLI to produce mockups on the Superdesign platform, one draft per
page, gated on the user reviewing each canvas. That plan is **abandoned**:
the Superdesign "Personal" team is out of API credits and the user cannot add
more, so no platform drafts can be generated.

The user chose to **implement the redesign directly into the real app**
instead — the "implementation" step the design spec had deferred to "a later
session." This document fixes the framing for that implementation: delivery
phasing, versioning, the review loop, guardrails, and shared primitives. The
visual design itself is unchanged from the approved design spec.

## Goal

Apply the refined dark-glass hybrid language consistently across **every**
route surface (~13), using three patterns applied selectively per the design
spec's tier table:

- **Hero-card + cinematic ring** — Dashboard only.
- **Hairline restraint** — Settings, Health, Admin, Import.
- **Glass-tile stat** — Log, Activity detail, Activity log, Coach, Journal,
  Plan.
- **Standalone auth shell** (already dark-glass) — Login (copy fix), Join.

The app already ships the dark-glass baseline (v0.19 restyled 5 pages; v0.20
added empty states + skeletons everywhere; ~63 components already use
`.glass`/`.mesh-gradient`). This work is therefore **consistency + the three
refined patterns**, not a from-scratch re-theme.

## Honesty guardrails (non-negotiable, inherited from the design spec)

- **Restyle, not rebuild.** No new data, metrics, features, DB migrations, or
  chart-engine changes. v0.20's unified chart grammar is left untouched.
- **The three reference mockups** (`.superdesign/design_iterations/references/`:
  dashboard-2027-evolution, coach-2027, analytics-2027-elite) are **polish
  inspiration only.** Their invented metrics (VO2 "Elite", "Calf Strain 4/10",
  "Coach Aris"), off-palette colors (`#ff6b35` coral, `#84cc16` lime), and
  mobile bottom-tab nav are explicitly **NOT** adopted. Every surface keeps
  the real app's information architecture: desktop top-nav `AppShell`,
  `max-w-5xl` single column, emerald-only (`#10b981`) accent, all real
  features and real metrics.
- **`design-system.md` is the authority**
  (`.superdesign/design-system.md` in the main checkout, gitignored — read via
  absolute path). Any color/font/radius/spacing must come from it; the mockups
  are filtered through it, never copied over it.
- **Accessibility as-you-go** — new/changed UI keeps labels, contrast, focus
  handling, and heading structure (the v0.19 `CollapsibleTrigger` heading fix
  and the v0.20 a11y sweep must not regress).

## Delivery — single release, phased build

One release, **`v0.21.0 — Design Consistency`**, built on one branch
(`worktree-v0.21-design-consistency`, worktree at
`.claude/worktrees/v0.21-design-consistency`, base `main` @ `9f3d9ff`),
phased internally. Each phase is a self-contained cluster of work; after each
phase the user reviews it **locally** (`npm run dev`, eyeballing the real
pages with real data) before the next phase starts. One merge + one tag
`v0.21.0` at the end, per `docs/RELEASING.md` (tag is the last step).

### Phase 1 — Shared primitives + Dashboard (proof-of-pattern)

Extract three shared, independently-testable presentational components from
the existing ad-hoc glass markup, then apply the hero-card pattern to the
Dashboard readiness ring (which today floats on the background with no bounded
container):

- **`HeroCard`** — a bounded rounded (`rounded-[2rem]`) `.glass` container with
  a subtle ambient emerald glow; reserved for the dashboard hero. Props: title
  slot / children; optional glow on/off.
- **`GlassTile`** — a bounded `.glass rounded-2xl` stat tile: `.label-micro`
  caption + value + optional progress bar or sparkline slot. Replaces the
  repeated bespoke stat-tile markup on the dashboard's Recovery/Sleep/Strain
  row (and later the glass-tile tier pages).
- **`Section`** (hairline) — a flat section with a hairline divider
  (`border-white/10`) instead of a boxed card, calmer heading; the building
  block for the hairline tier (Phase 2). Introduced here so Phase 2 reuses it.

Dashboard change: wrap the `HeroReadiness`/`ScoreRing` in `HeroCard`; migrate
its stat row to `GlassTile`. Band-color logic, real readiness/strain values,
`calibrating` empty state, and the honest "Recovery 60 / Strain 0.0 from zero
data" behavior are preserved exactly (no data changes).

Interfaces produced: the three primitives, which Phases 2–4 consume. This is
why Phase 1 goes first — it defines the concrete component API the rest reuse
rather than copy-paste.

### Phase 2 — Hairline tier

Settings (incl. webhooks card), Health (biomarker list), Admin (security
events + sync-jobs panel), Import (GDPR export/import flow). Apply the
`Section` hairline pattern; keep every functional control. Settings keeps its
accordion-per-domain IA (v0.19).

### Phase 3 — Glass-tile tier

Log, Activity detail, Activity log, Coach, Journal (`/journal`), Plan (incl.
empty states). Apply `GlassTile` to stat/metric surfaces; charts and chat
threads unchanged.

### Phase 4 — Auth shells

Login: copy fix only — drop "Forgot Access Key?" / "Secure Protocol" /
"Premium Athlete Edition" language that maps to no real feature (invite-only
Better Auth has no password reset); keep the existing dark-glass visuals.
Join (`/join/[code]`): align to the same standalone mesh-gradient shell and
honest copy.

## Testing & verification

- Existing suite stays green: `typecheck` (tsc), `lint` (eslint), `build`
  (next build), `format:check` (prettier), `test` (vitest).
- The three new primitives get render/unit tests (props → expected classes /
  slots), colocated with the components.
- DB-touching test files keep `describe.skipIf(!hasDb)` so CI (no
  `DATABASE_URL`) skips cleanly rather than crashing — the v0.18 incident
  guard.
- Per-phase structural sanity: run the dev server and `curl` the changed
  routes for expected markers (Next splices `<!-- -->` between JSX text nodes
  — grep accordingly). Port 3000 may be held by an unrelated squatter — bind
  the dev server to an explicit free port for checks.
- No visual-regression/screenshot tooling (headless Chromium can't launch in
  this sandbox). The **user's local review is the visual gate** for each
  phase.

## Execution

Subagent-driven development. Implementer + task-reviewer subagents on Sonnet
5 (per standing preference); the final whole-branch review on the most
capable model. Each phase's tasks are planned in a separate implementation
plan (Phase 1 first, via the writing-plans skill).

## Non-goals

Light theme; new metrics/data/features/migrations; chart-engine rewrite;
adopting the mockups' mobile nav or invented content; restructuring any
page's information architecture. Real-device/browser visual QA beyond the
user's local review.
