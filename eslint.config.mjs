import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local tooling state: git worktrees with their own built .next output.
    ".claude/**",
  ]),
  {
    rules: {
      // A leading underscore is this repo's existing "deliberately unused"
      // marker — pure MCP tools that take a ctx they never read, catch
      // blocks that discard the error. Without these patterns each one
      // raises a warning, and eight standing warnings train you to stop
      // reading lint output at all.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
