// Static procedural geometry helpers for Legend characters (built once, shared by instances).
// Local convention: +X forward (toward the head), +Y left, +Z up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Give a geometry a constant vertex colour (for merged multi-colour parts). */
export function paint(g: THREE.BufferGeometry, c: THREE.ColorRepresentation | THREE.Color, k = 1): THREE.BufferGeometry {
  const cc = new THREE.Color(c as any).multiplyScalar(k);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Vertex colour gradient along an axis (0=x,1=y,2=z) between two colours over [lo, hi]. */
export function paintGrad(g: THREE.BufferGeometry, axis: number, lo: number, hi: number, cA: THREE.ColorRepresentation, cB: THREE.ColorRepresentation) {
  const A = new THREE.Color(cA as any), Bc = new THREE.Color(cB as any);
  const p = g.getAttribute('position');
  const n = p.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = axis === 0 ? p.getX(i) : axis === 1 ? p.getY(i) : p.getZ(i);
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    a[i * 3] = A.r + (Bc.r - A.r) * t; a[i * 3 + 1] = A.g + (Bc.g - A.g) * t; a[i * 3 + 2] = A.b + (Bc.b - A.b) * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Merge geometries (position/normal/color only; missing colours default to white). */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = list.map((g0) => {
    let g = g0.index ? g0 : indexify(g0);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('color')) paint(g, 0xffffff);
    return g;
  });
  const m = mergeGeometries(prepared, false)!;
  m.computeBoundingSphere();
  return m;
}

function indexify(g: THREE.BufferGeometry) {
  const n = g.getAttribute('position').count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Mirror across the XZ plane (y → -y), fixing winding and normals. */
export function mirrorY(g0: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = g0.clone();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, -p.getY(i));
  const nr = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nr) for (let i = 0; i < nr.count; i++) nr.setY(i, -nr.getY(i));
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
  return g;
}

/**
 * Superellipse dome: footprint |x/0.5|^p + |y/0.5|^p = 1 (x,y ∈ [-.5,.5]); top at z = 1, rim at z = zRim,
 * with a short vertical skirt to z = 0. `crown` (0..1) flattens the top.
 */
export function superDome(nA = 40, nR = 8, p = 4, zRim = 0.35, crown = 0.5): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const e = 2 / p;
  // rings: 0 = skirt bottom, 1 = rim, 2..nR+1 = dome rings, last = apex
  const rings = nR + 2;
  for (let r = 0; r < rings; r++) {
    let rho: number, z: number;
    if (r === 0) { rho = 1; z = 0; }
    else {
      const t = (r - 1) / nR; // 0 rim → 1 apex
      rho = Math.cos(t * Math.PI * 0.5);
      const h = Math.sin(t * Math.PI * 0.5);
      z = zRim + (1 - zRim) * Math.pow(h, 1 - crown * 0.6);
    }
    for (let a = 0; a < nA; a++) {
      const th = (a / nA) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const x = 0.5 * Math.sign(c) * Math.pow(Math.abs(c), e) * rho;
      const y = 0.5 * Math.sign(s) * Math.pow(Math.abs(s), e) * rho;
      pos.push(x, y, z);
    }
  }
  const apex = pos.length / 3;
  pos.push(0, 0, 1);
  for (let r = 0; r < rings - 1; r++) for (let a = 0; a < nA; a++) {
    const a1 = (a + 1) % nA;
    const i0 = r * nA + a, i1 = r * nA + a1, j0 = (r + 1) * nA + a, j1 = (r + 1) * nA + a1;
    idx.push(i0, i1, j0, i1, j1, j0);
  }
  const last = (rings - 1) * nA;
  for (let a = 0; a < nA; a++) idx.push(last + a, last + ((a + 1) % nA), apex);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

/** Tapered tube through a polyline (static), each joint capped with a sphere. */
export function limb(pts: [number, number, number][], radii: number[], radial = 7, caps = true): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
    const len = a.distanceTo(b);
    const c = new THREE.CylinderGeometry(radii[i + 1], radii[i], len, radial, 1, true);
    _v.subVectors(b, a).normalize();
    _q.setFromUnitVectors(_up, _v);
    c.applyQuaternion(_q);
    _w.addVectors(a, b).multiplyScalar(0.5);
    c.translate(_w.x, _w.y, _w.z);
    parts.push(c);
    if (caps && radii[i] > 0.004) {
      const s = new THREE.SphereGeometry(radii[i], radial, Math.max(3, radial >> 1));
      s.translate(a.x, a.y, a.z);
      parts.push(s);
    }
  }
  return merge(parts);
}

/** Axis-aligned ellipsoid centred at (x,y,z) with semi-axes (a,b,c). */
export function ellipsoid(a: number, b: number, c: number, x = 0, y = 0, z = 0, ws = 12, hs = 8): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.rotateX(Math.PI / 2); // poles on Z
  g.scale(a, b, c);
  g.translate(x, y, z);
  return g;
}

/** Cone pointing along +X from base centre (x,y,z). */
export function cone(len: number, rad: number, x = 0, y = 0, z = 0, seg = 8): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(rad, len, seg, 1, false);
  g.rotateZ(-Math.PI / 2);
  g.translate(x + len / 2, y, z);
  return g;
}

/** Box with chamfer-ish bevel via a rounded rectangle extrude (flat shaded). */
export function roundedBox(lx: number, ly: number, lz: number, r: number, x = 0, y = 0, z = 0, seg = 2): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const hx = lx / 2 - r, hy = ly / 2 - r;
  sh.moveTo(-hx, -ly / 2);
  sh.lineTo(hx, -ly / 2); sh.quadraticCurveTo(lx / 2, -ly / 2, lx / 2, -hy);
  sh.lineTo(lx / 2, hy); sh.quadraticCurveTo(lx / 2, ly / 2, hx, ly / 2);
  sh.lineTo(-hx, ly / 2); sh.quadraticCurveTo(-lx / 2, ly / 2, -lx / 2, hy);
  sh.lineTo(-lx / 2, -hy); sh.quadraticCurveTo(-lx / 2, -ly / 2, -hx, -ly / 2);
  const bev = Math.min(r, lz * 0.3);
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, lz - bev * 2), bevelEnabled: true, bevelSize: bev * 0.8, bevelThickness: bev, bevelSegments: seg, curveSegments: 3 });
  g.translate(x, y, z + bev);
  return g;
}

/** A disc lying on the XY plane. */
export function disc(r: number, x = 0, y = 0, z = 0, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, seg);
  g.translate(x, y, z);
  return g;
}
