# Disposition of `feat/v0.65-mcp-contract-hardening`

**Date:** 2026-08-10
**Outcome:** branch evaluated piece by piece, two pieces salvaged into this
document, the rest declined with reasons. **The branch is deletable.**

## What it was

One WIP commit (`4fe86a3`), a snapshot of uncommitted work found in the v0.65
worktree during the post-v0.65 cleanup and committed so it could not be lost.
Never reviewed, never verified. Until 2026-08-10 it existed only on the
developer's machine; `origin` carried just `main`. It was pushed as a backup,
then evaluated here.

At evaluation it was **138 commits behind `main`**.

## Why it could not be merged as it stood

It adds `drizzle/0040_quiet_hours.sql`. `main` already has
`drizzle/0040_surface_views.sql` — v0.66's telemetry, journal `idx` 40. Two
migrations, one number. Anything landing from this branch needs renumbering to
0041 and a regenerated journal entry.

That is a mechanical blocker, not the reason most of it was declined.

## Piece-by-piece

| Piece                                          | Disposition                       |
| ---------------------------------------------- | --------------------------------- |
| `executeIcuTool()` in `icu-connection.ts`      | **Salvaged** — see below          |
| Triathlon confidence downgrade in `demand.ts`  | **Salvaged** — see below          |
| `get_recommendation_scorecard` MCP tool        | **Declined**                      |
| `get_backup_status` MCP tool                   | **Deferred** to Phase 4           |
| Push quiet hours (migration + settings + gate) | **Deferred** past Phase 2         |
| `frozen-tools` snapshot update                 | Falls away with the two new tools |

### Declined: `get_recommendation_scorecard`

It reads `trainingBlocks.adherencePct` directly. That column was documented as
**cache** by v0.85's adherence slice, with `weekAdherencePct()` as the owner.
A new tool reading the cache directly is a new read site bypassing the owner —
the same defect class v0.86 spent a whole release removing from five
coach- and MCP-facing surfaces, reintroduced immediately after the slice that
closed it.

It also invents three athlete-facing figures with no source and no confidence
— `rollingAdherencePct`, `trendPct`, and a derived `quality` label. Phase 2a
requires every exported engine constant to carry source, confidence and scope;
Phase 2's non-goals forbid adding a new figure at all during Phase 2.

If a scorecard is wanted later it is a Phase 3 item built on
`weekAdherencePct()`, not this code.

### Deferred: `get_backup_status`

Harmless in itself — it reads `getOpsSnapshot()` and reports backup age, which
is ops data rather than a training number. But Phase 4 is explicit that the MCP
surface must be **measured** before it is frozen or grown, and this branch also
updates the frozen-tools snapshot to admit it. It waits for that measurement.

Worth noting separately: on the live instance `backupAgeS` is currently `null`,
which this tool would render as "Never backed up". That is an ops finding about
the instance, not about the tool.

### Deferred: push quiet hours

Migration 0040 + a settings card + gating in `push.ts`. This is new
athlete-facing capability, which Phase 2's non-goals rule out for the duration.
When it lands, its migration renumbers to 0041.

## Salvage 1 — `executeIcuTool()`, and why it should be finished

This is the most valuable thing in the branch, and the commit message does not
lead with it. The helper wraps both the connection guard and `ConnectorError`
handling:

```ts
export async function executeIcuTool<T>(
  ctx: ToolContext,
  run: (connection: IcuConnection) => Promise<T>
): Promise<T | { error: string }> {
  const connection = await activeIcuConnection(ctx);
  if (!connection) return { error: "No active intervals.icu connection" };
  try {
    return await run(connection);
  } catch (error) {
    if (error instanceof ConnectorError) {
      return { error: error.message };
    }
    throw error;
  }
}
```

The branch applies it to exactly one tool (`icu_update_wellness`). Measured
against `main` on 2026-08-10:

| Measure                                                           |  Count |
| ----------------------------------------------------------------- | -----: |
| icu tools calling `activeIcuConnection`                           | **24** |
| hand-writing the identical `"No active intervals.icu connection"` | **23** |
| catching `ConnectorError`                                         |  **0** |

The last row is the finding. Today, when intervals.icu is down, rate-limits, or
the token has gone stale, a `ConnectorError` propagates as an **unhandled throw
out of every one of those tools**. The guard everyone duplicated is the easy
half; the error path nobody wrote is the one that matters.

This is the actual "MCP contract hardening" the branch is named for, and it is
1/24 done. It belongs on the roadmap as its own scoped item — hardening, not
new capability, so it does not trip Phase 2's non-goals. It is how 23 MCP
surfaces speak when they cannot answer, which is the goal sentence's third
clause on a surface 2b.3 never reached.

## Salvage 2 — triathlon demand confidence downgrade

Five lines in `eventDemand()`, to fold into Phase 2c's **Event demand** slice,
which opens that file anyway. It _lowers_ a claim rather than raising one,
which is what 2a favours and what the non-goals permit ("presentation may
change, claims may not" — reducing a claim is not making one).

Inserted after the `confidence == null` block in
`src/lib/race/demand.ts`:

```ts
if (input.sport === "Triathlon" && confidence === "medium") {
  confidence = "low";
  confidenceReason = `${confidenceReason} Multi-sport estimates are downgraded because swim, bike, and run anchors interact.`;
}
```

Its test, from `src/lib/race/demand.test.ts`:

```ts
it("downgrades a fully anchored triathlon to low confidence", () => {
  const result = eventDemand({
    ...BASE,
    sport: "Triathlon",
    raceType: "ironman",
    distanceKm: 226,
    ftp: { watts: 310, athleteSet: true },
    runPace: { secPerKm: 300, athleteSet: true },
    swimPace: { secPer100m: 120, athleteSet: true },
  });
  expect(result.available).toBe(true);
  if (!result.available) return;
  expect(result.confidence).toBe("low");
  expect(result.confidenceReason).toContain("downgraded");
});
```

Neither is adopted verbatim without review — the test asserts against a `BASE`
fixture whose current shape must be re-checked, and per
`docs/ROADMAP.md`'s slice conditions the downgrade needs mutation-checking
before it counts as guarded.

## Why the branch can now be deleted

Everything in it has a decision, and everything worth keeping is reproduced
above. A WIP branch 138 commits behind, carrying a colliding migration and one
tool that reintroduces a defect class the project just spent a release
removing, is a merge hazard rather than an asset. The record belongs here,
where it will be read.
