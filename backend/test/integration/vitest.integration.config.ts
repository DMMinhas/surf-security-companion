import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.integration.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Testcontainers need Docker; run serially to avoid port contention.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
