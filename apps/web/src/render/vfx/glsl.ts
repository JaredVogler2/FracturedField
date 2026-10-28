/**
 * GLSL shared by the element visuals: value noise and fbm in [0, 1] on the plane, and the distance
 * to the nearest Voronoi cell border (ice and stone cracks).
 */
export const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Normalised 3-octave value noise in [0, 1].
float fbm(vec2 p) {
  return (noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.01) * 0.125) / 0.875;
}`;

/** Distance to the nearest Voronoi cell border (IQ's two-pass method) — ice crack lines. */
export const VORONOI_EDGE_GLSL = /* glsl */ `
float voronoiEdge(vec2 p) {
  vec2 n = floor(p); vec2 f = fract(p);
  vec2 mg = vec2(0.0); vec2 mr = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 19.19));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 19.19));
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}`;
