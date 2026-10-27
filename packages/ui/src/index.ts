/**
 * Shared UI design tokens (mirrors docs/CREATIVE_TARGET.md). Components live in apps/web; this
 * package keeps the token contract importable by any future surface (lobby site, overlays).
 */
export const UI_TOKENS = {
  color: {
    abyss: '#071421',
    storm: '#12364a',
    basalt: '#202830',
    silver: '#9aaab7',
    brass: '#c18b53',
    amber: '#ff9c46',
    cyan: '#50d8e8',
    violet: '#9c7dff',
    text: '#e8eef3',
    textDim: '#9fb0bd',
    danger: '#ff5d6c',
  },
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  /** Minimum touch target edge (px), WCAG 2.5.5-inspired. */
  minTouchTarget: 44,
  font: {
    display: "'Inter', 'Segoe UI', system-ui, sans-serif",
    mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  },
} as const;

/** Team identity is never colour-only: each slot also has a distinct glyph shape. */
export const TEAM_IDENTITY = [
  { name: 'Ember', color: UI_TOKENS.color.amber, glyph: 'hexagon' },
  { name: 'Tide', color: UI_TOKENS.color.cyan, glyph: 'diamond' },
] as const;
