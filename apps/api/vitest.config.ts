import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests boot Postgres via Testcontainers + apply migrations.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
  },
});
