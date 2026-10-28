import type { Page } from '@playwright/test';

/**
 * CI reproduction aid: `E2E_CPU_THROTTLE=3 pnpm exec playwright test …` slows a page's CPU through
 * the Chromium DevTools protocol, the way a slower CI runner does, so a timing-dependent failure
 * seen only in CI can be reproduced locally. Off unless the variable is set (> 1).
 */
export async function throttle(page: Page): Promise<void> {
  const rate = Number(process.env.E2E_CPU_THROTTLE ?? 0);
  if (!(rate > 1)) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}
