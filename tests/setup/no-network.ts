/**
 * Fails any test that reaches the real network.
 *
 * Nothing enforced this before. `tests/scheduler.test.ts` seeds an *active*
 * intervals_icu connection and runs tick passes over it, and the only reason
 * no HTTP request left the machine is incidental: the seeded row carries a
 * placeholder `encryptedAccessToken` of `"x"`, `decrypt()` runs before the
 * request is built (src/lib/sync/intervals-sync.ts, src/lib/sync/activity-poll.ts),
 * and it throws on the `iv:authTag:ciphertext` format check in
 * src/lib/crypto.ts before the key is ever applied — so this holds under any
 * key, not just the all-zeros one CI uses. The day a test seeds a
 * properly-encrypted token, CI runners would start calling intervals.icu for
 * real — flaky for us, and rude to a third party this project depends on.
 *
 * This replaces that coincidence with a property. Code under test should take
 * an injected fetcher (see src/lib/webhooks/dispatch.test.ts, which passes
 * `fetcher` as a parameter) rather than reaching for the global.
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
