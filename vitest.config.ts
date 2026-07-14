import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Integration tests share one Postgres and several (scheduler.test.ts,
    // morning-hook.test.ts) tick the same sync_jobs queue — parallel files
    // would steal each other's jobs.
    fileParallelism: false,
  },
});
