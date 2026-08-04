/**
 * Blocks any outbound fetch and rejects, naming the URL it tried to reach.
 * No bytes leave the machine either way — that's the property that matters.
 * Whether a *test* itself goes red is a separate question: an unhandled
 * rejection fails the run, but a caller that swallows it (see the tick's
 * hooks, below) will not.
 *
 * Nothing enforced this before, but no test today actually reaches the
 * network to prove it mattered. `runActivityPolls`
 * (src/lib/sync/activity-poll.ts) only runs when `providerPassesEnabled()`
 * holds, and that's `!process.env.VITEST` (src/lib/sync/scheduler.ts:37-39)
 * — off under vitest, so the module is never even imported. `runIntervalsSync`
 * (src/lib/sync/intervals-sync.ts) is reachable only through the tick's
 * `defaultProcessor`, and every test caller of `runSchedulerTick` passes a
 * stub processor instead (tests/scheduler.test.ts,
 * tests/scheduler-housekeeping-guard.test.ts, tests/describe-hook.test.ts,
 * tests/morning-hook.test.ts). `tests/scheduler.test.ts` does seed an
 * *active* intervals_icu connection, but the tick block that runs never
 * touches that user — the connection sits under a different seeded user
 * than the one whose jobs the tick claims.
 *
 * The real exposure is the tick's post-job hooks — `runAutoDescribeStrava`,
 * `generateWeeklyReview`, `runRaceDebriefs`, `runDebriefLifecycle`
 * (src/lib/sync/scheduler.ts:345-420) — which are NOT behind
 * `providerPassesEnabled()` and run with real imports inside `try/catch`.
 * This project has already taken that hit once: an unguarded DB-wide tick
 * pass billed a real LLM ride review into the owner's own coaching thread.
 * That is the guard this file adds.
 *
 * Code under test should take an injected fetcher (see
 * src/lib/webhooks/dispatch.test.ts, which passes `fetcher` as a parameter)
 * rather than reaching for the global.
 */
function describeTarget(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

globalThis.fetch = ((input: RequestInfo | URL) => {
  const target = describeTarget(input);
  return Promise.reject(
    new Error(
      `Blocked outbound fetch to ${target} — tests must not reach the network. ` +
        `Inject a fetcher into the code under test instead of using the global ` +
        `fetch (see src/lib/webhooks/dispatch.test.ts for the pattern).`
    )
  );
}) as typeof globalThis.fetch;
