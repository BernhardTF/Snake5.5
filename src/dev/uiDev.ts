// UI dev harness: ?dev=ui&screen=title|setup|skins|achievements|records|settings|credits|hud|pause|over
// Extra params:
//   biome=<id>        stand-in background tint (default karesansui — the brightest, worst case for contrast)
//   gesture=1         skip the "press any key" attract state on the title
//   profile=empty     start from a blank profile (default: a mid-game profile with some records)
//   mode=timeattack|zen|arcade   HUD mode        touch=dpad|halves   fps=1   rm=1 (reduced motion)  large=1
//   newbest=0 levelup=0          game-over variations
//   blur=0            disable backdrop blur (headless screenshots)
import { UI } from '../ui/UI';
import type { UIHost, ScreenId, StartRequest } from '../ui/contract';
import { store, bestKey, todayKey } from '../core/storage';
import { xpForLevel } from '../game/progression';
import type { BiomeId, GameModeId, HudState, RunResult } from '../types';

const PALETTES: Record<BiomeId, { top: string; mid: string; bot: string; line: string; snake: string }> = {
  karesansui: { top: '#efe9dc', mid: '#e2d9c6', bot: '#cfc3aa', line: 'rgba(120,100,70,0.18)', snake: '#1e1b18' },
  erg: { top: '#f2b872', mid: '#e0914a', bot: '#b86a2e', line: 'rgba(110,50,10,0.22)', snake: '#2a1a10' },
  lagoon: { top: '#f6b79a', mid: '#b98a86', bot: '#5f6f8f', line: 'rgba(40,30,60,0.2)', snake: '#1a1416' },
  svartsandur: { top: '#2a3240', mid: '#1a1d22', bot: '#111214', line: 'rgba(255,255,255,0.06)', snake: '#0a0a0a' },
  salar: { top: '#f3f8ff', mid: '#dbe8f5', bot: '#b5cbe2', line: 'rgba(60,90,130,0.16)', snake: '#1e1c1a' },
};

function paintBackground(canvas: HTMLCanvasElement, biome: BiomeId, t = 0) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = innerWidth;
  const h = innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const p = PALETTES[biome] ?? PALETTES.karesansui;
  const grad = g.createLinearGradient(0, 0, w * 0.3, h);
  grad.addColorStop(0, p.top);
  grad.addColorStop(0.55, p.mid);
  grad.addColorStop(1, p.bot);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // raked lines
  g.strokeStyle = p.line;
  g.lineWidth = 1.2;
  for (let y = 4; y < h; y += 9) {
    g.beginPath();
    for (let x = 0; x <= w; x += 24) {
      const yy = y + Math.sin(x * 0.004 + y * 0.01) * 2.5;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  // stones with ripple rings
  const stones = [
    [0.18, 0.7, 26],
    [0.8, 0.28, 34],
    [0.66, 0.78, 20],
  ];
  for (const [sx, sy, r] of stones) {
    const cx = sx * w;
    const cy = sy * h;
    for (let k = 1; k <= 4; k++) {
      g.beginPath();
      g.ellipse(cx, cy, r + k * 10, (r + k * 10) * 0.85, 0, 0, Math.PI * 2);
      g.strokeStyle = p.line;
      g.stroke();
    }
    g.beginPath();
    g.ellipse(cx + 5, cy + 7, r, r * 0.8, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy, r, r * 0.8, 0, 0, Math.PI * 2);
    g.fillStyle = biome === 'svartsandur' ? '#2b2f36' : '#6d6a5e';
    g.fill();
  }
  // snake: a curvy stroke through the centre with shadow and gold thread
  const pts: [number, number][] = [];
  for (let i = 0; i <= 80; i++) {
    const u = i / 80;
    const x = w * (0.15 + 0.7 * u);
    const y = h * (0.52 + 0.12 * Math.sin(u * Math.PI * 2.4 + t) + 0.03 * Math.sin(u * 13 + t * 2));
    pts.push([x, y]);
  }
  const width = Math.max(14, Math.min(w, h) * 0.028);
  const stroke = (color: string, lw: number, dx = 0, dy = 0) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
  };
  stroke('rgba(0,0,0,0.22)', width * 1.1, 6, 9);
  stroke(p.snake, width);
  stroke('rgba(217,180,74,0.9)', width * 0.14);
  const [hx, hy] = pts[pts.length - 1];
  g.beginPath();
  g.ellipse(hx + 6, hy, width * 0.75, width * 0.6, 0, 0, Math.PI * 2);
  g.fillStyle = p.snake;
  g.fill();
  // vignette
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(30,20,10,0.28)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

function seedProfile() {
  const p = store.profile;
  p.xp = xpForLevel(3) + 60; // level 3
  p.bests = {
    [bestKey('classic', 'karesansui', 'grid')]: 1840,
    [bestKey('classic', 'karesansui', 'glide')]: 960,
    [bestKey('arcade', 'karesansui', 'grid')]: 3215,
    [bestKey('zen', 'karesansui', 'grid')]: 42,
    [bestKey('timeattack', 'karesansui', 'grid')]: 1290,
    [bestKey('classic', 'erg', 'grid')]: 1120,
    [bestKey('arcade', 'lagoon', 'glide')]: 2480,
  };
  p.daily = { [todayKey()]: 2210, '2026-09-20': 1780, '2026-09-18': 2560 };
  const now = Date.now();
  p.achievements = { first: now - 86400e3 * 6, len25: now - 86400e3 * 4, combo4: now - 86400e3 * 3, score500: now - 86400e3 * 3, grid: now - 86400e3 * 2, daily: now - 86400e3, near10: now - 3600e3 };
  p.stats = {
    runs: 17,
    foodEaten: 312,
    goldenEaten: 14,
    totalLength: 486,
    playTime: 4020,
    nearMisses: 128,
    deathsWall: 6,
    deathsSelf: 7,
    deathsObstacle: 3,
    bestLength: 38,
    bestCombo: 6,
    zenTime: 540,
    biomesPlayed: ['karesansui', 'erg', 'lagoon'],
  };
}

export function runUiDev(params: URLSearchParams) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const root = document.getElementById('ui') as HTMLElement;
  let biome = (params.get('biome') as BiomeId) || store.settings.lastBiome || 'karesansui';
  if (params.get('biome')) store.settings.lastBiome = biome;
  if (params.get('profile') !== 'empty') seedProfile();
  if (params.get('rm') === '1') store.settings.reducedMotion = true;
  if (params.get('large') === '1') store.settings.largeHud = true;
  const repaint = () => paintBackground(canvas, biome);
  repaint();
  addEventListener('resize', repaint);

  const log: string[] = [];
  const hudMode = (params.get('mode') as GameModeId) || 'arcade';
  let ui: UI;
  let feed: ((on: boolean) => void) | null = null;
  const note = (name: string, ...args: unknown[]) => {
    const line = `${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`;
    log.push(line);
    console.log('[host]', line);
  };
  const host: UIHost = {
    startGame(req: StartRequest) {
      note('startGame', req);
      ui.show('hud');
      feed?.(true);
      void ui.countdown().then(() => note('countdown:done'));
    },
    pause() {
      note('pause');
      ui.show('pause');
    },
    resume() {
      note('resume');
      ui.show('hud');
    },
    restart() {
      note('restart');
      ui.show('hud');
      void ui.countdown();
    },
    quitToMenu() {
      note('quitToMenu');
      ui.show('title');
    },
    settingsChanged(s) {
      note('settingsChanged', { quality: s.quality, reducedMotion: s.reducedMotion, largeHud: s.largeHud });
      ui.setFps(s.showFps ? 60 : null);
    },
    previewBiome(id) {
      note('previewBiome', id);
      biome = id;
      repaint();
    },
    previewSkin(id) {
      note('previewSkin', id);
    },
    sound(s) {
      if (s !== 'hover') note('sound', s);
    },
    savePicture() {
      note('savePicture');
    },
    userGesture() {
      note('userGesture');
    },
  };
  ui = new UI(root, host);
  // headless SwiftShader stalls compositor frames with backdrop-filter; blur=0 for reliable QA shots
  if (params.get('blur') === '0') root.classList.add('no-blur');
  (window as any).__ui = ui;
  (window as any).__uiLog = log;

  const screen = (params.get('screen') as ScreenId) || 'title';
  if (params.get('gesture') === '1') {
    // simulate that the player already interacted this session
    (ui as any).gestureDone = true;
  }
  if (params.get('fps') === '1') ui.setFps(58);

  // ------------------------------------------------------------ HUD feed
  const hs: HudState = {
    score: 0,
    best: 1840,
    combo: 1,
    comboT: 0,
    length: 5,
    effects: { timeScale: 1, ghost: 0, magnet: 0, double: 0, slow: 0 },
    timeLeft: hudMode === 'timeattack' ? 74 : null,
    mode: hudMode,
    pattern: 0.12,
  };
  let raf = 0;
  let running = false;
  let t0 = performance.now();
  let lastEat = 0;
  let prev = 0;
  const step = (now: number) => {
    if (!running) return;
    const t = (now - t0) / 1000;
    const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 1 / 60;
    prev = now;
    if (ui.current === 'hud') {
      if (t - lastEat > 0.9) {
        lastEat = t;
        hs.combo = Math.min(8, hs.combo + 1);
        const pts = 10 * hs.combo;
        hs.score += pts;
        hs.length += 1;
        hs.comboT = 1;
        hs.pattern = Math.min(1, hs.pattern + 0.013);
        ui.popup(`+${pts}`, innerWidth * (0.3 + 0.4 * Math.random()), innerHeight * (0.4 + 0.25 * Math.random()), 'score');
        if (hs.combo >= 3) ui.popup(`×${hs.combo}`, innerWidth * 0.62, innerHeight * 0.38, 'combo');
      }
      hs.comboT = Math.max(0, hs.comboT - dt / 1.2);
      if (hs.timeLeft !== null) hs.timeLeft = Math.max(0, hs.timeLeft - dt);
      hs.effects.double = Math.max(0, hs.effects.double - dt);
      hs.effects.ghost = Math.max(0, hs.effects.ghost - dt);
      hs.effects.slow = Math.max(0, hs.effects.slow - dt);
      ui.updateHud(hs);
    }
    raf = requestAnimationFrame(step);
  };
  feed = (on: boolean) => {
    if (on && !running) {
      running = true;
      t0 = performance.now();
      lastEat = 0;
      hs.score = 0;
      hs.combo = 1;
      hs.length = 5;
      hs.effects.double = 10;
      hs.effects.ghost = 4.2;
      hs.effects.slow = 1.6;
      raf = requestAnimationFrame(step);
    } else if (!on) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  // ------------------------------------------------------------ fake result
  const levelUp = params.get('levelup') !== '0';
  const newBest = params.get('newbest') !== '0';
  const result: RunResult = {
    config: { mode: hudMode === 'zen' ? 'zen' : 'classic', movement: 'grid', biome, skin: 'obsidian', seed: 1, boardW: 28, boardH: 18 },
    stats: { score: 2370, length: 41, maxCombo: 7, nearMisses: 12, foodEaten: 36, goldenEaten: 2, powerups: 3, ghostPasses: 0, time: 187.4, pattern: 0.34, cause: 'obstacle' },
    best: newBest ? 2370 : 3215,
    newBest,
    xpGained: 247,
    levelBefore: levelUp ? 3 : 4,
    levelAfter: 4,
    xpIntoLevel: 60,
    xpForLevel: xpForLevel(5) - xpForLevel(4),
    unlocks: levelUp ? ['Snake unlocked: Coral'] : [],
    achievements: ['near10', 'score2000'],
  };

  // ------------------------------------------------------------ show
  if (screen === 'hud' || screen === 'pause') {
    ui.show('hud');
    const touch = params.get('touch');
    if (touch === 'dpad' || touch === 'halves') ui.setTouchControls(touch);
    feed(true);
    if (params.get('countdown') === '1') void ui.countdown();
    setTimeout(() => ui.toast('Rhythm', 'Reach a ×4 combo.', '✦'), 900);
    setTimeout(() => {
      ui.popup('NEAR MISS +5', innerWidth * 0.45, innerHeight * 0.6, 'near');
      ui.popup('LENGTH 10 · +100', innerWidth * 0.5, innerHeight * 0.3, 'bonus');
      ui.popup('−10 s', innerWidth * 0.5, innerHeight * 0.7, 'warn');
    }, 1150);
    if (screen === 'pause') setTimeout(() => ui.show('pause'), 400);
  } else if (screen === 'over') {
    ui.showResult(result);
  } else {
    ui.show(screen);
  }
}
