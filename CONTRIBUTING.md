# Contributing to Recover

Thanks for your interest! Recover is a small self-hosted project maintained in
spare time — contributions are welcome, and small, focused ones land fastest.

## Development setup

Requirements: Node 22+, Docker (for Postgres).

```bash
git clone https://github.com/crunchynapkin404/Recover.git
cd Recover
npm ci
cp .env.example .env        # set ENCRYPTION_KEY + BETTER_AUTH_SECRET at minimum

# Postgres from the compose file (published on 127.0.0.1:5434 for host tooling)
docker compose up -d db
echo 'DATABASE_URL=postgres://recover:recover@127.0.0.1:5434/recover' >> .env
echo 'DATABASE_DRIVER=pg' >> .env

npm run db:migrate          # apply migrations
npm run db:seed             # owner account (uses OWNER_EMAIL/OWNER_PASSWORD)
npm run dev
```

### Demo data

For UI work and screenshots, seed a demo account with 90 days of plausible
training history (deterministic and idempotent — safe to rerun):

```bash
SEED_DEMO=1 npm run db:seed-demo
# login: demo@recover.local / recover-demo
```

## Quality gates

CI runs all of these; run them locally before pushing:

```bash
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
```

## Principles

A few rules this codebase holds itself to (the long version is in
[docs/PLAN.md](docs/PLAN.md)):

1. **No broken imports.** Code isn't copied from other projects on trust —
   anything ported arrives with unit tests proving it, or it's rewritten.
2. **One tool registry, two consumers.** Every data capability is a single
   `{name, description, inputSchema, execute}` object in `src/lib/tools/`,
   serving both the AI coach and the MCP endpoint. New capability = one file.
3. **Provenance everywhere.** Every activity/wellness row records its source;
   Strava rows are excluded from AI contexts by default.
4. **Secrets encrypted at rest**, decrypted per request, never logged.
5. **Boring operations.** One container + Postgres. No new infrastructure
   dependencies without a very good reason.

## Pull requests

- Keep PRs focused — one change per PR, no drive-by refactors.
- New behavior comes with tests (`tests/` and `src/**/*.test.ts` have
  examples of both unit and integration styles).
- Security-sensitive surfaces (auth, MCP endpoint, token handling, crypto)
  get extra scrutiny; expect questions.
- Check [docs/ROADMAP.md](docs/ROADMAP.md) before building a big feature —
  open an issue first so we can agree on direction before you invest time.

## Reporting bugs

Use the issue templates. For anything security-sensitive, **do not open a
public issue** — see [SECURITY.md](SECURITY.md).
