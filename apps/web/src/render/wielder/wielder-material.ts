import * as THREE from 'three';

/**
 * The wielders' one material (7D / D10): MeshStandardMaterial with its surface (roughness,
 * metalness, glow, relief) from the body's vertices, the gauntlets' and visor's glow from the
 * pose, a rim in the seat's colour, and the character light below.
 */

const vertexHead = /* glsl */ `
  attribute vec4 aMat;
  attribute float aDetail;
  varying vec4 vMat;
  varying float vRigY;
  varying float vDetail;
  varying vec3 vRest;
`;
const fragmentHead = /* glsl */ `
  uniform vec3 uTeam;
  uniform vec4 uGlow; // body, left gauntlet, right gauntlet, visor
  uniform vec3 uFieldDir; // world: from the plinth toward the field's centre
  uniform float uScale; // the wielder's scale: rest-pose metres to world metres
  varying vec4 vMat;
  varying float vRigY;
  varying float vDetail;
  varying vec3 vRest;
`;

/**
 * The relief (D10: "normal/detail maps" for procedural characters), procedural in the rest pose
 * so it moves with the skin: the coat quilted in channels 4.5 cm apart, the leather grained, the
 * metal hammered; each fades out where its pattern is finer than a pixel (no shimmer from across
 * the arena). Heights in metres at scale 1; branch-free, so every derivative is well defined.
 */
const reliefFunctions = /* glsl */ `
  float ffHash( vec3 p ) {
    p = fract( p * 0.3183099 + 0.1 );
    p *= 17.0;
    return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
  }
  float ffNoise( vec3 x ) {
    vec3 i = floor( x );
    vec3 f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( mix( ffHash( i ), ffHash( i + vec3( 1, 0, 0 ) ), f.x ),
           mix( ffHash( i + vec3( 0, 1, 0 ) ), ffHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
      mix( mix( ffHash( i + vec3( 0, 0, 1 ) ), ffHash( i + vec3( 1, 0, 1 ) ), f.x ),
           mix( ffHash( i + vec3( 0, 1, 1 ) ), ffHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
      f.z );
  }
  float ffRelief( vec3 p, float kind ) {
    float quilted = step( 0.5, kind ) * step( kind, 1.5 );
    float leather = step( 1.5, kind ) * step( kind, 2.5 );
    float metal = step( 2.5, kind );
    float u = p.y * 22.0;
    float seam = min( fract( u ), 1.0 - fract( u ) );
    float quilt = 0.0025 * smoothstep( 0.0, 0.3, seam ) * ( 1.0 - smoothstep( 0.3, 0.7, fwidth( u ) ) );
    vec3 pl = p * 260.0;
    float grain = 0.0006 * ffNoise( pl ) * ( 1.0 - smoothstep( 0.3, 0.7, length( fwidth( pl ) ) ) );
    vec3 pm = p * 60.0;
    float dents = 0.0008 * ffNoise( pm ) * ( 1.0 - smoothstep( 0.3, 0.7, length( fwidth( pm ) ) ) );
    return quilted * quilt + leather * grain + metal * dents;
  }
`;

/** The relief as a bump on the shading normal (Mikkelsen's surface-gradient bump, in metres). */
const reliefBump = /* glsl */ `
  {
    float hRelief = ffRelief( vRest, vDetail ) * uScale;
    vec3 sp = - vViewPosition;
    vec3 dpdx = dFdx( sp );
    vec3 dpdy = dFdy( sp );
    vec3 r1 = cross( dpdy, normal );
    vec3 r2 = cross( normal, dpdx );
    float det = dot( dpdx, r1 ) * faceDirection;
    vec3 grad = sign( det ) * ( dFdx( hRelief ) * r1 + dFdy( hRelief ) * r2 );
    normal = normalize( abs( det ) * normal - grad );
  }
`;

/**
 * The wielders' own light, on their material alone (no scene light, no cost elsewhere): the
 * storm-break key stands behind the plinths, so their fronts — what both cameras see — would be
 * lit only by the cool sky. The plinth's glowing inlay lights them from below in the seat's
 * colour, fading up the body, and the lit platform throws a warm bounce at their fronts.
 */
export const CHARACTER_LIGHT = { uplight: 0.55, bounce: 0.42, bounceColor: '#c9b9a6' } as const;

/**
 * One material for the whole body: surface from the vertices, glow from the pose. `relief`
 * (medium and high tiers) adds the surface relief; low draws the plain surfaces.
 */
export function wielderMaterial(
  team: string,
  fieldDir: THREE.Vector3,
  opts: { relief?: boolean; scale?: number } = {},
): {
  material: THREE.MeshStandardMaterial;
  glow: THREE.Vector4;
} {
  const relief = opts.relief ?? true;
  const glow = new THREE.Vector4(0.4, 0.4, 0.4, 1);
  // Both sides: the coat is open at the front and its insides show (three turns the normal of a
  // back face toward the viewer).
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 1,
    side: THREE.DoubleSide,
  });
  const bounce = new THREE.Color(CHARACTER_LIGHT.bounceColor);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTeam = { value: new THREE.Color(team) };
    shader.uniforms.uGlow = { value: glow };
    shader.uniforms.uFieldDir = { value: fieldDir };
    shader.uniforms.uScale = { value: opts.scale ?? 1 };
    shader.vertexShader =
      vertexHead +
      shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vMat = aMat;\n  vDetail = aDetail;\n  vRest = position;',
        )
        .replace(
          '#include <skinning_vertex>',
          '#include <skinning_vertex>\n  vRigY = transformed.y;',
        );
    let fragment = (fragmentHead + (relief ? reliefFunctions : '') + shader.fragmentShader)
      // The coat's inside (a back face, seen through its open front) is a darker lining.
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb *= gl_FrontFacing ? 1.0 : 0.42;',
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMat.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.y;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 nW = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
          float below = 0.5 - 0.5 * nW.y;
          float low = 1.0 - smoothstep( 0.1, 1.5, vRigY );
          vec3 fill = uTeam * ( ${CHARACTER_LIGHT.uplight.toFixed(3)} * below * low )
            + vec3( ${bounce.r.toFixed(4)}, ${bounce.g.toFixed(4)}, ${bounce.b.toFixed(4)} )
              * ( ${CHARACTER_LIGHT.bounce.toFixed(3)} * max( dot( nW, uFieldDir ), 0.0 ) );
          reflectedLight.indirectDiffuse += material.diffuseContribution * fill;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float ch = vMat.w;
        float g = ch < 0.5 ? uGlow.x : ch < 1.5 ? uGlow.y : ch < 2.5 ? uGlow.z : uGlow.w;
        totalEmissiveRadiance += uTeam * vMat.z * g * 2.2;
        // A rim of the seat's colour: the wielder reads against the storm from across the arena.
        float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += uTeam * rim * 0.45 * uGlow.w;`,
      );
    if (relief)
      fragment = fragment.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${reliefBump}`,
      );
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => (relief ? 'wielder-body' : 'wielder-body-plain');
  return { material, glow };
}
