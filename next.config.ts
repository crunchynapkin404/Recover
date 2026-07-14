import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the Docker image; harmless on Vercel.
  output: "standalone",
};

export default nextConfig;
