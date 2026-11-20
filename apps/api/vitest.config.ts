import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://vtc:vtc@localhost:5432/vtc_test?schema=public",
      ADMIN_TOKEN: "test-admin-token-test-admin-token",
      TOKEN_SECRET: "test-token-secret-test-token-secret",
      DISABLE_WORKERS: "1",
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
