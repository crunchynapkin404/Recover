/**
 * Public origin for absolute URLs sent to third parties (OAuth redirect
 * URIs). Behind the Cloudflare tunnel, Next 16's `req.url` carries the
 * container hostname instead of the public Host, so callback URLs must be
 * derived from BETTER_AUTH_URL (the canonical public origin).
 */
export function publicBaseUrl(req: Request): string {
  return process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
}
