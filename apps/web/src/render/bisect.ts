/**
 * Test-only render bisection (`?test=1&off=sky,clouds,platform,…`): drops named layers so a
 * frame's cost can be attributed. Always empty outside test runs.
 */
export const RENDER_OFF: ReadonlySet<string> = (() => {
  if (typeof window === 'undefined') return new Set<string>();
  const p = new URLSearchParams(window.location.search);
  return new Set(p.has('test') ? (p.get('off') ?? '').split(',').filter(Boolean) : []);
})();

/** Whether the named layer renders (always true outside test runs). */
export const renders = (layer: string): boolean => !RENDER_OFF.has(layer);
