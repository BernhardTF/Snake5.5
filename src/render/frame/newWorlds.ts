// Frames + surroundings for the expansion worlds (pinksands, vaadhoo, dallol, luna, mars, titan, kepler).
// Spliced into FRAME_FRAG (frameShader.ts): SHARED_GLSL after the common helpers, NEW_BIOMES_GLSL as
// `#elif` branches of the per-biome chain. Hooks a branch may define:
//   CUSTOM_ALL   -> vec3 shadeAll(p, d, q, vert, outward, along, vis, fw) replaces rail + surroundings
//   CUSTOM_OUTER -> vec3 shadeOuter(p, d, vis, fw) replaces the surroundings (rail still uses railSurf)
//   POST_SHADE   -> vec3 postShade(p, d, col, fw) runs last (fog veils etc.)

import { BIOME_INDEX } from '../biomeVisuals';
import type { BiomeId } from '../../types';

const idx = (id: BiomeId, fallback: number) => (BIOME_INDEX as Partial<Record<BiomeId, number>>)[id] ?? fallback;
/** Compile-time biome ids for the expansion worlds (follow BIOME_INDEX; fall back to BiomeId order). */
export const BIOME_DEFINES = /* glsl */ `
#define B_PINK ${idx('pinksands', 5)}
#define B_VAADHOO ${idx('vaadhoo', 6)}
#define B_DALLOL ${idx('dallol', 7)}
#define B_LUNA ${idx('luna', 8)}
#define B_MARS ${idx('mars', 9)}
#define B_TITAN ${idx('titan', 10)}
#define B_KEPLER ${idx('kepler', 11)}
`;

export const SHARED_GLSL = /* glsl */ `
#define PI 3.14159265
// rotates a vector by +a
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float sdSegF(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
vec3 srgb(vec3 c) { return c * c * (c * 0.3 + 0.7); } // cheap sRGB -> linear
// cheap 3x3 cellular noise: (F1, F2, cell hash); rel = vector from x to the nearest feature point (cell units)
vec3 cell2(vec2 x, float jit, out vec2 rel) {
  vec2 n = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0, h = 0.0;
  rel = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = 0.5 + (hash22(n + g) - 0.5) * jit;
    vec2 r = g + o - f;
    float dd = dot(r, r);
    if (dd < f1) { f2 = f1; f1 = dd; rel = r; h = hash12(n + g + 31.7); }
    else if (dd < f2) f2 = dd;
  }
  return vec3(sqrt(f1), sqrt(f2), h);
}
// shadow of the raised frame on the surroundings (1 = lit)
float frameShadowVis(vec2 p) {
  vec3 L = normalize(uSunDir);
  vec2 ps = p + L.xy / max(L.z, 0.2) * uFrameH * 0.9;
  return 1.0 - 0.75 * (1.0 - smoothstep(uBorder - 0.04, uBorder + 0.08, boardDist(ps)));
}
// Where to hang a celestial body: the top-left (right = 0) or top-right (right = 1) corner of the view,
// in whichever margin (side or top) has more room beyond 'inset'. Returns (cx, cy, radius).
vec3 cornerSpot(float right, float scale, float inset) {
  float ms = (right > 0.5 ? vView.z - uBoard.x : -vView.x) - inset;
  float mt = vView.w - uBoard.y - inset;
  vec3 r;
  if (mt >= ms) {
    r.z = clamp(mt * 0.34 * scale, 1.3, 7.5);
    r.y = uBoard.y + inset + max(mt * 0.55, r.z * 0.5);
    r.x = right > 0.5 ? vView.z - r.z * 1.5 : vView.x + r.z * 1.5;
  } else {
    r.z = clamp(ms * 0.34 * scale, 1.3, 7.5);
    float off = inset + max(ms * 0.5, r.z * 0.5);
    r.x = right > 0.5 ? uBoard.x + off : -off;
    r.y = vView.w - r.z * 1.5;
  }
  return r;
}
// crisp, non-twinkling stars (pixel-sized via fw) + optional Milky Way band
vec3 starfield(vec2 p, float fw, float amt, float milky) {
  vec2 bd = normalize(vec2(1.0, 0.45));
  float acr = dot(p - uBoard * 0.5, vec2(-bd.y, bd.x));
  float band = exp(-sq(acr / 6.5)) * milky;
  float neb = fbm3(p * 0.11 + 3.0);
  float lanes = smoothstep(0.5, 0.72, fbm3(vec2(dot(p, bd) * 0.12, acr * 0.35) + 7.0));
  vec3 col = vec3(0.02, 0.019, 0.026) * band * (0.3 + neb) * (1.0 - 0.75 * lanes);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float sc = 1.1 - fk * 0.35;
    vec2 g = p / sc + fk * 17.3;
    vec2 id = floor(g);
    vec3 h = hash32(id);
    float dens = k == 2 ? 0.08 + 0.5 * band : (k == 0 ? 0.1 : 0.16);
    if (h.z < dens) {
      vec2 sp = 0.2 + 0.6 * h.xy;
      float r = length(fract(g) - sp) * sc / fw;
      float mag = hash12(id + 5.7);
      float bright = (k == 0 ? 2.2 : (k == 1 ? 0.9 : 0.4)) * (0.25 + pow(mag, 4.0) * 2.5);
      float sz = k == 0 ? 0.75 + 0.6 * mag : 0.65;
      vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.84, 0.64), hash12(id + 2.3));
      col += tint * exp(-r * r / (sz * sz)) * bright * amt;
    }
  }
  return col;
}
`;

export const NEW_BIOMES_GLSL = /* glsl */ `
// ============================================================================ PINK SANDS
#elif BIOME == B_PINK
// Junkanoo palette, sun-bleached a touch
vec3 junk(float h) {
  vec3 c;
  if (h < 0.17) c = vec3(0.86, 0.06, 0.45);
  else if (h < 0.34) c = vec3(0.0, 0.62, 0.70);
  else if (h < 0.50) c = vec3(0.98, 0.72, 0.02);
  else if (h < 0.67) c = vec3(0.96, 0.36, 0.04);
  else if (h < 0.84) c = vec3(0.30, 0.70, 0.12);
  else c = vec3(0.08, 0.26, 0.74);
  return srgb(c) * 0.62;
}
vec3 silverWood(float u, float v, float seed) {
  float grain = fbm3(vec2(u * 0.45, v * 9.0) + seed);
  float fine = vnoise(vec2(u * 2.5, v * 70.0) + seed);
  return srgb(vec3(0.56, 0.54, 0.5)) * (0.7 + 0.35 * grain) * (0.85 + 0.25 * fine);
}
Surf railSurf(float along, float across, bool vert) {
  Surf s;
  float b = uBorder;
  float a = across / b;
  s.h = 0.0; s.spec = 0.18; s.gloss = 22.0; s.emit = vec3(0.0); s.nrm = vec2(0.0);
  float sd = vert ? 3.0 : 0.0;
  vec3 wood = silverWood(along, across, sd);
  if (a < 0.14) {
    // white trim bead against the sand
    float wear = smoothstep(0.6, 0.72, fbm3(vec2(along * 1.7, a * 5.0) + 2.0 + sd));
    s.alb = mix(srgb(vec3(0.95, 0.94, 0.9)), wood, wear * 0.8);
    s.nrm = vec2(0.0, (0.5 - a / 0.14) * 0.9);
    s.spec = 0.3; s.gloss = 30.0;
    return s;
  }
  // three painted clapboards across the rail
  float st = (a - 0.14) / 0.86 * 3.0;
  float si = min(floor(st), 2.0);
  float sf = st - si;
  float segL = 3.4 + 1.2 * hash12(vec2(si, 4.0 + sd));
  float ga = along / segL + si * 0.41 + sd * 0.07;
  float seg = floor(ga), gf = fract(ga);
  float jd = min(gf, 1.0 - gf) * segL;
  vec3 paint = junk(hash12(vec2(seg, si + sd * 10.0)));
  paint *= 0.9 + 0.18 * fbm3(vec2(along * 0.45, across * 9.0) + sd);
  // paint flakes to silvered wood: more at board ends and on the exposed lap edge
  float wn = fbm(vec2(along * 1.9, across * 7.0) + seg * 3.1 + si * 7.7);
  float wear = smoothstep(0.64, 0.7, wn + 0.3 * smoothstep(0.16, 0.0, jd) + 0.14 * smoothstep(0.7, 1.0, sf));
  s.alb = mix(paint, wood * 0.85, wear);
  // lap: each board is a wedge, the next overlaps it -> dark shadow line + tilted face
  s.nrm = vec2(0.0, -0.45 + 1.4 * smoothstep(0.85, 1.0, sf));
  s.alb *= mix(0.3, 1.0, smoothstep(0.0, 0.16, sf));
  // butt joints + rusty nail heads
  s.alb *= mix(0.3, 1.0, smoothstep(0.0, 0.025, jd));
  float nail = 1.0 - smoothstep(0.018, 0.03, length(vec2(jd - 0.09, (sf - 0.45) * b * 0.287)));
  s.alb = mix(s.alb, srgb(vec3(0.3, 0.16, 0.1)), nail * 0.85);
  s.spec = mix(0.22, 0.06, wear);
  return s;
}
Surf outerSurf(vec2 p) {
  // boardwalk decking, sun-silvered, a few planks still wearing pastel paint; pink sand in the gaps
  Surf s;
  float pw = 0.92;
  float row = floor(p.y / pw), fy = fract(p.y / pw);
  float bl = 6.3;
  float gx = p.x / bl + hash12(vec2(row, 3.0));
  float seg = floor(gx), gf = fract(gx);
  vec3 wood = silverWood(p.x, fy * pw, row * 7.1);
  float hh = hash12(vec2(seg, row));
  if (hh < 0.16) {
    vec3 pc = mix(junk(hash12(vec2(seg, row + 50.0))), vec3(0.9, 0.88, 0.84), 0.35);
    float w = smoothstep(0.56, 0.64, fbm(p * vec2(1.4, 5.0) + hh * 9.0));
    wood = mix(pc, wood, w);
  }
  vec3 sand = srgb(vec3(0.94, 0.75, 0.72));
  float edgeY = min(fy, 1.0 - fy);
  float drift = smoothstep(0.5, 0.78, fbm3(p * 0.7 + 4.0)) * (1.0 - smoothstep(0.0, 0.22, edgeY));
  vec3 c = mix(wood, sand, drift * 0.75);
  float gap = smoothstep(0.0, 0.05, fy) * (1.0 - smoothstep(0.95, 1.0, fy));
  c = mix(sand * 0.18, c, gap);
  float jd = min(gf, 1.0 - gf) * bl;
  c *= mix(0.3, 1.0, smoothstep(0.0, 0.03, jd));
  float jx = abs(fract(p.x / 1.4) - 0.5) * 1.4;
  float nail = 1.0 - smoothstep(0.02, 0.035, length(vec2(jx, (abs(fy - 0.5) - 0.28) * pw)));
  c = mix(c, srgb(vec3(0.28, 0.17, 0.12)), nail * 0.8);
  s.alb = c;
  s.nrm = vec2(0.0, (fy < 0.08 ? 0.8 : (fy > 0.92 ? -0.8 : 0.0)));
  s.spec = 0.1; s.gloss = 20.0; s.emit = vec3(0.0); s.h = 0.0;
  return s;
}

// ============================================================================ VAADHOO
#elif BIOME == B_VAADHOO
#define CUSTOM_OUTER
vec3 hardwood(float u, float v, float seed) {
  float w = fbm3(vec2(u * 0.3, v * 3.5) + seed);
  float fib = vnoise(vec2(u * 2.0, v * 90.0) + seed);
  vec3 c = mix(srgb(vec3(0.34, 0.17, 0.09)), srgb(vec3(0.55, 0.3, 0.14)), w);
  return c * (0.8 + 0.35 * fib);
}
Surf railSurf(float along, float across, bool vert) {
  // dhoni hull edge: deck planks, a rounded varnished gunwale, a coir rope along the outside
  Surf s;
  float b = uBorder;
  float a = across / b;
  s.h = 0.0; s.emit = vec3(0.0); s.spec = 0.55; s.gloss = 70.0; s.nrm = vec2(0.0);
  float sd = vert ? 9.0 : 0.0;
  if (a < 0.5) {
    float k = a / 0.5 * 3.0;
    float ki = floor(k), kf = fract(k);
    float ja = fract(along / 3.1 + ki * 0.37 + sd * 0.1);
    s.alb = hardwood(along, across, ki * 5.0 + sd);
    s.alb *= mix(0.15, 1.0, smoothstep(0.0, 0.07, kf) * (1.0 - smoothstep(0.93, 1.0, kf)));
    s.alb *= mix(0.25, 1.0, smoothstep(0.0, 0.012, min(ja, 1.0 - ja) * 3.1));
    float peg = 1.0 - smoothstep(0.025, 0.04, length(vec2((abs(ja - 0.5) - 0.44) * 3.1, (kf - 0.5) * b / 6.0)));
    s.alb = mix(s.alb, srgb(vec3(0.45, 0.3, 0.16)), peg * 0.7);
    s.nrm = vec2(0.0, (kf < 0.1 ? 0.6 : (kf > 0.9 ? -0.6 : 0.0)));
  } else if (a < 0.82) {
    float t = (a - 0.5) / 0.32 * 2.0 - 1.0;
    s.alb = hardwood(along * 0.7, across, 20.0 + sd) * 1.5;
    s.alb *= mix(0.35, 1.0, smoothstep(1.0, 0.8, abs(t)));
    s.nrm = vec2(0.0, t * 1.5);
    s.spec = 1.6; s.gloss = 80.0;
  } else {
    float t = (a - 0.82) / 0.18 * 2.0 - 1.0;
    float tw = fract(along * 5.5 + t * 0.7);
    float strand = sin(tw * PI);
    s.alb = srgb(vec3(0.62, 0.46, 0.28)) * (0.45 + 0.6 * strand) * (0.8 + 0.3 * vnoise(vec2(along * 40.0, t * 4.0)));
    s.alb *= mix(0.3, 1.0, smoothstep(1.0, 0.7, abs(t)));
    s.nrm = vec2(cos(tw * 6.2831) * 0.5, t * 1.3);
    s.spec = 0.08; s.gloss = 12.0;
  }
  return s;
}
vec3 shadeOuter(vec2 p, float d, float vis, float fw) {
  // night sea: long swell + chop, a broken moon path, reflected stars, plankton against the hull
  vec3 L = normalize(uSunDir);
  float t = uTime;
  vec3 g1 = gnoised(p * vec2(0.45, 0.7) + vec2(t * 0.06, t * 0.14));
  vec3 g2 = gnoised(p * vec2(1.5, 2.1) - vec2(t * 0.17, t * 0.11));
  vec3 g3 = gnoised(p * vec2(3.9, 5.1) + vec2(t * 0.33, -t * 0.27));
  vec2 slope = g1.yz * 0.16 + g2.yz * 0.07 + g3.yz * 0.035;
  vec3 N = normalize(vec3(-slope, 1.0));
  float e = d - uBorder;
  vec3 deep = vec3(0.002, 0.006, 0.017);
  vec3 skyR = vec3(0.006, 0.014, 0.036);
  // long swell: faint moonlit crests facing the moon
  vec2 md0 = length(L.xy) > 0.05 ? normalize(L.xy) : vec2(0.6, 0.8);
  float crest = smoothstep(0.1, 0.3, dot(g1.yz, md0) * 0.5 + g2.x * 0.08);
  vec3 col = deep * (0.8 + 0.3 * g1.x) + skyR * (0.5 + 0.9 * crest);
  // a few reflected stars, wobbling with the waves
  col += starfield(p * 0.8 + slope * 0.5, fw * 0.8, 0.12, 0.0);
  // moon path: a band toward the moon, glitter on facets tilted toward it
  vec2 md = length(L.xy) > 0.05 ? normalize(L.xy) : vec2(0.6, 0.8);
  vec2 rel = p - uBoard * 0.5;
  float ap = dot(rel, md), pp = dot(rel, vec2(-md.y, md.x));
  float w = 1.1 + 0.07 * max(ap, 0.0);
  float band = exp(-sq(pp / w)) * smoothstep(-4.0, 14.0, ap);
  vec3 Hf = normalize(vec3(md * 0.08, 1.0));
  float glint = pow(max(dot(N, Hf), 0.0), 1400.0) * smoothstep(0.2, 0.6, 0.5 + 0.5 * g3.x);
  vec3 moonC = vec3(0.7, 0.8, 1.0);
  col += moonC * band * (0.03 + 0.02 * g2.x + glint * 1.6);
  col += moonC * glint * 0.08 * (1.0 - band);
  // hull shade + bioluminescent plankton lapping against the hull
  col *= mix(0.45, 1.0, smoothstep(0.0, 0.6, e)) * mix(0.7, 1.0, frameShadowVis(p));
  vec2 bc = floor(p * 6.0 + vec2(t * 0.25, 0.0));
  float bio = smoothstep(0.7, 0.95, vnoise(p * 6.5 + slope * 4.0 + t * vec2(0.3, -0.2))) * exp(-e / 0.3);
  float blink = 0.5 + 0.5 * sin(t * 2.3 + hash12(bc) * 6.28);
  col += vec3(0.04, 0.55, 1.0) * bio * blink * 1.2;
  // sparse drifting plankton flecks in the open water
  vec2 cg = p * 1.8 + vec2(t * 0.05, t * 0.03);
  vec2 ci = floor(cg);
  vec3 hh = hash32(ci);
  if (hh.z < 0.035) {
    float r = length(fract(cg) - (0.2 + 0.6 * hh.xy)) / 1.8 / fw;
    float bl = max(0.0, sin(t * (0.6 + hh.x * 1.5) + hh.y * 30.0));
    col += vec3(0.1, 0.75, 1.0) * exp(-r * r * 0.6) * bl * bl * 1.2;
  }
  return col * mix(0.75, 1.0, vis);
}

// ============================================================================ DALLOL
#elif BIOME == B_DALLOL
Surf railSurf(float along, float across, bool vert) {
  // amoleh salt slabs cut by Afar caravans, lashed with camel-hair rope
  Surf s;
  float b = uBorder;
  float a = across / b;
  float len = 1.45;
  float bl = along / len + (vert ? 0.3 : 0.0);
  float id = floor(bl), f = fract(bl);
  float jd = min(f, 1.0 - f) * len;
  float ed = min(a, 1.0 - a) * b;
  float chip = fbm3(vec2(along, across) * 6.0 + id) * 0.06;
  float edge = min(jd, ed) - chip;
  float bev = smoothstep(0.0, 0.07, edge);
  float h = hash12(vec2(id, vert ? 7.0 : 3.0));
  float layer = across * 7.0 + fbm3(vec2(along * 0.6, across * 2.0) + id * 2.0) * 1.6 + h * 5.0;
  float band = 0.5 + 0.5 * sin(layer * PI);
  vec3 salt = mix(srgb(vec3(0.74, 0.72, 0.67)), srgb(vec3(0.5, 0.46, 0.4)), band * 0.7);
  salt = mix(salt, srgb(vec3(0.66, 0.57, 0.42)), smoothstep(0.55, 0.9, h) * 0.55);
  salt *= 0.88 + 0.2 * vnoise(vec2(along, across) * 30.0);
  float adz = sin((along + across * 0.6) * 38.0 + fbm3(vec2(along, across) * 3.0) * 4.0);
  s.alb = salt * mix(0.35, 1.0, bev) * (0.94 + 0.06 * adz);
  s.nrm.x = (f < 0.5 ? 1.0 : -1.0) * (1.0 - smoothstep(0.0, 0.08, jd)) * 0.9 + adz * 0.04;
  s.nrm.y = (a < 0.5 ? 1.0 : -1.0) * (1.0 - smoothstep(0.0, 0.08, ed)) * 0.9;
  s.spec = 0.25; s.gloss = 30.0; s.emit = vec3(0.0); s.h = 0.0;
  // doubled rope lashing across the rail every two slabs
  float rs = (fract(along / 2.9 + 0.5) - 0.5) * 2.9;
  float ra = abs(rs);
  s.alb *= mix(0.55, 1.0, smoothstep(0.1, 0.17, ra));
  if (ra < 0.11) {
    float sub = fract(rs / 0.055);
    float tw = fract(across * 9.0 + sub * 1.3);
    vec3 rope = srgb(vec3(0.34, 0.22, 0.12)) * (0.5 + 0.55 * sin(tw * PI)) * (0.85 + 0.3 * vnoise(vec2(across * 60.0, rs * 30.0)));
    s.alb = rope * mix(0.45, 1.0, sin(sub * PI));
    s.nrm = vec2((sub - 0.5) * 1.6, cos(tw * 6.2831) * 0.3);
    s.spec = 0.05; s.gloss = 10.0;
  }
  return s;
}
Surf outerSurf(vec2 p) {
  // salt pan: polygonal pressure ridges, sulphur and iron stains
  Surf s;
  vec2 rel;
  vec3 c = cell2(p * 0.9, 0.9, rel);
  float ridge = 1.0 - smoothstep(0.0, 0.14, c.y - c.x);
  vec3 salt = srgb(vec3(0.74, 0.72, 0.66)) * (0.8 + 0.25 * fbm3(p * 2.5));
  float sul = smoothstep(0.55, 0.78, fbm3(p * 0.35 + 11.0));
  salt = mix(salt, srgb(vec3(0.8, 0.72, 0.16)), sul * 0.7);
  float och = smoothstep(0.66, 0.85, fbm3(p * 0.5 + 23.0));
  salt = mix(salt, srgb(vec3(0.74, 0.42, 0.13)), och * 0.45);
  s.alb = salt * (0.88 + 0.16 * c.z) * mix(1.0, 1.18, ridge) * mix(0.72, 1.0, smoothstep(0.0, 0.5, c.x));
  s.nrm = -normalize(rel + 1e-4) * ridge * 0.7 + gnoised(p * 5.0).yz * 0.05;
  s.spec = 0.3; s.gloss = 40.0; s.emit = vec3(0.0); s.h = 0.0;
  return s;
}

// ============================================================================ LUNA
#elif BIOME == B_LUNA
#define CUSTOM_ALL
vec3 regolith(vec2 p) {
  return srgb(vec3(0.44, 0.43, 0.42)) * (0.75 + 0.35 * fbm3(p * 3.1)) * (0.85 + 0.3 * vnoise(p * 23.0));
}
vec3 earthDisc(vec2 p, vec3 es, float fw, vec3 L, out float cover) {
  vec2 q = (p - es.xy) / es.z;
  float r = length(q);
  float aa = fw / es.z * 1.2;
  cover = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  vec3 Ld = normalize(vec3(L.xy, L.z * 0.3 + 0.05));
  float halo = exp(-max(r - 1.0, 0.0) * es.z * 9.0) * (1.0 - cover);
  float lit = clamp(dot(q / max(r, 1e-3), normalize(Ld.xy + 1e-4)) * 0.8 + 0.35, 0.0, 1.0);
  vec3 glow = vec3(0.12, 0.3, 0.95) * halo * lit * 0.5;
  if (r >= 1.0) return glow;
  vec3 n = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
  vec3 nt = vec3(n.x, n.y * 0.92 + n.z * 0.39, -n.y * 0.39 + n.z * 0.92);
  float lon = atan(nt.x, nt.z) + uTime * 0.012;
  float lat = asin(clamp(nt.y, -1.0, 1.0));
  vec2 uv = vec2(lon * 1.6, lat * 1.9);
  float cont = fbm(uv * 1.1 + vec2(4.0, 1.7));
  float land = smoothstep(0.53, 0.56, cont);
  float dry = fbm3(uv * 2.3 + 9.0);
  vec3 landC = mix(vec3(0.03, 0.07, 0.02), vec3(0.24, 0.17, 0.08), smoothstep(0.35, 0.7, dry));
  vec3 sea = mix(vec3(0.003, 0.018, 0.085), vec3(0.01, 0.07, 0.17), smoothstep(0.4, 0.53, cont));
  vec3 alb = mix(sea, landC, land);
  float ice = smoothstep(1.08, 1.2, abs(lat) + 0.08 * dry);
  alb = mix(alb, vec3(0.72, 0.74, 0.78), ice);
  vec2 cuv = uv + vec2(uTime * 0.004, 0.0);
  float cl = fbm(cuv * 1.7 + vec2(fbm3(cuv * 2.0) * 1.4, 0.0) + 3.3);
  float cloud = smoothstep(0.5, 0.76, cl);
  alb = mix(alb, vec3(0.86, 0.87, 0.9), cloud);
  float ndl = dot(n, Ld);
  float day = smoothstep(-0.05, 0.2, ndl);
  vec3 c = alb * max(ndl, 0.0) * 2.6;
  vec3 H = normalize(Ld + vec3(0.0, 0.0, 1.0));
  c += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, H), 0.0), 60.0) * (1.0 - land) * (1.0 - cloud) * 0.8 * day;
  float fres = pow(1.0 - n.z, 2.5);
  c = mix(c, vec3(0.25, 0.5, 1.2) * max(ndl + 0.2, 0.0), fres * 0.6);
  c += vec3(0.25, 0.08, 0.02) * exp(-sq(ndl / 0.06)) * 0.35 * (1.0 - cloud * 0.5);
  float city = land * (1.0 - ice) * smoothstep(0.72, 0.9, vnoise(uv * 70.0)) * smoothstep(0.58, 0.64, cont) * smoothstep(0.4, 0.7, vnoise(uv * 9.0));
  c += vec3(1.0, 0.6, 0.25) * city * (1.0 - day) * 0.3 * (1.0 - cloud);
  return c * cover + glow;
}
vec3 shadeAll(vec2 p, float d, vec2 q, bool vert, vec2 outward, float along, float vis, float fw) {
  // the board is a cut block of regolith floating in space
  vec3 L = normalize(uSunDir);
  vec2 ld = length(L.xy) > 0.05 ? normalize(L.xy) : vec2(-0.6, 0.8);
  vec2 o = ld * 0.95;             // screen direction of the block's depth: toward the sun so the faces are lit
  float bev = 0.12;
  vec3 col = starfield(p, fw, 1.0, 1.0);
  float ec;
  vec3 es = cornerSpot(ld.x < 0.0 ? 1.0 : 0.0, 1.0, 0.3);
  vec3 ecol = earthDisc(p, es, fw, L, ec);
  col = col * (1.0 - ec) + ecol;
  if (d < bev) {
    // chamfered top edge
    Surf s;
    s.alb = regolith(p) * 0.95; s.spec = 0.0; s.gloss = 1.0; s.emit = vec3(0.0); s.nrm = vec2(0.0); s.h = 0.0;
    vec3 N = normalize(vec3(outward * 0.9, 1.0));
    float diff = max(dot(N, L), 0.0);
    return s.alb * (uSunColor * diff + vec3(0.004, 0.006, 0.012)) * mix(0.8, 1.0, smoothstep(0.0, 0.03, d));
  }
  // side faces: mirror so the depth runs toward +x / -y
  vec2 m = vec2(o.x < 0.0 ? -1.0 : 1.0, o.y > 0.0 ? -1.0 : 1.0);
  vec2 pm = (p - uBoard * 0.5) * m + uBoard * 0.5;
  vec2 om = abs(o) * vec2(1.0, -1.0);
  vec2 lo = vec2(-bev), hi = uBoard + bev;
  float face = 0.0, tt = 0.0, u = 0.0;
  vec3 N = vec3(0.0);
  if (pm.y < lo.y && om.y < -0.02) {
    float t = (lo.y - pm.y) / -om.y;
    float x0 = pm.x - t * om.x;
    if (x0 >= lo.x && x0 <= hi.x) { face = 1.0; tt = t; u = x0; N = vec3(0.0, -m.y, 0.0); }
  }
  if (face == 0.0 && pm.x > hi.x && om.x > 0.02) {
    float t = (pm.x - hi.x) / om.x;
    float y0 = pm.y - t * om.y;
    if (y0 >= lo.y && y0 <= hi.y) { face = 2.0; tt = t; u = y0 + 57.0; N = vec3(m.x, 0.0, 0.0); }
  }
  if (face > 0.0) {
    // jagged broken underside: the block's thickness varies along the face
    float T = 0.8 + 0.45 * fbm3(vec2(u * 0.35, face * 7.0)) + 0.1 * vnoise(vec2(u * 3.0, face));
    if (tt < T) {
      float z = tt;
      float layer = z * 6.0 + fbm3(vec2(u * 0.7, z * 3.0)) * 1.6;
      vec3 alb = srgb(vec3(0.42, 0.41, 0.4)) * (0.8 + 0.25 * sin(layer * PI));
      alb = mix(alb, srgb(vec3(0.52, 0.51, 0.5)), smoothstep(0.14, 0.0, z) * 0.6);   // fine fresh-cut regolith on top
      vec2 rr;
      vec3 cl = cell2(vec2(u, z * 1.1) * 3.5, 1.0, rr);
      float clast = (1.0 - smoothstep(0.26, 0.34, cl.x)) * step(0.55, cl.z) * smoothstep(0.1, 0.25, z);
      alb = mix(alb, srgb(vec3(0.3, 0.29, 0.29)) * (0.7 + 0.6 * cl.z), clast);
      alb *= 0.9 + 0.2 * vnoise(vec2(u, z) * 25.0);
      alb *= 1.0 + 0.04 * sin(z * 70.0);        // saw marks
      vec3 Nf = normalize(N + vec3(0.0, 0.0, 0.0) + vec3(rr.x, 0.0, rr.y) * clast * 0.3 * abs(N.y)
                           + vec3(0.0, rr.x, rr.y) * clast * 0.3 * abs(N.x));
      float diff = max(dot(Nf, L), 0.0);
      vec3 c = alb * (uSunColor * (diff * 0.9 + 0.04) + vec3(0.006, 0.008, 0.016));
      c *= mix(0.55, 1.0, smoothstep(0.0, 0.08, T - tt));          // darker ragged bottom lip
      c *= 1.0 + 0.5 * smoothstep(0.03, 0.0, z);                   // lit top arris
      c *= face == 2.0 ? 0.88 : 1.0;
      return c;
    }
  }
  return col;
}

// ============================================================================ MARS
#elif BIOME == B_MARS
#define CUSTOM_OUTER
Surf railSurf(float along, float across, bool vert) {
  // stratified mudstone ledge (Jezero delta beds): three beds along the rail, each broken into
  // blocks by joints, stepping down toward the board; rust dust settles on the treads
  Surf s;
  float b = uBorder;
  float a = across / b;
  float sd = vert ? 13.0 : 0.0;
  float wob = fbm3(vec2(along * 0.3 + sd, across * 0.7)) - 0.5;
  float layer = a * 3.0 + wob * 1.1 + 0.25 * sin(along * 0.9 + sd);
  float li = floor(layer), lf = fract(layer);
  float ja = (along + (lf - 0.5) * (hash12(vec2(li, 4.0 + sd)) - 0.5) * 1.2) / (0.8 + 0.7 * hash12(vec2(li, 2.0 + sd)))
           + hash12(vec2(li, 9.0 + sd)) * 3.0 + wob * 1.4 + 0.3 * vnoise(vec2(along, across) * 4.0);
  float bi = floor(ja), bf = fract(ja);
  vec3 h = hash32(vec2(bi, li + sd));
  float tone = h.x;
  vec3 rock = mix(srgb(vec3(0.46, 0.28, 0.19)), srgb(vec3(0.6, 0.42, 0.3)), tone);
  rock = mix(rock, srgb(vec3(0.37, 0.29, 0.28)), step(0.8, h.y) * 0.6);
  rock *= 0.9 + 0.1 * sin((lf * 6.0 + wob) * PI);               // laminae within the bed
  rock *= 0.8 + 0.3 * fbm3(vec2(along, across) * 7.0 + h.z * 10.0);
  float jd = min(bf, 1.0 - bf);
  float joint = 1.0 - smoothstep(0.0, 0.05, jd);
  float riser = smoothstep(0.78, 0.98, lf);                       // step down to the next bed
  float dust = smoothstep(0.35, 0.8, fbm3(vec2(along, across) * 1.6 + 9.0)) * (1.0 - riser);
  rock = mix(rock, srgb(vec3(0.62, 0.36, 0.2)), dust * 0.5);
  rock *= mix(1.0, 0.45, riser) * mix(1.0, 0.62, joint);
  s.alb = rock;
  s.nrm = vec2((h.z - 0.5) * 0.3 + (bf < 0.5 ? 1.0 : -1.0) * joint * 0.6, (h.y - 0.5) * 0.25 - riser * 1.6)
        + gnoised(vec2(along, across) * 6.0).yz * 0.06;
  s.spec = 0.02; s.gloss = 8.0; s.emit = vec3(0.0); s.h = 0.0;
  return s;
}
vec3 shadeOuter(vec2 p, float d, float vis, float fw) {
  vec3 L = normalize(uSunDir);
  // rust dust with darker basalt patches and wind ripples
  float big = fbm3(p * 0.3 + 2.0);
  vec3 alb = mix(srgb(vec3(0.6, 0.34, 0.19)), srgb(vec3(0.44, 0.27, 0.19)), smoothstep(0.55, 0.8, big) * 0.7);
  alb *= 0.85 + 0.25 * fbm3(p * 1.8);
  // pebble speckle
  vec2 prel;
  vec3 pc = cell2(p * 2.2, 1.0, prel);
  float peb = (1.0 - smoothstep(0.1, 0.2, pc.x)) * step(pc.z, 0.35);
  alb = mix(alb, srgb(vec3(0.24, 0.17, 0.14)) * (0.7 + 0.6 * fract(pc.z * 9.0)), peb * 0.8);
  vec2 wd = normalize(vec2(0.9, 0.35));
  float rp = dot(p, wd) * 8.0 + fbm3(p * 0.6) * 5.0;
  vec2 nrm = wd * cos(rp) * 0.12;
  // scattered rocks with cast shadows
  vec2 rel;
  float sc = 0.6;
  vec3 c = cell2(p * sc, 0.9, rel);
  float rr = (0.1 + 0.2 * pow(fract(c.z * 7.3), 2.0)) * step(c.z, 0.45);
  float ang = atan(rel.y, rel.x);
  float rad = rr * (1.0 + 0.22 * sin(ang * 3.0 + c.z * 20.0));
  float onRock = 1.0 - smoothstep(rad - 0.03, rad, length(rel));
  vec2 so = L.xy / max(L.z, 0.2) * rr * 0.8;
  float shad = (1.0 - smoothstep(rad - 0.05, rad + 0.02, length(rel + so))) * (1.0 - onRock);
  if (onRock > 0.0) {
    float hh = sqrt(max(0.0, 1.0 - sq(length(rel) / max(rad, 1e-3))));
    vec2 rn = rel / max(rad, 1e-3);
    nrm = mix(nrm, rn * 1.2, onRock);
    vec3 basalt = srgb(vec3(0.2, 0.15, 0.13)) * (0.8 + 0.4 * vnoise(p * 30.0));
    alb = mix(alb, mix(basalt, srgb(vec3(0.6, 0.34, 0.19)), smoothstep(0.55, 0.9, hh) * 0.6), onRock);
  }
  // far rover tracks in the widest margin
  float ms = -vView.x - uBorder, mt = vView.w - uBoard.y - uBorder;
  float trackD, tAlong;
  if (mt >= ms) {
    float yc = uBoard.y + uBorder + max(0.45, mt * 0.42) + 0.5 * sin(p.x * 0.15 + 1.0);
    trackD = p.y - yc; tAlong = p.x;
  } else {
    float xc = -uBorder - max(0.5, ms * 0.5) + 0.4 * sin(p.y * 0.19 + 2.0);
    trackD = p.x - xc; tAlong = p.y;
  }
  float rut = 1.0 - smoothstep(0.045, 0.075, abs(abs(trackD) - 0.2));
  float tread = step(0.5, fract(tAlong * 6.0 + step(0.0, trackD) * 0.5));
  alb *= 1.0 - rut * (0.28 + 0.12 * tread) * (1.0 - onRock);
  nrm += vec2(0.0, sign(trackD) * rut * 0.3);
  vec3 N = normalize(vec3(-nrm, 1.0));
  Surf s; s.alb = alb; s.h = 0.0; s.nrm = vec2(0.0); s.spec = 0.05; s.gloss = 12.0; s.emit = vec3(0.0);
  float v = vis * frameShadowVis(p) * (1.0 - 0.7 * shad);
  vec3 col = light(s, N, v);
  col *= mix(0.6, 1.0, smoothstep(uBorder, uBorder + 0.35, d));
  // butterscotch haze deepens with distance
  float hz = 1.0 - exp(-max(d - uBorder, 0.0) * 0.06);
  return mix(col, srgb(vec3(0.72, 0.5, 0.32)) * (uSunColor * 0.35 + uSkyColor), hz * 0.6);
}

// ============================================================================ TITAN
#elif BIOME == B_TITAN
#define CUSTOM_OUTER
#define POST_SHADE
vec3 titanHaze(vec2 p) {
  float f = fbm3(p * 0.12 + vec2(uTime * 0.02, uTime * 0.008));
  return srgb(vec3(0.66, 0.38, 0.14)) * (0.5 + 0.18 * f);
}
Surf railSurf(float along, float across, bool vert) {
  // rounded water-ice cobbles bedded in dark tholin sand, wet with methane
  Surf s;
  vec2 lp = vec2(along, across);
  vec2 rel;
  vec3 c = cell2(lp * 2.1 + (vert ? 11.0 : 0.0), 1.0, rel);
  float edge = c.y - c.x;
  float rad = 0.55 + 0.2 * c.z;
  float dome = sqrt(max(0.0, 1.0 - sq(c.x / rad)));
  float gap = smoothstep(0.05, 0.2, edge) * step(c.x, rad);
  vec3 ice = mix(srgb(vec3(0.82, 0.84, 0.86)), srgb(vec3(0.62, 0.66, 0.72)), c.z) * (0.9 + 0.15 * vnoise(lp * 25.0));
  ice = mix(ice, srgb(vec3(0.5, 0.34, 0.2)), smoothstep(0.55, 0.0, dome) * 0.55);  // tholin grime on the flanks
  vec3 sand = srgb(vec3(0.12, 0.08, 0.05));
  s.alb = mix(sand, ice, gap);
  s.nrm = rel / rad * 1.8 * gap;
  s.spec = 0.7 * gap; s.gloss = 60.0; s.emit = vec3(0.0); s.h = 0.0;
  return s;
}
vec4 saturnDisc(vec2 p, vec3 es, float fw) {
  vec2 q = rot2(-0.38) * (p - es.xy) / es.z;
  float r = length(q);
  float aa = fw / es.z * 1.5;
  float pa = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  float re = length(vec2(q.x, q.y / 0.34));
  float ring = smoothstep(1.28, 1.34, re) * (1.0 - smoothstep(2.15, 2.22, re));
  ring *= 0.55 + 0.45 * sin(re * 38.0) * sin(re * 11.0 + 1.0);
  ring *= 1.0 - 0.85 * (1.0 - smoothstep(0.02, 0.045, abs(re - 1.86)));
  float front = step(q.y, 0.0);
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r * r)));
  vec3 Ls = normalize(vec3(-0.55, 0.35, 0.6));
  float lam = max(dot(n, Ls), 0.0);
  float bands = 0.5 + 0.5 * sin(q.y * 11.0 + fbm3(vec2(q.x * 2.0, q.y * 6.0)) * 1.5);
  vec3 pc = mix(srgb(vec3(0.86, 0.72, 0.5)), srgb(vec3(0.72, 0.58, 0.4)), bands) * (lam * 1.1 + 0.05);
  // planet shadow across the back of the rings
  vec3 rc = srgb(vec3(0.85, 0.78, 0.64)) * 0.9;
  float ringVis = ring * max(front, 1.0 - pa);
  vec3 col = pc * pa;
  col = mix(col, rc, ringVis);
  return vec4(col, max(pa, ringVis));
}
vec3 shadeOuter(vec2 p, float d, float vis, float fw) {
  vec3 L = normalize(uSunDir);
  float e = d - uBorder;
  // long linear hydrocarbon dunes
  vec2 dd = normalize(vec2(0.18, 1.0));
  float ph = dot(p, dd) * 1.1 + fbm3(p * 0.15) * 3.0;
  float rg = 0.5 + 0.5 * sin(ph);
  vec2 nrm = dd * cos(ph) * 0.35;
  vec3 alb = srgb(vec3(0.17, 0.11, 0.07)) * (0.8 + 0.3 * fbm3(p * 1.5)) * (0.9 + 0.2 * rg);
  Surf s; s.alb = alb; s.h = 0.0; s.nrm = vec2(0.0); s.spec = 0.05; s.gloss = 10.0; s.emit = vec3(0.0);
  vec3 col = light(s, normalize(vec3(-nrm, 1.0)), vis * frameShadowVis(p));
  col *= mix(0.6, 1.0, smoothstep(0.0, 0.35, e));
  // thick orange haze, denser with distance, drifting
  vec3 hc = titanHaze(p);
  float fog = fbm3(p * 0.09 - vec2(uTime * 0.015, 0.0));
  float hz = clamp((1.0 - exp(-e * 0.3)) * (0.75 + 0.5 * fog) + 0.1 * fog, 0.0, 0.97);
  col = mix(col, hc, hz);
  // Saturn's rings, faint through the haze
  vec3 es = cornerSpot(1.0, 1.2, uBorder);
  es.z *= 0.55;
  vec4 sat = saturnDisc(p, es, fw);
  col = mix(col, mix(hc, sat.rgb, 0.6), sat.a * 0.17 * smoothstep(0.2, 0.8, hz));
  return col;
}
vec3 postShade(vec2 p, float d, vec3 col, float fw) {
  if (d < uBorder) {
    float fog = fbm3(p * 0.2 + vec2(uTime * 0.03, uTime * 0.01));
    col = mix(col, titanHaze(p), 0.1 + 0.14 * fog);
  }
  return col;
}

// ============================================================================ KEPLER-186f
#elif BIOME == B_KEPLER
#define CUSTOM_OUTER
float hexD(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.8660254, 0.5)), p.y);
}
Surf railSurf(float along, float across, bool vert) {
  // twisted roots with glowing crystal clusters grown through them
  Surf s;
  float b = uBorder;
  float a = across / b;
  float sd = vert ? 5.0 : 0.0;
  float t = uTime;
  vec3 soil = srgb(vec3(0.07, 0.045, 0.09)) * (0.7 + 0.5 * fbm3(vec2(along, across) * 4.0 + sd));
  s.alb = soil; s.nrm = vec2(0.0); s.spec = 0.1; s.gloss = 20.0; s.emit = vec3(0.0); s.h = 0.0;
  // moss glow speckles
  float moss = smoothstep(0.8, 0.95, vnoise(vec2(along, across) * 18.0 + sd));
  s.emit += vec3(0.1, 0.5, 0.45) * moss * 0.25;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ci = 0.2 + 0.3 * fi + 0.14 * sin(along * (0.7 + 0.2 * fi) + fi * 2.1 + sd);
    float wi = 0.14 + 0.04 * sin(along * 1.7 + fi * 3.0);
    float dr = (a - ci) / wi;
    float over = sin(along * 0.9 + fi * 2.0);
    if (abs(dr) < 1.0 && (over > -0.3 || s.spec < 0.2)) {
      float cyl = sqrt(1.0 - dr * dr);
      float bark = vnoise(vec2(along * 7.0 + fi * 13.0, dr * 3.0));
      s.alb = srgb(vec3(0.36, 0.2, 0.28)) * (0.55 + 0.6 * bark) * (0.45 + 0.55 * cyl);
      s.nrm = vec2(0.0, dr * 1.4 / max(cyl, 0.3));
      s.spec = 0.3; s.gloss = 30.0;
      // sap veins glowing through the bark
      float vein = 1.0 - smoothstep(0.0, 0.12, abs(dr - 0.35 * sin(along * 3.0 + fi)));
      s.emit = vec3(0.15, 0.8, 0.9) * vein * 0.35 * (0.6 + 0.4 * sin(along * 1.3 - t * 1.2 + fi * 2.0));
    }
  }
  // crystal clusters
  float cl = along / 2.3 + sd * 0.3;
  float ci = floor(cl), cf = fract(cl);
  vec3 h = hash32(vec2(ci, 3.0 + sd));
  vec2 cc = vec2((cf - 0.5 - (h.x - 0.5) * 0.4) * 2.3, (a - 0.5 - (h.y - 0.5) * 0.3) * b);
  vec3 glowC = h.z < 0.5 ? vec3(1.0, 0.25, 0.85) : vec3(0.2, 0.9, 1.0);
  float pulse = 0.65 + 0.35 * sin(t * 1.3 + h.x * 6.28);
  float halo = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 off = vec2(cos(fk * 2.1 + h.x * 6.0), sin(fk * 2.1 + h.x * 6.0)) * 0.13 * step(0.5, fk);
    float sz = (0.22 - fk * 0.045) * (0.8 + 0.4 * h.y);
    vec2 cp = rot2(h.z * 3.0 + fk) * (cc - off);
    float hd = hexD(cp) / sz;
    halo = max(halo, exp(-max(hd - 1.0, 0.0) * 3.0));
    if (hd < 1.0) {
      float an = atan(cp.y, cp.x);
      float sector = floor((an + PI) / (PI / 3.0));
      float sa = (sector + 0.5) * (PI / 3.0) - PI;
      vec2 fn = vec2(cos(sa), sin(sa));
      vec2 fnW = rot2(-(h.z * 3.0 + fk)) * fn;
      s.nrm = fnW * 0.9 * smoothstep(0.25, 0.6, hd);
      s.alb = glowC * 0.25 + 0.06;
      s.spec = 1.2; s.gloss = 160.0;
      s.emit = glowC * (0.3 + 0.6 * (1.0 - hd)) * pulse;
    }
  }
  s.emit += glowC * halo * 0.2 * pulse;
  return s;
}
vec4 gasGiant(vec2 p, vec3 es, float fw) {
  vec2 q = (p - es.xy) / es.z;
  float r = length(q);
  float aa = fw / es.z * 1.5;
  float pa = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  vec3 Lw = normalize(vec3(-0.8, 0.35, 0.45)), Lc = normalize(vec3(0.85, 0.15, 0.3));
  float halo = exp(-max(r - 1.0, 0.0) * 18.0) * (1.0 - pa);
  vec3 glow = (vec3(1.0, 0.5, 0.35) * max(dot(normalize(q + 1e-4), Lw.xy), 0.0) + vec3(0.3, 0.5, 1.0) * max(dot(normalize(q + 1e-4), Lc.xy), 0.0)) * halo * 0.3;
  if (r >= 1.0) return vec4(glow, 0.0);
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r * r)));
  vec2 bq = rot2(0.3) * q;
  float lat = bq.y / max(n.z, 0.2) * 0.6 + bq.y * 0.4;
  float turb = fbm3(vec2(bq.x * 2.5 + uTime * 0.01, lat * 9.0));
  float bands = 0.5 + 0.5 * sin(lat * 9.0 + turb * 3.0) * (0.6 + 0.4 * sin(lat * 23.0 + turb * 5.0 + 1.3));
  vec3 alb = mix(srgb(vec3(0.34, 0.66, 0.72)), srgb(vec3(0.62, 0.52, 0.84)), bands);
  alb = mix(alb, srgb(vec3(0.9, 0.86, 0.82)), smoothstep(0.75, 0.95, bands) * 0.5);
  float storm = 1.0 - smoothstep(0.08, 0.13, length((bq - vec2(0.32, -0.28)) * vec2(1.0, 1.8)));
  alb = mix(alb, srgb(vec3(0.95, 0.55, 0.7)), storm * 0.7);
  vec3 c = alb * (vec3(1.0, 0.62, 0.42) * max(dot(n, Lw), 0.0) * 1.3 + vec3(0.42, 0.6, 1.0) * max(dot(n, Lc), 0.0) * 0.8 + 0.015);
  c += vec3(0.4, 0.5, 1.0) * pow(1.0 - n.z, 3.0) * 0.25;
  return vec4(c * pa + glow, pa);
}
vec3 shadeOuter(vec2 p, float d, float vis, float fw) {
  vec3 L = normalize(uSunDir);
  float t = uTime;
  float e = d - uBorder;
  vec3 alb = srgb(vec3(0.1, 0.06, 0.13)) * (0.7 + 0.5 * fbm3(p * 1.3));
  vec3 emit = vec3(0.0);
  vec2 nrm = gnoised(p * 3.0).yz * 0.08;
  // alien fungus caps
  vec2 rel;
  vec3 c = cell2(p * 0.8, 0.9, rel);
  float rad = (0.18 + 0.2 * fract(c.z * 5.3)) * step(c.z, 0.45);
  float rl = length(rel);
  if (rl < rad) {
    float hh = sqrt(1.0 - sq(rl / rad));
    vec3 capC = fract(c.z * 13.0) < 0.5 ? srgb(vec3(0.55, 0.2, 0.5)) : srgb(vec3(0.85, 0.45, 0.2));
    float spots = smoothstep(0.7, 0.85, vnoise(p * 9.0 + c.z * 40.0));
    alb = capC * (0.5 + 0.5 * hh);
    nrm = rel / rad * 1.2;
    emit += vec3(0.25, 1.0, 0.8) * spots * 0.5 * hh;
    emit += capC * 2.0 * smoothstep(0.75, 1.0, rl / rad) * (0.6 + 0.4 * sin(t * 1.1 + c.z * 30.0));
  }
  // bioluminescent fronds rooted along the rim, spreading outward
  if (e > -0.05 && e < 4.4) {
    vec2 cq = abs(p - uBoard * 0.5) - uBoard * 0.5;
    float along = cq.x > cq.y ? p.y + (p.x > uBoard.x * 0.5 ? 100.0 : 0.0) : p.x + (p.y > uBoard.y * 0.5 ? 200.0 : 300.0);
    float per = 1.45;
    float base = floor(along / per);
    for (int k = -1; k <= 1; k++) {
      float cid = base + float(k);
      vec3 h = hash32(vec2(cid, 17.0));
      float a0 = (cid + 0.5 + (h.x - 0.5) * 0.5) * per;
      float len = 2.2 + 2.0 * h.y;
      float lean = (h.z - 0.5) * 0.9;
      float curl = (fract(h.x * 7.0) - 0.5) * 0.35;
      float u = e + 0.05;
      float v = along - a0 - lean * u - curl * u * u;
      float tt = u / len;
      if (tt > 0.0 && tt < 1.0) {
        float W = 0.42 * pow(sin(PI * min(tt * 1.1, 1.0)), 0.7) * (1.0 - 0.3 * tt);
        float av = abs(v);
        float ph = u * 7.5 - av * 4.0;
        float seg = abs(fract(ph) - 0.5);
        float leaflet = smoothstep(0.06, 0.14, seg) * (1.0 - smoothstep(W - 0.04, W, av));
        float stem = 1.0 - smoothstep(0.018, 0.035, av);
        float m = max(leaflet, stem);
        if (m > 0.01) {
          float pulse = 0.55 + 0.45 * sin(u * 3.0 - t * 1.6 + cid * 1.7);
          vec3 gc = mix(vec3(0.1, 0.95, 0.9), vec3(1.0, 0.3, 0.9), smoothstep(0.3, 1.0, tt));
          float rim = smoothstep(W * 0.55, W, av) + stem;
          alb = mix(alb, srgb(vec3(0.05, 0.2, 0.22)) * (0.7 + 0.6 * (1.0 - seg * 2.0)), m);
          nrm = mix(nrm, vec2(0.0), m);
          emit = mix(emit, gc * (0.12 + 0.9 * rim * pulse * (0.3 + 0.7 * tt)), m);
        }
      }
    }
  }
  Surf s; s.alb = alb; s.h = 0.0; s.nrm = vec2(0.0); s.spec = 0.2; s.gloss = 30.0; s.emit = emit;
  vec3 col = light(s, normalize(vec3(-nrm, 1.0)), vis * frameShadowVis(p));
  col *= mix(0.6, 1.0, smoothstep(0.0, 0.3, e));
  // far out the ground falls away into violet dusk sky with the gas giant
  float sky = smoothstep(3.5, 8.0, e);
  vec3 dusk = mix(srgb(vec3(0.12, 0.05, 0.2)), srgb(vec3(0.03, 0.015, 0.07)), smoothstep(3.0, 16.0, e));
  dusk += starfield(p, fw, 0.22, 0.0) * smoothstep(6.0, 14.0, e);
  col = mix(col, dusk, sky);
  vec3 es = cornerSpot(1.0, 1.3, uBorder);
  vec4 gg = gasGiant(p, es, fw);
  col = col * (1.0 - gg.a) + gg.rgb;
  return col;
}
`;
