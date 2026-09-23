// Culturally themed board frame + surroundings (fills the whole view outside the board).
import * as THREE from 'three';
import { NOISE_GLSL } from '../glsl/noise';
import { SEA_GLSL } from '../sand/sandShader';
import { BIOME_DEFINES, SHARED_GLSL, NEW_BIOMES_GLSL } from './newWorlds';

const FRAME_VERT = /* glsl */ `
varying vec2 vP;
varying vec4 vView; // visible world rect (left, bottom, right, top); the mesh is the view + 2 cells each side
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xy;
  vec2 hs = (vec2(modelMatrix[0][0], modelMatrix[1][1]) - 4.0) * 0.5;
  vView = vec4(modelMatrix[3].xy - hs, modelMatrix[3].xy + hs);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAME_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec4 vView;
uniform vec2 uBoard;
uniform float uBorder;
uniform float uFrameH;
uniform float uTime;
uniform vec3 uSunDir, uSunColor, uSkyColor, uGroundColor;
uniform sampler2D uCookie;
uniform vec4 uCookieRegion;
uniform vec4 uWave;
uniform vec3 uZenith;
uniform vec3 uHorizon;
${NOISE_GLSL}
float sq(float x) { return x * x; }
${SEA_GLSL}

// chebyshev distance outside the board (>0 outside)
float boardDist(vec2 p) {
  vec2 c = uBoard * 0.5;
  vec2 q = abs(p - c) - c;
  return max(q.x, q.y);
}

// frame height profile across the rail (0 = board edge, uBorder = outer edge), returns (h, dh/dacross)
vec2 railProfile(float a, float b) {
  float lip = 0.1;
  float h;
  if (a < lip) h = smoothstep(0.0, lip, a);
  else if (a < b - 0.12) h = 1.0 + 0.04 * sin(3.14159 * (a - lip) / (b - 0.12 - lip));
  else h = mix(1.0, 0.25, smoothstep(b - 0.12, b, a));
  return vec2(h, 0.0);
}
float railH(float a, float b) { return railProfile(a, b).x; }

struct Surf { vec3 alb; float h; vec2 nrm; float spec; float gloss; vec3 emit; };

vec3 light(Surf s, vec3 N, float vis) {
  vec3 L = normalize(uSunDir);
  float diff = max(dot(N, L), 0.0);
  vec3 amb = mix(uGroundColor, uSkyColor, N.z * 0.5 + 0.5);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), s.gloss) * s.spec;
  return s.alb * (uSunColor * diff * vis + amb) + uSunColor * spec * vis + s.emit;
}

${BIOME_DEFINES}
${SHARED_GLSL}
// ----------------------------------------------------------------------------- per biome materials
#if BIOME == 0
// dark aged hinoki / keyaki wood
vec3 woodCol(float u, float v, float seed) {
  float w = fbm3(vec2(u * 0.35, v * 2.6) + seed);
  float rings = sin((v * 7.0 + w * 5.0 + seed) * 6.2831) * 0.5 + 0.5;
  float pores = vnoise(vec2(u * 3.0, v * 55.0) + seed);
  vec3 dark = vec3(0.045, 0.026, 0.015);
  vec3 mid = vec3(0.10, 0.058, 0.032);
  vec3 c = mix(dark, mid, rings * 0.6 + w * 0.4);
  c *= 0.85 + 0.3 * pores;
  return c;
}
Surf railSurf(float along, float across, bool vert) {
  Surf s;
  float seed = vert ? 3.0 : 11.0;
  s.alb = woodCol(along, across, seed);
  // weathered lighter top
  s.alb = mix(s.alb, vec3(0.16, 0.12, 0.09), 0.18 * fbm3(vec2(along * 0.8, across * 6.0)));
  s.h = 0.0;
  s.nrm = vec2(0.0, (vnoise(vec2(along * 2.0, across * 60.0)) - 0.5) * 0.06);
  s.spec = 0.25; s.gloss = 40.0; s.emit = vec3(0.0);
  return s;
}
Surf outerSurf(vec2 p) {
  // engawa floor planks running horizontally
  Surf s;
  float pw = 1.05;
  float row = floor(p.y / pw);
  float fy = fract(p.y / pw);
  float gap = smoothstep(0.0, 0.03, fy) * (1.0 - smoothstep(0.97, 1.0, fy));
  float seed = hash12(vec2(row, 2.0)) * 20.0;
  float joint = step(0.985, fract(p.x / 6.3 + hash12(vec2(row, 5.0))));
  s.alb = woodCol(p.x, fy * pw, seed) * (0.8 + 0.35 * hash12(vec2(row, 9.0))) * gap * (1.0 - joint * 0.7);
  s.h = 0.0;
  s.nrm = vec2(0.0, (fy < 0.06 ? 1.0 : (fy > 0.94 ? -1.0 : 0.0)) * 0.6);
  s.spec = 0.2; s.gloss = 30.0; s.emit = vec3(0.0);
  return s;
}
#elif BIOME == 1
vec3 cedarCol(float u, float v, float seed) {
  float w = fbm3(vec2(u * 0.4, v * 3.0) + seed);
  float rings = sin((v * 6.0 + w * 4.0) * 6.2831) * 0.5 + 0.5;
  vec3 a = vec3(0.16, 0.065, 0.028), b = vec3(0.28, 0.12, 0.05);
  return mix(a, b, rings * 0.5 + w * 0.5) * (0.85 + 0.3 * vnoise(vec2(u * 3.0, v * 50.0)));
}
vec3 zellige(vec2 t, out float grout) {
  // t in tile units; 8-point star tiles
  vec2 id = floor(t);
  vec2 f = fract(t) - 0.5;
  float sqA = max(abs(f.x), abs(f.y));
  vec2 r = vec2(f.x + f.y, f.x - f.y) * 0.7071;
  float sqB = max(abs(r.x), abs(r.y));
  float star = max(sqA, sqB * 1.0);
  float inStar = 1.0 - smoothstep(0.30, 0.33, star);
  grout = smoothstep(0.30, 0.33, star) * (1.0 - smoothstep(0.35, 0.37, star));
  grout = max(grout, 1.0 - smoothstep(0.02, 0.045, min(0.5 - abs(f.x), 0.5 - abs(f.y))));
  float k = mod(id.x + id.y, 2.0);
  vec3 cobalt = vec3(0.02, 0.07, 0.30), emerald = vec3(0.02, 0.20, 0.12), white = vec3(0.78, 0.74, 0.66), ochre = vec3(0.55, 0.30, 0.06);
  vec3 starC = k < 0.5 ? cobalt : emerald;
  vec3 bg = mod(id.x, 2.0) < 0.5 ? white : ochre;
  return mix(bg, starC, inStar);
}
Surf railSurf(float along, float across, bool vert) {
  Surf s;
  float b = uBorder;
  s.alb = cedarCol(along, across, vert ? 1.0 : 7.0);
  s.nrm = vec2(0.0);
  s.spec = 0.15; s.gloss = 25.0; s.emit = vec3(0.0); s.h = 0.0;
  // carved relief: repeating pointed-arch notches on the outer half
  float ca = across / b;
  if (ca > 0.66 && ca < 0.9) {
    float u = fract(along * 2.2) - 0.5;
    float lv = (ca - 0.66) / 0.24;
    float arch = abs(u) * 2.0 + (1.0 - lv) * 0.9;
    float cut = 1.0 - smoothstep(0.75, 0.85, arch);
    s.alb *= 1.0 - 0.45 * cut;
    s.nrm = vec2(sign(u) * cut * 0.5, (lv - 0.5) * cut * 0.8);
  }
  // zellige inlay line
  float z0 = 0.34 * b, z1 = 0.54 * b;
  if (across > z0 && across < z1) {
    float grout;
    float ts = (z1 - z0);
    vec3 zc = zellige(vec2(along / ts, (across - z0) / ts), grout);
    s.alb = mix(zc, vec3(0.6, 0.58, 0.52), grout * 0.8);
    s.spec = 0.9 * (1.0 - grout); s.gloss = 120.0;
    s.nrm = vec2(0.0, 0.0);
  }
  float e0 = abs(across - z0), e1 = abs(across - z1);
  float bead = 1.0 - smoothstep(0.0, 0.03, min(e0, e1));
  s.alb = mix(s.alb, vec3(0.32, 0.2, 0.08), bead * 0.6);
  return s;
}
Surf outerSurf(vec2 p) {
  Surf s;
  s.alb = cedarCol(p.x, p.y, 13.0) * 0.7;
  // carved lattice of 8-point stars
  vec2 t = p / 1.4;
  vec2 f = fract(t) - 0.5;
  float sqA = max(abs(f.x), abs(f.y));
  vec2 r = vec2(f.x + f.y, f.x - f.y) * 0.7071;
  float star = max(sqA, max(abs(r.x), abs(r.y)));
  float line = 1.0 - smoothstep(0.0, 0.04, abs(star - 0.3));
  s.alb *= 1.0 - 0.5 * line;
  s.nrm = f * line * 0.8;
  s.h = 0.0; s.spec = 0.12; s.gloss = 20.0; s.emit = vec3(0.0);
  return s;
}
#elif BIOME == 2
Surf railSurf(float along, float across, bool vert) {
  Surf s;
  float b = uBorder;
  // two lashed bamboo poles
  float a = across / b;
  float pole = a < 0.5 ? a / 0.5 : (a - 0.5) / 0.5;
  float cyl = pole * 2.0 - 1.0;
  float seed = a < 0.5 ? 0.0 : 5.0;
  float nodeP = fract(along / 1.7 + seed * 0.37);
  float node = exp(-sq((nodeP - 0.5) / 0.02));
  vec3 bam = mix(vec3(0.38, 0.28, 0.12), vec3(0.52, 0.42, 0.2), vnoise(vec2(along * 0.6, seed)));
  bam *= 0.85 + 0.25 * vnoise(vec2(along * 8.0, cyl * 20.0));
  bam = mix(bam, vec3(0.22, 0.15, 0.07), node * 0.8);
  s.alb = bam;
  s.nrm = vec2(0.0, -cyl * 1.3);
  s.nrm.x = (nodeP - 0.5) * node * 6.0;
  // coir lashing
  float lp = fract(along / 3.4 + 0.25);
  if (lp < 0.09) {
    float str = fract((along + across) * 22.0);
    s.alb = mix(vec3(0.12, 0.07, 0.035), vec3(0.24, 0.15, 0.07), str);
    s.nrm = vec2((str - 0.5) * 0.4, -cyl * 0.8);
  }
  s.h = 0.0; s.spec = 0.5; s.gloss = 50.0; s.emit = vec3(0.0);
  float groove = 1.0 - smoothstep(0.0, 0.08, abs(a - 0.5));
  s.alb *= 1.0 - 0.6 * groove;
  return s;
}
Surf outerSurf(vec2 p) {
  // woven pandanus mat, basket weave
  Surf s;
  float w = 0.32;
  vec2 g = p / w;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float over = mod(id.x + id.y, 2.0);
  float dirX = over;
  float across = dirX > 0.5 ? f.y : f.x;
  float along = dirX > 0.5 ? g.x : g.y;
  vec3 c = mix(vec3(0.33, 0.22, 0.1), vec3(0.45, 0.33, 0.16), hash12(dirX > 0.5 ? vec2(id.y, 1.0) : vec2(id.x, 2.0)));
  c *= 0.85 + 0.2 * vnoise(vec2(along * 6.0, across * 3.0));
  float edge = smoothstep(0.0, 0.12, across) * (1.0 - smoothstep(0.88, 1.0, across));
  s.alb = c * (0.6 + 0.4 * edge);
  vec2 n = dirX > 0.5 ? vec2(0.0, (0.5 - f.y)) : vec2(0.5 - f.x, 0.0);
  s.nrm = n * 1.2;
  s.h = 0.0; s.spec = 0.1; s.gloss = 10.0; s.emit = vec3(0.0);
  return s;
}
#elif BIOME == 3
Surf railSurf(float along, float across, bool vert) {
  Surf s;
  float b = uBorder;
  // rough-hewn basalt blocks
  float bl = along / 1.55;
  float id = floor(bl + hash12(vec2(floor(across * 0.0), vert ? 1.0 : 2.0)));
  float f = fract(bl);
  float joint = min(f, 1.0 - f) * 1.55;
  float jm = 1.0 - smoothstep(0.0, 0.07, joint);
  float rough = fbm(vec2(along, across) * 5.0 + id * 3.0);
  float tone = hash12(vec2(id, vert ? 3.0 : 4.0));
  s.alb = vec3(0.07, 0.072, 0.078) * (0.75 + 0.5 * tone) * (0.7 + 0.6 * rough);
  // lichen
  float lich = smoothstep(0.62, 0.75, fbm3(vec2(along, across) * 1.8 + id));
  s.alb = mix(s.alb, vec3(0.16, 0.17, 0.10), lich * 0.6);
  s.alb *= 1.0 - 0.7 * jm;
  vec3 gn = gnoised(vec2(along, across) * 6.0 + id);
  s.nrm = gn.yz * 0.12 + vec2((f < 0.5 ? 1.0 : -1.0) * jm * 0.6, 0.0);
  s.h = 0.0; s.spec = 0.2; s.gloss = 30.0; s.emit = vec3(0.0);
  return s;
}
Surf outerSurf(vec2 p) {
  // basalt column tops (hex tiling)
  Surf s;
  vec2 q = p / 0.85;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(q, r) - h;
  vec2 b = mod(q - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = q - gv;
  vec2 ag = abs(gv);
  float hexD = 0.5 - max(dot(ag, normalize(r)), ag.x);
  float crack = 1.0 - smoothstep(0.0, 0.05, hexD);
  float tone = hash12(id);
  s.alb = vec3(0.05, 0.052, 0.058) * (0.7 + 0.6 * tone) * (0.8 + 0.4 * fbm3(p * 4.0));
  s.alb *= 1.0 - 0.8 * crack;
  vec2 tilt = (hash22(id) - 0.5) * 0.3;
  s.nrm = tilt + gnoised(p * 7.0).yz * 0.06;
  s.h = 0.0; s.spec = 0.35; s.gloss = 60.0; s.emit = vec3(0.0);
  return s;
}
${NEW_BIOMES_GLSL}
#else
vec3 aguayo(float u, float v) {
  // u along, v across (0..1)
  vec3 mag = vec3(0.55, 0.02, 0.16), red = vec3(0.62, 0.04, 0.03), org = vec3(0.85, 0.28, 0.02);
  vec3 yel = vec3(0.9, 0.62, 0.05), grn = vec3(0.03, 0.3, 0.08), blu = vec3(0.02, 0.12, 0.45), blk = vec3(0.02, 0.018, 0.02);
  float s = v * 15.0;
  float i = floor(s);
  vec3 c;
  if (i < 1.0) c = blk; else if (i < 2.0) c = red; else if (i < 3.0) c = yel; else if (i < 4.0) c = grn;
  else if (i < 5.0) c = mag; else if (i < 10.0) c = red; else if (i < 11.0) c = mag; else if (i < 12.0) c = blu;
  else if (i < 13.0) c = yel; else if (i < 14.0) c = org; else c = blk;
  // central band with diamond motifs
  if (i >= 5.0 && i < 10.0) {
    float lv = (s - 5.0) / 5.0 - 0.5;
    float lu = fract(u * 1.3) - 0.5;
    float dm = abs(lu) * 1.6 + abs(lv) * 2.0;
    if (dm < 0.95) c = mag;
    if (dm < 0.7) c = yel;
    if (dm < 0.45) c = grn;
    if (dm < 0.2) c = vec3(0.85, 0.82, 0.75);
    // little stepped edges
    float stp = step(0.5, fract(u * 26.0));
    if (abs(dm - 0.95) < 0.04 * stp) c = blk;
  }
  // thin pinstripes
  float pin = step(0.9, fract(s));
  c = mix(c, vec3(0.9, 0.85, 0.75), pin * 0.25);
  return c;
}
Surf railSurf(float along, float across, bool vert) {
  Surf s;
  float v = across / uBorder;
  s.alb = aguayo(along, v);
  float weave = sin(along * 140.0) * sin(across * 140.0);
  float fuzz = vnoise(vec2(along, across) * 40.0);
  s.alb *= 0.82 + 0.12 * weave + 0.12 * fuzz;
  s.nrm = vec2(cos(along * 140.0) * 0.08, cos(across * 140.0) * 0.08);
  s.h = 0.0; s.spec = 0.05; s.gloss = 8.0; s.emit = vec3(0.0);
  return s;
}
Surf outerSurf(vec2 p) {
  // salt brick wall (hotel de sal)
  Surf s;
  float bh = 0.55, bw = 1.25;
  float row = floor(p.y / bh);
  float x = p.x / bw + mod(row, 2.0) * 0.5;
  vec2 f = vec2(fract(x), fract(p.y / bh));
  float mort = 1.0 - smoothstep(0.0, 0.035, min(min(f.x, 1.0 - f.x) * bw, min(f.y, 1.0 - f.y) * bh));
  float id = hash12(vec2(floor(x), row));
  vec3 salt = vec3(0.72, 0.71, 0.69) * (0.85 + 0.2 * id) * (0.85 + 0.25 * fbm3(p * 3.0 + id * 9.0));
  s.alb = mix(salt, vec3(0.45, 0.44, 0.42), mort);
  s.nrm = vec2(f.x < 0.5 ? 1.0 : -1.0, f.y < 0.5 ? 1.0 : -1.0) * mort * 0.5 + gnoised(p * 6.0).yz * 0.05;
  s.h = 0.0; s.spec = 0.3; s.gloss = 40.0; s.emit = vec3(0.0);
  return s;
}
#endif

void main() {
  vec2 p = vP;
  float d = boardDist(p);
  if (d <= 0.0) discard;
  vec2 c = uBoard * 0.5;
  vec2 q = abs(p - c) - c;
  bool vert = q.x > q.y;
  vec2 outward = vert ? vec2(sign(p.x - c.x), 0.0) : vec2(0.0, sign(p.y - c.y));
  float along = vert ? p.y : p.x;
  float b = uBorder;
  vec3 L = normalize(uSunDir);
  float fw = max(fwidth(p.x), 1e-4);

  // foliage cookie
  vec2 cuv = (p - uCookieRegion.xy) / uCookieRegion.zw;
  float gust = 0.6 + 0.4 * sin(uTime * 0.23);
  vec2 swayA = vec2(sin(uTime * 0.9 + p.y * 0.3), cos(uTime * 0.7 + p.x * 0.25)) * 0.07 * gust
             + vec2(sin(uTime * 0.31), cos(uTime * 0.27)) * 0.12;
  vec2 swayB = vec2(sin(uTime * 0.6 + p.x * 0.2 + 1.0), cos(uTime * 0.5 + p.y * 0.2)) * 0.1 * gust;
  float leaf = max(texture2D(uCookie, cuv + swayA / uCookieRegion.zw).r, texture2D(uCookie, cuv + swayB / uCookieRegion.zw).g * 0.8);
  float vis = 1.0 - 0.6 * leaf;

  vec3 col;
#ifdef CUSTOM_ALL
  col = shadeAll(p, d, q, vert, outward, along, vis, fw);
#else
#if BIOME == 2
  if (!vert && p.y > uBoard.y) {
    // open sea side: wet shore then ocean with swash
    float edgeN = p.y - uWave.x + gnoise(p * vec2(0.6, 1.8) + uTime * 0.3) * 0.14 + 0.07 * sin(p.x * 1.3 + uTime * 1.1);
    vec3 amb = mix(uGroundColor, uSkyColor, 0.9);
    vec3 sc = vec3(0.16, 0.11, 0.08) * (uSunColor * L.z + amb);
    sc = mix(sc, mix(uHorizon, uZenith, 0.6), 0.2);
    col = waterShade(sc, p, edgeN + 0.0, uTime, 1.0, amb, uSunColor, L, uZenith, uHorizon);
    // shade of the bamboo rails continuing at the sides is handled by the vertical branch
    gl_FragColor = vec4(col * vis, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
#endif

  if (d < b) {
    float e = 0.01;
    float h0 = railH(d, b), h1 = railH(d + e, b);
    float dh = (h1 - h0) / e * uFrameH;
    Surf s = railSurf(along, d, vert);
    // local frame: outward = +across, along axis perpendicular
    vec2 alongDir = vec2(-outward.y, outward.x);
    vec2 g = outward * (dh + s.nrm.y) + alongDir * s.nrm.x;
    vec3 N = normalize(vec3(-g, 1.0));
    col = light(s, N, vis);
    // soft inner edge darkening toward the sand
    col *= mix(0.55, 1.0, smoothstep(0.0, 0.08, d));
    // mitre line at corners
    float mit = 1.0 - smoothstep(0.0, 0.02, abs(q.x - q.y));
    col *= 1.0 - 0.5 * mit * step(0.0, min(q.x, q.y));
  } else {
#ifdef CUSTOM_OUTER
    col = shadeOuter(p, d, vis, fw);
#else
    Surf s = outerSurf(p);
    vec3 N = normalize(vec3(-s.nrm, 1.0));
    // shadow cast by the frame onto the lower surroundings
    vec2 ps = p + L.xy / max(L.z, 0.2) * uFrameH * 0.9;
    float dps = boardDist(ps);
    float inFrame = (1.0 - smoothstep(b - 0.04, b + 0.08, dps));
    float vis2 = vis * (1.0 - 0.75 * inFrame);
    col = light(s, N, vis2);
    col *= mix(0.6, 1.0, smoothstep(b, b + 0.35, d));
#endif
  }
#endif
#ifdef POST_SHADE
  col = postShade(p, d, col, fw);
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeFrameMaterial(biome: number, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: FRAME_VERT,
    fragmentShader: FRAME_FRAG,
    uniforms,
    defines: { BIOME: biome },
    toneMapped: true,
  });
}
