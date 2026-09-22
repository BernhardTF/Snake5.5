// Floating popups, toasts, countdown, touch controls and the fps counter.
import { h, icon, clamp } from './dom';
import { ICONS } from './icons';
import type { TouchControlDetail } from './contract';

type PopKind = 'score' | 'combo' | 'near' | 'bonus' | 'warn';

export class Popups {
  readonly el = h('div', { class: 'popups', 'aria-hidden': 'true' });
  private pool: { el: HTMLElement; anim: Animation | null }[] = [];
  private next = 0;

  constructor(private reducedMotion: () => boolean, size = 28) {
    for (let i = 0; i < size; i++) {
      const el = h('div', { class: 'pop' });
      el.style.opacity = '0';
      this.el.appendChild(el);
      this.pool.push({ el, anim: null });
    }
  }

  show(text: string, px: number, py: number, kind: PopKind) {
    const slot = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    slot.anim?.cancel();
    const { el } = slot;
    el.className = `pop pop-${kind}`;
    el.textContent = text;
    const x = clamp(px, 48, innerWidth - 48);
    const y = clamp(py, 64, innerHeight - 32);
    const base = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    const big = kind === 'combo' || kind === 'bonus';
    const dur = big ? 1150 : kind === 'warn' ? 1300 : 900;
    const rise = big ? 56 : 42;
    const frames: Keyframe[] = this.reducedMotion()
      ? [
          { opacity: 0, transform: base },
          { opacity: 1, transform: base, offset: 0.12 },
          { opacity: 1, transform: base, offset: 0.7 },
          { opacity: 0, transform: base },
        ]
      : [
          { opacity: 0, transform: `${base} translateY(8px) scale(${big ? 0.6 : 0.85})` },
          { opacity: 1, transform: `${base} translateY(-4px) scale(${big ? 1.12 : 1.04})`, offset: 0.16 },
          { opacity: 1, transform: `${base} translateY(${-rise * 0.55}px) scale(1)`, offset: 0.62 },
          { opacity: 0, transform: `${base} translateY(${-rise}px) scale(.96)` },
        ];
    slot.anim = el.animate(frames, { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  }
}

export class Toasts {
  readonly el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

  constructor(private reducedMotion: () => boolean) {}

  show(title: string, subtitle?: string, ic?: string) {
    const glyph = ic && ic in ICONS ? icon(ICONS[ic as keyof typeof ICONS]) : h('span', { class: 'toast-glyph' }, ic || '');
    const medal = h('span', { class: 'toast-medal' }, ic ? glyph : icon(ICONS.star));
    const t = h('div', { class: 'toast' }, medal, h('div', { class: 'toast-body' }, h('div', { class: 'toast-title' }, title), subtitle ? h('div', { class: 'toast-sub' }, subtitle) : null));
    this.el.appendChild(t);
    while (this.el.children.length > 3) this.el.firstElementChild!.remove();
    const rm = this.reducedMotion();
    t.animate(
      rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(-14px) scale(.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(.2,.8,.3,1)' },
    );
    if (!rm) medal.animate([{ transform: 'scale(.6) rotate(-20deg)' }, { transform: 'scale(1.15) rotate(6deg)', offset: 0.6 }, { transform: 'none' }], { duration: 560, delay: 120, easing: 'ease-out', fill: 'backwards' });
    window.setTimeout(() => {
      if (!t.isConnected) return;
      const a = t.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: rm ? 'none' : 'translateY(-10px)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => t.remove();
    }, 3500);
  }
}

export class Countdown {
  readonly el = h('div', { class: 'countdown', 'aria-live': 'assertive' });
  private token = 0;

  constructor(private sound: (s: 'countdown' | 'go') => void, private reducedMotion: () => boolean) {}

  run(): Promise<void> {
    const my = ++this.token;
    const steps = ['3', '2', '1', 'GO'];
    const STEP = 600;
    this.el.hidden = false;
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        if (my !== this.token) return resolve();
        if (i >= steps.length) {
          this.el.hidden = true;
          this.el.replaceChildren();
          return resolve();
        }
        const txt = steps[i];
        const go = txt === 'GO';
        this.sound(go ? 'go' : 'countdown');
        const n = h('div', { class: `cd-num${go ? ' cd-go' : ''}` }, go ? 'Go' : txt);
        const ring = h('div', { class: 'cd-ring' });
        this.el.replaceChildren(ring, n);
        const rm = this.reducedMotion();
        n.animate(
          rm
            ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }]
            : [
                { opacity: 0, transform: 'scale(1.5)', filter: 'blur(6px)' },
                { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', offset: 0.22 },
                { opacity: 1, transform: 'scale(.96)', offset: 0.72 },
                { opacity: 0, transform: go ? 'scale(1.35)' : 'scale(.8)' },
              ],
          { duration: STEP, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
        );
        if (!rm) ring.animate([{ opacity: 0.7, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: STEP, easing: 'ease-out', fill: 'forwards' });
        i++;
        window.setTimeout(tick, STEP);
      };
      tick();
    });
  }

  cancel() {
    this.token++;
    this.el.hidden = true;
    this.el.replaceChildren();
  }
}

const emit = (detail: TouchControlDetail) => window.dispatchEvent(new CustomEvent<TouchControlDetail>('ss-touch', { detail }));

export class TouchControls {
  readonly el = h('div', { class: 'touch-layer' });
  private kind: 'dpad' | 'halves' | null = null;

  set(kind: 'dpad' | 'halves' | null) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.el.replaceChildren();
    this.el.dataset.kind = kind ?? '';
    if (kind === 'dpad') this.el.appendChild(this.buildDpad());
    else if (kind === 'halves') this.el.append(...this.buildHalves());
  }

  private buildDpad() {
    const pad = h('div', { class: 'dpad', 'aria-label': 'Direction pad' });
    const dirs: ('up' | 'left' | 'right' | 'down')[] = ['up', 'left', 'right', 'down'];
    for (const d of dirs) {
      const b = h('div', { class: `dpad-btn dpad-${d}`, role: 'button', 'aria-label': d }, icon(ICONS.next));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        emit({ kind: 'dir', dir: d });
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      pad.appendChild(b);
    }
    pad.appendChild(h('div', { class: 'dpad-hub' }));
    return pad;
  }

  private buildHalves() {
    const out: HTMLElement[] = [];
    for (const side of ['left', 'right'] as const) {
      const zone = h('div', { class: `half half-${side}` }, h('span', { class: 'half-hint' }, icon(side === 'left' ? ICONS.prev : ICONS.next)));
      const pointers = new Set<number>();
      zone.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          zone.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const first = pointers.size === 0;
        pointers.add(e.pointerId);
        zone.classList.add('down');
        if (first) emit({ kind: 'half', side, down: true });
      });
      const end = (e: PointerEvent) => {
        if (!pointers.delete(e.pointerId)) return;
        if (pointers.size === 0) {
          zone.classList.remove('down');
          emit({ kind: 'half', side, down: false });
        }
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
      zone.addEventListener('lostpointercapture', end);
      out.push(zone);
    }
    return out;
  }
}

export class FpsMeter {
  readonly el = h('div', { class: 'fps', hidden: true });
  private last = -1;
  set(fps: number | null) {
    if (fps === null) {
      if (!this.el.hidden) this.el.hidden = true;
      this.last = -1;
      return;
    }
    if (this.el.hidden) this.el.hidden = false;
    const v = Math.round(fps);
    if (v !== this.last) {
      this.last = v;
      this.el.textContent = `${v} fps`;
      this.el.classList.toggle('warn', v < 45);
    }
  }
}
