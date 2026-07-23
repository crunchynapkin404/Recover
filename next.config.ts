import type { NextConfig } from "next";

// Pragmatic security header set (v0.18). A strict script-src CSP is deferred —
// it needs per-request nonce plumbing that fights Next's inline bootstrap.
// frame-ancestors 'none' is safe to set now (no nonce needed).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  {
    key: "Permissions-Policy",
    // Microphone is intentionally NOT denied: v0.15 voice dictation uses the
    // Web Speech API, which browsers gate behind the microphone permission.
    value: "camera=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // Standalone output for the Docker image; harmless on Vercel.
  output: "standalone",
  // Dev-only: allow LAN/tunnel origins for `next dev`, via env (comma-separated
  // hostnames), never hardcoded machine-specific IPs.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  // Retired routes from the Option B IA. These are framework-level 308s so an
  // old bookmark, push deep-link or coach-authored link resolves before any
  // page renders — a redirect() inside a page component would answer the
  // document request with a 200 and a client-side hop instead.
  async redirects() {
    return [
      { source: "/plan", destination: "/train?tab=week", permanent: true },
    ];
  },
};

export default nextConfig;
