# Recover

**Your training and recovery, in one calm place — self-hosted and free.**

Recover is a small, self-hosted health and training companion: Whoop-style readiness scoring, training load, and an AI coach — without the subscription, the wearable lock-in, or anyone else holding your data. It pulls wellness (HRV, resting HR, sleep) and activities from intervals.icu into your own Postgres, computes a daily readiness score from your personal baselines, and shows it on a clean dashboard.

The part we care most about: Recover is a **bridge between your Claude and your training data**. It ships a built-in MCP server, so Claude (or any MCP client) can read your readiness, wellness, and training load with a scoped token — and the in-app coach uses the same tools with your own Anthropic key or any OpenAI-compatible endpoint (Ollama included). Your keys stay encrypted in your database; nothing phones home.

An honest hobby project built for one owner and about ten friends. AGPL-3.0, Docker-first, one `docker compose up`. If it's useful to you, self-host it and make it yours.

## Status

Early days — intervals.icu sync + dashboard + auth work; Docker packaging, the readiness engine, AI coach, and the MCP server are next. Full plan: [docs/PLAN.md](docs/PLAN.md).

## Stack

Next.js 16 · TypeScript · Postgres + Drizzle · Better Auth · Tailwind + shadcn · Recharts · Vercel AI SDK · @modelcontextprotocol/sdk

## License

AGPL-3.0 — see [LICENSE](LICENSE).
