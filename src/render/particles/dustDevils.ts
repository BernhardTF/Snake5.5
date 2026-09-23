// Deterministic dust-devil wander paths, shared by the particle columns
// (Particles.ts) and the sand swirl shader (world designer's sand code), so
// both layers agree on where each devil is.
//
// Coordinates are in board cells: x in [0, boardW], y in [0, boardH] (y is the
// same axis the sand uses for rows). A devil may drift up to ~1.5 cells beyond
// the board edge and back. Pure function of time; no allocation apart from the
// returned object (callers in hot paths should use dustDevilPosInto).

export interface DustDevilPos {
  x: number;
  y: number;
  r: number;
}

// Per-devil constants: base frequencies/phases chosen to be incommensurate so
// the paths never visibly loop.
const FX = [0.031, 0.023];
const FY = [0.027, 0.036];
const PX = [0.0, 2.1];
const PY = [1.3, 4.4];
const FR = [0.21, 0.17];

/** Write the devil position into `out` (no allocation). index 0..1. */
export function dustDevilPosInto(
  out: DustDevilPos,
  time: number,
  index: number,
  boardW: number,
  boardH: number,
): DustDevilPos {
  const i = index <= 0 ? 0 : 1;
  const t = time;
  // Sum of two sines per axis: slow sweeping drift + small meander.
  const u =
    0.5 +
    0.46 * Math.sin(t * FX[i] * 6.2832 + PX[i]) +
    0.1 * Math.sin(t * FX[i] * 6.2832 * 2.7 + PY[i] * 1.7);
  const v =
    0.5 +
    0.44 * Math.sin(t * FY[i] * 6.2832 + PY[i]) +
    0.1 * Math.sin(t * FY[i] * 6.2832 * 3.1 + PX[i] * 1.3);
  // u,v span roughly -0.06..1.06 -> occasionally slightly off-board.
  out.x = u * boardW;
  out.y = v * boardH;
  out.r = 1.1 + 0.3 * Math.sin(t * FR[i] * 6.2832 + i * 1.9);
  return out;
}

/** Position of dust devil `index` (0..1) at `time` seconds, in board cells. */
export function dustDevilPos(
  time: number,
  index: number,
  boardW: number,
  boardH: number,
): { x: number; y: number; r: number } {
  return dustDevilPosInto({ x: 0, y: 0, r: 0 }, time, index, boardW, boardH);
}

/**
 * How active dust devil `index` is at `time` (0 = calm, 1 = full column). Devils come and go over
 * roughly a minute, so they read as occasional; each is active a bit over half the time.
 */
export function dustDevilStrength(time: number, index: number): number {
  const i = index <= 0 ? 0 : 1;
  const s = 0.5 + 0.5 * Math.sin(time * (i ? 0.0157 : 0.0191) * 6.2832 + i * 2.6);
  const x = Math.min(1, Math.max(0, (s - 0.3) / 0.35));
  return x * x * (3 - 2 * x);
}
