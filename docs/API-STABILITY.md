# API/MCP Stability

Recover exposes one capability surface — `allTools` in
`src/lib/tools/registry.ts` — to two consumers: the in-app AI coach and the
MCP server at `/api/mcp` (`src/app/api/mcp/route.ts`). "One registry, two
consumers" (see the comment at the top of `registry.ts`) means every tool a
`claude.ai` connector or Claude Code session sees over MCP is exactly the
same object the in-app coach calls — there is no separate, hand-maintained
MCP schema to drift out of sync.

As of **v0.20**, that surface — **54 tools**, their names, required scopes,
and input schemas — is **frozen**. This is the point past which the sweep's
API/MCP freeze task (`docs/specs/2026-07-21-v0.20-final-sweep-design.md`)
was placed last in the release: nothing else in the sweep touches a tool
schema after this doc and its guard test land.

## What "frozen" means

For each tool in `allTools`:

- **`name`** — the identifier an MCP client calls (`get_readiness`,
  `icu_create_event`, etc.) does not change.
- **`scope`** — the required token scope (`read`, `write:wellness`,
  `write:memory`, `write:plan`, `write:strava`, `write:icu`, defined in
  `src/lib/mcp/token-auth.ts`) does not change. A tool does not get quietly
  upgraded to a scope that existing tokens no longer satisfy, nor
  downgraded to run under a scope narrower than what it actually needs.
- **`parameters`** (the zod input schema, serialized to JSON Schema via
  `z.toJSONSchema()`) does not change shape — no field renamed, retyped,
  made required, or removed. **Additive, backward-compatible changes** (a
  new _optional_ field) are allowed without bumping past a minor version,
  but still require updating the frozen snapshot deliberately (see below)
  and a CHANGELOG entry.
- The **tool count** (54) is asserted directly, so an accidental add or
  remove is caught even in the pathological case where a rename happens to
  collide with another entry's old name.

`description` is deliberately **not** part of the frozen surface. It is
documentation text an MCP client may show a user, not part of the wire
contract — rewording it for clarity or fixing a typo should not require a
deprecation cycle. If a `description` edit ever _implies_ a behavior change,
that's a signal the underlying `execute`/`parameters` contract changed too,
which the freeze test below does catch.

## The mechanical guard

`src/lib/tools/__tests__/frozen-tools.test.ts` is the enforcement
mechanism, not just documentation of intent:

- `MCP tool count is frozen` — fails if `allTools.length !== 54`.
- `MCP tool surface is frozen (names + scopes + schemas)` — snapshots
  `{ name, scope, schema }` for every tool, sorted by name, via Vitest's
  `toMatchSnapshot()` against
  `src/lib/tools/__tests__/__snapshots__/frozen-tools.test.ts.snap`.

Both tests are DB-independent (they only inspect the static tool
definitions) and run unguarded in CI on every PR — a freeze test that could
be skipped isn't a freeze test.

**A red freeze test does not mean "fix the test."** It means a tool's wire
contract changed. Before updating the snapshot, confirm the change follows
the deprecation policy below (or is a genuinely additive, backward-
compatible change with its own CHANGELOG entry), then re-run
`npx vitest run src/lib/tools/__tests__/frozen-tools.test.ts -u` to accept
the new snapshot deliberately — never as a side effect of an unrelated
change.

## Deprecation policy

Removing or breaking a tool is sometimes the right call (a connector goes
away, a capability gets superseded). When it is:

1. **Minimum one minor-version notice before removal.** A tool scheduled
   for removal ships in a release with a `deprecated: true` marker (see
   below) at least one full minor version before the release that actually
   removes it or breaks its schema. Point releases (patch versions) never
   remove or break a tool.
2. **`deprecated` marker during the notice window.** Add a `deprecated`
   field to the `ToolDefinition` (`src/lib/tools/registry.ts`) — e.g.
   `deprecated: "Superseded by get_week_plan; removed in v0.22."` — so
   both the AI coach and any MCP client introspecting the tool list can
   surface the warning. The tool keeps working exactly as before during
   this window; `deprecated` is advisory, not a behavior change.
3. **CHANGELOG entry required for any surface change.** Adding a tool,
   deprecating one, changing a scope, or altering a schema (even
   additively) gets its own `CHANGELOG.md` entry under the release that
   ships it — "quietly" changing the frozen surface without a changelog
   line is treated the same as a test regression.
4. **Update the frozen snapshot in the same commit** as the surface change,
   with the CHANGELOG entry explaining why. The snapshot diff in that
   commit _is_ the reviewable record of what changed in the wire contract.

## Scope of the freeze

This policy covers the **shape** of the tool surface — what a client can
call and with what arguments. It does not freeze:

- **Tool behavior/output content** beyond what the schema promises (e.g.
  `get_readiness`'s band thresholds can be tuned without a schema change).
- **`description` text** (see above).
- Anything outside `allTools` — the MCP transport (`/api/mcp`), auth
  (`src/lib/mcp/token-auth.ts`), and rate limiting are versioned by normal
  code review, not this freeze.

## Self-hoster impact

If you run Recover self-hosted and have a `claude.ai` connector or Claude
Code MCP session configured against it: upgrading within the v0.20.x line
never breaks your existing tool calls. A future minor version that
deprecates a tool will say so in `CHANGELOG.md` and keep the tool callable
for at least one more minor version after that notice — you will not wake
up to a silently broken integration.
