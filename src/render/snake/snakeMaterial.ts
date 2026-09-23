// Snake skin: MeshPhysicalMaterial extended with procedural scales + per-skin patterns.
// Lighting comes from the scene's real lights / environment, so it matches the sand.
// All skins live in one program (uniform branch), so setSkin never recompiles
// (except toggling iridescence, which three caches as a second program).
import * as THREE from 'three';
import { LIGHT } from '../lighting';
import { SKIN_LOOKS, type SkinLook } from './skinLooks';
import type { SkinId, SnakeSkinId } from '../../types';

export const SNAKE_ROWS = 22; // dorsal scale rows around the body (even)
export const SCALE_LEN = 0.072; // world length of one scale row step at full radius

const GLSL_COMMON = /* glsl */ `
uniform int uSkin;
uniform vec3 uCBase, uCPat, uCBelly, uCAlt, uCRim;
uniform float uRimK, uKeel, uEmitK, uIrid, uRough, uCC;
uniform float uTime, uDead, uGhost, uR;
uniform vec3 uSunDir, uSunCol;
uniform vec3 uCExtra;
uniform float uLen, uIridX, uGlassA;
uniform vec3 uSun2Dir, uSun2Col;
varying vec3 vWP;     // world position (world-stable effects: nebula, caustics)
varying vec3 vWN;     // world geometric normal
varying vec3 vTanV;
varying vec4 vInfo;   // sTip, s, W, tailT
varying vec2 vSUv;    // u around (0 belly .5 top), v scale coordinate

float sh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 sh22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float svn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(sh12(i), sh12(i + vec2(1, 0)), u.x), mix(sh12(i + vec2(0, 1)), sh12(i + vec2(1, 1)), u.x), u.y); }
float sfbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * svn(p); p = p * 2.03 + 17.1; a *= .5; } return s * 1.066; }
// distance to voronoi cell border
float svoro(vec2 x){
  vec2 n = floor(x), f = fract(x), mg, mr; float md = 8.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = sh22(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; } }
  md = 8.;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j)); vec2 o = sh22(n + g); vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }
  return md;
}
// twinkling star points on a jittered grid (dens = fraction of cells with a star)
float starField(vec2 p, float dens, float sz, float t){
  vec2 i = floor(p), f = fract(p);
  float h = sh12(i + 71.7);
  if (h > dens) return 0.0;
  vec2 o = 0.2 + 0.6 * sh22(i + 13.1);
  float d = length(f - o);
  float fw = max(fwidth(p.x), 1e-4);
  float r = max(sz, fw * 1.1);
  float core = 1.0 - smoothstep(0.0, r, d);
  float k = h / dens;
  float tw = 0.5 + 0.5 * sin(t * (1.7 + 4.3 * k) + k * 61.0);
  return core * core * (0.35 + 0.65 * k) * (0.25 + 0.75 * tw * tw) * min(1.0, sz / r * 1.4);
}
// ridged value noise (cheap caustic filaments)
float ridged(vec2 p){ return 1.0 - abs(2.0 * svn(p) - 1.0); }
float aaStep(float edge, float x){ float w = max(fwidth(x), 1e-4); return smoothstep(edge - w, edge + w, x); }
float aaBand(float lo, float hi, float x){ return aaStep(lo, x) * (1.0 - aaStep(hi, x)); }

struct Scale { float h; vec2 g; float e; float occ; vec2 id; vec2 q; };

// Overlapping shingled scales on a staggered lattice. p.x = around (rows), p.y = along (toward tail).
Scale scaleField(vec2 p, vec2 ab, float keel, float rows) {
  Scale S; S.h = 0.; S.g = vec2(0.); S.e = 1.; S.occ = 1.; S.id = vec2(0.); S.q = vec2(0.);
  float bestPri = 1e9, fbE = 1e9; vec2 bD = vec2(0.), bId = vec2(0.), fD = vec2(0.), fId = vec2(0.);
  float bE = 1.; bool found = false;
  float row0 = floor(p.x);
  for (int di = -1; di <= 1; di++) {
    float r = row0 + float(di);
    float off = 0.5 * mod(r, 2.0);
    float j0 = floor(p.y - off);
    for (int dj = -1; dj <= 1; dj++) {
      float j = j0 + float(dj);
      vec2 c = vec2(r + 0.5, j + off + 0.5);
      vec2 d = (p - c) / ab;
      float e = dot(d, d);
      if (e < 1.0 && c.y < bestPri) { bestPri = c.y; bD = d; bId = vec2(mod(r, rows), j); bE = e; found = true; }
      if (e < fbE) { fbE = e; fD = d; fId = vec2(mod(r, rows), j); }
    }
  }
  if (!found) { bD = fD; bId = fId; bE = min(fbE, 1.0); }
  vec2 q = bD;
  float f1 = max(1.0 - bE, 0.0);
  float sq = sqrt(max(f1, 0.02));
  float tt = clamp(f1 / 0.3, 0.0, 1.0);
  float ss = tt * tt * (3.0 - 2.0 * tt);
  float dss = 6.0 * tt * (1.0 - tt) / 0.3;
  float g2 = 0.45 + 0.55 * clamp(0.5 + 0.5 * q.y, 0., 1.);
  float prof = 0.55 * ss + 0.45 * sq;
  float h = prof * g2;
  vec2 dq = (0.55 * dss * (-2.0 * q) + 0.45 * (-q / sq)) * g2 + prof * vec2(0.0, 0.275);
  // keel ridge
  float kr = keel * exp(-q.x * q.x * 28.0) * sq;
  h += kr * 0.35;
  dq.x += kr * 0.35 * (-56.0 * q.x);
  S.h = h;
  S.g = dq / ab;
  S.e = sqrt(bE);
  S.occ = mix(0.62, 1.0, smoothstep(-0.7, 0.25, q.y));
  S.id = bId;
  S.q = q;
  return S;
}
`;

const GLSL_SURF = /* glsl */ `
vec3 sAlb; float sRough; float sMetal; vec3 sEmit; float sCCk; float sIridk; vec2 sGrad; float sAO;
float sAlpha; float sThick; float sFilm; vec2 sFacet; float sDet;

void snakeSurface() {
  float u = vSUv.x;
  float sTip = vInfo.x, s = vInfo.y, W = vInfo.z, tailT = vInfo.w;
  float lat = (u - 0.5) * 2.0;             // 0 dorsal midline, +-0.5 flanks, +-1 belly
  float alat = abs(lat);
  float headLen = uR * 2.75;
  float hm = 1.0 - smoothstep(headLen * 0.86, headLen * 1.0, sTip);

  // ---- body scales
  vec2 pB = vec2(u * ${SNAKE_ROWS}.0, vSUv.y);
  Scale sc = scaleField(pB, vec2(0.7, 0.8), uKeel, ${SNAKE_ROWS}.0);
  float fwB = max(length(fwidth(pB)), 1e-4);
  float detB = 1.0 - smoothstep(0.28, 0.75, fwB);
  float border = smoothstep(0.72, 0.98, sc.e) * (sc.q.y > -0.2 ? 1.0 : 0.35);
  vec2 grad = sc.g * detB;
  float ao = mix(1.0, sc.occ, detB);
  float det = detB;
  vec2 cid = sc.id;
  float qy = sc.q.y;

  // ---- head: large polygonal plates (paired about the midline) + labial row
  if (hm > 0.01) {
    vec2 hp = vec2(alat * 3.5 + 0.37, sTip / (uR * 0.56));
    float eps = 0.03;
    float e0 = svoro(hp);
    float ex = svoro(hp + vec2(eps, 0.0));
    float ey = svoro(hp + vec2(0.0, eps));
    float gw = 0.065;
    float mid = smoothstep(0.0, 0.03, alat);
    float h0 = smoothstep(0.0, gw, e0) * mid;
    float hx = smoothstep(0.0, gw, ex) * mid, hy = smoothstep(0.0, gw, ey) * mid;
    vec2 gH = vec2((hx - h0) / eps * sign(lat), (hy - h0) / eps) * 0.26;
    float fwH = max(length(fwidth(hp)), 1e-4);
    float detH = 1.0 - smoothstep(0.35, 0.9, fwH);
    float lab = smoothstep(0.47, 0.52, alat);
    float lq = fract(sTip / (uR * 0.38));
    float lh = smoothstep(0.0, 0.14, lq) * smoothstep(1.0, 0.86, lq);
    float plateH = mix(h0, lh, lab);
    vec2 gL = vec2(0.0, (lq < 0.5 ? 1.0 : -1.0) * 0.5 * (1.0 - lh));
    vec2 hg = mix(gH, gL, lab) * detH;
    float pe = (1.0 - plateH) * detH;
    grad = mix(grad, hg, hm);
    border = mix(border, pe * 0.55, hm);
    ao = mix(ao, 1.0 - pe * 0.3, hm);
    det = mix(det, detH, hm);
    if (hm > 0.5) {
      cid = mix(floor(hp), vec2(floor(sTip / (uR * 0.38)), 99.0), lab);
      qy = 0.3;
    }
  }

  // ventral scutes (belly side)
  float bd = min(u, 1.0 - u);
  float bm = 1.0 - smoothstep(0.125, 0.16, bd);
  float pv = vSUv.y * 0.62;
  float qv = fract(pv);
  float fwV = max(fwidth(pv), 1e-4);
  float detV = 1.0 - smoothstep(0.25, 0.7, fwV);
  float scuteEdge = smoothstep(0.86, 0.99, qv);
  border = mix(border, scuteEdge, bm);
  det = mix(det, detV, bm);
  float h1 = sh12(cid + 7.31);
  float h2 = sh12(cid * 1.73 + 2.1);
  sGrad = mix(grad, vec2(0.0, (qv < 0.9 ? 1.2 : -8.0) * 0.62) * detV, bm);
  sAO = mix(ao, mix(1.0, 0.7 + 0.3 * smoothstep(0.0, 0.3, qv), detV), bm);

  vec3 col = uCBase;
  float rough = uRough;
  float metal = 0.0;
  vec3 emit = vec3(0.0);
  float cc = uCC;
  float irid = 1.0;
  float bellyT = smoothstep(0.62, 0.9, alat);
  float bk = 0.38;          // scale-border darkening
  float labM = hm * smoothstep(0.46, 0.52, alat); // head labial (lip) row
  float fr = clamp(sTip / max(uLen, 0.05), 0.0, 1.0); // 0 snout .. 1 tail tip
  sAlpha = 1.0; sThick = 1.0; sFilm = 0.0; sFacet = vec2(h1, h2);

  if (uSkin == 0) { // obsidian gold thread
    col = uCBase * (0.8 + 0.4 * h1 * det + 0.1);
    col = mix(col, uCBelly, bellyT);
    float c = 0.10 * sin(s * 1.55 + 0.4) + 0.05 * sin(s * 3.7 + 1.3) + 0.018 * sin(s * 9.1);
    float tfade = smoothstep(headLen * 1.0, headLen * 1.9, sTip);
    float hw = 0.036 * (0.85 + 0.15 * sin(s * 5.3)) * (0.3 + 0.7 * tfade) * (1.0 - smoothstep(0.55, 1.0, tailT) * 0.75);
    float d = abs(lat - c);
    float aa = fwidth(lat) * 0.9 + 1e-4;
    float g = (1.0 - smoothstep(hw - aa, hw + aa, d)) * smoothstep(0.0, 0.25, tfade);
    float halo = (1.0 - smoothstep(hw, hw * 3.2 + aa, d)) * 0.35 * tfade;
    col = mix(col, mix(col, uCAlt * 1.6, 1.0), halo * (1.0 - g));
    vec3 gold = uCPat * (0.85 + 0.3 * h2 * det);
    col = mix(col, gold, g);
    metal = mix(0.0, 0.95, g);
    rough = mix(rough, 0.3, g);
    // small gold diamond on the crown of the head
    float dia = abs(lat) * 13.0 + abs(sTip - headLen * 0.64) / (uR * 0.2);
    float crown = 1.0 - smoothstep(0.95 - fwidth(dia), 1.0 + fwidth(dia), dia);
    col = mix(col, gold, crown);
    metal = max(metal, crown * 0.95);
    rough = mix(rough, 0.3, crown);
  } else if (uSkin == 1) { // emerald tree python
    col = mix(uCBase, uCAlt, (1.0 - smoothstep(0.0, 0.5, alat)) * 0.35);
    col *= 0.9 + 0.2 * h1 * det;
    float seg = smoothstep(0.1, 0.5, sin(s * 1.7 + 1.0) + 0.35 * sin(s * 4.3));
    float line = (1.0 - aaStep(0.075, alat)) * step(h2, 0.8) * seg;
    float fpatch = (1.0 - aaStep(0.3, alat)) * step(h1, 0.05) * step(0.3, sin(s * 0.9 + 2.0));
    float fl = max(line, fpatch) * smoothstep(0.9, 1.3, sTip);
    col = mix(col, uCPat, fl * mix(0.45, 0.95, det));
    col = mix(col, uCBelly, bellyT);
    col = mix(col, mix(uCBelly, uCPat, 0.5), hm * smoothstep(0.5, 0.58, alat) * 0.8);
  } else if (uSkin == 2) { // coral: red / yellow / black bands
    float t = fract((s - uR * 2.2) / 1.3);
    float fy = aaBand(0.5, 0.58, t) + aaStep(0.92, t);
    float fb = aaBand(0.58, 0.92, t);
    col = uCBase;
    // black-tipped red scales
    float tip = step(h1, 0.55) * smoothstep(0.0, 0.5, qy) * det;
    col = mix(col, uCPat * 1.5, tip * 0.75);
    col = mix(col, uCAlt, fy);
    col = mix(col, uCPat, fb);
    // head: black snout, yellow collar, black neck
    float hy = aaBand(headLen * 0.52, headLen * 0.9, sTip);
    float hb = 1.0 - aaStep(headLen * 0.52, sTip);
    float nb = aaBand(headLen * 0.9, uR * 2.2 + 0.0 + 0.001, sTip);
    col = mix(col, uCPat, hb);
    col = mix(col, uCAlt, hy);
    col = mix(col, uCPat, nb);
    col = mix(col, col * 1.15 + 0.03, bellyT * 0.5);
  } else if (uSkin == 3) { // sea krait
    col = mix(uCBase, uCAlt, (1.0 - smoothstep(0.0, 0.5, alat)) * 0.3);
    col *= 0.9 + 0.2 * h1 * det;
    col = mix(col, uCBelly, bellyT);
    float t = fract((s - uR * 1.6) / 0.82);
    float rw = 0.42 - 0.2 * smoothstep(0.3, 0.95, alat);
    float ring = aaBand(0.0, rw, t) * (1.0 - smoothstep(0.85, 0.98, alat));
    ring *= step(headLen * 0.9, sTip);
    col = mix(col, uCPat, ring);
    // head: dark crown, pale upper lip and snout bar
    float crown = hm * (1.0 - aaStep(0.44, alat));
    float bar = hm * aaBand(headLen * 0.12, headLen * 0.28, sTip);
    col = mix(col, uCPat, crown * (1.0 - bar));
    col = mix(col, uCPat, (1.0 - hm) * (1.0 - aaStep(headLen * 1.35, sTip)) * (1.0 - aaStep(0.5, alat)));
    col = mix(col, uCPat, smoothstep(0.82, 0.95, tailT));
  } else if (uSkin == 4) { // horned viper: sand with dappled saddles
    float n = sfbm(vec2(lat * 3.0, s * 2.5));
    col = uCBase * (0.85 + 0.3 * n) * (0.92 + 0.16 * h1 * det);
    float t = (s - uR * 1.4) / 0.62;
    float fy = fract(t) - 0.5;
    float d = length(vec2(lat / 0.36, fy / 0.24)) + (sfbm(vec2(lat * 6.0, s * 6.0)) - 0.5) * 0.8;
    float sad = 1.0 - smoothstep(0.75, 0.95, d);
    float d2 = length(vec2((alat - 0.58) / 0.12, (fract(t + 0.5) - 0.5) / 0.16)) + (n - 0.5) * 0.8;
    float spot = 1.0 - smoothstep(0.7, 1.0, d2);
    float sp = step(h2, 0.1) * det;
    col = mix(col, uCAlt * 0.95, sad * 0.8);
    col = mix(col, uCPat * 0.85, sad * smoothstep(0.45, 0.9, d) * 0.9);
    col = mix(col, uCPat, max(spot * 0.7, sp * 0.6));
    col = mix(col, uCBase * 1.12, (1.0 - sad) * (1.0 - smoothstep(0.9, 1.25, d)) * 0.5);
    col = mix(col, uCBelly, bellyT);
    float st = hm * aaBand(headLen * 0.42, headLen * 1.02, sTip) * aaBand(0.3, 0.46, alat - (sTip - headLen * 0.4) * 0.3);
    col = mix(col, uCPat, st * 0.8);
  } else if (uSkin == 5) { // albino corn snake
    col = uCBase * (0.95 + 0.08 * h1 * det);
    float n = sfbm(vec2(lat * 5.0, s * 4.0));
    float t = (s - uR * 1.3) / 0.8;
    float fy = fract(t) - 0.5;
    // squarish saddles with ragged edges
    vec2 q2 = vec2(lat / 0.34, fy / 0.26);
    float d = pow(pow(abs(q2.x), 3.0) + pow(abs(q2.y), 3.0), 1.0 / 3.0) + (n - 0.5) * 0.5;
    float sad = 1.0 - smoothstep(0.86, 0.94, d);
    float rimB = (1.0 - smoothstep(0.94, 1.12, d)) * (1.0 - sad);
    vec2 q3 = vec2((alat - 0.63) / 0.12, (fract(t + 0.5) - 0.5) / 0.15);
    float d2 = pow(pow(abs(q3.x), 3.0) + pow(abs(q3.y), 3.0), 1.0 / 3.0) + (n - 0.5) * 0.6;
    float spot = 1.0 - smoothstep(0.85, 1.0, d2);
    vec3 sadCol = mix(uCPat * 1.05, uCAlt, smoothstep(0.55, 0.88, d));
    col = mix(col, vec3(1.0, 0.97, 0.93), rimB * 0.7);
    col = mix(col, sadCol, max(sad, spot * 0.75));
    col = mix(col, uCBelly, bellyT);
    float chk = step(0.5, fract(floor(pv) * 0.5 + step(0.5, u) * 0.5)) * bm;
    col = mix(col, uCPat, chk * 0.16);
    float hb = hm * aaBand(headLen * 0.34, headLen * 0.58, sTip) * (1.0 - aaStep(0.55, alat));
    col = mix(col, uCPat, hb * 0.55);
  } else if (uSkin == 6) { // rainbow boa
    col = uCBase * (0.88 + 0.24 * h1 * det);
    float n = sfbm(vec2(lat * 4.0, s * 3.5));
    float t = (s - uR * 1.6) / 0.95;
    float fy = fract(t) - 0.5;
    float d = length(vec2(lat / 0.29, fy / 0.3)) + (n - 0.5) * 0.3;
    float ring = aaBand(0.66, 0.84, d);
    float cen = 1.0 - aaStep(0.66, d);
    float d2 = length(vec2((alat - 0.6) / 0.11, (fract(t + 0.5) - 0.5) / 0.15)) + (n - 0.5) * 0.4;
    float spot = 1.0 - aaStep(1.0, d2);
    float cres = (1.0 - aaStep(0.55, d2)) * aaStep(0.0, 0.62 - alat);
    col = mix(col, uCAlt * 1.05, cen * 0.55);
    col = mix(col, uCPat, max(ring * 0.92, spot * 0.85));
    col = mix(col, uCAlt * 1.2, cres * 0.7);
    col = mix(col, uCBelly, bellyT);
    float hs1 = hm * (aaBand(-0.03, 0.03, lat) + aaBand(0.2, 0.25, alat)) * step(headLen * 0.2, sTip);
    col = mix(col, uCPat, clamp(hs1, 0.0, 1.0) * 0.8);
    irid = 1.0 - 0.5 * max(ring, spot);
  } else if (uSkin == 7) { // ember serpent
    col = uCBase * (0.85 + 0.3 * h1 * det);
    col = mix(col, uCBelly, bellyT * 0.7);
    vec2 cp = vec2(lat * 1.5, s * 1.25);
    float e1 = svoro(cp);
    float e2 = svoro(cp * 2.6 + 11.0);
    float v1 = 1.0 - smoothstep(0.012, 0.03 + fwidth(e1) * 1.5, e1);
    float v2 = (1.0 - smoothstep(0.008, 0.02 + fwidth(e2) * 1.5, e2)) * smoothstep(0.45, 0.7, svn(cp * 1.3 + 3.0));
    float vein = max(v1, v2 * 0.8);
    float pulse = 0.7 + 0.3 * sin(s * 2.2 - uTime * 2.6) * sin(uTime * 1.3 + s * 0.4);
    float heat = vein * pulse;
    float glowNear = (1.0 - smoothstep(0.0, 0.12, e1)) * (1.0 - v1);
    col = mix(col, uCPat * 0.35, vein);
    col = mix(col, col + uCPat * 0.05, glowNear);
    emit = (uCPat * heat + uCAlt * heat * heat * 0.5) * uEmitK * 1.8 + uCPat * glowNear * uEmitK * 0.12 * pulse;
    emit += uCPat * border * det * 0.05 * uEmitK * pulse * (1.0 - bm);
    rough = mix(rough, 0.4, vein);
    cc = cc * (1.0 - vein);
  } else if (uSkin == 8) { // gaboon viper: geometric hourglasses, rectangles and flank triangles
    float n = sfbm(vec2(lat * 4.0, s * 3.0));
    col = uCBase * (0.84 + 0.3 * n) * (0.93 + 0.14 * h1 * det);
    float t = (s - headLen * 1.3) / 0.64;
    float fy = fract(t) - 0.5;          // 0 = centre of a pale dorsal rectangle
    float fy2 = fract(t + 0.5) - 0.5;   // 0 = waist of a dark hourglass
    float wob = (n - 0.5) * 0.07;
    // dark hourglass: narrow waist on the spine, bulbs spreading down both flanks
    float dH = max(abs(fy2) - (0.07 + 0.5 * alat), alat - 0.56) + wob;
    // pale buff rectangle on the spine between hourglasses
    float dR = max(alat - 0.13, abs(fy) - 0.3) + wob * 0.6;
    // dark flank triangles pointing up, under each rectangle
    float tri = (alat - 0.6) / 0.26;
    float dT = max(abs(fy) - 0.42 * tri, max(-tri * 0.25, alat - 0.9)) + wob;
    float inH = aaStep(0.0, -dH), inR = aaStep(0.0, -dR), inT = aaStep(0.0, -dT);
    float pale = max(max(aaBand(0.0, 0.035, dH), aaBand(0.0, 0.03, dT)), aaBand(0.0, 0.026, dR));
    vec3 dark = uCPat * (0.85 + 0.3 * h2 * det);
    col = mix(col, mix(dark, dark * vec3(1.55, 1.3, 1.45), aaStep(0.0, -(dH + 0.14)) * 0.5), inH);
    vec3 buff = uCAlt * (0.92 + 0.14 * n);
    float dots = 1.0 - aaStep(1.0, length(vec2(lat / 0.045, (abs(fy) - 0.14) / 0.065)));
    col = mix(col, mix(buff, dark, dots * 0.9), inR);
    col = mix(col, mix(dark, uCBase * 0.78, aaStep(0.0, -(dT + 0.07)) * 0.75), inT);
    col = mix(col, uCExtra * (0.95 + 0.08 * h1), pale * 0.85);
    col = mix(col, uCBelly * (0.9 + 0.15 * n), bellyT);
    col = mix(col, uCPat * 1.4, bm * step(h2, 0.1) * 0.5 * det);
    // head: pale buff with a thin dark centre line and a dark triangle behind each eye
    float hmk = 1.0 - aaStep(headLen * 0.97, sTip);
    vec3 headC = mix(uCAlt, uCExtra, 0.55) * (0.94 + 0.1 * h1 * det);
    col = mix(col, headC, hmk);
    float midL = (1.0 - aaStep(0.018 + 0.012 * sTip / headLen, alat)) * aaStep(headLen * 0.12, sTip);
    float eyeS = uR * 1.45;
    float triE = aaStep(0.0, (alat - 0.3) - max(0.0, 0.2 - (sTip - eyeS) / uR * 0.18)) * aaStep(eyeS, sTip) * (1.0 - aaStep(0.62, alat));
    col = mix(col, uCPat * 1.1, max(midL, triE) * hmk * 0.92);
    bk = 0.26;
  } else if (uSkin == 9) { // blue malaysian coral snake
    col = uCBase * (0.88 + 0.24 * h1 * det);
    col = mix(col, uCBelly, bellyT);
    float hr = 1.0 - smoothstep(headLen * 1.05, headLen * 1.9, sTip);
    float tr = smoothstep(0.8, 0.9, fr);
    float red = max(hr, tr);
    vec3 redC = mix(uCAlt, uCExtra, max(smoothstep(0.88, 1.0, fr), (1.0 - smoothstep(0.0, headLen, sTip)) * 0.45));
    redC *= 0.92 + 0.14 * h2 * det;
    float sw = 0.05 + 0.01 * sin(s * 0.7);
    float sd = abs(alat - 0.41) - sw;
    float stripe = 1.0 - aaStep(0.0, sd);
    float halo = 1.0 - smoothstep(0.0, 0.1, sd);
    vec3 blue = uCPat * (0.9 + 0.2 * h2 * det);
    float sk = stripe * (1.0 - red);
    col = mix(col, blue, sk);
    col = mix(col, redC, red);
    emit = blue * (sk * 0.5 + halo * (1.0 - stripe) * (1.0 - red) * 0.06) * uEmitK + redC * red * uEmitK * 0.2;
    bk = 0.34;
  } else if (uSkin == 10) { // paradise flying snake
    float edge = smoothstep(0.4, 0.8, sc.e) * (sc.q.y > -0.35 ? 1.0 : 0.55);
    float ek = mix(0.42, edge, det);
    float bn = sfbm(vec2(lat * 3.0, s * 2.0));
    float band = smoothstep(0.45, 0.85, 0.5 + 0.5 * sin(s * 3.4 + 0.6) + (bn - 0.5) * 0.7);
    float gk = ek * mix(1.0, 0.3, band * (1.0 - smoothstep(0.3, 0.65, alat)));
    vec3 lime = uCPat * (0.8 + 0.35 * h1 * det) * mix(0.85, 1.12, smoothstep(0.2, 0.6, alat));
    col = mix(uCBase * (0.9 + 0.2 * h2 * det), lime, gk);
    // orange-red four-petal stars down the spine
    float st = (s - headLen * 1.4) / 0.42;
    float si = floor(st);
    float sfy = fract(st) - 0.5;
    float shs = sh12(vec2(si, 3.7));
    vec2 sq2 = vec2(lat / 0.085, sfy / 0.27);
    float sr = length(sq2);
    float sa = atan(sq2.y, sq2.x);
    float petal = 0.6 + 0.4 * pow(abs(cos(2.0 * sa)), 2.0);
    float star = (1.0 - aaStep(petal * (0.8 + 0.25 * shs), sr)) * step(0.1, shs)
      * smoothstep(headLen * 1.15, headLen * 1.5, sTip) * (1.0 - smoothstep(0.86, 0.97, fr));
    float cen = 1.0 - aaStep(0.3, sr);
    vec3 starC = mix(uCAlt, uCExtra, cen * 0.8) * (0.9 + 0.2 * h1 * det);
    col = mix(col, starC, star);
    col = mix(col, uCBelly * (0.9 + 0.15 * h1), bellyT);
    // head: black crown with yellow-green crossbars, pale lips
    col = mix(col, uCBase * (0.95 + 0.1 * h1), hm * 0.85);
    float hb = aaBand(headLen * 0.26, headLen * 0.34, sTip) + aaBand(headLen * 0.52, headLen * 0.61, sTip) + aaBand(headLen * 0.8, headLen * 0.88, sTip);
    col = mix(col, mix(uCPat, uCExtra, 0.35), clamp(hb, 0.0, 1.0) * hm * (1.0 - aaStep(0.5, alat)));
    col = mix(col, uCBelly, labM * 0.9);
    bk = 0.45;
  } else if (uSkin == 11) { // sunbeam snake
    float n = sfbm(vec2(lat * 2.0, s * 1.2));
    col = uCBase * (0.8 + 0.4 * h1 * det);
    col = mix(col, uCAlt, (1.0 - smoothstep(0.0, 0.45, alat)) * 0.4 * n);
    float bw = smoothstep(0.72, 0.84, alat);
    col = mix(col, uCBelly * (0.92 + 0.1 * h2), bw);
    sFilm = h1 * 0.55 + h2 * 0.2 + s * 0.11 + n * 0.9;
    irid = 1.0 - bw * 0.7;
    bk = 0.5;
  } else if (uSkin == 12) { // eyelash viper, golden morph
    float n = sfbm(vec2(lat * 3.0, s * 2.2));
    float n2 = sfbm(vec2(lat * 6.0 + 4.0, s * 5.0));
    col = uCBase * (0.9 + 0.2 * h1 * det);
    col = mix(col, col * vec3(1.04, 0.84, 0.52), smoothstep(0.5, 0.8, n) * 0.38);
    float fk = 0.04 + 0.16 * smoothstep(0.45, 0.8, n2);
    float frk = step(h2, fk) * (1.0 - smoothstep(0.32, 0.58, sc.e));
    vec3 fc = mix(uCPat, uCExtra, step(h1, 0.35));
    col = mix(col, fc, frk * det * 0.95);
    col *= 1.0 - (1.0 - det) * fk * 0.8;
    col = mix(col, uCBelly * (0.95 + 0.08 * h1), bellyT);
    bk = 0.22;
  } else if (uSkin == 13) { // mangrove cat snake
    col = uCBase * (0.85 + 0.35 * h1 * det);
    col = mix(col, uCBelly, bellyT);
    float P = 0.5;
    float t = (s - headLen * 1.35) / P + (h1 - 0.5) * 0.06 * det;
    float ri = floor(t + 0.5);
    float d = abs(t - ri) * P;
    float wr = 0.022 + 0.024 * smoothstep(0.08, 0.6, alat);
    float brk = step(sh12(vec2(ri, 9.1)), 0.3) * (1.0 - smoothstep(0.03, 0.09, alat));
    float ring = (1.0 - aaStep(wr, d)) * (1.0 - brk) * step(headLen * 1.12, sTip) * (1.0 - smoothstep(0.8, 0.95, alat));
    col = mix(col, uCPat * (0.9 + 0.2 * h2 * det), ring);
    // head: black crown, yellow lips (labials keep dark sutures) and chin / throat
    float chin = hm * smoothstep(0.6, 0.78, alat);
    float throat = (1.0 - smoothstep(headLen, headLen * 1.5, sTip)) * smoothstep(0.62, 0.85, alat);
    col = mix(col, uCAlt * (0.92 + 0.12 * h1), clamp(max(max(labM, chin), throat), 0.0, 1.0));
    bk = 0.3;
  } else if (uSkin == 14) { // nebula: a window into drifting space
    vec3 nW = normalize(vWN);
    vec2 wp = vWP.xy;
    vec2 drift = vec2(uTime * 0.03, uTime * 0.018);
    vec2 p1 = wp * 0.5 - nW.xy * 0.45 + drift;
    float w1 = sfbm(p1 * 1.4 + 3.1);
    float c1 = sfbm(p1 + vec2(w1 * 1.7, -w1 * 1.3) + uTime * 0.01);
    vec2 p2 = wp * 1.05 - nW.xy * 0.22 - drift * 1.5;
    float c2 = sfbm(p2 + vec2(7.7, 1.3) + w1 * 0.6);
    vec3 neb = uCBase;
    neb = mix(neb, uCPat * 0.8, smoothstep(0.38, 0.78, c1));
    neb = mix(neb, uCAlt * 0.9, smoothstep(0.55, 0.85, c2) * smoothstep(0.35, 0.7, c1));
    neb = mix(neb, uCExtra * 0.85, smoothstep(0.6, 0.85, c2 * (1.2 - c1)) * 0.6);
    neb *= 0.45 + 0.55 * smoothstep(0.3, 0.62, sfbm(p2 * 1.8 + 11.0));
    float st1 = starField((wp - nW.xy * 0.3) * 9.0 + 100.0, 0.5, 0.09, uTime * 1.3);
    float st2 = starField((wp - nW.xy * 0.12) * 3.3 + 31.0, 0.3, 0.07, uTime);
    float stars = st1 * 0.9 + st2 * 2.4;
    col = neb * 0.35 + vec3(0.01, 0.008, 0.025);
    col = mix(col, uCBelly, bellyT * 0.6);
    emit = (neb * 0.55 + vec3(0.92, 0.9, 1.0) * stars) * uEmitK * (1.0 - bellyT * 0.6);
    emit += uCPat * border * det * 0.07 * uEmitK;
    bk = 0.45;
  } else { // crystal glass
    col = mix(uCBase, uCPat, 0.35 * h1 * det + 0.15 * bellyT);
    col = mix(col, uCBelly, bellyT * 0.5);
    // flat facets: every scale is a flat, randomly tilted facet
    vec2 tilt = (vec2(h1, h2) - 0.5) * 2.4;
    sGrad = mix(sGrad * 0.35, tilt + sGrad * 0.2, det * (1.0 - bm * 0.6));
    sThick = clamp(W, 0.25, 1.3) * (0.75 + 0.5 * h2);
    sFilm = h1 * 0.6 + s * 0.05;
    vec3 Vw = isOrthographic ? normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])) : normalize(cameraPosition - vWP);
    float ndv0 = clamp(dot(normalize(vWN), Vw), 0.0, 1.0);
    sAlpha = mix(1.0, mix(0.26, 0.92, pow(1.0 - ndv0, 2.0)), uGlassA);
    rough = uRough + border * det * 0.2;
    cc = 1.0;
    irid = 0.6 + 0.4 * h1;
    bk = 0.12;
  }

  // belly scutes slightly lighter/glossier with darker seams
  col = mix(col, col * 1.08, bm * 0.5);

  // borders between scales: darker, rougher
  float bdk = border * det;
  if (uSkin < 8) bk = uSkin == 0 ? 0.55 : (uSkin == 5 || uSkin == 3 || uSkin == 1) ? 0.26 : 0.38;
  col *= 1.0 - bdk * bk;
  rough = clamp(rough + bdk * 0.25 + (h2 - 0.5) * 0.14 * det, 0.08, 1.0);
  cc *= mix(1.0, 0.25, bdk) * (0.75 + 0.5 * h1 * det) ;

  // head details: nostrils + mouth line + eye socket shading
  float nos = hm * (1.0 - smoothstep(0.010, 0.016, length(vec2((alat - 0.16) * uR * 1.1, sTip - uR * 0.26))));
  col *= 1.0 - nos * 0.85;
  float mouth = hm * aaBand(-0.012, 0.012, alat - (0.53 - 0.04 * sTip / headLen)) * step(0.04, sTip);
  col *= 1.0 - mouth * 0.7;
  sAO *= 1.0 - nos * 0.5;

  // death desaturation
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l) * 0.85, uDead * 0.7);
  emit *= 1.0 - uDead * 0.8;

  // ghost: pale spectral
  col = mix(col, vec3(0.45, 0.65, 0.9) * (0.45 + 0.55 * l), uGhost * 0.55);

  sAlb = col * mix(1.0, sAO, 0.8);
  sRough = rough;
  sMetal = metal;
  sEmit = emit;
  sCCk = cc;
  sIridk = irid;
  sDet = det;
}
`;

export interface SnakeUniforms {
  [k: string]: THREE.IUniform;
}

// Optional twin-sun light (kepler): used by the custom lighting terms when the world provides it.
const L2 = LIGHT as unknown as { sun2Dir?: THREE.IUniform<THREE.Vector3>; sun2Color?: THREE.IUniform<THREE.Color> };

export function createSnakeMaterial() {
  const u: SnakeUniforms = {
    uSkin: { value: 0 },
    uCBase: { value: new THREE.Color() },
    uCPat: { value: new THREE.Color() },
    uCBelly: { value: new THREE.Color() },
    uCAlt: { value: new THREE.Color() },
    uCRim: { value: new THREE.Color() },
    uCExtra: { value: new THREE.Color() },
    uRimK: { value: 0.4 },
    uKeel: { value: 0 },
    uEmitK: { value: 0 },
    uIrid: { value: 0 },
    uIridX: { value: 0 },
    uRough: { value: 0.4 },
    uCC: { value: 0.8 },
    uTime: { value: 0 },
    uDead: { value: 0 },
    uGhost: { value: 0 },
    uR: { value: 0.34 },
    uLen: { value: 10 },
    uGlassA: { value: 0 },
    uSunDir: LIGHT.sunDir,
    uSunCol: LIGHT.sunColor,
    uSun2Dir: L2.sun2Dir ?? { value: new THREE.Vector3(0, 0, 0) },
    uSun2Col: L2.sun2Color ?? { value: new THREE.Color(0, 0, 0) },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.22,
    ior: 1.52,
    specularIntensity: 0.75,
    sheen: 0.25,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0.9, 0.9, 0.9),
    iridescence: 0,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [220, 620],
    // glass (crystal) settings; only active while transmission > 0
    thickness: 0.55,
    attenuationDistance: 1.6,
    attenuationColor: new THREE.Color('#a8dcff'),
  });
  const transmissionChunk = THREE.ShaderChunk.transmission_fragment
    .replace('material.transmission = transmission;', 'material.transmission = transmission * (1.0 - uDead * 0.55);')
    .replace('material.thickness = thickness;', 'material.thickness = thickness * sThick;');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aTan; attribute vec4 aInfo; attribute vec2 aSUv;
varying vec3 vTanV; varying vec4 vInfo; varying vec2 vSUv; varying vec3 vWP; varying vec3 vWN;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vTanV = normalize((modelViewMatrix * vec4(aTan, 0.0, 0.0)).xyz);
vInfo = aInfo; vSUv = aSUv;
vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + GLSL_SURF)
      .replace('#include <map_fragment>', 'snakeSurface();\ndiffuseColor.rgb = sAlb;\ndiffuseColor.a *= sAlpha;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sMetal;')
      .replace('#include <normal_fragment_maps>', `
{
  vec3 T = normalize(vTanV - normal * dot(vTanV, normal));
  vec3 Bv = normalize(cross(T, normal));
  normal = normalize(normal - 0.26 * (sGrad.x * Bv + sGrad.y * T));
}`)
      .replace('#include <emissivemap_fragment>', `
{
  vec3 Vd = normalize(vViewPosition);
  float ndv = clamp(dot(normal, Vd), 0.0, 1.0);
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float rim = pow(1.0 - ndv, 3.0);
  float thin = 1.0 - smoothstep(0.15, 0.8, vInfo.z);
  float back = 0.35 + 0.65 * clamp(0.5 - 0.5 * dot(normal, sunV), 0.0, 1.0);
  totalEmissiveRadiance = sEmit + uCRim * uSunCol * (rim * back * 0.16 + thin * 0.05) * uRimK * (1.0 - uGhost * 0.5);
  totalEmissiveRadiance += vec3(0.35, 0.75, 1.0) * uGhost * (0.08 + 1.6 * rim);
  if (uIridX > 0.0 || uSkin == 15) {
    // custom view-correct terms (orthographic camera looks straight down the view axis)
    vec3 V2 = isOrthographic ? vec3(0.0, 0.0, 1.0) : Vd;
    float ndv2 = clamp(dot(normal, V2), 0.0, 1.0);
    float has2 = step(1e-6, dot(uSun2Dir, uSun2Dir));
    vec3 sun2V = has2 > 0.5 ? normalize((viewMatrix * vec4(uSun2Dir, 0.0)).xyz) : sunV;
    vec3 H1 = normalize(sunV + V2), H2 = normalize(sun2V + V2);
    float nh1 = max(dot(normal, H1), 0.0), nh2 = max(dot(normal, H2), 0.0);
    float nl1 = clamp(dot(normal, sunV) * 2.0, 0.0, 1.0), nl2 = clamp(dot(normal, sun2V) * 2.0, 0.0, 1.0) * has2;
    float dk = (1.0 - uDead * 0.75) * (1.0 - uGhost * 0.6);
    if (uIridX > 0.0) {
      // oil-slick thin film: interference colour from film thickness (per-scale) and view angle
      float th = sFilm + (1.0 - ndv2) * 1.6;
      vec3 film = 0.5 + 0.5 * cos(6.2831 * (th + vec3(0.0, 0.33, 0.67)));
      film *= film;
      vec3 lit = uSunCol * (pow(nh1, 6.0) * 0.8 + pow(nh1, 60.0) * 2.5) * nl1
               + uSun2Col * (pow(nh2, 6.0) * 0.8 + pow(nh2, 60.0) * 2.5) * nl2;
      float sky = pow(1.0 - ndv2, 1.5) * 0.35 + 0.08;
      totalEmissiveRadiance += film * (lit * 0.55 + sky * 0.25) * uIridX * dk;
    }
    if (uSkin == 15) {
      // crystal: fresnel rim, facet glints, internal sparkle and drifting caustics
      float fres = pow(1.0 - ndv2, 2.4);
      float tw = 0.55 + 0.45 * sin(uTime * 2.7 + sFacet.x * 40.0);
      float glint = (pow(nh1, 260.0) * 3.2 * tw + pow(nh1, 40.0) * 0.12) * sDet;
      float glint2 = pow(nh2, 260.0) * 3.2 * tw * sDet * has2;
      float sp = starField(vec2(vSUv.x * 44.0, vSUv.y * 1.6), 0.16, 0.09, uTime * 2.2);
      vec2 cp = vWP.xy * 3.2;
      float ca = pow(ridged(cp + vec2(uTime * 0.35, uTime * 0.2)) * ridged(cp * 1.37 - vec2(uTime * 0.27, -uTime * 0.31) + 5.0), 7.0);
      totalEmissiveRadiance += (uCRim * uSunCol * fres * 0.5
        + uSunCol * glint + uSun2Col * glint2
        + vec3(0.9, 0.97, 1.0) * sp * 1.1 * sDet
        + uCExtra * uSunCol * ca * 0.3 * (1.0 - fres)) * dk;
    }
  }
}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= clamp(sCCk, 0.0, 1.0);
#endif
#ifdef USE_IRIDESCENCE
  material.iridescence *= sIridk;
#endif`)
      .replace('#include <transmission_fragment>', transmissionChunk);
  };
  mat.customProgramCacheKey = () => 'serpent-skin-v2';
  return { mat, u };
}

export type GlassMode = 'none' | 'transmission' | 'blend';

export function applySkin(mat: THREE.MeshPhysicalMaterial, u: SnakeUniforms, id: SkinId): SkinLook {
  const L = SKIN_LOOKS[id as SnakeSkinId] ?? SKIN_LOOKS.obsidian;
  u.uSkin.value = L.index;
  (u.uCBase.value as THREE.Color).setStyle(L.base);
  (u.uCPat.value as THREE.Color).setStyle(L.pattern);
  (u.uCBelly.value as THREE.Color).setStyle(L.belly);
  (u.uCAlt.value as THREE.Color).setStyle(L.alt);
  (u.uCRim.value as THREE.Color).setStyle(L.rim);
  (u.uCExtra.value as THREE.Color).setStyle(L.extra ?? L.alt);
  u.uRimK.value = L.rimStrength;
  u.uKeel.value = L.keel;
  u.uEmitK.value = L.emissive;
  u.uRough.value = L.roughness;
  u.uCC.value = L.clearcoat;
  u.uIridX.value = L.iridX ?? 0;
  mat.iridescence = L.iridescence;
  const ir = L.iridRange ?? [220, 620];
  mat.iridescenceThicknessRange[0] = ir[0]; mat.iridescenceThicknessRange[1] = ir[1];
  mat.sheen = L.sheen;
  return L;
}

/**
 * Glass body mode for the crystal skin. 'transmission' = real refraction (MeshPhysicalMaterial
 * transmission, one extra opaque pass by three.js), 'blend' = cheap alpha-blended glass (low quality),
 * 'none' = opaque skin. Returns true when the material must be alpha blended.
 */
export function setGlass(mat: THREE.MeshPhysicalMaterial, u: SnakeUniforms, mode: GlassMode, dispersion = 0): boolean {
  mat.transmission = mode === 'transmission' ? 0.96 : 0;
  mat.dispersion = mode === 'transmission' ? dispersion : 0;
  mat.ior = mode === 'none' ? 1.52 : 1.5;
  u.uGlassA.value = mode === 'blend' ? 1 : 0;
  return mode === 'blend';
}
