// Spatial focus navigation (keyboard arrows / gamepad) and gamepad polling.

export type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
    if (el.closest('[inert], [data-nonav]')) return;
    if (el.matches('[tabindex="-1"]')) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') return;
    out.push(el);
  });
  return out;
}

/** Pick the best element in direction `dir` from `from` (spatial navigation). */
export function spatialNext(root: HTMLElement, from: HTMLElement | null, dir: Dir): HTMLElement | null {
  const els = focusables(root).filter((e) => e !== from);
  if (!els.length) return null;
  if (!from || !root.contains(from)) return els[0];
  const a = from.getBoundingClientRect();
  const acx = a.left + a.width / 2;
  const acy = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of els) {
    const b = el.getBoundingClientRect();
    const bcx = b.left + b.width / 2;
    const bcy = b.top + b.height / 2;
    let primary: number;
    let orth: number;
    if (dir === 'right' || dir === 'left') {
      primary = dir === 'right' ? b.left - a.right : a.left - b.right;
      const centerOk = dir === 'right' ? bcx > acx + 1 : bcx < acx - 1;
      if (!centerOk) continue;
      // interval distance on the orthogonal axis (0 when overlapping)
      orth = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      if (orth > 0) orth += Math.abs(bcy - acy) * 0.25;
    } else {
      primary = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
      const centerOk = dir === 'down' ? bcy > acy + 1 : bcy < acy - 1;
      if (!centerOk) continue;
      orth = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      // prefer horizontally aligned centres for vertical moves
      orth += Math.abs(bcx - acx) * 0.15;
    }
    const score = Math.max(0, primary) + orth * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

// ------------------------------------------------------------------ gamepad

export type PadAction = Dir | 'a' | 'b' | 'start' | 'any';

/**
 * Polls gamepads each animation frame. Emits navigation with a repeat delay
 * (first repeat after 380 ms, then every 110 ms). Emits 'any' on the first press of any button.
 */
export class GamepadPoller {
  private prevButtons = new Map<number, boolean[]>();
  private held: { dir: Dir | null; since: number; last: number } = { dir: null, since: 0, last: 0 };
  private raf = 0;
  private running = false;

  constructor(private onAction: (a: PadAction) => void) {}

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.poll();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private poll() {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    if (!pads) return;
    let dir: Dir | null = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const prev = this.prevButtons.get(p.index) ?? [];
      const cur = p.buttons.map((b) => b.pressed || b.value > 0.5);
      const edge = (i: number) => !!cur[i] && !prev[i];
      if (cur.some((v, i) => v && !prev[i])) this.onAction('any');
      if (edge(0)) this.onAction('a');
      if (edge(1)) this.onAction('b');
      if (edge(9)) this.onAction('start');
      if (cur[12]) dir = 'up';
      else if (cur[13]) dir = 'down';
      else if (cur[14]) dir = 'left';
      else if (cur[15]) dir = 'right';
      if (!dir && p.axes.length >= 2) {
        const x = p.axes[0];
        const y = p.axes[1];
        if (Math.hypot(x, y) > 0.55) {
          dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
        }
      }
      this.prevButtons.set(p.index, cur);
    }
    const now = performance.now();
    if (dir !== this.held.dir) {
      this.held = { dir, since: now, last: now };
      if (dir) this.onAction(dir);
    } else if (dir) {
      if (now - this.held.since > 380 && now - this.held.last > 110) {
        this.held.last = now;
        this.onAction(dir);
      }
    }
  }
}
