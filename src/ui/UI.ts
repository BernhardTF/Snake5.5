// Serpent Sands UI: screens, HUD, overlays, keyboard/gamepad navigation.
import './styles.css';
import type { IUI, ScreenId, UIHost } from './contract';
import type { UiSound } from '../audio/contract';
import type { BiomeId, HudState, RunResult } from '../types';
import { store } from '../core/storage';
import { BIOME_BY_ID } from '../biomes/biomes';
import { h, isTouchDevice } from './dom';
import { btn } from './widgets';
import { spatialNext, focusables, GamepadPoller, type Dir, type PadAction } from './nav';
import { Hud } from './hud';
import { Countdown, FpsMeter, Popups, Toasts, TouchControls } from './overlays';
import type { ConfirmOpts, Screen, ScreenCtx } from './ctx';
import { buildTitle } from './screens/title';
import { buildSetup } from './screens/setup';
import { buildSkins } from './screens/skins';
import { buildAchievements } from './screens/achievements';
import { buildRecords } from './screens/records';
import { buildSettings } from './screens/settings';
import { buildCredits } from './screens/credits';
import { buildPause } from './screens/pause';
import { buildOver } from './screens/over';

type MenuId = Exclude<ScreenId, 'hud' | 'none'>;
const BUILDERS: Record<MenuId, (ctx: ScreenCtx) => Screen> = {
  title: buildTitle,
  setup: buildSetup,
  skins: buildSkins,
  achievements: buildAchievements,
  records: buildRecords,
  settings: buildSettings,
  credits: buildCredits,
  pause: buildPause,
  over: buildOver,
};
/** Screens host calls that start a fresh navigation history. */
const ROOTS: ScreenId[] = ['title', 'hud', 'pause', 'over', 'none'];
const isMenu = (s: ScreenId): s is MenuId => s !== 'hud' && s !== 'none';

export class UI implements IUI {
  current: ScreenId = 'none';

  private layerScreens: HTMLElement;
  private hud: Hud;
  private popups: Popups;
  private toasts: Toasts;
  private cd: Countdown;
  private touch: TouchControls;
  private fps: FpsMeter;
  private dialogLayer: HTMLElement;

  private active: { id: MenuId; screen: Screen } | null = null;
  private stack: ScreenId[] = [];
  private result: RunResult | null = null;
  private dialog: { el: HTMLElement; cancel: () => void; restore: Element | null } | null = null;
  private gestureDone = false;
  private gestureFns: (() => void)[] = [];
  private gestureKinds = new Set<string>();
  private revealT = -1e9;
  private suppressClickUntil = 0;
  private lastHover = 0;
  private lastHoverEl: Element | null = null;
  private quietFocus = false;
  private isTouch = isTouchDevice();
  private pad: GamepadPoller;

  constructor(private root: HTMLElement, private host: UIHost) {
    root.classList.add('ss-ui');
    root.replaceChildren();
    const rm = () => store.settings.reducedMotion;

    this.hud = new Hud({ onPause: () => this.host.pause(), reducedMotion: rm });
    this.popups = new Popups(rm);
    this.toasts = new Toasts(rm);
    this.cd = new Countdown((s) => this.host.sound(s), rm);
    this.touch = new TouchControls();
    this.fps = new FpsMeter();
    this.layerScreens = h('div', { class: 'layer-screens' });
    this.dialogLayer = h('div', { class: 'layer-dialog' });

    root.append(
      this.touch.el,
      this.hud.el,
      this.popups.el,
      this.layerScreens,
      this.cd.el,
      this.toasts.el,
      this.dialogLayer,
      this.fps.el,
    );
    this.cd.el.hidden = true;

    this.applyPrefs();
    store.onChange(() => this.applyPrefs());
    this.setAccent(store.settings.lastBiome);
    root.dataset.screen = 'none';
    root.dataset.touch = String(this.isTouch);

    // ---- input
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
    addEventListener('pointerup', () => this.gesture('pointerup'), true);
    root.addEventListener('click', (e) => this.onClick(e), true);
    root.addEventListener('pointerover', (e) => this.onHover(e));
    root.addEventListener('focusin', (e) => this.onFocusIn(e));
    root.addEventListener('contextmenu', (e) => {
      if (!(e.target as Element).closest('input')) e.preventDefault();
    });
    // double-tap zoom / gesture guards (iOS)
    root.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    this.pad = new GamepadPoller((a) => this.onPad(a));
    this.pad.start();
  }

  // =================================================================== IUI

  show(screen: ScreenId): void {
    if (ROOTS.includes(screen)) this.stack = [];
    this.switchTo(screen);
  }

  updateHud(hs: HudState): void {
    this.hud.update(hs);
  }

  popup(text: string, px: number, py: number, kind: 'score' | 'combo' | 'near' | 'bonus' | 'warn'): void {
    this.popups.show(text, px, py, kind);
  }

  showResult(r: RunResult): void {
    this.result = r;
    this.show('over');
  }

  toast(title: string, subtitle?: string, icon?: string): void {
    this.toasts.show(title, subtitle, icon);
  }

  countdown(): Promise<void> {
    return this.cd.run();
  }

  setTouchControls(kind: 'dpad' | 'halves' | null): void {
    this.touch.set(kind);
    this.root.dataset.touchKind = kind ?? '';
  }

  setFps(fps: number | null): void {
    this.fps.set(fps);
  }

  capturesInput(): boolean {
    if (this.dialog) return true;
    if (isMenu(this.current)) return true;
    const a = document.activeElement;
    return !!a && a instanceof HTMLInputElement && this.root.contains(a);
  }

  // =================================================================== screens

  private ctx(): ScreenCtx {
    const self = this;
    return {
      host: this.host,
      go: (s) => this.go(s),
      back: () => this.back(),
      sound: (s) => this.sound(s),
      confirm: (o) => this.confirm(o),
      toast: (t, s, i) => this.toast(t, s, i),
      setAccent: (b) => this.setAccent(b),
      get from() {
        return self.stack.length ? self.stack[self.stack.length - 1] : null;
      },
      get result() {
        return self.result;
      },
      reducedMotion: () => store.settings.reducedMotion,
      touch: this.isTouch,
      awaitingGesture: () => !this.gestureDone,
      onGesture: (fn) => this.gestureFns.push(fn),
    };
  }

  private go(s: ScreenId) {
    if (isMenu(this.current)) this.stack.push(this.current);
    this.switchTo(s);
  }

  private back() {
    this.sound('back');
    const prev = this.stack.pop() ?? 'title';
    this.switchTo(prev);
  }

  private switchTo(id: ScreenId) {
    const prevId = this.current;
    // leave
    if (this.active) {
      const old = this.active;
      this.active = null;
      old.screen.destroy?.();
      const el = old.screen.el;
      el.classList.add('leaving');
      el.setAttribute('inert', '');
      window.setTimeout(() => el.remove(), store.settings.reducedMotion ? 0 : 240);
    }
    this.closeDialog(false);
    this.current = id;
    this.root.dataset.screen = id;
    if (id === 'title') this.setAccent(store.settings.lastBiome);
    if (id === 'hud' && prevId !== 'pause' && prevId !== 'settings') this.hud.reset();
    if (id !== 'hud') this.cdHideIfLeaving(id);

    if (isMenu(id)) {
      const screen = BUILDERS[id](this.ctx());
      screen.el.classList.add('entering');
      this.layerScreens.appendChild(screen.el);
      this.active = { id, screen };
      window.setTimeout(() => screen.el.classList.remove('entering'), 400);
      const f = screen.focus;
      requestAnimationFrame(() => {
        if (this.active?.screen !== screen) return;
        if (f && f.isConnected) this.quietly(() => f.focus({ preventScroll: true }));
      });
    } else {
      const a = document.activeElement as HTMLElement | null;
      if (a && this.root.contains(a)) a.blur();
    }
  }

  private cdHideIfLeaving(id: ScreenId) {
    if (id === 'title' || id === 'none' || id === 'over') this.cd.cancel();
  }

  private setAccent(b: BiomeId) {
    const info = BIOME_BY_ID[b];
    if (!info) return;
    this.root.style.setProperty('--accent', info.accent);
    this.root.style.setProperty('--accent-soft', info.accentSoft);
    this.root.dataset.biome = b;
  }

  private applyPrefs() {
    const s = store.settings;
    this.root.classList.toggle('rm', s.reducedMotion);
    this.root.classList.toggle('large-hud', s.largeHud);
    this.root.classList.toggle('no-blur', s.quality === 'low');
  }

  private sound(s: UiSound) {
    try {
      this.host.sound(s);
    } catch {
      /* host sound errors must never break UI */
    }
  }

  private quietly(fn: () => void) {
    this.quietFocus = true;
    try {
      fn();
    } finally {
      this.quietFocus = false;
    }
  }

  // =================================================================== dialog

  private confirm(o: ConfirmOpts): Promise<boolean> {
    return new Promise((resolve) => {
      this.closeDialog(false);
      const restore = document.activeElement;
      const done = (v: boolean) => {
        this.closeDialog(true);
        resolve(v);
      };
      const cancelBtn = btn({ cls: 'btn-ghost', label: o.cancel ?? 'Cancel', sfx: 'back', onClick: () => done(false) });
      const okBtn = btn({ cls: o.danger ? 'btn-danger' : 'btn-primary', label: o.ok, onClick: () => done(true) });
      const el = h(
        'div',
        { class: 'dialog-wrap' },
        h('div', { class: 'dialog-backdrop', onClick: () => done(false) }),
        h(
          'div',
          { class: 'panel dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
          h('h2', { class: 'dialog-title' }, o.title),
          h('p', { class: 'dialog-body' }, o.body),
          h('div', { class: 'dialog-actions' }, cancelBtn, okBtn),
        ),
      );
      this.dialogLayer.appendChild(el);
      this.active?.screen.el.setAttribute('inert', '');
      this.dialog = { el, cancel: () => done(false), restore };
      requestAnimationFrame(() => this.quietly(() => cancelBtn.focus({ preventScroll: true })));
    });
  }

  private closeDialog(restoreFocus: boolean) {
    if (!this.dialog) return;
    const d = this.dialog;
    this.dialog = null;
    d.el.classList.add('leaving');
    window.setTimeout(() => d.el.remove(), 200);
    this.active?.screen.el.removeAttribute('inert');
    if (restoreFocus && d.restore instanceof HTMLElement && d.restore.isConnected) this.quietly(() => (d.restore as HTMLElement).focus({ preventScroll: true }));
  }

  // =================================================================== input

  /** Returns true when this gesture revealed the title menu (the input should then be swallowed). */
  private gesture(kind: string): boolean {
    if (!this.gestureKinds.has(kind)) {
      this.gestureKinds.add(kind);
      try {
        this.host.userGesture();
      } catch {
        /* ignore */
      }
    }
    if (!this.gestureDone) {
      this.gestureDone = true;
      const fns = this.gestureFns.splice(0);
      if (fns.length) {
        this.revealT = performance.now();
        this.suppressClickUntil = this.revealT + 450;
        fns.forEach((f) => f());
        return true;
      }
    }
    return false;
  }

  private onPointerDown(e: PointerEvent) {
    this.root.classList.remove('kbd');
    this.gesture('pointerdown');
  }

  private onClick(e: MouseEvent) {
    if (performance.now() < this.suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const b = (e.target as Element).closest?.('button, [data-sfx]') as HTMLElement | null;
    if (!b || !this.root.contains(b) || (b as HTMLButtonElement).disabled) return;
    const sfx = (b.dataset.sfx ?? 'click') as UiSound | 'none';
    if (sfx !== 'none') this.sound(sfx);
  }

  private onHover(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    const t = (e.target as Element).closest?.('button, [tabindex="0"]');
    if (!t || t === this.lastHoverEl || !this.root.contains(t)) return;
    if ((t as HTMLButtonElement).disabled || t.classList.contains('hud-pause')) {
      this.lastHoverEl = t;
      return;
    }
    this.lastHoverEl = t;
    this.hoverSound();
  }

  private onFocusIn(e: FocusEvent) {
    const t = e.target as HTMLElement;
    if (this.quietFocus || !this.root.classList.contains('kbd')) return;
    if (t === this.lastHoverEl) return;
    this.lastHoverEl = t;
    this.hoverSound();
    t.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: store.settings.reducedMotion ? 'auto' : 'smooth' });
  }

  private hoverSound() {
    const now = performance.now();
    if (now - this.lastHover < 70) return;
    this.lastHover = now;
    this.sound('hover');
  }

  /** Root for navigation: dialog if open, else the active screen. */
  private navRoot(): HTMLElement | null {
    if (this.dialog) return this.dialog.el;
    return this.active?.screen.el ?? null;
  }

  private doBack() {
    if (this.dialog) {
      this.sound('back');
      this.dialog.cancel();
      return;
    }
    if (!this.active) return;
    const s = this.active.screen;
    if (s.onBack) {
      s.onBack();
      return;
    }
    this.back();
  }

  private move(dir: Dir) {
    const root = this.navRoot();
    if (!root) return;
    this.root.classList.add('kbd');
    const cur = document.activeElement as HTMLElement | null;
    const inside = cur && root.contains(cur) && cur !== document.body;
    if (!inside) {
      const def = (this.active && !this.dialog ? this.active.screen.focus : null) ?? focusables(root)[0];
      if (def) def.focus({ preventScroll: false });
      return;
    }
    const next = spatialNext(root, cur, dir);
    if (next) next.focus({ preventScroll: true });
    else if (dir === 'up' || dir === 'down') {
      // nothing further: scroll the content (long read-only screens like Credits)
      const sc = root.querySelector('.screen-scroll');
      sc?.scrollBy({ top: dir === 'down' ? 140 : -140, behavior: store.settings.reducedMotion ? 'auto' : 'smooth' });
    }
  }

  private activate() {
    const root = this.navRoot();
    if (!root) return;
    const cur = document.activeElement as HTMLElement | null;
    if (cur && root.contains(cur) && cur !== document.body) {
      if (cur instanceof HTMLInputElement) return;
      cur.click();
      return;
    }
    const def = this.active?.screen.focus;
    if (def) {
      def.focus({ preventScroll: true });
      def.click();
    }
  }

  private onKey(e: KeyboardEvent) {
    if (this.gesture('keydown')) {
      e.preventDefault();
      this.root.classList.add('kbd');
      return;
    }
    const k = e.key;
    if (this.current === 'none') return;
    if (this.current === 'hud' && !this.dialog) {
      if ((k === 'Escape' || k === 'p' || k === 'P') && !e.repeat) {
        e.preventDefault();
        this.host.pause();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const isRange = target instanceof HTMLInputElement && target.type === 'range';
    switch (k) {
      case 'Escape':
      case 'Backspace':
        e.preventDefault();
        if (!e.repeat) this.doBack();
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        this.move(k === 'ArrowUp' ? 'up' : 'down');
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (isRange) {
          this.root.classList.add('kbd');
          return; // native slider stepping
        }
        e.preventDefault();
        this.move(k === 'ArrowLeft' ? 'left' : 'right');
        return;
      case 'Enter':
      case ' ': {
        this.root.classList.add('kbd');
        const root = this.navRoot();
        const cur = document.activeElement;
        if (!root || !cur || !root.contains(cur) || cur === document.body) {
          e.preventDefault();
          if (!e.repeat) this.activate();
        } else if (cur instanceof HTMLButtonElement && e.repeat) e.preventDefault();
        return;
      }
      case 'Tab': {
        this.root.classList.add('kbd');
        // keep Tab inside the dialog / screen
        const root = this.navRoot();
        if (!root) return;
        const list = focusables(root);
        if (!list.length) return;
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) {
          e.preventDefault();
          (e.shiftKey ? list[list.length - 1] : list[0]).focus();
        }
        return;
      }
      case 'p':
      case 'P':
        if (this.current === 'pause' && !this.dialog) {
          e.preventDefault();
          this.host.resume();
        }
        return;
    }
  }

  private onPad(a: PadAction) {
    if (a === 'any') {
      if (this.gesture('gamepad')) this.root.classList.add('kbd');
      return;
    }
    if (this.current === 'none') return;
    if (this.current === 'hud') {
      if (a === 'start') this.host.pause();
      return;
    }
    if (performance.now() - this.revealT < 350) return; // same press that revealed the title menu
    this.root.classList.add('kbd');
    switch (a) {
      case 'start':
        if (this.current === 'pause' && !this.dialog) this.host.resume();
        else if (this.current === 'pause' || this.current === 'over' || this.current === 'title' || this.current === 'setup') this.activate();
        return;
      case 'a':
        this.activate();
        return;
      case 'b':
        this.doBack();
        return;
      case 'left':
      case 'right': {
        const cur = document.activeElement;
        if (cur instanceof HTMLInputElement && cur.type === 'range') {
          const step = +cur.step || 1;
          const v = Math.min(+cur.max, Math.max(+cur.min, +cur.value + (a === 'right' ? step : -step)));
          if (v !== +cur.value) {
            cur.value = String(v);
            cur.dispatchEvent(new Event('input', { bubbles: true }));
            cur.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return;
        }
        this.move(a);
        return;
      }
      default:
        this.move(a);
    }
  }
}
