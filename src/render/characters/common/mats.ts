// Material helpers: patch MeshStandard/MeshPhysical shaders (keeps full scene lighting) and
// unlit HDR glow materials for bloom.
import * as THREE from 'three';

export interface PatchOpts {
  uniforms?: Record<string, THREE.IUniform>;
  /** Declarations shared by vertex + fragment (functions, varyings). */
  common?: string;
  vertDecl?: string;
  /** Runs after <begin_vertex> (`transformed`, `position`, `normal` available). */
  vert?: string;
  fragDecl?: string;
  /** Runs after <color_fragment> (modify diffuseColor). */
  color?: string;
  /** Runs after <roughnessmap_fragment> (roughnessFactor). */
  rough?: string;
  /** Runs after <metalnessmap_fragment> (metalnessFactor). */
  metal?: string;
  /** Runs after <emissivemap_fragment> (totalEmissiveRadiance). */
  emissive?: string;
  /** Runs after <normal_fragment_maps> (normal). */
  normal?: string;
  /** Runs right before <dithering_fragment> (gl_FragColor). */
  final?: string;
  /** Extra raw [find, replace] pairs on the fragment shader. */
  fragReplace?: [string, string][];
}

let keySeq = 0;
/** Adds shader snippets to a built-in lit material. Varyings: vLoc (object-space position), vWPos (world). */
export function patch<T extends THREE.MeshStandardMaterial>(mat: T, o: PatchOpts): T {
  const key = 'legend-patch-' + (keySeq++);
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    if (o.uniforms) Object.assign(sh.uniforms, o.uniforms);
    const shared = `varying vec3 vLoc;\nvarying vec3 vWPos;\n${o.common ?? ''}\n`;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${shared}${o.vertDecl ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLoc = position;\n${o.vert ?? ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n{\n vec4 wpp = vec4(transformed, 1.0);\n #ifdef USE_INSTANCING\n wpp = instanceMatrix * wpp;\n #endif\n vWPos = (modelMatrix * wpp).xyz;\n}`);
    let fs = sh.fragmentShader.replace('#include <common>', `#include <common>\n${shared}${o.fragDecl ?? ''}`);
    if (o.color) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${o.color}`);
    if (o.rough) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${o.rough}`);
    if (o.metal) fs = fs.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${o.metal}`);
    if (o.emissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${o.emissive}`);
    if (o.normal) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${o.normal}`);
    if (o.final) fs = fs.replace('#include <dithering_fragment>', `${o.final}\n#include <dithering_fragment>`);
    if (o.fragReplace) for (const [a, b] of o.fragReplace) fs = fs.replace(a, b);
    sh.fragmentShader = fs;
  };
  return mat;
}

/** Unlit HDR colour for bloom (values > 1 glow). Uses instance colour when present. */
export function glowMat(color: THREE.ColorRepresentation, intensity = 1, additive = false): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color as any).multiplyScalar(intensity),
    toneMapped: false,
    transparent: additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
  });
  return m;
}

/** Shared GLSL noise helpers. */
export const NOISE = /* glsl */ `
float lh11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float lh21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float lvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(lh21(i), lh21(i + vec2(1, 0)), f.x), mix(lh21(i + vec2(0, 1)), lh21(i + vec2(1, 1)), f.x), f.y); }
float lfbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * lvn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;
