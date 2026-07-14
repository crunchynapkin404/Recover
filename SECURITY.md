# Security Policy

Recover is a self-hosted app that stores health data and encrypted API keys,
so security reports are taken seriously — even though this is a hobby project.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting: **Security → Report a
vulnerability** on this repository. You'll get a response as soon as
realistically possible for a spare-time project — usually within a week.

Please include reproduction steps and the deployment mode (docker compose,
from source, Vercel).

## Supported versions

Only the latest release receives fixes. Self-hosters should upgrade with
`docker compose pull && docker compose up -d` (migrations apply automatically).

## Scope notes for self-hosters

- Connector and LLM keys are encrypted at rest (AES-256-GCM) with your
  `ENCRYPTION_KEY`; treat that key and your database backups as secrets.
- MCP tokens are stored hashed (SHA-256), scoped, and revocable in
  **Settings → MCP API Tokens**. Revoke anything you don't recognize.
- Signup is invite-only by design; the `/api/mcp` endpoint is rate-limited
  and requires a bearer token.
- If you expose Recover publicly, prefer the built-in Cloudflare tunnel
  profile or your own reverse proxy with TLS.
