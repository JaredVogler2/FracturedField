/** Mutable render counters written by the scene and read by the dev HUD at a low rate. */
export const renderStats = {
  frameMs: 16.7,
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  /** Compiled shader programs (each one a compile the player waited for). */
  programs: 0,
  /** The tier rendering now, and whether it adapts to the frame rate. */
  tier: 'high' as 'low' | 'medium' | 'high',
  adaptive: false,
};
