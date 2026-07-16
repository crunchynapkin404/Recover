import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig sets jsx:"preserve" for Next, which esbuild would leave in place
  // and fail to parse — component tests need it transformed here.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Default node; component tests opt in per-file via
    // `// @vitest-environment jsdom`, so the DB suites keep a fast node env.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // Integration tests share one Postgres and several (scheduler.test.ts,
    // morning-hook.test.ts) tick the same sync_jobs queue — parallel files
    // would steal each other's jobs.
    fileParallelism: false,
  },
});
