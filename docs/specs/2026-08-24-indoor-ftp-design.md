# Indoor FTP fallback anchor — design

`docs/ROADMAP.md`'s demand map, row "Different FTPs indoor/outdoor" — 105
votes, genuinely absent. Written 2026-08-24, the day after
`docs/2026-08-20-demand-map-handoff.md` re-read the board and recommended this
row next: "the only one of the three whose machinery already exists — you are
splitting a number, not building a model." Every claim below about existing
behaviour was read out of the file that implements it.

## What exists today

One column, `bodyPrefs.ftpWatts` (`src/lib/db/schema.ts:588`), read by five
call sites: `training-load.ts` (per-activity historical intensity),
`volume-inputs.ts`/`demand.ts` (weekly demand and feasibility), `riding-time.ts`
(hours-to-finish, shared by feasibility and pacing), `pacing.ts` (race-day
target, v0.116.0), and the Settings UI (`body-prefs-card.tsx`).

There is no indoor/outdoor concept anywhere in the schema — not on `bodyPrefs`,
not on `activities`, not on planned sessions. Strava's own `VirtualRide` type
exists in the raw synced payload but is discarded at ingestion:
`canonical-sport.ts` collapses both `Ride` and `VirtualRide` into plain `Bike`.

`pacingAnchors()` (`src/lib/race/service.ts`) and `volume-inputs.ts` each
resolve "the athlete's FTP" with their own duplicated fallback —
`prefs?.ftpWatts ?? (eftp derived, low confidence)` — independently. Not a
defect introduced here, but directly relevant: this design adds a third tier
to that fallback, and duplicating a three-way branch a second time would make
the existing drift risk worse, not just leave it alone.

## Scope: race-day and planning anchors only

Races have no indoor concept in this app's model either — a race is always
outdoors. So "indoor FTP" can never mean "use it for race day"; its only
honest role is a **fallback anchor** when outdoor FTP isn't set, at explicitly
lower confidence. That fixes the scope question by construction: this design
touches `pacing.ts`, `riding-time.ts`'s callers, and `demand.ts`. It does not
touch `training-load.ts`.

**Non-goal, explicitly: historical training-load.** `training-load.ts` divides
every past activity's recorded power by one FTP to compute how hard it was.
Doing that correctly per-activity needs an indoor/outdoor classifier on each
activity, which does not exist and is not cheap to build honestly (provider
payloads vary; `VirtualRide` is a Strava-ism, not a universal signal). That is
a data-model project, not a Settings field, and is out of scope here.

## Decisions

| #   | Decision                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | New nullable column `bodyPrefs.ftpWattsIndoor`, existing `ftpWatts` unchanged in name and meaning                                                                                               | Additive migration, zero risk to existing rows or to the frozen MCP surface (no tool schema references a column name). Renaming `ftpWatts` to `ftpWattsOutdoor` was considered and rejected — it touches 15 files and 3 tool-adjacent shapes for a label, not a behavior change.                                                                                                     |
| D2  | One shared `resolveFtpAnchor()` in `src/lib/race/service.ts`, replacing both existing duplicates                                                                                                | `pacingAnchors()` and `volume-inputs.ts` must agree on what "the athlete's FTP" means — the same reasoning `raceCard()` was built for in v0.87, one caller diverging from the other silently.                                                                                                                                                                                        |
| D3  | Fallback order: outdoor (athlete-set) → indoor (athlete-set) → synced eFTP (derived) → refuse                                                                                                   | Mirrors the existing two-tier pattern (`thresholdPaceSecPerKm`'s own contract: "null = derive from history, then refuse") with one more honest tier inserted before the derived one, not a new shape.                                                                                                                                                                                |
| D4  | The FTP anchor's `athleteSet: boolean` becomes `source: "outdoor" \| "indoor" \| "synced"`, threaded everywhere FTP flows. `runPace`'s own `athleteSet` is untouched — this design is FTP only. | A superset, not a breaking change: `"outdoor"\|"indoor"` collapse to today's `true`, `"synced"` to today's `false`. Needed because "indoor" and "synced" must get different confidence and different `why` text, and a boolean cannot carry three states.                                                                                                                            |
| D5  | `source === "indoor"` forces `confidence: "low"` and adds a new `why` fragment, in both `pacing.ts` and `demand.ts`                                                                             | Same mechanism already used for the `long`/`derived` checks in `pacing.ts` (`[BIKE_WHY, long ? ... : null, derived ? ... : null]`) — an added branch, not a new code path. Using an indoor number for an outdoor estimate is a real approximation and must say so, per this codebase's uncertainty-vocabulary convention (`docs/specs/2026-08-08-uncertainty-vocabulary-design.md`). |
| D6  | No MCP schema change                                                                                                                                                                            | `get_race_pacing`'s output already carries `confidence` and free-text `why`; the new tier only enriches that text. `API-STABILITY.md`'s additive-only rule isn't in play because nothing about the tool's shape changes.                                                                                                                                                             |

## The shared resolver

```ts
// src/lib/race/service.ts
export interface FtpAnchor {
  watts: number;
  source: "outdoor" | "indoor" | "synced";
}

export function resolveFtpAnchor(
  prefs: { ftpWatts: number | null; ftpWattsIndoor: number | null } | null,
  latestEftp: number | null
): FtpAnchor | null {
  if (prefs?.ftpWatts != null)
    return { watts: prefs.ftpWatts, source: "outdoor" };
  if (prefs?.ftpWattsIndoor != null)
    return { watts: prefs.ftpWattsIndoor, source: "indoor" };
  if (latestEftp != null)
    return { watts: Math.round(latestEftp), source: "synced" };
  return null;
}
```

`pacingAnchors()` calls this once and returns `ftpSource` alongside the
existing `ftpWatts`/`massKg`/`thresholdPaceSecPerKm` fields (dropping
`ftpAthleteSet` — every caller of `pacingAnchors()` is inside this diff).
`volume-inputs.ts` calls it once in place of its own inline `ftpSet ?? ftpSynced`
and passes `{ watts, source }` as `EventDemandInput.ftp`.

## Confidence and why-text

`pacing.ts`'s `PacingInput.ftpAthleteSet?: boolean` becomes
`ftpSource?: "outdoor" | "indoor" | "synced"`. The bike branch's `derived`
check (`input.ftpAthleteSet === false`) becomes `input.ftpSource === "synced"`;
a new `indoorFallback` check (`input.ftpSource === "indoor"`) adds
`INDOOR_ANCHOR_WHY = "Uses your indoor FTP — outdoor effort may differ."` to
the `why` chain and forces `confidence: "low"` the same way `long`/`derived`
already do.

`demand.ts`'s `Priced.allAnchorsAthleteSet: boolean` becomes
`weakestAnchorSource: "outdoor" | "indoor" | "synced"`. `runPace` is untouched
by this design (still `{ secPerKm, athleteSet: boolean }` — the ask is FTP
only) and a triathlon sums a Bike leg (tri-state `ftp.source`) and a Run leg
(boolean `runPace.athleteSet`), so the two must reconcile on one scale to take
the worst. Rank them `outdoor: 0, indoor: 1, synced: 2` and map
`runPace.athleteSet` onto the same scale as `true → 0, false → 2` — it never
produces `1`, since running has no indoor tier here. `weakestAnchorSource` is
the highest rank among whichever anchors the event's legs actually needed,
mapped back to its label. Confidence/reason text built from it gets the
analogous `"indoor"` branch.

## Schema and migration

```ts
// src/lib/db/schema.ts, in bodyPrefs, beside ftpWatts
ftpWattsIndoor: integer("ftp_watts_indoor"),
```

Drizzle-kit generated, additive-only `ALTER TABLE ... ADD COLUMN`. No backfill,
no rollback constraint — same shape as v0.116.0's own "None" migrations note.

## Settings UI

`body-prefs-card.tsx`: the existing "FTP (watts)" label becomes
"FTP (watts) — outdoor"; a second optional input, "FTP (watts) — indoor
(optional)", reuses the existing `MIN_FTP`/`MAX_FTP` validation constants.
`body-actions.ts`'s `setBodyPrefs` input and validation grow one field,
identical pattern to the existing `ftpWatts` check.

## Touch points with no design decision

`export/import-user.ts` adds the new field for symmetry — it already
round-trips `ftpWatts` the same way and needs no new reasoning, just the
second field.

`icu-sport-settings-shape.ts` was investigated and found to be unrelated: it
maps `ftp` from intervals.icu's own `SportSettings` API payload — a separate,
external data source (one FTP per intervals.icu profile, spanning
`Ride`+`VirtualRide`) — not from this app's `bodyPrefs` table. It needs no
change and was correctly left alone.

## Testing

Unit tests for `resolveFtpAnchor`'s four branches (outdoor set, indoor set,
synced, none) and for the new confidence/why-text branch in both `pacing.ts`
and `demand.ts`'s existing test suites, mutation-checked per
`docs/RELEASING.md` step 3 (break the `source === "indoor"` check, confirm a
test fails, revert). No new capture surface: the pacing line's rendered shape
is unchanged, only its `why` text in the fallback case, which a unit test
asserts more precisely than a screenshot would.
