import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests spin up real Postgres containers; give them
    // room to boot and apply migrations.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    // Containers are expensive: serialise test files so we run at
    // most one container at a time.
    fileParallelism: false,
  },
});
