# Provenance: final long-tail slice — closing Phase 2a (v0.81.0)

**Date:** 2026-08-10
**Phase:** 2a — Provenance (`docs/ROADMAP.md`)
**Slice:** eighth and final. Closes Phase 2a entirely — no scattered
engine constants remain unsourced after this ships.

## Scope

Re-surveyed the 10 files named in v0.80.0's forward estimate. Two resolve
to zero in-scope constants once checked against the "athlete-facing
number" test and the categorical-mapping exclusion precedent — this
slice's constant count is lower than the ~10-12 estimate, and its file
count is 8, not 10:

`src/lib/coach-memory.ts` (2), `src/lib/recall.ts` (2),
`src/lib/debrief/lifecycle.ts` (2), `src/lib/debrief/ride-review.ts` (1),
`src/lib/race/debrief.ts` (1), `src/lib/weekly-review.ts` (1),
`src/lib/athlete-curves.ts` (1), `src/lib/availability/types.ts` (2). 12
exported constants total.

`src/lib/export/export-user.ts` and `src/components/plan/wheel-column.tsx`
— both named in the v0.80.0 estimate as "to be confirmed" — have zero
in-scope constants; see Out of scope.

## Findings — before writing this doc

- **`coach-memory.ts`** (2): `MEMORY_MAX_ENTRIES` (50) and
  `MEMORY_MAX_CONTENT_CHARS` (280). Source:
  `docs/specs/2026-07-15-v0.4a-coach-core-design.md` — "capped at 50
  entries / ~2000 chars total ... injected as a compact block into the
  system prompt", the original decision bounding prompt size. Both
  **Invented**, Confidence: Low — engineering bounds, not empirically
  derived.
- **`recall.ts`** (2): `RECALL_DEFAULT_LIMIT` (5), `RECALL_MAX_LIMIT` (10).
  Source: `docs/specs/2026-07-19-v0.15-coach-remembers-design.md` —
  "Returns up to `limit` (default 5, max 10) hits ranked by `ts_rank`",
  cited verbatim. Both **Invented**, Confidence: Low — a UX choice for how
  many recall snippets to surface, not a research-backed figure.
- **`debrief/lifecycle.ts`** (2): `DEBRIEF_MIN_DURATION_S` (15 min),
  `DEBRIEF_FRESH_HOURS` (24). Source: same v0.15 design doc — "duration ≥
  15 min becomes `debriefState = 'pending'`" and "started within the last
  24 h — no debrief prompts for historical imports", both cited verbatim.
  Both **Invented**, Confidence: Low.
- **`debrief/ride-review.ts`** (1): `REVIEW_MAX_ATTEMPTS` (3). Governs
  ride-review LLM generation retries specifically (confirmed against its
  call site — the coach-model generation path, not the separate
  best-effort Strava describe step). Source: same v0.15 design doc —
  "capped at 3 attempts, then the thread gets a plain 'review couldn't...'
  ". **Invented**, Confidence: Low.
- **`race/debrief.ts`** (1): `DEBRIEF_NO_DATA_HOURS` (48). Source:
  `docs/specs/2026-07-19-v0.14-race-ready-design.md` — "after 48 h without
  one — the debrief runs exactly once". **Invented**, Confidence: Low.
- **`weekly-review.ts`** (1): `FALLBACK_REVIEW_HOUR` (9). Already carries
  an extensive in-code comment (structurally near-dead: every user gets a
  `notification_prefs` row via `getOrCreatePrefs`, whose column default is
  7, not 9 — this constant is a defensive fallback for a row that in
  practice always exists). This slice adds only the missing explicit
  Confidence sentence, per the same treatment `training-plan.ts` got in
  v0.80.0. No design doc found. **Invented**, Confidence: Low.
  `WEEKLY_THREAD_TITLE` in the same file is excluded — see Out of scope.
- **`athlete-curves.ts`** (1): `CURVES_TTL_MS` (6 h). Source:
  `docs/specs/2026-07-15-v0.4c-mcp-depth-design.md` — "Curves change
  slowly; a TTL cache keeps MCP snappy and respects intervals.icu rate
  limits", an explicit operational trade-off. **Invented**, Confidence:
  Low — same class as v0.78.0's sync/polling domain (operational judgement
  for a free, single-developer API), not a physiological claim.
- **`availability/types.ts`** (2): `MAX_SESSIONS_PER_DAY` (2) and
  `PURPOSE_FLOORS` (`Record<Purpose, number>`, 6 fields: recovery 20,
  aerobic_base 40, threshold 45, vo2max 40, brick 60, long 90). Source:
  `docs/specs/2026-07-27-availability-scheduling-redesign-design.md` —
  "at most two sessions per day" and the per-purpose floor table verbatim.
  Both **Invented**, Confidence: Low — `PURPOSE_FLOORS` is a coaching
  judgment call (a session below its floor "no longer delivers its
  stimulus"), not literature-cited, same treatment as `plan-constants.ts`'s
  `PHASE_SHARE_*` group (one Confidence sentence covering all fields,
  following `ANCHOR_CONSTANTS`'s v0.80.0 precedent for grouped exports).
  `ENERGY_CEILING` and `SUBSTITUTE_TO` in the same file are excluded — see
  Out of scope.

## Global constraints (same as every prior Phase 2a slice)

- **No value changes.** Verified by diffing every `export const NAME = ...`
  value line before and after — must be empty.
- Every touched constant gets an explicit `Confidence: High|Medium|Low[,
qualifier].` sentence. Existing accurate prose is preserved, not
  rewritten — only the missing source/confidence statement is added where
  absent.
- Full test suite must show identical pass counts before/after.

## Out of scope

- **`weekly-review.ts`'s `WEEKLY_THREAD_TITLE`** (`"Weekly Review"`) — a
  thread-matching/display identifier string, not a numeric behavioral
  claim. Same exclusion category as `blood-pressure.ts`'s `BP_LABELS`
  (v0.79.0).
- **`availability/types.ts`'s `ENERGY_CEILING`**
  (`Record<Energy, Purpose[]>`) **and `SUBSTITUTE_TO`**
  (`Partial<Record<Purpose, Purpose>>`) — categorical enum-to-enum/array
  mappings, not numeric claims. Same exclusion category as
  `training-plan.ts`'s `PURPOSE_BY_TYPE` (v0.80.0).
- **`export/export-user.ts`'s `EXPORT_VERSION`** (`1`) — a schema/format
  version integer used only for `import-user.ts`'s round-trip validation;
  never rendered in the UI, injected into coach context, or returned by an
  MCP tool (it does appear inside the raw downloaded export JSON, but as
  format bookkeeping, not a claim about the athlete). Closest precedent:
  the original survey's Vercel route-config exclusion (infrastructure
  bookkeeping, not a tuning knob). Settles the v0.80.0 "to be confirmed"
  note — confirmed out of scope.
- **`components/plan/wheel-column.tsx`'s `ITEM_HEIGHT`** (`40`) — a UI
  layout pixel value for the scroll-wheel picker's row height. Same
  exclusion category as `CHART_TOKENS` (visual/presentation, not a
  behavioral claim). Settles the v0.80.0 "to be confirmed" note —
  confirmed out of scope.

## Remaining Phase 2a backlog after this slice

None. This is the eighth and final slice — every exported engine constant
surveyed since v0.74.0 now carries source, confidence, and scope (or an
explicit, documented exclusion reason). Phase 2a's two roadmap checkboxes
close with this release.
