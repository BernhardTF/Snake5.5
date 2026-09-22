// In-game HUD. updateHud() runs ~60×/s, so every DOM write is guarded by a change check.
import { h, icon, fmtInt, fmtClock } from './dom';
import { ICONS, type IconName } from './icons';
import type { HudState } from '../types';

type EffectKind = 'slow' | 'ghost' | 'magnet' | 'double';
const EFFECTS: { kind: EffectKind; label: string; icon: IconName; dur: number }[] = [
  { kind: 'slow', label: 'Slow', icon: 'slow', dur: 6 },
  { kind: 'ghost', label: 'Ghost', icon: 'ghost', dur: 6 },
  { kind: 'magnet', label: 'Magnet', icon: 'magnet', dur: 8 },
  { kind: 'double', label: 'Double', icon: 'double', dur: 10 },
];

const RING_R = 21;
const RING_C = 2 * Math.PI * RING_R;

interface Pill {
  el: HTMLElement;
  secs: HTMLElement;
  fill: HTMLElement;
  max: number;
  shownSecs: number;
  shownFrac: number;
  on: boolean;
  low: boolean;
}

export class Hud {
  readonly el: HTMLElement;
  readonly pauseBtn: HTMLButtonElement;
  private scoreEl: HTMLElement;
  private labelEl: HTMLElement;
  private bestEl: HTMLElement;
  private lenEl: HTMLElement;
  private comboEl: HTMLElement;
  private comboArc: SVGCircleElement;
  private comboText: HTMLElement;
  private timerEl: HTMLElement;
  private timerText: HTMLElement;
  private pills = new Map<EffectKind, Pill>();

  // diff state
  private target = 0;
  private shown = -1;
  private shownF = 0;
  private lastT = 0;
  private best = -1;
  private len = -1;
  private combo = -1;
  private comboT = -1;
  private comboVisible = false;
  private timeText = '';
  private timeLow = false;
  private timerOn = false;
  private mode = '';
  private patternPct = -1;

  constructor(private opts: { onPause: () => void; reducedMotion: () => boolean }) {
    this.scoreEl = h('div', { class: 'hud-score' }, '0');
    this.labelEl = h('div', { class: 'hud-label' }, 'Score');
    this.bestEl = h('span', { class: 'hud-best' });
    this.lenEl = h('span', { class: 'hud-len' });
    this.comboArc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 50 50');
    svg.setAttribute('class', 'combo-svg');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [track, this.comboArc]) {
      c.setAttribute('cx', '25');
      c.setAttribute('cy', '25');
      c.setAttribute('r', String(RING_R));
    }
    track.setAttribute('class', 'combo-track');
    this.comboArc.setAttribute('class', 'combo-arc');
    this.comboArc.style.strokeDasharray = `${RING_C}`;
    svg.append(track, this.comboArc);
    this.comboText = h('span', { class: 'combo-x' }, '×1');
    this.comboEl = h('div', { class: 'hud-combo', 'aria-label': 'Combo' }, svg, this.comboText);

    this.timerText = h('span', null, '2:00');
    this.timerEl = h('div', { class: 'hud-timer', hidden: true }, icon(ICONS.clock), this.timerText);

    const effects = h('div', { class: 'hud-effects' });
    for (const e of EFFECTS) {
      const secs = h('span', { class: 'pill-secs' });
      const fill = h('span', { class: 'pill-fill' });
      const el = h('div', { class: `pill pill-${e.kind}`, hidden: true }, icon(ICONS[e.icon]), h('span', { class: 'pill-label' }, e.label), secs, h('span', { class: 'pill-bar' }, fill));
      effects.appendChild(el);
      this.pills.set(e.kind, { el, secs, fill, max: e.dur, shownSecs: -1, shownFrac: -1, on: false, low: false });
    }

    this.pauseBtn = h(
      'button',
      { type: 'button', class: 'hud-pause', 'aria-label': 'Pause', title: 'Pause (Esc)', tabindex: '-1', 'data-sfx': 'click' },
      icon(ICONS.pause),
    ) as HTMLButtonElement;
    this.pauseBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus off (Space must not re-trigger)
    this.pauseBtn.addEventListener('click', () => {
      this.pauseBtn.blur();
      this.opts.onPause();
    });

    this.el = h(
      'div',
      { class: 'hud' },
      h(
        'div',
        { class: 'hud-tl' },
        h('div', { class: 'hud-scorebox' }, this.labelEl, this.scoreEl, h('div', { class: 'hud-sub' }, this.bestEl, this.lenEl)),
        this.comboEl,
      ),
      h('div', { class: 'hud-tc' }, this.timerEl),
      h('div', { class: 'hud-tr' }, this.pauseBtn),
      h('div', { class: 'hud-fx' }, effects),
    );
  }

  /** Reset tween + diff state (new run). */
  reset() {
    this.target = 0;
    this.shown = -1;
    this.shownF = 0;
    this.best = -1;
    this.len = -1;
    this.combo = -1;
    this.comboT = -1;
    this.timeText = '';
    this.mode = '';
    this.patternPct = -1;
    for (const p of this.pills.values()) {
      p.on = false;
      p.el.hidden = true;
      p.shownSecs = -1;
      p.shownFrac = -1;
    }
  }

  update(s: HudState) {
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    const rm = this.opts.reducedMotion();

    if (s.mode !== this.mode) {
      this.mode = s.mode;
      this.el.classList.toggle('is-zen', s.mode === 'zen');
      this.el.classList.toggle('is-ta', s.mode === 'timeattack');
      this.labelEl.textContent = s.mode === 'zen' ? 'Raked' : 'Score';
      this.best = -1;
      this.shown = -1;
      this.patternPct = -1;
    }

    // ---- main number
    if (s.mode === 'zen') {
      const pct = Math.floor(s.pattern * 100);
      if (pct !== this.patternPct) {
        this.patternPct = pct;
        this.scoreEl.textContent = `${pct}%`;
      }
    } else {
      if (s.score < this.target || this.shown < 0) this.shownF = s.score; // reset / first frame: snap
      this.target = s.score;
      if (rm) this.shownF = this.target;
      else if (this.shownF < this.target) {
        const gap = this.target - this.shownF;
        this.shownF = Math.min(this.target, this.shownF + Math.max(gap * (1 - Math.exp(-dt * 9)), 30 * dt));
      }
      const v = Math.round(this.shownF);
      if (v !== this.shown) {
        const grew = this.shown >= 0 && v > this.shown;
        this.scoreEl.textContent = fmtInt(v);
        if (grew && !rm && this.shown >= 0 && v === this.target) this.bump(this.scoreEl, 1.07);
        this.shown = v;
      }
      if (s.best !== this.best) {
        this.best = s.best;
        this.bestEl.textContent = `Best ${fmtInt(Math.max(s.best, 0))}`;
      }
    }

    if (s.length !== this.len) {
      this.len = s.length;
      this.lenEl.replaceChildren(icon(ICONS.length), String(s.length));
    }

    // ---- combo ring
    const showCombo = s.mode !== 'zen' && s.comboT > 0 && s.combo >= 1;
    if (showCombo !== this.comboVisible) {
      this.comboVisible = showCombo;
      this.comboEl.classList.toggle('on', showCombo);
    }
    if (s.combo !== this.combo) {
      const rose = this.combo >= 1 && s.combo > this.combo;
      this.combo = s.combo;
      this.comboText.textContent = `×${s.combo}`;
      this.comboEl.dataset.level = String(Math.min(8, s.combo));
      this.comboEl.classList.toggle('max', s.combo >= 8);
      if (rose && !rm) this.bump(this.comboEl, 1.22, 380);
    }
    if (Math.abs(s.comboT - this.comboT) > 0.004 || (s.comboT === 0 && this.comboT !== 0)) {
      this.comboT = s.comboT;
      this.comboArc.style.strokeDashoffset = `${(RING_C * (1 - Math.max(0, Math.min(1, s.comboT)))).toFixed(2)}`;
    }

    // ---- timer
    const tOn = s.timeLeft !== null;
    if (tOn !== this.timerOn) {
      this.timerOn = tOn;
      this.timerEl.hidden = !tOn;
    }
    if (s.timeLeft !== null) {
      const txt = fmtClock(s.timeLeft);
      if (txt !== this.timeText) {
        this.timeText = txt;
        this.timerText.textContent = txt;
        const low = s.timeLeft < 10;
        if (low !== this.timeLow) {
          this.timeLow = low;
          this.timerEl.classList.toggle('low', low);
        }
        if (low && !rm) this.bump(this.timerEl, 1.12, 300);
      }
    }

    // ---- effects
    const fx = s.effects;
    for (const [kind, p] of this.pills) {
      const rem = Math.max(0, fx[kind] ?? 0);
      const on = rem > 0.01;
      if (on !== p.on) {
        p.on = on;
        p.el.hidden = !on;
        if (on) {
          p.max = Math.max(rem, EFFECTS.find((e) => e.kind === kind)!.dur * 0.5);
          if (!rm) p.el.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
        }
      }
      if (!on) continue;
      if (rem > p.max + 0.05) p.max = rem; // refreshed / stacked
      const secs = Math.ceil(rem);
      if (secs !== p.shownSecs) {
        p.shownSecs = secs;
        p.secs.textContent = `${secs}s`;
      }
      const frac = Math.round((rem / p.max) * 200) / 200;
      if (frac !== p.shownFrac) {
        p.shownFrac = frac;
        p.fill.style.transform = `scaleX(${frac})`;
      }
      const low = rem < 2;
      if (low !== p.low) {
        p.low = low;
        p.el.classList.toggle('low', low);
      }
    }
  }

  private bump(el: Element, s: number, dur = 260) {
    el.animate?.([{ transform: 'scale(1)' }, { transform: `scale(${s})` }, { transform: 'scale(1)' }], { duration: dur, easing: 'cubic-bezier(.3,1.4,.5,1)' });
  }
}
