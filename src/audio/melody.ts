// Motif-based melody generator: short motifs, repetition with variation, 4-bar phrases
// (antecedent ends on the 5th, consequent resolves to the tonic), sections of 4 phrases (A A B A).
import { Rng, pick } from './dsp';

export interface MelNote {
  step: number;
  deg: number;
  len: number;
  vel: number;
  /** Phrase-final note. */
  end?: boolean;
  /** Bar index inside the phrase (0..3). */
  pbar: number;
}

interface Motif { rh: number[]; iv: number[] }

export interface MelodyCfg {
  /** Rhythm templates (durations in 16th steps, negative = rest), each summing to 16. */
  rhythms: number[][];
  cadences: number[][];
  /** Scale size (notes per octave) and index of the 5th. */
  n: number;
  fifth: number;
  lo: number;
  hi: number;
  /** Probability of a larger leap. */
  leap: number;
  /** Adds an empty "breath" bar after each phrase (sparse styles). */
  breath?: boolean;
}

export class MotifMelody {
  private A!: Motif;
  private B!: Motif;
  private phrase = 0;
  private pbar = 0;
  private lastDeg = 0;
  /** True when the bar just generated was the breath bar. */
  breathBar = false;
  constructor(private rng: Rng, private cfg: MelodyCfg) {
    this.A = this.motif();
    this.B = this.motif();
  }
  reset() { this.phrase = 0; this.pbar = 0; }
  get barInPhrase() { return this.pbar; }
  get phraseIndex() { return this.phrase; }

  private motif(): Motif {
    const rh = pick(this.rng, this.cfg.rhythms).slice();
    const iv: number[] = [];
    let prevLeap = 0;
    for (let i = 0; i < rh.length; i++) {
      if (i === 0) { iv.push(0); continue; }
      let step: number;
      if (prevLeap !== 0) step = -Math.sign(prevLeap); // gap-fill after a leap
      else {
        const r = this.rng();
        const mag = r < 1 - this.cfg.leap ? 1 : r < 1 - this.cfg.leap * 0.35 ? 2 : 3;
        step = (this.rng() < 0.5 ? -1 : 1) * mag;
        if (this.rng() < 0.12) step = 0; // repeated note
      }
      prevLeap = Math.abs(step) >= 2 ? step : 0;
      iv.push(step);
    }
    return { rh, iv };
  }

  private clampDeg(d: number) {
    const { lo, hi } = this.cfg;
    while (d > hi) d -= 2;
    while (d < lo) d += 2;
    return d;
  }

  private render(m: Motif, base: number, pbar: number, vel: number, thin: number, rhythm?: number[]): MelNote[] {
    const out: MelNote[] = [];
    let step = 0, deg = base, ni = 0;
    const rh = rhythm ?? m.rh;
    for (const d of rh) {
      if (d > 0) {
        deg = this.clampDeg(deg + (m.iv[ni] ?? 0));
        ni++;
        const accent = step === 0 ? 1 : step % 4 === 0 ? 0.85 : 0.7;
        if (!(thin > 0 && step > 0 && this.rng() < thin))
          out.push({ step, deg, len: d, vel: vel * accent * (0.9 + this.rng() * 0.2), pbar });
      }
      step += Math.abs(d);
    }
    if (out.length) this.lastDeg = out[out.length - 1].deg;
    return out;
  }

  /** Generate one bar of melody. `sparse` thins notes and skips development bars. */
  next(sparse: boolean): MelNote[] {
    const { n, fifth, breath } = this.cfg;
    this.breathBar = false;
    const sec = this.phrase % 4; // A A B A
    const consequent = this.phrase % 2 === 1;
    const pb = this.pbar;
    let notes: MelNote[] = [];
    const thin = sparse ? 0.35 : 0;
    if (pb === 4) {
      this.breathBar = true;
    } else if (pb === 0) {
      const base = sec === 2 ? fifth : consequent ? 1 : 0;
      notes = this.render(sec === 2 ? this.B : this.A, base, 0, 0.9, thin);
    } else if (pb === 1) {
      if (sparse && this.rng() < 0.6) notes = [];
      else {
        const m = sec === 2 ? this.B : this.A;
        const r = this.rng();
        if (r < 0.45) notes = this.render(m, (sec === 2 ? fifth : 0) + (this.rng() < 0.5 ? 1 : 2), 1, 0.85, thin); // sequence
        else if (r < 0.75) {
          // same contour, new rhythm of same note count if possible
          const alt = this.cfg.rhythms.filter((x) => x.filter((d) => d > 0).length === m.rh.filter((d) => d > 0).length);
          notes = this.render(m, sec === 2 ? fifth : 0, 1, 0.85, thin, alt.length ? pick(this.rng, alt) : undefined);
        } else {
          notes = this.render(m, sec === 2 ? fifth : 0, 1, 0.85, thin);
          const last = notes[notes.length - 1];
          if (last) last.deg = this.clampDeg(last.deg + (this.rng() < 0.5 ? 1 : -1));
        }
      }
    } else if (pb === 2) {
      if (sparse && this.rng() < 0.4) notes = [];
      else notes = this.render(sec === 2 ? this.A : this.B, (sec === 2 ? fifth + 1 : 2) + (this.rng() < 0.3 ? 1 : 0), 2, 1, thin);
    } else {
      // cadence
      const target = consequent ? (this.phrase % 4 === 3 && this.rng() < 0.4 ? n : 0) : fifth;
      const rh = pick(this.rng, this.cfg.cadences);
      const cnt = rh.filter((d) => d > 0).length;
      let from = this.lastDeg;
      // approach from above by step when possible
      if (Math.abs(from - target) > cnt + 1 || from === target) from = target + cnt - 1 + (this.rng() < 0.3 ? 1 : 0);
      let step = 0, k = 0;
      for (const d of rh) {
        if (d > 0) {
          const remaining = cnt - 1 - k;
          const deg = remaining === 0 ? target : target + Math.sign(from - target || 1) * Math.min(Math.abs(from - target), remaining);
          notes.push({ step, deg: this.clampDeg(deg), len: d, vel: remaining === 0 ? 0.85 : 0.75, pbar: 3, end: remaining === 0 });
          k++;
        }
        step += Math.abs(d);
      }
      this.lastDeg = target;
    }
    // advance
    this.pbar++;
    if (this.pbar > (breath ? 4 : 3)) {
      this.pbar = 0;
      this.phrase++;
      if (this.phrase % 4 === 0) this.B = this.motif();
      if (this.phrase % 8 === 0) this.A = this.motif();
    }
    return notes;
  }
}
