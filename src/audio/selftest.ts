// Offline self-test: renders the real engine graph into an OfflineAudioContext and checks
// objective metrics (peak, RMS, NaN, DC, clipping, silence, spectral centroid).
import type { BiomeId, CharacterId, GameEvent } from '../types';
import type { UiSound } from './contract';
import { AudioCore } from './core';
import { LEGEND_IDS } from './legends';

export const OLD_BIOMES: BiomeId[] = ['karesansui', 'erg', 'lagoon', 'svartsandur', 'salar'];
export const NEW_BIOMES: BiomeId[] = ['pinksands', 'vaadhoo', 'dallol', 'luna', 'mars', 'titan', 'kepler'];
export const BIOME_IDS: BiomeId[] = [...OLD_BIOMES, ...NEW_BIOMES];
/** Biome used for each Legend's demo WAV. */
const LEGEND_WAV_BIOME: Record<CharacterId, BiomeId> = {
  centipede: 'erg', eel: 'vaadhoo', dragon: 'karesansui', mecha: 'mars', train: 'pinksands', comet: 'kepler',
};
const SR = 44100;

export interface Action { t: number; fn: (c: AudioCore) => void }
export interface Script { dur: number; setup: (c: AudioCore) => void; actions?: Action[]; seed?: number }

export async function renderOffline(s: Script): Promise<{ buf: AudioBuffer; core: AudioCore; ms: number }> {
  const t0 = performance.now();
  const ctx = new OfflineAudioContext(2, Math.ceil(s.dur * SR), SR);
  const core = new AudioCore(ctx, ctx.destination, { offline: true, seed: s.seed ?? 4242 });
  s.setup(core);
  core.tick();
  const acts = (s.actions ?? []).slice().sort((a, b) => a.t - b.t);
  let ai = 0;
  const step = 0.1;
  const n = Math.floor(s.dur / step);
  for (let i = 1; i < n; i++) {
    const tt = i * step;
    ctx.suspend(tt).then(() => {
      try {
        while (ai < acts.length && acts[ai].t <= tt + 1e-6) acts[ai++].fn(core);
        core.tick();
      } catch (e) { console.error('[selftest] action error', e); core.errors++; }
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  return { buf, core, ms: performance.now() - t0 };
}

// ------------------------------------------------------------------ analysis

function fftMag(re: Float64Array): Float64Array {
  const n = re.length;
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi2 = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi2;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi2;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const m = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]);
  return m;
}

export interface Metrics {
  peak: number; rms: number; rmsDb: number; nan: number; dc: number; clip: number;
  centroid: number; longestSilence: number;
}

export function analyze(buf: AudioBuffer, from = 0, to = buf.duration): Metrics {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(from * sr)), b = Math.min(buf.length, Math.floor(to * sr));
  const chs = [buf.getChannelData(0), buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0)];
  let peak = 0, sum = 0, nan = 0, dcs = 0, clip = 0;
  for (const d of chs) {
    for (let i = a; i < b; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) { nan++; continue; }
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
      if (ax >= 0.98) clip++;
      sum += x * x; dcs += x;
    }
  }
  const N = Math.max(1, (b - a) * 2);
  const rms = Math.sqrt(sum / N);
  // silence: longest run of 250 ms windows below -60 dBFS
  const win = Math.floor(sr * 0.25);
  let run = 0, longest = 0;
  for (let s = a; s + win <= b; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) { const x = chs[0][i] + chs[1][i]; e += x * x; }
    const r = Math.sqrt(e / win) / 2;
    if (r < 0.001) { run += 0.25; longest = Math.max(longest, run); } else run = 0;
  }
  // spectral centroid (energy-weighted average over frames)
  const F = 2048;
  let cNum = 0, cDen = 0;
  for (let s = a; s + F <= b; s += Math.floor(sr * 0.2)) {
    const re = new Float64Array(F);
    for (let i = 0; i < F; i++) re[i] = (chs[0][s + i] + chs[1][s + i]) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / F));
    const m = fftMag(re);
    let num = 0, den = 0;
    for (let k = 1; k < m.length; k++) { num += k * (sr / F) * m[k]; den += m[k]; }
    if (den > 1e-9) { cNum += num; cDen += den; }
  }
  return {
    peak, rms, rmsDb: 20 * Math.log10(rms + 1e-12), nan, dc: dcs / N, clip,
    centroid: cDen > 0 ? cNum / cDen : 0, longestSilence: longest,
  };
}

// ------------------------------------------------------------------ WAV

export function encodeWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, data[c][i] || 0));
    out.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
  }
  return new Uint8Array(out.buffer);
}

export function toBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------ test suite

interface Result { name: string; pass: boolean; info: string }

const fmt = (m: Metrics) =>
  `peak=${m.peak.toFixed(3)} rms=${m.rmsDb.toFixed(1)}dB nan=${m.nan} dc=${m.dc.toExponential(1)} clip=${m.clip} centroid=${m.centroid.toFixed(0)}Hz silence=${m.longestSilence.toFixed(2)}s`;

const EVENTS: GameEvent[] = [
  { type: 'start' },
  { type: 'eat', x: 1, y: 1, kind: 'normal', combo: 1, points: 10, length: 4 },
  { type: 'eat', x: 1, y: 1, kind: 'normal', combo: 4, points: 40, length: 5 },
  { type: 'eat', x: 1, y: 1, kind: 'normal', combo: 8, points: 80, length: 6 },
  { type: 'eat', x: 1, y: 1, kind: 'golden', combo: 2, points: 100, length: 7 },
  { type: 'spawnFood', x: 1, y: 1, kind: 'normal' },
  { type: 'spawnFood', x: 1, y: 1, kind: 'golden' },
  { type: 'foodExpired', x: 1, y: 1 },
  { type: 'powerupSpawn', x: 1, y: 1, kind: 'slow' },
  { type: 'powerup', x: 1, y: 1, kind: 'slow' },
  { type: 'powerup', x: 1, y: 1, kind: 'ghost' },
  { type: 'powerup', x: 1, y: 1, kind: 'magnet' },
  { type: 'powerup', x: 1, y: 1, kind: 'double' },
  { type: 'powerup', x: 1, y: 1, kind: 'shed' },
  { type: 'powerupEnd', kind: 'ghost' },
  { type: 'turn', x: 1, y: 1 },
  { type: 'nearMiss', x: 1, y: 1, points: 5 },
  { type: 'combo', combo: 3 },
  { type: 'comboBreak', combo: 3 },
  { type: 'milestone', length: 10, points: 100 },
  { type: 'wrap', x: 1, y: 1 },
  { type: 'hit', x: 1, y: 1, cause: 'wall' },
  { type: 'timeWarning', secondsLeft: 5 },
  { type: 'timeUp' },
  { type: 'death', x: 1, y: 1, cause: 'self' },
];
const UIS: UiSound[] = ['hover', 'click', 'back', 'start', 'toggle', 'achievement', 'unlock', 'countdown', 'go'];

export async function runSelfTest(opts: { wav?: boolean; wavAll?: boolean; only?: string; log?: (s: string) => void } = {}) {
  const log = opts.log ?? ((s: string) => console.log(s));
  const results: Result[] = [];
  const centroids: Record<string, number> = {};
  const wavs: Record<string, string> = {};
  const metrics: Record<string, unknown> = {};
  /** `only=music,legend,...` limits the run to some sections (dev iteration). */
  const want = (sec: string) => !opts.only || opts.only.split(',').includes(sec);
  const check = (name: string, pass: boolean, info: string) => {
    results.push({ name, pass, info });
    log(`[selftest] ${pass ? 'PASS' : 'FAIL'} ${name} ${info}`);
  };
  const sane = (m: Metrics, lo = -40, hi = -10, maxSil = 2) =>
    m.peak < 0.98 && m.nan === 0 && Math.abs(m.dc) < 0.01 && m.clip === 0 && m.rmsDb > lo && m.rmsDb < hi && m.longestSilence < maxSil;
  const tryRun = async (name: string, f: () => Promise<void>) => {
    try { await f(); } catch (e) { check(name, false, 'EXCEPTION ' + String((e as Error)?.stack ?? e)); }
  };

  // 1. music per biome at two intensities
  for (const b of want('music') ? BIOME_IDS : []) {
    const rms: number[] = [];
    for (const inten of [0.2, 0.9]) {
      await tryRun(`music:${b}@${inten}`, async () => {
        const { buf, core, ms } = await renderOffline({
          dur: 10, setup: (c) => { c.setVolumes(1, 0.8, 0.9, false); c.setBiome(b); c.setScene('game'); c.setIntensity(inten); },
        });
        const m = analyze(buf, 1.5, 10);
        rms.push(m.rms);
        centroids[`${b}@${inten}`] = m.centroid;
        metrics[`music:${b}@${inten}`] = { peak: +m.peak.toFixed(3), rmsDb: +m.rmsDb.toFixed(1), centroid: Math.round(m.centroid), silence: m.longestSilence, renderMs: Math.round(ms) };
        const st = core.stats();
        check(`music:${b}@${inten}`, sane(m) && st.errors === 0, `${fmt(m)} voices=${st.musicVoices} errors=${st.errors} render=${ms.toFixed(0)}ms`);
      });
    }
    if (rms.length === 2) check(`layers:${b}`, rms[1] > rms[0] * 1.05, `rms0.2=${(20 * Math.log10(rms[0])).toFixed(1)}dB rms0.9=${(20 * Math.log10(rms[1])).toFixed(1)}dB`);
  }

  // 2. scenes
  for (const b of want('scene') ? ['karesansui', 'salar', 'luna', 'titan'] as BiomeId[] : []) {
    await tryRun(`scene:menu:${b}`, async () => {
      const { buf } = await renderOffline({ dur: 8, setup: (c) => { c.setBiome(b); c.setScene('menu'); } });
      const m = analyze(buf, 1, 8);
      check(`scene:menu:${b}`, sane(m, -50, -12, 3), fmt(m));
    });
    await tryRun(`scene:over:${b}`, async () => {
      const { buf } = await renderOffline({
        dur: 12,
        setup: (c) => { c.setBiome(b); c.setScene('game'); c.setIntensity(0.8); },
        actions: [
          { t: 4, fn: (c) => c.handleEvents([{ type: 'death', x: 0, y: 0, cause: 'wall' }]) },
          { t: 5, fn: (c) => c.setScene('over') },
        ],
      });
      const pre = analyze(buf, 1.5, 4), post = analyze(buf, 6, 12);
      check(`scene:over:${b}`, sane(pre) && sane(post, -50, -10, 3) && post.rms < pre.rms, `pre{${fmt(pre)}} post{${fmt(post)}}`);
    });
    await tryRun(`scene:paused:${b}`, async () => {
      const { buf } = await renderOffline({
        dur: 10, setup: (c) => { c.setBiome(b); c.setScene('game'); c.setIntensity(0.5); },
        actions: [{ t: 4.5, fn: (c) => c.setScene('paused') }],
      });
      const pre = analyze(buf, 1.5, 4.5), post = analyze(buf, 6, 10);
      check(`scene:paused:${b}`, sane(pre) && post.nan === 0 && post.rms < pre.rms && post.centroid < pre.centroid, `pre{${fmt(pre)}} post{${fmt(post)}}`);
    });
  }

  // 3. slow time
  if (want('scene')) await tryRun('timescale', async () => {
    let bpmA = 0, bpmB = 0;
    const { buf } = await renderOffline({
      dur: 12, setup: (c) => { c.setBiome('erg'); c.setScene('game'); c.setIntensity(0.9); },
      actions: [
        { t: 5.5, fn: (c) => { bpmA = c.stats().bpm; c.setTimeScale(0.5); bpmB = c.stats().bpm; } },
      ],
    });
    const pre = analyze(buf, 1.5, 5.5), post = analyze(buf, 7, 12);
    check('timescale:0.5', post.nan === 0 && post.centroid < pre.centroid * 0.8 && Math.abs(bpmB / bpmA - 0.6) < 0.01,
      `bpm ${bpmA}->${bpmB.toFixed(1)} centroid ${pre.centroid.toFixed(0)}->${post.centroid.toFixed(0)}Hz`);
  });

  // 4. biome crossfade
  if (want('scene')) await tryRun('crossfade', async () => {
    const { buf, core } = await renderOffline({
      dur: 12, setup: (c) => { c.setBiome('karesansui'); c.setScene('game'); c.setIntensity(0.7); },
      actions: [{ t: 4, fn: (c) => c.setBiome('luna') }, { t: 8, fn: (c) => c.setBiome('kepler') }],
    });
    const m = analyze(buf, 1.5, 12);
    check('crossfade', sane(m) && core.stats().runtimes <= 2, `${fmt(m)} runtimes=${core.stats().runtimes}`);
  });

  // 5. sfx (music muted)
  for (const b of want('sfx') ? BIOME_IDS : []) {
    await tryRun(`sfx:${b}`, async () => {
      const gap = 2.2;
      const list = b === 'karesansui' ? EVENTS : EVENTS.filter((e) => e.type === 'eat' || e.type === 'start' || e.type === 'death' || e.type === 'milestone');
      const n = list.length + (b === 'karesansui' ? UIS.length : 0);
      const { buf, core } = await renderOffline({
        dur: 1 + n * gap + 2.5,
        setup: (c) => { c.setVolumes(1, 0, 1, false); c.setBiome(b); c.setScene('game'); },
        actions: [
          ...list.map((e, i) => ({ t: 1 + i * gap, fn: (c: AudioCore) => c.handleEvents([e]) })),
          ...(b === 'karesansui' ? UIS.map((u, i) => ({ t: 1 + (list.length + i) * gap, fn: (c: AudioCore) => c.ui(u) })) : []),
        ],
      });
      let bad = 0;
      const names = [...list.map((e) => e.type + ('kind' in e ? ':' + e.kind : '') + ('combo' in e ? ':' + e.combo : '')), ...(b === 'karesansui' ? UIS.map((u) => 'ui:' + u) : [])];
      names.forEach((nm, i) => {
        const t = 1 + i * gap - 0.05;
        const m = analyze(buf, t, t + gap);
        const ok = m.peak > 0.004 && m.peak < 0.98 && m.nan === 0;
        if (!ok) bad++;
        log(`[selftest]   ${b} ${nm.padEnd(22)} peak=${m.peak.toFixed(3)} rms=${m.rmsDb.toFixed(1)}dB centroid=${m.centroid.toFixed(0)}${ok ? '' : '  <-- BAD'}`);
      });
      const all = analyze(buf);
      check(`sfx:${b}`, bad === 0 && all.nan === 0 && core.stats().errors === 0, `${names.length} sounds, bad=${bad} ${fmt(all)}`);
    });
  }

  // 6. slither
  let slitherRef = 0;
  if (want('slither') || want('legend')) await tryRun('slither', async () => {
    const { buf } = await renderOffline({
      dur: 9,
      setup: (c) => { c.setVolumes(1, 0, 1, false); c.setBiome('karesansui'); c.setScene('game'); c.setSlither(0, 0); },
      actions: [
        { t: 2, fn: (c) => c.setSlither(3, 0) },
        { t: 4, fn: (c) => c.setSlither(9, 0) },
        { t: 6, fn: (c) => c.setSlither(9, 5) },
        { t: 7.5, fn: (c) => c.setSlither(0, 0) },
      ],
    });
    const off = analyze(buf, 0.5, 2), slow = analyze(buf, 2.5, 4), fast = analyze(buf, 4.5, 6), turn = analyze(buf, 6.3, 7.5), off2 = analyze(buf, 8.2, 9);
    const pass = off.rms < 1e-4 && slow.rms > 1e-3 && fast.rms > slow.rms && turn.rms > fast.rms && off2.rms < 1e-3 && fast.peak < 0.5 && fast.nan === 0;
    check('slither', pass, `off=${off.rmsDb.toFixed(1)} slow=${slow.rmsDb.toFixed(1)} fast=${fast.rmsDb.toFixed(1)} turn=${turn.rmsDb.toFixed(1)} off2=${off2.rmsDb.toFixed(1)}dB centroid fast=${fast.centroid.toFixed(0)}`);
    for (const b of BIOME_IDS.slice(1)) {
      const r = await renderOffline({ dur: 3, setup: (c) => { c.setVolumes(1, 0, 1, false); c.setBiome(b); c.setScene('game'); c.setSlither(7, 2); } });
      const m = analyze(r.buf, 1, 3);
      metrics[`slither:${b}`] = { rmsDb: +m.rmsDb.toFixed(1), centroid: Math.round(m.centroid) };
      check(`slither:${b}`, m.rms > 1e-3 && m.peak < 0.5 && m.nan === 0, `rms=${m.rmsDb.toFixed(1)}dB centroid=${m.centroid.toFixed(0)}Hz`);
    }
  });

  // 6b. Legends: loop silent at speed 0, audible when moving, signature SFX sane
  if (want('legend')) await tryRun('legend:ref', async () => {
    const r = await renderOffline({ dur: 4, setup: (c) => { c.setVolumes(1, 0, 1, false); c.setBiome('karesansui'); c.setScene('game'); c.setSlither(6, 0); } });
    const m = analyze(r.buf, 2.6, 4);
    slitherRef = m.rms;
    metrics['slither:karesansui@6'] = { rmsDb: +m.rmsDb.toFixed(1) };
  });
  for (const id of want('legend') ? LEGEND_IDS : []) {
    await tryRun(`legend:${id}`, async () => {
      const ev = (e: GameEvent) => (c: AudioCore) => c.handleEvents([e]);
      const { buf, core } = await renderOffline({
        dur: 14,
        setup: (c) => { c.setVolumes(1, 0, 1, false); c.setBiome('karesansui'); c.setScene('game'); c.setCharacter(id); c.setSlither(0, 0); },
        actions: [
          { t: 2, fn: (c) => c.setSlither(6, 0) },
          { t: 5, fn: (c) => c.setSlither(10, 0) },
          { t: 5.6, fn: (c) => { c.setSlither(10, 4); c.handleEvents([{ type: 'turn', x: 0, y: 0 }]); } },
          { t: 6.1, fn: (c) => { c.setSlither(10, 0); c.handleEvents([{ type: 'turn', x: 0, y: 0 }]); } },
          { t: 6.6, fn: (c) => c.setSlither(0, 0) },
          { t: 9, fn: (c) => c.setSlither(6, 0) },
          { t: 9.2, fn: ev({ type: 'eat', x: 0, y: 0, kind: 'normal', combo: 1, points: 10, length: 5 }) },
          { t: 10.0, fn: (c) => c.handleEvents([{ type: 'eat', x: 0, y: 0, kind: 'normal', combo: 4, points: 40, length: 6 }, { type: 'combo', combo: 4 }]) },
          { t: 10.8, fn: ev({ type: 'eat', x: 0, y: 0, kind: 'golden', combo: 5, points: 100, length: 7 }) },
          { t: 11.6, fn: (c) => { c.handleEvents([{ type: 'death', x: 0, y: 0, cause: 'wall' }]); c.setSlither(0, 0); } },
        ],
      });
      const off = analyze(buf, 0.5, 2), slow = analyze(buf, 2.6, 5), fast = analyze(buf, 5.1, 5.55), off2 = analyze(buf, 7.8, 9);
      const evs = analyze(buf, 9, 14);
      const st = core.stats();
      const rel = slitherRef ? 20 * Math.log10(slow.rms / slitherRef) : 0;
      metrics[`legend:${id}`] = {
        offDb: +off.rmsDb.toFixed(1), speed6Db: +slow.rmsDb.toFixed(1), speed10Db: +fast.rmsDb.toFixed(1), stopDb: +off2.rmsDb.toFixed(1),
        vsSlitherDb: +rel.toFixed(1), eventsPeak: +evs.peak.toFixed(3), centroid6: Math.round(slow.centroid), legendVoices: st.legendVoices,
      };
      const pass = off.rms < 1e-4 && slow.rms > 1e-3 && fast.rms >= slow.rms * 0.9 && off2.rms < 1e-3 && slow.peak < 0.5 && fast.peak < 0.6
        && evs.peak < 0.98 && evs.nan === 0 && slow.nan === 0 && st.errors === 0 && st.character === id && Math.abs(rel) < 5;
      check(`legend:${id}`, pass, `off=${off.rmsDb.toFixed(1)} v6=${slow.rmsDb.toFixed(1)} v10=${fast.rmsDb.toFixed(1)} stop=${off2.rmsDb.toFixed(1)}dB vsSlither=${rel.toFixed(1)}dB peak6=${slow.peak.toFixed(3)} events{${fmt(evs)}}`);
    });
  }
  // menu preview: each Legend auditions its signature once; the loop itself stays silent
  if (want('legend')) await tryRun('legend:audition', async () => {
    const { buf, core } = await renderOffline({
      dur: 1 + LEGEND_IDS.length * 2 + 1,
      setup: (c) => { c.setVolumes(1, 0, 1, false); c.setBiome('kepler'); c.setScene('menu'); c.setSlither(2, 0); },
      actions: LEGEND_IDS.map((id, i) => ({ t: 1 + i * 2, fn: (c: AudioCore) => c.setCharacter(id) })),
    });
    const quiet = analyze(buf, 0.2, 1);
    const peaks = LEGEND_IDS.map((_, i) => analyze(buf, 1 + i * 2, 3 + i * 2).peak);
    check('legend:audition', quiet.rms < 1e-4 && peaks.every((p) => p > 0.01 && p < 0.9) && core.stats().errors === 0,
      LEGEND_IDS.map((id, i) => `${id}=${peaks[i].toFixed(3)}`).join(' '));
  });
  // snake after legend: slither returns, legend loop gone
  if (want('legend')) await tryRun('legend:switchback', async () => {
    const { buf, core } = await renderOffline({
      dur: 6,
      setup: (c) => { c.setVolumes(1, 0, 1, false); c.setBiome('erg'); c.setScene('game'); c.setCharacter('train'); c.setSlither(7, 0); },
      actions: [{ t: 2.5, fn: (c) => c.setCharacter('obsidian') }, { t: 4.5, fn: (c) => c.setScene('menu') }],
    });
    const a = analyze(buf, 1, 2.5), b = analyze(buf, 3.2, 4.5), c2 = analyze(buf, 5.4, 6);
    check('legend:switchback', a.rms > 1e-3 && b.rms > 1e-3 && c2.rms < 1e-3 && core.stats().character === null,
      `train=${a.rmsDb.toFixed(1)} snake=${b.rmsDb.toFixed(1)} menu=${c2.rmsDb.toFixed(1)}dB`);
  });

  // 7. voice-limit stress
  if (want('stress')) await tryRun('stress', async () => {
    let maxVoices = 0;
    const burst: GameEvent[] = [];
    for (let i = 0; i < 40; i++) burst.push({ type: 'eat', x: 0, y: 0, kind: i % 5 ? 'normal' : 'golden', combo: 1 + (i % 8), points: 10, length: 5 });
    const { buf, core } = await renderOffline({
      dur: 5, setup: (c) => { c.setBiome('salar'); c.setScene('game'); c.setIntensity(1); },
      actions: [1, 1.2, 1.4, 1.6].map((t) => ({ t, fn: (c: AudioCore) => { c.handleEvents(burst); maxVoices = Math.max(maxVoices, c.sfxVoices.count); } })),
    });
    const m = analyze(buf);
    check('stress', m.nan === 0 && m.peak < 0.98 && maxVoices <= 24, `${fmt(m)} maxSfxVoices=${maxVoices} stolen=${core.sfxVoices.stolen}`);
  });

  // centroid summary
  log('[selftest] centroids: ' + Object.entries(centroids).map(([k, v]) => `${k}=${v.toFixed(0)}Hz`).join(' '));

  // 8. 20 s demo WAV per biome
  if (opts.wav && want('wav')) {
    for (const b of opts.wavAll ? BIOME_IDS : NEW_BIOMES) {
      await tryRun(`wav:${b}`, async () => {
        const acts: Action[] = [
          { t: 6, fn: (c) => c.setIntensity(0.5) },
          { t: 13, fn: (c) => c.setIntensity(0.9) },
        ];
        for (let i = 0; i < 11; i++) {
          const t = 2 + i * 1.6;
          acts.push({ t, fn: (c) => c.handleEvents([{ type: 'eat', x: 0, y: 0, kind: i === 7 ? 'golden' : 'normal', combo: 1 + (i % 8), points: 10, length: 5 }]) });
          acts.push({ t: t + 0.8, fn: (c) => { c.handleEvents([{ type: 'turn', x: 0, y: 0 }]); c.setSlither(6, i % 2 ? 3 : 0); } });
        }
        acts.push({ t: 10.3, fn: (c) => c.handleEvents([{ type: 'nearMiss', x: 0, y: 0, points: 5 }]) });
        const { buf } = await renderOffline({
          dur: 20, setup: (c) => { c.setVolumes(1, 0.8, 0.9, false); c.setBiome(b); c.setScene('game'); c.setIntensity(0.15); c.setSlither(6, 0); },
          actions: acts,
        });
        const m = analyze(buf, 1, 20);
        wavs[b] = toBase64(encodeWav(buf));
        metrics[`wav:${b}`] = { peak: +m.peak.toFixed(3), rmsDb: +m.rmsDb.toFixed(1), centroid: Math.round(m.centroid) };
        check(`wav:${b}`, sane(m), fmt(m));
      });
    }
    // 10 s demo per Legend, in the mix of a fitting world
    for (const id of LEGEND_IDS) {
      await tryRun(`wav:legend-${id}`, async () => {
        const acts: Action[] = [
          { t: 1.2, fn: (c) => c.setSlither(4, 0) },
          { t: 3, fn: (c) => c.setSlither(7, 0) },
          { t: 5.5, fn: (c) => c.setSlither(10, 0) },
          { t: 8.4, fn: (c) => c.setSlither(0, 0) },
          { t: 8.4, fn: (c) => c.handleEvents([{ type: 'death', x: 0, y: 0, cause: 'wall' }]) },
        ];
        for (let i = 0; i < 5; i++) {
          const t = 1.8 + i * 1.3, combo = i + 1;
          acts.push({ t, fn: (c) => c.handleEvents([{ type: 'eat', x: 0, y: 0, kind: i === 4 ? 'golden' : 'normal', combo, points: 10, length: 5 }, ...(combo >= 2 ? [{ type: 'combo', combo } as GameEvent] : [])]) });
          acts.push({ t: t + 0.6, fn: (c) => { c.handleEvents([{ type: 'turn', x: 0, y: 0 }]); c.setSlither(5 + i * 1.2, i % 2 ? 3.5 : 0); } });
        }
        const { buf } = await renderOffline({
          dur: 10, setup: (c) => { c.setVolumes(1, 0.7, 0.9, false); c.setBiome(LEGEND_WAV_BIOME[id]); c.setScene('game'); c.setIntensity(0.35); c.setCharacter(id); c.setSlither(0, 0); },
          actions: acts,
        });
        const m = analyze(buf, 1, 10);
        wavs[`legend-${id}`] = toBase64(encodeWav(buf));
        metrics[`wav:legend-${id}`] = { peak: +m.peak.toFixed(3), rmsDb: +m.rmsDb.toFixed(1), centroid: Math.round(m.centroid) };
        check(`wav:legend-${id}`, sane(m), fmt(m));
      });
    }
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  log(`[selftest] SUMMARY pass=${pass} fail=${fail}`);
  return { pass, fail, results, centroids, wavs, metrics };
}
