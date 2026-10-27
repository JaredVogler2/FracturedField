/**
 * Prepares camera-test media before any browser starts: the pinned real hand photos (MediaPipe
 * test assets) and a Y4M fake-camera video built from them. Failures only skip the real-camera
 * test (it checks for the file); nothing here is required by the other suites.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const HAND_VIDEO = path.resolve('node_modules/.cache/ff-e2e/hands.y4m');

export default function globalSetup(): void {
  mkdirSync(path.dirname(HAND_VIDEO), { recursive: true });
  try {
    execFileSync('node', ['scripts/prepare-vision-assets.mjs'], {
      stdio: 'inherit',
      env: { ...process.env, VISION_TESTDATA: '1' },
    });
    execFileSync('node', ['scripts/make-hand-video.mjs', HAND_VIDEO], { stdio: 'inherit' });
  } catch (e) {
    console.warn(`camera test media unavailable: ${String(e)}`);
  }
}
