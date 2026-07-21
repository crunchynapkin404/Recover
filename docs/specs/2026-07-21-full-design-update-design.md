# Recover — Full Design Update: Design

**Date:** 2026-07-21
**Status:** Planning — implementation deferred until after v0.20 ships; no
roadmap version number assigned yet.

## Goal

Extend the dark-glass visual language across **every page in the app** —
including the five pages v0.19 already restyled (dashboard, coach, log,
journal, settings) and the surfaces it explicitly skipped (login, plan,
activity detail, health, import, admin) — using a single refined hybrid
direction. This document is **planning only**: it fixes the direction, the
design-system changes, and a sequenced execution plan. No Superdesign draft
generation happens in this session; that starts in a later session once this
spec is approved, and only after v0.20-final-sweep ships.

Superdesign project: `feee3bd4-a46d-4c81-93eb-16107ffebbcf`.

## Why now

v0.19 restyled five pages against one Superdesign export
(`docs/flow-export-1784540566598/`) and explicitly left six surfaces
untouched, plus two backlog items open ("empty states"/"skeletons: done for
the 5 pages v0.19 restructured; the rest is still open"). Since then,
`v0.20-final-sweep` (local branch, not yet merged) has added real new UI to
several of those untouched surfaces — a webhooks card on Settings, a
sync-jobs admin panel, a GDPR export/import flow on Import, and empty states
on Plan — none of which have ever gone through a Superdesign pass. Doing one
full-app pass now closes the gap left by v0.19, covers v0.20's new surfaces
before they ship without any design treatment, and gives the app one
consistent look going into v1.0.0 instead of a five-pages-redesigned,
six-pages-original split.

## Principle

Same honesty rule v0.19 set: **this is a restyle, not a rebuild.** No new
data, metrics, features, or migrations. Every design draft reproduces real
data shapes and real copy; placeholder/invented values from any mockup
(fabricated race names, fake counts, decorative toggles) never ship as real
content — they get replaced with the actual value or an honest empty state,
exactly as v0.19 required.

## Visual direction — refined dark-glass hybrid

Confirmed with the user: the shipped **2027 Evolution** dark-glass style
(near-black background, glowing readiness ring, minimal chrome) stays the
structural baseline everywhere — dark-only, no light theme. Three techniques
are borrowed from unused Superdesign explorations already sitting in the
project and applied selectively, not uniformly:

1. **Glassmorphism's bounded hero card + tile progress-bars** — for any page
   whose primary metric currently "floats" on black with no container (the
   dashboard's readiness ring today has no defined boundary).
2. **Storytelling's cinematic focus** — applied **only** to the dashboard's
   readiness ring as the above-the-fold hero moment. Not applied elsewhere,
   so every page isn't competing to be "the" hero.
3. **Scandinavian Minimal's hairline restraint** — hairline dividers instead
   of boxed cards, calmer type hierarchy — applied to the denser
   lookup/config pages (Settings, Health, Admin, Import), where a glowing
   hero treatment would fight the page's actual job.

Two directions considered and rejected: a real light-theme toggle (bigger
scope, reopens a v0.19 non-goal with no stated user need) and per-page
archetype matching, i.e. letting different pages fully adopt different
explored directions rather than one shared language (best per-page fit, but
risks the app feeling like several stitched-together products).

## Scope — all 11 route surfaces

| Route | Current state | New in v0.20-final-sweep |
|---|---|---|
| `/` (Dashboard) | v0.19-restyled | — |
| `/coach` | v0.19-restyled | — |
| `/log` | v0.19-restyled | shared chart-grammar refactor |
| `/wellness` (Journal) | v0.19-restyled | journal-form changes |
| `/settings` | v0.19-restyled | **new webhooks card** |
| `/login` | never restyled (unused draft exists) | — |
| `/plan` | never restyled (unused draft exists) | **new empty states** |
| `/activity/[id]` | never restyled | shared chart-grammar refactor |
| `/health` | never restyled | biomarker-list changes |
| `/import` | never restyled | **new GDPR export/import flow** |
| `/admin` | never restyled (page didn't exist pre-v0.18) | **new sync-jobs panel** |

## Per-page treatment

| Page | Primary treatment |
|---|---|
| Dashboard | Cinematic hero ring (Storytelling) + glass hero card (Glassmorphism) |
| Login | Dark-glass as-is — an unused draft (`19b8dc93`) already matches the shipped style; needs copy fixed to match the real invite-only Better Auth flow (drop "Forgot Access Key?" / "Secure Protocol" language that doesn't correspond to any real feature) |
| Coach, Journal, Plan | Light glass-tile touch-up only, no major restructure — Plan already has an unused production-ready draft (`934e5b02`) close to target |
| Settings, Health, Admin, Import | Hairline restraint (Scandinavian) layered over dark-glass tokens — denser, config/lookup-oriented pages |
| Log, Activity detail | Glass-tile stat cards (Glassmorphism) for chart/stat surfaces; keep v0.20's already-unified chart grammar untouched |

## Design system changes needed

`.superdesign/design-system.md` is stale (written 2026-07-14, before v0.19
shipped) — it still describes the old grayscale/no-shadow look, not the
dark-glass tokens actually live today. `.superdesign/init/` is equally stale.
Before any draft generation:

1. Re-run Superdesign init against the current `main` codebase to regenerate
   `components.md`, `layouts.md`, `routes.md`, `theme.md`, `pages.md`,
   `extractable-components.md`.
2. Rewrite `design-system.md` to capture: the real shipped dark-glass tokens,
   the new hero-card/glass-tile component pattern, the hairline-divider
   convention for dense pages, and the cinematic-hero pattern reserved for
   the dashboard ring only.

## Confirmed decisions (made with the user)

- **Scope is every page**, including the five v0.19 already restyled — not
  just the six it skipped.
- **Direction is the hybrid (Approach A)** — refined dark-glass baseline
  with three borrowed techniques applied selectively — not a light-theme
  two-mode system, not per-page archetype matching.
- **This session produces the spec and execution plan only.** No Superdesign
  CLI draft generation happens today.
- **Reproduction source for the four v0.20-touched surfaces** (Settings'
  webhooks card, Admin's sync-jobs panel, Import's GDPR flow, Plan's empty
  states) is the `v0.20-final-sweep` worktree
  (`.claude/worktrees/v0.20-final-sweep`), not `main` — that branch is where
  the real code for those surfaces currently lives, and `main` doesn't have
  it yet.

## Explicitly not carried over / Non-goals

- No light theme.
- No new data sources, metrics, coach tools, or database migrations —
  presentation only, same rule as v0.19.
- No chart-engine changes — v0.20-final-sweep already unified the chart
  grammar (the roadmap's long-open "Chart consistency" item); this pass only
  restyles wrappers on the pages that don't have the treatment yet.
- No Superdesign draft generation in this session — planning only.
- No implementation of any kind before v0.20-final-sweep merges.

## Execution plan (for later sessions)

1. Re-run Superdesign init (stale since 2026-07-14) against current `main`.
2. Rewrite `.superdesign/design-system.md` per the section above.
3. Per page: pixel-perfect reproduction first (Superdesign Step 3a), then 2
   branch variations exploring the hybrid treatment (Step 3b). For the four
   v0.20-touched surfaces, pull context files from the
   `v0.20-final-sweep` worktree, not `main`.
4. Suggested page order:
   - **Dashboard** first — proves the cinematic-hero + glass-card pattern
     that everything else's "no major restructure" tiers depend on reading
     correctly, and it's the highest-visibility page.
   - **Settings, Health, Admin, Import** next — share the hairline-restraint
     pattern and the new v0.20 surfaces; doing them together keeps that
     pattern consistent across all four in one pass.
   - **Log, Activity detail, Coach, Journal, Plan** next — lowest-change
     tier (glass-tile touch-up only).
   - **Login** last — mostly a copy fix on an existing draft, not a new
     visual pass.
5. Each page's output is presented to the user via the Superdesign canvas
   URL for feedback before moving to the next page, per the Superdesign
   skill's standard flow.

## Risks

- **11-page scope is large.** Real risk of scope creep or fatigue across
  what will necessarily be several sessions. Mitigated by the phased order
  above and by treating each page as its own checkpoint rather than batching
  approvals.
- **`v0.20-final-sweep` isn't merged yet.** If its code changes materially
  before merge, context files pulled for the four v0.20-touched surfaces
  could go stale. Mitigated by re-reading the worktree's current state at
  execution time for each page, not caching content now.
- **Stale init/design-system inputs.** Mitigated by re-running init and
  rewriting the design system before any page work starts (Execution steps
  1–2), so no page is designed against outdated tokens.
