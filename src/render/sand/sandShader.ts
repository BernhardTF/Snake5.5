// Sand surface shader: one source, specialised per biome with #define BIOME.
import * as THREE from 'three';
import { NOISE_GLSL } from '../glsl/noise';
import { WORLDS_GLSL } from '../glsl/worlds';

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
  // soft caustics from two drifting ridged noises (no cell pattern)
  float c1 = 1.0 - abs(gnoise(p * 1.9 + g.yz * 0.35 + vec2(t * 0.21, t * 0.33)));
  float c2 = 1.0 - abs(gnoise(p * 2.7 - g.yz * 0.3 + vec2(-t * 0.17, t * 0.29) + 5.1));
  float caus = pow(c1 * c2, 6.0) * (1.0 - depth) * smoothstep(0.1, 0.6, edgeN);
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
  // foam: shore-break whitewater + thin lacy streaks that run along the wave fronts.
  // Coordinates are stretched along the shoreline (x) and compressed across it (edge distance),
  // so ridges of the noise read as foam lines following the swash; density falls off offshore.
  float e = max(edgeN, 0.0);
  vec2 fq = vec2(p.x * 0.55, e * 2.6 - t * 0.35);
  vec2 fw = vec2(gnoise(fq * 1.3 + vec2(3.7, t * 0.12)), gnoise(fq * 1.1 - vec2(1.9, t * 0.1))) * 0.55;
  float r1 = 1.0 - abs(gnoise(fq + fw));
  float r2 = 1.0 - abs(gnoise(fq * vec2(2.1, 1.7) - fw * 1.3 + 7.3));
  float r3 = 1.0 - abs(gnoise(fq * vec2(4.3, 3.1) + fw * 2.0 + 13.1));
  float dens = exp(-e / 0.55);                                   // dense at the shore break
  float band = exp(-sq((e - 1.6 - 0.25 * sin(t * 0.4)) / 0.5)) * 0.45; // an offshore breaker line
  float thick = 0.03 + 0.09 * dens + 0.04 * band;
  float lace = smoothstep(1.0 - thick, 1.0 - thick * 0.25, r1) * (0.55 + 0.45 * dens)
             + smoothstep(1.0 - thick * 0.8, 1.0 - thick * 0.2, r2) * (0.35 + 0.5 * dens)
             + smoothstep(1.0 - thick * 0.6, 1.0, r3) * dens * 0.5;
  // break the lines up so they fade into patches and streaks
  float patchy = smoothstep(0.3, 0.75, fbm3(vec2(p.x * 0.35, e * 0.9) + vec2(t * 0.05, -t * 0.12)));
  lace *= mix(patchy, 1.0, dens * 0.6) * clamp(dens + band + 0.08, 0.0, 1.0);
  float white = exp(-e / 0.16) * (0.65 + 0.35 * r2);            // churned whitewater right at the edge
  float line = exp(-sq((edgeN - 0.04) / 0.045)) * (0.8 + 0.2 * r1);
  float foam = max(max(line, white), clamp(lace, 0.0, 1.0)) * smoothstep(-0.02, 0.06, edgeN);
  foam = max(foam, line * 0.9);
  vec3 foamC = vec3(0.96, 0.95, 0.93) * (amb * 1.4 + sunC * max(L.z, 0.25) * 0.9);
  c = mix(c, foamC, clamp(foam, 0.0, 1.0));
  float a = cover * mix(sheet, 1.0, smoothstep(0.3, 1.5, edgeN));
  a = max(a, clamp(line, 0.0, 1.0) * sheet);
  return mix(under, c, a);
}
`;

/** Shared GLSL: calm shore water over the ground (pinksands shallows, vaadhoo night sea, pools).
 *  Physically-flavoured: under * exp(-absorb * depth) + in-scattered light. Needs NOISE_GLSL + sq().
 *  edgeN = distance behind the waterline (> 0 = under water); dK = optical depth per world unit;
 *  foamK scales the thin swash lace; glowC is added where there is foam (bioluminescence). */
export const SHORE_GLSL = /* glsl */ `
vec3 shoreWater(vec3 under, vec2 p, float edgeN, float t, vec3 amb, vec3 sunC, vec3 L, vec3 zen, vec3 hor,
                vec3 absorb, vec3 scatter, float dK, float foamK, vec3 glowC) {
  float e = max(edgeN, 0.0);
  float cover = smoothstep(-0.015, 0.05, edgeN);
  float calm = smoothstep(0.0, 0.9, e);
  vec3 g = gnoised(p * vec2(1.1, 1.9) + vec2(t * 0.22, t * 0.4));
  vec3 g2 = gnoised(p * vec2(2.9, 4.6) - vec2(t * 0.45, t * 0.3));
  vec3 wn = normalize(vec3(-(g.yz * 0.05 + g2.yz * 0.028) * (0.35 + 0.65 * calm), 1.0));
  float od = e * dK;
  // caustic net on the bottom (strongest in the sunny shallows)
  float c1 = 1.0 - abs(gnoise(p * 2.1 + g.yz * 0.35 + vec2(t * 0.21, t * 0.33)));
  float c2 = 1.0 - abs(gnoise(p * 2.9 - g.yz * 0.3 + vec2(-t * 0.17, t * 0.29) + 5.1));
  float caus = pow(c1 * c2, 5.0) * smoothstep(0.05, 0.5, e) * exp(-od * 0.7);
  vec3 light = sunC * max(L.z, 0.0) + amb;
  vec3 c = under * exp(-absorb * od) * (1.0 + 1.5 * caus) + scatter * light * (1.0 - exp(-od * 1.6));
  // surface: sky reflection (top-down -> small), sun highlight and glitter on the fine chop
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), wn);
  float up = clamp(R.z, 0.0, 1.0);
  vec3 sky = mix(hor, zen, pow(up, 1.5));
  float fres = 0.03 + 0.97 * pow(1.0 - up, 5.0);
  c = mix(c, sky, clamp(fres + 0.03 * calm, 0.0, 0.6));
  float sp = max(dot(R, L), 0.0);
  c += sunC * (pow(sp, 90.0) * 1.5 + pow(sp, 10.0) * 0.03);
  vec3 g3 = gnoised(p * 6.0 + vec2(t * 0.9, -t * 0.7));
  vec3 Ng = normalize(vec3(-(g3.yz * 0.16 + g.yz * 0.1), 1.0));
  vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
  float glit = pow(max(dot(Ng, Hh), 0.0), 2500.0) * smoothstep(0.2, 0.9, e)
             * smoothstep(0.45, 0.8, vnoise(p * 0.6 + vec2(t * 0.1, 0.0)));
  c += sunC * glit * 2.5;
  // swash lace: a thin foam line on the waterline + a few bubbly streaks right behind it
  float line = exp(-sq((edgeN - 0.03) / 0.035));
  vec2 fq = vec2(p.x * 0.8, e * 3.2 - t * 0.25);
  float r1 = 1.0 - abs(gnoise(fq + vec2(gnoise(fq * 1.3 + 3.7), 0.0) * 0.5));
  float r2 = 1.0 - abs(gnoise(fq * vec2(2.3, 1.9) + 9.1));
  float lace = (smoothstep(0.9, 0.97, r1) + 0.6 * smoothstep(0.93, 0.99, r2)) * exp(-e / 0.4);
  float foam = clamp((line * (0.65 + 0.35 * r1) + lace * 0.8) * foamK, 0.0, 1.0) * smoothstep(-0.02, 0.04, edgeN);
  vec3 fc = vec3(0.97, 0.97, 0.95) * (amb * 1.3 + sunC * max(L.z, 0.25) * 0.9);
  c = mix(c, fc, foam);
  c += glowC * foam;
  float a = cover * mix(0.55, 1.0, smoothstep(0.0, 0.35, edgeN));
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
uniform vec3 uSun2Dir;
uniform vec3 uSun2Color;
uniform vec4 uDevils[2];
uniform float uShadowK;
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
${SHORE_GLSL}
${WORLDS_GLSL}
float gWet = 0.0;

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
#elif BIOME == 4
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
#elif BIOME == 5
// pink sands: wrack lines left by the highest swash, parallel to the shore (top side)
float pinkSwash(vec2 p) {
  float dy = uBoard.y - p.y;
  float sm = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float y0 = 3.05 + fk * 0.8 + 0.35 * sin(p.x * (0.21 + 0.05 * fk) + fk * 2.0) + 0.3 * (vnoise(vec2(p.x * 0.4, fk * 7.0)) - 0.5);
    sm += exp(-sq((dy - y0) / (0.06 + 0.02 * fk))) * (0.75 - 0.2 * fk) * smoothstep(0.2, 0.55, vnoise(vec2(p.x * 0.35 + fk * 5.0, fk)));
  }
  return sm;
}
vec2 pattern(vec2 p, vec4 nc) {
  // fine, soft beach sand: wind-rounded lumps, faint patchy ripples, swash wrack lines
  float lumps = fbm3(p * 0.55) * 0.5 + vnoise(p * 2.3) * 0.14;
  float warp = 0.5 * vnoise(p * 0.3);
  float rip = 0.5 + 0.5 * sin((dot(p, vec2(0.28, 0.96)) * 2.1 + warp * 2.0) * 6.2831);
  rip *= 0.22 * smoothstep(0.35, 0.7, vnoise(p * 0.22 + 3.0));
  return vec2(lumps * 0.55 + rip + pinkSwash(p) * 0.35, fbm3(p * 0.08) * 3.0);
}
#elif BIOME == 6
vec2 pattern(vec2 p, vec4 nc) {
  // wet, compacted night beach: low swash ripples + backwash rills running down to the sea
  float warp = 0.6 * vnoise(p * 0.35);
  float v = dot(p, vec2(0.25, 0.97)) * 2.2 + warp * 2.4 + 0.5 * sin(p.x * 0.37 + 1.3 * vnoise(p * 0.2));
  float rip = (0.5 + 0.5 * sin(v * 6.2831)) * smoothstep(0.5, 0.85, vnoise(p * 0.22 + 2.0)) * 0.22;
  float rill = 1.0 - abs(gnoise(vec2(p.x * 1.3 + 0.7 * gnoise(p * vec2(0.5, 0.2)), p.y * 0.22)));
  rill = smoothstep(0.9, 1.0, rill) * smoothstep(5.0, 2.8, uBoard.y - p.y) * smoothstep(0.3, 0.6, vnoise(p * 0.4));
  return vec2(rip + vnoise(p * 2.0) * 0.16 + fbm3(p * 0.7) * 0.2 - rill * 0.3, fbm3(p * 0.09) * 2.0);
}
#elif BIOME == 7
// Dallol: brine pools (Voronoi pockets) evaluated once in main()
float gPool = 0.0, gPoolRim = 0.0, gPoolD = 0.0, gPoolType = 0.0, gPoolRing = 0.0;
float dallolTerr(vec2 p, out float lip) {
  float T = fbm3(p * 0.1 + 1.3) * 5.0 + 0.35 * vnoise(p * 0.6);
  float fr = fract(T);
  float strength = smoothstep(0.35, 0.6, fbm3(p * 0.06 + 8.0));
  lip = exp(-sq((fr - 0.9) / 0.035)) * strength;
  return (floor(T) + smoothstep(0.82, 0.95, fr)) * strength;
}
// "popcorn" crust: knobbly sulphur/salt blisters
float dallolKnob(vec2 p) {
  return sq(vnoise(p * 3.1)) * 0.65 + sq(vnoise(p * 6.7 + 2.0)) * 0.35 + vnoise(p * 13.0) * 0.08;
}
vec2 pattern(vec2 p, vec4 nc) {
  float lip;
  float st = dallolTerr(p, lip);
  float blister = pow(vnoise(p * 1.3 + 3.0), 3.0) * 0.7;
  return vec2(lip * 0.6 + dallolKnob(p) * 1.3 + blister, st * 2.4);
}
#elif BIOME == 8
// Luna: regolith clods; the crater fields are analytic (height + gradient) in main()
vec2 pattern(vec2 p, vec4 nc) {
  float clod = vnoise(p * 3.0) * 0.22 + vnoise(p * 6.5) * 0.12;
  return vec2(clod, fbm3(p * 0.1) * 2.5);
}
// one crater per cell (some empty): returns (height, dh/dx, dh/dy) in world units; rim -> gCrRim
float gCrRim = 0.0;
vec3 craterField(vec2 p, float fw, float S, float prob, float rMin, float rMax, float depthK, float rimH, float rimW, float seed) {
  vec2 cell = floor(p / S);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = cell + vec2(float(i), float(j));
    vec3 h = hash32(cc + seed);
    if (h.z > prob) continue;
    vec2 c = (cc + 0.22 + 0.56 * hash22(cc * 1.7 + seed)) * S;
    float R = S * mix(rMin, rMax, h.x * h.y);
    vec2 d = p - c;
    float dl = length(d);
    float r = dl / R;
    if (r > 2.2) continue;
    float age = fract(h.x * 7.3 + h.y * 3.1);               // most craters are old and degraded
    age = sqrt(age);
    vec2 pr = craterProf(r, rimH * (1.0 - 0.75 * age), rimW * (1.0 + age));
    float Dp = R * depthK * mix(1.0, 0.3, age) * smoothstep(1.2, 3.0, R / fw); // band-limit: fade sub-pixel craters
    acc.x += pr.x * Dp;
    acc.yz += pr.y * Dp / R * d / max(dl, 1e-4);
    gCrRim = max(gCrRim, exp(-sq((r - 1.0) / 0.25)) * (1.0 - age));
  }
  return acc;
}
vec4 bigCrater(int k) {
  // x, y (board fraction), radius (cells), age (0 = fresh, 1 = old & soft)
  if (k == 0) return vec4(0.2, 0.3, 2.5, 0.9);
  if (k == 1) return vec4(0.77, 0.68, 3.1, 1.0);
  if (k == 2) return vec4(0.56, 0.17, 1.35, 0.2);
  if (k == 3) return vec4(0.09, 0.82, 1.6, 0.8);
  return vec4(0.93, 0.2, 1.9, 0.95);
}
vec3 bigCraters(vec2 p) {
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 5; k++) {
    vec4 C = bigCrater(k);
    vec2 d = p - C.xy * uBoard;
    float dl = length(d);
    float R = C.z * (1.0 + 0.04 * sin(atan(d.y, d.x) * 5.0 + float(k)));
    float r = dl / R;
    if (r > 2.6) continue;
    vec2 pr = craterProf(r, mix(0.3, 0.12, C.w), mix(0.2, 0.45, C.w));
    float Dp = R * mix(0.2, 0.07, C.w);
    acc.x += pr.x * Dp;
    acc.yz += pr.y * Dp / R * d / max(dl, 1e-4);
  }
  return acc;
}
#elif BIOME == 9
vec2 pattern(vec2 p, vec4 nc) {
  // Jezero: low wind ripples of fine ochre dust
  vec2 wd = normalize(uWind);
  vec2 pr = vec2(-wd.y, wd.x);
  float warp = 0.5 * vnoise(p * 0.2) + 0.2 * vnoise(p * 0.7 + 3.0);
  float v = dot(p, wd) * 1.3 + warp * 1.6 + 0.25 * sin(dot(p, pr) * 0.4);
  float t = fract(v);
  float h = t < 0.7 ? pow(t / 0.7, 1.4) : pow((1.0 - t) / 0.3, 0.8);
  float amp = 0.3 + 0.55 * smoothstep(0.25, 0.75, vnoise(p * 0.22 + 5.0));
  return vec2(h * amp + vnoise(p * 2.6) * 0.14, fbm3(p * 0.08 + 1.0) * 5.0);
}
// scattered basalt pebbles (analytic domes): (height, grad) in world units; coverage -> gPeb
float gPeb = 0.0, gPebH = 0.0;
vec3 pebbles(vec2 p, bool track) {
  const float S = 0.62;
  vec2 cell = floor(p / S);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cc = cell + vec2(float(i), float(j));
    vec3 h = hash32(cc + 41.0);
    float dens = 0.05 + 0.33 * smoothstep(0.35, 0.85, vnoise(cc * 0.21 + 3.0));
    if (h.z > dens) continue;
    vec2 c = (cc + 0.3 + 0.4 * hash22(cc * 1.3 + 5.0)) * S;
    float R = S * (0.06 + 0.26 * h.x * h.x * h.x);
    float an = h.y * 6.2831;
    vec2 d = p - c;
    vec2 q = vec2(dot(d, vec2(cos(an), sin(an))), dot(d, vec2(-sin(an), cos(an))));
    q.x *= 0.75;
    float r2 = dot(q, q) / (R * R);
    if (r2 >= 1.0) continue;
    float k = 0.75;
    acc.x = max(acc.x, R * k * (1.0 - r2));
    // gradient of R*k*(1-r2) back in world axes
    vec2 gq = -2.0 * k / R * vec2(q.x * 0.75, q.y);
    acc.yz += vec2(gq.x * cos(an) - gq.y * sin(an), gq.x * sin(an) + gq.y * cos(an)) * smoothstep(1.0, 0.8, r2);
    if (track) { gPeb = max(gPeb, 1.0 - smoothstep(0.75, 1.0, r2)); gPebH = h.x; }
  }
  return acc;
}
#elif BIOME == 10
vec2 pattern(vec2 p, vec4 nc) {
  // Shangri-La: long linear (seif) dunes parallel to the wind, Y-junctions from a slow warp
  vec2 wd = normalize(uWind);
  vec2 pr = vec2(-wd.y, wd.x);
  float across = dot(p, pr), along = dot(p, wd);
  float warp = 1.1 * (fbm3(vec2(along * 0.045, across * 0.11)) - 0.5) + 0.25 * sin(along * 0.1);
  float t = fract(across / 3.6 + warp);
  float ridge = pow(1.0 - abs(2.0 * t - 1.0), 1.7);
  float rip = 0.5 + 0.5 * sin((dot(p, normalize(wd + pr * 0.7)) * 2.3 + vnoise(p * 0.5) * 1.5) * 6.2831);
  return vec2(rip * 0.22 * smoothstep(0.1, 0.5, ridge) + vnoise(p * 2.5) * 0.12, ridge * 16.0);
}
#elif BIOME == 11
// Kepler-186f crystal facets evaluated once in main()
vec3 gFacet = vec3(1.0);
vec2 pattern(vec2 p, vec4 nc) {
  // wind-curved crescent ripples of crystalline sand
  vec2 wd = normalize(uWind);
  vec2 pr = vec2(-wd.y, wd.x);
  float warp = 0.7 * vnoise(p * 0.2) + 0.2 * vnoise(p * 0.6);
  float v = dot(p, wd) * 1.4 + warp * 1.8 + 0.5 * sin(dot(p, pr) * 0.35);
  float t = fract(v);
  float h = t < 0.6 ? pow(t / 0.6, 1.3) : pow((1.0 - t) / 0.4, 0.8);
  float amp = 0.4 + 0.5 * smoothstep(0.2, 0.8, vnoise(p * 0.25 + 4.0));
  return vec2(h * amp + vnoise(p * 3.0) * 0.1, fbm3(p * 0.07 + 3.0) * 6.0);
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
#elif BIOME == 5 || BIOME == 11
#define GRAIN_MIX 0.8
#elif BIOME == 6 || BIOME == 10
#define GRAIN_MIX 0.5
#elif BIOME == 7
#define GRAIN_MIX 0.35
#elif BIOME == 8
#define GRAIN_MIX 0.9
#elif BIOME == 9
#define GRAIN_MIX 0.6
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
  vec2 dpx = vec2(dFdx(p.x), dFdy(p.y)); // ortho top-down: world units per pixel along x / y
#if BIOME == 7
  {
    vec3 pv = voronoi(p * 0.36 + 3.1, 0.6);
    float sel = step(pv.y, 0.27);
    float pr = 0.16 + 0.12 * fract(pv.y * 91.7);
    float pd = pv.z + 0.045 * (vnoise(p * 1.6) - 0.5) + 0.025 * (vnoise(p * 4.0) - 0.5);
    gPool = sel * (1.0 - smoothstep(pr - 0.02, pr, pd));
    gPoolRim = sel * exp(-sq((pd - pr - 0.02) / 0.03));
    gPoolD = sel * clamp((pr - pd) / pr, 0.0, 1.0);
    gPoolType = fract(pv.y * 53.3);
    // raised salt rim + concentric micro-terraces (rimstone rings) around each pool
    float out_ = max(pd - pr, 0.0);
    gPoolRing = sel * exp(-out_ / 0.09) * step(0.001, out_);
    float rimH = gPoolRim * 0.035 + gPoolRing * 0.012 * sin(out_ * 55.0);
    grad += vec2(dFdx(rimH), dFdy(rimH)) / dpx;
    grad *= 1.0 - gPool; // liquid is flat: no pattern / trail relief inside the pools
  }
#elif BIOME == 8
  vec3 bc = bigCraters(p);
  vec3 mc = craterField(p, fw, 0.55, 0.45, 0.1, 0.4, 0.4, 0.22, 0.2, 3.0)
          + craterField(p, fw, 1.3, 0.3, 0.12, 0.42, 0.34, 0.22, 0.22, 9.0)
          + craterField(p, fw, 3.2, 0.25, 0.14, 0.45, 0.22, 0.2, 0.25, 17.0);
  grad += bc.yz + mc.yz * mix(1.0, 0.25, G);
#elif BIOME == 9
  vec3 pb = pebbles(p, true);
  grad += pb.yz * keep;
#elif BIOME == 11
  gFacet = voronoi(p * 4.2, 0.9);
  grad += (hash22(vec2(gFacet.y * 71.0, 3.0)) - 0.5) * 0.14 * keep * smoothstep(0.0, 0.04, gFacet.x)
        * (1.0 - smoothstep(0.3, 0.8, 4.2 * fw));
#endif

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
#elif BIOME == 5
  grainAmp = 0.0022;
#elif BIOME == 6 || BIOME == 7
  grainAmp = 0.0018;
#elif BIOME == 8
  grainAmp = 0.0042 * (1.0 - 0.6 * G); // compacted trail floor is smoother
#elif BIOME == 10
  grainAmp = 0.002;
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
#elif BIOME == 5
  {
    // red foraminifera (Homotrema rubrum) specks + white shell grit (AA-faded to an average)
    vec3 fh = hash32(floor(p * 26.0) + 5.0);
    vec2 fc = fract(p * 26.0) - 0.5 - (fh.xy - 0.5) * 0.4;
    float ff = 1.0 - smoothstep(0.3, 0.8, 26.0 * fw);
    float speck = step(0.935, fh.z) * (1.0 - smoothstep(0.16, 0.32, length(fc)));
    alb = mix(alb, uColC, speck * ff * 0.85 + (1.0 - ff) * 0.05);
    vec3 gh3 = hash32(floor(p * 13.0) + 9.0);
    vec2 gc3 = fract(p * 13.0) - 0.5;
    float grit = step(0.95, gh3.x) * (1.0 - smoothstep(0.1, 0.3, length(gc3 * vec2(1.0, 1.6 + gh3.y))));
    alb = mix(alb, uColB * 1.03, grit * (1.0 - smoothstep(0.3, 0.8, 13.0 * fw)) * 0.9);
    // the wrack lines concentrate the red forams and shell hash
    alb = mix(alb, mix(uColC, uColA, 0.5), clamp(pinkSwash(p), 0.0, 1.0) * 0.5 * keep);
    // broad tonal drift: pinker patches and paler, sun-bleached ones
    alb *= mix(vec3(1.0), vec3(0.98, 0.93, 0.93), smoothstep(0.4, 0.75, fbm3(p * 0.12 + 5.0)));
    // the trail turns up paler, whiter sand (B) that blends back over ~30 s
    float wh = clamp(D.b, 0.0, 1.0);
    wh = wh * wh * (3.0 - 2.0 * wh);
    // keep the grain texture: scale the local albedo toward white instead of painting over it
    vec3 paler = alb / max(luma(alb), 1e-3) * luma(uColB) * 0.35 + uColB * 0.65;
    alb = mix(alb, paler * vec3(1.0, 0.975, 0.965), wh * 0.72);
    alb *= 1.0 - 0.04 * groove;
    // damp swash zone: darker, deeper pink, glossy (sheen added in the specials)
    float eN = lapEdgeN(p, uWave.x, uTime);
    float damp = max(smoothstep(-0.7, -0.02, eN), smoothstep(-0.25, 0.2, p.y - uWave.y) * 0.6);
    gWet = damp * (1.0 - wh * 0.5);
    alb *= mix(vec3(1.0), vec3(0.8, 0.73, 0.74), gWet);
  }
#elif BIOME == 6
  {
    // moonlit coral sand, darker and wetter toward the sea
    float eN = lapEdgeN(p, uWave.x, uTime);
    float wetB = smoothstep(-5.0, -0.3, eN);
    gWet = max(wetB * 0.6, smoothstep(-0.25, 0.2, p.y - uWave.y));
    alb *= mix(vec3(1.0), vec3(0.52, 0.55, 0.6), gWet);
    alb *= 1.0 - 0.1 * groove;
    // coral / shell fragments
    vec3 sh3 = hash32(floor(p * 12.0) + 4.0);
    vec2 sc3 = fract(p * 12.0) - 0.5;
    float frag = step(0.965, sh3.x) * (1.0 - smoothstep(0.1, 0.3, length(sc3 * vec2(1.0, 1.5 + sh3.y))));
    alb = mix(alb, uColB * 1.35, frag * (1.0 - smoothstep(0.3, 0.8, 12.0 * fw)) * 0.7 * keep);
  }
#elif BIOME == 7
  {
    // mineral colour fields with crisp, frothy boundaries: acid yellow (fresh sulphur), lime-green,
    // orange-brown (older, oxidised iron) and white salt
    vec2 wq = vec2(vnoise(p * 0.8), vnoise(p * 0.8 + 3.3)) * 0.9;
    float fine = (vnoise(p * 2.6) - 0.5) * 0.1 + (vnoise(p * 6.0) - 0.5) * 0.05;
    float m2 = fbm3(p * 0.6 + 2.0);
    float kn = dallolKnob(p);
    alb *= 0.78 + 0.4 * kn;                                   // crevices between blisters are darker
    float fLime = smoothstep(0.6, 0.64, fbm3(p * 0.2 + 7.0 + wq) + fine);
    alb = mix(alb, vec3(0.3, 0.5, 0.04) * (0.8 + 0.4 * kn), fLime * 0.75 * keep);
    float fOx = smoothstep(0.68, 0.72, fbm3(p * 0.15 + 13.0 + wq * 1.3) + fine);
    alb = mix(alb, mix(uColC, vec3(0.22, 0.07, 0.02), 0.45 + 0.4 * m2) * (0.65 + 0.7 * kn), fOx * 0.85 * keep);
    float lip;
    dallolTerr(p, lip);
    float salt = smoothstep(0.66, 0.7, fbm3(p * 0.12 + 21.0 + wq) + fine);
    alb = mix(alb, uColB * (0.82 + 0.2 * kn), clamp(max(salt * 0.8, lip * 0.35), 0.0, 1.0) * keep);
    // colour zoning around the pools: cream rimstone rings, then an orange-brown iron halo
    float zone = clamp(gPoolRing, 0.0, 1.0);
    vec3 ringC = mix(vec3(0.8, 0.66, 0.2), vec3(0.55, 0.26, 0.05), smoothstep(0.45, 0.08, zone));
    alb = mix(alb, ringC * (0.8 + 0.2 * sin(zone * 40.0)), smoothstep(0.03, 0.5, zone) * 0.6 * keep);
    // polygonal crust plates (fine seams)
    vec3 cv = voronoi(p * 2.3, 0.8);
    alb *= 1.0 - 0.16 * (1.0 - smoothstep(0.01, 0.05, cv.x)) * keep;
    // the trail cracks the crust open: ochre-orange iron salts, dark rusty fissures
    vec3 cr = voronoi(p * 3.6 + 1.7, 0.9);
    gCrack = cr;
    float Gd = smoothstep(0.1, 0.6, G);
    vec3 iron = mix(uColC, vec3(0.55, 0.13, 0.02), cr.y * 0.7) * (0.8 + 0.4 * cr.z);
    alb = mix(alb, iron, Gd * 0.88);
    float crack = (1.0 - smoothstep(0.012, 0.05, cr.x)) * Gd;
    alb = mix(alb, vec3(0.1, 0.03, 0.008), crack * 0.85);
    // brine pools: bright salt rim around the pocket
    alb = mix(alb, vec3(0.9, 0.87, 0.66), clamp(gPoolRim, 0.0, 1.0) * 0.8);
  }
#elif BIOME == 8
  {
    // maria tone drift; fresh crater rims are brighter (immature regolith), plus a young crater's rays
    alb *= 0.86 + 0.26 * fbm3(p * 0.07 + 4.0);
    alb *= 1.0 + 0.3 * gCrRim * keep;
    vec4 yc = bigCrater(2);
    vec2 rd = p - yc.xy * uBoard;
    float rl = length(rd), ra = atan(rd.y, rd.x);
    float rays = vnoise(vec2(ra * 6.0, 1.0)) * vnoise(vec2(ra * 17.0, 5.0));
    rays = smoothstep(0.25, 0.7, rays) * smoothstep(yc.z * 0.95, yc.z * 1.25, rl) * exp(-(rl - yc.z) / (yc.z * 2.2));
    alb *= 1.0 + 0.55 * rays + 0.25 * exp(-sq((rl - yc.z) / (yc.z * 0.35)));
    // the trail: crisp, compacted, much darker regolith (permanent)
    float tr = 1.0 - smoothstep(-0.4, -0.12, D.r);
    alb *= 1.0 - 0.45 * tr;
    alb *= 1.0 + 0.1 * smoothstep(0.05, 0.25, D.r); // pushed-up lip catches light
  }
#elif BIOME == 9
  {
    vec3 basalt = vec3(0.04, 0.047, 0.058);
    alb *= 0.88 + 0.22 * fbm3(p * 0.3 + 9.0);
    // brighter fine dust gathers in the ripple troughs
    alb = mix(alb, uColB, (1.0 - smoothstep(0.1, 0.5, h0)) * 0.22 * keep);
    // pebbles (dark basalt with a dusty cap)
    // dusty grey-brown rocks: dust settles on their upward faces
    vec3 rock = mix(vec3(0.13, 0.115, 0.1), vec3(0.24, 0.18, 0.14), gPebH);
    rock = mix(rock, uColA * 0.85, 0.35 * smoothstep(0.85, 1.0, N.z));
    alb = mix(alb, rock, gPeb * keep);
    // scraped trail: the rusty dust comes off and dark grey-blue basalt shows through
    float scr = smoothstep(0.4, 0.95, G) * (1.0 - smoothstep(-0.4, 0.0, D.r));
    float resid = fbm3(p * 2.4);
    alb = mix(alb, mix(basalt, basalt * 1.5 + uColA * 0.12, smoothstep(0.4, 0.8, resid) * 0.7), scr * 0.93);
    alb *= 1.0 + 0.14 * berm;
  }
#elif BIOME == 10
  {
    // interdune corridors are firmer and paler (ice gravel), dune sand is the darkest "coffee grounds"
    float ridgeH = P0.y / 16.0;
    alb = mix(alb * 1.35 + vec3(0.012, 0.008, 0.004), alb * 0.92, smoothstep(0.03, 0.35, ridgeH));
    // damp drizzle spots (B) darken the sand
    alb *= 1.0 - 0.38 * smoothstep(0.0, 0.7, D.b);
    alb *= 1.0 - 0.08 * groove;
    // lake shore: soaked dark band
    float lk = titanLake(p, uBoard);
    gWet = smoothstep(-0.9, 0.0, lk);
    alb *= 1.0 - 0.5 * gWet;
  }
#elif BIOME == 11
  {
    alb *= 0.9 + 0.2 * fbm3(p * 0.25 + 2.0);
    // individual crystals have slightly different tints (lilac, ice-cyan, rose)
    vec3 tA = vec3(0.82, 0.92, 1.28), tB = vec3(1.2, 0.84, 1.08);
    vec3 tint = mix(tA, tB, step(0.5, fract(gFacet.y * 13.1)));
    float tf = (1.0 - smoothstep(0.3, 0.8, 4.2 * fw)) * step(0.55, gFacet.y);
    alb *= mix(vec3(1.0), tint, 0.16 * tf * keep);
    alb *= 1.0 - 0.12 * groove;
  }
#endif

  // ---------------------------------------------------------------- shadows & occlusion
  vec3 shd = texture2D(uShadow, duv).rgb;
  vec2 sh = shd.rg;
  float sunVis = 1.0 - uShadowK * sh.r;
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
    sunVis *= 1.0 - (uShadowK / 0.82) * 0.72 * smoothstep(0.0, 0.05, occ);
  }
  // frame: the sand sits below the frame lip -> rim shadow toward the sun + ambient occlusion
  vec2 ps = p + L.xy / max(L.z, 0.2) * uFrameH;
  float inside = min(min(ps.x, uBoard.x - ps.x), min(ps.y, uBoard.y - ps.y));
  sunVis *= smoothstep(-0.06, 0.1, inside);
  float edge = min(min(p.x, uBoard.x - p.x), min(p.y, uBoard.y - p.y));
#if BIOME != 8
  ao *= mix(0.55, 1.0, smoothstep(0.0, 0.6, edge));
#endif
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
#if BIOME == 8
  {
    // big craters cast crisp shadows into their bowls (short height-field march toward the sun)
    vec2 ldir = normalize(L.xy);
    float tanE = L.z / max(length(L.xy), 1e-3);
    float occ = 0.0;
    for (int k = 1; k <= 6; k++) {
      float t = float(k * k) * 0.06;
      occ = max(occ, bigCraters(p + ldir * t).x - (bc.x + t * tanE));
    }
    sunVis *= 1.0 - smoothstep(0.0, 0.015, occ);
  }
#elif BIOME == 9
  {
    // pebbles cast little shadows in the low sun
    vec2 ldir = normalize(L.xy);
    float tanE = L.z / max(length(L.xy), 1e-3);
    float occ = 0.0;
    for (int k = 1; k <= 3; k++) {
      float t = float(k) * 0.06;
      occ = max(occ, pebbles(p + ldir * t, false).x - (pb.x + t * tanE));
    }
    sunVis *= 1.0 - 0.85 * smoothstep(0.0, 0.012, occ) * keep;
  }
#elif BIOME == 11
  // second sun: its own contact shadow (B), groove self-shadow, frame rim and flora shadows
  vec3 L2 = normalize(uSun2Dir);
  float sunVis2 = 1.0 - uShadowK * shd.b;
  {
    vec2 ldir = normalize(L2.xy);
    float tanE = L2.z / max(length(L2.xy), 1e-3);
    float hC = D.r * uDepth;
    float occ = 0.0;
    for (int k = 1; k <= 5; k++) {
      float t = float(k) * 0.055;
      float hS = texture2D(uDeform, duv + ldir * t / uRegion.zw).r * uDepth;
      occ = max(occ, hS - (hC + t * tanE));
    }
    sunVis2 *= 1.0 - 0.72 * smoothstep(0.0, 0.05, occ);
    vec2 ps2 = p + L2.xy / max(L2.z, 0.2) * uFrameH;
    float inside2 = min(min(ps2.x, uBoard.x - ps2.x), min(ps2.y, uBoard.y - ps2.y));
    sunVis2 *= smoothstep(-0.06, 0.1, inside2);
    vec2 co = (L.xy / max(L.z, 0.2) - L2.xy / max(L2.z, 0.2)) * 0.9;
    float leaf2 = texture2D(uCookie, cuv + (swayA + co) / uCookieRegion.zw).r;
    sunVis2 *= 1.0 - 0.8 * leaf2;
  }
#endif
#if BIOME == 4
  float cloud = smoothstep(0.5, 0.75, fbm3(p * 0.045 + uTime * vec2(0.012, 0.005)));
  sunVis *= 1.0 - 0.4 * cloud;
#endif

  // ---------------------------------------------------------------- lighting
  float NdL = dot(N, L);
#if BIOME == 8
  float wrap = 0.0;
#elif BIOME == 10
  float wrap = 0.35;
#else
  float wrap = 0.04;
#endif
  float diff = max((NdL + wrap) / (1.0 + wrap), 0.0);
  vec3 amb = mix(uGroundColor, uSkyColor, N.z * 0.5 + 0.5);
#if BIOME == 3
  // aurora light bands drifting across
  float band = pow(0.5 + 0.5 * sin(p.x * 0.2 + p.y * 0.07 + fbm3(p * 0.05 + uTime * 0.02) * 6.0 + uTime * 0.12), 9.0);
  band *= 0.5 + 0.5 * fbm3(vec2(p.x * 0.1, p.y * 0.4) + uTime * 0.05);
  amb += uAurora * (0.25 + 0.6 * band);
#endif
  vec3 col = alb * (uSunColor * diff * sunVis + amb * ao);
#if BIOME == 11
  float diff2 = max((dot(N, L2) + wrap) / (1.0 + wrap), 0.0);
  col += alb * uSun2Color * diff2 * sunVis2;
#endif

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
#elif BIOME == 4
  sparkAmt = 3.0;
#elif BIOME == 5
  sparkAmt = 1.4;
#elif BIOME == 6
  sparkAmt = 0.8;
#elif BIOME == 7
  sparkAmt = 1.6;
#elif BIOME == 8
  sparkAmt = 0.7;
#elif BIOME == 9
  sparkAmt = 0.35;
#elif BIOME == 10
  sparkAmt = 0.15;
#else
  sparkAmt = 1.4;
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
    float rl = 1.0 - abs(gnoise(vec2(p.x * 0.9, p.y * 3.2) + vec2(gnoise(p * 0.7), 0.0) * 0.6));
    float lace = smoothstep(0.9, 0.98, rl);
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
#elif BIOME == 5
  {
    // damp swash zone: glossy sheen + faint sky mirror
    vec3 Rv = reflect(-V, N);
    col = mix(col, skyReflect(Rv, L), gWet * 0.12);
    col += uSunColor * pow(max(dot(N, Hh), 0.0), 48.0) * gWet * 0.45 * sunVis;
    // turquoise Bahamas shallows along the top, gently lapping (no surges)
    float eN = lapEdgeN(p, uWave.x, uTime);
    if (eN > -0.3)
      col = shoreWater(col, p, eN, uTime, amb, uSunColor, L, uZenith, uHorizon,
                       vec3(2.6, 0.5, 0.3), vec3(0.03, 0.3, 0.42), 1.25, 0.55 + 0.45 * uWave.w, vec3(0.0));
  }
#elif BIOME == 6
  {
    float eN = lapEdgeN(p, uWave.x, uTime);
    // wet sand mirrors the night sky and holds a moon sheen
    vec3 Rv = reflect(-V, N);
    col = mix(col, skyReflect(Rv, L) * 0.7, gWet * 0.2);
    col += uSunColor * pow(max(dot(N, Hh), 0.0), 60.0) * gWet * 0.9 * sunVis;
    // the night sea (dark, moonlit), its lapping edge lit by plankton when it moves
    vec3 BIO = vec3(0.1, 0.6, 1.0);
    float under = 0.0;
    if (eN > -0.3) {
      col = shoreWater(col, p, eN, uTime, amb, uSunColor, L, uZenith, uHorizon,
                       vec3(1.5, 0.5, 0.32), vec3(0.004, 0.018, 0.04), 0.8, 0.3 + 0.5 * uWave.w, BIO * (0.4 + 3.2 * uWave.w));
      under = smoothstep(0.0, 0.6, eN);
    }
    // bioluminescence (B): a soft blue body glow + sparkling point sources (dinoflagellates)
    float gl = clamp(D.b, 0.0, 1.0);
    gl = gl * gl * (3.0 - 2.0 * gl);
    vec3 ph = hash32(floor(p * 17.0) + 21.0);
    vec2 pc = fract(p * 17.0) - 0.5 - (ph.xy - 0.5) * 0.5;
    float dotm = (1.0 - smoothstep(0.04, 0.2, length(pc))) * step(0.5, ph.z);
    float df = 1.0 - smoothstep(0.3, 0.9, 17.0 * fw);
    float flick = 0.55 + 0.45 * sin(uTime * (2.5 + ph.x * 5.0) + ph.y * 30.0);
    float patchy = 0.35 + 0.65 * smoothstep(0.25, 0.75, vnoise(p * 2.3 + 7.0));
    float em = gl * (0.13 * patchy + (dotm * 3.0 * flick) * df + (1.0 - df) * 0.5);
    // sparkles in the moving water near the edge
    vec3 wh = hash32(floor(p * 11.0 + vec2(0.0, uTime * 0.6)) + 3.0);
    vec2 wc = fract(p * 11.0 + vec2(0.0, uTime * 0.6)) - 0.5;
    float wdot = (1.0 - smoothstep(0.05, 0.22, length(wc))) * step(0.82, wh.z) * exp(-max(eN, 0.0) / 0.5) * smoothstep(-0.05, 0.1, eN);
    em += wdot * uWave.w * 2.5 * (0.5 + 0.5 * sin(uTime * 7.0 + wh.x * 40.0));
    col += BIO * em * (1.0 - 0.5 * under);
  }
#elif BIOME == 7
  {
    // steam hint: fresh cracks (B) exhale a faint drifting white haze
    float fresh = clamp(D.b, 0.0, 1.0);
    float st = fbm3(p * 1.5 + vec2(uTime * 0.25, -uTime * 0.55));
    float st2 = vnoise(p * 3.4 - vec2(uTime * 0.3, uTime * 1.1));
    float steam = fresh * smoothstep(0.4, 0.85, st) * (0.55 + 0.45 * st2);
    col = mix(col, vec3(0.95) * (amb * 1.2 + uSunColor * 0.75), steam * 0.32);
    // hot fissures look damp: a faint dark sheen right in the fresh cracks
    float crack = (1.0 - smoothstep(0.012, 0.05, gCrack.x)) * smoothstep(0.1, 0.6, G);
    col += uSunColor * pow(max(dot(N, Hh), 0.0), 30.0) * crack * fresh * 0.25;
    // brine pools: flat hyper-saline liquid, emerald at depth, turquoise / lime at the margin
    if (gPool > 0.001) {
      vec3 gp = gnoised(p * 2.4 + vec2(uTime * 0.13, uTime * 0.07));
      vec3 Np = normalize(vec3(-gp.yz * 0.015, 1.0));
      float od = 0.15 + gPoolD * 2.4;
      vec3 absorbA = gPoolType < 0.55 ? vec3(2.8, 0.32, 0.7) : (gPoolType < 0.8 ? vec3(2.6, 0.3, 0.32) : vec3(1.6, 0.2, 2.2));
      vec3 scat = gPoolType < 0.8 ? vec3(0.015, 0.2, 0.15) : vec3(0.08, 0.2, 0.02);
      vec3 floorC = mix(vec3(0.62, 0.62, 0.22), vec3(0.16, 0.3, 0.12), smoothstep(0.1, 0.8, gPoolD));
      vec3 light = uSunColor * L.z + amb;
      vec3 liq = floorC * light * exp(-absorbA * od) + scat * light * (1.0 - exp(-od * 1.6));
      vec3 Rv = reflect(-V, Np);
      liq = mix(liq, skyReflect(Rv, L), 0.04);
      liq += uSunColor * pow(max(dot(Np, Hh), 0.0), 400.0) * 3.0;
      // effervescence: a few tiny bubble rings near the centre
      vec3 bh = hash32(floor(p * 5.0 + floor(uTime * 0.7)) + 1.0);
      vec2 bc2 = fract(p * 5.0) - 0.5 - (bh.xy - 0.5) * 0.4;
      float ring = exp(-sq((length(bc2) - fract(uTime * 0.7) * 0.35) / 0.03)) * step(0.85, bh.z) * (1.0 - fract(uTime * 0.7));
      liq += vec3(0.8, 0.95, 0.9) * light * ring * 0.2 * gPoolD;
      // a thin crust of yellow scum at the waterline
      float scum = exp(-sq((gPoolD - 0.04) / 0.05));
      liq = mix(liq, vec3(0.75, 0.7, 0.15) * light, scum * 0.5);
      col = mix(col, liq, gPool);
    }
  }
#elif BIOME == 8
  {
    // regolith glass beads / sharp grains: a hard, tiny specular (backscatter handled by the grade)
    col += uSunColor * pow(max(dot(N, Hh), 0.0), 90.0) * 0.03 * sunVis;
  }
#elif BIOME == 9
  {
    // dust devils: swirling, lighter dust and a faint column shadow cast away from the sun
    for (int i = 0; i < 2; i++) {
      vec4 dv = uDevils[i];
      if (dv.w < 0.01) continue;
      vec2 d = p - dv.xy;
      float dl = length(d);
      float R = dv.z;
      // column shadow: a soft streak from the base, away from the sun
      vec2 sd = -normalize(L.xy);
      float along = dot(d, sd);
      float perp = abs(dot(d, vec2(-sd.y, sd.x)));
      float colSh = smoothstep(-0.3, 0.6, along) * exp(-max(along, 0.0) / 5.0) * exp(-sq(perp / (R * (0.45 + along * 0.06))));
      col *= 1.0 - 0.22 * colSh * dv.w;
      if (dl > R * 2.4) continue;
      float ang = atan(d.y, d.x);
      float arms = 0.5 + 0.5 * sin(ang * 3.0 + log(dl + 0.08) * 5.0 - uTime * 7.0);
      float fine = vnoise(vec2(ang * 3.0 + uTime * 3.0, dl * 6.0 - uTime * 2.5) * vec2(1.0, 1.0));
      float fall = exp(-sq(dl / (R * 0.95)));
      float dust = fall * (0.3 + 0.7 * arms * (0.4 + 0.6 * fine));
      vec3 haze = uColB * (uSunColor * 0.7 + amb * 1.6);
      col = mix(col, haze, clamp(dust * 0.5, 0.0, 0.6) * dv.w);
      // fresh dust being laid down in the vortex skirt (tints the ground, reads as swirl streaks)
      float skirt = exp(-sq((dl - R * 0.9) / (R * 0.5))) * (0.5 + 0.5 * sin(ang * 5.0 + log(dl + 0.08) * 8.0 - uTime * 5.0));
      col = mix(col, uColB * (uSunColor * max(L.z, 0.0) + amb), skirt * 0.18 * dv.w);
    }
  }
#elif BIOME == 10
  {
    float lk = titanLake(p, uBoard);
    vec3 Rv = reflect(-V, N);
    // soaked shoreline: dark gloss
    col += uSunColor * pow(max(dot(N, Hh), 0.0), 30.0) * gWet * 0.25;
    if (lk > -0.08) {
      // methane lake: black, mirror-smooth; reflects the orange haze softly (with slow haze bands)
      vec2 rg = vec2(0.0);
      vec2 cell = floor(p / DRIZ_C);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec3 dr = drizzleDrop(cell + vec2(float(i), float(j)), uTime);
        if (dr.z > 2.4) continue;
        vec2 d = p - dr.xy;
        float rr = length(d);
        float rad = 0.04 + dr.z * 0.28;
        float w = (rr - rad) / 0.035;
        float amp = exp(-w * w) * (1.0 - dr.z / 2.4) * 0.35;
        rg += amp * (-2.0 * w / 0.035) * d / max(rr, 1e-4) * 0.02;
      }
      vec3 Nl = normalize(vec3(-rg, 1.0));
      vec3 Rl = reflect(-V, Nl);
      float bands = fbm3(p * vec2(0.05, 0.09) + Rl.xy * 1.5 + vec2(uTime * 0.004, 0.0));
      // sky radiance ~ irradiance / pi; liquid methane reflects ~2-4% of it: much darker than the dunes
      vec3 hz = (uSkyColor * 1.4 + uSunColor * 0.6) * mix(vec3(1.0), uHorizon / max(luma(uHorizon), 1e-3), 0.3);
      hz *= 0.75 + 0.5 * bands;
      float depth = smoothstep(0.0, 0.9, lk);
      vec3 bottom = col * exp(-vec3(3.0, 3.6, 4.2) * lk * 1.4);
      vec3 liq = mix(bottom, vec3(0.002, 0.0015, 0.001), depth);
      liq += hz * 0.045;
      // the hidden sun: a broad soft glint through the haze
      liq += uSunColor * pow(max(dot(Nl, Hh), 0.0), 25.0) * 0.06;
      col = mix(col, liq, smoothstep(-0.06, 0.06, lk));
    }
  }
#elif BIOME == 11
  {
    // crystal facets flash in both suns (coloured glints)
    vec3 H2 = normalize(L2 + V);
    vec3 fh = hash32(vec2(gFacet.y * 113.0, 7.0));
    vec3 fnn = normalize(N + (fh - 0.5) * vec3(0.8, 0.8, 0.2));
    // a small bright point where the crystal's facet catches a sun (not the whole facet)
    float ff = (1.0 - smoothstep(0.3, 0.8, 4.2 * fw)) * keep * step(0.72, fh.z) * (1.0 - smoothstep(0.03, 0.09, gFacet.z));
    float f1 = pow(max(dot(fnn, Hh), 0.0), 300.0), f2 = pow(max(dot(fnn, H2), 0.0), 300.0);
    vec3 ftint = mix(vec3(1.0, 0.8, 1.0), vec3(0.8, 1.0, 1.0), fh.x);
    col += (uSunColor * f1 * sunVis + uSun2Color * f2 * sunVis2) * ftint * ff * 2.5;
    // fine sparkle from the second sun as well
    col += uSun2Color * pow(max(dot(fn, H2), 0.0), 60.0) * step(0.9, sp.z) * spot * sfade * twinkle * sparkAmt * sunVis2 * keep;
    // the trail shatters surface crystals into glowing magenta / cyan shards (B) that fade
    float gl = clamp(D.b, 0.0, 1.0);
    if (gl > 0.002) {
      vec3 sv = voronoi(p * 4.2 + 3.3, 1.0);
      float present = step(0.45, sv.y);
      float thr = mix(0.3, 0.08, gl);              // shards shrink as they fade
      float body = smoothstep(thr, thr + 0.025, sv.x) * present;
      float halo = exp(-max(thr - sv.x, 0.0) / 0.05) * present * (1.0 - body);
      vec3 MAG = vec3(1.0, 0.08, 0.7), CYA = vec3(0.05, 0.8, 1.0);
      vec3 sc = mix(MAG, CYA, step(0.7, sv.y));
      float facet = 0.5 + 0.5 * sin(atan(sv.x - 0.2, sv.z) * 4.0 + sv.y * 20.0); // split facets
      float flick = 0.7 + 0.3 * sin(uTime * (2.0 + sv.y * 5.0) + sv.y * 40.0);
      float g = smoothstep(0.0, 0.7, gl);
      col = mix(col, col * 0.35 + sc * 0.02, body * g);         // the shard itself is dark glass...
      col += sc * g * flick * (body * (0.7 + 2.2 * facet * (1.0 - sv.z)) + halo * 0.35); // ...lit from inside
      // a soft coloured under-glow in the groove
      col += mix(MAG, CYA, 0.5 + 0.5 * sin(p.x * 0.7 + p.y * 0.5)) * g * 0.12 * groove;
    }
  }
#endif

  gl_FragColor = vec4(col, 1.0);
  if (uDebug == 1) gl_FragColor = vec4(vec3(leaf), 1.0);
  else if (uDebug == 2) gl_FragColor = vec4(sh, 0.0, 1.0);
  else if (uDebug == 5) gl_FragColor = vec4(shd, 1.0);
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
