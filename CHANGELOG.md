# Changelog

## v0.25.5 — 2026-07-23 — Push Notifications Actually Deliver

The test-notification button reported nothing failing, but no push ever
arrived. Root cause: the server's VAPID key pair had changed at some point
(exact trigger unconfirmed — no error was ever logged for it, so it
predates the retention window), which cryptographically orphaned every
existing browser subscription. Apple and Mozilla each reported this
clearly (`VapidPkHashMismatch` / `"VAPID public key mismatch"`) — but
`sendToUser` only ever pruned a subscription on 404/410, so these just
failed silently on every send, forever, with `sendTestNotification`
reporting the misleading "no active subscription" message.

- **`sendToUser` now also prunes on an unrecoverable VAPID key mismatch**
  (matched specifically, not a blanket "any 400/401" — a generic 400 stays
  logged-and-retried, since it might be transient).
- **The bigger fix: re-enabling notifications couldn't actually fix this.**
  The browser's Push API silently returns an _existing_ subscription from
  `pushManager.subscribe()` rather than creating a new one — even when it
  no longer matches the server's key — so clicking "Enable" again kept
  saving the same broken subscription. It now unsubscribes any existing
  one first, guaranteeing a fresh subscription tied to the current key.

## v0.25.4 — 2026-07-23 — Deleted Activities Don't Linger

An activity removed at the source stayed in Recover forever — nothing ever
told it the ride was gone.

- **Deleting an activity on Strava now deletes it here too.** Strava's
  webhook already sends `aspect_type: "delete"` events; Recover received
  them but silently did nothing. It now removes both the native
  `provider: "strava"` sync row and any `provider: "intervals_icu"` row
  sourced from that same Strava activity (matched the same way
  auto-describe resolves a Strava id from an intervals.icu row — see
  v0.25.3).
- **New manual "Delete activity" action** on the activity page (trash icon
  next to the title, confirm-before-delete) covers what no webhook ever
  can: intervals.icu itself has no webhooks at all, so a ride removed there
  can only be caught by hand.

## v0.25.3 — 2026-07-23 — Auto-Describe Reaches Strava-Sourced Rides

Same root cause as v0.25.2's debrief gap, this time hitting Strava
auto-describe: intervals.icu withholds `strava_id`/`strava_activity_id` for
any activity it sourced from Strava, so a completed ride review could never
find where to write the description — `describeActivityOnStrava` silently
skipped every one with `reason: "no_strava_id"`, and would have forever.

- **New `resolveStravaId()`** falls back to the activity's own
  intervals.icu `externalId` when `raw.source === "STRAVA"` — confirmed 1:1
  against the sibling native `provider: "strava"` sync row's `externalId`
  for the same ride, since intervals.icu borrows the Strava id as its own
  for activities it can't otherwise access. Used by both the post-sync
  auto-describe path and the `describe_strava_activity` coach tool.
- **The settings preview no longer picks a Strava-sourced stub** as its
  "most recent activity" sample — those carry almost no fields to render
  (only CTL/TSB survive, from wellness data, not the activity itself),
  which made the preview look broken even with every field enabled. It now
  skips straight to a real data-bearing ride, same as before this gap was
  introduced.

## v0.25.2 — 2026-07-23 — Ride Review Actually Pops Up

Two gaps kept the post-ride debrief from ever reaching the athlete in
practice: it only ever showed as a Today-dashboard chip or push-notification
deep link, never on the ride's own page, and rendered as a form buried in
the page flow rather than the bottom-sheet popup used everywhere else in the
app. Opening a ride with a pending debrief now pops the same sheet.

- **`debriefEligible` no longer permanently excludes Strava-sourced rides.**
  intervals.icu withholds `duration`/`load` for any activity it sourced from
  Strava (own API note: "STRAVA activities are not available via the API"),
  which previously failed the 15-minute-minimum check forever, with no
  retry that could ever fix it. A real webhook-triggered create event is
  already proof of a genuine ride, so an unknowable duration no longer
  blocks it — a plain not-yet-synced null duration (any other provider)
  still waits its turn as before.
- **The activity page now mounts the real `DebriefSheet` popup** for a
  pending debrief instead of the old inline `DebriefForm`, matching the
  sheet already used for the dashboard chip and push-notification deep
  link. Metric formatting (`formatActivityMetrics`) is now shared between
  both entry points instead of duplicated.

## v0.25.1 — 2026-07-23 — Webhook Callback Fix

v0.25.0 added `/api/webhooks/strava` but never actually made it reachable:
the session-redirect proxy 307'd every unauthenticated request to `/login`,
including Strava's own verification handshake and every subsequent event
POST — so the webhook shipped dead on arrival.

- **`/api/webhooks/*` now bypasses the session gate**, alongside the
  existing `/api/mcp`/`/api/cron` bearer-auth routes — verified live via
  Strava's actual push-subscription creation, not just a local curl.

## v0.25.0 — 2026-07-23 — Strava-Triggered Intervals Sync

intervals.icu has no webhooks, so a new ride only ever showed up after the
daily 5am sync, the 15-min ride-debrief poll, or a manual "Sync now" click
— nothing pushed a fresh ride to an open dashboard tab.

- **New `/api/webhooks/strava` endpoint.** Strava does support push
  subscriptions; on an activity-create event we now schedule an
  intervals.icu catch-up sync ~90s later (giving intervals.icu's own
  Strava ingestion a head start) instead of waiting on the poll or daily
  sync. intervals.icu stays the ride source of truth — Strava rows are
  still excluded from every AI/MCP surface, unchanged.
- **The sync chip now polls `/api/sync/status` every 45s** and refreshes
  the dashboard when a background or webhook-triggered sync lands, so a
  new ride shows up without a manual reload.
- New `STRAVA_WEBHOOK_VERIFY_TOKEN` env var; one-time subscription
  registration `curl` documented in the webhook route's file header.

## v0.24.0 — 2026-07-23 — Strava Auto-Describe Fixes & Fields

VO2max was effectively always blank on Strava descriptions — it only ever
read the per-activity intervals.icu payload, which rarely carries an
estimate. Worse, auto-describe used to write the Strava description in
the same tick a ride was promoted to a pending debrief, before the
athlete had even seen the popup; because the write is append-once
(marker-gated), that meant the ride review could never be added
afterward, no matter when the athlete answered.

- **VO2max now falls back to the daily wellness value** (`wellnessDaily.vo2max`)
  when the activity itself doesn't carry an estimate — same pattern as the
  existing eFTP fallback. The coach's `get_biomarkers` tool had the same
  bug (hardcoded `vo2max: null`) despite already fetching the data; fixed.
- **Auto-describe now waits for the debrief to resolve.** `describeActivityOnStrava`
  gates on `debriefState`/`reviewedAt`; the Strava write fires the moment
  the ride review actually posts (from the popup submit, the debrief
  lifecycle retry, or a race debrief) instead of racing it or waiting for
  the next daily sweep.
- **Two new opt-in description fields**, same per-field settings toggle as
  the rest: **Ride review** (short AI-generated summary, ~140 chars) and
  **RPE / feel** (the athlete's own debrief answer, shown alongside it).

## v0.23.1 — 2026-07-23 — Coach Composer & History

Follow-up to v0.23.0's inbox. The composer was `fixed left-0 w-full`, so
it could slide under the desktop sidebar or sit off-center; it now lives
in normal flow (`h-svh` column: header → scrollable messages →
composer), so it can't drift regardless of viewport width.

- **Chat|Inbox segments, the Chat History and Quick Context
  collapsibles, and the pill row above the composer are gone.**
  Suggestions now show only on an empty chat (max 3), and clicking one
  sends it immediately instead of just filling the input.
- **Inbox merges into one History surface**: "From your coach"
  (system-thread messages, unread dots, kind tiles) above "Chats" — a
  bottom sheet on mobile, a dropdown from the thread-title button on
  desktop. `/coach?tab=inbox` now redirects to `/coach`.
- Input is now an auto-growing textarea (Enter sends, Shift+Enter
  newlines) instead of a single-line field.

## v0.23.0 — 2026-07-23 — IA & Navigation Redesign

Every route gets a job, duplicated modules get one home, and the nav is
renamed to match: `Home / Plan / Log / Coach / Journal / Menu` becomes
`Today / Train / Coach / Body / Menu`. Handoff:
`docs/design_handoff_ia_redesign/README.md` (mockups, rationale, screen
specs for every screen below).

- **Today rebuilt**: one glass hero (readiness ring, band verdict, a
  numeric why-line, Recovery/Sleep legend), a 2×2 (4-across on desktop)
  vitals grid with 7-day sparklines, a session card whose **Mark done**
  button is now real — `markDayDone` records the athlete's word as status
  only (no invented load, no synthetic activity), so week adherence still
  reflects only what actually synced.
- **`/plan` and `/log` merge into `/train`** (Week · History · Fitness
  tabs): the week becomes one grouped hairline-row surface instead of
  seven glass cards; History gets a 7-day stat strip over compact rows;
  Fitness gets CTL/ATL/TSB tiles above the PMC chart. `/plan` and `/log`
  retire as framework-level 308s to `/train`.
- **`/journal`, `/health`, and `/log`'s wellness half merge into `/body`**
  (Trends · Sleep · Journal · Labs): HRV/RHR trends render against the
  athlete's own baseline band instead of a population norm; sleep gets its
  real stage breakdown, consistency, chronotype and tonight's recommended
  bedtime. `/journal` and `/health` retire as 308s to `/body`.
- **Coach gains an inbox** (`Chat | Inbox · n`): a chronological rail of
  every morning brief, ride debrief, weekly review, and overtraining
  warning the coach has written, sourced from the existing system-thread
  messages — no new tables. Migration `0024` adds one additive column,
  `chat_messages.read_at`.
- **Two new URL-driven bottom sheets** replace the morning check-in and
  post-ride debrief inline forms: `?sheet=checkin` and
  `?sheet=debrief&activity=…`, so both push notifications now deep-link
  straight into an open sheet instead of the dashboard or the activity
  page.
- **Menu and activity detail restyled**: collapsed settings groups now
  carry a real summary line (`Claude · deep · 1 memory`,
  `push on · wake 06:00 · FTP 310`); activity detail gets a 3×2 stat-tile
  grid and an emerald-tinted debrief card quoting the athlete and the
  coach in turn.
- **A real desktop layout**: Today splits into a 7fr/5fr grid at `lg+`
  (150px readiness ring, a week-progress row, an inbox teaser on the
  coach brief), and the sidebar gets its spec'd 216px width with a pinned
  account row.
- **Duplicate data removed** along the way: the PMC chart's own CTL/ATL/TSB
  readout (now redundant with the tiles above it), biological age printed
  in both a new tile and `BioAgeCard`'s headline, and the next race
  appearing both as a chip and as a list row on Train.
- **Fixed while touching the surfaces that exposed them**: the coach
  writes markdown that had never been rendered anywhere in the app (chat,
  ride reviews, inbox previews all showed raw `**`); TSB and sleep-debt
  tiles that printed raw floats and triple-digit minute counts; a sheet
  backdrop that was unclickable on desktop (a stacking-context bug that
  trapped it under the sidebar); a malformed activity id in a sheet URL or
  route param that 500'd instead of 404ing; neither nav marking its
  active item `aria-current`.

## v0.22.0 — 2026-07-22 — Wellness Fitness Metrics

intervals.icu was already sending `vo2max`, `rampRate`, and per-sport
`pMax`/`wPrime` in the daily wellness payload we fetch nightly — none of
the four made it into a typed column. Design:
`docs/specs/2026-07-22-v0.22-wellness-fitness-metrics-design.md`.

- **Bio-Age's dormant VO2max slot filled**: the health page's `vo2max`
  input was hardcoded `null` with a comment claiming no provider carried
  it — the data has been in the raw payload since day one. Now wired from
  the athlete's most recent Garmin-synced reading.
- **New Log page stat row**: eFTP, max power, and W′ (anaerobic capacity)
  now render next to the PMC chart, alongside a sign-aware CTL ramp-rate
  trend label (Ramping / Tapering / Steady). Each stat hides itself when
  the athlete has no real value for it — no zero, no placeholder.
- **Data layer**: `vo2max`/`rampRate`/`pMax`/`wPrime` added to
  `wellness_daily`, the intervals.icu connector, and the per-field wellness
  merge policy (`vo2max` under the physiology priority ladder, the other
  three under the intervals.icu-only training-load ladder, same bucket as
  `eftp`).

## v0.21.0 — 2026-07-22 — Design Consistency

A second Superdesign pass extends v0.19's dark-glass visual language to
every remaining route, including the five pages v0.19 already restyled.
Presentation only — no new data, metrics, features, or migrations. Design:
`docs/specs/2026-07-21-full-design-update-design.md`, implementation:
`docs/specs/2026-07-22-full-design-update-implementation.md`.

- **Dashboard hero rebuilt**: concentric Apple-Watch-style `ReadinessRings`
  (center readiness number, nested Recovery/Sleep/Strain rings, each
  independently calibrating) replace the old single ring. `StrainBudget`
  (a duplicate of `strainFraction`) and the now-superseded `ScoreRing` are
  both deleted.
- **Hairline-restraint tier** (Settings, Health, Admin, Import): a new
  `.hairline-list` CSS utility flattens nested glass-in-glass card stacks
  into hairline-divided rows. Applied to Settings and Import; Health and
  Admin's existing structure was already consistent and left unchanged.
- **Glass-tile tier** (Log, Activity detail, Coach, Journal, Plan): dedup
  and header-consistency pass. Log's duplicate TSB display and Journal's
  duplicate logging streak are resolved — the streak now hides on the
  shared `MilestonesCard` via a `hideStreak` prop (still shown on
  Dashboard, its other consumer).
- **Login copy fix**: removed invented "Premium Athlete Edition" /
  "Forgot Access Key?" language that didn't correspond to any real
  feature. Join was already honest and needed no change.
- **Final whole-branch review fixes**: closed a pre-existing SSR/hydration
  relative-time mismatch in the dashboard's sync chip
  (`useSyncExternalStore`-backed mount gate, avoiding the
  `react-hooks/set-state-in-effect` trap a naive effect-based fix would
  hit); deleted the `GlassTile` primitive, which ended up with no
  production consumer once the concentric-rings direction was chosen;
  restored three `WeeklySummary` regression tests that had been dropped
  as collateral damage of the `ScoreRing` cleanup.

## v0.20.0 — 2026-07-21 — Final Sweep

Closes out the current roadmap in one release: cross-cutting polish, the
v0.17 operations track, and the remainder of v0.18's 1.0-hardening list.
Nothing net-new in user-facing scope — every item here finishes a
half-done backlog line or makes what already exists more trustable.
Stronger Together (v0.16, social/sharing) is explicitly deferred to a new
roadmap rather than squeezed in here. Design:
`docs/specs/2026-07-21-v0.20-final-sweep-design.md`.

### Track 1 — Polish

- **Empty states and loading skeletons** on the four pages v0.19's
  restructuring skipped (`plan`, `activity/[id]`, `activity/log`,
  `health`, `import`) — reusing the shared `EmptyState` primitive and
  matching layout-stable skeletons, including a fix for `plan/loading.tsx`
  missing `RacesSection`'s always-rendered "add race" bar (content would
  otherwise shift on stream-in).
- **Chart consistency**: one shared token + axis/legend grammar
  (`CHART_TOKENS`, `formatChartValue` in `src/lib/charts.ts`) across
  `stream-chart`, `wellness-trends`, `weekly-load-bars`, the dashboard
  sparklines, and the coach `artifact-card` — hand-rolled SVG stays
  hand-rolled, this is a token unification, not a chart-engine rewrite.
  An unwired `axisTicks` helper and an unused `fontSize.tick` token added
  during the migration were caught in review and removed rather than left
  as dead code.
- **Default journal entries**: frequent _behavioural_ tags now pre-toggle
  from a "remember these as usual" setting — the energy/soreness/stress
  sliders are untouched by this and still write nothing when left
  unanswered, preserving the v0.7 score-integrity contract.
- **Performance-log filters**: verified end-to-end (view/month/range/sport
  all round-trip through one shared href-builder, extracted to
  `src/lib/log-href.ts` with a new regression test) — confirmed already
  correct since v0.19, no functional gap found.

### Track 2 — Ops / Self-Hosted Citizen

- **Prometheus `/metrics`** (`METRICS_TOKEN`-gated, timing-safe compare,
  404 when unset) and a richer `/api/health`: sync staleness, sync-job
  queue depth (pending/running/failed), backup age, and push-subscription
  count — all instance-wide aggregates, backed by one shared
  `getOpsSnapshot()` helper so the two endpoints can't drift.
- **`POST /api/internal/backup-complete`**: `BACKUP_NOTIFY_SECRET`
  shared-secret gate (timing-safe), called by `scripts/backup.sh` after
  every successful rotation; records backup freshness and fires the new
  `backup_completed` webhook.
- **Signed outbound webhooks** (migration `0021`,
  `webhook_subscriptions` / `webhook_deliveries`): HMAC-SHA256-signed
  POSTs on `readiness_computed`, `band_changed`, and `backup_completed`,
  with bounded retry (4 attempts, capped exponential backoff) and a
  per-attempt fetch timeout so a hung target can't stall the scheduler's
  sequential tick loop. Per-user dispatch is strictly scoped to the
  subscription owner's `userId`; `backup_completed` alone is deliberately
  instance-wide (it's not per-user data). Create/revoke are self-service
  and now audit-logged, matching the existing API-token audit pattern.
- **Sync-jobs admin panel**: owner-only view of every user's sync jobs
  (queue/running/failed) with manual retry (resets `runAfter` to now, not
  just `status`, so a backed-off job is actually picked up again) and a
  per-user "kick" — both re-gated independently of the page-level guard.
- **Complete GDPR export** across every user-owned table (journal,
  biomarkers, coach memories, chat messages, connections/settings, races,
  training plans, week plans, adjustments, token metadata — secrets
  stripped, never decrypted) plus a matching **import** path
  (`POST /api/import-account`, session-gated, always writes to
  `session.user.id`). `scripts/export-import-drill.sh` proves the
  export → wipe → import round trip is lossless against an ephemeral
  scratch database — never the live DB.
- **Native `ubuntu-24.04-arm` release runners**: multi-arch images
  restored (amd64 + arm64 native + manifest merge) without the ~50-minute
  QEMU cost that got arm64 dropped in v0.8.
- **Vercel + Neon deployment guide** (`docs/DEPLOY-VERCEL.md`): corrects
  prior guidance that told Neon deployers to omit `DATABASE_DRIVER`
  (which silently disables the scheduler's advisory locks); documents the
  correct pooled-connection + `DATABASE_DRIVER=pg` setup and a known gap
  (Vercel's native GET-only Cron Jobs can't reach `/api/cron`, which is
  POST-only — use an external scheduler).

### Track 3 — Hardening

- **Accessibility sweep**: a check-and-close pass over navigation,
  `ScoreRing`, the dashboard hero, journal form, settings accordions, and
  the coach composer — real, targeted gaps fixed (a missing
  `aria-hidden` on `ScoreRing`'s decorative subtree, three unlabeled
  icon-only buttons in the chat composer, several sub-AA-contrast text
  labels bumped `/30`→`/50`, three textareas/inputs with `outline-none`
  and zero replacement focus style). Full writeup and contrast math in
  `docs/a11y-sweep-2026-07.md`.
- **Session-management UI**: list active sessions/devices and revoke one
  or all-others, backed by Better Auth's own `sessions` table and
  `revokeSession`/`revokeOtherSessions` APIs, with an explicit
  self-ownership check and a guard against revoking your own current
  session. No 2FA/passkeys — deliberately out of scope for this
  deployment model (self-hosted, invite-only, behind a tunnel; see
  `docs/ROADMAP.md`'s v0.18 section for the reasoning).
- **Upgrade guarantees**: `scripts/migration-drill.sh` restores a real
  nightly `pg_dump` into a scratch Postgres and runs migrations against
  it, plus runs the full migration chain against an empty scratch DB —
  both scratch-only, never the live database. Documented rollback
  procedure and a backup-compatibility matrix in `docs/UPGRADING.md`.
- **Performance pass**: a dashboard cold-load budget plus a query audit
  found and fixed real N+1/missing-index gaps on the hot path. Findings
  and methodology in `docs/perf-pass-2026-07.md`.
- **API/MCP stability freeze**: the 54-tool surface in
  `src/lib/tools/registry.ts` (names and schemas, including per-field
  descriptions) is now frozen with a snapshot test and a published
  deprecation policy — see `docs/API-STABILITY.md`.
- **Docs reviewed end-to-end**: doc claims re-verified against code
  rather than trusted as-is (tool count, connector list, env-var names);
  fixed a real drift (`.env.example` was missing the Whoop and Withings
  OAuth env vars entirely) and filled gaps in `docs/SELF-HOSTING.md` for
  every surface this release added.
- **Final security review**: re-ran the v0.18.0 per-user-isolation lens
  over every surface this release added — `/metrics`,
  `/api/internal/backup-complete`, webhook dispatch, the account-import
  route, and the sync-jobs admin panel. **Zero gaps found** — full
  evidence trail in `docs/security/2026-07-21-v0.20-review.md`. The
  import route in particular was re-confirmed to write only to
  `session.user.id`, never a caller-supplied target.

## v0.18.0 — 2026-07-21 — Security Hardening

The first slice of the roadmap's "1.0 Hardening" epic — shipped after
v0.19.0 because v0.19 jumped this slot's place in the queue for a design
pass (see that entry below). Cheap high-value web-security fixes, a light
auth/token/connection audit log, and an exhaustive per-user isolation and
input audit over the full post-v0.19 codebase. Design:
`docs/specs/2026-07-20-v0.18-security-hardening-design.md`.

### Added

- **HTTP security headers** on every response: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, HSTS, a pragmatic
  `Content-Security-Policy` (`frame-ancestors 'none'`), and a
  Permissions-Policy that deliberately does not deny microphone — v0.15's
  voice dictation needs it. `src/middleware.ts` renamed to `src/proxy.ts`
  per Next.js 16's convention.
- **Login rate-limiting** (20 requests/60s) and boot-time
  `BETTER_AUTH_SECRET` validation — the app now fails loud at startup on a
  missing or too-short secret instead of silently degrading session
  security, mirroring the existing `ENCRYPTION_KEY` check.
- **Security event audit log**: a new `audit_log` table records
  login success/failure, API token creation/revocation, and connection
  add/remove events (7 providers) — never a secret value, only labels and
  provider names. Owner-only "Recent security events" list on `/admin`.
- **Exhaustive per-user isolation & input audit**: every route handler,
  server action, MCP tool (all 54), OAuth callback, and webhook checked
  for cross-user data leaks; the LLM biomarker-extraction and file-upload
  paths re-confirmed against their original no-tools/bounded-parsing
  guarantees. Zero gaps found — the full checklist and reasoning live at
  `docs/security/2026-07-20-isolation-audit.md`. Backed by new regression
  tests proving MCP token isolation, export-endpoint scoping, and a
  representative server action's cross-user denial.

### Fixed

- **Apple Health ingest**: `Referrer-Policy: no-referrer` and
  `Cache-Control: no-store` on every response (the ingest token can arrive
  via a `?token=` URL parameter), and the size cap is now enforced by
  actually counting bytes read instead of trusting the client-supplied
  `content-length` header, which can be omitted or understated.
- Two moderate `npm audit` advisories (a nested build-time `postcss` copy
  in `next`, a dev-only `esbuild` pulled in transitively by `drizzle-kit`)
  investigated to root cause and confirmed unreachable at runtime; not
  forced via a breaking major downgrade.

Deferred past this slice, still open in the roadmap: passkeys/TOTP 2FA,
full session-management UI, a strict `script-src` CSP.

## v0.19.0 — 2026-07-20 — Design Refresh

A Superdesign pass rethought the dashboard, coach, log, journal, and
settings screens around progressive disclosure — collapsed-by-default
sections instead of everything rendered flat. Purely structural: same data,
same queries, same features. Design:
`docs/specs/2026-07-20-v0.19-design-refresh-design.md`.

### Added

- **Shared `Collapsible` and `EmptyState` primitives** (`@base-ui/react`,
  the `render`-prop convention) — one disclosure grammar used consistently
  across all five restructured pages instead of five ad hoc ones.
- **Dashboard**: one animated Readiness ring as the page's single focal
  metric; Recovery/Sleep/Strain demoted to a compact stat row; "Recovery
  Metrics" and "Recent Sessions" become collapsed-by-default accordions.
- **Settings**: one accordion per domain (Integrations, AI & Tech,
  Advanced/API, App, About) — only Profile stays always-open. Closes the
  "Settings information architecture" backlog item.
- **Log**: Today/Week/Month time-range navigation (plus a month strip)
  replaces the old Training/Wellness content toggle; the Performance Trends
  (PMC) and Wellness Trends panels are now always-present, independently
  collapsible sections instead of one being reachable only via a tab.
- **Journal**: stepped check-in (mood → wellness sliders → vitals, one step
  open at a time, completed steps collapse to a checkmark); correlation
  insights promoted above the form; the honest-input contract (v0.7) is
  unchanged — no step can force-fill an untouched field.
- **Coach**: collapsible Chat History and Quick Context panels; quick-reply
  chips above the composer (fill the input, never auto-send, matching the
  voice-dictation rule).
- Honest empty states and layout-stable loading skeletons on all five
  touched pages.

### Fixed

- Screen-reader heading navigation for every new collapsible section (all
  five pages) — the shared trigger now sits inside a semantic heading.

## v0.15.0 — 2026-07-20 — The Coach Remembers

Coach memory held structured facts; it still couldn't recall what was
actually said, and every ride ended in silence. Design:
`docs/specs/2026-07-19-v0.15-coach-remembers-design.md`.

### Added

- **Recall over history**: `recall_history` coach tool (53 → 54) — Postgres
  full-text search ('simple' config for mixed Dutch/English) across past
  conversations, weekly/monthly reviews, ride debriefs, and journal notes.
  The coach cites results with dates and says so when it finds nothing.
  Ghost threads are excluded — they were promised to vanish.
- **Post-ride loop**: a 15-minute intervals.icu activity poll (no webhooks
  exist; quiet 23:00–06:00) detects a fresh ride, a debrief card asks RPE /
  feel / notes (untouched fields write nothing; intervals.icu RPE prefills),
  and the coach writes a ride review reconciling the numbers with the
  athlete's own words — quoted, never paraphrased. Skipped or expired
  debriefs get a data-only review that says no feedback was given. Strava
  activities are excluded end-to-end (API AI clause). Opt-in push.
- **Monthly report**: the weekly review's big sibling — load vs previous
  month, readiness trend, milestones, biomarkers logged, races — at-most-once
  per calendar month, sections omitted when the data isn't there.
- **Voice input**: mic in the chat composer (Web Speech API) — dictation
  fills the box, never auto-sends, with an honest note that the browser
  vendor may process the audio. Recover never sees or stores audio.
- **Token transparency**: `llm_usage` rows at every real LLM call site;
  settings shows this and last month by model and purpose. Tokens, never
  cost estimates.

### Changed

- Cycle-Aware Readiness deferred (roadmap): no athlete on a running instance
  generates cycle data; later versions renumbered (v0.16 Stronger Together,
  v0.17 Good Self-Hosted Citizen, v0.18 1.0 Hardening).
- Migration 0018: FTS columns + GIN indexes, debrief state on activities,
  `llm_usage`, poll cursor, debrief prefs.

## v0.14.0 — 2026-07-19 — Race Ready

The adaptive week manages training; race day is why it exists. Everything
here stands on v0.10's honest load engine — forecasting from fabricated CTL
would be fabrication with extra steps. Design:
`docs/specs/2026-07-19-v0.14-race-ready-design.md`.

### Added

- **Race calendar**: a `races` table (migration 0016) makes A/B/C races
  first-class entities, with `training_plans.race_id` linking a plan to its
  goal race. Generating a plan without an explicit race implicitly creates
  the A race from the plan's target date, so coach memory's informal race
  knowledge finally has a real row behind it.
- **Taper engine** (`materializeWeek`): the living week reshapes into a taper
  as race day approaches — window length by race distance (21/14/10 days)
  and weekly load fractions (45%/65%/80%) — and the ramp guard's downward
  clamp steps aside during taper weeks so the drop isn't fought as an
  anomaly. Race-week openers keep the taper from feeling like a dead stop,
  and race-day slots are untouchable by adaptation or manual moves.
- **B/C race convention**: B races get a protected pre-race ease-off (a rest
  day the day before, no quality work two days out); C races are training
  days like any other and the plan trains straight through them.
- **Readiness forecast** (`src/lib/race/forecast.ts`): a pure EMA
  forward-simulation of CTL/ATL over the planned week, reported as an honest
  two-scenario band — full execution vs trailing-adherence-scaled, floored
  at 50% — and only ever FORM (TSB), never a projected readiness score. Falls
  back to an explicit `insufficient` state when load history isn't
  calibrated yet instead of guessing.
- **What-if simulator** (`simulatePlanChange`): move/swap/skip previews on
  `/plan` show the load and TSB impact before the change is saved, gated
  behind a confirmation dialog when the delta is material, plus a read-only
  `simulate_plan_change` coach tool for the same preview in chat.
- **Race-day brief & post-race debrief**: the morning coach thread leads
  with the race on race day; afterward, a debrief links the result activity,
  closes the race, and — if no result has landed after 48 hours — says so
  honestly instead of stalling silently. Both are transactional and
  idempotent. The debrief links to Strava's results but keeps Strava's own
  stats out of the AI narrative, per the existing firewall.
- **Dashboard `RaceCountdownCard`**: next race, days out, and a projected
  form-outlook band range, with honest `insufficient`/no-plan states instead
  of a blank or fabricated card.
- 4 new coach/MCP tools (49 → 53 total): `get_races`, `upsert_race`,
  `delete_race`, `simulate_plan_change`.

## v0.13.0 — 2026-07-19 — Deep Biology

Long-horizon health metrics, finally data-backed: v0.11's Withings
connector and this release's blood-test extraction fix the input side that
kept this deferred. Design:
`docs/specs/2026-07-18-v0.13-deep-biology-design.md`.

### Added

- **Health Records** (`/health`): upload a blood-test PDF/photo or paste
  the values → your own LLM extracts biomarkers with a per-value confidence
  → an editable review screen → the `biomarkers` table. Nothing is stored
  unconfirmed. With no LLM configured, pasted text still parses via a
  deterministic line parser. Migration 0015 (additive).
- **Biological age** (`src/lib/biological-age.ts`): a transparent composite
  — chronological age plus a small capped offset per honest signal (resting
  HR, HRV, sleep consistency, VO₂max, body fat). Below three signals or
  without a birth year it shows an "insufficient inputs" state naming
  what's missing, never a guessed number.
- **Blood pressure** (`src/lib/blood-pressure.ts`): manual entry plus
  Withings sync (v0.11), classified against the 2017 ACC/AHA bands with a
  recent-average trend and direction.
- **Coach visibility**: a `get_biomarkers` tool (registry 48 → 49) surfaces
  latest values, BP classification, and the bio-age summary to the coach,
  bounded to reference trends only — it never diagnoses or recommends
  treatment.

## v0.12.2 — 2026-07-19 — Audit Fixes

A post-merge audit of v0.10–v0.12 (which shipped without the usual
per-task review trail) and a pre-merge review of v0.13. The engines held
up; four fixes came out of it.

### Fixed

- **Strava firewall**: the v0.10 native load engine fed
  `provider='strava'` activities into the stored CTL/ATL series, which
  reaches coach context and MCP tools through readiness — the aggregate
  path the Nov-2024 Strava agreement closes. Strava rows are now excluded
  from the native series (the dashboard-only weekly rings still count
  them); a Strava-only athlete honestly stays `calibrating`.
- **Concurrent wellness writes**: `field_sources` ownership is written as
  a jsonb union of the changed fields instead of a full-map overwrite, so
  an Apple Health webhook landing mid-sync can no longer erase another
  provider's ownership records.
- **EMA decay**: a scheduler pass recomputes today's metrics once per day
  for users no sync touches — a manual-only athlete's CTL/ATL now decay
  through restful days instead of freezing at the last entry.
- **Apple Health ingest**: payloads over 10 MB are rejected before
  parsing.

## v0.12.1 — 2026-07-18

Packaging release, no code changes: the first tagged image since v0.9.5,
delivering v0.10.0, v0.11.0, and v0.12.0 (merged without tags) to
Watchtower-updated instances.

## v0.12.0 — 2026-07-18 — Sleep Intelligence

v0.9.0 deleted the fabricated sleep cards; v0.11 started ingesting real
stage data. This release earns the cards back — only for athletes whose
provider actually sends them — and gives the whole app a desktop layout.
Design: `docs/specs/2026-07-18-v0.12-sleep-intelligence-design.md`.

### Added

- **Sleep stages, for real** (`src/lib/sleep-insights.ts` + `SleepStagesCard`):
  a stacked deep/REM/light/awake bar with per-stage minutes and the bed
  window, rendered only when the provider sent stage data. A manual athlete
  sees nothing invented — the card doesn't mount.
- **Sleep consistency**: a 0–100 regularity score from the circular SD of
  sleep midpoint over the trailing month — the metric the literature ranks
  above duration — gated on enough real bed/wake nights.
- **Chronotype & social jetlag**: mean sleep midpoint plus the weekday vs
  free-day gap, so a shifting weekend schedule shows its cost.
- **Bedtime target v2**: when a provider sends real bed times, the nightly
  bedtime target anchors on the athlete's habitual bedtime nudged by sleep
  debt; the manual wake-time path is unchanged for everyone else.
- **Desktop shell**: a persistent sidebar nav and a wider, two-column
  dashboard at `lg`+, replacing the phone-stripe-on-a-monitor `max-w-lg`
  layout. The floating bottom tab bar stays on small screens.

## v0.11.0 — 2026-07-18 — Wearable Connectors

intervals.icu stops being the only automatic pipe. Whoop and Oura bring
back the staged sleep and bed/wake data v0.9.0 had to delete cards for,
Withings adds body composition and blood pressure, and Apple Health lets
anything on an iPhone push in. Two providers reporting the same morning
now resolve by an explicit per-field priority instead of last-writer-wins.
Design: `docs/specs/2026-07-18-v0.11-wearable-connectors-design.md`.

### Added

- **Per-field wellness merge** (`src/lib/wellness-merge.ts`): every
  provider write goes through one priority policy that records which
  source owns each field (`wellness_daily.field_sources`). Manual entry
  always wins; dedicated wearables beat intervals.icu on physiology;
  Withings wins body composition & BP; training-load fields stay
  intervals.icu-only; a null from any provider never erases existing data.
  Migration 0014 is additive (staged-sleep, bed-window, temperature,
  respiration, BP, and body-fat columns plus `field_sources`).
- **Whoop** (OAuth2, `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET`): recovery
  HRV & resting HR joined to staged sleep, mapped to the wake date.
- **Oura** (Personal Access Token pasted in Settings — no OAuth app
  needed): staged sleep, HRV/RHR, sleep score, and temperature deviation.
- **Apple Health**: token-authed Health Auto Export webhook plus a one-off
  JSON file upload — sleep stages, HRV, resting HR, respiration, blood
  pressure, and body composition, no Apple API required.
- **Withings** (OAuth2, `WITHINGS_CLIENT_ID`/`WITHINGS_CLIENT_SECRET`):
  weight, body-fat ratio, and blood pressure.
- **Guided first run**: the onboarding screen is now a source picker
  (connect a device / log manually / import CSV), and the calibrating
  readiness ring shows an honest "day N of 14" progress bar with a
  next-step prompt instead of a bare label.

### Changed

- The intervals.icu sync and the manual journal writer now route through
  the per-field merge, so a second provider can no longer clobber their
  fields on the same day.

## v0.10.0 — 2026-07-18 — Honest Load

Recover stops borrowing its training-load math. CTL/ATL/TSB are now
computed natively from the athlete's own sessions when intervals.icu
doesn't provide them, and every score that used to be invented from
missing data now says `calibrating` instead. Design:
`docs/specs/2026-07-18-v0.10-honest-load-design.md`.

### Added

- **Native load engine** (`src/lib/training-load.ts`): per-activity load
  in TSS-like units via a first-match ladder — provider load → power TSS
  (needs FTP) → heart-rate TSS (needs max HR + resting-HR baseline) →
  honest duration fallback (an unlabeled hour counts as easy) — with
  cross-provider dedup, then CTL (42d) / ATL (7d) EMAs over the daily
  sums. Works for every source: manual, CSV, Strava, intervals.icu.
- **Source precedence**: intervals.icu's precomputed ctl/atl keep winning
  when present; native values fill the gaps and are labelled `computed`
  on the new `daily_metrics.ctl/atl/load_source` columns (migration 0013,
  additive). Readiness's form component now works for manual-only
  athletes.
- **Training thresholds** in Settings → Body: optional max HR and FTP
  feed the HR/power rungs; changing them recomputes the recent window.
- **"This Week" rings wired**: the hardcoded `0.7`/`0.8` fractions are
  replaced by real targets — planned week volume and the active block's
  target load, falling back to trailing 28-day averages — and the rings
  simply don't render when no honest target exists.

### Fixed

- **Recovery & Strain are no longer invented**: the dashboard read
  `latest?.atl ?? 0` / `latest?.ctl ?? 0`, giving a no-integration
  athlete a hero "Recovery 60" and "Strain 0.0" from zero data. Both
  rings, the strain budget, and the narrative now use the effective
  (provider-or-computed) values and show `calibrating` until at least 7
  activity days exist in the trailing 6 weeks. Closes the last two
  honesty-debt items.
- The Training Status tile's fabricated "Optimal load intensity" caption
  now shows the real CTL (marked `computed` when native) or nothing.
- Manual activity logging and CSV import now recompute daily metrics, so
  a logged workout shows up in load immediately (imports batch into one
  recompute).

## v0.9.6 — 2026-07-18 — Absorb intervals-icu MCP

24 new intervals.icu tools (23 `icu_*` tools plus a `get_workout_syntax`
reference) bring the standalone intervals-icu-mcp server's capabilities
into Recover's own MCP endpoint and the in-app coach, so the separate
server can be retired. Design:
`docs/specs/2026-07-17-v0.9.6-absorb-intervals-mcp-design.md`.

### Added

- **Live intervals.icu tools** (registry 24 → 48): calendar events
  (list/get/create/update/delete/bulk/duplicate), activity edits and
  messages, wellness push, sport settings, an apply-training-plan action,
  per-activity histograms (HR/power/pace/GAP), activity search and
  intervals, the workout library, and a workout-syntax reference. Writes
  require a new `write:icu` MCP token scope; the in-app coach can use them
  under your session.

### Changed

- The standalone `intervals-icu-mcp` server is no longer needed — its
  curated tool set now ships inside Recover. The standalone repos
  (`intervals-icu-mcp` and its `-deploy` counterpart) can be decommissioned.

## v0.9.5 — 2026-07-17 — Nightly Backups

The database now backs itself up, and one command proves a backup
restores. Design: `docs/specs/2026-07-17-v0.9.5-backups-design.md`.

### Added

- **Nightly backups**: a default-on `backup` sidecar (`postgres:16-alpine`
  and crond) runs `pg_dump -Fc` at 03:30 into the new `recover-backups`
  volume, keeping the newest 14 dumps (`BACKUP_KEEP` to change). Dumps
  write to a temp name and rename on success; rotation runs only after a
  successful dump, so a failing backup can never eat the old ones.
- **Restore drill**: `scripts/restore-drill.sh` restores the latest dump
  into a disposable scratch Postgres, verifies core tables and row
  counts, prints data freshness, and tears everything down — unattended,
  exit 0/1. Documented in `docs/SELF-HOSTING.md` alongside the real
  disaster-recovery procedure.

### Changed

- Roadmap: the old v0.9.5 "Infrastructure" is split — backups shipped
  here; absorbing the standalone `intervals-icu-mcp` server moves to
  v0.9.6.

## v0.9.4 — 2026-07-17 — Deeper Insights

Auto-tags, honest confidence intervals, and real streaks. Everything is
pure and computed on read — no new tables, nothing stored that the data
could stop supporting. Design:
`docs/specs/2026-07-17-v0.9.4-deeper-insights-design.md`.

### Added

- **Auto-tags from activities** (never stored, Strava excluded):
  🔥 Hard session (own top-quartile load, silent under 20 training days),
  2️⃣ Double day, 😴 Rest day, 🌅 Morning training, 🌙 Late training. They
  join the journal's manual tags in the correlation analysis, marked
  "auto".
- **Correlations v2**: per-tag two-sample comparison (tagged vs untagged
  days) with a t-based 95% confidence interval. Rows whose CI crosses
  zero say "inconclusive · n events" instead of asserting an impact. Each
  row expands into weekday/weekend splits, gated at 5 events per side.
- **Milestones card** (dashboard + journal): real logging streak with
  best-ever, plan weeks completed at ≥70% adherence, plans completed.

### Fixed

- **The streaks are real now.** The dashboard's "N-day logging streak"
  was `Math.min(days logged in last 30, 30)` and the journal's was a
  7-day count — both now show the true consecutive run (today not yet
  logged doesn't break yesterday's run). Closes the honesty-debt item.

## v0.9.3 — 2026-07-17 — Week Starts Now

Patch release for the Adaptive Week: a plan's living week now begins the
moment the plan exists, not at the next Monday's weekly review. Claims the
v0.9.3 number, so the planned feature releases shift one patch digit
(Deeper Insights → v0.9.4, Infrastructure → v0.9.5).

### Fixed

- **New plans materialize their week immediately**: `generateTrainingPlan`
  rolls the current week over as its last step, so a plan created on a
  Thursday shows a living week that Thursday instead of a skeleton-only
  `/plan` page until Monday.
- **"Plan this week" button**: for plans that predate this patch (or any
  state where the current week is missing), the `/plan` empty state now
  offers to materialize the week on demand. Safe to press twice — the
  rollover stays idempotent per user-week.
- **Regenerating a plan mid-week no longer shadows it**: the archived plan's
  open week row used to block the new plan's week until next Monday; the
  rollover now replaces that row (adjustments cascade) and logs a
  "plan changed" adjustment so the timeline explains the swap.
- **Mid-week starts don't invent the past**: days already behind the clock
  get zero availability, so a Thursday start plans Thu–Sun instead of
  backfilling fictional workouts onto Mon–Wed. On the normal Monday
  rollover this is a no-op.

## v0.9.2 — 2026-07-17 — Adaptive Week

JOIN-style rolling week on the v0.5d skeleton: workouts materialize one week
at a time from an availability intake and adapt every morning to measured
readiness and available time, with every automatic change logged and
explainable. Design: `docs/specs/2026-07-17-v0.9.2-adaptive-week-design.md`.

### Added

- **Living week tables**: `week_plans` (one open row per user-week, 7 JSON
  day slots) and `plan_adjustments` (one row per automatic change — trigger,
  action, before/after, deterministic reason). Purely additive migration.
- **Two pure engines** in `src/lib/week-plan/`: `materializeWeek` lays the
  skeleton week onto real availability (adherence rule below 70%, readiness
  suppression at ≥4 amber-or-worse days, ±20% ramp guard, a fully missed
  week restarts at 60% of skeleton instead of freezing at ±20%-of-zero);
  `adaptDay` handles each morning (missed quality sessions move once then
  drop with capped redistribution; red replaces quality with 30min recovery
  and shortens endurance 30%; amber steps intensity down at 85% duration;
  `calibrating` never triggers readiness changes; availability always wins
  first).
- **Weekly rollover** wired into the weekly review: closes last week's plan,
  writes actual load/sessions/adherence back to its skeleton block, and
  materializes the new week. **Daily adaptation** runs in the post-sync
  morning pipeline before the morning insight, so the insight quotes today's
  adjustment reasons verbatim instead of inventing them.
- **Availability intake with calendar prefill**: `/plan` suggests minutes
  per day from last week's pattern, halving days with ≥8h of calendar
  meetings (Google Calendar connection optional — a hint, never a blocker).
- **Coach tools**: `get_week_plan`, `set_week_availability` (write:plan),
  `get_plan_drift`; `update_training_plan` gains day-level
  `move_workout`/`swap_workout` actions with the same adjacency and
  availability checks the engines use.
- **`/plan` page**: the living week day-by-day, an adjustments timeline
  ("what changed and why"), the remaining skeleton, and the intake form.
  Dashboard gains a Today card and a 7-dot week strip.

## v0.9.1 — 2026-07-16 — Honest Pixels

Small fixes in the same defect class v0.9.0 worked through: things on screen
claiming to be something they are not. No schema or behavior changes beyond
the pixels below. (The roadmap's planned "v0.9.1 — Smarter Coach" feature
release moves to v0.9.2; subsequent planned versions shift accordingly.)

### Fixed

- **The favicon was still the stock Next.js logo.** `src/app/favicon.ico`
  had never been replaced since project scaffolding, so browser tabs showed
  the Next triangle instead of the Recover ring (Safari masked this by
  preferring the apple-touch icon, which was correct). Replaced with a
  proper multi-size ICO (16/32/48) rendered from the logo on the app's dark
  tile, matching the home-screen icon.
- **The Sleep Score sparkline plotted the wrong series.** The tile's value
  read `sleepScore` (fixed in v0.9.0), but the sparkline under it still
  plotted raw `sleepSecs` — real data, wrong series. It now plots the
  7-day `sleepScore` history the label promises.
- **Sparklines fabricated a flat line from no data.** Fewer than two real
  data points rendered a horizontal line — a visual claim of stability made
  from nothing (the last dashboard item on the honesty-debt list that was
  fixable without the strain/recovery rework). `sparkPath` moved to
  `src/lib/sparkline.ts`, returns an empty path below two points, and the
  vitals grid renders no sparkline at all for an empty path.
- **`package.json` version drift**: it still said `0.8.0` while v0.8.1 and
  v0.9.0 were tagged. Now `0.9.1` and part of the release checklist.

## v0.9.0 — 2026-07-16 — Honest Body Intelligence

v0.7 fixed fabricated data in the database. It never reached the dashboard:
a hardcoded body-battery curve every athlete saw identically, a sleep card
showing a 47%-REM stage breakdown every night no matter what, a
`"22:30 – 23:00"` bedtime string literal, and a "Sleep Score" tile that was
actually `sleepHours / 9 * 100` — while the real `sleepScore` column the
provider sends (populated on the large majority of days) was read nowhere on
the dashboard. Verified against the live DB: intervals.icu's 46-key wellness
payload carries no sleep stages and no bed/wake times at all, so those cards
could not be fixed, only removed.

### Added

- **Body battery, for real**: the energy curve is now modelled from the
  day's actual readiness score and real activity loads at the times they
  happened, instead of a fixed decorative SVG path. Labelled "Estimated
  Energy"; renders an empty state instead of a curve when readiness is
  `calibrating`.
- **Sleep debt**: cumulative deficit over the last 14 recorded nights of
  real `sleepSecs`, measured against the athlete's own sleep-need target.
  Nights with no sleep row are skipped, never counted as a perfect night; a
  surplus night does not offset a prior deficit.
- **Bedtime target**: computed from tonight's debt repayment (capped at
  1h/night) plus the athlete's own wake time. No wake time set means a
  prompt to set one in Settings — never a guessed time.
- **`body_prefs`**: per-user wake time and sleep-need target.

### Fixed

- **The sleep card invented a stage breakdown.** "47% REM / 25% Core / 20%
  Deep / 8% Awake" was a hardcoded literal shown identically to every
  athlete, every night — no connected provider, intervals.icu included,
  returns sleep stages. Removed entirely; the `stages` prop no longer
  exists.
- **"Efficiency" was actually `sleepHours / 8`.** Removed from both the
  sleep card and the vitals grid — there is no time-in-bed data anywhere to
  compute a real efficiency from.
- **"Sleep Score" was actually `sleepHours / 9 * 100`,** never the real
  `sleep_score` column the provider returns. The vitals grid and sleep card
  now both read `latest.sleepScore` and show "—" when the provider gave
  none, rather than a formula standing in for a measurement.
- **The bedtime recommendation was a string literal**, `"22:30 – 23:00"`,
  shown to every athlete regardless of schedule. Replaced by a target
  computed from real sleep debt and the athlete's own wake time.
- **The body-battery curve was a fixed decorative SVG path**
  (`M0 40 Q50 30 80 45 ...`) that no caller ever overrode — every athlete
  saw the same fictional day regardless of readiness or training.

**Done when:** the five sleep/energy fabrications above — the stage
breakdown, the `"22:30 – 23:00"` bedtime literal, "Efficiency", the
`sleepHours / 9 * 100` Sleep Score, and the fixed body-battery SVG path,
spanning eight code sites — are gone from the dashboard; a day with training
shows a curve that drops when the athlete actually trained; an athlete with
no wake time set sees a prompt, not a bedtime.

This release deliberately scoped itself to the sleep and energy cards. It
does **not** claim the dashboard is now free of invented numbers — see below.

**Known remaining work — the dashboard still fabricates elsewhere.** These
are pre-existing on `main`, untouched by this release, and named here so the
ledger is honest rather than flattering:

- **Recovery and Strain are already fabricated for manual-only athletes.**
  `recoveryScore` and `strainFraction` (`src/app/page.tsx`) derive from
  `latest?.atl ?? 0` / `latest?.ctl ?? 0`. `atl`/`ctl` are nullable and
  written only by the intervals.icu sync, so an athlete on v0.8's
  no-integration path has both `null` — and the `?? 0` coalesce renders a
  hero **"Recovery 60"** and **"Strain 0.0"** built from zero training data.
  This is live today, in the page's most prominent cards (`ScoreRing`,
  `StrainBudget`) and in the narrative text. Fixing it needs an honest
  null-propagation path for CTL/ATL — the same `calibrating` treatment
  readiness already gets — which is a larger change than this release.
- **The "This Week" rings are hardcoded** to `ringOuter={0.7}` /
  `ringInner={0.8}` for every athlete, forever — the same defect class as
  the body-battery path removed above. They were left alone rather than
  wired to `recoveryScore`/`strainFraction`, because doing so would only
  propagate the fabrication above into two more rings.
- **The logging "streak" is a count, not a streak** — `Math.min(window30.length, 30)`
  counts rows in a 30-day window, so 22 scattered days renders "22-day streak".
  Proper streak semantics land with Achievements in v0.9.2.

## v0.8.0 — 2026-07-16 — Data Freedom

Use Recover without any integrations. Log vitals and activities manually,
import CSV data, and unlock your readiness score from day one — no
intervals.icu required.

### Added

- **Manual-first onboarding**: the dashboard now offers three paths — start
  logging manually, connect intervals.icu, or import CSV data. No
  integration is required to begin.
- **Manual vitals entry**: when no integration is active, the journal form
  shows HRV, resting HR, sleep, and weight input fields. Synced values
  still auto-populate when an integration is connected.
- **Manual activity logging** (`/activity/log`): log rides, runs, swims, and
  other sessions with sport type, duration, distance, HR, power, elevation,
  and training load.
- **CSV import** (`/import`): upload wellness or activity CSVs with flexible
  column name mapping (supports common formats from Apple Health, Garmin,
  Whoop, and spreadsheets). Drag-and-drop upload, row preview, batch
  upsert.
- CSV parser tests (7 cases covering both wellness and activity formats).

### Fixed

- **Middleware was dead code**: `src/proxy.ts` exported a function named
  `proxy()` instead of `middleware()`, so Next.js never called it — no
  session redirects worked. Renamed to `src/middleware.ts` with the correct
  export. The route guard matcher (which correctly excludes `/api/mcp`,
  `/api/cron`, and public assets) is now active.
- **Behavior tag buttons did nothing**: dashboard tags were `<button>`
  elements with no click handler. Now link to the journal page.

## v0.7.0 — 2026-07-16 — Score Integrity

Stop the app from knowing things it doesn't know. Both fixes protect the
readiness score's foundation, which everything after this consumes.

### Fixed

- **The journal no longer invents answers.** Energy/soreness/stress
  initialized to 7/4/4 and were submitted on every save, so ticking a single
  behavior tag wrote three subjective numbers the athlete never gave —
  stored indistinguishably from real ones. Unanswered sliders now submit
  nothing, read `—`, and announce "not answered" to screen readers. A
  deliberate tap on the resting value is still kept.
- No existing data is deleted or altered: pre-v0.7 rows can't be separated
  from genuine answers, and destroying truth to hide a lie is worse.

### Added

- **Day flags** (🤒 ill, ✈️ travel, 🏔️ altitude): facts that invalidate a day
  as a baseline reference. Flagged days are excluded from the 60-day rolling
  baselines, so a week of flu no longer makes you read falsely green for the
  next two months.
- Flagged days are **still scored** — exclusion governs baseline membership
  only; an ill day should read red, it just shouldn't redefine "normal".
- Flagging a past day **retroactively repairs** every score after it.
- Over-flagging degrades honestly to `calibrating` rather than a confident
  wrong number.
- `get_wellness` returns day flags — the coach knowing you were ill changes
  its advice.

The readiness engine itself is unchanged: exclusion happens where the
baseline array is assembled, and `readiness.ts` and its tests are untouched.

## v0.6.2 — 2026-07-16 — Strava description fields

- **Field selection**: choose which metrics appear in your Strava descriptions, with a live preview rendered against your most recent activity
- Users who never customize keep the full v0.6 template unchanged
- Disabling every field skips the Strava write instead of publishing a bare marker

## v0.6.1 — 2026-07-15

Post-review fixes for v0.2–v0.5.

### Fixed

- **Strava AI firewall**: Strava-sourced activities were reaching two AI surfaces (coach context injection and weekly-review aggregates) — now excluded everywhere, per the Strava API terms.
- **Weekly review scheduling**: never fired under default settings (exact-hour match against the overnight sync). Now uses due-since-slot logic; default review slot Monday 04:00.
- **Weekly review visibility**: was stored with a role the thread view hides, so the dashboard link opened an empty thread. Now rendered.
- **Google Calendar**: access token now refreshes on expiry (the tool broke ~1 h after connecting); OAuth scope narrowed to FreeBusy-only.
- **Training plan**: removed adjustment actions that reported success without changing anything; plan writes made idempotent (at most one active plan; guarded week advance).
- **MCP tokens**: `write:plan` and `write:memory` scopes are now mintable, so all write-capable tools are authorizable.
- **OAuth redirects** use the public origin / `BETTER_AUTH_URL` rather than the container hostname; coach responses match the athlete's language.

## v0.6.0 — 2026-07-15 — Strava AI Descriptions

- **Strava write-back**: opt-in `activity:write` OAuth upgrade; auto-generates an emoji-rich metrics block (load, IF, TRIMP, form, PRs) from intervals.icu data and appends it below a `---` separator after sync, with a skip marker to prevent double-writes. Manual `describe_strava_activity` coach tool.

## v0.5.0 — Training Intelligence

- **Artifacts engine**: coach can output inline SVG charts (line, bar, area, table) in chat — collapsed preview with expand-on-click
- **Weekly review**: proactive weekly training summary with load comparison chart, configurable day/time
- **Calendar integration**: intervals.icu planned workouts visible to coach; Google Calendar OAuth for busy/free awareness
- **Training plan generation**: periodized multi-week plans from race goals (4–52 weeks, multi-sport, periodization guardrails)
- **20 MCP tools** (was 14): `render_chart`, `get_planned_workouts`, `get_calendar_availability`, `generate_training_plan`, `get_training_plan`, `update_training_plan`

## v0.4.0 — Unreleased

Coach intelligence.

### Added

- MCP depth: `get_power_curve`, `get_pace_curve`, `get_best_efforts` (intervals.icu precomputed, 6 h cache, stale-if-error) and weekly-bucket `get_training_load_summary`.

## v0.3.0 — 2026-07-14

Analytics depth.

### Added

- **Activity detail page** (`/activity/[id]`): stream charts (heart rate,
  power, pace, elevation) and a laps/intervals table. Streams are fetched
  lazily from intervals.icu on first view and cached; Strava/manual
  activities show the summary with a "no detailed data" note.
- **Performance page tabs** (Training | Wellness) with a 30/90/180/365-day
  range selector, both linkable via URL params.
- **Training tab**: PMC chart now spans the selected range and draws TSB as
  a filled area around zero; 12-week load bars; history list grouped by day
  with "load more", each row linking to the activity detail.
- **Wellness tab**: HRV and resting-HR trends (daily line, 7-day rolling
  average, personal 60-day baseline band) and a sleep chart (duration bars,
  score line, 8 h guide).
- Dashboard recent activities now link to their detail pages.

## v0.2.0 — 2026-07-14

Phone & daily loop.

### Added

- **Installable PWA**: web manifest, app icons, minimal service worker with
  offline fallback.
- **Morning readiness push** (web-push/VAPID): sent right after the overnight
  sync computes the day's score — at most once per day, only when a score
  exists, skipped while calibrating. VAPID keys are auto-generated and stored
  in the database (private key encrypted); no new configuration.
- **Notifications settings card**: per-device subscribe/unsubscribe, morning
  push preference, send-test-notification, iOS install hint.
- **Manual resync**: dashboard sync chip ("Synced 12m ago ⟳") and
  pull-to-refresh in the installed app, backed by a rate-limited
  `/api/sync/now` (one per 2 minutes per user).

## v0.1.0 — 2026-07-14

First tagged release: the core loop works end-to-end, self-hosted.

### Added

- **intervals.icu sync** — wellness (HRV, resting HR, sleep), activities, and
  precomputed CTL/ATL, kept fresh by an in-process scheduler with idempotent
  jobs and a `/api/cron` fallback for serverless deploys.
- **Readiness engine** — daily score from 60-day rolling personal baselines
  (HRV 40%, resting HR 25%, sleep 20%, form/TSB 15%), with a calibrating
  state below 14 days of history and a persisted component breakdown.
- **Dashboard, performance log, and behavior journal** — readiness/recovery/
  strain rings, strain budget, training stress balance chart, wellness
  sliders, mood/tags/notes.
- **AI coach** — streaming chat with an evidence-based endurance-coach
  persona that cites real numbers via a shared tool registry. Bring your own
  key: Anthropic or any OpenAI-compatible endpoint (Ollama included). Keys
  encrypted at rest (AES-256-GCM).
- **MCP server** — stateless streamable-HTTP endpoint at `/api/mcp` with
  hashed, scoped (`read` / `write:wellness`), revocable bearer tokens and
  rate limiting, exposing nine tools shared with the coach.
- **Multi-user** — invite-only signup, owner/member roles, full per-user data
  isolation across web and MCP.
- **Strava OAuth** — second activity source with provenance tracking;
  excluded from AI/MCP context by default per Strava's API terms.
- **Self-hosting** — multi-stage Docker image (published to GHCR for
  amd64/arm64), docker-compose with Postgres 16 and optional Cloudflare
  tunnel profile, migrations applied automatically on boot.
- **Demo seed** — `SEED_DEMO=1 npm run db:seed-demo` generates 90 days of
  deterministic, plausible training history for demos and screenshots.
