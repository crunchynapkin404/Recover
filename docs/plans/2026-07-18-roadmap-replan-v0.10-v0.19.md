# Roadmap replan: v0.10 → v0.19

**Date:** 2026-07-18
**Status:** Approved (this document is the rationale; [ROADMAP.md](../ROADMAP.md) is the plan)

## Context

We are at v0.9.6 (absorbing `intervals-icu-mcp`). Everything from v0.1 to
v0.9.5 has shipped. The old roadmap only sketched two future releases —
v0.10 "Deep Biology" and v0.11 "Wearable connectors" — plus three ongoing
tracks (operations, honesty debt, polish backlog) that had no home.

This replan lays out ten versions, v0.10 through v0.19, ending at a place
where the next tag after v0.19 is **v1.0.0**. That end state is the design
constraint: every release below either adds something an athlete can feel or
retires a debt that would embarrass a 1.0.

## What Recover is (the pillars the brainstorm filtered against)

1. **Honesty is the brand.** No fabricated data, `calibrating` over a
   confident wrong number, confidence intervals that admit "inconclusive".
   Any feature that requires inventing a number is out or redesigned.
2. **Depth-first.** Make the daily loop more useful for the athletes already
   running it, then widen who can run it.
3. **Self-hosted, boring operations.** One container + Postgres. No feature
   may require a paid service.
4. **Recovery intelligence, not workout delivery.** intervals.icu and the
   watch handle execution.
5. **Your Claude, your training data.** The coach + MCP bridge is the moat;
   new data should always surface as tools.

## Candidate inventory (divergent pass)

Everything considered, with disposition. Sources: the old roadmap's future
sections, the three ongoing tracks, the "not planned" list (re-examined),
PLAN.md's P7 leftovers, and fresh ideas.

| Candidate                                                                                                                      | Disposition          | Where / why                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Native load engine (TRIMP/TSS + CTL/ATL from any source)                                                                       | **Scheduled**        | v0.10 — the root fix for the two open honesty-debt items; unblocks manual/CSV/wearable athletes and every forecast feature  |
| Recovery/Strain `calibrating` treatment; "This Week" rings                                                                     | **Scheduled**        | v0.10 — the honesty-debt items themselves                                                                                   |
| Whoop + Oura OAuth                                                                                                             | **Scheduled**        | v0.11 — first providers with sleep stages & bed/wake times                                                                  |
| Apple Health export/webhook (cut from v0.8)                                                                                    | **Scheduled**        | v0.11 — promised twice already                                                                                              |
| Withings OAuth (BP, weight, body comp)                                                                                         | **Scheduled**        | v0.11 — new; it's what makes Deep Biology data-backed instead of data-starved                                               |
| Fitbit / Google Health                                                                                                         | **Conditional**      | v0.11 — only if demand shows up (unchanged)                                                                                 |
| Sleep stages / consistency / chronotype cards                                                                                  | **Scheduled**        | v0.12 — earns back what v0.9.0 deleted, now with real data                                                                  |
| Deep Biology (blood tests → biomarkers, bio age, BP)                                                                           | **Scheduled, moved** | was v0.10, now v0.13 — deferred because 0/368 days of BP existed; v0.11 fixes the input side first                          |
| Race calendar, taper engine, readiness forecast, what-if                                                                       | **Scheduled**        | v0.14 — the adaptive week's payoff; needs v0.10's honest load numbers                                                       |
| Cycle-aware readiness                                                                                                          | **Scheduled**        | v0.15 — new; half of athletes have a baseline variable we currently treat as noise, which is fabrication by omission        |
| Coach recall over history (FTS), session debriefs, monthly report                                                              | **Scheduled**        | v0.16 — memory holds facts but can't recall conversations                                                                   |
| Voice input (the dead mic)                                                                                                     | **Scheduled**        | v0.16 — Web Speech API, on-device; wired or finally removed                                                                 |
| Multi-athlete sharing / group view / coach seat                                                                                | **Scheduled**        | v0.17 — "widen who can run it"; the invite system already ships, accounts just can't see each other                         |
| Shareable milestone/race cards                                                                                                 | **Scheduled**        | v0.17 — privacy-safe, server-rendered                                                                                       |
| Sync-jobs admin UI, Prometheus metrics, outbound webhooks (Home Assistant/ntfy), GDPR export, arm64 runners, Vercel+Neon guide | **Scheduled**        | v0.18 — the whole operations track, plus webhooks: a self-hosted app should talk to the rest of the homelab                 |
| Passkeys/2FA, session mgmt, audit log, a11y sweep, upgrade guarantees, MCP schema freeze, security review                      | **Scheduled**        | v0.19 — 1.0 hardening; nothing new, everything trustable                                                                    |
| Weather/heat/altitude context on activities                                                                                    | **Deferred**         | Real value but needs an external API dependency decision; revisit after v0.14 — race-day weather is the natural entry point |
| Embeddings/RAG for coach recall                                                                                                | **Deferred**         | Postgres FTS first (v0.16); embeddings only if FTS demonstrably isn't enough — no vector DB dependency on a hunch           |
| i18n / localization                                                                                                            | **Deferred**         | Real cost across every honest-wording string; post-1.0 unless contributors show up for it                                   |
| Readiness algorithm v2 (ML personal model)                                                                                     | **Rejected**         | Unexplainable scores break pillar 1; the component breakdown is the product                                                 |
| Badges / XP / leaderboards                                                                                                     | **Rejected**         | Re-confirmed v0.9.4's decision — sober milestones only; v0.17's group view shows bands, not rankings                        |
| Nutrition, Garmin direct, SaaS, strength builder                                                                               | **Rejected**         | Unchanged from "Not planned" — reasons still hold                                                                           |
| S3/offsite backups                                                                                                             | **Rejected**         | Re-confirmed v0.9.5's decision: disk loss is the hypervisor layer's job                                                     |

## The arc (convergent pass)

Four movements, dependency-ordered:

1. **Honest foundations** — v0.10. Pay the load-math debt before anything
   consumes it. Forecasting (v0.14) from fabricated CTL would be fabrication
   with extra steps.
2. **Widen the data** — v0.11 → v0.13. Connector framework, then the
   features the new data makes honest (sleep stages, biomarkers). Strictly
   ordered: cards only return after the data exists.
3. **Deepen the intelligence** — v0.14 → v0.16. Race readiness, cycle-aware
   baselines, a coach that remembers. Each stands on movements 1–2.
4. **Widen the people, then harden** — v0.17 → v0.19. Sharing between the
   accounts that already coexist, first-class homelab citizenship, and a
   release that exists so v1.0.0 can be tagged with a straight face.

Dependencies that forced the order:

- v0.10 → v0.14 (forecasts need real load) and v0.10 → v0.11 (wearable
  athletes without intervals.icu need native CTL/ATL to get full readiness).
- v0.11 → v0.12 (stage data) and v0.11 → v0.13 (Withings BP/body comp).
- v0.11 (Oura temperature) helps v0.15 but manual logging suffices — no hard
  dependency.
- v0.19 last, by definition.

Deliberately **not** dependency-driven: v0.15 before v0.16/v0.17 is a value
call — a correctness fix to the score beats new surfaces.

## Risks

- **Connector APIs move** (Whoop v2 migration history, Oura API keys):
  v0.11's framework isolates each provider behind one interface so churn is
  per-file.
- **Ten versions is a long promise.** Same rule as always, stated at the top
  of the roadmap: order shifts if real usage says otherwise. The patch-digit
  history (v0.9.1, v0.9.3) shows unplanned honest-pixel releases will keep
  happening between these.
- **v0.15 needs multiple logged cycles before phase-aware baselines engage**
  — the feature ships with `calibrating` semantics from day one, same as
  readiness did.

## Amendment (same day) — UI/UX pass

The first pass was feature-complete and design-blind. A second look at the
actual UI found the visual layer is fine — the dark glass dashboard already
outdresses most self-hosted apps — but three structural UX gaps existed
nowhere in the plan:

| Candidate                                                                       | Disposition   | Where / why                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| First-run experience (source picker, calibrating progress, first-week guidance) | **Scheduled** | v0.11 — that release makes "choose your data source" a real decision, and the unmanaged 14-day `calibrating` window is where invited users churn |
| Desktop/responsive shell (sidebar ≥lg, multi-column, wider charts)              | **Scheduled** | v0.12 — `app-shell.tsx` caps every page at `max-w-lg` (~512px) with a bottom tab bar even on a monitor; the sleep surfaces need the width        |
| Empty states, skeletons, settings IA, chart grammar, a11y-as-you-go             | **Ongoing**   | New "Ongoing — design & UX" track — continuous small work that never earns its own release; keeps the v0.19 a11y sweep a check, not a cliff      |

Considered and not taken: a dedicated UI/UX release (would push the arc
back a slot for work that is better attached to the releases that need it),
and redesigning the visual language (nothing wrong with it).
