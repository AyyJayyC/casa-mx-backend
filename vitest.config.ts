import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
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
