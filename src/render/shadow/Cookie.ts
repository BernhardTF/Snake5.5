// Procedural foliage shadow "cookie" rendered once per biome/board into a small RT, then blurred.
// R = near foliage layer, G = far foliage layer (swayed separately in the sand/frame shaders).
import * as THREE from 'three';
import { FullscreenPass, makeRT, passMaterial } from '../fsq';
import { NOISE_GLSL } from '../glsl/noise';
import { BLUR_FRAG } from './ContactShadows';
import { BIOME_INDEX } from '../biomeVisuals';
import { BIOME_DEFINES } from '../frame/newWorlds';

/** Per-biome blur multiplier (softer = more diffuse light source). */
const BLUR_SCALE: Record<number, number> = { [BIOME_INDEX.pinksands]: 0.6, [BIOME_INDEX.vaadhoo]: 2.2, [BIOME_INDEX.kepler]: 1.0 };

const COOKIE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uRegion;
uniform vec2 uBoard;
${NOISE_GLSL}
${BIOME_DEFINES}
#define PI 3.14159265
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// Japanese maple: 7 pointed lobes, stem gap at the bottom. Returns coverage 0..1
float maple(vec2 p, vec2 c, float size, float ang) {
  vec2 q = rot(-ang) * (p - c) / size;
  float r = length(q);
  float th = atan(q.x, q.y);               // 0 = main lobe tip
  float n = 7.0 / 6.2831853;
  float saw = 1.0 - abs(fract(th * n + 0.5) * 2.0 - 1.0);   // 1 at lobe axis, 0 at sinus
  float lobeLen = 0.5 + 0.5 * cos(th * 0.62);               // side lobes shorter
  float rr = 0.2 + 0.8 * lobeLen * pow(saw, 1.4);
  rr *= 1.0 - smoothstep(2.5, 3.14, abs(th));              // gap at the stem
  float leaf = 1.0 - smoothstep(rr - 0.05, rr + 0.05, r);
  float stem = 1.0 - smoothstep(0.02, 0.05, sdSeg(q, vec2(0.0), vec2(0.0, -0.8)));
  return max(leaf, stem);
}
// lanceolate bamboo leaf along +x from c
float bambooLeaf(vec2 p, vec2 c, float len, float wid, float ang) {
  vec2 q = rot(ang) * (p - c);   // rot(a) as written rotates by -a
  float t = q.x / len;
  if (t < 0.0 || t > 1.0) return 0.0;
  float w = wid * pow(sin(PI * pow(t, 0.7)), 0.8);
  return 1.0 - smoothstep(w - 0.03, w + 0.03, abs(q.y));
}
// palm frond: curved rachis with leaflets on both sides
float frond(vec2 p, vec2 base, float ang, float len, float bend) {
  float cov = 0.0;
  vec2 prev = base;
  float a = ang;
  for (int i = 1; i <= 14; i++) {
    float t = float(i) / 14.0;
    a += bend / 14.0;
    vec2 cur = prev + vec2(cos(a), sin(a)) * len / 14.0;
    float d = sdSeg(p, prev, cur);
    cov = max(cov, 1.0 - smoothstep(0.04, 0.08, d));
    // leaflets
    float ll = len * 0.28 * sin(PI * min(1.0, t * 1.15)) + 0.2;
    for (int s = -1; s <= 1; s += 2) {
      float la = a + float(s) * (1.05 - 0.3 * t);
      vec2 tip = cur + vec2(cos(la), sin(la)) * ll;
      float dl = sdSeg(p, cur, tip);
      float wl = 0.09 * (1.0 - 0.6 * clamp(dot(p - cur, tip - cur) / (ll * ll), 0.0, 1.0));
      cov = max(cov, 1.0 - smoothstep(wl - 0.03, wl + 0.03, dl));
    }
    prev = cur;
  }
  return cov;
}
// sea grape (Coccoloba uvifera): round leathery leaf, heart-shaped base, on a short petiole
float seaGrape(vec2 p, vec2 c, float size, float ang) {
  vec2 q = rot(-ang) * (p - c) / size;     // leaf tip toward +y
  float th = atan(q.x, q.y);
  float rr = 0.5 * (1.0 - 0.22 * exp(-(abs(th) - PI) * (abs(th) - PI) / 0.1225));  // notch at the stem end
  rr *= 1.0 + 0.04 * sin(th * 5.0);
  float leaf = 1.0 - smoothstep(rr - 0.04, rr + 0.04, length(q - vec2(0.0, 0.02)));
  float stem = 1.0 - smoothstep(0.02, 0.05, sdSeg(q, vec2(0.0, -0.4), vec2(0.0, -0.8)));
  return max(leaf, stem);
}
// alien frond: a curling rachis (fiddlehead tip) with round bladder leaflets
float alienFrond(vec2 p, vec2 base, float ang, float len, float curl) {
  float cov = 0.0;
  vec2 prev = base;
  float a = ang;
  for (int i = 1; i <= 12; i++) {
    float t = float(i) / 12.0;
    a += curl * t * t * 0.55;
    vec2 cur = prev + vec2(cos(a), sin(a)) * len / 12.0 * (1.0 - 0.45 * t);
    cov = max(cov, 1.0 - smoothstep(0.035, 0.075, sdSeg(p, prev, cur)));
    float lr = 0.28 * sin(PI * min(1.0, t * 1.2)) * (1.0 - 0.4 * t) + 0.05;
    for (int s = -1; s <= 1; s += 2) {
      float la = a + float(s) * 1.35;
      vec2 lc = cur + vec2(cos(la), sin(la)) * (lr * 1.1 + 0.12);
      cov = max(cov, 1.0 - smoothstep(lr - 0.04, lr + 0.03, length(p - lc)));
      cov = max(cov, 1.0 - smoothstep(0.02, 0.05, sdSeg(p, cur, lc)));
    }
    prev = cur;
  }
  return cov;
}
void main() {
  vec2 p = uRegion.xy + vUv * uRegion.zw;
  float W = uBoard.x, H = uBoard.y;
  float nearL = 0.0, farL = 0.0;
#if BIOME == 0
  // maple cluster hanging over the top-right corner
  vec2 anchor = vec2(W + 0.6, H + 1.0);
  for (int i = 0; i < 13; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(fi * 1.7, 3.1));
    float ang = mix(3.25, 4.75, h.x);
    float rad = mix(1.2, 7.5, pow(h.y, 0.8));
    vec2 c = anchor + vec2(cos(ang), sin(ang)) * rad + (hash22(vec2(fi, 9.0)) - 0.5) * 1.2;
    float sz = mix(0.95, 1.55, hash12(vec2(fi, 4.2)));
    nearL = max(nearL, maple(p, c, sz, hash12(vec2(fi, 7.7)) * 6.28));
  }
  // twigs
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = mix(3.3, 4.6, hash12(vec2(fi, 1.3)));
    vec2 b = anchor + vec2(cos(ang), sin(ang)) * mix(5.0, 8.0, hash12(vec2(fi, 2.9)));
    nearL = max(nearL, 1.0 - smoothstep(0.04, 0.09, sdSeg(p, anchor, b)));
  }
  // bamboo sprays along the top-left
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 root = vec2(-1.2 + fi * 2.6 + hash12(vec2(fi, 5.0)) * 1.2, H + 1.1 + hash12(vec2(fi, 6.0)) * 0.8);
    for (int j = 0; j < 5; j++) {
      float fj = float(j);
      float ang = -1.0 - 0.9 * hash12(vec2(fi * 7.0 + fj, 2.0)) + fj * 0.1;
      farL = max(farL, bambooLeaf(p, root + vec2(fj * 0.25, -fj * 0.15), mix(1.8, 2.8, hash12(vec2(fi, fj))), 0.2, ang));
    }
    farL = max(farL, 1.0 - smoothstep(0.03, 0.06, sdSeg(p, root - vec2(1.5, -0.3), root + vec2(1.2, -0.4))));
  }
#elif BIOME == 1
  // dry acacia branch reaching in from the lower-left edge
  vec2 a0 = vec2(-2.5, 1.0);
  vec2 a1 = vec2(3.5, 3.4);
  vec2 a2 = vec2(6.8, 2.2);
  vec2 a3 = vec2(5.0, 6.0);
  vec2 a4 = vec2(1.8, 5.6);
  nearL = max(nearL, 1.0 - smoothstep(0.08, 0.16, sdSeg(p, a0, a1)));
  nearL = max(nearL, 1.0 - smoothstep(0.05, 0.11, sdSeg(p, a1, a2)));
  nearL = max(nearL, 1.0 - smoothstep(0.05, 0.1, sdSeg(p, a1, a3)));
  nearL = max(nearL, 1.0 - smoothstep(0.04, 0.09, sdSeg(p, a0 + vec2(2.0, 0.8), a4)));
  // flat-topped leaflet clusters
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(fi, 13.0));
    vec2 c = mix(vec2(-1.0, 1.5), vec2(7.5, 7.0), h) ;
    float blob = fbm3(p * 3.0 + fi) ;
    float d = length((p - c) * vec2(1.0, 1.6));
    nearL = max(nearL, (1.0 - smoothstep(0.35, 0.8, d)) * smoothstep(0.35, 0.6, blob));
  }
#elif BIOME == 2
  // coconut palm fronds from beyond the lower-left corner
  vec2 base = vec2(-2.0, -2.0);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float ang = 0.05 + fi * 0.24 + hash12(vec2(fi, 3.0)) * 0.12;
    nearL = max(nearL, frond(p, base, ang, mix(7.0, 9.5, hash12(vec2(fi, 8.0))), -0.35 + 0.1 * hash12(vec2(fi, 1.0))));
  }
  vec2 base2 = vec2(W + 2.5, -1.5);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    farL = max(farL, frond(p, base2, 1.9 + fi * 0.3, 6.5, 0.35));
  }
#elif BIOME == B_PINK
  // sea-grape branches leaning over the top-left corner, a smaller bush at the bottom-right:
  // leaves in loose rosettes at the branch tips, so light gets through between them
  vec2 anchor = vec2(-1.0, H + 1.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = mix(-1.4, -0.1, (fi + hash12(vec2(fi, 3.3)) * 0.6) / 6.0);
    float len = mix(4.5, 8.5, hash12(vec2(fi, 4.4)));
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 tip = anchor + dir * len;
    nearL = max(nearL, 1.0 - smoothstep(0.04, 0.08, sdSeg(p, anchor, tip)));
    for (int j = 0; j < 5; j++) {
      float fj = float(j);
      float la = ang + (fj - 2.0) * 0.75 + (hash12(vec2(fi, fj + 9.0)) - 0.5) * 0.4;
      float sz = mix(0.8, 1.2, hash12(vec2(fi * 3.0, fj)));
      vec2 c = tip + vec2(cos(la), sin(la)) * sz * 0.55 - dir * fj * 0.15;
      nearL = max(nearL, seaGrape(p, c, sz, la - 1.5708));
    }
    // a pair of older leaves along the branch
    vec2 mid = anchor + dir * len * 0.6;
    float sa = ang + 1.2 * (mod(fi, 2.0) * 2.0 - 1.0);
    nearL = max(nearL, seaGrape(p, mid + vec2(cos(sa), sin(sa)) * 0.5, 0.95, sa - 1.5708));
  }
  vec2 a2 = vec2(W + 1.3, -1.3);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ang = mix(1.75, 2.95, (fi + 0.5) / 3.0);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 tip = a2 + dir * mix(3.0, 4.2, hash12(vec2(fi, 7.0)));
    farL = max(farL, 1.0 - smoothstep(0.04, 0.08, sdSeg(p, a2, tip)));
    for (int j = 0; j < 4; j++) {
      float fj = float(j);
      float la = ang + (fj - 1.5) * 0.8;
      farL = max(farL, seaGrape(p, tip + vec2(cos(la), sin(la)) * 0.5, 1.0, la - 1.5708));
    }
  }
#elif BIOME == B_VAADHOO
  // coconut palm crowns in moonlight (soft: the renderer blurs this cookie more)
  vec2 base = vec2(W + 2.2, H + 2.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = 3.3 + fi * 0.26 + hash12(vec2(fi, 3.0)) * 0.12;
    nearL = max(nearL, frond(p, base, ang, mix(6.5, 9.0, hash12(vec2(fi, 8.0))), 0.3 - 0.1 * hash12(vec2(fi, 1.0))) * 0.75);
  }
  vec2 base2 = vec2(-2.4, -1.8);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    farL = max(farL, frond(p, base2, 0.2 + fi * 0.33, 6.0, -0.3) * 0.7);
  }
#elif BIOME == B_KEPLER
  // alien fronds curling in from two corners; twin suns: G = the same shapes, offset and fainter
  vec2 off = vec2(0.85, -0.55);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 base = vec2(-1.8, H + 1.6);
    float ang = -1.45 + fi * 0.27 + hash12(vec2(fi, 2.0)) * 0.1;
    float len = mix(5.0, 7.5, hash12(vec2(fi, 4.0)));
    float cl = mix(2.2, 3.4, hash12(vec2(fi, 6.0)));
    nearL = max(nearL, alienFrond(p, base, ang, len, cl));
    farL = max(farL, alienFrond(p - off, base, ang, len, cl) * 0.55);
  }
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 base = vec2(W + 1.6, -1.4);
    float ang = 1.75 + fi * 0.32;
    float len = mix(4.0, 6.0, hash12(vec2(fi, 14.0)));
    nearL = max(nearL, alienFrond(p, base, ang, len, -2.6));
    farL = max(farL, alienFrond(p - off, base, ang, len, -2.6) * 0.55);
  }
#endif
  gl_FragColor = vec4(nearL, farL, 0.0, 1.0);
}
`;

export class Cookie {
  private rt: THREE.WebGLRenderTarget;
  private tmp: THREE.WebGLRenderTarget;
  private fsq = new FullscreenPass();
  private mats: THREE.ShaderMaterial[] = [];
  private blur = passMaterial(BLUR_FRAG, {
    uTex: { value: null }, uDirR: { value: new THREE.Vector2() }, uDirG: { value: new THREE.Vector2() },
  });
  readonly region = new THREE.Vector4();
  private board = new THREE.Vector2();

  constructor() {
    this.rt = makeRT(4, 4, { type: THREE.UnsignedByteType });
    this.tmp = makeRT(4, 4, { type: THREE.UnsignedByteType });
  }
  private mat(biome: number) {
    // created on first use: most sessions only ever visit a few worlds
    return (this.mats[biome] ??= passMaterial(COOKIE_FRAG, { uRegion: { value: this.region }, uBoard: { value: this.board } }, { BIOME: biome }));
  }
  get texture() { return this.rt.texture; }

  build(r: THREE.WebGLRenderer, biome: number, W: number, H: number) {
    const m = 4;
    this.region.set(-m, -m, W + 2 * m, H + 2 * m);
    this.board.set(W, H);
    const res = 512;
    const texel = Math.max(this.region.z, this.region.w) / res;
    const tw = Math.round(this.region.z / texel), th = Math.round(this.region.w / texel);
    this.rt.setSize(tw, th);
    this.tmp.setSize(tw, th);
    this.fsq.render(r, this.mat(biome), this.rt);
    // blur: near layer soft, far layer softer
    const u = this.blur.uniforms;
    const bs = BLUR_SCALE[biome] ?? 1;
    const rn = 0.045 * bs / texel, rf = 0.08 * bs / texel;
    for (let it = 0; it < 2; it++) {
      u.uTex.value = this.rt.texture;
      (u.uDirR.value as THREE.Vector2).set(rn / tw, 0);
      (u.uDirG.value as THREE.Vector2).set(rf / tw, 0);
      this.fsq.render(r, this.blur, this.tmp);
      u.uTex.value = this.tmp.texture;
      (u.uDirR.value as THREE.Vector2).set(0, rn / th);
      (u.uDirG.value as THREE.Vector2).set(0, rf / th);
      this.fsq.render(r, this.blur, this.rt);
    }
    r.setRenderTarget(null);
  }

  dispose() {
    this.rt.dispose(); this.tmp.dispose();
    for (const m of this.mats) m?.dispose();
    this.blur.dispose(); this.fsq.dispose();
  }
}
