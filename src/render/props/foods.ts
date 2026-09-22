// Procedural food models per biome. Built once per biome, cloned per food instance.
import * as THREE from 'three';
import { glowTexture, merge, prep, rng, sweep, fbm3 } from './geo';
import type { BiomeId } from '../../types';

const C = (h: string) => new THREE.Color(h);
const lerpC = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));

/** Parametric petal: t 0..1 from centre outward, v -1..1 across. */
function petal(opts: {
  len: number; width: number; notch: number; cup: number; ruffle?: number; ruffleFreq?: number;
  color: (t: number, v: number) => THREE.Color; nu?: number; nv?: number; seed?: number; baseW?: number;
}) {
  const nu = opts.nu ?? 10, nv = opts.nv ?? 8;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const r = rng(opts.seed ?? 1);
  const ph = r() * 6.28;
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      const L = (0.72 + 0.28 * Math.sqrt(Math.max(0, 1 - v * v))) - opts.notch * Math.exp(-(v / 0.22) ** 2);
      const W = (opts.baseW ?? 0.06) + (1 - (opts.baseW ?? 0.06)) * Math.pow(Math.sin(Math.min(1, t / 0.72) * Math.PI / 2), 0.9);
      const x = t * L * opts.len;
      const y = v * W * opts.width * 0.5;
      let z = opts.cup * opts.len * t * t + 0.06 * opts.len * v * v * t;
      if (opts.ruffle) z += opts.ruffle * opts.len * Math.sin(v * (opts.ruffleFreq ?? 7) + ph + t * 3) * t * t;
      pos.push(x, y, z);
      const c = opts.color(t, v);
      col.push(c.r, c.g, c.b);
    }
  }
  const V = nv + 1;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * V + j, b = a + 1, c = a + V, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rotZ(g: THREE.BufferGeometry, a: number, tilt = 0, lift = 0) {
  const m = new THREE.Matrix4().makeRotationY(-tilt);
  g.applyMatrix4(m);
  g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a));
  g.translate(0, 0, lift);
  return g;
}

export interface FoodModel {
  normal: THREE.Group;
  golden: THREE.Group;
  /** Burst particle colours (linear). */
  burst: THREE.Color[];
  /** Height of the "glow" for high-contrast ring / sparkle placement. */
  size: number;
}

export interface SharedMats {
  petal: THREE.MeshPhysicalMaterial;
  glossy: THREE.MeshPhysicalMaterial;
  matte: THREE.MeshStandardMaterial;
  gold: THREE.MeshPhysicalMaterial;
  goldDark: THREE.MeshPhysicalMaterial;
  glow: THREE.MeshBasicMaterial;
  sparkle: THREE.MeshBasicMaterial;
}

let _mats: SharedMats | null = null;
export function sharedMats(): SharedMats {
  if (_mats) return _mats;
  _mats = {
    petal: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(1, 0.9, 0.95), side: THREE.DoubleSide }),
    glossy: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    gold: new THREE.MeshPhysicalMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.2, emissive: new THREE.Color(0xff9a1a), emissiveIntensity: 0.35, clearcoat: 0.6, side: THREE.DoubleSide }),
    goldDark: new THREE.MeshPhysicalMaterial({ color: 0xe0a030, metalness: 1, roughness: 0.3, emissive: new THREE.Color(0xff8a10), emissiveIntensity: 0.25 }),
    glow: new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffc860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.8 }),
    sparkle: new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
  };
  return _mats;
}

/** Tag mesh as non-shadow-casting helper (glows, halos). */
export function noShadow<T extends THREE.Object3D>(o: T): T {
  o.userData.noShadow = true;
  o.castShadow = false;
  o.receiveShadow = false;
  return o;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, role = 'main') {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true;
  x.userData.role = role;
  return x;
}

// ------------------------------------------------------------------ biome foods

function sakura(): THREE.Group {
  const M = sharedMats();
  const grp = new THREE.Group();
  const base = C('#fdf2f4'), mid = C('#f7c6d3'), tip = C('#ef9ab4'), heart = C('#d8547a');
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const g = petal({
      len: 0.34, width: 0.3, notch: 0.16, cup: 0.35, seed: k + 3, ruffle: 0.015,
      color: (t, v) => {
        let c = lerpC(base, mid, t * 1.3);
        c = lerpC(c, tip, Math.pow(Math.abs(v), 3) * t + Math.max(0, t - 0.85) * 2);
        c = lerpC(c, heart, Math.max(0, 0.25 - t) * 3.2);
        c.multiplyScalar(0.95 + 0.05 * Math.cos(v * 20));
        return c;
      },
    });
    geos.push(rotZ(g, (k / 5) * Math.PI * 2 + 0.2, 0.25, 0.04));
  }
  grp.add(mesh(merge(geos), M.petal, 'petal'));
  // stamens
  const r = rng(7);
  const st: THREE.BufferGeometry[] = [];
  const antherGeo: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, L = 0.06 + r() * 0.05;
    const p0 = new THREE.Vector3(0, 0, 0.05);
    const p1 = new THREE.Vector3(Math.cos(a) * L, Math.sin(a) * L, 0.1 + r() * 0.03);
    st.push(sweep([p0, p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 0, 0.01)), p1], [0.004, 0.0035, 0.003], 4, 1,
      (t) => lerpC(C('#f6e6ea'), C('#e9a0b8'), t)));
    const s = new THREE.SphereGeometry(0.011, 6, 4);
    s.translate(p1.x, p1.y, p1.z);
    antherGeo.push(prep(s, C('#f2c230')));
  }
  grp.add(mesh(merge(st), M.matte, 'stamen'));
  grp.add(mesh(merge(antherGeo), M.glossy, 'anther'));
  const cen = new THREE.SphereGeometry(0.03, 10, 6);
  cen.scale(1, 1, 0.5); cen.translate(0, 0, 0.055);
  grp.add(mesh(prep(cen, C('#c9d45a')), M.matte, 'center'));
  return grp;
}

function date(): THREE.Group {
  const M = sharedMats();
  const grp = new THREE.Group();
  // palm leaflet underneath
  const leaf = petal({
    len: 0.62, width: 0.09, notch: 0, cup: -0.02, baseW: 0.25, nu: 14, nv: 4,
    color: (t, v) => lerpC(lerpC(C('#6f8a3a'), C('#9aa84a'), t), C('#4a6a28'), Math.abs(v) < 0.3 ? 0.5 : 0),
  });
  leaf.translate(-0.31, 0, 0.012);
  leaf.rotateZ(0.75);
  grp.add(mesh(leaf, M.petal, 'leaf'));
  const dates: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  [[-0.05, -0.06, 0.35], [0.1, 0.07, -0.25]].forEach(([x, y, a], i) => {
    const g = new THREE.SphereGeometry(1, 28, 18);
    const p = g.getAttribute('position');
    const v = new THREE.Vector3();
    const col: number[] = [];
    const dark = C('#5a2a0c'), amber = C('#b8641c'), hi = C('#d99a3a');
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const wr = fbm3(v.x * 2.0, v.y * 9, v.z * 9, 11 + i, 3);
      const d = 1 + (wr - 0.5) * 0.09;
      p.setXYZ(k, v.x * 0.2 * d, v.y * 0.11 * d, v.z * 0.1 * d);
      const c = lerpC(lerpC(dark, amber, wr * 1.4 - 0.1), hi, Math.max(0, v.z) * 0.35);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.rotateZ(a); g.translate(x, y, 0.085);
    dates.push(prep(g, undefined)); (dates[dates.length - 1] as THREE.BufferGeometry).setAttribute('color', g.getAttribute('color'));
    const cap = new THREE.CylinderGeometry(0.035, 0.045, 0.03, 10);
    cap.rotateZ(Math.PI / 2); cap.translate(0.195, 0, 0); cap.rotateZ(a); cap.translate(x, y, 0.09);
    caps.push(prep(cap, C('#c8a060')));
  });
  grp.add(mesh(merge(dates), M.glossy, 'fruit'));
  grp.add(mesh(merge(caps), M.matte, 'cap'));
  return grp;
}

function hibiscus(): THREE.Group {
  const M = sharedMats();
  const grp = new THREE.Group();
  const eye = C('#5a0616'), red = C('#e01a34'), edge = C('#ff5a6a');
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const g = petal({
      len: 0.4, width: 0.46, notch: 0.02, cup: 0.18, seed: 20 + k, ruffle: 0.05, ruffleFreq: 9, nu: 12, nv: 12,
      color: (t, v) => {
        let c = lerpC(eye, red, (t - 0.12) * 5);
        c = lerpC(c, edge, Math.max(0, t - 0.7) * 2.5);
        c.multiplyScalar(0.88 + 0.12 * Math.cos(v * 26 + t * 2));
        return c;
      },
    });
    geos.push(rotZ(g, (k / 5) * Math.PI * 2, 0.12, 0.02 + k * 0.004));
  }
  grp.add(mesh(merge(geos), M.petal, 'petal'));
  // staminal column
  const pts: THREE.Vector3[] = [], rr: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(t * 0.36, 0.02 * Math.sin(t * 3), 0.05 + 0.1 * Math.sin(t * Math.PI * 0.6)));
    rr.push(0.012 - 0.004 * t);
  }
  const col = sweep(pts, rr, 6, 1, (t) => lerpC(C('#ffd0a0'), C('#ff6a4a'), t));
  const anth: THREE.BufferGeometry[] = [];
  const r = rng(4);
  for (let i = 0; i < 18; i++) {
    const t = 0.55 + r() * 0.35;
    const p = pts[Math.round(t * 8)];
    const s = new THREE.SphereGeometry(0.009, 5, 4);
    s.translate(p.x + (r() - 0.5) * 0.02, p.y + (r() - 0.5) * 0.04, p.z + 0.012 + r() * 0.01);
    anth.push(prep(s, C('#ffd23a')));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const s = new THREE.SphereGeometry(0.012, 6, 4);
    s.translate(0.37 + Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0.1);
    anth.push(prep(s, C('#b0102a')));
  }
  grp.add(mesh(col, M.matte, 'column'));
  grp.add(mesh(merge(anth), M.glossy, 'anther'));
  grp.rotation.z = 0.4;
  return grp;
}

let _gradTex: THREE.Texture | null = null;
function emberGrad() {
  if (_gradTex) return _gradTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 64, 0, 0);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#ffb060'); gr.addColorStop(0.75, '#a02808'); gr.addColorStop(1, '#300800');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  _gradTex = new THREE.CanvasTexture(c);
  _gradTex.colorSpace = THREE.SRGBColorSpace;
  return _gradTex;
}
let _crystalMat: THREE.MeshPhysicalMaterial | null = null;
export function crystalMat() {
  if (_crystalMat) return _crystalMat;
  _crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a1008, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
    emissive: new THREE.Color(0xff5a1a), emissiveIntensity: 2.0, emissiveMap: emberGrad(), flatShading: true,
    ior: 1.7, specularIntensity: 1,
  });
  return _crystalMat;
}

function emberCrystal(): THREE.Group {
  const grp = new THREE.Group();
  const r = rng(9);
  const geos: THREE.BufferGeometry[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const h = i === 0 ? 0.36 : 0.18 + r() * 0.14;
    const rad = i === 0 ? 0.06 : 0.035 + r() * 0.02;
    const body = new THREE.CylinderGeometry(rad, rad * 1.05, h, 6, 1, true);
    body.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(rad, rad * 1.8, 6, 1, true);
    tip.translate(0, h + rad * 0.9, 0);
    const g = merge([prep(body), prep(tip)]);
    // uv v along height for the emissive gradient
    const p = g.getAttribute('position');
    const uv = new Float32Array(p.count * 2);
    const top = h + rad * 1.8;
    for (let k = 0; k < p.count; k++) { uv[k * 2] = 0.5; uv[k * 2 + 1] = p.getY(k) / top; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const a = (i / n) * Math.PI * 2 + r();
    const tilt = i === 0 ? 0.2 : 0.7 + r() * 0.35;
    g.rotateX(Math.PI / 2); // up = +z
    g.rotateY(tilt);
    g.rotateZ(a);
    g.translate(Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0);
    geos.push(g.toNonIndexed());
  }
  const all = merge(geos);
  all.computeVertexNormals();
  grp.add(mesh(all, crystalMat(), 'crystal'));
  // base rock
  const rock = new THREE.IcosahedronGeometry(0.1, 1);
  rock.scale(1.3, 1.1, 0.4);
  grp.add(mesh(prep(rock, C('#1a1a1c')), sharedMats().matte, 'rock'));
  return grp;
}

function kantuta(): THREE.Group {
  const M = sharedMats();
  const grp = new THREE.Group();
  const prof: THREE.Vector2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = 0.018 + 0.03 * Math.pow(t, 1.8) + (t > 0.85 ? (t - 0.85) * 0.25 : 0);
    prof.push(new THREE.Vector2(r, t * 0.3));
  }
  const flowers: THREE.BufferGeometry[] = [];
  const stam: THREE.BufferGeometry[] = [];
  const cols = [['#e8c43a', '#d8182e', '#ff3a6a'], ['#d8d040', '#c81a4a', '#e0306a'], ['#b8d040', '#e0203a', '#ff5a5a'], ['#e8c43a', '#d02a60', '#ff4a8a']];
  const r = rng(12);
  for (let k = 0; k < 4; k++) {
    const g = new THREE.LatheGeometry(prof, 14);
    const p = g.getAttribute('position');
    const cc: number[] = [];
    const [c0, c1, c2] = cols[k].map(C);
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / 0.3;
      const c = t < 0.2 ? lerpC(c0, c1, t / 0.2) : lerpC(c1, c2, (t - 0.2) / 0.8);
      cc.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    const a = (k / 4) * Math.PI * 2 + 0.3 + r() * 0.3;
    g.rotateZ(-Math.PI / 2); // along +x
    g.rotateY(-0.2);
    g.translate(0.02, 0, 0.05);
    g.rotateZ(a);
    flowers.push(g);
    for (let s = 0; s < 4; s++) {
      const sph = new THREE.SphereGeometry(0.008, 5, 4);
      const d = 0.31 + r() * 0.02;
      sph.translate(d, (r() - 0.5) * 0.03, 0.1 + (r() - 0.5) * 0.02);
      sph.rotateZ(a);
      stam.push(prep(sph, C('#fff08a')));
    }
  }
  const fl = merge(flowers.map((g) => { const o = prep(g); o.setAttribute('color', g.getAttribute('color')); return o; }));
  grp.add(mesh(fl, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, sheen: 0.8, sheenColor: new THREE.Color(1, 0.7, 0.8), side: THREE.DoubleSide }), 'petal'));
  grp.add(mesh(merge(stam), M.glossy, 'anther'));
  // leaves
  const lv: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const l = petal({ len: 0.16, width: 0.06, notch: 0, cup: 0.1, nu: 6, nv: 4, color: () => C('#4a7a3a') });
    lv.push(rotZ(l, (k / 3) * Math.PI * 2 + 1.1, 0.1, 0.03));
  }
  grp.add(mesh(merge(lv), M.petal, 'leaf'));
  return grp;
}

function sparkleGeo() {
  const s = new THREE.Shape();
  const R = 1, r = 0.18;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? R : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
let _spark: THREE.BufferGeometry | null = null;
export function sparkleGeometry() { return (_spark ??= sparkleGeo()); }
let _plane: THREE.BufferGeometry | null = null;
export function unitPlane() { return (_plane ??= new THREE.PlaneGeometry(1, 1)); }

function goldify(src: THREE.Group, crystal: boolean): THREE.Group {
  const M = sharedMats();
  const g = src.clone(true);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const role = m.userData.role as string;
    if (role === 'glow') { m.material = M.glow; return; }
    m.material = (role === 'anther' || role === 'center' || role === 'cap' || role === 'rock' || role === 'column') ? M.goldDark : M.gold;
    if (crystal && role === 'crystal') m.material = M.gold;
  });
  // glow + sparkles
  const glow = noShadow(new THREE.Mesh(unitPlane(), M.glow));
  glow.scale.setScalar(1.3);
  glow.position.z = 0.02;
  glow.userData.role = 'glow';
  g.add(glow);
  for (let i = 0; i < 5; i++) {
    const sp = noShadow(new THREE.Mesh(sparkleGeometry(), M.sparkle));
    sp.userData.role = 'sparkle';
    sp.userData.phase = i * 1.37;
    const a = (i / 5) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.2 + (i % 2) * 0.08);
    g.add(sp);
  }
  return g;
}

const BURST: Record<BiomeId, string[]> = {
  karesansui: ['#f7c6d3', '#fbe1e8', '#ef9ab4'],
  erg: ['#b8641c', '#d99a3a', '#7a8a3a'],
  lagoon: ['#e01a34', '#ff5a6a', '#ffd23a'],
  svartsandur: ['#ff8a2a', '#ffc15a', '#ff4d1a'],
  salar: ['#d8182e', '#ff3a6a', '#e8c43a'],
};

const cache = new Map<BiomeId, FoodModel>();
export function foodModel(b: BiomeId): FoodModel {
  let m = cache.get(b);
  if (m) return m;
  const normal = b === 'karesansui' ? sakura() : b === 'erg' ? date() : b === 'lagoon' ? hibiscus() : b === 'svartsandur' ? emberCrystal() : kantuta();
  if (b === 'svartsandur') {
    const glow = noShadow(new THREE.Mesh(unitPlane(), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff6a20, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.9 })));
    glow.scale.setScalar(1.1); glow.position.z = 0.015; glow.userData.role = 'glow';
    normal.add(glow);
  }
  const golden = goldify(normal, b === 'svartsandur');
  m = { normal, golden, burst: BURST[b].map((h) => new THREE.Color(h)), size: 0.4 };
  cache.set(b, m);
  return m;
}
