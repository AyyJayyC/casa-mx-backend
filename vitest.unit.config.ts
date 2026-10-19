import { defineConfig } from "vitest/config";

/**
 * Pure unit tests: no Postgres, no Redis, no global seed setup.
 * Use for logic that can run anywhere (plugins, helpers, parsers).
 *
 * The default config still runs these files in CI, where a database exists.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.unit.test.ts"],
  },
});
