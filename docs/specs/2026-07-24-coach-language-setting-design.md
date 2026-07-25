# Coach Language Setting — Design

## Problem

The coach's system prompt (`buildBasePrompt()` in `src/lib/coach-persona.ts`)
carries one hardcoded rule at the top: _"reply in the SAME language the
athlete writes in."_ Two problems:

- It's not a choice — an athlete who wants the coach to always speak Dutch
  (say) has no way to pin that; the coach language drifts with whatever
  language the athlete happened to type in that message.
- It only has something to match against in chat. The five proactive/no-input
  surfaces that reuse the same prompt — morning insight, weekly review,
  monthly report, ride debrief review, race debrief — have no athlete text to
  detect a language from, so their output language is an unconstrained LLM
  guess.

## Goals

- A per-user "Coaching language" setting in Settings, next to the existing
  Personality control, using the same dropdown pattern.
- Once set to a specific language, the coach replies in it **everywhere** —
  chat included — even if the athlete writes in a different language. This
  fully replaces the old match-the-athlete's-language rule when set.
- An "Automatic" option (the default, preserving current behavior) for
  athletes who don't want to pin a language.
- Applies to all six coach-output surfaces (chat, morning insight, weekly
  review, monthly report, ride debrief, race debrief) since they all route
  through the same `buildSystemPrompt()`.

## Non-goals

- Translating pre-existing stored content (past chat messages, past
  reviews). Only new generations respect the setting.
- Localizing the app UI itself (buttons, labels, dashboard). This is only
  about the language the AI coach writes in.
- Per-surface language overrides (e.g. Dutch in chat, English in reviews).
  One setting, applies everywhere — no one asked for split behavior.

## Design

### Language list

A new constant, `SUPPORTED_COACH_LANGUAGES`, in `src/lib/coach-persona.ts`:
an ordered array of `{ code, label }`, `code` being the stored value:

```
auto (Automatic), en (English), nl (Dutch), de (German), fr (French),
es (Spanish), it (Italian), pt (Portuguese), pl (Polish), sv (Swedish),
no (Norwegian), da (Danish), fi (Finnish), tr (Turkish), ru (Russian),
uk (Ukrainian), ja (Japanese), ko (Korean), zh (Chinese), ar (Arabic),
hi (Hindi)
```

`label` is what's shown in the dropdown and what's substituted into the
prompt (the full English name reads more reliably for the LLM than an ISO
code). This list is the single validation source — both the Settings
dropdown and the server action import it, so there's no separate allowlist
to keep in sync.

### Schema

Migration 0027 adds `coach_language` to `llm_settings`: `text, not null,
default 'auto'`. Plain text column, not a DB enum (Postgres enum-via-CHECK
churns every time the language list grows; personality's 3-value enum
doesn't have that problem, a 21-value list would). Validity is enforced at
the server-action layer against `SUPPORTED_COACH_LANGUAGES`.

### Prompt rule (`coach-persona.ts`)

`CoachPromptContext` gains `language?: string` (a `code` from the list, or
absent/`"auto"`). `buildBasePrompt()`'s `LANGUAGE RULE` block branches:

- `language` absent or `"auto"` → unchanged: _"You MUST reply in the SAME
  language the athlete writes in. ..."_
- `language` set to a specific code → _"You MUST reply in {Label},
  regardless of what language the athlete writes in or explicitly asks for.
  Never switch to another language."_ — substituting the matched `label`
  (e.g. "Dutch"), not the code.

This block is already the first section of the prompt and is documented as
highest priority, so no change needed to make it win over the personality
preamble or other sections.

### Resolution plumbing

`ResolvedProvider` (`src/lib/llm-provider.ts`) gains `language:
settings.coachLanguage`, set at both existing return sites the same way
`personality` already is (lines ~70 and ~90) — `resolveProvider()` is the
single place every caller gets its settings from, so this is the only place
the DB value is read.

Each of the six `buildSystemPrompt()` call sites (`src/app/api/chat/route.ts`,
`src/lib/morning-insight.ts`, `src/lib/weekly-review.ts`,
`src/lib/monthly-report.ts`, `src/lib/debrief/ride-review.ts`,
`src/lib/race/debrief.ts`) adds one line, `language: resolved.language,`,
next to the existing `personality: resolved.personality,`.

### Settings UI

`coach-card.tsx`'s existing Personality `<form>` gains a second `<Select>`
("Coaching language", options from `SUPPORTED_COACH_LANGUAGES`) inside the
same form, so both fields save in one submit. `saveCoachPersonality` in
`coach-actions.ts` is renamed to `saveCoachSettings` (only referenced from
`coach-card.tsx`, safe to rename) and validates+saves both `personality` and
`language` in one `db.update`.

### GDPR export/import

`export-user.ts` / `import-user.ts` add `coachLanguage: s.coachLanguage` /
`coachLanguage: r.coachLanguage` alongside the existing `coachPersonality`
lines, so the setting round-trips through export/import like every other
`llm_settings` field.

## Error handling / edge cases

- Unknown/stale `code` in the DB (e.g. a language removed from the list in
  a future change): `buildBasePrompt()` looks up the label by code; if not
  found, falls back to the `"auto"` rule rather than injecting an empty or
  garbage label into the prompt.
- Server action receives a `code` not in `SUPPORTED_COACH_LANGUAGES`:
  rejected with the same "Invalid" error pattern personality already uses.
- Existing rows created before migration 0027: covered by the column
  default (`'auto'`), no backfill needed.

## Testing

- `coach-persona.test.ts`: `buildSystemPrompt()` includes the auto rule when
  `language` is absent/`"auto"`; includes the pinned-language rule with the
  correct label when set; falls back to auto on an unrecognized code.
- `coach-actions.test.ts`: `saveCoachSettings` rejects an invalid language
  code, accepts a valid one, persists both fields together.
- `llm-provider.test.ts`: `resolveProvider()` returns `language` from the
  settings row (extends existing personality-resolution coverage).
- Export/import round-trip test: extend the existing `coachPersonality`
  case to also cover `coachLanguage`.
