// Eyes, tongue and (viper) horns, attached to the head frame of the body each frame.
import * as THREE from 'three';
import { sweep } from '../props/geo';
import type { SkinLook } from './skinLooks';
import type { RingFrame } from './SnakeBody';

function eyeMaterial() {
  const u = {
    uIris: { value: new THREE.Color('#c9a23c') },
    uLid: { value: new THREE.Color('#171513') },
    uPupil: { value: 1 },
    uClosed: { value: 0 },
    uGlow: { value: 0 },
  };
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.45,
    specularIntensity: 1,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEL;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEL = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vEL;
uniform vec3 uIris, uLid; uniform float uPupil, uClosed, uGlow;
`)
      .replace('#include <map_fragment>', `
vec3 p = normalize(vEL);
vec3 gaze = normalize(vec3(1.0, 0.22, 0.95));
vec3 fwd = normalize(vec3(0.0, 1.0, 0.0) - gaze * dot(vec3(0.0, 1.0, 0.0), gaze));
vec3 upv = cross(gaze, fwd);
float g = dot(p, gaze);
vec2 pl = vec2(dot(p, fwd), dot(p, upv)); // position on the iris disc
float rr = length(pl);
float ang = atan(pl.y, pl.x);
float streak = 0.75 + 0.25 * sin(ang * 23.0 + sin(ang * 7.0) * 2.0) * smoothstep(0.1, 0.6, rr);
vec3 iris = uIris * streak * mix(1.15, 0.55, smoothstep(0.35, 0.8, rr));
iris = mix(iris, uIris * 1.5, smoothstep(0.55, 0.0, rr) * 0.25);
float pupil;
if (uPupil > 0.5) pupil = 1.0 - smoothstep(0.06, 0.1, abs(pl.x) / max(0.001, 1.0 - pow(abs(pl.y) / 0.62, 2.0)) ) * step(abs(pl.y), 0.62);
else pupil = 1.0 - smoothstep(0.27, 0.32, rr);
pupil *= step(0.0, g);
vec3 col = mix(iris, vec3(0.005), pupil);
col = mix(col, uIris * 0.12, smoothstep(0.62, 0.9, rr)); // limbus
col = mix(col, uLid * 0.8, 1.0 - smoothstep(-0.1, 0.25, g)); // back of the eye (inside head)
// closed: skin lid with a dark seam
float seam = 1.0 - smoothstep(0.02, 0.07, abs(pl.y));
col = mix(col, mix(uLid * 1.1, uLid * 0.25, seam), uClosed);
diffuseColor.rgb = col;
`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += iris * uGlow * (1.0 - pupil) * step(0.0, g) * (1.0 - uClosed * 0.85);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.roughness = mix(material.roughness, 0.55, uClosed);
#ifdef USE_CLEARCOAT
material.clearcoat *= 1.0 - uClosed * 0.7;
#endif`);
  };
  m.customProgramCacheKey = () => 'serpent-eye-v1';
  return { m, u };
}

function tongueGeometry() {
  // along +X, length 1; stem then two forked tines
  const stemPts: THREE.Vector3[] = [], stemR: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    stemPts.push(new THREE.Vector3(t * 0.64, 0, 0));
    stemR.push(0.075 - 0.02 * t);
  }
  const geos = [sweep(stemPts, stemR, 8, 0.5)];
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [], rr: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(0.6 + t * 0.4, side * (0.01 + 0.16 * Math.pow(t, 1.3)), 0.02 * t));
      rr.push(0.052 * (1 - t) + 0.006);
    }
    geos.push(sweep(pts, rr, 8, 0.55));
  }
  // merge manually (all have position/normal/index)
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

export class SnakeHead {
  readonly group = new THREE.Group();
  private eyeL: THREE.Mesh;
  private eyeR: THREE.Mesh;
  private eyeU: ReturnType<typeof eyeMaterial>['u'];
  private tongue: THREE.Mesh;
  private tongueMat: THREE.MeshPhysicalMaterial;
  private hornL: THREE.Mesh;
  private hornR: THREE.Mesh;
  private hornMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshPhysicalMaterial;
  private fr: RingFrame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, w: 0, h: 0, zc: 0 };
  private fr2: RingFrame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, w: 0, h: 0, zc: 0 };
  // animation state
  private blinkT = 2.5;
  private blinkPhase = -1;
  private flickNext = 1.2;
  private flickT = -1;
  private flickN = 0;
  private seed = 1;
  horns = false;
  /** Debug: keep the tongue flicking constantly. */
  forceTongue = false;

  constructor() {
    const eg = new THREE.SphereGeometry(1, 22, 16);
    const e = eyeMaterial();
    this.eyeU = e.u;
    this.eyeMat = e.m;
    this.eyeL = new THREE.Mesh(eg, e.m);
    this.eyeR = new THREE.Mesh(eg, e.m);
    this.tongueMat = new THREE.MeshPhysicalMaterial({ color: 0xc21d2a, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0.3 });
    this.tongue = new THREE.Mesh(tongueGeometry(), this.tongueMat);
    this.hornMat = new THREE.MeshStandardMaterial({ color: 0xcfa97a, roughness: 0.7 });
    const hg = new THREE.ConeGeometry(1, 1, 10, 1);
    hg.translate(0, 0.5, 0);
    this.hornL = new THREE.Mesh(hg, this.hornMat);
    this.hornR = new THREE.Mesh(hg, this.hornMat);
    for (const m of [this.eyeL, this.eyeR, this.tongue, this.hornL, this.hornR]) {
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  setLook(L: SkinLook) {
    this.eyeU.uIris.value.setStyle(L.iris);
    this.eyeU.uLid.value.setStyle(L.base);
    this.eyeU.uPupil.value = L.pupil;
    this.eyeU.uGlow.value = L.eyeGlow;
    this.tongueMat.color.setStyle(L.tongue);
    this.tongueMat.emissive.setStyle(L.index === 7 ? '#ff4a10' : '#000000');
    this.tongueMat.emissiveIntensity = L.index === 7 ? 1.5 : 0;
    this.hornMat.color.setStyle(L.alt);
    this.horns = L.horns;
  }

  /** Attach to the body frame (frameAt: arclength -> ring frame) and animate blink / tongue. */
  update(
    frameAt: (s: number, out: RingFrame) => RingFrame, tipS: number, r: number,
    dt: number, alive: boolean, deathT: number, interest: number, ghost: boolean, opacity: number,
  ) {
    const rnd = () => (this.seed = (this.seed * 16807) % 2147483647) / 2147483647;
    // --- blink
    let closed = 0;
    if (alive) {
      this.blinkT -= dt;
      if (this.blinkT <= 0 && this.blinkPhase < 0) { this.blinkPhase = 0; }
      if (this.blinkPhase >= 0) {
        this.blinkPhase += dt;
        const bp = this.blinkPhase / 0.16;
        closed = bp < 1 ? Math.sin(bp * Math.PI) : 0;
        if (bp >= 1) { this.blinkPhase = -1; this.blinkT = 2.5 + rnd() * 4.5; }
      }
    } else {
      closed = Math.min(1, deathT / 0.35);
    }
    this.eyeU.uClosed.value = closed;
    const eyeMat = this.eyeMat;
    eyeMat.transparent = ghost; eyeMat.opacity = ghost ? Math.min(1, opacity + 0.25) : 1;

    // --- eyes
    const fe = frameAt(tipS + r * 1.45, this.fr);
    const er = r * 0.27;
    const fx = -fe.tx, fy = -fe.ty; // forward
    const sx = -fe.ty, sy = fe.tx;   // body side (right of tail direction)
    for (const side of [1, -1]) {
      const m = side > 0 ? this.eyeR : this.eyeL;
      const ox = sx * side, oy = sy * side;
      const px = fe.x + ox * fe.w * 0.8, py = fe.y + oy * fe.w * 0.8;
      const pz = fe.zc + fe.h * 0.58;
      _x.set(ox, oy, 0); _y.set(fx, fy, 0); _z.set(0, 0, 1);
      _m.makeBasis(_x, _y, _z);
      const sq = 1 - closed * 0.55;
      _m.scale(_z.set(er * (1 - closed * 0.2), er * sq, er * (1 - closed * 0.45)));
      _m.setPosition(px, py, pz);
      m.matrix.copy(_m);
      m.matrixWorldNeedsUpdate = true;
      // horns
      const hm = side > 0 ? this.hornR : this.hornL;
      hm.visible = this.horns;
      if (this.horns) {
        // cone +Y axis -> up, tilted outward and back
        const ux = ox * 0.62 - fx * 0.62, uy = oy * 0.62 - fy * 0.62, uz = 0.45;
        _y.set(ux, uy, uz).normalize();
        _x.set(fx, fy, 0).cross(_y).normalize();
        _z.crossVectors(_x, _y);
        _m.makeBasis(_x, _y, _z);
        _m.scale(_z.set(r * 0.1, r * 0.72, r * 0.1));
        _m.setPosition(px - fx * er * 0.2, py - fy * er * 0.2, pz + er * 0.45);
        hm.matrix.copy(_m);
        hm.matrixWorldNeedsUpdate = true;
      }
    }
    this.eyeL.visible = this.eyeR.visible = fe.w > 0.01;

    // --- tongue
    let ext = 0;
    if (alive) {
      this.flickNext -= dt;
      if (this.flickT < 0 && (this.flickNext <= 0 || this.forceTongue)) {
        this.flickT = 0;
        this.flickN = 2 + (rnd() < 0.45 ? 1 : 0);
      }
      if (this.flickT >= 0) {
        this.flickT += dt;
        const per = 0.21;
        const k = Math.floor(this.flickT / per);
        if (k >= this.flickN) {
          this.flickT = -1;
          const base = 4.2 - 3.0 * Math.min(1, Math.max(0, interest));
          this.flickNext = base * (0.6 + rnd() * 0.8);
        } else {
          const ph = (this.flickT - k * per) / per;
          ext = Math.pow(Math.sin(Math.min(1, ph / 0.85) * Math.PI), 0.6);
        }
      }
    } else { this.flickT = -1; }
    this.tongue.visible = ext > 0.02 && alive && fe.w > 0.01;
    if (this.tongue.visible) {
      const ft = frameAt(tipS + r * 0.12, this.fr2);
      const len = r * 1.3 * ext;
      const wig = Math.sin(this.flickT * 62) * 0.35 * ext;
      _x.set(-ft.tx, -ft.ty, 0.06 + wig * 0.3).normalize();
      _z.set(0, 0, 1); _y.crossVectors(_z, _x).normalize(); _z.crossVectors(_x, _y);
      _m.makeBasis(_x, _y, _z);
      _m.scale(_s.set(len, r * 1.3 * (0.8 + 0.2 * ext) * (1 + Math.sin(this.flickT * 45) * 0.15), r * 1.3));
      _m.setPosition(ft.x, ft.y, Math.max(0.03, ft.zc * 0.85));
      this.tongue.matrix.copy(_m);
      this.tongue.matrixWorldNeedsUpdate = true;
    }
  }

  dispose() {
    this.eyeL.geometry.dispose();
    this.tongue.geometry.dispose();
    this.hornL.geometry.dispose();
    this.eyeMat.dispose();
    this.tongueMat.dispose();
    this.hornMat.dispose();
  }
}
