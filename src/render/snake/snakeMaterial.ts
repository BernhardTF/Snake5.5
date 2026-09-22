// Snake skin: MeshPhysicalMaterial extended with procedural scales + per-skin patterns.
// Lighting comes from the scene's real lights / environment, so it matches the sand.
// All skins live in one program (uniform branch), so setSkin never recompiles
// (except toggling iridescence, which three caches as a second program).
import * as THREE from 'three';
import { LIGHT } from '../lighting';
import { SKIN_LOOKS, type SkinLook } from './skinLooks';
import type { SkinId } from '../../types';

export const SNAKE_ROWS = 22; // dorsal scale rows around the body (even)
export const SCALE_LEN = 0.072; // world length of one scale row step at full radius

const GLSL_COMMON = /* glsl */ `
uniform int uSkin;
uniform vec3 uCBase, uCPat, uCBelly, uCAlt, uCRim;
uniform float uRimK, uKeel, uEmitK, uIrid, uRough, uCC;
uniform float uTime, uDead, uGhost, uR;
uniform vec3 uSunDir, uSunCol;
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
      cid = mix(floor(hp * vec2(1.0, 1.0)) + vec2(e0 > 0.5 ? 0.0 : 0.0), vec2(floor(sTip / (uR * 0.38)), 99.0), lab);
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
  } else { // ember serpent
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
  }

  // belly scutes slightly lighter/glossier with darker seams
  col = mix(col, col * 1.08, bm * 0.5);

  // borders between scales: darker, rougher
  float bdk = border * det;
  col *= 1.0 - bdk * (uSkin == 0 ? 0.55 : (uSkin == 5 || uSkin == 3 || uSkin == 1) ? 0.26 : 0.38);
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
  col = mix(col, vec3(0.55, 0.72, 0.9) * (0.5 + 0.5 * l), uGhost * 0.75);

  sAlb = col * mix(1.0, sAO, 0.8);
  sRough = rough;
  sMetal = metal;
  sEmit = emit;
  sCCk = cc;
  sIridk = irid;
}
`;

export interface SnakeUniforms {
  [k: string]: THREE.IUniform;
}

export function createSnakeMaterial() {
  const u: SnakeUniforms = {
    uSkin: { value: 0 },
    uCBase: { value: new THREE.Color() },
    uCPat: { value: new THREE.Color() },
    uCBelly: { value: new THREE.Color() },
    uCAlt: { value: new THREE.Color() },
    uCRim: { value: new THREE.Color() },
    uRimK: { value: 0.4 },
    uKeel: { value: 0 },
    uEmitK: { value: 0 },
    uIrid: { value: 0 },
    uRough: { value: 0.4 },
    uCC: { value: 0.8 },
    uTime: { value: 0 },
    uDead: { value: 0 },
    uGhost: { value: 0 },
    uR: { value: 0.34 },
    uSunDir: LIGHT.sunDir,
    uSunCol: LIGHT.sunColor,
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
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aTan; attribute vec4 aInfo; attribute vec2 aSUv;
varying vec3 vTanV; varying vec4 vInfo; varying vec2 vSUv;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vTanV = normalize((modelViewMatrix * vec4(aTan, 0.0, 0.0)).xyz);
vInfo = aInfo; vSUv = aSUv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + GLSL_SURF)
      .replace('#include <map_fragment>', 'snakeSurface();\ndiffuseColor.rgb = sAlb;')
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
  totalEmissiveRadiance += vec3(0.45, 0.75, 1.0) * uGhost * (0.06 + 0.9 * rim);
}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= clamp(sCCk, 0.0, 1.0);
#endif
#ifdef USE_IRIDESCENCE
  material.iridescence *= sIridk;
#endif`);
  };
  mat.customProgramCacheKey = () => 'serpent-skin-v1';
  return { mat, u };
}

export function applySkin(mat: THREE.MeshPhysicalMaterial, u: SnakeUniforms, id: SkinId): SkinLook {
  const L = SKIN_LOOKS[id] ?? SKIN_LOOKS.obsidian;
  u.uSkin.value = L.index;
  (u.uCBase.value as THREE.Color).setStyle(L.base);
  (u.uCPat.value as THREE.Color).setStyle(L.pattern);
  (u.uCBelly.value as THREE.Color).setStyle(L.belly);
  (u.uCAlt.value as THREE.Color).setStyle(L.alt);
  (u.uCRim.value as THREE.Color).setStyle(L.rim);
  u.uRimK.value = L.rimStrength;
  u.uKeel.value = L.keel;
  u.uEmitK.value = L.emissive;
  u.uRough.value = L.roughness;
  u.uCC.value = L.clearcoat;
  mat.iridescence = L.iridescence;
  mat.sheen = L.sheen;
  return L;
}
