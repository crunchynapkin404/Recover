# Uncertainty vocabulary, telemetry and the design-system doc — design

Design spec, 2026-08-08. Phase 2b.1 and 2b.3 of `docs/ROADMAP.md`, at baseline
`v0.65.0`. Phase 2b.2 (settle the IA) is **deliberately deferred** — see
"Deferred, with a trigger". Phase 2b.4 (visual redesign) is a separate cycle.

## Premise

The goal's third sentence is "when it does not know, it says so." The app says
so in **six dialects**:

| String             | Uses |
| ------------------ | ---: |
| `—`                |   47 |
| `calibrating`      |   39 |
| `insufficient`     |   14 |
| `unknown`          |   13 |
| `limited evidence` |    3 |
| `inconclusive`     |    3 |
| `no data`          |    2 |

plus v0.62's ad-hoc `· limited data`. They are not synonyms — they were each
invented locally, and some of them mean genuinely different things that the UI
renders identically.

This matters beyond tidiness. Phase 2c requires every number slice to satisfy
condition #5: _its "I do not know" state is explicit and rendered._ Six slices
deciding that independently produce six more dialects and then a retrofit. The
vocabulary is a prerequisite, not a parallel nicety.

## This is not a new pattern

v0.46 already solved it for one number, in `src/lib/race/demand.ts:158`:

```ts
| ({ available: true } & EventDemand)
| { available: false; reason: DemandUnavailableReason };
```

A discriminated union with a typed reason. `src/lib/db/projected.ts` supplies
the wrapper-type precedent (`Projected<>`). This spec promotes that shape to
house style rather than inventing one.

## The shape

New module `src/lib/uncertainty.ts`:

```ts
export type Confidence = "low" | "medium" | "high";

export type Unavailable =
  | {
      kind: "calibrating";
      have: number;
      need: number;
      unit: "days" | "nights" | "sessions";
    }
  | {
      kind: "missing_input";
      needs: string;
      fix?: { label: string; href: string };
    }
  | { kind: "not_applicable"; why: string };

export type Figure<T> =
  | { available: true; value: T; confidence: Confidence; why?: string }
  | ({ available: false } & Unavailable);
```

A number's owner returns `Figure<T>`. That turns Phase 2c's condition #5 from
prose into a type obligation the compiler enforces: you cannot return a value
without also stating a confidence, and you cannot suppress one without stating
why.

## Three kinds, distinguished by what the athlete can do

| Kind             | Means                                                | Athlete can             |
| ---------------- | ---------------------------------------------------- | ----------------------- |
| `calibrating`    | Machinery works, history is short. Resolves itself.  | Wait — and see how long |
| `missing_input`  | A required input is absent and will not arrive alone | Fix it, via `fix` link  |
| `not_applicable` | Does not apply here (no race → no race demand)       | Nothing; it is correct  |

`—` is the real offender: 47 placeholders that say nothing. Each becomes a kind
with a reason.

**`failed` was considered and rejected.** A computation that throws is a bug or
an outage, and belongs in an error boundary, not in the figure type — modelling
it invites every consumer to handle a case that indicates something is already
wrong, and invites swallowing the error. Add it only if a legitimate,
recurring, non-bug failure appears; the trigger is a real instance, not a
hypothetical.

## The distinction the current UI gets wrong

Correlations render `inconclusive` in the same grey as `not enough data`.
**Those are opposite claims.** "Inconclusive" over 40 samples means _we looked
and there is no detectable effect_ — a finding, `available: true`, high
confidence. "Not enough data" means we do not know.

Rendering them identically is exactly what the goal forbids, and separating
them is a real behavioural improvement that falls out of the type for free.
`src/lib/insights/correlations.ts` already carries `evidence: "limited" |
"strong"`, so the inputs exist; only the presentation conflates them.

## Rendering

Two primitives, both built on what exists:

- **`<ConfidenceChip level>`** — for `available: true` with `confidence` below
  high. Built on `src/components/ui/badge.tsx`.
- **`<Unavailable state>`** — renders kind, reason, and the optional fix link.
  Inline by default; uses `src/components/ui/empty-state.tsx` for full-panel
  cases.

`src/components/dashboard/calibration-progress.tsx` is live and already does
the calibrating treatment well — it is the model for the `calibrating` kind,
not something to replace.

## Telemetry — ships first

Local-only surface counts, so the deferred IA decision can be made on evidence
instead of recall.

- Table `surface_views`, unique on `(user_id, surface, day)`, one integer counter.
- One helper called after `requireUser()` in each page's server component.
  Explicit call sites rather than proxy interception: `src/proxy.ts` runs for
  assets too, and a DB write there is the wrong place for it.
- **Never leaves the instance.** Included in the existing GDPR export
  (`src/lib/export/export-user.ts`), pruned by the existing scheduler.
- Surfaced owner-only on `/admin`, which already exists.

This does not violate Phase 2's constraint. That constraint bars new _claims_ —
nothing an athlete reads changes, and no figure is added.

## Design-system doc

`docs/design-system.md`, descriptive: the 83 tokens in `src/app/globals.css`,
the 14 primitives in `src/components/ui/`, the IA as built
(Today/Train/Coach/Body/Menu per `src/components/sidebar-nav.tsx`), and the
vocabulary above.

It is the artifact v0.21 and v0.23 were each supposed to leave behind and
neither did — `.superdesign/` is empty. Treated as living: Phase 2c's slices
will push small deltas back into it.

## Deferred, with a trigger

**Phase 2b.2 — settling the IA — is not in this spec.** The user's explicit
call was to question the IA against real usage; the app has no usage telemetry,
so deciding now would be recall dressed as evidence.

Trigger: **four weeks of `surface_views` data**, i.e. on or after 2026-09-05.
The resulting spec must record that the counts are **developer-biased** — the
sole user is also the developer and tester, so the data shows what was being
built, not what an athlete would open. It is better evidence than recall and it
is not clean evidence.

The 12 orphaned components and the `/wellness` stub go with that cycle, since
where a component belongs depends on what the IA turns out to be.

## Non-goals

Scope boundaries for **this spec**, not standing project non-goals — the
roadmap deliberately dropped "no visual redesign" as a global rule.

- **No visual redesign here.** That is 2b.4, its own cycle, informed by this one.
- **No IA changes here**, per above.
- **No new figures.** The vocabulary changes how existing numbers express
  themselves, never what they claim.
- **No telemetry beyond surface counts.** No timings, no events, no funnels.

## Testing

- A guard test that greps the source for the retired dialect strings and fails
  if any return. This is the mechanism that stops dialect seven.
- Per-kind rendering tests for `<Unavailable>` and `<ConfidenceChip>`, asserted
  **at a page**, not only at the component — the v0.62 failure was a component
  proven in isolation that nothing mounted.
- The correlations split gets its own test: strong-but-null must render as a
  finding, thin-evidence as unknown, and they must not read alike.
- Telemetry: a counter test, plus a check that `surface_views` appears in the
  export round-trip drill (`scripts/export-import-drill.sh`).
- Mutation-check the dialect guard and the correlations split per the standing
  rule in `docs/RELEASING.md`.

## Risks

**The migration is wide, not deep.** Roughly 120 string sites move to the new
type. Each is trivial; the risk is a missed one, which the guard test covers,
and a mechanical change that silently alters meaning — particularly the 47 `—`
placeholders, where choosing the wrong kind states something false. Each `—`
needs its call site read, not a bulk replace.

**`Figure<T>` could metastasise.** It belongs on athlete-facing numbers, not on
every internal intermediate. The bound is the roadmap's own definition: a figure
rendered in the UI, injected into coach context, or returned by an MCP tool.

**Telemetry is a new table during a correctness phase.** Justified because the
IA decision is otherwise evidence-free, and bounded hard by the non-goals above.
