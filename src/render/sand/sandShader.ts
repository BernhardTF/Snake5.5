// Sand surface shader: one source, specialised per biome with #define BIOME.
import * as THREE from 'three';
import { NOISE_GLSL } from '../glsl/noise';

export const MAX_CENTERS = 24;

export const SAND_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Shared GLSL: sea colour (used by lagoon sand + frame). */
export const SEA_GLSL = /* glsl */ `
// Shallow water over sand. edgeN = distance behind the leading edge (> 0 = under water).
vec3 waterShade(vec3 under, vec2 p, float edgeN, float t, float sheet, vec3 amb, vec3 sunC, vec3 L, vec3 zen, vec3 hor) {
  float cover = smoothstep(-0.02, 0.04, edgeN);
  float depth = clamp(edgeN / 3.5, 0.0, 1.0);
  vec3 g = gnoised(p * vec2(1.3, 2.4) + vec2(t * 0.3, t * 0.55));
  vec3 g2 = gnoised(p * vec2(3.1, 5.3) - vec2(t * 0.5, t * 0.8));
  vec3 wn = normalize(vec3(-(g.yz * 0.07 + g2.yz * 0.035) * (0.3 + depth), 1.0));
  vec3 vc = voronoi(p * 2.2 + vec2(t * 0.2, t * 0.35) + g.yz * 0.25, 1.0);
  float caus = (1.0 - smoothstep(0.0, 0.16, vc.x)) * (1.0 - depth) * smoothstep(0.1, 0.6, edgeN);
  vec3 absorb = mix(vec3(0.88, 0.98, 0.97), vec3(0.25, 0.62, 0.6), smoothstep(0.0, 0.8, depth));
  vec3 c = under * absorb + sunC * caus * 0.035;
  vec3 deep = vec3(0.01, 0.16, 0.17) * (amb * 1.5 + sunC * 0.45);
  c = mix(c, deep, smoothstep(0.25, 1.0, depth) * 0.9);
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), wn);
  float up = clamp(R.z, 0.0, 1.0);
  vec3 sky = mix(hor, zen, 0.5 * pow(up, 2.0));
  float fres = 0.03 + 0.08 * depth + 0.9 * pow(1.0 - up, 2.0);
  c = mix(c, sky, clamp(fres, 0.0, 0.5));
  c += sunC * (pow(max(dot(R, L), 0.0), 60.0) * 1.2 + pow(max(dot(R, L), 0.0), 8.0) * 0.06);
  // foam: crisp leading line + bubbly lace trailing behind it
  vec3 vf = voronoi(p * vec2(5.0, 7.0) + vec2(0.0, t * 0.12) + g.yz * 0.15, 1.0);
  float bubbles = smoothstep(0.18, 0.42, vf.z);
  float blot = smoothstep(0.35, 0.7, fbm3(p * vec2(1.6, 3.2) + vec2(t * 0.15, -t * 0.25)));
  float lace = bubbles * blot;
  float line = exp(-sq((edgeN - 0.04) / 0.05)) * (0.8 + 0.2 * g2.x);
  float foam = max(line, lace * exp(-max(edgeN, 0.0) / 0.45) * smoothstep(-0.02, 0.1, edgeN));
  vec3 foamC = vec3(0.96, 0.95, 0.93) * (amb * 1.4 + sunC * max(L.z, 0.25) * 0.9);
  c = mix(c, foamC, clamp(foam, 0.0, 1.0));
  float a = cover * mix(sheet, 1.0, smoothstep(0.3, 1.5, edgeN));
  a = max(a, clamp(line, 0.0, 1.0) * sheet);
  return mix(under, c, a);
}
`;

export const SAND_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
uniform sampler2D uDeform;
uniform vec4 uRegion;
uniform vec2 uTexel;
uniform sampler2D uShadow;
uniform sampler2D uCookie;
uniform vec4 uCookieRegion;
uniform vec2 uBoard;
uniform float uTime;
uniform float uDepth;
uniform float uPatAmp;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uColA, uColB, uColC;
uniform vec4 uCenters[${MAX_CENTERS}];
uniform int uCenterCount;
uniform vec4 uWave;
uniform vec2 uWind;
uniform vec3 uAurora;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uFrameH;
uniform int uDebug;
${NOISE_GLSL}
float sq(float x) { return x * x; }
${SEA_GLSL}

// ------------------------------------------------------------ biome patterns (0..1-ish)
#if BIOME == 0
#define RAKE_F 3.4
#define RING_F 2.9
float gFw = 0.0; // world units per pixel (set in main) for pattern anti-aliasing
float rakeProf(float v, float F) {
  float s = abs(fract(v) - 0.5) * 2.0;           // 0 at tine groove, 1 at crest
  s = (sqrt(s * s + 0.015) - 0.1225) / 0.885;    // round the tine bottom (no hard cusp)
  float h = 1.0 - pow(max(1.0 - s, 0.0), 2.2);   // narrow rounded groove, broad crest
  // band-limit: blend to a sine near the pixel scale, then fade toward the mean
  float k = F * gFw;
  h = mix(h, 0.5 + 0.5 * cos(6.2831853 * v), smoothstep(0.1, 0.22, k));
  return mix(h, 0.6, smoothstep(0.28, 0.45, k));
}
vec2 pattern(vec2 p, vec4 nc) {
  float wob = 0.05 * sin(p.x * 0.55 + 1.3 * sin(p.y * 0.19)) + 0.1 * (vnoise(p * 0.3) - 0.5);
  float v = (p.y + wob) * RAKE_F;
  float id = floor(v);
  float amp = 0.82 + 0.3 * vnoise(vec2(p.x * 0.45, id * 3.1));
  float h = rakeProf(v, RAKE_F) * amp;
  if (nc.w > 0.0) {
    float d = length(p - nc.xy);
    float r0 = nc.z + 0.1;
    float span = nc.w / RING_F;
    float wr = 1.0 - smoothstep(r0 + span - 0.05, r0 + span + 0.07, d);
    float ringv = (d - r0) * RING_F + 0.03 * sin(atan(p.y - nc.y, p.x - nc.x) * 3.0);
    float rings = d < r0 ? 1.0 : rakeProf(ringv, RING_F) * 0.95;
    h = mix(h, rings, wr);
  }
  return vec2(h, 0.0);
}
#elif BIOME == 1
vec2 pattern(vec2 p, vec4 nc) {
  vec2 wd = normalize(uWind);
  vec2 pr = vec2(-wd.y, wd.x);
  float warp = 0.6 * vnoise(p * 0.22) + 0.25 * vnoise(p * 0.8 + 3.0);
  float v = dot(p, wd) * 1.6 + warp * 1.8 + 0.35 * sin(dot(p, pr) * 0.45) + 0.6 * vnoise(p * vec2(0.9, 0.3));
  float t = fract(v);
  // gentle concave stoss, sharp crest line, steeper lee
  float h = t < 0.64 ? pow(t / 0.64, 1.35) : pow((1.0 - t) / 0.36, 0.75);
  float amp = 0.45 + 0.6 * smoothstep(0.2, 0.8, vnoise(p * 0.3 + 9.0));
  // second, finer ripple set crossing at an angle
  float v2 = dot(p, normalize(wd + pr * 0.9)) * 3.6 + warp * 2.0;
  float h2 = 0.5 + 0.5 * sin(v2 * 6.2831);
  float dune = fbm3(p * 0.07 + 2.0);
  return vec2(h * amp + h2 * 0.12, dune * 34.0);
}
#elif BIOME == 2
vec2 pattern(vec2 p, vec4 nc) {
  float warp = 0.9 * vnoise(p * 0.25) + 0.3 * vnoise(p * 0.7 + 4.0);
  float v = p.y * 1.45 + warp + 0.3 * sin(p.x * 0.7);
  float h = 1.0 - pow(abs(sin(3.14159 * v)), 1.3);
  float fine = vnoise(p * vec2(1.2, 5.0));
  return vec2(h * (0.75 + 0.35 * vnoise(p * 0.4)) + fine * 0.15, fbm3(p * 0.08) * 2.5);
}
#elif BIOME == 3
vec2 pattern(vec2 p, vec4 nc) {
  float warp = 0.7 * vnoise(p * 0.2);
  float v = dot(p, vec2(0.6, 0.8)) * 1.2 + warp;
  float t = fract(v);
  float h = smoothstep(0.0, 1.0, t < 0.7 ? t / 0.7 : (1.0 - t) / 0.3);
  float lumps = vnoise(p * 3.0) * 0.35;
  return vec2(h * 0.45 + lumps, fbm3(p * 0.07) * 3.0);
}
#else
// salar: the polygon rim pattern is evaluated once in main() with an analytic gradient
vec3 gVor = vec3(1.0); vec2 gVorG = vec2(0.0);
vec2 pattern(vec2 p, vec4 nc) {
  float micro = vnoise(p * 4.0) * 0.12;
  return vec2(micro, fbm3(p * 0.09) * 0.6);
}
float salarRim(float ed) { return exp(-sq(ed / 0.045)) + 0.35 * exp(-sq(ed / 0.12)); }
float salarRimD(float ed) {
  return exp(-sq(ed / 0.045)) * (-2.0 * ed / (0.045 * 0.045)) + 0.35 * exp(-sq(ed / 0.12)) * (-2.0 * ed / (0.12 * 0.12));
}
#endif

vec3 gCrack = vec3(1.0);
vec3 skyReflect(vec3 R, vec3 L) {
  float up = clamp(R.z, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(up, 0.6));
  float s = max(dot(R, L), 0.0);
  c += uSunColor * (pow(s, 12.0) * 0.5 + pow(s, 200.0) * 4.0);
  return c;
}

#if BIOME == 1
#define GRAIN_MIX 0.45
#elif BIOME == 4
#define GRAIN_MIX 0.5
#elif BIOME == 2
#define GRAIN_MIX 0.7
#else
#define GRAIN_MIX 1.0
#endif
vec3 sampleAlbedo(vec2 p, float fw, float dist, float heightN) {
  // multi-scale grain colour with anti-aliasing fade
  float mottle = fbm3(p * 0.9);
  vec3 base = mix(uColA * 0.94, uColA * 1.05, mottle);
  float F = 21.0;
  vec2 gp = p * F;
  vec3 gh = hash32(floor(gp));
  float gfade = 1.0 - smoothstep(0.4, 1.0, F * fw);
  vec3 grain = gh.x > 0.8 ? uColB : (gh.x < 0.1 ? mix(base, uColC, 0.7) : base);
  float F2 = 9.0;
  vec3 gh2 = hash32(floor(p * F2 + 0.5));
  float gfade2 = 1.0 - smoothstep(0.3, 0.8, F2 * fw);
  vec3 grain2 = gh2.y > 0.93 ? uColC : (gh2.y < 0.06 ? uColB : base);
  vec3 avg = base * 0.9 + uColB * 0.06 + uColC * 0.04;
  vec3 c = mix(avg, grain, gfade * 0.4 * GRAIN_MIX);
  c = mix(c, grain2, gfade2 * 0.18 * GRAIN_MIX);
  return c;
}

void main() {
  vec2 p = vP;
  float fw = max(fwidth(p.x), 1e-4);
#if BIOME == 0
  gFw = fw;
#endif
  vec2 duv = (p - uRegion.xy) / uRegion.zw;
  vec3 L = normalize(uSunDir);

  // ---------------------------------------------------------------- nearest ring centre
  vec4 nc = vec4(0.0);
  float best = 1e9;
  for (int i = 0; i < ${MAX_CENTERS}; i++) {
    if (i >= uCenterCount) break;
    vec4 c = uCenters[i];
    float d = length(p - c.xy) - c.z;
    if (d < best) { best = d; nc = c; }
  }
#if BIOME != 0
  nc.w = 0.0;
#endif

  // ---------------------------------------------------------------- deformation taps
  vec4 D = texture2D(uDeform, duv);
  vec2 tx = vec2(uTexel.x, 0.0), ty = vec2(0.0, uTexel.y);
  vec4 De = texture2D(uDeform, duv + tx), Dw = texture2D(uDeform, duv - tx);
  vec4 Dn = texture2D(uDeform, duv + ty), Ds = texture2D(uDeform, duv - ty);
  float tw = uRegion.z * uTexel.x; // world units per texel
  vec2 dR = vec2(De.r - Dw.r, Dn.r - Ds.r) / (2.0 * tw);
  vec2 dG = vec2(De.g - Dw.g, Dn.g - Ds.g) / (2.0 * tw);
  // cavity: compare with a wider neighbourhood
  vec2 wx = tx * 9.0, wy = ty * 9.0;
  float wideR = 0.25 * (texture2D(uDeform, duv + wx).r + texture2D(uDeform, duv - wx).r
                      + texture2D(uDeform, duv + wy).r + texture2D(uDeform, duv - wy).r);
  float cavity = D.r - wideR;
  float G = clamp(D.g, 0.0, 1.0);
  float keep = 1.0 - G;

  // ---------------------------------------------------------------- pattern + gradient
  float e = 0.012;
  vec2 P0 = pattern(p, nc);
  vec2 Px = pattern(p + vec2(e, 0.0), nc);
  vec2 Py = pattern(p + vec2(0.0, e), nc);
  float h0 = P0.x;
  vec2 dHi = vec2(Px.x - P0.x, Py.x - P0.x) / e;
  vec2 dLo = vec2(Px.y - P0.y, Py.y - P0.y) / e;
#if BIOME == 4
  gVor = voronoiG(p * 0.62, 0.9, gVorG);
  {
    float rimV = salarRim(gVor.x) * 0.9 - 0.25 * gVor.z;
    vec2 cellDir = vec2(0.0); // dome slope is tiny; ignore its gradient
    dHi += salarRimD(gVor.x) * 0.9 * gVorG * 0.62;
    h0 += rimV;
  }
#endif
  vec2 grad = uPatAmp * (keep * dHi - (h0 - 0.5) * dG + dLo) + uDepth * dR;

  // ---------------------------------------------------------------- micro grain normals (AA)
  float F1 = 16.0, F2 = 37.0;
  vec3 g1 = gnoised(p * F1);
  vec3 g2 = gnoised(p * F2 + 7.3);
  float a1 = 1.0 - smoothstep(0.35, 0.9, F1 * fw);
  float a2 = 1.0 - smoothstep(0.35, 0.9, F2 * fw);
  float grainAmp = 0.0028;
#if BIOME == 3
  grainAmp = 0.0045;
#elif BIOME == 4
  grainAmp = 0.0016;
#endif
  grad += (g1.yz * F1 * a1 + g2.yz * F2 * a2 * 0.6) * grainAmp;

  vec3 N = normalize(vec3(-grad, 1.0));

  // ---------------------------------------------------------------- albedo
  vec3 alb = sampleAlbedo(p, fw, 0.0, h0);
  // trail interior: compacted, slightly darker / smoother
  float groove = (1.0 - smoothstep(-0.6, -0.05, D.r));
  float berm = smoothstep(0.02, 0.3, D.r);
#if BIOME == 0
  alb *= 1.0 - 0.06 * groove;
  alb *= 1.0 + 0.03 * berm;
#elif BIOME == 1
  alb *= 1.0 - 0.05 * groove;
  // drifting sand streaks (wind)
  vec2 wd = normalize(uWind);
  vec2 pr = vec2(-wd.y, wd.x);
  float st = vnoise(vec2(dot(p, wd) * 0.35 - uTime * 0.9, dot(p, pr) * 5.0));
  st *= vnoise(vec2(dot(p, wd) * 0.12 - uTime * 0.35, dot(p, pr) * 0.5));
  float streak = smoothstep(0.3, 0.6, st);
  alb = mix(alb, uColB * 1.05, streak * 0.16);
  alb *= 0.93 + 0.12 * smoothstep(0.35, 0.75, fbm3(p * 0.055 + 2.0));
#elif BIOME == 2
  float wetBase = 0.55 + 0.45 * smoothstep(uBoard.y * 0.1, uBoard.y * 1.05, p.y);
  float wet = clamp(wetBase * 0.6 + D.b * 0.8, 0.0, 1.0);
  alb *= mix(1.0, 0.62, wet);
  alb *= 1.0 - 0.06 * groove;
#elif BIOME == 3
  // olivine + grey grit
  vec3 og = hash32(floor(p * 22.0) + 3.0);
  float ofade = 1.0 - smoothstep(0.25, 0.7, 22.0 * fw);
  alb = mix(alb, vec3(0.08, 0.13, 0.06), step(0.955, og.z) * ofade * 0.8);
  // cracked crust where disturbed
  vec3 cr = voronoi(p * 3.4, 0.85);
  gCrack = cr;
  float crack = (1.0 - smoothstep(0.015, 0.06, cr.x)) * smoothstep(0.15, 0.6, G);
  alb *= 1.0 - 0.55 * crack;
  alb *= mix(1.0, 0.55 + 0.3 * cr.y, G);
#elif BIOME == 4
  vec3 vv = gVor;
  float rim = exp(-sq(vv.x / 0.05));
  alb *= 0.96 + 0.06 * rim;
  float moist = D.b;
  alb = mix(alb, alb * vec3(0.3, 0.32, 0.36), moist * (1.0 - rim * 0.3));
  alb = mix(alb, alb * 0.9, groove * 0.4);
#endif

  // ---------------------------------------------------------------- shadows & occlusion
  vec2 sh = texture2D(uShadow, duv).rg;
  float sunVis = 1.0 - 0.82 * sh.r;
  float ao = 1.0 - 0.5 * sh.g;
  ao *= clamp(1.0 + cavity * 0.6, 0.55, 1.15);
  sunVis *= 1.0 - 0.08 * groove;
  // height-field self shadow from the deformation (grooves / berms) toward the sun
  {
    vec2 ldir = normalize(L.xy);
    float tanE = L.z / max(length(L.xy), 1e-3);
    float hC = D.r * uDepth;
    float occ = 0.0;
    for (int k = 1; k <= 5; k++) {
      float t = float(k) * 0.055;
      float hS = texture2D(uDeform, duv + ldir * t / uRegion.zw).r * uDepth;
      occ = max(occ, hS - (hC + t * tanE));
    }
    sunVis *= 1.0 - 0.72 * smoothstep(0.0, 0.05, occ);
  }
  // frame: the sand sits below the frame lip -> rim shadow toward the sun + ambient occlusion
  vec2 ps = p + L.xy / max(L.z, 0.2) * uFrameH;
  float inside = min(min(ps.x, uBoard.x - ps.x), min(ps.y, uBoard.y - ps.y));
  sunVis *= smoothstep(-0.06, 0.1, inside);
  float edge = min(min(p.x, uBoard.x - p.x), min(p.y, uBoard.y - p.y));
  ao *= mix(0.55, 1.0, smoothstep(0.0, 0.6, edge));
  // foliage cookie
  vec2 cuv = (p - uCookieRegion.xy) / uCookieRegion.zw;
  float gust = 0.6 + 0.4 * sin(uTime * 0.23);
  vec2 swayA = vec2(sin(uTime * 0.9 + p.y * 0.3), cos(uTime * 0.7 + p.x * 0.25)) * 0.07 * gust
             + vec2(sin(uTime * 0.31), cos(uTime * 0.27)) * 0.12;
  vec2 swayB = vec2(sin(uTime * 0.6 + p.x * 0.2 + 1.0), cos(uTime * 0.5 + p.y * 0.2)) * 0.1 * gust;
  float leafA = texture2D(uCookie, cuv + swayA / uCookieRegion.zw).r;
  float leafB = texture2D(uCookie, cuv + swayB / uCookieRegion.zw).g;
  float leaf = max(leafA, leafB * 0.8);
  sunVis *= 1.0 - 0.8 * leaf;
#if BIOME == 4
  float cloud = smoothstep(0.5, 0.75, fbm3(p * 0.045 + uTime * vec2(0.012, 0.005)));
  sunVis *= 1.0 - 0.4 * cloud;
#endif

  // ---------------------------------------------------------------- lighting
  float NdL = dot(N, L);
  float wrap = 0.04;
  float diff = max((NdL + wrap) / (1.0 + wrap), 0.0);
  vec3 amb = mix(uGroundColor, uSkyColor, N.z * 0.5 + 0.5);
#if BIOME == 3
  // aurora light bands drifting across
  float band = pow(0.5 + 0.5 * sin(p.x * 0.2 + p.y * 0.07 + fbm3(p * 0.05 + uTime * 0.02) * 6.0 + uTime * 0.12), 9.0);
  band *= 0.5 + 0.5 * fbm3(vec2(p.x * 0.1, p.y * 0.4) + uTime * 0.05);
  amb += uAurora * (0.25 + 0.6 * band);
#endif
  vec3 col = alb * (uSunColor * diff * sunVis + amb * ao);

  // sparkle glints (hash-per-grain facet, near view-independent)
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Hh = normalize(L + V);
  float SF = 30.0;
  vec3 sp = hash32(floor(p * SF) + 11.0);
  float sfade = 1.0 - smoothstep(0.4, 1.0, SF * fw);
  vec2 sc = fract(p * SF) - 0.5;
  float spot = 1.0 - smoothstep(0.1, 0.35, length(sc));
  vec3 fn = normalize(N + (sp - 0.5) * 0.9);
  float glint = pow(max(dot(fn, Hh), 0.0), 60.0) * step(0.9, sp.z) * spot * sfade;
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + sp.x * 40.0);
  float sparkAmt = 0.0;
#if BIOME == 0
  sparkAmt = 2.0;
#elif BIOME == 1
  sparkAmt = 1.2;
#elif BIOME == 2
  sparkAmt = 1.5;
#elif BIOME == 3
  sparkAmt = 1.2;
#else
  sparkAmt = 3.0;
#endif
  col += uSunColor * glint * twinkle * sparkAmt * sunVis * keep;

  // ---------------------------------------------------------------- biome specials
#if BIOME == 2
  {
    // wet sand: mirror-ish sky reflection driven by ripple normals + sun sheen
    vec3 Rv = reflect(-V, N);
    vec3 refl = mix(uHorizon * 1.05, uZenith, 0.3 * Rv.z) + uSunColor * pow(max(dot(Rv, L), 0.0), 10.0) * 0.6;
    float fres = mix(0.05, 0.38, wet);
    col = mix(col, refl, fres);
    float spec = pow(max(dot(N, Hh), 0.0), mix(14.0, 40.0, wet)) * mix(0.1, 0.9, wet);
    col += uSunColor * spec * sunVis * 0.5;
    // residual foam lace
    vec3 lv = voronoi(p * vec2(4.5, 6.5), 0.9);
    float lace = 1.0 - smoothstep(0.02, 0.08, lv.x);
    col = mix(col, vec3(0.95, 0.93, 0.9) * (amb * 1.3 + uSunColor * 0.5), clamp(D.a, 0.0, 1.0) * lace * 0.7);
    // water sheet (idle swash + surges)
    float dd = p.y - uWave.x;
    if (dd > -0.4) {
      float wn = gnoise(p * vec2(0.6, 1.8) + uTime * 0.3);
      float edgeN = dd + wn * 0.14 + 0.07 * sin(p.x * 1.3 + uTime * 1.1);
      col = waterShade(col, p, edgeN, uTime, clamp(uWave.z, 0.0, 1.0), amb, uSunColor, L, uZenith, uHorizon);
    }
  }
#elif BIOME == 3
  {
    float heat = D.b;
    vec3 cr2 = gCrack;
    float crackE = 1.0 - smoothstep(0.0, 0.08, cr2.x);
    float pore = smoothstep(0.75, 0.95, vnoise(p * 11.0 + cr2.y * 7.0));
    float glowMask = crackE * 1.0 + pore * 0.35 * groove + 0.05 * groove * heat * heat;
    vec3 hot = mix(vec3(0.8, 0.1, 0.015), vec3(1.0, 0.55, 0.16), heat * heat);
    float flick = 0.8 + 0.2 * sin(uTime * 2.3 + cr2.y * 30.0);
    col += hot * pow(heat, 1.5) * glowMask * 5.0 * flick;
    // aurora sheen on the glassy basalt grains
    col += uAurora * band * 0.12 * pow(max(N.z, 0.0), 8.0);
    // obsidian-like faint sheen
    col += uSkyColor * pow(max(dot(N, Hh), 0.0), 40.0) * 0.15;
  }
#elif BIOME == 4
  {
    // thin water film mirroring the sky (clouds drift in the reflection)
    vec3 vv2 = gVor;
    float rimH = exp(-sq(vv2.x / 0.07));
    float film = smoothstep(0.36, 0.56, fbm3(p * 0.1 + 5.0)) * (1.0 - rimH * 0.85);
    film = mix(film, 0.12, D.b);
    vec3 Rv = reflect(-V, N);
    vec3 skyR = skyReflect(Rv, L);
    vec2 rp = p * 0.05 + Rv.xy * 0.8 + uTime * vec2(0.008, 0.003);
    float clouds = smoothstep(0.42, 0.78, fbm(rp * 2.0));
    skyR = mix(skyR, vec3(1.0, 1.0, 1.03) * 1.25, clouds * 0.8);
    col = mix(col, skyR, film * 0.8);
    float spec = pow(max(dot(N, Hh), 0.0), 220.0) * film;
    col += uSunColor * spec * 2.0 * sunVis;
  }
#endif

  gl_FragColor = vec4(col, 1.0);
  if (uDebug == 1) gl_FragColor = vec4(vec3(leaf), 1.0);
  else if (uDebug == 2) gl_FragColor = vec4(sh, 0.0, 1.0);
  else if (uDebug == 3) gl_FragColor = vec4(-D.r, D.g, max(D.r, 0.0) * 3.0, 1.0);
  else if (uDebug == 4) gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeSandMaterial(biome: number, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: SAND_VERT,
    fragmentShader: SAND_FRAG,
    uniforms,
    defines: { BIOME: biome },
    toneMapped: true,
  });
}
