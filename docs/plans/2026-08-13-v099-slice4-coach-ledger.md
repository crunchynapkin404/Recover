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
   thread that _looked_ plausible (a real `kind: "chat"` row, correctly
   excluding inbox items) but wasn't multi-turn, and only checking the
   rendered bubbles — not just the resolved href — would have caught it. The
   captures below are from this corrected run.

## Coach: 12/12 entries present

`coach`, `coach-history`, `coach-thread` × {light, dark} × {phone, desktop} —
all 12 appear in `axe-report.json`, none skipped, none errored.

| surface       | theme | viewport | confirmed nodes (rule)                                          | indeterminate nodes (rule) |
| ------------- | ----- | -------- | --------------------------------------------------------------- | -------------------------- |
| coach         | light | phone    | 5 (color-contrast ×2)                                           | 3 (color-contrast)         |
| coach-history | light | phone    | 14 (color-contrast ×2)                                          | 6 (color-contrast)         |
| coach-thread  | light | phone    | 7 (color-contrast, scrollable-region-focusable, color-contrast) | 6 (color-contrast)         |
| coach         | dark  | phone    | 0                                                               | 8 (color-contrast)         |
| coach-history | dark  | phone    | 8 (color-contrast)                                              | 11 (color-contrast)        |
| coach-thread  | dark  | phone    | 1 (scrollable-region-focusable)                                 | 12 (color-contrast)        |
| coach         | light | desktop  | 4 (color-contrast ×2)                                           | 3 (color-contrast)         |
| coach-history | light | desktop  | 4 (color-contrast ×2)                                           | 3 (color-contrast)         |
| coach-thread  | light | desktop  | 3 (color-contrast)                                              | 9 (color-contrast)         |
| coach         | dark  | desktop  | 0                                                               | 9 (color-contrast)         |
| coach-history | dark  | desktop  | 0                                                               | 9 (color-contrast)         |
| coach-thread  | dark  | desktop  | 0                                                               | 13 (color-contrast)        |

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

| surface       | confirmed (this run) | indeterminate (this run) | status                                                                                                                                                                                                                      |
| ------------- | -------------------: | -----------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| coach         |   9 nodes (2 combos) |      23 nodes (4 combos) | Confirmed — light-theme quick-prompt pills invisible; dark clean of confirmed defects.                                                                                                                                      |
| coach-history |  26 nodes (3 combos) |      29 nodes (4 combos) | Confirmed — light-theme heading/search + shared pill bug; desktop still uncaptured (out of this task's scope).                                                                                                              |
| coach-thread  |  11 nodes (3 combos) |      40 nodes (4 combos) | Confirmed, and now against the RIGHT thread — both `.chat-bubble-user` and `.chat-bubble-ai` verified present and rendering in all 4 captures; light-theme assistant-bubble text is invisible, dark-theme is fully legible. |

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
   **RESOLVED — see Task 11 close-out below.**
2. `coach-history` on desktop captures nothing new — the desktop History
   affordance (header dropdown) still has no capture path.
   **STILL OPEN — unchanged by Task 11, see below.**
3. `resolveCoachThreadPath` took three attempts to resolve correctly (see
   History section above) — the fix is now in place (DB cleanup +
   bubble-presence assertion instead of trusting DOM order), but future dev
   DB debris (any stray single-message `kind: "chat"` thread with a newer
   `updatedAt` than the seed) will be caught by the assertion throwing,
   rather than silently producing a wrong-but-plausible-looking baseline
   again.

---

## Task 11 close-out: post-redesign browser pass (2026-08-14)

Tasks 3–10 tokenised the surfaces this baseline flagged (bottom-sheet shell,
history panel, the five inbox-kind colours, chat header/composer, the
message list, artifact-card). This section records Task 11's job: re-run the
capture, open every PNG, fix what only a PNG (not axe) can show, and check
the one shared component this slice touched for a regression on surfaces
that shipped in _earlier_ slices.

Command (dev server on `localhost:3100`, dev DB port 5435, same demo
athlete): `SCREENSHOT_BASE_URL=http://localhost:3100
OWNER_EMAIL=demo@recover.local OWNER_PASSWORD=recover-demo npx tsx
scripts/verify-surfaces.ts slice4`. Exit code non-zero (expected — five
other surfaces, `settings`/`admin`/`import`/`activity-log`/`login`/
`settings-token-created`, carry the project's deliberate non-zero baseline
in light/desktop and light/phone; none of them are Coach and none of this
task's changes touched them).

### Confirmed-node count: 46 → 0, all 12 entries

| surface       | theme | viewport | confirmed (baseline) | confirmed (this pass) | indeterminate (this pass) |
| ------------- | ----- | -------- | -------------------: | --------------------: | ------------------------: |
| coach         | light | phone    |                    5 |                 **0** |        2 (color-contrast) |
| coach-history | light | phone    |                   14 |                 **0** |        5 (color-contrast) |
| coach-thread  | light | phone    |                    7 |                 **0** |        1 (color-contrast) |
| coach         | dark  | phone    |                    0 |                 **0** |        7 (color-contrast) |
| coach-history | dark  | phone    |                    8 |                 **0** |       10 (color-contrast) |
| coach-thread  | dark  | phone    |                    1 |                 **0** |        7 (color-contrast) |
| coach         | light | desktop  |                    4 |                 **0** |                         0 |
| coach-history | light | desktop  |                    4 |                 **0** |                         0 |
| coach-thread  | light | desktop  |                    3 |                 **0** |        1 (color-contrast) |
| coach         | dark  | desktop  |                    0 |                 **0** |        6 (color-contrast) |
| coach-history | dark  | desktop  |                    0 |                 **0** |        6 (color-contrast) |
| coach-thread  | dark  | desktop  |                    0 |                 **0** |        6 (color-contrast) |

**Coach subtotal: 46 confirmed nodes → 0.** All remaining findings are
`color-contrast` in axe's own indeterminate bucket (computed over the
gradient ground `body::before`/`::after` paint on `today`/`coach`/`body`,
per the file header of `scripts/verify-surfaces.ts`) — never gates the exit
code, and is why the PNG pass below is not optional: axe scoring
`color-contrast` INDETERMINATE over a gradient is exactly the gap that let
earlier slices ship invisible text at a "clean" 0-confirmed axe result. This
pass re-opened every PNG specifically because a 0 here is not, by itself,
evidence of anything.

Whole-run totals (all 20 surfaces): 80 entries, 313 confirmed-defect nodes
across 14 rule findings (all five non-Coach surfaces named above, all
light-theme), 1936 indeterminate nodes across 78 rule findings.

### Defects the PNGs (not axe) surfaced, and how they map to what fixed them

Three defects were live in the working tree when this task started; two were
already fixed and uncommitted, one (the ghost banner) was still open.
Axe's `confirmed: 0` above already reflects the first two — it cannot
reflect the third, because the ghost banner is client-only React state
(`ghost && !activeThreadId`) behind no URL parameter `verify-surfaces.ts`'s
`SURFACES` map can reach; the pipeline's 12 coach captures never render it
at all. Confirming and fixing it required a throwaway Playwright script
(same technique as `resolveCoachThreadPath`'s manual checks — logged in,
390×844 viewport matching `VIEWPORTS.phone`, then read the DOM directly)
rather than the checked-in capture pipeline. Three such scripts
(`scripts/tmp-ghost-check.ts`, `tmp-composer-check.ts`, `tmp-manual-verify.ts`)
were used for this pass and deleted afterward — none are committed.

1. **`scrollable-region-focusable` on the message transcript.** The
   scrollable `<main>` wrapping the message list had no way to reach it by
   keyboard — its children are message text, not controls. Fixed by adding
   `tabIndex={0}` with an explanatory comment. Axe rule, confirmed by the
   axe pass (Step 3), not something that needed a PNG to see.
2. **Composer thinking-mode toggle, 4.1:1 on desktop.** The active
   quick/deep pill used a translucent `bg-accent/20` tint under solid
   `text-accent` — the same own-hue-at-low-opacity trap Task 5 fixed for the
   inbox kind tiles, here landing just under the 4.5:1 AA floor instead of
   well under it (desktop only; the label text is `hidden lg:inline`, so
   phone never rendered the failing pair). Fixed by switching to solid
   `bg-accent text-accent-foreground` — the same idiom already used for the
   send button and the "Configure AI Coach" CTA — which clears 4.5:1 with
   real margin in both themes (5.48:1 light, 8.28:1 dark). Axe rule,
   confirmed by the axe pass, not a PNG finding either.
3. **Ghost banner wraps to two lines at the pipeline's real phone width
   (390px).** Task 6 shortened the copy from "Ghost chat — deletes in 24 h,
   coach won't save memories" to "Ghost chat — deletes in 24 h, no memories
   saved" _and_ lifted it off a sub-floor `text-[9px]` onto the 12px
   `text-label` floor — intended as a one-line fix, but the floor's larger
   type re-broke the one-line goal the shorter copy was going for. Verified
   two ways: visually (a manual capture at 390px showed "…NO MEMORIES" /
   "SAVED" split across two lines) and by measurement
   (`getClientRects()` on the text node reported `lineCount: 2`). **Fixed by
   reducing `tracking-widest` (0.1em) to `tracking-wide` (0.025em)** —
   copy unchanged, `text-label` (12px) unchanged, both required facts (it's
   a ghost chat; it disappears in 24h) still present. Re-measured after the
   change: `lineCount: 1`, text node 364px wide inside a 390px-wide line
   (~13px clear on each side). Also holds at 375px (the iPhone SE logical
   width, and the number the Task 11 plan-doc checklist names) — 364px fits
   inside 375px too. Does not hold at 320px (`lineCount: 2`, out of scope:
   neither the pipeline nor the plan doc's checklist targets 320px, and
   320px is not a device the capture pipeline or any named checklist item
   tests). Both light and dark confirmed one line at 390px.

### The PNG pass: all 12 coach PNGs opened, per-item findings

1. **The five inbox-kind tiles are legible in light** (Task 5's whole
   purpose — the old amber measured 1.93:1 on its own tint). Confirmed on
   `coach-history-light-phone.png`, close-cropped 2× for a direct look:
   Morning brief (amber-brown glyph on pale cream), Ride debrief (forest
   green on pale mint), Weekly review (indigo on pale lavender), Overtraining
   watch (brick-red on pale pink), Monthly report (navy on pale blue) — all
   five clearly readable, none close to invisible. Dark theme (already
   working pre-migration) still reads correctly alongside it.
2. **History stamps did not eat the chat titles.** Task 4's own commit
   message flagged this as a real risk it hit and fixed (`truncate` without
   `min-w-0` on a flex child collapsed when every stamp widened 9.5px →
   12px) by adding `min-w-0` to the title span. Confirmed on
   `coach-history-{light,dark}-phone.png`: every row's title truncates
   cleanly with an ellipsis, the stamp column ("Thu", "Wed", "Mon", "Sat",
   "Aug 1", "Jul 14") sits clear of it at a fixed width, no overlap.
3. **Ghost banner sits on one line at 390px, after the fix above.**
   Confirmed by direct measurement, not just visual read (see previous
   section). Not reachable through the checked-in capture pipeline's 12
   PNGs — verified through a throwaway script instead, then deleted.
4. **Message bubbles read correctly, no leftover gap from the deleted
   per-message timestamp.** Task 7 removed a `new Date()` called inside
   `messages.map` (it showed render time, not message time — a correctness
   bug, not just a legibility one) with no spacer left behind. Confirmed on
   all four `coach-thread` PNGs: consistent `mb-6` spacing between message
   groups throughout, no dead gap where the old timestamp span used to sit.
5. **Mobile "Coach" heading at 20px (`text-title`, down from a literal
   `text-[22px]`) still looks right.** Confirmed on
   `coach-{light,dark}-phone.png`, close-cropped: bold, clearly legible,
   well-balanced against the 40px ghost/History/new-chat button row beside
   it — reads as an intentional page title, not cramped.
6. **Inbox tile borders, 30%-alpha translucent → opaque `ink` token — reads
   as intended, not too heavy.** Traced to Task 5's commit
   (`70e9e35`): the old tile used one raw hue at 12% for the fill and 30%
   for the border; now an ink/tint token pair per kind, with the border
   using the _same_ full-opacity ink as the glyph. Close-cropped both
   themes: the border reads as a deliberate, proportionate frame in the same
   hue family as the fill and glyph (a "badge" look, not a harsh outline),
   and is doing real work — several of the pale light-theme fills (cream,
   lavender) would otherwise have no visible edge against the white row
   background. Not too heavy in either theme.

**Text collision, checked generally** (the "MOTUWETHFRSASU" day-strip
failure mode named in the Task 11 checklist): none found in any of the 12
coach PNGs. (The day-strip itself is a Today surface, not Coach — separately
confirmed clean across all 12 `today*` PNGs opened for the regression check
below.)

**Unrelated, not in scope:** every phone-viewport coach capture shows a red
"N · 1 Issue" Next.js dev-mode overlay badge bottom-left (collapsed to a
plain "N" icon on `today*` captures). Traced to the dev server's own startup
warning ("Detected additional lockfiles" — this worktree and the main
checkout each have one) — an artifact of capturing against `next dev` in a
worktree, present on every page project-wide, not Coach-specific and not
caused by this task's changes.

### Regression check: the shared bottom-sheet shell (Task 3) on surfaces shipped in earlier slices

`src/components/ui/bottom-sheet.tsx` is shared by `today/checkin-sheet.tsx`
and `debrief/debrief-sheet.tsx` (both pre-date this slice). Task 3
(`ec7aaee`) moved its panel border and grab handle from `--hairline`'s old
translucent value to the redesign's opaque one, and its panel background
token accordingly (dark theme: border/handle `#2e2e2f` → `#6b6b6b`, panel
background `#111113` → `#1f1f1f` — confirmed against the live
`--hairline`/`--surface-overlay` values in `globals.css`).

Neither sheet lives at a URL `verify-surfaces.ts`'s `SURFACES` map opens
(they render behind `?sheet=checkin` / `?sheet=debrief&activity=<id>`), so
the `today*` PNGs in `.screenshots/slice4/` — all 12 opened, light/dark ×
phone/desktop × {today, today-post-session, today-evening} — show the page
behind the sheet, not the sheet itself, and all 12 are clean (no collision,
no legibility issues, correct data per state). Actually seeing the shell
required the same throwaway-script technique as the ghost banner: logged
in, navigated straight to `/?sheet=checkin` and
`/?sheet=debrief&activity=<real seeded activity id>`, dark theme only —
`src/components/theme-provider.tsx` sets `forcedTheme="dark"` until a future
slice lifts it, so dark is the only theme real users can reach today, and
`checkin-sheet.tsx`'s body content hard-codes `text-white`/`bg-white/[…]`
throughout rather than using theme tokens (pre-existing, unrelated to Task
3, and not a regression it introduced — light theme for these two sheets is
simply not built yet).

**Verdict: looks right, not merely different.** Both sheets, both viewports,
dark theme: the panel reads as a clearly distinct surface lifted above the
dimmed backdrop, the grab handle is easily visible (a real improvement over
a border the old value sat at ~1.1–1.3:1, functionally invisible), and the
border gives the rounded top edge clean definition without looking heavy.
Content inside both sheets (sliders, tag pills, RPE/FEEL buttons, the
green "Save" CTAs) is unaffected by Task 3 (it doesn't touch shell tokens)
and renders exactly as before. No regression found — this confirms the
earlier reviewer's judgment that the shell change was intended.

### Dev DB cleanup

`api_tokens` held 48 rows with `label LIKE 'screenshot-verify-%'` (47
revoked, 1 not — an orphaned token from an interrupted run that never
reached `captureTokenCreated`'s revoke-through-the-UI cleanup step; the
script's own file header documents this exact accumulation and says to
delete by label prefix, never touching a row that doesn't match it). All 48
deleted. Six unrelated rows left untouched: `Claude Desktop` (the one real,
active token) and five other non-`screenshot-verify` test-artifact labels
(`p4r-smoke-test`, two `check-token-box-*`, two `RENDERED-PASS-*`) — out of
this task's stated scope, not evaluated further.

### Still open after this task

- **`coach-history` on desktop still has no capture path** (open concern #2
  above, unchanged). By design, not a bug: `src/app/coach/page.tsx` only
  renders the History overlay on `lg:hidden` — desktop reads History from
  the header dropdown (`showThreadMenu` state in `chat-interface.tsx`),
  which no URL parameter opens. `coach-history-{light,dark}-desktop.png`
  are pixel-identical to plain `coach-{light,dark}-desktop.png`, confirmed
  intentional by reading `page.tsx`'s own comment, not a defect.
- **`checkin-sheet.tsx` / `debrief-sheet.tsx` have no light-theme
  expression** (noted above) — deferred behind `forcedTheme="dark"`, not
  this task's scope, not a regression.
