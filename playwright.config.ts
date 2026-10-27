import { defineConfig } from '@playwright/test';

/**
 * Browser E2E against the production build served by `vite preview`. Headless Chromium renders
 * WebGL2 through SwiftShader (software) — visual and functional checks only, never performance.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    {
      command: 'pnpm --filter @ff/web build && pnpm --filter @ff/web preview',
      url: 'http://127.0.0.1:4173/spike',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // Authoritative room service for the online E2E (local workerd, development vars only).
      command: 'pnpm --filter @ff/room-worker dev',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
  ],
});
