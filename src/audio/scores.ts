// Generative biome scores + the lookahead sequencer runtime that plays them.
import type { BiomeId } from '../types';
import { AmbienceBed } from './ambience';
import { Rng, degToSemi, mtof as mtofHz, mulberry32, pick } from './dsp';
import type { LeadKind, Synth } from './instruments';
import { MotifMelody } from './melody';
import type { Voice, VoiceTracker } from './voices';

export type Layer = 0 | 1 | 2 | 3;
type EvFn = (t: number, sd: number) => void;

export interface BarCtx {
  bar: number;
  rng: Rng;
  sparse: boolean;
  at(step: number, layer: Layer, fn: EvFn): void;
}

export interface MusicHost {
  ctx: BaseAudioContext;
  synth: Synth;
  musicVoices: VoiceTracker;
}

/** Musical identity shared with SFX (eat notes, chords…). */
export interface BiomeKey {
  root: number;
  scale: number[];
  lead: LeadKind;
  /** Lead register for SFX (midi of degree 0). */
  sfxRoot: number;
  fifth: number;
}

export const BIOME_KEYS: Record<BiomeId, BiomeKey> = {
  karesansui: { root: 64, scale: [0, 1, 5, 7, 8], lead: 'koto', sfxRoot: 76, fifth: 3 },
  erg: { root: 50, scale: [0, 1, 4, 5, 7, 8, 10], lead: 'oud', sfxRoot: 74, fifth: 4 },
  lagoon: { root: 55, scale: [0, 2, 4, 7, 9], lead: 'slack', sfxRoot: 79, fifth: 3 },
  svartsandur: { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], lead: 'bell', sfxRoot: 81, fifth: 4 },
  salar: { root: 57, scale: [0, 3, 5, 7, 10], lead: 'charango', sfxRoot: 81, fifth: 3 },
  // C major calypso
  pinksands: { root: 60, scale: [0, 2, 4, 5, 7, 9, 11], lead: 'pan', sfxRoot: 72, fifth: 4 },
  // D dorian night
  vaadhoo: { root: 50, scale: [0, 2, 3, 5, 7, 9, 10], lead: 'mallet', sfxRoot: 74, fifth: 4 },
  // A tizita (minor) pentatonic
  dallol: { root: 57, scale: [0, 2, 3, 7, 8], lead: 'krar', sfxRoot: 69, fifth: 3 },
  // C lydian
  luna: { root: 60, scale: [0, 2, 4, 6, 7, 9, 11], lead: 'theremin', sfxRoot: 72, fifth: 4 },
  // E aeolian
  mars: { root: 52, scale: [0, 2, 3, 5, 7, 8, 10], lead: 'analog', sfxRoot: 76, fifth: 4 },
  // D phrygian, deep
  titan: { root: 38, scale: [0, 1, 3, 5, 7, 8, 10], lead: 'sonar', sfxRoot: 62, fifth: 4 },
  // A "rast"-like scale with quarter tones (neutral 3rd and 7th)
  kepler: { root: 57, scale: [0, 2, 3.5, 5, 7, 9, 10.5], lead: 'crystal', sfxRoot: 81, fifth: 4 },
};

export abstract class Score {
  abstract readonly bpm: number;
  readonly key: BiomeKey;
  protected rng: Rng;
  constructor(readonly id: BiomeId, protected h: MusicHost, readonly rt: ScoreRuntime, seed: number) {
    this.key = BIOME_KEYS[id];
    this.rng = mulberry32(seed);
  }
  get s() { return this.h.synth; }
  /** New voice routed to a layer. */
  v(layer: Layer): Voice { return this.h.musicVoices.voice(this.rt.layers[layer]); }
  /** midi for a scale degree relative to key root (+ octave offset). */
  m(deg: number, oct = 0) { return this.key.root + degToSemi(this.key.scale, deg) + 12 * oct; }
  abstract bar(c: BarCtx): void;
  /** Lead instrument voice used by melody + outro. */
  abstract lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean): void;
  /** Called after restart: reset phrase position. */
  resetPhrase() {}
  /** Gentle resolving phrase for game over. */
  outro(c: BarCtx) {
    const n = this.key.scale.length;
    const degs = [this.key.fifth + 1, this.key.fifth, 2, 1, 0];
    const lens = [2, 2, 2, 2, 10];
    let st = 0;
    degs.forEach((d, i) => { this.lead(c, st, 1, d, lens[i], i === degs.length - 1 ? 0.7 : 0.55, i === degs.length - 1); st += lens[i]; });
    this.lead(c, 8, 1, -n, 8, 0.35, true);
  }
}

// ======================================================================= Karesansui (Kyoto)

class KyotoScore extends Score {
  readonly bpm = 63;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[4, 4, 8], [6, 2, 8], [4, -2, 2, 8], [8, 4, 4], [2, 2, 4, -8], [4, -4, 8], [6, 2, -4, 4], [3, 1, 4, 8]],
    cadences: [[4, 12], [2, 2, 12], [4, 4, 8]],
    n: 5, fifth: 3, lo: -2, hi: 8, leap: 0.25, breath: true,
  });
  private knockIn = 3;
  private melBuf: { step: number; deg: number }[] = [];
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg);
    const bendUp = !end && len >= 8 && this.rng() < 0.3;
    const bend = bendUp ? this.m(deg + 1) - midi : 0;
    const back = this.rng() < 0.5;
    c.at(step, layer, (t, sd) => {
      this.s.pluck(this.v(layer), t, 'koto', midi, len * sd, vel * 1.0, { bend, bendAt: 0.3 + this.rng() * 0.2, bendBack: back, pan: -0.15 });
      if (end) this.s.pluck(this.v(layer), t + 0.012, 'kotoBass', midi - 12, len * sd, vel * 0.45, { pan: 0.1 });
    });
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    const notes = this.mel.next(c.sparse);
    this.melBuf = [];
    for (const nt of notes) {
      this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
      this.melBuf.push({ step: nt.step, deg: nt.deg });
    }
    // shakuhachi answers in the breath bar; long tone under B motif at higher intensity
    if (this.mel.breathBar && (!c.sparse || this.rng() < 0.6)) {
      const deg = pick(this.rng, [3, 4, 2, 5]);
      const start = pick(this.rng, [0, 2, 4]);
      c.at(start, 1, (t, sd) => this.s.flute(this.v(1), t, 'shakuhachi', this.m(deg), (14 - start) * sd, 0.16, { fall: this.rng() < 0.5, pan: 0.25 }));
    }
    if (pb === 2 && !c.sparse) {
      c.at(0, 3, (t, sd) => this.s.flute(this.v(3), t, 'shakuhachi', this.m(this.key.fifth - 5), 14 * sd, 0.06, { pan: 0.3 }));
    }
    // ambience: shishi-odoshi knock
    if (--this.knockIn <= 0) {
      this.knockIn = 3 + Math.floor(this.rng() * 4);
      const st = 2 + Math.floor(this.rng() * 12);
      c.at(st, 0, (t) => {
        this.s.wood(this.v(0), t, 360, 0.09, 0.11, 0.4);
        this.s.wood(this.v(0), t + 0.16, 380, 0.025, 0.08, 0.45);
      });
    }
    // layer 2: bass + soft taiko
    const bassDeg = pb === 3 ? 2 : pb === 0 ? 3 : 0; // A / B / E
    c.at(0, 2, (t, sd) => this.s.pluck(this.v(2), t, 'kotoBass', this.m(bassDeg === 3 ? -2 : bassDeg === 2 ? -3 : -5), 12 * sd, 0.24));
    c.at(8, 2, (t, sd) => this.s.pluck(this.v(2), t, 'kotoBass', this.m(-2), 8 * sd, 0.16));
    c.at(0, 2, (t) => this.s.membrane(this.v(2), t, 82, 55, 0.3, 0.22, 260, 0.25));
    c.at(10, 2, (t) => this.s.membrane(this.v(2), t, 78, 54, 0.22, 0.16, 260, 0.2));
    for (const st of [3, 6, 11, 14]) c.at(st, 2, (t, sd) => this.s.pluck(this.v(2), t, 'kotoBass', this.m(st % 2 ? 0 : 3, -1), 3 * sd, 0.12, { pan: 0.35 }));
    // layer 3: taiko fuller, wood ticks, koto canon an octave up
    c.at(12, 3, (t) => this.s.membrane(this.v(3), t, 90, 58, 0.2, 0.14, 300, 0.2));
    c.at(14, 3, (t) => this.s.membrane(this.v(3), t, 90, 58, 0.15, 0.08, 300, 0.2));
    for (let st = 2; st < 16; st += 4) c.at(st, 3, (t) => this.s.wood(this.v(3), t, 1150, 0.035, 0.03, -0.5));
    for (const n of this.melBuf) c.at(n.step + 2, 3, (t, sd) => this.s.pluck(this.v(3), t, 'koto', this.m(n.deg, 1), 4 * sd, 0.1, { pan: 0.5 }));
    if (pb === 0) c.at(0, 3, (t) => this.s.bell(this.v(3), t, this.m(0, 1), 3, 0.04, { glass: true, pan: -0.4 }));
  }
}

// ======================================================================= Erg Chebbi (Sahara)

class ErgScore extends Score {
  readonly bpm = 88;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[2, 2, 2, 2, 4, 4], [3, 1, 2, 2, 8], [4, 2, 2, 4, 4], [2, 2, 4, 2, 2, 4], [1, 1, 2, 4, 4, 4], [6, 2, 4, 4], [2, 2, 2, 2, 8]],
    cadences: [[2, 2, 4, 8], [4, 4, 8], [1, 1, 2, 12]],
    n: 7, fifth: 4, lo: -3, hi: 10, leap: 0.2,
  });
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 1);
    const grace = !end && len >= 4 && this.rng() < 0.25 ? this.m(deg - 1, 1) : 0;
    c.at(step, layer, (t, sd) => {
      if (grace) this.s.pluck(this.v(layer), t - 0.05, 'oud', grace, 0.06, vel * 0.25);
      if (len >= 6) {
        // risha tremolo on long notes
        const reps = Math.floor(len);
        const v = this.v(layer);
        for (let i = 0; i < reps; i++) this.s.pluck(v, t + i * sd, 'oud', midi, sd * 1.2, vel * 0.64 * (i === 0 ? 1 : 0.55 - i * 0.02), { pan: -0.1 });
      } else this.s.pluck(this.v(layer), t, 'oud', midi, len * sd * 1.3, vel * 0.72, { pan: -0.1 });
    });
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // drone on D (+A) every 2 bars, overlapping
    if (c.bar % 2 === 0) {
      c.at(0, 0, (t, sd) => {
        const d = 32 * sd * 1.45;
        this.s.drone(this.v(0), t, this.key.root - 12, d, 0.05, { bright: 0.7 });
        this.s.drone(this.v(0), t + 0.5, this.key.root - 5, d, 0.025, { bright: 0.6 });
      });
    }
    // layer 2: maqsum on bendir + oud ostinato
    const D: [number, 'dum' | 'tak', number][] = [[0, 'dum', 0.5], [2, 'tak', 0.28], [6, 'tak', 0.3], [8, 'dum', 0.45], [12, 'tak', 0.32]];
    for (const [st, k, vel] of D) c.at(st, 2, (t) => this.s.bendir(this.v(2), t, k, vel * 0.7 * (0.9 + this.rng() * 0.2), k === 'tak' ? 0.2 : 0));
    const ost = c.bar % 2 === 0 ? [[0, 0], [6, 0], [8, 1], [11, 0], [14, -1]] : [[0, 0], [6, 0], [8, 2], [11, 3], [14, 2]];
    for (const [st, dg] of ost) c.at(st, 2, (t, sd) => this.s.pluck(this.v(2), t, 'oud', this.m(dg), 3 * sd, st === 0 ? 0.26 : 0.19, { pan: 0.15 }));
    // layer 3: ghosts, riq-like shaker, ney counter line
    for (const st of [4, 10, 14, 15]) c.at(st, 3, (t) => this.s.bendir(this.v(3), t, 'ghost', 0.22, -0.25));
    for (let st = 1; st < 16; st += 2) c.at(st, 3, (t) => this.s.shaker(this.v(3), t, 0.035 + (st % 4 === 3 ? 0.02 : 0), 0.04, 6500, 0.3));
    const ney = [4, 5, 3, 2][pb] ?? 4;
    c.at(2, 3, (t, sd) => this.s.flute(this.v(3), t, 'ney', this.m(ney), 12 * sd, 0.05, { pan: 0.35, scoop: true }));
  }
}

// ======================================================================= Motu Lagoon (Polynesia)

const sw = (st: number) => st + (st % 4 === 2 ? 0.3 : 0);

class LagoonScore extends Score {
  readonly bpm = 80;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[3, 3, 2, 4, 4], [2, 4, 2, 4, 4], [3, 3, 4, 6], [4, 2, 2, 8], [2, 2, 3, 3, 6], [3, 3, 2, 8]],
    cadences: [[3, 3, 10], [4, 4, 8], [2, 2, 4, 8]],
    n: 5, fifth: 3, lo: -2, hi: 8, leap: 0.25,
  });
  private chords = [[0, 4, 7], [5, 9, 12], [0, 4, 7], [7, 11, 14]];
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 1);
    const ham = !end && this.rng() < 0.22 ? 2 : 0;
    const dbl = len >= 6 ? this.m(deg - 2, 1) : 0;
    c.at(sw(step), layer, (t, sd) => {
      this.s.pluck(this.v(layer), t, 'slack', midi, len * sd * 1.4, vel * 0.58, { slide: ham, pan: -0.12 });
      if (dbl) this.s.pluck(this.v(layer), t + 0.01, 'slack', dbl, len * sd * 1.4, vel * 0.22, { pan: -0.2 });
    });
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    const ch = this.chords[pb % 4];
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // warm pad (ambience layer)
    c.at(0, 0, (t, sd) => this.s.pad(this.v(0), t, ch.map((x) => this.key.root + x), 16 * sd * 1.15, 0.035, { cutoff: 850 }));
    // layer 2: alternating thumb bass + log drum 3-3-2
    const r = this.key.root - 12 + ch[0];
    const bass: [number, number][] = [[0, r], [4, r + 7], [8, r], [12, r + 7]];
    for (const [st, m] of bass) c.at(st, 2, (t, sd) => this.s.pluck(this.v(2), t, 'slack', m, 3.5 * sd, st === 0 ? 0.42 : 0.3, { pan: 0.1 }));
    for (const [st, f, vel] of [[0, 380, 0.22], [3, 520, 0.16], [6, 380, 0.18], [10, 520, 0.15], [12, 380, 0.2], [14, 460, 0.12]] as const)
      c.at(st, 2, (t) => this.s.wood(this.v(2), t, f, vel, 0.06, st % 2 ? 0.3 : -0.2));
    // layer 3: syncopated picking arpeggio, ipu-like shaker, extra log ghosts
    const arp = [ch[1], ch[2], ch[0] + 12, ch[2], ch[1] + 12];
    [2, 6, 10, 11, 14].forEach((st, i) => c.at(sw(st), 3, (t, sd) => this.s.pluck(this.v(3), t, 'slack', this.key.root + 12 + arp[i] - 12, 2 * sd, 0.22, { pan: 0.35 })));
    for (let st = 2; st < 16; st += 4) c.at(sw(st), 3, (t) => this.s.shaker(this.v(3), t, 0.07, 0.07, 4500, -0.35));
    for (const st of [7, 9, 15]) c.at(st, 3, (t) => this.s.wood(this.v(3), t, 600, 0.07, 0.04, 0.4));
  }
}

// ======================================================================= Svartsandur (Iceland)

class IcelandScore extends Score {
  readonly bpm = 56;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[8, 8], [4, 4, 8], [12, 4], [6, 2, 8], [-4, 4, 8], [4, -4, 8], [8, -4, 4]],
    cadences: [[4, 12], [16], [8, 8]],
    n: 7, fifth: 4, lo: 0, hi: 11, leap: 0.3, breath: true,
  });
  private chords = [[45, 52, 60], [41, 48, 57], [38, 45, 53], [40, 47, 55]];
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 2);
    c.at(step, layer, (t, sd) => {
      this.s.bell(this.v(layer), t, midi, Math.max(2.5, len * sd * 1.2), vel * 0.26, { pan: -0.2 + this.rng() * 0.4 });
      if (end) this.s.bell(this.v(layer), t + 0.02, midi - 12, 4, vel * 0.12, { glass: true });
    });
  }
  bar(c: BarCtx) {
    const chord = this.chords[Math.floor(c.bar / 2) % 4];
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // evolving bowed drones: bass + fifth every 2 bars (overlapping)
    if (c.bar % 2 === 0) {
      c.at(0, 0, (t, sd) => {
        const d = 32 * sd * 1.4;
        this.s.drone(this.v(0), t, chord[0], d, 0.045, { bright: 0.6, pan: -0.2 });
        this.s.drone(this.v(0), t + 0.7, chord[1], d, 0.028, { bright: 0.8, pan: 0.2 });
      });
      c.at(4, 3, (t, sd) => this.s.drone(this.v(3), t, chord[2] + 12, 28 * sd, 0.04, { bright: 1.2 }));
    }
    if (this.rng() < 0.3) {
      const st = Math.floor(this.rng() * 14);
      const m = pick(this.rng, chord) + 24;
      c.at(st, 0, (t) => this.s.bell(this.v(0), t, m, 5, 0.025, { glass: true, pan: this.rng() * 1.2 - 0.6 }));
    }
    // layer 2: deep pulse (lub-dub)
    c.at(0, 2, (t) => this.s.membrane(this.v(2), t, 58, 40, 0.35, 0.34, 150, 0.2));
    c.at(3, 2, (t) => this.s.membrane(this.v(2), t, 55, 40, 0.3, 0.2, 150, 0.15));
    c.at(8, 2, (t) => this.s.membrane(this.v(2), t, 58, 40, 0.35, 0.22, 150, 0.2));
    // layer 3: shimmering glass arpeggio + soft hits
    const arp = [chord[1] + 24, chord[2] + 12, chord[0] + 36, chord[2] + 24];
    for (let i = 0; i < 8; i++) c.at(i * 2, 3, (t) => this.s.bell(this.v(3), t, arp[i % 4], 1.6, 0.05, { glass: true, pan: i % 2 ? 0.5 : -0.5 }));
    c.at(12, 3, (t) => this.s.membrane(this.v(3), t, 95, 60, 0.25, 0.12, 400, 0.3));
  }
}

// ======================================================================= Salar (Andes)

class SalarScore extends Score {
  readonly bpm = 96;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[2, 1, 1, 2, 1, 1, 4, 4], [4, 2, 2, 4, 4], [2, 1, 1, 4, 2, 2, 4], [3, 1, 2, 2, 8], [2, 2, 4, 4, 4], [2, 1, 1, 8, 4]],
    cadences: [[2, 1, 1, 12], [4, 4, 8], [2, 2, 4, 8]],
    n: 5, fifth: 3, lo: -2, hi: 8, leap: 0.3,
  });
  private chords = [[57, 60, 64, 69], [60, 64, 67, 72], [55, 59, 62, 67], [57, 60, 64, 69]];
  private halfChord = [52, 55, 59, 64];
  private sikuIn = 2;
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 1);
    const scoop = len >= 4 && this.rng() < 0.35;
    c.at(step, layer, (t, sd) => this.s.flute(this.v(layer), t, 'quena', midi, len * sd * 0.92, vel * 0.08, { scoop, pan: -0.15 }));
  }
  private strum(c: BarCtx, step: number, layer: Layer, chord: number[], vel: number, up: boolean) {
    c.at(step, layer, (t, sd) => {
      const v = this.v(layer);
      const notes = up ? chord.slice().reverse() : chord;
      notes.forEach((m, i) => this.s.pluck(v, t + i * 0.011, 'charango', m, 2.2 * sd, vel * (1 - i * 0.08), { pan: 0.2 }));
    });
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    const consequent = this.mel.phraseIndex % 2 === 1;
    const chord = pb === 3 && !consequent ? this.halfChord : this.chords[pb % 4];
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // ambience: siku sighs
    if (--this.sikuIn <= 0) {
      this.sikuIn = 3 + Math.floor(this.rng() * 3);
      const a = pick(this.rng, chord) + 12;
      c.at(4, 0, (t, sd) => {
        this.s.flute(this.v(0), t, 'siku', a, 3 * sd, 0.045, { pan: -0.5 });
        this.s.flute(this.v(0), t + 3 * sd, 'siku', a - (this.rng() < 0.5 ? 2 : 3), 5 * sd, 0.04, { pan: 0.5 });
      });
    }
    // layer 2: huayno strum on beats 1 & 3, bombo, bass
    for (const b of [0, 8]) {
      this.strum(c, b, 2, chord, 0.12, false);
      this.strum(c, b + 2, 2, chord, 0.075, true);
      this.strum(c, b + 3, 2, chord, 0.08, false);
    }
    c.at(0, 2, (t) => this.s.membrane(this.v(2), t, 78, 50, 0.22, 0.34, 900, 0.25));
    c.at(8, 2, (t) => this.s.membrane(this.v(2), t, 78, 50, 0.2, 0.26, 900, 0.25));
    c.at(0, 2, (t, sd) => this.s.pluck(this.v(2), t, 'slack', chord[0] - 12, 6 * sd, 0.26));
    c.at(8, 2, (t, sd) => this.s.pluck(this.v(2), t, 'slack', chord[0] - 5, 6 * sd, 0.24));
    // layer 3: full rasgueo, chajchas, bombo rim, siku hocket
    for (const b of [4, 12]) {
      this.strum(c, b, 3, chord, 0.15, false);
      this.strum(c, b + 2, 3, chord, 0.1, true);
      this.strum(c, b + 3, 3, chord, 0.1, false);
    }
    for (const st of [4, 12]) c.at(st, 3, (t) => this.s.shaker(this.v(3), t, 0.06, 0.12, 3500, 0.4));
    for (const st of [6, 14]) c.at(st, 3, (t) => this.s.wood(this.v(3), t, 700, 0.1, 0.03, -0.3));
    c.at(12, 3, (t) => this.s.membrane(this.v(3), t, 85, 55, 0.15, 0.2, 900, 0.25));
    if (pb % 2 === 0) c.at(8, 3, (t, sd) => this.s.flute(this.v(3), t, 'siku', chord[1], 6 * sd, 0.05, { pan: 0.45 }));
  }
}

// ======================================================================= Pink Sands (Bahamas)

/** light 16th swing */
const sw16 = (st: number) => st + (st % 2 === 1 ? 0.14 : 0);

class PinkSandsScore extends Score {
  readonly bpm = 104;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[2, 2, 1, 3, 2, 2, 4], [3, 3, 2, 4, 4], [2, 1, 1, 2, 2, 4, 4], [4, 2, 2, 2, 2, 4], [1, 1, 2, 2, 2, 4, 4], [3, 1, 2, 2, 2, 2, 4], [3, 3, 2, 8]],
    cadences: [[2, 2, 12], [3, 3, 10], [4, 4, 8]],
    n: 7, fifth: 4, lo: -3, hi: 9, leap: 0.25,
  });
  /** I – IV – V7 – I (semitones above the root) */
  private chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14, 17], [0, 4, 7]];
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 1);
    const roll = !end && len >= 8 && this.rng() < 0.4;
    c.at(sw16(step), layer, (t, sd) => {
      if (roll) {
        // pan roll: fast repeated strikes sustain the note
        const v = this.v(layer);
        const reps = Math.min(12, Math.floor(len * 2));
        for (let i = 0; i < reps; i++) this.s.steelPan(v, t + i * sd * 0.5, midi, sd * 1.2, vel * 0.2 * (i === 0 ? 1 : 0.62 - i * 0.02), { pan: -0.12 });
      } else this.s.steelPan(this.v(layer), t, midi, Math.max(0.8, len * sd * 1.6), vel * 0.24, { pan: -0.12 });
      if (end) this.s.steelPan(this.v(layer), t + 0.01, midi - 12, 1.6, vel * 0.12, { pan: 0.1 });
    });
  }
  private strum(c: BarCtx, step: number, layer: Layer, notes: number[], vel: number, len: number) {
    c.at(sw16(step), layer, (t, sd) => {
      const v = this.v(layer);
      notes.forEach((m, i) => this.s.pluck(v, t + i * 0.012, 'guitar', m, len * sd, vel * (1 - i * 0.1), { pan: 0.25 }));
    });
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    const ch = this.chords[pb % 4];
    const R = this.key.root;
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // L0: warm sustained harmony under the surf
    c.at(0, 0, (t, sd) => this.s.pad(this.v(0), t, ch.slice(0, 3).map((x) => R + x - 12), 16 * sd * 1.1, 0.022, { cutoff: 1000 }));
    // L1: offbeat guitar chops (calypso skank)
    const voicing = ch.map((x) => R + x);
    for (const st of [2, 6, 10, 14]) this.strum(c, st, 1, voicing, 0.085, 1.3);
    // L2: calypso bass, goombay drum, maracas
    const b = R - 24 + ch[0];
    const bass: [number, number, number][] = [[0, b, 0.42], [6, b + 7, 0.3], [8, b, 0.34], [12, b + 4, 0.26], [14, b + (pb === 3 ? -1 : 5), 0.2]];
    for (const [st, m, vel] of bass) c.at(sw16(st), 2, (t, sd) => this.s.pluck(this.v(2), t, 'bassGtr', m, 2.2 * sd, vel, { pan: 0.05 }));
    for (const [st, vel] of [[0, 0.3], [3, 0.2], [8, 0.26], [11, 0.2]] as const)
      c.at(sw16(st), 2, (t) => this.s.membrane(this.v(2), t, 150, 112, 0.14, vel, 900, 0.3, -0.2));
    for (const st of [4, 12]) c.at(st, 2, (t) => this.s.bendir(this.v(2), t, 'tak', 0.14, -0.25));
    for (let st = 0; st < 16; st += 2) c.at(sw16(st + 1), 2, (t) => this.s.shaker(this.v(2), t, st % 4 === 2 ? 0.05 : 0.035, 0.05, 6000, 0.35));
    // L3: soca cowbell, scraper, double-second pan comping
    for (const st of [0, 3, 6, 10, 12]) c.at(st, 3, (t) => this.s.cowbell(this.v(3), t, 560, st === 0 ? 0.05 : 0.035, 0.06, 0.4));
    for (const st of [4, 12]) c.at(st, 3, (t) => this.s.shaker(this.v(3), t, 0.045, 0.14, 3200, -0.4));
    const arp = [ch[0], ch[1], ch[2], ch[1], ch[0] + 12, ch[2], ch[1]];
    [2, 3, 6, 7, 10, 11, 14].forEach((st, i) => c.at(sw16(st), 3, (t) => this.s.steelPan(this.v(3), t, R + 12 + arp[i], 0.7, 0.05, { pan: 0.4 })));
  }
}

// ======================================================================= Vaadhoo (Maldives)

class VaadhooScore extends Score {
  readonly bpm = 90;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[4, 4, 8], [3, 3, 2, 8], [2, 2, 4, 8], [6, 2, 8], [4, 2, 2, 4, 4], [8, 4, 4], [3, 3, 4, 6]],
    cadences: [[4, 12], [2, 2, 12], [8, 8]],
    n: 7, fifth: 4, lo: -2, hi: 9, leap: 0.25,
  });
  /** i – IV – i – VII (dorian) */
  private chords = [[0, 3, 7, 10], [5, 9, 12, 14], [0, 3, 7, 10], [-2, 2, 5, 9]];
  private starIn = 2;
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 1);
    c.at(step, layer, (t, sd) => {
      this.s.mallet(this.v(layer), t, midi, Math.max(1.6, len * sd * 1.6), vel * 0.3, { pan: -0.15 });
      if (end) this.s.mallet(this.v(layer), t + 0.015, midi - 12, 2.5, vel * 0.16, { pan: 0.15 });
    });
  }
  private dum(c: BarCtx, st: number, layer: Layer, vel: number) {
    c.at(st, layer, (t) => this.s.membrane(this.v(layer), t, 96, 64, 0.2, vel, 500, 0.35, -0.1));
  }
  private tun(c: BarCtx, st: number, layer: Layer, vel: number, pan = 0.15) {
    c.at(st, layer, (t) => this.s.membrane(this.v(layer), t, 190, 158, 0.09, vel, 1400, 0.4, pan));
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    const ch = this.chords[pb % 4];
    const R = this.key.root;
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // L0: night pads (2-bar, overlapping) + rare star glints
    if (c.bar % 2 === 0) c.at(0, 0, (t, sd) => this.s.pad(this.v(0), t, ch.map((x) => R + x), 32 * sd * 1.15, 0.03, { cutoff: 720, sweep: 1.6 }));
    if (--this.starIn <= 0) {
      this.starIn = 2 + Math.floor(this.rng() * 3);
      const st = Math.floor(this.rng() * 14);
      c.at(st, 0, (t) => this.s.bell(this.v(0), t, R + 36 + pick(this.rng, ch), 3.5, 0.018, { glass: true, pan: this.rng() * 1.4 - 0.7 }));
    }
    // L1: the boduberu starts alone and soft: one deep stroke per bar
    this.dum(c, 0, 1, 0.16);
    // L2: groove (dum-tun-tak), soft bass
    this.dum(c, 6, 2, 0.2);
    this.dum(c, 8, 2, 0.14);
    this.tun(c, 4, 2, 0.14);
    this.tun(c, 12, 2, 0.16);
    for (const st of [2, 10, 14]) c.at(st, 2, (t) => this.s.bendir(this.v(2), t, 'ghost', 0.2, 0.3));
    for (const [st, x] of [[0, ch[0]], [8, ch[0]], [11, ch[1]]] as const)
      c.at(st, 2, (t, sd) => this.s.tone(this.v(2), t, 'triangle', mtofHz(R - 12 + x), mtofHz(R - 12 + x), 3 * sd, 0.1, { lp: 380, attack: 0.01 }));
    // L3: the drummers speed up: 16th rolls in a crescendo, claps, low chant hum
    for (let st = 0; st < 16; st++) {
      if (st % 4 === 0) continue;
      const u = st / 16;
      c.at(st, 3, (t) => this.s.bendir(this.v(3), t, st % 2 ? 'ghost' : 'tak', 0.07 + u * 0.1, st % 2 ? 0.35 : -0.35));
    }
    for (const st of [4, 12]) c.at(st, 3, (t) => this.s.clap(this.v(3), t, 0.07, 0.2));
    if (c.bar % 2 === 1) c.at(0, 3, (t, sd) => this.s.choir(this.v(3), t, [R - 12 + ch[0], R - 5 + ch[0]], 30 * sd, 0.022, { from: [450, 800, 2830], to: [325, 700, 2530], pan: 0.1 }));
  }
}

// ======================================================================= Dallol (Danakil)

/** triplet-8th grid (12 per bar) → 16th steps */
const T3 = (i: number) => (i * 4) / 3;
const t3r = (r: number[]) => r.map((d) => (d * 4) / 3);

class DallolScore extends Score {
  readonly bpm = 76;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[3, 3, 6], [2, 1, 3, 6], [3, 2, 1, 6], [4, 2, 6], [2, 1, 2, 1, 6], [3, 3, 3, 3], [2, 1, 2, 1, 3, 3]].map(t3r),
    cadences: [[2, 1, 9], [3, 3, 6], [6, 6]].map(t3r),
    n: 5, fifth: 3, lo: -2, hi: 8, leap: 0.3,
  });
  private bubbleIn = 1;
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg);
    const grace = !end && len >= 4 && this.rng() < 0.3 ? this.m(deg + 1) : 0;
    c.at(step, layer, (t, sd) => {
      if (grace) this.s.pluck(this.v(layer), t - 0.045, 'krar', grace, 0.08, vel * 0.3, { pan: -0.15 });
      this.s.pluck(this.v(layer), t, 'krar', midi, len * sd * 1.5, vel * 0.7, { pan: -0.15 });
      if (end) this.s.pluck(this.v(layer), t + 0.01, 'krar', midi - 12, len * sd * 1.5, vel * 0.3, { pan: 0.1 });
    });
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // L0: bowed drone on the tonic + fifth, brine bubbles
    if (c.bar % 2 === 0) {
      c.at(0, 0, (t, sd) => {
        this.s.drone(this.v(0), t, this.key.root - 12, 32 * sd * 1.4, 0.04, { bright: 0.8, pan: -0.15 });
        this.s.drone(this.v(0), t + 0.4, this.key.root - 5, 32 * sd * 1.35, 0.02, { bright: 0.6, pan: 0.2 });
      });
    }
    if (--this.bubbleIn <= 0) {
      this.bubbleIn = 1 + Math.floor(this.rng() * 3);
      const st = Math.floor(this.rng() * 12);
      const n = 2 + Math.floor(this.rng() * 3);
      const p = this.rng() * 1.2 - 0.6;
      c.at(st, 0, (t) => {
        for (let i = 0; i < n; i++) {
          const f = 380 + this.rng() * 500;
          this.s.tone(this.v(0), t + i * (0.07 + this.rng() * 0.06), 'sine', f, f * 2.2, 0.06, 0.018, { glide: 0.02, pan: p });
        }
      });
    }
    // L1: low krar tonic on the downbeat
    c.at(0, 1, (t, sd) => this.s.pluck(this.v(1), t, 'krar', this.m(0, -1), 10 * sd, 0.22, { pan: 0.2 }));
    // L2: kebero (dum / slap) in chik-chika 12/8, krar ostinato, eskista claps
    for (const [i, f0, vel] of [[0, 92, 0.34], [6, 92, 0.28], [8, 110, 0.14]] as const)
      c.at(T3(i), 2, (t) => this.s.membrane(this.v(2), t, f0, 58, 0.22, vel, 500, 0.3));
    for (const i of [3, 9]) c.at(T3(i), 2, (t) => this.s.bendir(this.v(2), t, 'tak', 0.2, 0.2));
    const ost = pb % 2 === 0 ? [0, 2, 1, 3, 2, 1, 0, 2] : [0, 2, 1, 3, 4, 3, 1, 2];
    [0, 2, 3, 5, 6, 8, 9, 11].forEach((i, k) => c.at(T3(i), 2, (t, sd) => this.s.pluck(this.v(2), t, 'krar', this.m(ost[k], -1), 3 * sd, k % 2 ? 0.14 : 0.2, { pan: 0.3 })));
    for (const i of [3, 9]) c.at(T3(i), 2, (t) => this.s.clap(this.v(2), t, 0.05, -0.3));
    // L3: washint counter-line, triplet shaker, kebero ghosts
    const w = [4, 3, 2, 3][pb] ?? 4;
    c.at(T3(1), 3, (t, sd) => this.s.flute(this.v(3), t, 'washint', this.m(w, 1), 13 * sd, 0.045, { pan: 0.4, scoop: true, fall: pb === 3 }));
    for (let i = 0; i < 12; i++) c.at(T3(i), 3, (t) => this.s.shaker(this.v(3), t, i % 3 === 0 ? 0.045 : 0.028, 0.04, 5500, -0.35));
    for (const i of [1, 4, 7, 10]) c.at(T3(i), 3, (t) => this.s.bendir(this.v(3), t, 'ghost', 0.2, -0.1));
  }
}

// ======================================================================= Luna (the Moon)

class LunaScore extends Score {
  readonly bpm = 58;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[8, 8], [4, 4, 8], [12, 4], [-4, 4, 8], [6, 2, 8], [16], [8, -4, 4]],
    cadences: [[4, 12], [16], [8, 8]],
    n: 7, fifth: 4, lo: -1, hi: 9, leap: 0.3, breath: true,
  });
  /** Cmaj7 – D – Am7 – G/B (lydian colour) */
  private chords = [[0, 4, 7, 11], [2, 6, 9, 14], [-3, 0, 4, 7], [-1, 2, 7, 11]];
  private last = 0;
  private radioIn = 2;
  resetPhrase() { this.mel.reset(); this.last = 0; }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number) {
    const midi = this.m(deg);
    const from = this.last && Math.abs(this.last - midi) <= 7 && this.rng() < 0.65 ? this.last : 0;
    this.last = midi;
    c.at(step, layer, (t, sd) => this.s.theremin(this.v(layer), t, midi, Math.max(0.6, len * sd * 1.02), vel * 0.085, { from, pan: -0.1 }));
  }
  outro(c: BarCtx) { this.last = 0; super.outro(c); }
  bar(c: BarCtx) {
    const ch = this.chords[Math.floor(c.bar / 2) % 4];
    const R = this.key.root;
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel);
    // L0: pure sine-ish bed + radio (quindar tones, telemetry blips)
    if (c.bar % 2 === 0) c.at(0, 0, (t, sd) => this.s.pad(this.v(0), t, [R - 24 + ch[0], R - 12 + ch[1], R - 12 + ch[2]], 32 * sd * 1.2, 0.028, { cutoff: 420 }));
    if (--this.radioIn <= 0) {
      this.radioIn = 2 + Math.floor(this.rng() * 3);
      const st = Math.floor(this.rng() * 10);
      const p = this.rng() < 0.5 ? -0.55 : 0.55;
      if (this.rng() < 0.5) {
        c.at(st, 0, (t) => this.s.tone(this.v(0), t, 'sine', 2525, 2525, 0.25, 0.01, { pan: p, attack: 0.004 }));
        c.at(st + 5, 0, (t) => this.s.tone(this.v(0), t, 'sine', 2475, 2475, 0.25, 0.009, { pan: p, attack: 0.004 }));
      } else {
        const n = 3 + Math.floor(this.rng() * 4);
        const base = 1300 + Math.floor(this.rng() * 3) * 200;
        c.at(st, 0, (t) => {
          for (let i = 0; i < n; i++) this.s.tone(this.v(0), t + i * 0.09, 'sine', base * (i % 2 ? 1.25 : 1), base * (i % 2 ? 1.25 : 1), 0.045, 0.008, { pan: p });
          this.s.whoosh(this.v(0), t - 0.05, 0.35, 0.012, 2600, 1800, 0.7, { pan: p });
        });
      }
    }
    // L2: slow sine arpeggio, soft sub pulse
    [0, 4, 8, 12].forEach((st, i) => c.at(st, 2, (t) => {
      const f = mtofHz(R + ch[i % ch.length]);
      this.s.tone(this.v(2), t, 'sine', f, f, 1.4, 0.035, { attack: 0.01, pan: i % 2 ? 0.45 : -0.45 });
    }));
    c.at(0, 2, (t) => this.s.membrane(this.v(2), t, 52, 40, 0.5, 0.18, 120, 0));
    // L3: glass bells from far away, octave sine echo
    for (const st of [2, 10]) c.at(st, 3, (t) => this.s.bell(this.v(3), t, R + 24 + pick(this.rng, ch), 3, 0.022, { glass: true, pan: st < 8 ? -0.6 : 0.6 }));
    [2, 6, 10, 14].forEach((st, i) => c.at(st, 3, (t) => {
      const f = mtofHz(R + 12 + ch[(i + 2) % ch.length]);
      this.s.tone(this.v(3), t, 'sine', f, f, 0.8, 0.018, { attack: 0.01, pan: i % 2 ? -0.3 : 0.3 });
    }));
  }
}

// ======================================================================= Mars (Jezero)

class MarsScore extends Score {
  readonly bpm = 100;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[4, 4, 8], [2, 2, 4, 8], [6, 2, 8], [4, 2, 2, 8], [3, 3, 2, 8], [8, 4, 4], [4, 4, 4, 4]],
    cadences: [[4, 12], [2, 2, 12], [8, 8]],
    n: 7, fifth: 4, lo: -2, hi: 9, leap: 0.25,
  });
  /** Em – C – Am – B (harmonic V) */
  private chords = [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]];
  private last = 0;
  resetPhrase() { this.mel.reset(); this.last = 0; }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number) {
    const midi = this.m(deg, 1);
    const from = this.last && Math.abs(this.last - midi) <= 5 && this.rng() < 0.4 ? this.last : 0;
    this.last = midi;
    c.at(step, layer, (t, sd) => this.s.analog(this.v(layer), t, midi, Math.max(0.2, len * sd * 0.95), vel * 0.06,
      { cutoff: 1300, env: 2.2, q: 2, decay: len * sd * 0.6, from, pan: -0.1 }));
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    const ch = this.chords[pb % 4];
    const R = this.key.root;
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel);
    // L0: slow-sweep analog pad
    c.at(0, 0, (t, sd) => this.s.pad(this.v(0), t, ch.map((x) => R + x), 16 * sd * 1.12, 0.036, { cutoff: 650, sweep: 2.4, q: 2.5 }));
    // L2: 16th arpeggio (ping-pong) + pulsing bass
    const up = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[0] + 12, ch[2], ch[1]];
    for (let st = 0; st < 16; st++) {
      const m = R + 12 + up[st % 8];
      c.at(st, 2, (t, sd) => this.s.analog(this.v(2), t, m, sd * 0.8, st % 4 === 0 ? 0.05 : 0.036, { cutoff: 700, env: 5, q: 5, decay: 0.09, pan: st % 2 ? 0.4 : -0.4 }));
    }
    for (let st = 0; st < 16; st += 2) c.at(st, 2, (t, sd) => this.s.analog(this.v(2), t, R - 12 + ch[0] + (st === 6 || st === 14 ? 12 : 0), sd * 1.6, 0.075, { cutoff: 260, env: 3, q: 3, decay: 0.12, sub: true }));
    // L3: gated 80s drum machine + high arp echo
    for (const st of [0, 8, 10]) c.at(st, 3, (t) => this.s.membrane(this.v(3), t, 64, 42, 0.16, st === 10 ? 0.18 : 0.3, 180, 0.1));
    for (const st of [4, 12]) c.at(st, 3, (t) => { this.s.membrane(this.v(3), t, 190, 160, 0.07, 0.1, 3000, 0.9); this.s.shaker(this.v(3), t, 0.06, 0.1, 1500); });
    for (let st = 2; st < 16; st += 4) c.at(st, 3, (t) => this.s.shaker(this.v(3), t, 0.028, 0.03, 8000, 0.3));
    for (let st = 3; st < 16; st += 4) c.at(st, 3, (t, sd) => this.s.analog(this.v(3), t, R + 24 + up[(st + 3) % 8], sd * 0.7, 0.022, { cutoff: 1500, env: 3, q: 3, decay: 0.07, pan: 0.6 }));
  }
}

// ======================================================================= Titan (Shangri-La)

class TitanScore extends Score {
  readonly bpm = 50;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[8, 8], [4, 4, 8], [12, 4], [-4, 4, 8], [6, 2, 8], [16]],
    cadences: [[4, 12], [16], [8, 8]],
    n: 7, fifth: 4, lo: 0, hi: 10, leap: 0.3, breath: true,
  });
  /** i – bII – bVII – i, two bars each */
  private chords = [[0, 7, 12, 15], [1, 8, 13, 17], [-2, 5, 10, 14], [0, 7, 12, 15]];
  private thunderIn = 2;
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 2);
    c.at(step, layer, (t, sd) => {
      this.s.sonar(this.v(layer), t, midi, Math.max(2.2, len * sd * 1.3), vel * 0.2, { pan: -0.2 + this.rng() * 0.4 });
      if (end) this.s.sonar(this.v(layer), t + 0.03, midi - 12, 4, vel * 0.12);
    });
  }
  bar(c: BarCtx) {
    const ch = this.chords[Math.floor(c.bar / 2) % 4];
    const R = this.key.root;
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // L0: submerged drones + distant thunder
    if (c.bar % 2 === 0) {
      c.at(0, 0, (t, sd) => {
        const d = 32 * sd * 1.4;
        this.s.drone(this.v(0), t, R + ch[0], d, 0.05, { bright: 0.45, pan: -0.2 });
        this.s.drone(this.v(0), t + 0.8, R + ch[1], d, 0.03, { bright: 0.5, pan: 0.2 });
      });
    }
    if (--this.thunderIn <= 0) {
      this.thunderIn = 3 + Math.floor(this.rng() * 3);
      const st = Math.floor(this.rng() * 12);
      c.at(st, 0, (t) => this.s.thunder(this.v(0), t, 4 + this.rng() * 3, 0.16 + this.rng() * 0.08, this.rng() * 1.4 - 0.7));
    }
    // L2: slow heartbeat + low filtered pad
    c.at(0, 2, (t) => this.s.membrane(this.v(2), t, 50, 34, 0.4, 0.3, 120, 0.15));
    c.at(3, 2, (t) => this.s.membrane(this.v(2), t, 47, 34, 0.35, 0.18, 120, 0.1));
    if (c.bar % 2 === 1) c.at(0, 2, (t, sd) => this.s.pad(this.v(2), t, [R + 12 + ch[0], R + 12 + ch[2], R + 12 + ch[3]], 30 * sd, 0.034, { cutoff: 460 }));
    // L3: high ghostly drone + muffled pings
    if (c.bar % 2 === 0) c.at(4, 3, (t, sd) => this.s.drone(this.v(3), t, R + 24 + ch[3], 26 * sd, 0.03, { bright: 1.1 }));
    for (const st of [6, 13]) c.at(st, 3, (t) => this.s.sonar(this.v(3), t, R + 36 + pick(this.rng, ch), 2.5, 0.035, { pan: st < 8 ? 0.55 : -0.55 }));
  }
}

// ======================================================================= Kepler-186f ("Veyra")

class KeplerScore extends Score {
  readonly bpm = 76;
  private mel = new MotifMelody(this.rng, {
    rhythms: [[4, 4, 8], [2, 2, 4, 8], [3, 3, 2, 8], [6, 2, 8], [4, 2, 2, 4, 4], [2, 2, 2, 2, 8]],
    cadences: [[4, 12], [2, 2, 12], [4, 4, 8]],
    n: 7, fifth: 4, lo: -2, hi: 9, leap: 0.3,
  });
  /** chords as scale degrees (the scale itself carries the quarter tones) */
  private chords = [[0, 2, 4], [-2, 0, 2], [3, 5, 7], [1, 3, 5]];
  resetPhrase() { this.mel.reset(); }
  lead(c: BarCtx, step: number, layer: Layer, deg: number, len: number, vel: number, end?: boolean) {
    const midi = this.m(deg, 1);
    c.at(step, layer, (t, sd) => {
      this.s.crystal(this.v(layer), t, midi, Math.max(1.6, len * sd * 1.5), vel * 0.13, { pan: -0.15 });
      if (end) this.s.crystal(this.v(layer), t + 0.02, midi + 12.25, 2.2, vel * 0.04, { pan: 0.4 });
    });
  }
  bar(c: BarCtx) {
    const pb = this.mel.barInPhrase;
    const cd = this.chords[pb % 4];
    const ch = cd.map((d) => this.m(d));
    for (const nt of this.mel.next(c.sparse)) this.lead(c, nt.step, 1, nt.deg, nt.len, nt.vel, nt.end);
    // L0: alien choir, vowel morphing (2-bar, alternating direction)
    if (c.bar % 2 === 0) {
      const flip = (c.bar / 2) % 2 === 1;
      const I: [number, number, number] = [300, 2200, 3000], O: [number, number, number] = [480, 820, 2600];
      c.at(0, 0, (t, sd) => this.s.choir(this.v(0), t, ch.map((m) => m - 12), 32 * sd * 1.12, 0.03, { from: flip ? O : I, to: flip ? I : O, vib: 9 }));
    }
    // L2: glassy arpeggio (ping-pong) + sine sub
    const arp = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12, ch[2]];
    for (let st = 0; st < 16; st++) c.at(st, 2, (t) => this.s.crystal(this.v(2), t, arp[st % 8], 0.55, st % 4 === 0 ? 0.04 : 0.028, { pan: st % 2 ? 0.5 : -0.5 }));
    for (const st of [0, 8]) c.at(st, 2, (t, sd) => { const f = mtofHz(ch[0] - 24); this.s.tone(this.v(2), t, 'sine', f, f, 7 * sd, 0.12, { attack: 0.02 }); });
    // L3: microtonal bell clusters (quarter-tone neighbours), high choir, rising alien drops
    for (const st of [4, 10, 14]) {
      const m = pick(this.rng, ch) + 24 + (this.rng() < 0.5 ? 0.5 : -0.5);
      c.at(st, 3, (t) => {
        this.s.bell(this.v(3), t, m, 2.4, 0.03, { glass: true, pan: this.rng() * 1.2 - 0.6 });
        this.s.bell(this.v(3), t + 0.07, m + 0.5, 2, 0.016, { glass: true, pan: this.rng() * 1.2 - 0.6 });
      });
    }
    if (c.bar % 2 === 1) c.at(0, 3, (t, sd) => this.s.choir(this.v(3), t, [ch[2] + 12], 28 * sd, 0.016, { from: [270, 2290, 3010], to: [300, 870, 2240], vib: 14, pan: 0.3 }));
    for (const st of [6, 15]) c.at(st, 3, (t) => this.s.membrane(this.v(3), t, 180, 480, 0.12, 0.1, 2000, 0.1, st === 6 ? -0.4 : 0.4));
  }
}

export function createScore(id: BiomeId, h: MusicHost, rt: ScoreRuntime, seed: number): Score {
  switch (id) {
    case 'karesansui': return new KyotoScore(id, h, rt, seed);
    case 'erg': return new ErgScore(id, h, rt, seed);
    case 'lagoon': return new LagoonScore(id, h, rt, seed);
    case 'svartsandur': return new IcelandScore(id, h, rt, seed);
    case 'salar': return new SalarScore(id, h, rt, seed);
    case 'pinksands': return new PinkSandsScore(id, h, rt, seed);
    case 'vaadhoo': return new VaadhooScore(id, h, rt, seed);
    case 'dallol': return new DallolScore(id, h, rt, seed);
    case 'luna': return new LunaScore(id, h, rt, seed);
    case 'mars': return new MarsScore(id, h, rt, seed);
    case 'titan': return new TitanScore(id, h, rt, seed);
    case 'kepler': return new KeplerScore(id, h, rt, seed);
    default: return new KyotoScore(id, h, rt, seed);
  }
}

// ======================================================================= runtime

interface QEv { step: number; layer: Layer; fn: EvFn }

export class ScoreRuntime {
  readonly out: GainNode;
  readonly layers: GainNode[] = [];
  readonly score: Score;
  private layerOn = [true, true, false, false];
  private queue: QEv[] = [];
  private curStep = 0;
  private curTime: number;
  private genStep = 0;
  private barNo = 0;
  private tempoMul = 1;
  private stepDur: number;
  private amb: AmbienceBed | null = null;
  private t0: number;
  private rng: Rng;
  private outroPending = false;
  sparse = false;
  stopped = false;
  errors = 0;

  constructor(private h: MusicHost, readonly biome: BiomeId, dest: AudioNode, t0: number, fade: number, seed: number) {
    const ctx = h.ctx;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(fade > 0 ? 0 : 1, t0);
    if (fade > 0) this.out.gain.linearRampToValueAtTime(1, t0 + fade);
    this.out.connect(dest);
    for (let i = 0; i < 4; i++) {
      const g = ctx.createGain();
      g.gain.value = this.layerOn[i] ? 1 : 0;
      g.connect(this.out);
      this.layers.push(g);
    }
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.score = createScore(biome, h, this, seed);
    this.stepDur = 60 / this.score.bpm / 4;
    this.curTime = t0 + 0.05;
    this.t0 = t0;
    this.tryAmbience();
  }

  get bpm() { return this.score.bpm * this.tempoMul; }

  private timeOf(step: number) { return this.curTime + (step - this.curStep) * this.stepDur; }

  setLayers(levels: number[], now: number) {
    for (let i = 0; i < 4; i++) {
      const on = levels[i] > 0.001;
      this.layerOn[i] = on;
      this.layers[i].gain.setTargetAtTime(levels[i], now, on ? 0.5 : 0.7);
    }
  }

  setTempo(mul: number, now: number) {
    if (Math.abs(mul - this.tempoMul) < 1e-4) return;
    const stepNow = this.curStep + (now - this.curTime) / this.stepDur;
    this.curStep = stepNow;
    this.curTime = now;
    this.tempoMul = mul;
    this.stepDur = 60 / (this.score.bpm * mul) / 4;
  }

  /** Re-anchor the clock at the next beat and drop queued (not yet scheduled) events. */
  restart(now: number, outro = false) {
    this.queue.length = 0;
    this.curStep = 0;
    this.curTime = now + 0.08;
    this.genStep = 0;
    this.outroPending = outro;
    this.score.resetPhrase();
  }

  /** Ambience beds start once their noise loops are rendered (idle jobs). */
  private tryAmbience() {
    if (this.amb || this.stopped) return;
    const s = this.h.synth;
    if (!s.sync && !(s.noiseReady('white') && s.noiseReady('pink') && s.noiseReady('brown'))) return;
    this.amb = new AmbienceBed(s, this.biome, this.layers[0], Math.max(this.t0, this.h.ctx.currentTime));
  }

  pump(now: number, horizon: number) {
    if (this.stopped) return;
    if (!this.amb) this.tryAmbience();
    if (this.timeOf(this.genStep) < now - 1.0 && this.queue.length === 0) this.restart(now);
    let guard = 0;
    while (this.timeOf(this.genStep) < horizon && guard++ < 4) this.genBar();
    while (this.queue.length && this.timeOf(this.queue[0].step) < horizon) {
      const e = this.queue.shift()!;
      const t = this.timeOf(e.step);
      if (t < now - 0.05) continue; // too late, drop
      if (!this.layerOn[e.layer]) continue;
      try { e.fn(Math.max(t, now), this.stepDur); } catch (err) { this.errors++; if (this.errors < 5) console.warn('[audio] note error', err); }
    }
  }

  private genBar() {
    const base = this.genStep;
    const c: BarCtx = {
      bar: this.barNo,
      rng: this.rng,
      sparse: this.sparse,
      at: (step, layer, fn) => { this.queue.push({ step: base + step, layer, fn }); },
    };
    try {
      if (this.outroPending) { this.outroPending = false; this.score.outro(c); }
      else this.score.bar(c);
    } catch (err) { this.errors++; if (this.errors < 5) console.warn('[audio] bar error', err); }
    this.queue.sort((a, b) => a.step - b.step);
    this.genStep += 16;
    this.barNo++;
  }

  stop(t: number, fade = 1.5) {
    if (this.stopped) return;
    this.stopped = true;
    this.queue.length = 0;
    try {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.linearRampToValueAtTime(0, t + fade);
    } catch { /* */ }
    this.amb?.stop(t);
  }

  dispose() {
    this.amb?.dispose();
    try { this.out.disconnect(); } catch { /* */ }
    for (const g of this.layers) { try { g.disconnect(); } catch { /* */ } }
  }
}
