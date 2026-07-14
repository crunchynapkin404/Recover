import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the Docker image; harmless on Vercel.
  output: "standalone",
  // Dev-only: allow LAN/tunnel origins for `next dev`, via env (comma-separated
  // hostnames), never hardcoded machine-specific IPs.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};

export default nextConfig;
