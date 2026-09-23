// Shared GLSL for the expansion worlds, used by BOTH the sand shader and the deform sim so the
// visual features (shorelines, lakes, drizzle) and the sim rules line up exactly.
// Requires NOISE_GLSL and `float sq(float)` to be defined before it.
export const WORLDS_GLSL = /* glsl */ `
// ---- lapping shore along the top side (pinksands, vaadhoo). edge = world y of the waterline.
// Returns the signed distance behind the (wobbling) waterline: > 0 = under water.
float lapEdgeN(vec2 p, float edge, float t) {
  float wn = gnoise(p * vec2(0.55, 1.6) + vec2(t * 0.11, t * 0.17));
  return p.y - edge + wn * 0.16 + 0.07 * sin(p.x * 0.83 + t * 0.6) + 0.04 * sin(p.x * 2.1 - t * 0.9 + 1.7);
}

// ---- Titan: methane lake along the left side with a drowned, irregular coastline. > 0 = liquid.
float titanLake(vec2 p, vec2 board) {
  float y = p.y;
  float coast = 2.4 + 1.5 * (fbm3(vec2(y * 0.15, 3.7)) - 0.5) + 0.55 * (vnoise(vec2(y * 0.6, 9.1)) - 0.5);
  coast += 1.7 * exp(-sq((y - board.y * 0.64) / 2.1));   // a broad bay
  coast -= 1.1 * exp(-sq((y - board.y * 0.24) / 1.3));   // a headland
  return coast - p.x;
}

// ---- Titan drizzle: one drop per cell every DRIZ_T seconds (random phase + position per drop).
#define DRIZ_C 0.72
#define DRIZ_T 38.0
// Most recent drop in cell cc at time t: xy = world position, z = time since it fell.
vec3 drizzleDrop(vec2 cc, float t) {
  float o = hash12(cc * 1.37 + 0.5);
  float n = floor(t / DRIZ_T - o);
  float tn = (n + o) * DRIZ_T;
  vec2 pos = (cc + 0.18 + 0.64 * hash22(cc + n * 1.31 + 7.7)) * DRIZ_C;
  return vec3(pos, t - tn);
}

// ---- smooth bowl crater with a raised rim (Luna). r = d / R. Returns height, dh/dr in .y
vec2 craterProf(float r, float rimH, float rimW) {
  float u = r * r;
  float bowl = 0.0, db = 0.0;
  if (u < 1.0) { bowl = -(1.0 - u * u * (3.0 - 2.0 * u)); db = 12.0 * r * u * (1.0 - u); }
  float x = (r - 1.0) / rimW;
  float rim = rimH * exp(-x * x);
  float dr = rim * (-2.0 * x / rimW);
  // faint ejecta apron outside the rim
  float ej = r > 1.0 ? rimH * 0.35 * exp(-(r - 1.0) * 2.2) : rimH * 0.35;
  float de = r > 1.0 ? -2.2 * ej : 0.0;
  return vec2(bowl + rim + ej * smoothstep(0.9, 1.1, r), db + dr + de * smoothstep(0.9, 1.1, r));
}
`;
