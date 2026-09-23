// Legend characters: each gets its own locomotion loop (driven by setSlither speed/turn) and
// signature SFX on game events. Snakes keep the shared slither loop (see core.ts).
//
// Cost model: a loop is a handful of persistent nodes built once per character switch; rhythmic
// parts (train chuffs, eel crackle bursts) are AudioParam automation on persistent gains, so they
// allocate nothing per hit. Only a few one-shots (comet sparkles, event SFX) create voices, from
// a private VoiceTracker so they never steal the game's SFX voices. The two pre-rendered loops
// (centipede patter, eel crackle) render in chunked idle jobs and are cached for the session.
import type { BiomeId, CharacterId, GameEvent, SkinId } from '../types';
import { CHUNK, bi, clamp, crackleGen, degToSemi, mtof, mulberry32, runGen } from './dsp';
import type { Synth } from './instruments';
import { BIOME_KEYS } from './scores';
import { Voice, VoiceTracker } from './voices';

export const LEGEND_IDS: CharacterId[] = ['centipede', 'eel', 'dragon', 'mecha', 'train', 'comet'];
const LEGEND_SET = new Set<string>(LEGEND_IDS);
export const isLegend = (id: string): id is CharacterId => LEGEND_SET.has(id);

export interface LegendHost {
  ctx: BaseAudioContext;
  synth: Synth;
  sfxIn: AudioNode;
  biome: BiomeId;
  scene: string;
  now(): number;
}

type Gen = Generator<unknown, unknown, unknown>;

// ------------------------------------------------------------------ pre-rendered loops

/** Centipede chitin patter: 20 leg-taps per second at rate 1 (≈ 6 cells/s), stereo L/R legs. */
function* patterGen(sr: number): Generator<void, Float32Array[], unknown> {
  const dur = 1.0;
  const len = Math.floor(dur * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  const rng = mulberry32(8675309);
  const n = 20;
  const tapLen = Math.floor(sr * 0.012);
  for (let k = 0; k < n; k++) {
    const left = k % 2 === 0;
    const crest = k % 5 === 0;
    const amp = crest ? 1 : 0.45 + 0.35 * rng();
    const start = Math.floor(((k + bi(rng) * 0.14) / n) * len + len) % len;
    const fr = 2500 + rng() * 1700, fl = 650 + rng() * 350;
    const kr = Math.exp(-1 / (sr * 0.0011)), kl = Math.exp(-1 / (sr * 0.0035)), kn = Math.exp(-1 / (sr * 0.0004));
    for (let hit = 0; hit < 2; hit++) {
      // leg tip, then the claw a few ms later (flam)
      const off = hit ? Math.floor(sr * (0.0035 + rng() * 0.002)) : 0;
      const a = amp * (hit ? 0.35 : 1);
      let er = a, el = a * 0.35, en = a * 0.5;
      for (let i = 0; i < tapLen; i++) {
        const t = i / sr;
        const x = er * Math.sin(2 * Math.PI * fr * t) + el * Math.sin(2 * Math.PI * fl * t) + en * (rng() * 2 - 1);
        er *= kr; el *= kl; en *= kn;
        const j = (start + off + i) % len;
        L[j] += x * (left ? 1 : 0.45);
        R[j] += x * (left ? 0.45 : 1);
      }
    }
    if (k % 4 === 3) yield;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0 ? 0.8 / peak : 1;
  for (let i0 = 0; i0 < len; i0 += CHUNK) {
    const e = Math.min(len, i0 + CHUNK);
    for (let i = i0; i < e; i++) { L[i] *= g; R[i] *= g; }
  }
  return [L, R];
}

const BUFFERS: Record<string, (sr: number) => Generator<void, Float32Array[], unknown>> = {
  patter: patterGen,
  sparks: (sr) => crackleGen(sr, 1.7, 55, 0.5, 4711),
};

// ------------------------------------------------------------------ manager

export class Legends {
  id: CharacterId | null = null;
  readonly out: GainNode;
  readonly voices: VoiceTracker;
  private loop: LegendLoop | null = null;
  private dying: LegendLoop[] = [];
  private bufs = new Map<string, AudioBuffer>();
  private pending = new Set<string>();
  speed = 0;
  turn = 0;
  gate = 0;
  /** Menu preview: play the signature sound shortly after selection (cancelled if a game starts). */
  private auditionAt = 0;

  constructor(readonly h: LegendHost, private queueGen: (g: Gen) => void) {
    this.out = h.ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(h.sfxIn);
    this.voices = new VoiceTracker(h.ctx, 14);
  }

  get active() { return this.id !== null; }
  get voiceCount() { return this.voices.count; }
  get synth() { return this.h.synth; }
  voice(): Voice { return this.voices.voice(this.out); }

  /** A cached pre-rendered buffer, or null while its idle job is still pending. */
  buffer(key: string): AudioBuffer | null {
    const b = this.bufs.get(key);
    if (b) return b;
    const ctx = this.h.ctx;
    const self = this;
    function* job(): Generator<unknown, void, unknown> {
      const data = yield* BUFFERS[key](ctx.sampleRate);
      const buf = ctx.createBuffer(2, data[0].length, ctx.sampleRate);
      buf.copyToChannel(data[0] as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(data[1] as Float32Array<ArrayBuffer>, 1);
      self.bufs.set(key, buf);
      self.pending.delete(key);
    }
    if (this.synth.sync) { runGen(job()); return this.bufs.get(key) ?? null; }
    if (!this.pending.has(key)) { this.pending.add(key); this.queueGen(job()); }
    return null;
  }

  setCharacter(id: SkinId) {
    const next = typeof id === 'string' && isLegend(id) ? id : null;
    if (next === this.id) return;
    this.id = next;
    const t = this.h.now();
    if (this.loop) { this.loop.stop(t); this.dying.push(this.loop); this.loop = null; }
    if (next) {
      this.loop = createLoop(next, this);
      this.loop.tryBuild();
    }
    this.auditionAt = next && this.h.scene === 'menu' ? t + 0.15 : 0;
  }

  set(speed: number, turnRate: number) {
    const sp = Number.isFinite(speed) ? Math.max(0, Math.min(16, speed)) : 0;
    const tr = Number.isFinite(turnRate) ? Math.min(8, Math.abs(turnRate)) : 0;
    // throttle AudioParam automation: only react to meaningful changes
    const moved = (sp > 0.05) !== (this.speed > 0.05);
    if (!moved && Math.abs(sp - this.speed) < 0.08 && Math.abs(tr - this.turn) < 0.12) return;
    this.speed = sp;
    this.turn = tr;
    this.loop?.refresh();
  }

  setGate(g: number) {
    if (g === this.gate) return;
    this.gate = g;
    this.loop?.refresh();
  }

  handle(e: GameEvent) {
    const l = this.loop;
    if (!l || !l.built) return;
    l.event(e, this.h.now());
  }

  tick(now: number, horizon: number) {
    const l = this.loop;
    if (l) {
      if (!l.built) l.tryBuild();
      if (l.built) l.tick(now, horizon);
      if (this.auditionAt && now >= this.auditionAt) {
        this.auditionAt = 0;
        if (l.built && this.h.scene === 'menu') l.audition(now);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (now > this.dying[i].stopAt) { this.dying[i].dispose(); this.dying.splice(i, 1); }
    }
  }

  dispose() {
    this.loop?.dispose();
    for (const d of this.dying) d.dispose();
    this.dying.length = 0;
    this.voices.killAll(this.h.now());
    try { this.out.disconnect(); } catch { /* */ }
  }
}

// ------------------------------------------------------------------ loop base

abstract class LegendLoop {
  built = false;
  stopAt = Infinity;
  protected out: GainNode;
  protected nodes: AudioNode[] = [];
  protected srcs: AudioScheduledSourceNode[] = [];
  protected rng = mulberry32(99);
  private lastEvt: Record<string, number> = {};

  constructor(protected L: Legends) {
    const ctx = L.h.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(L.out);
    this.nodes.push(this.out);
  }

  get ctx() { return this.L.h.ctx; }
  get s() { return this.L.synth; }
  get key() { return BIOME_KEYS[this.L.h.biome] ?? BIOME_KEYS.karesansui; }
  /** midi of a biome scale degree in the SFX register */
  deg(d: number, oct = 0) { const k = this.key; return k.sfxRoot + degToSemi(k.scale, d) + 12 * oct; }
  /** 0..1 speed factor */
  get u() { return Math.min(1, this.L.speed / 10); }
  /** 0 or 1: moving and in-game */
  get level() { return this.L.speed > 0.05 ? this.L.gate : 0; }
  get tr() { return Math.min(1, this.L.turn / 5); }
  protected now() { return this.L.h.now(); }
  /** true (and records the time) when at least `gap` s passed since the last `name` */
  protected every(name: string, gap: number, t: number) {
    const last = this.lastEvt[name] ?? -1e9;
    if (t - last < gap) return false;
    this.lastEvt[name] = t;
    return true;
  }

  // node helpers (owned by the loop, disconnected on dispose)
  protected gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; this.nodes.push(g); return g; }
  protected filter(type: BiquadFilterType, f: number, q = 0.707) {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; this.nodes.push(b); return b;
  }
  protected osc(type: OscillatorType, f: number) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; this.nodes.push(o); this.srcs.push(o); return o;
  }
  protected loopSrc(buf: AudioBuffer, offset = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; this.nodes.push(s); this.srcs.push(s);
    (s as AudioBufferSourceNode & { _off?: number })._off = offset;
    return s;
  }
  protected noise(c: 'white' | 'pink' | 'brown', offset = 0) { return this.loopSrc(this.s.noise(c), offset); }
  protected pan(p: number): AudioNode {
    const c = this.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
    if (typeof c.createStereoPanner !== 'function') return this.gain(1);
    const n = c.createStereoPanner(); n.pan.value = p; this.nodes.push(n); return n;
  }
  /** smooth param move */
  protected to(p: AudioParam, v: number, tau = 0.08) { p.setTargetAtTime(v, this.now(), tau); }

  /** Resources this loop needs before it can be built. */
  protected abstract ready(): boolean;
  protected abstract build(t: number): void;
  /** Push current speed / turn / gate into the graph. */
  protected abstract update(): void;
  tick(_now: number, _horizon: number) { /* rhythmic loops override */ }
  event(_e: GameEvent, _t: number) { /* signature sounds */ }
  /** Menu preview of the character's signature. */
  audition(t: number) { this.event({ type: 'eat', x: 0, y: 0, kind: 'normal', combo: 3, points: 0, length: 0 }, t); }

  tryBuild() {
    if (this.built || this.stopAt < Infinity) return;
    if (!this.ready()) return;
    const t = this.now();
    this.build(t);
    for (const s of this.srcs) {
      const off = (s as AudioBufferSourceNode & { _off?: number })._off;
      if (off !== undefined) (s as AudioBufferSourceNode).start(t, off); else s.start(t);
    }
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.setTargetAtTime(1, t, 0.05);
    this.built = true;
    this.update();
  }

  refresh() { if (this.built && this.stopAt === Infinity) this.update(); }

  protected noiseReady(...c: ('white' | 'pink' | 'brown')[]) {
    return this.s.sync || c.every((x) => this.s.noiseReady(x));
  }

  stop(t: number) {
    this.stopAt = t + 0.6;
    try {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.setTargetAtTime(0, t, 0.06);
      if (this.built) for (const s of this.srcs) s.stop(t + 0.5);
    } catch { /* */ }
  }

  dispose() {
    if (this.built) for (const s of this.srcs) { try { s.stop(); } catch { /* */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* */ } }
    this.nodes.length = 0;
    this.srcs.length = 0;
  }
}

// ------------------------------------------------------------------ Centipede

class CentipedeLoop extends LegendLoop {
  private src!: AudioBufferSourceNode;
  private lp!: BiquadFilterNode;
  private pg!: GainNode;
  private rg!: GainNode;
  private buf: AudioBuffer | null = null;
  protected ready() { this.buf = this.L.buffer('patter'); return !!this.buf && this.noiseReady('pink'); }
  protected build() {
    this.src = this.loopSrc(this.buf!, 0);
    const hp = this.filter('highpass', 260, 0.7);
    this.lp = this.filter('lowpass', 5200, 0.7);
    this.pg = this.gain(0);
    this.src.connect(hp).connect(this.lp).connect(this.pg).connect(this.out);
    // armour rustle between the taps
    const n = this.noise('pink', 0.8);
    const bp = this.filter('bandpass', 2600, 1.2);
    this.rg = this.gain(0);
    n.connect(bp).connect(this.rg).connect(this.out);
  }
  protected update() {
    const u = this.u, lv = this.level;
    const rate = clamp(this.L.speed / 6, 0.4, 1.9);
    this.to(this.src.playbackRate, rate, 0.1);
    this.to(this.lp.frequency, 5600 / Math.sqrt(rate), 0.1);
    this.to(this.pg.gain, lv * (0.55 + 0.45 * u) * 0.2, lv ? 0.05 : 0.08);
    this.to(this.rg.gain, lv * (0.012 + 0.018 * u + 0.03 * this.tr), 0.08);
  }
  audition(t: number) {
    const g = this.pg.gain;
    this.src.playbackRate.setValueAtTime(1.2, t);
    g.setTargetAtTime(0.14, t, 0.03);
    g.setTargetAtTime(0, t + 0.55, 0.08);
    super.audition(t + 0.62);
  }
  event(e: GameEvent, t: number) {
    if (e.type === 'eat') {
      // forcipules snapping shut
      this.s.wood(this.L.voice(), t, 2300, 0.05, 0.012, -0.1);
      this.s.wood(this.L.voice(), t + 0.035, 1900, 0.04, 0.012, 0.1);
    }
  }
}

// ------------------------------------------------------------------ Volt Eel

class EelLoop extends LegendLoop {
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private o3!: OscillatorNode;
  private lp!: BiquadFilterNode;
  private hum!: GainNode;
  private trem!: OscillatorNode;
  private tremG!: GainNode;
  private sparks!: AudioBufferSourceNode;
  private cg!: GainNode;
  private buf: AudioBuffer | null = null;
  private nextCrackle = 0;
  private biome: BiomeId | null = null;
  protected ready() { this.buf = this.L.buffer('sparks'); return !!this.buf; }
  private humHz() {
    // hum tuned to the biome's tonic, low octave
    const pc = ((this.key.root % 12) + 12) % 12;
    return mtof(36 + pc);
  }
  protected build() {
    const f = this.humHz();
    this.biome = this.L.h.biome;
    this.o1 = this.osc('sawtooth', f);
    this.o2 = this.osc('square', f * 2);
    this.o2.detune.value = 5;
    this.o3 = this.osc('sine', f * 3);
    const g2 = this.gain(0.35), g3 = this.gain(0.12);
    this.lp = this.filter('lowpass', 400, 4);
    const am = this.gain(0.75);
    this.trem = this.osc('sine', 7);
    this.tremG = this.gain(0.25);
    this.trem.connect(this.tremG).connect(am.gain);
    this.hum = this.gain(0);
    this.o1.connect(this.lp); this.o2.connect(g2).connect(this.lp); this.o3.connect(g3).connect(this.lp);
    this.lp.connect(am).connect(this.hum).connect(this.out);
    // crackle: a sparse spark loop gated in bursts
    this.sparks = this.loopSrc(this.buf!, 0.3);
    const hp = this.filter('highpass', 2200, 0.8);
    this.cg = this.gain(0);
    const p = this.pan(0.15);
    this.sparks.connect(hp).connect(this.cg).connect(p).connect(this.out);
  }
  protected update() {
    const u = this.u, lv = this.level;
    if (this.biome !== this.L.h.biome) {
      this.biome = this.L.h.biome;
      const f = this.humHz();
      this.to(this.o1.frequency, f, 0.3); this.to(this.o2.frequency, f * 2, 0.3); this.to(this.o3.frequency, f * 3, 0.3);
    }
    this.to(this.hum.gain, lv * (0.4 + 0.6 * u) * 0.016, lv ? 0.06 : 0.1);
    this.to(this.lp.frequency, 260 + 1100 * u + 500 * this.tr, 0.1);
    this.to(this.trem.frequency, 5 + 7 * u, 0.2);
  }
  private burst(t: number, amp: number, len: number) {
    const g = this.cg.gain;
    this.sparks.playbackRate.setValueAtTime(0.7 + this.rng() * 0.9, t);
    g.setTargetAtTime(amp, t, 0.003);
    g.setTargetAtTime(0, t + len, 0.03);
  }
  tick(now: number, horizon: number) {
    const lv = this.level;
    if (!lv) { this.nextCrackle = 0; return; }
    if (this.nextCrackle < now) this.nextCrackle = now + 0.05 + this.rng() * 0.3;
    const rate = 1.2 + 3.5 * this.u + 3 * this.tr;
    while (this.nextCrackle < horizon) {
      this.burst(this.nextCrackle, (0.035 + 0.045 * this.rng()) * lv, 0.03 + this.rng() * 0.09);
      this.nextCrackle += -Math.log(1 - this.rng() * 0.95) / rate;
    }
  }
  event(e: GameEvent, t: number) {
    if (e.type === 'eat') {
      // zap: a fast falling saw landing on the eat note, plus a spark burst
      const v = this.L.voice();
      const target = mtof(this.deg(Math.max(0, Math.min(11, (e.combo | 0) - 1))));
      const o = v.osc('sawtooth', 2600);
      o.frequency.setValueAtTime(2600, t);
      o.frequency.exponentialRampToValueAtTime(target, t + 0.09);
      const lp = v.filter('lowpass', 4200, 2);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.003);
      g.gain.setTargetAtTime(0.02, t + 0.01, 0.04);
      g.gain.setTargetAtTime(0, t + 0.12, 0.04);
      o.connect(lp).connect(g).connect(v.out);
      v.play(o, t, t + 0.45);
      this.s.tone(this.L.voice(), t + 0.08, 'square', target * 2, target * 2, 0.16, 0.012, { lp: 2500 });
      this.burst(t, 0.3, 0.12);
    } else if (e.type === 'death') {
      this.burst(t, 0.35, 0.5);
    }
  }
}

// ------------------------------------------------------------------ Lóng (dragon)

class DragonLoop extends LegendLoop {
  private bp!: BiquadFilterNode;
  private g1!: GainNode;
  private wbp!: BiquadFilterNode;
  private g2!: GainNode;
  private gustG!: GainNode;
  protected ready() { return this.noiseReady('pink', 'white'); }
  protected build() {
    const n = this.noise('pink', 1.3);
    this.bp = this.filter('bandpass', 500, 0.8);
    this.g1 = this.gain(0);
    n.connect(this.bp).connect(this.g1).connect(this.out);
    // a slow gust on the body of the wind
    const gust = this.osc('sine', 0.19);
    this.gustG = this.gain(0);
    gust.connect(this.gustG).connect(this.g1.gain);
    // airy whistle over the whiskers and mane
    const w = this.noise('white', 0.4);
    this.wbp = this.filter('bandpass', 1200, 7);
    this.g2 = this.gain(0);
    const p = this.pan(-0.2);
    w.connect(this.wbp).connect(this.g2).connect(p).connect(this.out);
  }
  protected update() {
    const u = this.u, lv = this.level, tr = this.tr;
    const base = lv * (0.4 + 0.6 * u) * 0.13;
    this.to(this.g1.gain, base, lv ? 0.12 : 0.15);
    this.to(this.gustG.gain, base * 0.35, 0.3);
    this.to(this.bp.frequency, 380 + 700 * u + 450 * tr, 0.2);
    this.to(this.wbp.frequency, 900 + 900 * u + 400 * tr, 0.3);
    this.to(this.g2.gain, base * (0.1 + 0.25 * tr), 0.15);
  }
  event(e: GameEvent, t: number) {
    const s = this.s;
    if (e.type === 'eat') {
      // soft wind chime: a few pentatonic-ish glass rods, loosely staggered
      const n = 3 + Math.floor(this.rng() * 2);
      let tt = t + 0.02;
      for (let i = 0; i < n; i++) {
        const d = [0, 1, 2, 3, 4, 5, 7][Math.floor(this.rng() * 7)];
        s.bell(this.L.voice(), tt, this.deg(d, 1), 2.2, 0.028 + this.rng() * 0.014, { glass: true, pan: bi(this.rng) * 0.6 });
        tt += 0.05 + this.rng() * 0.12;
      }
    } else if (e.type === 'combo' && e.combo >= 4 && (e.combo === 4 || e.combo % 4 === 0) && this.every('swell', 1.5, t)) {
      // a rising cloud swell
      s.whoosh(this.L.voice(), t, 1.1, 0.07, 380, 2400, 1, { reverse: true, color: 'pink' });
      const k = this.key;
      const chord = [0, 2, 4].map((d) => k.sfxRoot - 12 + degToSemi(k.scale, d));
      s.pad(this.L.voice(), t + 0.1, chord, 2, 0.035, { cutoff: 1500, sweep: 1.8 });
    }
  }
}

// ------------------------------------------------------------------ Mecha

class MechaLoop extends LegendLoop {
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private bp!: BiquadFilterNode;
  private sg!: GainNode;
  private hissG!: GainNode;
  private wasTurning = false;
  private dead = false;
  protected ready() { return this.noiseReady('white'); }
  private servoHz() { return 150 + 32 * this.L.speed + 40 * this.tr; }
  protected build() {
    const f = this.servoHz();
    this.o1 = this.osc('triangle', f);
    this.o2 = this.osc('sawtooth', f * 1.5);
    const g2 = this.gain(0.18);
    const wob = this.osc('sine', 11);
    const wg = this.gain(9);
    wob.connect(wg); wg.connect(this.o1.detune); wg.connect(this.o2.detune);
    this.bp = this.filter('bandpass', f * 2.2, 2.5);
    this.sg = this.gain(0);
    this.o1.connect(this.bp); this.o2.connect(g2).connect(this.bp);
    this.bp.connect(this.sg).connect(this.out);
    const n = this.noise('white', 1.7);
    const hp = this.filter('highpass', 3200, 0.7);
    this.hissG = this.gain(0);
    n.connect(hp).connect(this.hissG).connect(this.out);
  }
  protected update() {
    const u = this.u, lv = this.level, tr = this.tr;
    if (lv) this.dead = false;
    const f = this.servoHz();
    this.to(this.o1.frequency, f, 0.12);
    this.to(this.o2.frequency, f * 1.5, 0.12);
    this.to(this.bp.frequency, f * 2.2, 0.12);
    if (!this.dead) this.to(this.sg.gain, lv * (0.35 + 0.65 * u) * 0.056, lv ? 0.06 : 0.1);
    this.to(this.hissG.gain, lv * 0.012 * tr, 0.05);
    // glide mode has no discrete turn events: trigger the hydraulics on a turn onset
    const turning = this.L.turn > 2.2;
    if (turning && !this.wasTurning && lv) this.hydraulic(this.now(), 0.7);
    this.wasTurning = turning;
  }
  private hydraulic(t: number, amt: number) {
    if (!this.every('hyd', 0.14, t)) return;
    const s = this.s;
    s.whoosh(this.L.voice(), t, 0.24, 0.05 * amt, 4200, 1600, 1.1, { pan: bi(this.rng) * 0.3 });
    s.membrane(this.L.voice(), t, 115, 70, 0.04, 0.06 * amt, 700, 0.2);
    // servo strains briefly
    const f = this.servoHz();
    this.o1.frequency.setTargetAtTime(f * 1.3, t, 0.02);
    this.o1.frequency.setTargetAtTime(f, t + 0.08, 0.08);
  }
  audition(t: number) {
    this.hydraulic(t, 0.8);
    super.audition(t + 0.28);
  }
  event(e: GameEvent, t: number) {
    const s = this.s;
    if (e.type === 'turn' && this.level) this.hydraulic(t, 1);
    else if (e.type === 'eat') {
      // digital confirm blip: two square notes in the biome key
      const d = Math.max(0, Math.min(8, (e.combo | 0) - 1));
      s.tone(this.L.voice(), t, 'square', mtof(this.deg(d, 1)), mtof(this.deg(d, 1)), 0.05, 0.022, { lp: 3500 });
      s.tone(this.L.voice(), t + 0.06, 'square', mtof(this.deg(d + this.key.fifth, 1)), mtof(this.deg(d + this.key.fifth, 1)), 0.07, 0.02, { lp: 3500 });
    } else if (e.type === 'death') {
      // power-down: servos wind down
      this.dead = true;
      this.o1.frequency.setTargetAtTime(40, t, 0.35);
      this.o2.frequency.setTargetAtTime(60, t, 0.35);
      this.sg.gain.setTargetAtTime(0.05, t, 0.02);
      this.sg.gain.setTargetAtTime(0, t + 0.5, 0.3);
    }
  }
}

// ------------------------------------------------------------------ Express (steam train)

const CHUFF_ACCENT = [1, 0.55, 0.78, 0.5];

class TrainLoop extends LegendLoop {
  private bp!: BiquadFilterNode;
  private cg!: GainNode;
  private hissG!: GainNode;
  private next = 0;
  private beat = 0;
  protected ready() { return this.noiseReady('white'); }
  protected build() {
    const n = this.noise('white', 0.9);
    this.bp = this.filter('bandpass', 700, 0.9);
    const lp = this.filter('lowpass', 2600, 0.7);
    this.cg = this.gain(0);
    n.connect(this.bp).connect(lp).connect(this.cg).connect(this.out);
    const h = this.noise('white', 2.1);
    const hp = this.filter('highpass', 5200, 0.7);
    this.hissG = this.gain(0);
    const p = this.pan(0.25);
    h.connect(hp).connect(this.hissG).connect(p).connect(this.out);
  }
  protected update() {
    this.to(this.hissG.gain, this.level * (0.004 + 0.004 * this.u), 0.2);
  }
  tick(now: number, horizon: number) {
    const lv = this.level;
    // ~0.75 chuffs per cell travelled (4 per wheel turn)
    const rate = this.L.speed * 0.75;
    if (!lv || rate < 0.3) { this.next = 0; return; }
    if (this.next < now) { this.next = now + 0.01; this.beat = 0; }
    const u = this.u;
    const g = this.cg.gain, f = this.bp.frequency;
    while (this.next < horizon) {
      const t = this.next;
      const acc = CHUFF_ACCENT[this.beat & 3];
      const peak = lv * acc * (0.6 + 0.4 * u) * 0.28;
      const decay = (0.05 + 0.07 * (1 - u)) * (acc === 1 ? 1.2 : 1);
      f.setValueAtTime(620 * (acc === 1 ? 0.82 : 1.05) + this.rng() * 90, t);
      g.setTargetAtTime(peak, t, 0.004);
      g.setTargetAtTime(0, t + 0.02, decay);
      this.beat++;
      this.next += 1 / rate;
    }
  }
  private whistle(t: number, dur: number, vel: number) {
    // three-chime steam whistle on the biome's tonic triad
    const v = this.L.voice();
    const k = this.key;
    let base = k.sfxRoot;
    while (base > 79) base -= 12;
    while (base < 67) base += 12;
    const amp = v.gain(0);
    amp.connect(v.out);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.05);
    amp.gain.setValueAtTime(vel, t + dur);
    amp.gain.setTargetAtTime(0, t + dur, 0.07);
    const stop = t + dur + 0.5;
    const vib = v.osc('sine', 5.5);
    const vg = v.gain(6);
    vib.connect(vg);
    [0, 2, 4].forEach((d, i) => {
      const f = mtof(base + degToSemi(k.scale, d));
      const o = v.osc(i === 0 ? 'triangle' : 'sine', f);
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.setTargetAtTime(f, t, 0.04);
      vg.connect(o.detune);
      const g = v.gain(i === 0 ? 0.5 : 0.35);
      o.connect(g).connect(amp);
      v.play(o, t, stop);
    });
    const n = v.buffer(this.s.noise('white'), true);
    const bp = v.filter('bandpass', mtof(base) * 2, 2);
    const ng = v.gain(0.5);
    n.connect(bp).connect(ng).connect(amp);
    v.play(n, t, stop, this.rng() * 2);
    v.play(vib, t, stop);
  }
  event(e: GameEvent, t: number) {
    const s = this.s;
    if (e.type === 'eat') {
      if (e.kind === 'golden') { this.whistle(t, 0.35, 0.05); this.whistle(t + 0.5, 0.8, 0.055); }
      else if (this.every('whistle', 0.25, t)) this.whistle(t, 0.32, 0.045);
    } else if (e.type === 'combo' && e.combo >= 2 && this.every('bell', 0.4, t)) {
      let m = this.key.root;
      while (m < 76) m += 12;
      s.bell(this.L.voice(), t + 0.05, m, 1.8, 0.05, { pan: 0.3 });
    } else if (e.type === 'death') {
      // brake squeal + steam release
      const v = this.L.voice();
      const bp = v.filter('bandpass', 2900, 3);
      const amp = v.gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.03, t + 0.05);
      amp.gain.setValueAtTime(0.03, t + 0.45);
      amp.gain.setTargetAtTime(0, t + 0.45, 0.15);
      bp.connect(amp).connect(v.out);
      const lfo = v.osc('sine', 23);
      const lg = v.gain(35);
      lfo.connect(lg);
      for (const [f0, f1, l] of [[2900, 2450, 1], [3710, 3300, 0.35]] as const) {
        const o = v.osc('sine', f0);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.linearRampToValueAtTime(f1, t + 0.9);
        lg.connect(o.frequency);
        const g = v.gain(l);
        o.connect(g).connect(bp);
        v.play(o, t, t + 1.4);
      }
      v.play(lfo, t, t + 1.4);
      s.whoosh(this.L.voice(), t + 0.1, 1.3, 0.07, 3200, 700, 0.9);
      this.cg.gain.cancelScheduledValues(t);
      this.cg.gain.setTargetAtTime(0, t, 0.03);
      this.next = 0;
    }
  }
}

// ------------------------------------------------------------------ Comet

class CometLoop extends LegendLoop {
  private lp!: BiquadFilterNode;
  private g1!: GainNode;
  private bp!: BiquadFilterNode;
  private g2!: GainNode;
  private fl1!: GainNode;
  private fl2!: GainNode;
  private next = 0;
  protected ready() { return this.noiseReady('brown', 'pink'); }
  protected build() {
    const b = this.noise('brown', 0.2);
    this.lp = this.filter('lowpass', 300, 0.9);
    this.g1 = this.gain(0);
    b.connect(this.lp).connect(this.g1).connect(this.out);
    const p = this.noise('pink', 1.9);
    this.bp = this.filter('bandpass', 1200, 0.6);
    this.g2 = this.gain(0);
    p.connect(this.bp).connect(this.g2).connect(this.out);
    // flicker
    const f1 = this.osc('sine', 0.37), f2 = this.osc('sine', 1.3);
    this.fl1 = this.gain(0); this.fl2 = this.gain(0);
    f1.connect(this.fl1).connect(this.g1.gain);
    f2.connect(this.fl2).connect(this.g2.gain);
  }
  protected update() {
    const u = this.u, lv = this.level, tr = this.tr;
    const a = lv * (0.4 + 0.6 * u);
    this.to(this.g1.gain, a * 0.018, lv ? 0.08 : 0.12);
    this.to(this.g2.gain, a * 0.012, lv ? 0.08 : 0.12);
    this.to(this.fl1.gain, a * 0.005, 0.2);
    this.to(this.fl2.gain, a * 0.003, 0.2);
    this.to(this.lp.frequency, 220 + 900 * u, 0.15);
    this.to(this.bp.frequency, 700 + 2200 * u + 600 * tr, 0.15);
  }
  tick(now: number, horizon: number) {
    const lv = this.level;
    if (!lv) { this.next = 0; return; }
    const rate = 1.5 + 5 * this.u;
    if (this.next < now) this.next = now + this.rng() / rate;
    while (this.next < horizon) {
      const m = this.deg(Math.floor(this.rng() * 7), 1);
      const f = mtof(m);
      this.s.tone(this.L.voice(), this.next, 'sine', f, f, 0.12 + this.rng() * 0.14, (0.006 + this.rng() * 0.008) * lv, { pan: bi(this.rng) * 0.7 });
      this.next += -Math.log(1 - this.rng() * 0.95) / rate;
    }
  }
  event(e: GameEvent, t: number) {
    const s = this.s;
    if (e.type === 'eat') {
      // shimmering chime: an icy arpeggio and a detuned sustained top
      const d0 = Math.max(0, Math.min(6, (e.combo | 0) - 1));
      for (let i = 0; i < 5; i++) s.crystal(this.L.voice(), t + i * 0.045, this.deg(d0 + i * 2), 1.2, 0.016 - i * 0.001, { pan: -0.4 + i * 0.2 });
      const top = this.deg(d0 + 8);
      s.crystal(this.L.voice(), t + 0.23, top + 0.07, 2.2, 0.01, { pan: -0.5 });
      s.crystal(this.L.voice(), t + 0.23, top - 0.07, 2.2, 0.01, { pan: 0.5 });
      s.whoosh(this.L.voice(), t, 0.3, 0.03, 1500, 6000, 1, { reverse: true });
    } else if (e.type === 'death') {
      s.whoosh(this.L.voice(), t, 1.4, 0.08, 2400, 180, 0.8, { color: 'pink' });
    }
  }
}

function createLoop(id: CharacterId, L: Legends): LegendLoop {
  switch (id) {
    case 'centipede': return new CentipedeLoop(L);
    case 'eel': return new EelLoop(L);
    case 'dragon': return new DragonLoop(L);
    case 'mecha': return new MechaLoop(L);
    case 'train': return new TrainLoop(L);
    case 'comet': return new CometLoop(L);
  }
}
