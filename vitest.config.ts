import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'apps/room-worker/test/live-*.ts', 'e2e/**'],
    environment: 'node',
    testTimeout: 30_000,
    pool: 'forks',
  },
});
