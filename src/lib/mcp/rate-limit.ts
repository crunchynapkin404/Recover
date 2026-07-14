/**
 * In-memory token bucket rate limiter for /api/mcp.
 * Simple per-token rate limiting: X requests per window.
 */

const DEFAULT_MAX_TOKENS = 60; // requests
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Check and consume a rate limit token for the given key.
 * Returns whether the request is allowed.
 */
export function checkRateLimit(
  key: string,
  maxTokens = DEFAULT_MAX_TOKENS,
  windowMs = DEFAULT_WINDOW_MS
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= windowMs) {
    bucket.tokens = maxTokens;
    bucket.lastRefill = now;
  }

  const resetMs = windowMs - (now - bucket.lastRefill);

  if (bucket.tokens <= 0) {
    return { allowed: false, remaining: 0, resetMs };
  }

  bucket.tokens--;
  return { allowed: true, remaining: bucket.tokens, resetMs };
}

// Periodic cleanup of stale buckets (every 5 minutes)
if (typeof globalThis !== "undefined") {
  const CLEANUP_INTERVAL = 5 * 60_000;
  const STALE_THRESHOLD = 10 * 60_000;

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > STALE_THRESHOLD) {
        buckets.delete(key);
      }
    }
  }, CLEANUP_INTERVAL).unref?.();
}
