# Per-user isolation & input audit — 2026-07-20

Task 8 of the v0.18 security-hardening slice. Exhaustive pass over every
route handler, server action, MCP tool, OAuth callback, and webhook, plus a
re-confirmation of the LLM biomarker-extraction and file-upload paths flagged
in the spec. Goal: every surface either scopes all reads/writes to the
authenticated principal (never a client-supplied user/owner id), or is
explicitly and correctly unauthenticated by design (signup, health probe).

**Result: no gap found.** Every surface below is `✅ confirmed`. Step 4 of
the task brief ("fix any real gap found") has nothing to do this round.

## Methodology

For each surface: read the handler/action/tool, trace every DB query and
every id that reaches a `WHERE`/`.values()` clause back to its source, and
confirm that source is either `requireUser()` (server actions, session
routes), `auth.api.getSession()` (session routes that don't use the
`requireUser()` wrapper), `authInfo.extra.userId` via the MCP dispatch
chokepoint (`src/lib/mcp/server.ts`), a cron/ingest shared-secret, or an
OAuth state cookie — never a client-supplied `userId`/`ownerId`/`athleteId`
parameter. Confirmed via a mix of full reads, a repo-wide grep for any
`args.*userId`-shaped scoping input (none found), and a heuristic sweep for
write statements with zero `userId` references in the containing file (one
hit, `admin/actions.ts`, investigated and explained below — not a gap).

Three surfaces got a live regression test proving cross-user denial
end-to-end against Postgres (brief Step 3's "at least" list): MCP tool
scoping, the export endpoint, and one representative server action.

## Route handlers (`src/app/api/**/route.ts`)

| Route                                                          | Auth                                                                                                                  | Scoping                                                                                                                                                                                                                                  | Status                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /api/health`                                              | none (by design)                                                                                                      | no user data — DB liveness probe only, documented in-file                                                                                                                                                                                | ✅ confirmed                                        |
| `GET /api/sync/now`                                            | session (`getSession`)                                                                                                | `connections` query filtered by `session.user.id`                                                                                                                                                                                        | ✅ confirmed                                        |
| `GET /api/export`                                              | session (`getSession`)                                                                                                | all 4 tables (`wellness_daily`, `activities`, `daily_metrics`, `chat_threads`) filtered by `userId`                                                                                                                                      | ✅ confirmed (test: `tests/export-scoping.test.ts`) |
| `GET/POST /api/chat/threads`                                   | session                                                                                                               | `chatThreads` filtered by `session.user.id`                                                                                                                                                                                              | ✅ confirmed                                        |
| `POST /api/chat`                                               | session                                                                                                               | thread create scoped to `userId`; thread reuse checks `thread.userId !== userId` → 404 before use; `buildAiSdkTools({ userId, ... })` passes the authenticated id into the full tool registry                                            | ✅ confirmed                                        |
| `POST /api/cron`                                               | `CRON_SECRET` via constant-time `timingSafeEqual` (hashed first so lengths match)                                     | no per-user data — triggers the scheduler tick for all connections                                                                                                                                                                       | ✅ confirmed                                        |
| `POST/GET /api/mcp`                                            | Bearer token → `resolveToken()` → `tokenInfo.userId`, rate-limited per token, resolved _before_ `handleRequest`       | `authInfo.extra.userId` is the sole per-request identity handed to every tool                                                                                                                                                            | ✅ confirmed (test: `tests/mcp-security.test.ts`)   |
| `POST/DELETE /api/push/subscribe`                              | session (`sessionUserId()` wrapper)                                                                                   | insert/delete scoped by `userId`; `endpoint` is client-supplied but not a cross-user identifier (push registration id, not data)                                                                                                         | ✅ confirmed                                        |
| `GET /api/connections/{withings,google,whoop,strava}`          | session                                                                                                               | redirects to `/login` if none; writes an httpOnly, `sameSite=lax`, path-scoped OAuth-state cookie                                                                                                                                        | ✅ confirmed                                        |
| `GET /api/connections/{withings,google,whoop,strava}/callback` | session + state-cookie match                                                                                          | `connections` upsert scoped to `session.user.id`; rejects on missing/mismatched state before any token exchange                                                                                                                          | ✅ confirmed — see OAuth callbacks table below      |
| `POST /api/connections/apple-health/ingest`                    | per-user ingest token (`X-Recover-Token` / `?token=`), SHA-256 hash looked up against `connections.externalAthleteId` | resolves `userId` from the matched connection row, never from client input; 10 MB byte cap enforced before token lookup (declared-length early-out → token presence → capped read → hash lookup → parse), matching Task 3's ordering fix | ✅ confirmed                                        |

## Server actions (`"use server"` files under `src/app`)

One row per file; each file's every exported action was read. All but one
gate on `requireUser()` (or `requireOwner()`, itself `requireUser()` +
role check) before touching the DB, and every write/read is scoped to the
resolved `user.id`.

| File                               | Actions                                                                                                                | Auth                                                | Notes                                                                                                                                                                                                                                                                                                             | Status                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `wellness/actions.ts`              | `logWellness`                                                                                                          | `requireUser`                                       | delegates to `upsertWellness(user.id, …)` — see dedicated note below                                                                                                                                                                                                                                              | ✅ confirmed (test: `tests/wellness*.test.ts` pre-existing + upsertWellness trace below)                                           |
| `import/actions.ts`                | `importWellnessCSV`, `importActivityCSV`                                                                               | `requireUser`                                       | per-row writes scoped to `user.id`; 5 MB cap                                                                                                                                                                                                                                                                      | ✅ confirmed                                                                                                                       |
| `health/actions.ts`                | `extractAction`, `saveBiomarkers`, `saveBloodPressure`, `setBirthYear`                                                 | `requireUser`                                       | `extractAction` persists nothing (review-before-save, see LLM note below); 15 MB file cap                                                                                                                                                                                                                         | ✅ confirmed                                                                                                                       |
| `activity/log/actions.ts`          | `logActivity`                                                                                                          | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `activity/debrief-actions.ts`      | `submitDebrief`, `skipDebrief`                                                                                         | `requireUser`                                       | both gated by `pendingActivity(userId, activityId)` (requires ownership _and_ `debriefState = "pending"`) before any write or before invoking `generateRideReview` — see dedicated note below                                                                                                                     | ✅ confirmed (test: representative pattern covered by `tests/server-action-isolation.test.ts`)                                     |
| `plan/actions.ts`                  | `startWeek`, `submitAvailability`, `addRace`, `removeRace`, `setRaceStatus`, `previewPlanChange`, `applyPlanChange`    | `requireUser`                                       | all delegate to service-layer functions taking `user.id` as an explicit first argument                                                                                                                                                                                                                            | ✅ confirmed (test: `tests/server-action-isolation.test.ts` — `removeRace` cross-user denial, chosen as the representative action) |
| `settings/actions.ts`              | `connectIntervals`, `syncNow`, `disconnectIntervals`                                                                   | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/body-actions.ts`         | `setBodyPrefs`                                                                                                         | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/llm-actions.ts`          | `saveLlmSettings`, `deleteLlmSettings`                                                                                 | `requireUser`                                       | API keys encrypted at rest, scoped to `user.id`                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/withings-actions.ts`     | `withingsSyncNow`, `withingsDisconnect`                                                                                | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/whoop-actions.ts`        | `whoopSyncNow`, `whoopDisconnect`                                                                                      | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/strava-actions.ts`       | `stravaSyncNow`, `stravaDisconnect`, `setAutoDescribeStrava`, `setStravaDescriptionFields`, `previewStravaDescription` | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/oura-actions.ts`         | `connectOura`, `ouraSyncNow`, `ouraDisconnect`                                                                         | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/apple-health-actions.ts` | `enableAppleHealth`, `disableAppleHealth`, `uploadAppleHealthFile`                                                     | `requireUser`                                       | ingest token minted per-user; `uploadAppleHealthFile` reuses the same bounded `ingestAppleHealth()` parser as the webhook (25 MB cap, session-gated so a lower-exposure surface than the public webhook)                                                                                                          | ✅ confirmed                                                                                                                       |
| `settings/debrief-actions.ts`      | `setRideDebriefs`, `setDebriefPush`                                                                                    | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/push-actions.ts`         | `setMorningPush`, `sendTestNotification`                                                                               | `requireUser`                                       |                                                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/coach-actions.ts`        | `saveCoachPersonality`, `updateMemoryAction`, `deleteMemoryAction`                                                     | `requireUser`                                       | memory rows scoped to `user.id`                                                                                                                                                                                                                                                                                   | ✅ confirmed                                                                                                                       |
| `settings/token-actions.ts`        | `createApiToken`, `revokeApiToken`                                                                                     | `requireUser`                                       | `createApiToken` whitelists requested scopes against a fixed list (no arbitrary scope injection); `revokeApiToken` re-selects the token by `(id, userId, not revoked)` before revoking                                                                                                                            | ✅ confirmed                                                                                                                       |
| `admin/actions.ts`                 | `createInvite`, `revokeInvite`                                                                                         | `requireOwner` (`requireUser` + `role === "owner"`) | `revokeInvite`'s delete isn't itself `userId`-scoped — investigated: `ensureOwnerSeeded()` only ever seeds a single owner per instance (self-hosted, single-household model; seeding is a no-op once any user exists), so there is structurally one owner and all invites belong to them. Not a cross-tenant gap. | ✅ confirmed                                                                                                                       |
| `join/[code]/actions.ts`           | `join`                                                                                                                 | **none** — intentional                              | this _is_ the account-creation path (redeem an invite code into a new account); protected by invite-code validity/expiry/single-use + email-uniqueness checks in `redeemInvite`, not session auth                                                                                                                 | ✅ confirmed (unauthenticated by design)                                                                                           |

### `upsertWellness` (`src/lib/wellness-write.ts`)

Shared by `log_wellness` (MCP tool), `wellness/actions.ts#logWellness`, and
`import/actions.ts#importWellnessCSV`. Takes `userId` as an explicit first
parameter — never reads it off the input payload — and every call site
passes an authenticated id (`ctx.userId` from the MCP dispatch chokepoint, or
`user.id` from `requireUser()`). The upsert's conflict target is
`[userId, date]`; `date` is client-supplied but is not an identifier that
crosses users. ✅ confirmed clean, no gap.

## MCP tools (`src/lib/tools/*.ts`)

Every tool's `execute(args, ctx)` was checked for any scoping input other
than `ctx.userId`. Repo-wide grep for `args.userId` / `args.athleteId` /
`args.ownerId`-shaped parameters used as a scoping id: zero hits. `ctx` is
constructed in exactly two places, both traced to an authenticated identity:
`src/app/api/mcp/route.ts` (`authInfo.extra.userId` from the Bearer-token
resolution) and `src/app/api/chat/route.ts` / `src/lib/debrief/ride-review.ts`
(the in-app coach chat / ride-review paths — see note below).

23 of the tools (`icu_*`) share one chokepoint, `activeIcuConnection(ctx)` in
`src/lib/tools/icu-connection.ts`, which resolves the user's intervals.icu
connection strictly via `eq(connections.userId, ctx.userId)`. No `icu_*` tool
accepts or uses any other id to pick a connection.

| Tool(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Scoping                                                                                                                  | Status                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delete-race`, `describe-strava-activity`, `forget`, `generate-training-plan`, `get-activity`, `get-athlete-profile`, `get-best-efforts`, `get-biomarkers`, `get-calendar-availability`, `get-fitness-summary`, `get-pace-curve`, `get-plan-drift`, `get-planned-workouts`, `get-power-curve`, `get-races`, `get-readiness-history`, `get-readiness`, `get-training-load-summary`, `get-training-plan`, `get-week-plan`, `get-wellness`, `list-activities`, `log-wellness`, `recall-history`, `remember`, `set-week-availability`, `simulate-plan-change`, `update-training-plan`, `upsert-race`  | `ctx.userId` used directly in every DB query                                                                             | ✅ confirmed (test: `get_readiness` isolation in `tests/mcp-security.test.ts` — chosen as the representative depth tool since it's parameter-less, exercising the dispatch chokepoint directly rather than an id the tool itself could gate on) |
| `icu-add-activity-message`, `icu-apply-training-plan`, `icu-bulk-create-events`, `icu-bulk-delete-events`, `icu-create-event`, `icu-delete-event`, `icu-duplicate-events`, `icu-get-activity-intervals`, `icu-get-activity-messages`, `icu-get-calendar-events`, `icu-get-event`, `icu-get-gap-histogram`, `icu-get-hr-histogram`, `icu-get-pace-histogram`, `icu-get-power-histogram`, `icu-get-sport-settings`, `icu-get-workout-library`, `icu-get-workouts-in-folder`, `icu-search-activities`, `icu-update-activity`, `icu-update-event`, `icu-update-sport-settings`, `icu-update-wellness` | `activeIcuConnection(ctx)` → `eq(connections.userId, ctx.userId)`                                                        | ✅ confirmed                                                                                                                                                                                                                                    |
| `get-workout-syntax`, `render-chart`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | no `ctx`/`db` access at all — pure stateless formatting/reference tools over caller-provided arguments, nothing to scope | ✅ confirmed (not applicable)                                                                                                                                                                                                                   |

### Dual tool-invocation entry points

Tools run in two contexts, not just the external MCP endpoint:

- `src/app/api/chat/route.ts` (in-app coach chat) — `userId` from
  `session.user.id`; thread ownership re-checked before reuse.
  `buildAiSdkTools({ userId, ... })` exposes the _full_ registry.
- `src/lib/debrief/ride-review.ts` (automated ride-review generation) —
  `buildAiSdkTools({ userId: a.userId, db })` where `a` is a Drizzle-selected
  `activities` row, exposing _only_ `remember_fact` (filtered by name), not
  the full registry. Traced `a`'s origin: `generateRideReview(activityId)`
  fetches the activity by id alone (no `userId` filter in that specific
  query) and derives `a.userId` from the row itself. This function has
  exactly two call paths: `src/lib/debrief/lifecycle.ts` (internal
  background sweep, not client-reachable) and
  `src/app/activity/debrief-actions.ts#submitDebrief`/`skipDebrief`, both of
  which only reach `generateRideReview(activityId)` _after_
  `pendingActivity(userId, activityId)` has already proven that exact
  `activityId` belongs to the calling session's `userId`. So the unscoped
  lookup inside `generateRideReview` never runs against an id a client could
  point at another user's row — it's reachable only with an id whose
  ownership was already verified in the same request, or from the trusted
  background job. No cross-user leak; noted here as a function that relies
  on caller discipline rather than asserting ownership itself, worth keeping
  in mind if a third call site is ever added, but not a gap today.

## OAuth callbacks

| Provider        | State issuance                                                               | State validation                                                                                                              | Status       |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Withings        | `randomBytes(16)` in an httpOnly, `sameSite=lax`, path-scoped, 10-min cookie | callback requires `code && state && expectedState && state === expectedState`, cookie deleted after read                      | ✅ confirmed |
| Google Calendar | same pattern                                                                 | same pattern                                                                                                                  | ✅ confirmed |
| Whoop           | same pattern                                                                 | same pattern                                                                                                                  | ✅ confirmed |
| Strava          | same pattern                                                                 | same pattern, plus reads Strava's actually-granted `scope` param (not trusted for identity, only for write-scope bookkeeping) | ✅ confirmed |

All four write `connections` rows keyed to `session.user.id` (re-checked at
the top of the callback, redirects to `/login` if absent) — never to
anything derived from the OAuth response.

## Webhooks

| Provider     | Inbound webhook?                                                                                                                            | Verification                                                             | Status                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| Apple Health | yes (`POST /api/connections/apple-health/ingest`)                                                                                           | per-user token, SHA-256 hashed and matched against the stored connection | ✅ confirmed — see route handler table above |
| Whoop        | **no** — sync is pull-only (`src/lib/sync/activity-poll.ts`, `src/lib/sync/scheduler.ts` comments confirm no webhook path; no route exists) | n/a                                                                      | ✅ confirmed (not applicable)                |
| Withings     | **no** — same pull-only model                                                                                                               | n/a                                                                      | ✅ confirmed (not applicable)                |

## LLM biomarker extraction (`src/lib/health-extract.ts`)

Re-confirmed against the spec's three requirements:

- **No tools**: the `generateText()` call passes no `tools` — a malicious
  string embedded in pasted lab text or an uploaded file image/PDF cannot
  drive any write, MCP call, or side effect. It can only influence the text
  the model returns.
- **Deterministic fallback**: no LLM configured → `parseLabText()` (pure
  regex/string parsing, no model involved); LLM call throws → same fallback
  if text was provided, otherwise a clean error.
- **Review-before-save**: `extractBiomarkers()` / `extractAction()` return
  candidate rows only — nothing is persisted. Only the separate
  `saveBiomarkers(rows, measuredAt)` action (explicit user submission, after
  reviewing the extracted rows in the UI) writes to `biomarkers`, scoped to
  `requireUser().id`.

✅ confirmed, no gap.

## Blood-test file upload parser

`extractAction` in `health/actions.ts` caps uploads at 15 MB before reading.
The file bytes are handed to the LLM as a `file` content part (image/PDF) —
no local parsing of the file itself happens in this app (the model does the
extraction); the only local parsing is `parseLabText()` over plain pasted
text (the deterministic fallback), which is simple line-oriented
regex/string matching with no unbounded recursion, no filesystem access, and
no network calls. The Apple Health JSON parser
(`mapAppleHealth`/`ingestAppleHealth`, shared by the webhook and
`uploadAppleHealthFile`) was independently checked: bounded by the 10/25 MB
byte caps, pure `for`-loop traversal over the parsed array, no regex-based
parsing (no ReDoS surface), no `fetch`/`fs`/`exec` calls anywhere in
`src/lib/connectors/apple-health.ts`.

✅ confirmed, no gap.

## Summary

| Category                                 | Surfaces                                     | ✅      | ❌    |
| ---------------------------------------- | -------------------------------------------- | ------- | ----- |
| Route handlers                           | 17                                           | 17      | 0     |
| Server actions (files)                   | 20                                           | 20      | 0     |
| MCP tools                                | 54 (52 scoped + 2 stateless-by-design)       | 54      | 0     |
| OAuth callbacks                          | 4                                            | 4       | 0     |
| Webhooks                                 | 3 (1 applicable, 2 confirmed not-applicable) | 3       | 0     |
| LLM biomarker extraction                 | 1                                            | 1       | 0     |
| Blood-test / Apple Health upload parsers | 2                                            | 2       | 0     |
| **Total**                                | **101**                                      | **101** | **0** |

No gap found → Step 4 (fix via TDD) has nothing to do. Step 3's three
required confirming tests (MCP tool user-scoping, export endpoint scoping,
one representative server action) are implemented in
`tests/mcp-security.test.ts`, `tests/export-scoping.test.ts`, and
`tests/server-action-isolation.test.ts` respectively — all against real
Postgres with fake `test-*` user ids, following the repo's existing
DB-scoping test pattern.
