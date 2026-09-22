// Generative biome scores + the lookahead sequencer runtime that plays them.
import type { BiomeId } from '../types';
import { AmbienceBed } from './ambience';
import { Rng, degToSemi, mulberry32, pick } from './dsp';
import type { PluckKind, Synth } from './instruments';
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
  lead: PluckKind | 'bell';
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

export function createScore(id: BiomeId, h: MusicHost, rt: ScoreRuntime, seed: number): Score {
  switch (id) {
    case 'karesansui': return new KyotoScore(id, h, rt, seed);
    case 'erg': return new ErgScore(id, h, rt, seed);
    case 'lagoon': return new LagoonScore(id, h, rt, seed);
    case 'svartsandur': return new IcelandScore(id, h, rt, seed);
    case 'salar': return new SalarScore(id, h, rt, seed);
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
