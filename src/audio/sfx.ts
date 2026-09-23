// Game-event and UI sound effects.
import type { BiomeId, GameEvent, PowerupKind } from '../types';
import type { UiSound } from './contract';
import { bi, degToSemi } from './dsp';
import { Synth, isPluck } from './instruments';
import { BIOME_KEYS, BiomeKey } from './scores';
import type { Voice, VoiceTracker } from './voices';

export interface SfxHost {
  ctx: BaseAudioContext;
  synth: Synth;
  sfxVoices: VoiceTracker;
  sfxIn: AudioNode;
  uiIn: AudioNode;
  biome: BiomeId;
  now(): number;
  onDeath(): void;
  onStart(): void;
}

export class Sfx {
  private lastTurn = -1;
  private lastHover = -1;
  private lastCountdown = -10;
  private countdownN = 0;
  private lastTick = -1;
  constructor(private h: SfxHost) {}

  private get s() { return this.h.synth; }
  private get key(): BiomeKey { return BIOME_KEYS[this.h.biome]; }
  private v(ui = false): Voice { return this.h.sfxVoices.voice(ui ? this.h.uiIn : this.h.sfxIn); }
  private r(amt = 0.1) { return 1 + bi(this.s.rng) * amt; }
  private rc(c = 8) { return bi(this.s.rng) * c; }
  /** midi of scale degree in the SFX register. */
  private deg(d: number, oct = 0) { const k = this.key; return k.sfxRoot + degToSemi(k.scale, d) + 12 * oct; }

  /** Lead instrument note (biome timbre). */
  private lead(t: number, midi: number, dur: number, vel: number, ui = false, pan = 0) {
    const k = this.key;
    this.s.lead(this.v(ui), t, k.lead, midi, dur, vel, { pan, cents: this.rc(5) });
  }

  handle(e: GameEvent) {
    const t = this.h.now();
    const s = this.s;
    switch (e.type) {
      case 'eat': {
        const combo = Math.max(1, Math.min(12, e.combo | 0));
        const n = this.key.scale.length;
        const d = n >= 7 ? Math.round((combo - 1) * 8 / 7) : combo - 1;
        const m = this.deg(d);
        const pan = 0;
        if (e.kind === 'golden') {
          for (let i = 0; i < 5; i++) this.lead(t + i * 0.055, this.deg(d + i * 2), 0.6, 0.42 - i * 0.04, false, -0.4 + i * 0.2);
          for (let i = 0; i < 3; i++) s.bell(this.v(), t + 0.25 + i * 0.07, this.deg(d + 7 + i), 1.5, 0.05, { glass: true, pan: bi(s.rng) * 0.6 });
        } else {
          this.lead(t, m, 0.9, 0.55 * this.r(0.08), false, pan);
          if (combo >= 3) this.lead(t + 0.07, m + 12, 0.5, 0.12 + combo * 0.012, false, 0.3);
        }
        // sand puff
        s.whoosh(this.v(), t, 0.14, 0.09 * this.r(), 900 * this.r(0.2), 350, 0.8, { color: 'pink' });
        break;
      }
      case 'spawnFood':
        if (e.kind === 'golden') {
          for (let i = 0; i < 4; i++) s.bell(this.v(), t + i * 0.06, this.deg(7 + i * 2), 1.6, 0.05, { glass: true, pan: -0.3 + i * 0.2 });
          s.shaker(this.v(), t, 0.02, 0.4, 8000);
        } else s.wood(this.v(), t, 1900 * this.r(0.05), 0.03, 0.02);
        break;
      case 'foodExpired':
        s.tone(this.v(), t, 'sine', 700, 420, 0.25, 0.05, { glide: 0.08 });
        break;
      case 'powerupSpawn':
        s.bell(this.v(), t, this.deg(0, 1), 1.2, 0.06, { glass: true, pan: -0.2 });
        s.bell(this.v(), t + 0.09, this.deg(this.key.fifth, 1), 1.4, 0.06, { glass: true, pan: 0.2 });
        break;
      case 'powerup':
        this.powerup(e.kind, t);
        break;
      case 'powerupEnd':
        s.tone(this.v(), t, 'sine', 880, 440, 0.18, 0.08, { glide: 0.05 });
        s.tone(this.v(), t + 0.09, 'sine', 660, 330, 0.18, 0.05, { glide: 0.05 });
        break;
      case 'turn': {
        if (t - this.lastTurn < 0.075) break;
        this.lastTurn = t;
        s.whoosh(this.v(), t, 0.08 * this.r(0.2), 0.07 * this.r(0.25), 2200 * this.r(0.25), 1100, 1.1, { pan: bi(s.rng) * 0.3 });
        break;
      }
      case 'nearMiss':
        s.whoosh(this.v(), t, 0.22, 0.13, 500, 3200, 1.4, { pan: bi(s.rng) * 0.4 });
        s.bell(this.v(), t + 0.05, this.deg(9), 0.9, 0.035, { glass: true });
        break;
      case 'combo':
        if (e.combo >= 2) s.bell(this.v(), t + 0.03, this.deg(e.combo + 4), 0.5, 0.02, { glass: true, pan: 0.3 });
        break;
      case 'comboBreak': {
        const v = this.v();
        s.tone(v, t, 'triangle', this.hz(this.deg(this.key.fifth, -2)), this.hz(this.deg(this.key.fifth, -2)), 0.28, 0.07, { lp: 700, attack: 0.03 });
        s.tone(this.v(), t + 0.22, 'triangle', this.hz(this.deg(1, -2)), this.hz(this.deg(0, -2)), 0.45, 0.06, { lp: 600, attack: 0.03, glide: 0.2 });
        break;
      }
      case 'milestone': {
        const degs = [0, this.key.fifth, this.key.scale.length];
        degs.forEach((d, i) => this.lead(t + i * 0.1, this.deg(d), 0.8, 0.4, false, -0.3 + i * 0.3));
        s.bell(this.v(), t + 0.2, this.deg(0, 1), 1.8, 0.05, { glass: true });
        break;
      }
      case 'wrap':
        s.whoosh(this.v(), t, 0.25, 0.1, 700, 1500, 1.2, { pan: bi(s.rng) * 0.5 });
        break;
      case 'hit':
        s.membrane(this.v(), t, 110, 45, 0.15, 0.45, 600, 0.4);
        s.tone(this.v(), t, 'square', 92, 80, 0.3, 0.06, { lp: 900 });
        break;
      case 'death': {
        s.membrane(this.v(), t, 80, 30, 0.45, 0.5, 700, 0.5);
        s.whoosh(this.v(), t, 0.7, 0.2, 1400, 120, 0.7, { color: 'pink' });
        s.whoosh(this.v(), t + 0.35, 1.1, 0.12, 250, 1800, 1.8, { reverse: true });
        const k = this.key;
        const low = k.root - 12;
        if (k.lead === 'bell') s.bell(this.v(), t + 1.45, low + 12, 3.5, 0.12);
        else if (isPluck(k.lead)) s.pluck(this.v(), t + 1.45, k.lead === 'koto' ? 'kotoBass' : k.lead, low, 3, 0.35);
        else s.lead(this.v(), t + 1.45, k.lead, low + 12, 3, 0.4);
        this.h.onDeath();
        break;
      }
      case 'timeWarning': {
        const sl = Math.max(0, Math.min(10, e.secondsLeft));
        const u = (10 - sl) / 10;
        if (t - this.lastTick < 0.3) break;
        this.lastTick = t;
        s.wood(this.v(), t, 1000 + u * 700, 0.06 + u * 0.08, 0.035);
        if (sl <= 3) s.wood(this.v(), t + 0.12, 1000 + u * 700, 0.04 + u * 0.05, 0.03);
        break;
      }
      case 'timeUp':
        s.bell(this.v(), t, this.key.root - 12, 5, 0.22, { ratio: 1.41, index: 3.2 });
        s.membrane(this.v(), t, 70, 45, 0.6, 0.3, 300, 0.2);
        break;
      case 'start': {
        s.whoosh(this.v(), t, 0.5, 0.06, 400, 2200, 1, { color: 'pink' });
        const n = this.key.scale.length;
        [0, 2, 4, n].forEach((d, i) => this.lead(t + 0.1 + i * 0.035, this.deg(Math.min(d, n), -1), 1.6, 0.3, false, -0.3 + i * 0.2));
        this.h.onStart();
        break;
      }
    }
  }

  private hz(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }

  private powerup(kind: PowerupKind, t: number) {
    const s = this.s;
    switch (kind) {
      case 'slow':
        s.tone(this.v(), t, 'sawtooth', 420, 40, 0.8, 0.07, { lp: 1400, glide: 0.25 });
        s.whoosh(this.v(), t, 0.8, 0.12, 2400, 120, 1.2);
        break;
      case 'ghost':
        s.whoosh(this.v(), t, 0.7, 0.14, 500, 2600, 2.5, { reverse: true });
        s.tone(this.v(), t + 0.1, 'sine', this.hz(this.deg(0, 1)), this.hz(this.deg(4, 1)), 0.7, 0.05, { attack: 0.5, glide: 0.3 });
        break;
      case 'magnet': {
        const v = this.v();
        const o = v.osc('sine', 110);
        const o2 = v.osc('triangle', 220.5);
        const l = v.osc('sine', 9);
        const lg = v.gain(9);
        l.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
        const g = v.gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.08, t + 0.08);
        g.gain.setTargetAtTime(0, t + 0.45, 0.12);
        const g2 = v.gain(0.4);
        o.connect(g); o2.connect(g2).connect(g); g.connect(v.out);
        v.play(o, t, t + 1.2); v.play(o2, t, t + 1.2); v.play(l, t, t + 1.2);
        break;
      }
      case 'double':
        s.bell(this.v(), t, this.deg(7), 0.5, 0.1, { ratio: 2, index: 0.8 });
        s.bell(this.v(), t + 0.09, this.deg(7 + this.key.fifth), 1.2, 0.1, { ratio: 2, index: 0.8 });
        break;
      case 'shed':
        for (let i = 0; i < 14; i++) s.shaker(this.v(), t + i * 0.028 + s.rng() * 0.02, 0.03 + s.rng() * 0.05, 0.02, 2500 + s.rng() * 3000, bi(s.rng) * 0.5);
        break;
    }
  }

  ui(sound: UiSound) {
    const t = this.h.now();
    const s = this.s;
    const U = true;
    switch (sound) {
      case 'hover':
        if (t - this.lastHover < 0.05) return;
        this.lastHover = t;
        s.wood(this.v(U), t, 1500 * this.r(0.06), 0.022, 0.018);
        break;
      case 'click':
        s.wood(this.v(U), t, 900, 0.09, 0.03);
        s.bell(this.v(U), t + 0.005, this.deg(this.key.scale.length), 0.7, 0.03, { glass: true });
        break;
      case 'back':
        s.wood(this.v(U), t, 620, 0.08, 0.035);
        s.bell(this.v(U), t + 0.005, this.deg(0), 0.6, 0.025, { glass: true });
        break;
      case 'toggle':
        s.wood(this.v(U), t, 1150, 0.06, 0.02);
        s.wood(this.v(U), t + 0.05, 820, 0.06, 0.025);
        break;
      case 'start': {
        const n = this.key.scale.length;
        const chord = [0, 2, 4].map((d) => this.deg(d, -1));
        s.pad(this.v(U), t, chord, 1.4, 0.08, { cutoff: 1800 });
        [0, 2, 4, n].forEach((d, i) => this.lead(t + i * 0.04, this.deg(d, -1), 1.4, 0.3, U, -0.3 + i * 0.2));
        break;
      }
      case 'achievement': {
        const n = this.key.scale.length;
        [0, 2, 4, n].forEach((d, i) => this.lead(t + i * 0.11, this.deg(d), 1, 0.38, U, -0.3 + i * 0.2));
        for (let i = 0; i < 4; i++) s.bell(this.v(U), t + 0.4 + i * 0.05, this.deg(n + 2 + i), 1.4, 0.03, { glass: true, pan: bi(s.rng) * 0.6 });
        break;
      }
      case 'unlock': {
        const n = this.key.scale.length;
        for (let i = 0; i < 6; i++) this.lead(t + i * 0.08, this.deg(i, -1), 1.2, 0.34, U, -0.5 + i * 0.2);
        [0, 2, 4, n].forEach((d) => this.lead(t + 0.55, this.deg(d), 2, 0.25, U));
        s.membrane(this.v(U), t + 0.55, 80, 50, 0.35, 0.35, 300, 0.3);
        for (let i = 0; i < 6; i++) s.bell(this.v(U), t + 0.6 + i * 0.06, this.deg(n + 2 + i), 1.8, 0.03, { glass: true, pan: bi(s.rng) * 0.7 });
        break;
      }
      case 'countdown': {
        if (t - this.lastCountdown > 1.6) this.countdownN = 0;
        this.lastCountdown = t;
        const d = this.countdownN++;
        s.wood(this.v(U), t, 800 + d * 120, 0.08, 0.04);
        s.bell(this.v(U), t, this.deg(d, -1), 0.6, 0.05, { glass: true });
        break;
      }
      case 'go': {
        this.countdownN = 0;
        s.bell(this.v(U), t, this.deg(this.key.scale.length), 1.4, 0.1, { ratio: 2, index: 1.2 });
        const n = this.key.scale.length;
        [0, 2, 4].forEach((d, i) => this.lead(t + i * 0.012, this.deg(d + n, -1), 1, 0.3, U));
        s.shaker(this.v(U), t, 0.06, 0.1, 5000);
        break;
      }
    }
  }
}
