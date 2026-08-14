# v0.99 slice 4 — Coach pre-migration baseline ledger

Captured 2026-08-14 against `.screenshots/slice4-baseline/`, dev server on
`localhost:3100`, dev DB (port 5435), demo athlete `demo@recover.local`.
Command: `SCREENSHOT_BASE_URL=http://localhost:3100 OWNER_EMAIL=demo@recover.local
OWNER_PASSWORD=recover-demo npx tsx scripts/verify-surfaces.ts slice4-baseline`.
Exit code 1 (expected — the project's axe baseline is deliberately non-zero
across all surfaces, not just Coach's).

Whole-run totals (all 20 surfaces, not just Coach): 80 axe-report entries,
359 confirmed-defect nodes across 28 rule findings in 20/80 combinations,
1956 indeterminate nodes across 80 rule findings in 80/80 combinations.

## History: this baseline took three attempts to resolve the right thread

`resolveCoachThreadPath`'s job is to find the seeded `kind: "chat"` thread
("Should I go hard today?", 4 messages) so `coach-thread` captures a real
multi-turn conversation — a user bubble AND an assistant bubble, plus the
message-list chrome around them. It took three attempts to actually do that:

1. **First attempt (commit `ea18c26`).** Selector `a[href^="/coach?thread="]`
   `.first()`. `HistoryPanel` renders inbox-item links ("From your coach")
   and chat-thread links ("Chats") with the identical `/coach?thread=<id>`
   href shape, and inbox items render first in DOM order with the newest
   (the one seeded item deliberately left unread) on top. The resolver
   always landed on that inbox item — a `kind: "morning"` thread ("Morning
   brief") with a single assistant bubble and no user bubble at all — and,
   as a side effect, `markThreadRead` fired on it, permanently flipping the
   seed's one deliberately-unread item to read.
2. **Second attempt (this task's starting point, before today's DB
   cleanup).** `history-panel.tsx` gained a `data-chat-thread` marker on the
   "Chats" links specifically, and the resolver switched to
   `a[data-chat-thread]`.first() — correctly excluding inbox items. But the
   dev DB held two stray one-message `kind: "chat"` threads (both titled
   "How should I train today?", created 2026-07-25, `updatedAt` newer than
   the real seeded thread's 2026-07-14), left over from earlier UI
   exploration. `HistoryPanel` orders "Chats" by `updatedAt` descending, so
   `.first()` still landed on a stray single-message thread instead of the
   seeded 4-message conversation — still not multi-turn, just a different
   wrong thread than attempt 1.
3. **This run.** Two fixes together: (a) the two stray single-message
   threads were deleted from the dev DB (verified before/after: exactly one
   `kind: "chat"` thread — the seeded one — remains for
   `demo@recover.local`, and the inbox's one deliberately-unread assistant
   message is untouched at 1); (b) `resolveCoachThreadPath` no longer trusts
   DOM order at all — after resolving an href it now navigates there and
   reads the real rendered DOM for `.chat-bubble-user` and `.chat-bubble-ai`
   (see `chat-interface.tsx`), throwing rather than proceeding if either is
   absent. This is what actually caught attempt 2's bug: DOM order picked a
   thread that *looked* plausible (a real `kind: "chat"` row, correctly
   excluding inbox items) but wasn't multi-turn, and only checking the
   rendered bubbles — not just the resolved href — would have caught it. The
   captures below are from this corrected run.

## Coach: 12/12 entries present

`coach`, `coach-history`, `coach-thread` × {light, dark} × {phone, desktop} —
all 12 appear in `axe-report.json`, none skipped, none errored.

| surface       | theme | viewport | confirmed nodes (rule)                                  | indeterminate nodes (rule) |
|---------------|-------|----------|-----------------------------------------------------------|------------------------------|
| coach         | light | phone    | 5 (color-contrast ×2)                                      | 3 (color-contrast)           |
| coach-history | light | phone    | 14 (color-contrast ×2)                                     | 6 (color-contrast)           |
| coach-thread  | light | phone    | 7 (color-contrast, scrollable-region-focusable, color-contrast) | 6 (color-contrast)      |
| coach         | dark  | phone    | 0                                                           | 8 (color-contrast)           |
| coach-history | dark  | phone    | 8 (color-contrast)                                          | 11 (color-contrast)          |
| coach-thread  | dark  | phone    | 1 (scrollable-region-focusable)                             | 12 (color-contrast)          |
| coach         | light | desktop  | 4 (color-contrast ×2)                                       | 3 (color-contrast)           |
| coach-history | light | desktop  | 4 (color-contrast ×2)                                       | 3 (color-contrast)           |
| coach-thread  | light | desktop  | 3 (color-contrast)                                          | 9 (color-contrast)           |
| coach         | dark  | desktop  | 0                                                           | 9 (color-contrast)           |
| coach-history | dark  | desktop  | 0                                                           | 9 (color-contrast)           |
| coach-thread  | dark  | desktop  | 0                                                           | 13 (color-contrast)          |

Coach subtotal: 46 confirmed nodes, 92 indeterminate nodes. Every confirmed
and indeterminate rule fired is `color-contrast`, **except** `coach-thread`
light/phone and dark/phone, which now also fire `scrollable-region-focusable`
once each — a rule that never appeared in attempt 1's numbers, because a
single-bubble inbox detail has no scrollable message list to trigger it. Its
appearance here is itself evidence this run is auditing a real, taller,
multi-message conversation rather than the one-bubble page attempt 1 audited.

## What the PNGs showed (all four `coach-thread` PNGs opened with Read, by eye)

### `coach-thread` — now the seeded 4-message conversation, both bubble types confirmed
All four captures (light/dark × phone/desktop) show the real seeded thread,
header "Should I go hard today? · 1", with the actual 4-message exchange:
user "I have threshold intervals planned. Should I go through with them?" →
assistant readiness/HRV/TSB advice → user "Fair. What should this week look
like overall?" → assistant weekly-plan advice.

- **Dark (phone + desktop): fully legible, both bubble types clearly
  visible.** User bubbles render as light-grey pills with dark text on the
  right; assistant bubbles render as darker cards with light text on the
  left, both readable end to end. This is the surface working as intended.
- **Light (phone + desktop): the pre-existing invisible-text bug, now
  visible on a real assistant reply instead of a single inbox blurb.** User
  bubbles are legible (dark text on a light-grey pill). **Assistant bubbles
  render as blank white boxes — the text is present in the DOM
  (`.chat-bubble-ai` matched, satisfying the resolver's assertion) but
  invisible, apparently white-on-white or near-white-on-white.** This
  matches axe's confirmed color-contrast counts on this surface (3 nodes
  desktop, 7 nodes phone) and is the same defect already recorded against
  the `coach` empty state's quick-prompt pills — now confirmed to also hit
  real conversation content, not just placeholder UI. **This is a
  PRE-migration finding to record, not a bug to fix in this task** — it is
  exactly the kind of defect the eventual light-theme pass exists to close.
- The mobile phone view's header for `coach-thread` shows a "1 Issue"
  Next.js dev-mode badge bottom-left, unrelated app chrome present on every
  phone capture project-wide, not Coach-specific.

### `coach` (empty state) — unchanged from attempt 1, not re-described in detail here
Same defect as before: light theme's three quick-prompt pills render
blank/white-on-white (axe: 5 nodes phone, 4 nodes desktop, two
color-contrast rule rows each); dark theme renders correctly with only
indeterminate findings.

### `coach-history` (`/coach?history=1`) — unchanged from attempt 1, not re-described in detail here
Desktop remains pixel-identical to plain `coach` (the `HistorySheet` overlay
is `lg:hidden`; desktop reads History from a header dropdown this baseline
still does not reach). Phone shows the real panel; light/phone still carries
its own second contrast defect on top of the shared one (14 confirmed nodes
across two color-contrast rule rows vs dark/phone's 8 nodes/one rule row).
Now correctly lists exactly one row under "Chats" ("Should I go hard
today?") instead of three — the two stray single-message threads that
cluttered attempt 1 and 2's `coach-history` captures are gone.

## Screenshot inventory

```
.screenshots/slice4-baseline/coach-{light,dark}-{phone,desktop}.png
.screenshots/slice4-baseline/coach-history-{light,dark}-{phone,desktop}.png
.screenshots/slice4-baseline/coach-thread-{light,dark}-{phone,desktop}.png
```
All 12 present and opened (all four `coach-thread` PNGs opened and described
by eye per this task; `coach`/`coach-history` carried forward from attempt
1's already-verified observations, re-confirmed present in this run's axe
report).

## Corrected confirmed/indeterminate status, per surface

| surface       | confirmed (this run) | indeterminate (this run) | status |
|---------------|----------------------:|---------------------------:|--------|
| coach         | 9 nodes (2 combos)     | 23 nodes (4 combos)         | Confirmed — light-theme quick-prompt pills invisible; dark clean of confirmed defects. |
| coach-history | 26 nodes (3 combos)    | 29 nodes (4 combos)         | Confirmed — light-theme heading/search + shared pill bug; desktop still uncaptured (out of this task's scope). |
| coach-thread  | 11 nodes (3 combos)    | 40 nodes (4 combos)         | Confirmed, and now against the RIGHT thread — both `.chat-bubble-user` and `.chat-bubble-ai` verified present and rendering in all 4 captures; light-theme assistant-bubble text is invisible, dark-theme is fully legible. |

"Confirmed" here means: the resolver's own bubble-presence assertion passed
for all four `coach-thread` captures (this is what makes the table above
trustworthy rather than another instance of a run emitting files without
proving what's in them), and the axe numbers were re-extracted directly from
`axe-report.json` after this run, not carried over from attempt 1's document.
No surface in this table is "indeterminate" in the sense of unresolved
status — indeterminate here only ever refers to axe's own
could-not-compute-a-ratio bucket (see file header of
`scripts/verify-surfaces.ts` for why that bucket exists and never gates the
exit code).

## Open concerns for follow-up (not fixed here — baseline-only task)

1. Light-theme invisible-text bug affecting quick-prompt pills, header icon
   buttons, and — now confirmed — real assistant message bubbles across
   `coach`/`coach-history`/`coach-thread`. Axe-confirmed and corroborated
   visually on real conversation content, not just placeholder UI.
2. `coach-history` on desktop captures nothing new — the desktop History
   affordance (header dropdown) still has no capture path.
3. `resolveCoachThreadPath` took three attempts to resolve correctly (see
   History section above) — the fix is now in place (DB cleanup +
   bubble-presence assertion instead of trusting DOM order), but future dev
   DB debris (any stray single-message `kind: "chat"` thread with a newer
   `updatedAt` than the seed) will be caught by the assertion throwing,
   rather than silently producing a wrong-but-plausible-looking baseline
   again.
