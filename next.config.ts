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
  // Turbopack infers the workspace root as the outermost directory holding a
  // lockfile. On 2026-08-18 a stray `npm install` left a package-lock.json in
  // $HOME, so it inferred the whole home directory — .vscode-server, every
  // other project, ~9 GB — as the root. Dev compiles went from seconds to
  // minutes and the dev filesystem cache grew to 1.4 GB, which then blocked
  // the server for 4-9 minutes at a time while it wrote itself out. Pinning
  // the root means nothing outside this repo can move it again.
  turbopack: { root: __dirname },
  experimental: {
    // Health Auto Export can post large multi-day/all-metric payloads to
    // /api/connections/apple-health/ingest; match the route's own cap
    // (MAX_BODY_BYTES in that route) so Next doesn't truncate first.
    //
    // Renamed from `middlewareClientMaxBodySize` in v0.113: Next 16.2.10
    // deprecates that spelling, and the warning it printed on every `next dev`
    // boot was the app's only dev "Issue" — which is why the devtools badge
    // showed a red `1 Issue` chip in the bottom-left of every captured
    // screenshot, over whatever happened to be there. Same option, same cap.
    proxyClientMaxBodySize: "50mb",
  },
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
      { source: "/log", destination: "/train?tab=history", permanent: true },
      { source: "/journal", destination: "/body?tab=journal", permanent: true },
      { source: "/health", destination: "/body?tab=labs", permanent: true },
    ];
  },
};

export default nextConfig;
