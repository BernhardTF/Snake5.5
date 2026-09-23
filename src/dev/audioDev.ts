// Audio test bench: ?dev=audio   (self-test: ?dev=audio&selftest=1[&wav=1])
import { AudioEngine } from '../audio/AudioEngine';
import type { UiSound } from '../audio/contract';
import type { BiomeId, GameEvent, PowerupKind, SkinId } from '../types';

const BIOMES: BiomeId[] = ['karesansui', 'erg', 'lagoon', 'svartsandur', 'salar', 'pinksands', 'vaadhoo', 'dallol', 'luna', 'mars', 'titan', 'kepler'];
const CHARS: SkinId[] = ['obsidian', 'centipede', 'eel', 'dragon', 'mecha', 'train', 'comet'];
const SCENES = ['menu', 'game', 'paused', 'over'] as const;
const UIS: UiSound[] = ['hover', 'click', 'back', 'start', 'toggle', 'achievement', 'unlock', 'countdown', 'go'];
const PU: PowerupKind[] = ['slow', 'ghost', 'magnet', 'double', 'shed'];

export async function runAudioDev(p: URLSearchParams) {
  const canvas = document.getElementById('game');
  if (canvas) (canvas as HTMLElement).style.display = 'none';
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:16px;font:13px system-ui,sans-serif;background:#1b1a17;color:#eee;z-index:10';
  document.body.appendChild(root);
  const css = document.createElement('style');
  css.textContent = `#abench button{margin:2px;padding:6px 9px;background:#3a352c;color:#f3e7cf;border:1px solid #6a5c43;border-radius:6px;cursor:pointer}
  #abench button:hover{background:#524a3b} #abench h3{margin:12px 0 4px;color:#c9a45c;font-size:13px} #abench pre{white-space:pre-wrap;font-size:11px;color:#bfb}`;
  document.head.appendChild(css);
  root.id = 'abench';

  if (p.get('spectro')) { await spectro(root, p.get('spectro')!.split(',')); return; }

  if (p.get('selftest')) {
    root.innerHTML = '<h2>Audio self-test (offline render)</h2><pre id="out"></pre>';
    const out = root.querySelector('#out')!;
    const { runSelfTest } = await import('../audio/selftest');
    const res = await runSelfTest({
      wav: !!p.get('wav'), wavAll: !!p.get('wavall'), only: p.get('only') ?? undefined,
      log: (s) => { console.log(s); out.textContent += s + '\n'; },
    });
    if (!p.get('only') || p.get('only')!.includes('perf')) {
      const { runPerfTest } = await import('../audio/perftest');
      res.metrics.perf = await runPerfTest((s) => { console.log(s); out.textContent += s + '\n'; });
    }
    (window as unknown as Record<string, unknown>).__audioSelfTest = res;
    (window as unknown as Record<string, unknown>).__audioSelfTestDone = true;
    return;
  }

  const eng = new AudioEngine();
  (window as unknown as Record<string, unknown>).__audio = eng;
  const section = (title: string) => {
    const h = document.createElement('h3'); h.textContent = title; root.appendChild(h);
    const d = document.createElement('div'); root.appendChild(d); return d;
  };
  const btn = (parent: HTMLElement, id: string, label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.id = id; b.textContent = label;
    b.onclick = () => { eng.unlock(); fn(); };
    b.onmouseenter = () => eng.ui('hover');
    parent.appendChild(b);
    return b;
  };
  const slider = (parent: HTMLElement, id: string, label: string, min: number, max: number, val: number, fn: (v: number) => void) => {
    const l = document.createElement('label');
    l.style.marginRight = '14px';
    l.textContent = label + ' ';
    const s = document.createElement('input');
    s.type = 'range'; s.id = id; s.min = String(min); s.max = String(max); s.step = String((max - min) / 100); s.value = String(val);
    const v = document.createElement('span'); v.textContent = String(val);
    s.oninput = () => { v.textContent = (+s.value).toFixed(2); fn(+s.value); };
    l.append(s, v); parent.appendChild(l);
  };

  const top = section('Engine');
  btn(top, 'unlock', 'Unlock', () => {});
  btn(top, 'suspend', 'Suspend', () => eng.suspend());
  btn(top, 'resume', 'Resume', () => eng.resume());
  let slow = false;
  btn(top, 'timescale', 'Toggle slow-time', () => { slow = !slow; eng.setTimeScale(slow ? 0.5 : 1); });
  let muted = false;
  const vols = { master: 1, music: 0.7, sfx: 0.9 };
  const applyVol = () => eng.setVolumes(vols.master, vols.music, vols.sfx, muted);
  btn(top, 'mute', 'Mute toggle', () => { muted = !muted; applyVol(); });

  const bi = section('Biome');
  for (const b of BIOMES) btn(bi, 'biome-' + b, b, () => eng.setBiome(b));
  const ch = section('Character (snake = slither loop, Legends = own loop + signature SFX)');
  for (const c of CHARS) btn(ch, 'char-' + c, c, () => eng.setCharacter(c));
  const sc = section('Scene');
  for (const s of SCENES) btn(sc, 'scene-' + s, s, () => eng.setScene(s));

  const sl = section('Controls');
  slider(sl, 'intensity', 'intensity', 0, 1, 0, (v) => eng.setIntensity(v));
  let speed = 0, turn = 0;
  slider(sl, 'speed', 'slither speed', 0, 12, 0, (v) => { speed = v; eng.setSlither(speed, turn); });
  slider(sl, 'turn', 'turn rate', 0, 8, 0, (v) => { turn = v; eng.setSlither(speed, turn); });
  slider(sl, 'vmaster', 'master', 0, 1, 1, (v) => { vols.master = v; applyVol(); });
  slider(sl, 'vmusic', 'music', 0, 1, 0.7, (v) => { vols.music = v; applyVol(); });
  slider(sl, 'vsfx', 'sfx', 0, 1, 0.9, (v) => { vols.sfx = v; applyVol(); });

  let combo = 1;
  const ev = section('Game events');
  const fire = (e: GameEvent) => eng.handleEvents([e]);
  btn(ev, 'ev-start', 'start', () => fire({ type: 'start' }));
  btn(ev, 'ev-eat', 'eat (combo climbs)', () => { fire({ type: 'eat', x: 0, y: 0, kind: 'normal', combo, points: 10 * combo, length: 5 }); combo = combo >= 8 ? 1 : combo + 1; });
  btn(ev, 'ev-eatgold', 'eat golden', () => fire({ type: 'eat', x: 0, y: 0, kind: 'golden', combo, points: 50, length: 5 }));
  btn(ev, 'ev-spawn', 'spawnFood', () => fire({ type: 'spawnFood', x: 0, y: 0, kind: 'normal' }));
  btn(ev, 'ev-spawngold', 'spawnFood golden', () => fire({ type: 'spawnFood', x: 0, y: 0, kind: 'golden' }));
  btn(ev, 'ev-expired', 'foodExpired', () => fire({ type: 'foodExpired', x: 0, y: 0 }));
  btn(ev, 'ev-puspawn', 'powerupSpawn', () => fire({ type: 'powerupSpawn', x: 0, y: 0, kind: 'slow' }));
  for (const k of PU) btn(ev, 'ev-pu-' + k, 'powerup ' + k, () => fire({ type: 'powerup', x: 0, y: 0, kind: k }));
  btn(ev, 'ev-puend', 'powerupEnd', () => fire({ type: 'powerupEnd', kind: 'ghost' }));
  btn(ev, 'ev-turn', 'turn', () => fire({ type: 'turn', x: 0, y: 0 }));
  btn(ev, 'ev-near', 'nearMiss', () => fire({ type: 'nearMiss', x: 0, y: 0, points: 5 }));
  btn(ev, 'ev-combo', 'combo', () => fire({ type: 'combo', combo: 3 }));
  btn(ev, 'ev-break', 'comboBreak', () => { combo = 1; fire({ type: 'comboBreak', combo: 4 }); });
  btn(ev, 'ev-mile', 'milestone', () => fire({ type: 'milestone', length: 10, points: 100 }));
  btn(ev, 'ev-wrap', 'wrap', () => fire({ type: 'wrap', x: 0, y: 0 }));
  btn(ev, 'ev-hit', 'hit', () => fire({ type: 'hit', x: 0, y: 0, cause: 'wall' }));
  btn(ev, 'ev-death', 'death', () => fire({ type: 'death', x: 0, y: 0, cause: 'self' }));
  let sec = 10;
  btn(ev, 'ev-warn', 'timeWarning (counts down)', () => { fire({ type: 'timeWarning', secondsLeft: sec }); sec = sec <= 1 ? 10 : sec - 1; });
  btn(ev, 'ev-timeup', 'timeUp', () => fire({ type: 'timeUp' }));

  const ui = section('UI sounds');
  for (const u of UIS) btn(ui, 'ui-' + u, u, () => eng.ui(u));

  const stat = document.createElement('pre');
  stat.id = 'stats';
  root.appendChild(stat);
  setInterval(() => {
    const c = eng.audioCore;
    stat.textContent = c ? JSON.stringify({ state: eng.context?.state, ...c.stats() }) : 'locked (click Unlock)';
  }, 250);
}

/** QA: log-frequency spectrograms + RMS envelopes of .qa/audio-<name>.wav files. */
async function spectro(root: HTMLElement, names: string[]) {
  root.style.padding = '6px';
  const W = 1180, H = 150;
  for (const name of names) {
    const label = document.createElement('div');
    label.textContent = name;
    label.style.cssText = 'font:12px monospace;color:#fc6;margin-top:4px';
    root.appendChild(label);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H + 30;
    root.appendChild(cv);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H + 30);
    try {
      const ab = await (await fetch(`/.qa/audio-${name}.wav`)).arrayBuffer();
      const oc = new OfflineAudioContext(1, 1, 44100);
      const buf = await oc.decodeAudioData(ab);
      const a = buf.getChannelData(0), b = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
      const sr = buf.sampleRate, N = 2048, n = a.length;
      const img = g.createImageData(W, H);
      const re = new Float64Array(N), im = new Float64Array(N);
      const fLo = 40, fHi = 16000;
      for (let x = 0; x < W; x++) {
        const s0 = Math.floor((x / W) * (n - N));
        for (let i = 0; i < N; i++) { re[i] = (a[s0 + i] + b[s0 + i]) * 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
        fft(re, im);
        for (let y = 0; y < H; y++) {
          const f = fLo * Math.pow(fHi / fLo, 1 - y / H);
          const k = Math.min(N / 2 - 1, Math.round((f * N) / sr));
          const m = Math.hypot(re[k], im[k]);
          const db = 20 * Math.log10(m + 1e-9);
          const v = Math.max(0, Math.min(1, (db + 40) / 70));
          const o = (y * W + x) * 4;
          img.data[o] = 255 * Math.min(1, v * 2); img.data[o + 1] = 255 * Math.max(0, v * 2 - 1); img.data[o + 2] = 255 * Math.max(0, 0.6 - v) * v * 3; img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = '#8cf';
      for (let x = 0; x < W; x++) {
        const s0 = Math.floor((x / W) * n), s1 = Math.floor(((x + 1) / W) * n);
        let e = 0; for (let i = s0; i < s1; i++) e += a[i] * a[i];
        const db = 10 * Math.log10(e / Math.max(1, s1 - s0) + 1e-12);
        const h = Math.max(0, (db + 60) / 60) * 28;
        g.fillRect(x, H + 30 - h, 1, h);
      }
      g.fillStyle = '#fff'; g.font = '10px monospace';
      for (let sec = 0; sec < buf.duration; sec++) g.fillRect(Math.round((sec / buf.duration) * W), H, 1, 4);
      for (const f of [100, 1000, 10000]) g.fillText(f + 'Hz', 2, H * (1 - Math.log(f / fLo) / Math.log(fHi / fLo)));
    } catch (e) { label.textContent += ' ERROR ' + String(e); }
  }
  (window as unknown as Record<string, unknown>).__spectroDone = true;
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const br = re[q] * cr - im[q] * ci, bi2 = re[q] * ci + im[q] * cr;
        re[q] = re[p] - br; im[q] = im[p] - bi2; re[p] += br; im[p] += bi2;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
