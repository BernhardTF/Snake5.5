import type { UIHost, ScreenId } from './contract';
import type { UiSound } from '../audio/contract';
import type { BiomeId, RunResult } from '../types';

export interface ConfirmOpts {
  title: string;
  body: string;
  ok: string;
  cancel?: string;
  danger?: boolean;
}

/** Services every screen builder receives. */
export interface ScreenCtx {
  host: UIHost;
  /** Navigate forward to a sub-screen (the current one is remembered for back()). */
  go(s: ScreenId): void;
  back(): void;
  sound(s: UiSound): void;
  confirm(o: ConfirmOpts): Promise<boolean>;
  toast(title: string, subtitle?: string, icon?: string): void;
  setAccent(b: BiomeId): void;
  /** Screen we came from (for back labels). */
  readonly from: ScreenId | null;
  readonly result: RunResult | null;
  reducedMotion(): boolean;
  touch: boolean;
  /** Title screen: true until the first gesture of the session. */
  awaitingGesture(): boolean;
  onGesture(fn: () => void): void;
}

export interface Screen {
  el: HTMLElement;
  /** Element focused when the screen appears. */
  focus?: HTMLElement | null;
  /** Custom back behaviour (Esc / Backspace / gamepad B). Default: ctx.back(). Return false to ignore. */
  onBack?(): boolean | void;
  destroy?(): void;
}
