// Comet: a blazing icy nucleus at the head and a glowing plasma/ice tail along the path (ribbon with a
// flowing striated shader, cyan → white → violet), twinkling sparkles, a flickering taper and soft
// glow sprites on the sand. No solid body besides the nucleus.
import * as THREE from 'three';
import type { RenderFrame } from '../../types';
import { LegendBase } from './common/base';
import { newSample } from './common/track';
import { NOISE, patch } from './common/mats';
import { ParticlePool, SpriteBatch, SpriteMode } from './common/sprites';
import { ambientGlowK, clamp, damp, noShadow, Rng, smooth } from './common/util';

const MAXR = 1700;
const AC = 7; // vertices across the ribbon

const RIB_VERT = /* glsl */ `
attribute vec4 aT;   // s, v (-1..1), u = s / L, ring width
varying vec4 vT;
varying vec3 vW;
void main() {
  vT = aT;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const RIB_FRAG = /* glsl */ `
uniform float uTime, uFade, uDead, uFlare, uDay;
uniform vec4 uBul[4];
varying vec4 vT;
varying vec3 vW;
${NOISE}
void main() {
  float s = vT.x, v = vT.y, u = vT.z;
  float av = abs(v);
  float flow = lfbm(vec2(s * 1.8 - uTime * 3.2, v * 2.6 + s * 0.25));
  float fil = lvn(vec2(s * 5.0 - uTime * 7.5, v * 8.0 + 3.0));
  float str = lvn(vec2(s * 0.8 - uTime * 1.1, v * 14.0));        // long striations
  float spread = 1.0 + uDead * 1.5;
  float dust = exp(-av * av * 1.6 / spread) * (0.4 + 0.8 * flow) * (0.7 + 0.6 * str) * (1.0 - smoothstep(0.75, 1.0, av));
  float core = exp(-av * av * 45.0 / spread) * (0.7 + 0.6 * fil);
  float taper = pow(clamp(1.0 - u, 0.0, 1.0), 0.55) * smoothstep(0.0, 0.08, s);
  float flick = 0.86 + 0.14 * sin(uTime * 19.0 + s * 4.0) * sin(uTime * 7.3 - s * 2.1);
  vec3 cA = vec3(0.04, 0.62, 1.0), cB = vec3(0.3, 0.45, 1.0), cC = vec3(0.55, 0.2, 1.0);
  vec3 col = u < 0.35 ? mix(cA, cB, smoothstep(0.0, 0.35, u)) : mix(cB, cC, smoothstep(0.35, 0.85, u));
  vec3 coreCol = mix(vec3(0.85, 1.0, 1.0), vec3(0.85, 0.75, 1.0), smoothstep(0.2, 0.9, u));
  float I = dust * mix(1.0, 0.8, uDay) * taper * flick;
  col = mix(col, col * col * vec3(0.9, 1.0, 1.1), uDay * 0.75);
  float Ic = core * 0.9 * taper * flick;
  float knot = 0.0;
  for (int i = 0; i < 4; i++) knot += uBul[i].y * exp(-pow((s - uBul[i].x) / 0.38, 2.0));
  I += knot * 2.6 * exp(-av * av * 5.0);
  I *= 1.0 + uFlare * 0.8 * exp(-s * 0.7);
  I *= 1.0 - uDead;
  vec3 rgb = col * I + coreCol * Ic * (1.0 - uDead) * (1.0 + uFlare) + vec3(0.9, 1.0, 1.0) * knot * 0.6;
  float a = clamp((pow(dust, 1.6) * mix(0.8, 0.95, uDay) + core * 0.3) * taper * (1.0 - uDead), 0.0, 0.92);
  gl_FragColor = vec4(rgb * uFade, a * uFade);
}
`;

function nucleusGeo() {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const n3 = (x: number, y: number, z: number) =>
    Math.sin(x * 1.9 + 0.3) * Math.sin(y * 2.3 + 1.1) * Math.sin(z * 1.7 + 2.0) +
    0.5 * Math.sin(x * 4.1 + y * 1.3) * Math.sin(z * 3.7 - x * 1.1) + 0.25 * Math.sin(x * 8.3 - z * 5.1 + y * 6.7);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = 1 + 0.2 * n3(v.x * 1.6, v.y * 1.6, v.z * 1.6);
    p.setXYZ(i, v.x * r * 1.12, v.y * r, v.z * r * 0.92);
  }
  g.computeVertexNormals();
  return g;
}

export class CometView extends LegendBase {
  readonly id = 'comet' as const;
  private ribGeo = new THREE.BufferGeometry();
  private rPos: Float32Array; private rT: Float32Array;
  private ribMat: THREE.ShaderMaterial;
  private nucleus: THREE.Mesh;
  private nucMat: THREE.MeshPhysicalMaterial;
  private uN = { uHeat: { value: 1 }, uT: { value: 0 } };
  private halo = new SpriteBatch(8, { mode: SpriteMode.Soft, additive: true, renderOrder: 14 });
  private ground = new SpriteBatch(260, { mode: SpriteMode.Soft, additive: true, renderOrder: 3 });
  private stars = new ParticlePool(180, { mode: SpriteMode.Star, additive: true, drag: 0.9, fadeIn: 0.2, renderOrder: 15 });
  private jets = new ParticlePool(60, { mode: SpriteMode.Spark, additive: true, drag: 2.5, stretch: 0.12, fadeIn: 0.05, renderOrder: 15 });
  private rng = new Rng(3);
  private smp = newSample();
  private flare = 0;
  private starAcc = 0;
  private jetAcc = 0;
  private spin = 0;
  private bul: THREE.Vector4[] = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];

  constructor() {
    super();
    this.object.name = 'legend-comet';
    this.smoothLen = 0.25;
    const nv = MAXR * AC;
    this.rPos = new Float32Array(nv * 3); this.rT = new Float32Array(nv * 4);
    this.ribGeo.setAttribute('position', new THREE.BufferAttribute(this.rPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ribGeo.setAttribute('aT', new THREE.BufferAttribute(this.rT, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array((MAXR - 1) * (AC - 1) * 6);
    let q = 0;
    for (let i = 0; i < MAXR - 1; i++) for (let j = 0; j < AC - 1; j++) {
      const a = i * AC + j, b = a + 1, c = a + AC, d = c + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
    this.ribGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.ribGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.ribMat = new THREE.ShaderMaterial({
      vertexShader: RIB_VERT, fragmentShader: RIB_FRAG,
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uDead: { value: 0 }, uFlare: { value: 0 }, uDay: { value: 0 }, uBul: { value: this.bul } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    });
    const rib = noShadow(new THREE.Mesh(this.ribGeo, this.ribMat));
    rib.renderOrder = 13;

    this.nucMat = patch(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, clearcoat: 0.6, emissive: 0xffffff }), {
      uniforms: this.uN,
      fragDecl: `uniform float uHeat, uT;\n${NOISE}`,
      color: /* glsl */ `
        {
          float n = lfbm(vLoc.xy * 3.0 + vLoc.z * 2.0);
          vec3 ice = vec3(0.75, 0.88, 0.98), rock = vec3(0.07, 0.075, 0.09);
          diffuseColor.rgb = mix(rock, ice, smoothstep(0.35, 0.65, n));
        }
      `,
      emissive: /* glsl */ `
        {
          vec3 vd = normalize(vViewPosition);
          float fr = 1.0 - clamp(abs(dot(vd, normal)), 0.0, 1.0);
          float n = lfbm(vLoc.xy * 3.0 + vLoc.z * 2.0);
          float vents = smoothstep(0.62, 0.8, lvn(vLoc.xy * 7.0 + uT * 0.6));
          vec3 hot = vec3(0.7, 0.95, 1.0);
          totalEmissiveRadiance = hot * uHeat * (0.7 + 1.1 * smoothstep(0.3, 0.7, n) + 3.0 * fr * fr + 2.0 * vents);
        }
      `,
    });
    this.nucleus = new THREE.Mesh(nucleusGeo(), this.nucMat);
    this.nucleus.castShadow = true;
    this.nucleus.matrixAutoUpdate = false;
    this.solids.push(this.nucMat);
    this.object.add(this.ground.mesh, rib, this.nucleus, this.halo.mesh, this.stars.mesh, this.jets.mesh);
  }

  protected draw(f: RenderFrame) {
    const sn = f.snake, tr = this.track, dt = this.dt;
    const sc = this.r / 0.34;
    const L = tr.L;
    const alive = sn.alive;
    const td = alive ? 0 : sn.deathT;
    const r = this.rng;
    const deadK = alive ? 0 : smooth(0.1, 1.6, td);
    const fade = this.glowFade * (1 - this.ghostK * 0.2);
    const night = ambientGlowK();
    if (this.eats) this.flare = 1;
    if (this.justDied) this.flare = 1.6;
    this.flare *= Math.exp(-dt * 3);
    const u = this.ribMat.uniforms;
    u.uTime.value = this.t; u.uFade.value = fade; u.uDay.value = clamp((1.2 - night) / 0.9, 0, 1); u.uDead.value = deadK; u.uFlare.value = this.flare;
    for (let i = 0; i < 4; i++) {
      const b = sn.bulges[i];
      this.bul[i].set(b ? b.s : -99, b ? clamp(b.amount, 0, 1) : 0, 0, 0);
    }

    // ---------------- ribbon tail
    const s0 = 0.02 * sc;
    const span = Math.max(0.01, L - s0);
    const ds = Math.max(0.05 * sc, span / (MAXR - 2));
    const P = this.rPos, T = this.rT;
    let n = 0;
    const o = this.smp;
    const ground = this.ground;
    ground.begin();
    const gStep = Math.max(0.45 * sc, L / 220);
    let nextG = 0.3 * sc;
    const wob = alive ? 1 : 1 + deadK;
    for (let s = s0; n < MAXR; s += ds) {
      const sc2 = Math.min(s, L);
      tr.sample(sc2, o);
      const uu = sc2 / Math.max(0.01, L);
      const head = smooth(0, 0.9 * sc, sc2);
      let w = 0.5 * sc * (0.5 + 0.5 * head) * Math.pow(Math.max(0, 1 - uu), 0.5);
      w *= 0.9 + 0.1 * Math.sin(this.t * 13 + sc2 * 3.1) + 0.06 * Math.sin(this.t * 31 - sc2 * 7.3);
      w *= 1 + 0.35 * this.bulgeAt(f, sc2, 0.4 * sc);
      w *= wob;
      w *= tr.gapCap(sc2, 0.3 * sc);
      const nx = -o.ty, ny = o.tx;
      for (let j = 0; j < AC; j++) {
        const v = (j / (AC - 1)) * 2 - 1;
        const k = n * AC + j;
        P[k * 3] = o.x + nx * w * v; P[k * 3 + 1] = o.y + ny * w * v; P[k * 3 + 2] = 0.14 * sc;
        T[k * 4] = sc2; T[k * 4 + 1] = v; T[k * 4 + 2] = uu; T[k * 4 + 3] = w;
      }
      n++;
      if (sc2 >= nextG && sc2 < L) {
        nextG += gStep;
        const tk = Math.pow(1 - uu, 0.8);
        const cr = uu < 0.3 ? 0.6 : 0.6 - (uu - 0.3) * 0.3, cg = uu < 0.3 ? 0.95 : 0.9 - (uu - 0.3) * 0.9, cb = 1;
        ground.push(o.x, o.y, 0.011, 1.5 * sc * (0.4 + 0.6 * tk), 1.5 * sc * (0.4 + 0.6 * tk), 0, cr, cg, cb, 0.16 * tk * fade * (1 - deadK) * night);
      }
      if (sc2 >= L) break;
    }
    const pa = this.ribGeo.getAttribute('position') as THREE.BufferAttribute, ta = this.ribGeo.getAttribute('aT') as THREE.BufferAttribute;
    pa.clearUpdateRanges(); pa.addUpdateRange(0, n * AC * 3); pa.needsUpdate = true;
    ta.clearUpdateRanges(); ta.addUpdateRange(0, n * AC * 4); ta.needsUpdate = true;
    this.ribGeo.setDrawRange(0, Math.max(0, n - 1) * (AC - 1) * 6);

    // ---------------- nucleus
    tr.sample(0.05 * sc, o);
    const hx = o.x, hy = o.y, hyaw = Math.atan2(o.ty, o.tx);
    if (alive) this.spin += dt * (0.8 + Math.abs(sn.speed) * 0.25);
    const heat = alive ? 1 + 0.8 * this.flare + 0.15 * Math.sin(this.t * 17) : Math.max(0, 1 - td / 1.4) * (1 + this.flare);
    this.uN.uHeat.value = heat * fade;
    this.uN.uT.value = this.t;
    const ns = 0.19 * sc;
    {
      // tumble: spin about a tilted axis, then face the heading
      const e = this.nucleus.matrix.elements;
      const a = this.spin, cy = Math.cos(hyaw), sy = Math.sin(hyaw);
      const ca = Math.cos(a), sa = Math.sin(a);
      // R = Rz(yaw) * Rx(spin) * Rz(0.4)
      const c4 = Math.cos(0.4), s4 = Math.sin(0.4);
      const m00 = c4, m01 = -s4, m02 = 0;
      const m10 = ca * s4, m11 = ca * c4, m12 = -sa;
      const m20 = sa * s4, m21 = sa * c4, m22 = ca;
      const r00 = cy * m00 - sy * m10, r01 = cy * m01 - sy * m11, r02 = cy * m02 - sy * m12;
      const r10 = sy * m00 + cy * m10, r11 = sy * m01 + cy * m11, r12 = sy * m02 + cy * m12;
      e[0] = r00 * ns; e[1] = r10 * ns; e[2] = m20 * ns; e[3] = 0;
      e[4] = r01 * ns; e[5] = r11 * ns; e[6] = m21 * ns; e[7] = 0;
      e[8] = r02 * ns; e[9] = r12 * ns; e[10] = m22 * ns; e[11] = 0;
      e[12] = hx; e[13] = hy; e[14] = 0.2 * sc; e[15] = 1;
      this.nucleus.matrixWorldNeedsUpdate = true;
    }
    // coma halo + sand glow under the nucleus
    const halo = this.halo;
    halo.begin();
    const hk = heat * fade;
    if (hk > 0.01) {
      const fl = 0.92 + 0.08 * Math.sin(this.t * 23) * Math.sin(this.t * 5.3);
      const cs = (1 + 0.6 * this.flare) * fl;
      halo.push(hx, hy, 0.42 * sc, 1.1 * sc * cs, 1.1 * sc * cs, 0, 0.15, 0.6, 1.0, 0.4 * hk * night);
      halo.push(hx, hy, 0.44 * sc, 0.55 * sc * cs, 0.55 * sc * cs, 0, 0.5, 0.9, 1.0, 0.45 * hk);
      ground.push(hx, hy, 0.012, 2.4 * sc * cs, 2.4 * sc * cs, 0, 0.3, 0.75, 1.0, 0.28 * hk * night);
    }
    halo.end();
    ground.end();

    // ---------------- sparkles + jets
    if (this.eats || this.justDied) {
      const k = this.justDied ? 60 : 26;
      for (let i = 0; i < k; i++) {
        const a = r.next() * Math.PI * 2, sp = r.range(0.4, this.justDied ? 2.4 : 1.4) * sc;
        this.stars.spawn(hx, hy, 0.3 * sc, Math.cos(a) * sp, Math.sin(a) * sp, 0, r.range(0.5, 1.1), 0.22 * sc, 0.05 * sc, 1.6, 1.8, 2.0, 1);
      }
    }
    const starRate = alive ? 14 * Math.min(3, 0.4 + L / (8 * sc)) : 0;
    this.starAcc += dt * starRate;
    while (this.starAcc > 1) {
      this.starAcc -= 1;
      const s = Math.pow(r.next(), 1.3) * L;
      tr.sample(s, o);
      const uu = s / Math.max(0.01, L);
      const w = 0.4 * sc * Math.pow(1 - uu, 0.45);
      const lat = (r.next() * 2 - 1) * w;
      const violet = uu > 0.45 && r.next() < 0.6;
      this.stars.spawn(o.x - o.ty * lat, o.y + o.tx * lat, 0.2 * sc, -o.ty * lat * 0.4, o.tx * lat * 0.4, 0, r.range(0.35, 0.9),
        r.range(0.1, 0.2) * sc, 0.02 * sc, violet ? 1.1 : 1.3, violet ? 0.8 : 1.6, 2.0, 0.95, r.next() * 0.8);
    }
    this.jetAcc += dt * (alive ? 10 + 25 * this.flare : 0);
    while (this.jetAcc > 1) {
      this.jetAcc -= 1;
      const a = hyaw + r.range(-1.7, 1.7);
      const sp = r.range(0.8, 1.8) * sc;
      this.jets.spawn(hx + Math.cos(a) * 0.15 * sc, hy + Math.sin(a) * 0.15 * sc, 0.3 * sc, Math.cos(a) * sp, Math.sin(a) * sp, 0, r.range(0.12, 0.3), 0.06 * sc, 0.02 * sc, 1.2, 2.0, 2.4, 0.8);
    }
    this.stars.step(dt); this.stars.render();
    this.jets.step(dt); this.jets.render();
    this.stars.material.uniforms.uFade.value = fade;
    this.jets.material.uniforms.uFade.value = fade;
    void damp;
  }
}
