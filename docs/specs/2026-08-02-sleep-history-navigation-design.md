# Sleep History Navigation: Design

**Date:** 2026-08-02
**Status:** Approved
**Target release:** v0.35.0

## Goal

`/body` → Sleep shows exactly one night: the most recent row with a non-null
`sleepSecs`. Everything else in the 90-day window the tab already loads is
unreachable.

That became a visible problem the day v0.33 shipped. Sleep stages now arrive
from intervals.icu, and the Intervals.icu Companion writes a night's _native_
fields (duration, SpO2, HR) before it writes that night's _stages_ — verified
2026-08-02, where `2026-08-01` had `sleepSecs 26492` with `DeepSleep`,
`REMSleep` and `LightSleep` all absent, while 2026-07-27 → 07-31 were fully
populated. The card selects the newest night with a duration, lands on the one
night without stages, and reports that the provider does not send stages at
all. Five complete nights sat one click away, except there was no click.

Done when: an athlete can move between recent nights, can see at a glance
which nights have stage data, and the no-stages message distinguishes "this
provider never sends stages" from "not for this night yet".

## Decisions

| Decision          | Choice                                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation shape  | A strip of recent nights above the card, each with a mini stage bar, plus prev/next arrows on the card header. The strip is what answers "which nights have stages" without clicking through them one at a time.                                                                                          |
| URL state         | `?night=YYYY-MM-DD`, added as a third axis to `buildBodyHref` alongside `tab` and `range`. Omitted when the selection is the latest night, so the default URL stays clean.                                                                                                                                |
| Sibling state     | The night axis goes **through `buildBodyHref`**, never a hand-built href. v0.19 shipped `ViewTabs`/`RangeTabs` with hand-built hrefs that silently dropped sibling state on every click; the shared builder is the fix that already exists.                                                               |
| Validation        | `night` must match `^\d{4}-\d{2}-\d{2}$` **and** correspond to a loaded night; anything else falls back to the latest night. A malformed id reaching Postgres as a raw literal 500'd this app once (v0.23, `/activity/[id]`), so the param is never passed to a query unvalidated.                        |
| Strip contents    | The last **14 nights that have sleep data**, not 14 calendar nights. Arrows step through the same list, so the two controls can never disagree and there are no dead clicks into empty nights. Gaps stay legible through the date labels.                                                                 |
| Stage-less nights | Rendered in the strip with a dimmed flat bar rather than omitted — that state is the whole reason this feature exists, so it must be visible, not hidden.                                                                                                                                                 |
| Client state      | None. `SleepTab` stays an async server component; the strip and arrows are `<Link>`s, matching the existing `RangeTabs` pattern on the same page.                                                                                                                                                         |
| Accessibility     | The selected cell carries `aria-current="date"`. This project shipped a nav that was visibly active but unmarked for screen readers (v0.23), caught only by a real browser.                                                                                                                               |
| Aggregates        | `consistency` and `chronotype` are 30-day aggregates and do **not** describe the selected night. They move out of the night card's footer so they stop reading as properties of it.                                                                                                                       |
| Forward-looking   | `bedtimeTonight` is about tonight, not the night on screen. Hidden whenever the selection is not the latest night — otherwise browsing to 27 July advises a bedtime for a night eleven days gone.                                                                                                         |
| No-stages copy    | "Your provider doesn't send sleep stages — total time only" is kept **only** when no night in the window has stages. A night lacking them while siblings have them says "No stages recorded for this night yet." With navigation both states are hit constantly, so the distinction stops being cosmetic. |

## Architecture

### Href builder — `src/lib/log-href.ts`

`buildBodyHref` gains a `night` axis:

```ts
export function buildBodyHref(
  current: { tab: BodyTab; range: number; night?: string },
  over: { tab?: BodyTab; range?: number; night?: string }
): string;
```

`night` is written to the query string only when non-empty. Passing `""`
clears it (returning to "latest night"), mirroring how the existing `sport`
override uses `""` to clear a filter in `buildLogHref`.

### Night selection — `src/app/body/page.tsx`

`SleepTab` currently takes only `userId`. It gains `night` (the raw param) and
an `href` builder, matching how `TrendsTab` already receives `range`/`href`.

Selection is a pure helper so it can be tested without a DB or a render:

```ts
// src/lib/sleep-history.ts
export function selectNight<
  T extends { date: string; sleepSecs: number | null },
>(
  nights: T[],
  requested: string | undefined
): { selected: T | null; recent: T[]; index: number };
```

- `recent` = the last `SLEEP_HISTORY_NIGHTS` (14) entries with a non-null
  `sleepSecs`, oldest → newest.
- `selected` = the entry in `recent` matching `requested`, else the newest.
- `index` = position of `selected` within `recent`, for the arrows; `-1` when
  `recent` is empty.

Keeping this out of the page component is what makes the arrow/strip agreement
testable rather than something to eyeball.

### Strip — `src/components/body/sleep-history-strip.tsx`

A new presentational component: one `<Link>` per night, each with a date
label and a mini stage bar built from the same fractions the main card uses.
Nights without stages get a single dimmed bar. Horizontally scrollable
(`overflow-x-auto`) so 14 cells never force the page to scroll sideways on a
phone.

### Night card — `src/components/body/sleep-night-card.tsx`

Gains optional `prevHref` / `nextHref` (rendered as `‹` / `›`, omitted at the
ends of the list) and a `heading` string so it can say "Fri 31 Jul" instead of
always "Last night". `consistency`/`chronotype` props are removed — those move
to their own row in the tab. The `stagesUnsupported` boolean picks between the
two no-stages messages.

## Testing

- **`selectNight`** (pure, no DB): picks the newest night by default; honours
  a valid request; falls back on an unknown or malformed date; caps `recent`
  at 14; excludes nights with a null `sleepSecs`; returns a consistent `index`
  so arrows and strip cannot disagree.
- **`buildBodyHref`**: carries `night` alongside `tab` and `range`; changing
  the tab preserves the night and vice versa; `""` clears it; the latest-night
  case omits the param.
- **Card**: renders "No stages recorded for this night yet" when
  `stagesUnsupported` is false, the provider-level message when true, hides
  `bedtimeTonight` when a past night is selected, and omits `‹`/`›` at the
  ends. Rendered with `renderToString` — this repo has no
  `@testing-library/react`.
- The suite is run **once with `DATABASE_URL` unset** as a distinct gate step.
  A green local run cannot catch a missing `describe.skipIf(!hasDb)`; that is
  how v0.33 turned PR #35 red after a fully green local gate.

## Verification

After deploy, load `/body?tab=sleep`, confirm the strip shows the recent
nights with 2026-08-01 visibly stage-less and 07-27→07-31 populated, click
back to 07-31 and confirm real stages render. Curl cannot settle this — it is
blind to stacking, click interception and interaction outcomes, which is how
three real bugs reached the v0.23 redesign. Use a real browser.

## Out of scope

- Changing the tab's 90-day fetch window.
- A date picker for arbitrary jumps; the strip plus arrows covers recent
  history, and anything older is a different feature.
- Per-night notes or editing.
- Backfilling the missing stages themselves — that is upstream, and whether
  the Companion ever writes a given night's stages is not Recover's to fix.
