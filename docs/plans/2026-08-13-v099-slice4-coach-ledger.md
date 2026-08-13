# v0.99 slice 4 — Coach pre-migration baseline ledger

Captured 2026-08-13 against `.screenshots/slice4-baseline/`, dev server on
`localhost:3100`, dev DB (port 5435), demo athlete `demo@recover.local`.
Command: `SCREENSHOT_BASE_URL=http://localhost:3100 OWNER_EMAIL=demo@recover.local
OWNER_PASSWORD=recover-demo npx tsx scripts/verify-surfaces.ts slice4-baseline`.
Exit code 1 (expected — the project's axe baseline is deliberately non-zero
across all surfaces, not just Coach's).

Whole-run totals (all 20 surfaces, not just Coach): 80 axe-report entries,
357 confirmed-defect nodes across 28 rule findings in 25/80 combinations,
1919 indeterminate nodes across 80 rule findings in 80/80 combinations.

## Coach: 12/12 entries present

`coach`, `coach-history`, `coach-thread` × {light, dark} × {phone, desktop} —
all 12 appear in `axe-report.json`, none skipped, none errored.

| surface       | theme | viewport | confirmed nodes (rule) | indeterminate nodes (rule) |
|---------------|-------|----------|-------------------------|------------------------------|
| coach         | light | phone    | 4 (color-contrast)      | 3 (color-contrast)           |
| coach-history | light | phone    | 15 (color-contrast ×2)  | 6 (color-contrast)           |
| coach-thread  | light | phone    | 2 (color-contrast)      | 4 (color-contrast)           |
| coach         | dark  | phone    | 0                        | 7 (color-contrast)           |
| coach-history | dark  | phone    | 10 (color-contrast)     | 10 (color-contrast)          |
| coach-thread  | dark  | phone    | 0                        | 6 (color-contrast)           |
| coach         | light | desktop  | 3 (color-contrast)      | 3 (color-contrast)           |
| coach-history | light | desktop  | 3 (color-contrast)      | 3 (color-contrast)           |
| coach-thread  | light | desktop  | 1 (color-contrast)      | 5 (color-contrast)           |
| coach         | dark  | desktop  | 0                        | 8 (color-contrast)           |
| coach-history | dark  | desktop  | 0                        | 8 (color-contrast)           |
| coach-thread  | dark  | desktop  | 0                        | 7 (color-contrast)           |

Coach subtotal: 38 confirmed nodes, 70 indeterminate nodes. Every confirmed
and indeterminate rule fired is `color-contrast` — no other axe rule
triggered on any Coach surface in either theme.

## What the PNGs showed (opened all 12 with Read, not just listed)

### `coach` (empty state)
- **Light (phone + desktop): a real, reproducible bug.** The three
  quick-prompt suggestion pills ("How should I train today?", "Why is my HRV
  low?", "Analyze my week") render as **completely blank white pills — the
  text is invisible**, apparently white-on-white or near-white-on-white. On
  phone, the header's icon-only button (left of "History") is blank too. This
  is exactly what the confirmed color-contrast counts capture (4 nodes
  phone, 3 nodes desktop).
- **Dark: renders correctly.** All three pills show legible white text on a
  dark pill background, the "Ask about your readiness…" card and its icon
  are legible, 0 confirmed violations — but axe still reports 7-8
  indeterminate color-contrast nodes per viewport, worth a follow-up look
  even though nothing here gates the exit code.
- A red "1 Issue" pill bottom-left, with an "N" badge, is the **Next.js
  dev-mode indicator**, not app UI — it is present on every phone capture
  across the whole run (not Coach-specific) and on phone it visually overlaps
  the bottom tab bar's "Coach" label. Noise from running against `next dev`,
  not a defect to fix.

### `coach-history` (`/coach?history=1`)
- **Desktop (both themes): pixel-identical to plain `coach`.** By design —
  `src/app/coach/page.tsx` wraps the `HistorySheet` overlay in
  `<div className="lg:hidden">`; the code comment says desktop reads History
  from a header dropdown instead. Net effect: **the desktop History
  experience remains completely uncaptured by this baseline** — this task
  only reaches the mobile sheet. Out of this task's literal scope (the brief
  asked only for `/coach?history=1`) but worth flagging for whoever picks up
  the desktop dropdown next.
- **Phone (both themes): the actual History panel**, and it renders
  correctly. All five `KIND_STYLE` tiles are visible and distinguishable:
  amber sun ("Morning brief"), green check ("Ride debrief — Tempo along the
  Vecht"), purple clipboard ("Weekly review"), red warning triangle
  ("Overtraining watch — hrv suppressed"), blue circle ("Monthly report") —
  plus a "Search chats & reviews" box and a "CHATS" section below with three
  rows ("How should I train today?" ×2, and a third partly hidden behind the
  dev-mode badge).
- **Light mode has a second, phone-only defect on top of the shared one:**
  the "History" heading and "Search chats & reviews" placeholder render at
  visibly lower contrast in light than in dark — axe agrees: light/phone is
  15 confirmed nodes across **two** color-contrast rule rows vs dark/phone's
  10 nodes across **one**.
- The "1 Issue" dev badge visually truncates the last visible chat row in
  the sheet on phone — dev-server chrome, not an app defect, but it does
  obscure real content in the capture.

### `coach-thread` — the important finding, not just a screenshot note
The resolved thread is **not** the seeded `kind: "chat"` thread ("Should I
go hard today?") the brief and task context describe. All four
`coach-thread` PNGs show the header/content for **"Morning brief"** — a
`kind: "morning"` **inbox** thread, single assistant bubble, content
"**Readiness 71 (amber).** HRV 48 ms is a touch under your 30-day
median…" — matching the seeded inbox item's text, not the "threshold
intervals" conversation.

Root cause: `HistorySheet` renders both inbox-item links (History panel's
"FROM YOUR COACH" section) and real chat-thread links (its "CHATS" section)
with the identical `href="/coach?thread=<id>"` pattern
(`src/components/coach/history-panel.tsx:98,153,171`). The resolver's
selector `a[href^="/coach?thread="]` cannot distinguish them, and "FROM YOUR
COACH" is listed first in DOM order with its newest item on top — which is
the one seeded item left `unread`. `.first()` therefore always lands on that
inbox item, not on a chat thread.

Confirmed against the dev DB: `chat_threads` row `6130a665-…` (kind
`morning`) has `read_at = 2026-08-13 21:27:27+00`, set during this run —
proof `markThreadRead` (called unconditionally in `coach/page.tsx` for any
`?thread=` id) fired on the inbox thread, which is precisely the outcome the
task's context note warned against ("Do NOT resolve an inbox thread instead;
that would make repeat runs differ").

Practical consequences for this baseline:
- The captured `coach-thread` state is a single-assistant-bubble inbox
  detail, not the intended 4-message back-and-forth. **User-message
  bubbles, and any assistant/user bubble pairing, are still not captured or
  audited anywhere in this baseline.**
- Separately, and true regardless of which thread had resolved: seed data
  is plain markdown with no artifact payloads, so **ArtifactCard is not
  exercised by any seeded state**, and the typing indicator / error banner
  are transient states a static capture cannot reach at all. All three
  remain genuinely open gaps for whoever plans the next capture pass.
- Because the same inbox item is always the newest unread one, repeat runs
  will keep resolving to it deterministically (not flip-flopping) — so this
  is a wrong-target bug, not a flaky/nondeterministic one. It does not
  block treating the 12/12-entries requirement as met.

Visually, `coach-thread` reproduces the light-mode invisible-text bug seen
in `coach`: on light/phone the assistant bubble is a blank white box with no
visible text, and a header pill is blank too (axe: 2 confirmed nodes
light/phone, 1 light/desktop, 0 dark both). Desktop's header pill shows the
resolved thread's actual title ("Morning brief"); phone's header instead
shows a generic "Coach" heading with a separate "HISTORY" button — the two
viewports use different header chrome for the same state.

## Screenshot inventory

```
.screenshots/slice4-baseline/coach-{light,dark}-{phone,desktop}.png
.screenshots/slice4-baseline/coach-history-{light,dark}-{phone,desktop}.png
.screenshots/slice4-baseline/coach-thread-{light,dark}-{phone,desktop}.png
```
All 12 present and opened.

## Open concerns for follow-up (not fixed here — baseline-only task)

1. Light-theme invisible-text bug affecting quick-prompt pills, header icon
   buttons, and message bubbles across `coach`/`coach-thread` (confirmed by
   axe, corroborated visually).
2. `coach-history` on desktop captures nothing new — the desktop History
   affordance (header dropdown) has no capture path yet.
3. `resolveCoachThreadPath`'s selector resolves to an inbox thread, not the
   seeded chat thread — the multi-turn conversation, ArtifactCard, typing
   indicator, and error banner remain uncaptured by this slice.
