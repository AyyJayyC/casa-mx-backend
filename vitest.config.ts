import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // Deterministic env for tests. CI does not provide these (no .env in CI),
    // so pin them here so local runs match CI and email code paths don't
    // short-circuit on a missing key.
    env: {
      NODE_ENV: 'test',
      // CI has no ADMIN_EMAIL; keep the admin self-heal path off so it never
      // mutates the seeded admin account during tests.
      ADMIN_EMAIL: '',
      // Dummy values only — never a real key.
      RESEND_API_KEY: 're_test_dummy_key',
      RESEND_FROM_EMAIL: 'noreply@casa-mx.test',
      RESEND_FROM_NAME: 'CasaMX Test',
    },
    testTimeout: 30000,      // 30 second timeout per test
    hookTimeout: 30000,      // 30 second timeout for hooks
    teardownTimeout: 10000,  // 10 second timeout for teardown
    // Fix test isolation: Run tests sequentially to prevent database race conditions
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
