// Procedural SVG masks for the Legend swatches (collection cards).
// Everything is generated once at module load from the same S-curve used by SNAKE_MASK,
// so Legends read as the same pose as the snakes but with their own silhouettes.
import type { SkinId } from '../types';

interface Pt {
  x: number;
  y: number;
  /** tangent angle (radians) */
  a: number;
}

// The snake pose (viewBox 200x90): M14 66 C 38 66, 44 22, 74 22 S 108 68, 136 66 S 160 34, 176 36
const SEGS: [number, number][][] = [
  [[14, 66], [38, 66], [44, 22], [74, 22]],
  [[74, 22], [104, 22], [108, 68], [136, 66]],
  [[136, 66], [164, 64], [160, 34], [176, 36]],
];

function bez(p: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
  const y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
  return [x, y];
}

// dense polyline, then arc-length lookup
const DENSE: [number, number][] = [];
for (const s of SEGS) for (let i = 0; i < 120; i++) DENSE.push(bez(s, i / 120));
DENSE.push([176, 36]);
const CUM: number[] = [0];
for (let i = 1; i < DENSE.length; i++) CUM.push(CUM[i - 1] + Math.hypot(DENSE[i][0] - DENSE[i - 1][0], DENSE[i][1] - DENSE[i - 1][1]));
const LEN = CUM[CUM.length - 1];

/** Point at arc length s (0 = tail, LEN = neck). */
function at(s: number): Pt {
  s = Math.max(0, Math.min(LEN, s));
  let i = 1;
  while (i < CUM.length - 1 && CUM[i] < s) i++;
  const [x0, y0] = DENSE[i - 1];
  const [x1, y1] = DENSE[i];
  const f = (s - CUM[i - 1]) / Math.max(1e-6, CUM[i] - CUM[i - 1]);
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a: Math.atan2(y1 - y0, x1 - x0) };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const deg = (a: number) => r1((a * 180) / Math.PI);
/** offset along the normal (+ = right side of travel, i.e. below for a rightward path) */
function off(p: Pt, n: number, t = 0): [number, number] {
  return [r1(p.x - Math.sin(p.a) * n + Math.cos(p.a) * t), r1(p.y + Math.cos(p.a) * n + Math.sin(p.a) * t)];
}
const url = (inner: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 90">${inner}</svg>`)}")`;
const along = (from: number, to: number, step: number, fn: (p: Pt, s: number, i: number) => string) => {
  let out = '';
  let i = 0;
  for (let s = from; s <= to + 0.01; s += step) out += fn(at(s), s, i++);
  return out;
};
const rot = (p: Pt, extraDeg = 0) => `transform="rotate(${deg(p.a) + extraDeg} ${r1(p.x)} ${r1(p.y)})"`;
const poly = (pts: [number, number][], attrs = '') => `<polygon points="${pts.map((q) => q.join(',')).join(' ')}" ${attrs}/>`;
const line = (a: [number, number], b: [number, number], w: number) =>
  `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#000" stroke-width="${w}" stroke-linecap="round"/>`;
const HEAD = at(LEN);

export interface LegendLayer {
  mask: string;
  bg: string;
}
export interface LegendArt {
  mask: string;
  bg: string;
  layers: LegendLayer[];
}

// ------------------------------------------------------------------ centipede
function centipede(): LegendArt {
  const legs = along(6, LEN - 6, 8.5, (p, _s, i) => {
    const sway = i % 2 ? 1.5 : -1.5;
    return line([r1(p.x), r1(p.y)], off(p, 15, -5 + sway), 2) + line([r1(p.x), r1(p.y)], off(p, -15, -5 - sway), 2);
  });
  const segs = along(4, LEN - 4, 8.5, (p) => `<ellipse cx="${r1(p.x)}" cy="${r1(p.y)}" rx="4.9" ry="8.6" ${rot(p)}/>`);
  const head = `<ellipse cx="${r1(HEAD.x + 5)}" cy="${r1(HEAD.y)}" rx="9" ry="8" ${rot(HEAD)}/>`;
  const ant = `<path d="M${r1(HEAD.x + 10)} ${r1(HEAD.y - 4)} Q 192 22 198 18 M${r1(HEAD.x + 10)} ${r1(HEAD.y + 4)} Q 194 46 199 52" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>`;
  const plates = along(4, LEN - 4, 8.5, (p) => `<ellipse cx="${r1(p.x)}" cy="${r1(p.y)}" rx="3.1" ry="6.4" ${rot(p)}/>`) + `<ellipse cx="${r1(HEAD.x + 5)}" cy="${r1(HEAD.y)}" rx="6.5" ry="5.6" ${rot(HEAD)}/>`;
  return {
    mask: url(legs + segs + head + ant),
    bg: 'linear-gradient(90deg, #2a120a, #4a1c0c 60%, #6a2a12)',
    layers: [{ mask: url(plates), bg: 'linear-gradient(90deg, #a8521c, #f09a2a 70%, #ffc76a)' }],
  };
}

// ------------------------------------------------------------------ electric eel
function eel(): LegendArt {
  const body = along(0, LEN, 2, (p, s) => `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(2.2 + 5.2 * Math.min(1, s / (LEN * 0.55)))}"/>`);
  const head = `<ellipse cx="${r1(HEAD.x + 5)}" cy="${r1(HEAD.y)}" rx="12" ry="7.6" ${rot(HEAD)}/>`;
  // long anal fin ribbon along the underside
  const fin = along(4, LEN - 22, 2, (p, s) => {
    const r = 2.2 + 5.2 * Math.min(1, s / (LEN * 0.55));
    const [x, y] = off(p, r + 2.2);
    return `<circle cx="${x}" cy="${y}" r="2.1" opacity=".72"/>`;
  });
  // lightning: zig-zag along the spine
  let d = '';
  let i = 0;
  for (let s = 10; s <= LEN - 2; s += 7, i++) {
    const [x, y] = off(at(s), i % 2 ? -2.4 : 2.4);
    d += `${i ? 'L' : 'M'}${x} ${y} `;
  }
  const bolt = `<path d="${d}" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const eye = `<circle cx="${r1(HEAD.x + 9)}" cy="${r1(HEAD.y - 2)}" r="1.6"/>`;
  return {
    mask: url(fin + body + head),
    bg: 'linear-gradient(90deg, #1e2a22, #2a3a2e 45%, #3d5140 80%, #4a5f45)',
    layers: [{ mask: url(bolt + eye), bg: 'linear-gradient(90deg, #3fd6c4, #7affea 60%, #e8fffb)' }],
  };
}

// ------------------------------------------------------------------ celestial dragon
function dragon(): LegendArt {
  const rad = (s: number) => 2.4 + 6.6 * Math.min(1, s / (LEN * 0.5));
  const body = along(0, LEN, 2, (p, s) => `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(rad(s))}"/>`);
  const head =
    `<ellipse cx="${r1(HEAD.x + 5)}" cy="${r1(HEAD.y)}" rx="13" ry="9" ${rot(HEAD)}/>` +
    poly([off(HEAD, -6, 2), off(HEAD, -15, -8), off(HEAD, -7, -3)]) +
    poly([off(HEAD, -4, 7), off(HEAD, -14, 0), off(HEAD, -5, 3)]);
  // golden mane / dorsal spikes along the upper side, whiskers from the snout
  const mane = along(16, LEN - 6, 7.5, (p, s) => {
    const r = rad(s);
    return poly([off(p, -r + 1, -3.2), off(p, -r - 4.5 - (s > LEN - 30 ? 2.5 : 0), -5.5), off(p, -r + 1, 3.2)]);
  });
  const snout = off(HEAD, 0, 16);
  const whisk = `<path d="M${snout[0]} ${snout[1] - 2} C ${snout[0] + 5} ${snout[1] - 8}, ${snout[0] + 1} ${snout[1] - 16}, ${snout[0] - 6} ${snout[1] - 20} M${snout[0]} ${snout[1] + 2} C ${snout[0] + 5} ${snout[1] + 8}, ${snout[0] + 1} ${snout[1] + 16}, ${snout[0] - 6} ${snout[1] + 20}" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/>`;
  const belly = along(6, LEN - 4, 2, (p, s) => {
    const [x, y] = off(p, rad(s) * 0.55);
    return `<circle cx="${x}" cy="${y}" r="${r1(rad(s) * 0.32)}"/>`;
  });
  const tuft = poly([off(at(3), -1, 2), off(at(0), -9, -10), off(at(0), 0, -6), off(at(0), 9, -10), off(at(3), 1, 2)]);
  return {
    mask: url(body + head),
    bg: 'radial-gradient(circle at 50% 100%, transparent 0 3px, rgba(0,20,10,.35) 3.4px 4px, transparent 4.4px) 0 0/8px 6px, linear-gradient(90deg, #0a4a33, #0f6a4a 45%, #1c8a60)',
    layers: [
      { mask: url(mane + whisk + belly), bg: 'linear-gradient(90deg, #b8860b, #f2c94c 50%, #fff0a8)' },
      { mask: url(tuft), bg: 'linear-gradient(90deg, #8a1f14, #c0392b)' },
    ],
  };
}

// ------------------------------------------------------------------ mecha
function mecha(): LegendArt {
  const plates = along(5, LEN - 10, 11.5, (p) => `<rect x="${r1(p.x - 4.8)}" y="${r1(p.y - 8.5)}" width="9.6" height="17" rx="2.4" ${rot(p)}/>`);
  const spine = `<path d="M${DENSE.map((q) => `${r1(q[0])} ${r1(q[1])}`).join(' L')}" fill="none" stroke="#000" stroke-width="7"/>`;
  const head =
    `<rect x="${r1(HEAD.x - 6)}" y="${r1(HEAD.y - 9)}" width="22" height="18" rx="3.5" ${rot(HEAD)}/>` +
    poly([off(HEAD, -7, 14), off(HEAD, -3, 23), off(HEAD, 3, 23), off(HEAD, 7, 14)]);
  const joints = along(10.75, LEN - 10, 11.5, (p) => `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="1.9"/>`);
  const visor = `<rect x="${r1(HEAD.x + 5)}" y="${r1(HEAD.y - 5.5)}" width="11" height="3" rx="1.5" ${rot(HEAD)}/>`;
  return {
    mask: url(spine + plates + head),
    bg: 'repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 1px, transparent 1px 3px), linear-gradient(180deg, #d5dbe2, #8a939e 45%, #4a525c 80%, #2a2f36)',
    layers: [{ mask: url(joints + visor), bg: 'radial-gradient(circle, #e8fdff, #35e0ff 70%)' }],
  };
}

// ------------------------------------------------------------------ steam train
function train(): LegendArt {
  const cars: Pt[] = [];
  for (let s = 13; s <= LEN - 30; s += 27) cars.push(at(s));
  const eng = at(LEN - 6);
  const coupler = `<path d="M${DENSE.map((q) => `${r1(q[0])} ${r1(q[1])}`).join(' L')}" fill="none" stroke="#000" stroke-width="3"/>`;
  const bodies =
    cars.map((p) => `<rect x="${r1(p.x - 11.5)}" y="${r1(p.y - 9)}" width="23" height="17" rx="2.8" ${rot(p)}/>`).join('') +
    `<rect x="${r1(eng.x - 14)}" y="${r1(eng.y - 9)}" width="30" height="18" rx="4" ${rot(eng)}/>` +
    `<rect x="${r1(eng.x + 7)}" y="${r1(eng.y - 16)}" width="5.5" height="9" rx="1" ${rot(eng)}/>` +
    poly([off(eng, 2, 16), off(eng, 9, 22), off(eng, 9, 15)]);
  const roofs = cars.map((p) => `<rect x="${r1(p.x - 12.5)}" y="${r1(p.y - 10.5)}" width="25" height="4" rx="2" ${rot(p)}/>`).join('') + `<rect x="${r1(eng.x - 15)}" y="${r1(eng.y - 10.5)}" width="12" height="4" rx="2" ${rot(eng)}/>`;
  const wheels =
    cars.map((p) => [off(p, 8.5, -6.5), off(p, 8.5, 6.5)].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4"/>`).join('')).join('') +
    [off(eng, 8.8, -9), off(eng, 8.8, 0), off(eng, 8.8, 9)].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.8"/>`).join('');
  const windows =
    cars.map((p) => [-6, 0, 6].map((t) => { const [x, y] = off(p, -2.5, t); return `<rect x="${r1(x - 2)}" y="${r1(y - 2.4)}" width="4" height="4.8" rx=".8" ${rot({ ...p, x, y })}/>`; }).join('')).join('') +
    `<circle cx="${off(eng, -1, 11)[0]}" cy="${off(eng, -1, 11)[1]}" r="2.2"/>` +
    `<rect x="${r1(off(eng, 0, -1.5)[0] - 12)}" y="${r1(off(eng, 0, -1.5)[1] - 0.8)}" width="24" height="1.6" ${rot(eng)}/>`;
  return {
    mask: url(coupler + bodies),
    bg: 'linear-gradient(180deg, #d9483c, #b8322a 55%, #7a1e18)',
    layers: [
      { mask: url(roofs + wheels), bg: 'linear-gradient(180deg, #34323a, #1b1b1f)' },
      { mask: url(windows), bg: 'linear-gradient(90deg, #d8b25a, #ffe6a0)' },
    ],
  };
}

// ------------------------------------------------------------------ comet
function comet(): LegendArt {
  const tail = along(0, LEN, 2, (p, s) => {
    const u = s / LEN;
    return `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(1.5 + 10.5 * u ** 1.6)}" opacity="${r1(0.08 + 0.92 * u ** 1.3)}"/>`;
  });
  const head = `<circle cx="${r1(HEAD.x + 4)}" cy="${r1(HEAD.y)}" r="13"/>`;
  const core = `<circle cx="${r1(HEAD.x + 5)}" cy="${r1(HEAD.y)}" r="7.5"/>` +
    along(20, LEN - 30, 17, (p, _s, i) => { const [x, y] = off(p, i % 2 ? 9 : -10, 3); return `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1 : 1.5}"/>`; });
  return {
    mask: url(tail + head),
    bg: 'linear-gradient(90deg, #1a2a6a 0%, #2f55c8 40%, #6fb8ff 70%, #9fe8ff 88%, #ffffff)',
    layers: [{ mask: url(core), bg: 'radial-gradient(circle at 92% 40%, #ffffff 0 6%, #dff8ff 12%, #9fe8ff 40%)' }],
  };
}

export const LEGEND_ART: Partial<Record<SkinId, LegendArt>> = {
  centipede: centipede(),
  eel: eel(),
  dragon: dragon(),
  mecha: mecha(),
  train: train(),
  comet: comet(),
};
