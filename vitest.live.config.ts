import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/integration/live-*.test.ts",
      "tests/integration/v075-migrations.test.ts",
    ],
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
