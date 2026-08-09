# Uncertainty Vocabulary — Admin / Misc Investigation (Phase 2b.3 close-out)

> **For agentic workers:** This is an investigation report, not an
> implementation plan — verification found no code change warranted on this
> surface (see Findings). No task-by-task execution needed.

**Goal:** Verify the "Admin / misc" backlog item from
`docs/plans/2026-08-08-uncertainty-vocabulary.md`, the seventh and final
surface of Phase 2b.3. If real work is found, migrate it; if not, close
Phase 2b.3 with the reasoning on record.

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`.

## Findings

The original backlog named 3 files: `src/components/admin/security-events.tsx`,
`src/components/coach/artifact-card.tsx`, `src/components/health/health-upload.tsx`
— described only as "em-dash fallbacks," a notably thinner description than
every other surface's (which each named specific retired dialect words like
"calibrating" or "insufficient"). That description turns out to be accurate:
all three are live, but **none contain any of the six retired dialect words**
(`calibrating`, `insufficient`, `unknown`, `limited evidence`, `inconclusive`,
`no data` — confirmed by grep across all three files, zero matches). Each
dash was read individually, per the spec's own "each call site needs to be
read, not a bulk replace" standard:

- **`security-events.tsx`**: `{e.ip ?? "—"}` in a 50-row audit-log list.
  `src/lib/audit.ts`'s `ip?: string | null` is caller-optional — some
  security events (e.g. server-initiated actions) legitimately have no
  client IP to record. This is "not applicable to this event," not "the app
  doesn't know something it should" — the same reasoning that excluded
  `milestones-card.tsx`'s zero-streak dash in the vitals slice. There is
  also no "fix" story: an athlete cannot retroactively supply an IP for a
  past login. Left alone.
- **`artifact-card.tsx`**: `{s.data[i]?.y ?? "—"}` inside `TableChart`, one
  of three chart renderers for AI-coach-generated `ChartSpec` artifacts.
  `src/lib/tools/render-chart.ts`'s Zod schema requires `y: z.number()` —
  the dash only fires when one series in a multi-series chart is shorter
  than another (`s.data[i]` itself is `undefined`), a defensive
  row-alignment fallback for arbitrary tool-generated content, not an
  athlete-facing claim about a known value. This is exactly the kind of
  "internal intermediate" the original plan's Global Constraints already
  ruled out ("`Figure<T>` is bounded to athlete-facing numbers... not every
  internal intermediate — spec's Risks: 'could metastasise'"). Left alone.
- **`health-upload.tsx`**: the per-row extraction-confidence column,
  `r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"` (with
  an existing amber-below-60% treatment). Two reasons this isn't a
  `Figure`/`ConfidenceChip` fit: (1) `Figure`'s `Confidence` is a 3-tier
  categorical (`"low"|"medium"|"high"`), while this is a raw continuous
  percentage from an LLM/OCR extraction — collapsing one to the other would
  invent a threshold not already established, the same discipline that
  kept the vitals and Body/Health slices from inventing confidence tiers
  with no backing signal. (2) The dash here means "this extraction method
  (the plain-text parser) doesn't produce a confidence score at all," not
  "the app doesn't know this specific value's confidence" — a different,
  narrower claim than what the shared vocabulary's `missing_input` names.
  The existing bespoke treatment is already honest (never invents a
  confidence number) and already surfaced via the adjacent
  `"Parsed without a model — double-check the values."` banner one line
  above. Left alone.

All three exclusions match the same category of judgment call the vitals
slice made for `milestones-card.tsx`/`checkin-sheet.tsx` and the
Log/Activity slice made for `laps-table.tsx`: dense, per-row/per-cell
placeholders in tables, not headline athlete-facing claims — read
individually and found to be honest already, or out of this vocabulary's
intended scope, rather than assumed.

**No dead components found on this surface** — all three files are live.

## Conclusion

Phase 2b.3's remaining backlog is now fully investigated: six slices
(v0.67.0–v0.72.0) migrated every real call site found, and every exclusion
across all seven surfaces is justified and on record (this doc plus the six
prior surface plans). Per `docs/ROADMAP.md`'s own definition of the phase —
"one vocabulary replacing six, distinguishing at least: calibrating,
insufficient, low confidence, and no figure plus the reason" — all four
named distinctions have real, shipped call sites: `calibrating`
(correlations, vitals, fitness tiles, Estimated Energy, the morning brief,
coach context), `insufficient`/`missing_input` (vitals, fitness tiles,
`DayActions`, biological age, the morning brief's same-day gap),
`low confidence` (the sleep-debt `ConfidenceChip` in the vitals grid), and
the pre-existing `race/demand.ts` "no figure plus the reason" pattern that
inspired the whole vocabulary, untouched and still standing as the origin
example. Phase 2b.3 is complete — its checkbox is checked as part of this
change. Phase 2c (`docs/ROADMAP.md`) is next in the roadmap's own order,
independent of 2b.4 (visual redesign, still blocked behind 2b.2's IA
settlement).
