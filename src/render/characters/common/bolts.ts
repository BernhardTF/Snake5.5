// Emissive lightning strips (additive, HDR for bloom). Each bolt is a polyline turned into a flat
// strip in the XY plane (top-down camera), drawn twice: a wide soft halo and a thin hot core.
import * as THREE from 'three';
import { noShadow } from './util';

const VERT = /* glsl */ `
attribute float aV;
attribute float aI;
varying float vV;
varying float vI;
void main() {
  vV = aV; vI = aI;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uCore, uGlow;
uniform float uFade;
varying float vV;
varying float vI;
void main() {
  float v = abs(vV);
  // vI > 0: halo strip, vI < 0: core strip
  float I = abs(vI);
  vec3 c;
  if (vI < 0.0) { float k = exp(-v * v * 5.0); c = mix(uGlow, uCore, k) * k * I; }
  else { float k = exp(-v * v * 3.5) * (1.0 - v); c = uGlow * k * I * 0.55; }
  c *= uFade;
  gl_FragColor = vec4(c, 1.0);
}
`;

function upd(a: THREE.BufferAttribute, n: number) { a.clearUpdateRanges(); a.addUpdateRange(0, n); a.needsUpdate = true; }

export class BoltBatch {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private av: Float32Array;
  private ai: Float32Array;
  private aPos: THREE.BufferAttribute;
  private aV: THREE.BufferAttribute;
  private aI: THREE.BufferAttribute;
  private maxQuads: number;
  private nq = 0;
  // current polyline
  private px = new Float32Array(64);
  private py = new Float32Array(64);
  private pz = new Float32Array(64);
  private np = 0;

  constructor(maxQuads: number, core: THREE.ColorRepresentation, glow: THREE.ColorRepresentation, coreI = 6, glowI = 2.2) {
    this.maxQuads = maxQuads;
    const nv = maxQuads * 4;
    this.pos = new Float32Array(nv * 3); this.av = new Float32Array(nv); this.ai = new Float32Array(nv);
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aV = new THREE.BufferAttribute(this.av, 1).setUsage(THREE.DynamicDrawUsage);
    this.aI = new THREE.BufferAttribute(this.ai, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aV', this.aV);
    this.geo.setAttribute('aI', this.aI);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const a = q * 4;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uCore: { value: new THREE.Color(core as any).multiplyScalar(coreI) },
        uGlow: { value: new THREE.Color(glow as any).multiplyScalar(glowI) },
        uFade: { value: 1 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = noShadow(new THREE.Mesh(this.geo, this.material));
    this.mesh.renderOrder = 12;
  }

  begin() { this.nq = 0; }
  /** Start a polyline. */
  start() { this.np = 0; }
  point(x: number, y: number, z: number) {
    if (this.np >= 64) return;
    this.px[this.np] = x; this.py[this.np] = y; this.pz[this.np] = z; this.np++;
  }
  /** Emit the current polyline as a halo + core strip. */
  flush(coreW: number, glowW: number, intensity: number) {
    if (this.np < 2 || intensity <= 0.001) return;
    this.strip(glowW, intensity);
    this.strip(coreW, -intensity);
  }
  private strip(w: number, I: number) {
    const n = this.np;
    for (let i = 0; i < n - 1; i++) {
      if (this.nq >= this.maxQuads) return;
      const q = this.nq++;
      // per-vertex normals from neighbouring segments for mitred joins
      for (let e = 0; e < 2; e++) {
        const k = i + e;
        const ka = Math.max(0, k - 1), kb = Math.min(n - 1, k + 1);
        let dx = this.px[kb] - this.px[ka], dy = this.py[kb] - this.py[ka];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const nx = -dy * w, ny = dx * w;
        // taper the ends
        const tp = Math.min(1, Math.min(k, n - 1 - k) * 0.6 + 0.35);
        for (let sd = 0; sd < 2; sd++) {
          const v = q * 4 + e * 2 + sd;
          const sg = sd === 0 ? -1 : 1;
          this.pos[v * 3] = this.px[k] + nx * sg * tp;
          this.pos[v * 3 + 1] = this.py[k] + ny * sg * tp;
          this.pos[v * 3 + 2] = this.pz[k];
          this.av[v] = sg;
          this.ai[v] = I;
        }
      }
    }
  }
  end() {
    const n = this.nq;
    this.geo.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
    if (!n) return;
    upd(this.aPos, n * 12); upd(this.aV, n * 4); upd(this.aI, n * 4);
  }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
