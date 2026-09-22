// Unified gameplay input: keyboard, gamepad, touch (swipe / d-pad / drag / halves) and mouse.
import type { Dir } from '../game/Sim';
import type { MovementMode } from '../types';
import type { Settings } from '../core/storage';
import type { TouchControlDetail } from '../ui/contract';

export interface InputSink {
  dir(d: Dir): void;
  steer(v: number): void;
  target(angle: number | null): void;
  /** Glide mouse steering: pointer position in css px. */
  pointer(px: number, py: number): void;
  pause(): void;
}

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3,
};

export class Input {
  enabled = false;
  movement: MovementMode = 'grid';
  private keysDown = new Set<string>();
  private halves = { left: false, right: false };
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private padPrev: boolean[] = [];
  private padStickDir: Dir | null = null;
  private padActive = false;
  private padSteering = false;
  /** Set true when the last gameplay input came from touch (UI hints etc). */
  lastWasTouch = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private sink: InputSink,
    private settings: () => Settings,
    private blocked: () => boolean,
  ) {
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', () => {
      this.keysDown.clear();
      this.halves.left = this.halves.right = false;
      if (this.movement === 'glide') this.sink.steer(0);
    });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    addEventListener('pointermove', this.onPointerMove, { passive: false });
    addEventListener('pointerup', this.onPointerUp);
    addEventListener('pointercancel', this.onPointerUp);
    addEventListener('ss-touch', this.onTouchControl as EventListener);
    canvas.style.touchAction = 'none';
  }

  reset() {
    this.keysDown.clear();
    this.halves.left = this.halves.right = false;
    this.pointerId = null;
    this.padStickDir = null;
    this.sink.steer(0);
    this.sink.target(null);
  }

  private active() {
    return this.enabled && !this.blocked();
  }

  // ------------------------------------------------------------ keyboard
  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.active()) return;
    const d = KEY_DIR[e.code];
    if (d === undefined) return;
    e.preventDefault();
    this.lastWasTouch = false;
    if (this.movement === 'grid') {
      if (!e.repeat) this.sink.dir(d);
    } else {
      this.keysDown.add(e.code);
      if (d === 0 || d === 2) {
        // up/down in glide: absolute heading
        if (!e.repeat) this.sink.dir(d);
      } else this.updateKeySteer();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
    if (this.movement === 'glide') this.updateKeySteer();
  };

  private updateKeySteer() {
    const l = this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA');
    const r = this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD');
    const v = (r ? 1 : 0) - (l ? 1 : 0) + (this.halves.right ? 1 : 0) - (this.halves.left ? 1 : 0);
    this.sink.steer(Math.max(-1, Math.min(1, v)));
  }

  // ------------------------------------------------------------ touch / mouse
  private onPointerDown = (e: PointerEvent) => {
    if (!this.active()) return;
    const touch = e.pointerType !== 'mouse';
    this.lastWasTouch = touch;
    if (!touch) {
      if (this.movement === 'glide' && this.settings().mouseSteer) this.sink.pointer(e.clientX, e.clientY);
      return;
    }
    const s = this.settings();
    if (this.movement === 'grid' && s.gridTouch === 'dpad') return;
    if (this.movement === 'glide' && s.glideTouch === 'halves') return;
    this.pointerId = e.pointerId;
    this.ox = e.clientX;
    this.oy = e.clientY;
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.active()) return;
    if (e.pointerType === 'mouse') {
      if (this.movement === 'glide' && this.settings().mouseSteer) this.sink.pointer(e.clientX, e.clientY);
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - this.ox, dy = e.clientY - this.oy;
    const dist = Math.hypot(dx, dy);
    const s = this.settings();
    if (this.movement === 'grid') {
      const threshold = 22 / s.swipeSensitivity;
      if (dist < threshold) return;
      const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      this.sink.dir(d);
      // chain swipes without lifting the finger
      this.ox = e.clientX;
      this.oy = e.clientY;
    } else {
      const dead = 10 / s.swipeSensitivity;
      if (dist < dead) return;
      this.sink.target(Math.atan2(-dy, dx));
      // floating anchor: follow the finger once it strays far
      const maxR = 70;
      if (dist > maxR) {
        this.ox = e.clientX - (dx / dist) * maxR;
        this.oy = e.clientY - (dy / dist) * maxR;
      }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };

  private onTouchControl = (e: CustomEvent<TouchControlDetail>) => {
    if (!this.active()) return;
    this.lastWasTouch = true;
    const d = e.detail;
    if (d.kind === 'dir') {
      const map = { up: 0, right: 1, down: 2, left: 3 } as const;
      this.sink.dir(map[d.dir]);
    } else {
      this.halves[d.side] = d.down;
      if (this.movement === 'glide') this.updateKeySteer();
    }
  };

  // ------------------------------------------------------------ gamepad (poll every frame)
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return;
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.padPrev[i];
    // Start (pause/resume) is handled by the UI's gamepad navigation.
    if (this.active()) {
      // D-pad: 12 up, 13 down, 14 left, 15 right
      const dp: [number, Dir][] = [[12, 0], [15, 1], [13, 2], [14, 3]];
      for (const [b, d] of dp) if (edge(b)) { this.sink.dir(d); this.lastWasTouch = false; }
      const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
      const mag = Math.hypot(x, y);
      if (this.movement === 'grid') {
        if (mag > 0.6) {
          const d: Dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 1 : 3) : y > 0 ? 2 : 0;
          if (d !== this.padStickDir) this.sink.dir(d);
          this.padStickDir = d;
        } else if (mag < 0.3) this.padStickDir = null;
      } else {
        if (mag > 0.35) {
          this.sink.target(Math.atan2(-y, x));
          this.padActive = true;
        } else if (this.padActive) {
          this.padActive = false;
        }
        // shoulder buttons / triggers steer
        const lt = (pad.buttons[4]?.pressed ? 1 : 0) + (pad.buttons[6]?.value ?? 0);
        const rt = (pad.buttons[5]?.pressed ? 1 : 0) + (pad.buttons[7]?.value ?? 0);
        if (lt > 0.1 || rt > 0.1) {
          this.sink.steer(Math.max(-1, Math.min(1, rt - lt)));
          this.padSteering = true;
        } else if (this.padSteering) {
          this.padSteering = false;
          this.sink.steer(0);
        }
      }
    }
    this.padPrev = pressed;
  }
}

export function haptic(settings: Settings, pattern: number | number[]) {
  if (!settings.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
