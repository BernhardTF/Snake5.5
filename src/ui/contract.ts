import type { Settings } from '../core/storage';
import type { BiomeId, GameConfig, GameModeId, HudState, MovementMode, RunResult, SkinId } from '../types';
import type { UiSound } from '../audio/contract';

export interface StartRequest {
  mode: GameModeId;
  movement: MovementMode;
  biome: BiomeId;
  skin: SkinId;
}

/** Implemented by App (lead). The UI calls these. */
export interface UIHost {
  startGame(req: StartRequest): void;
  pause(): void;
  resume(): void;
  restart(): void;
  quitToMenu(): void;
  /** Settings were changed in the settings screen (already saved to store). */
  settingsChanged(s: Settings): void;
  /** Title/setup screens: change the live background preview. */
  previewBiome(id: BiomeId): void;
  previewSkin(id: SkinId): void;
  sound(s: UiSound): void;
  /** Save a PNG of the garden. */
  savePicture(): void;
  /** Called by UI once the first user gesture happens (audio unlock etc). */
  userGesture(): void;
}

export type ScreenId =
  | 'title' | 'setup' | 'skins' | 'achievements' | 'records' | 'settings' | 'credits'
  | 'hud' | 'pause' | 'over' | 'none';

/** Owned by ui agent: src/ui/UI.ts (export class UI implements IUI) */
export interface IUI {
  show(screen: ScreenId): void;
  readonly current: ScreenId;
  updateHud(h: HudState): void;
  /** Floating text at a css pixel position (score popups, "NEAR MISS", "x4"). */
  popup(text: string, px: number, py: number, kind: 'score' | 'combo' | 'near' | 'bonus' | 'warn'): void;
  showResult(r: RunResult): void;
  toast(title: string, subtitle?: string, icon?: string): void;
  /** 3-2-1-GO overlay; resolves when finished. */
  countdown(): Promise<void>;
  /** Touch control overlays for the current run (null hides). */
  setTouchControls(kind: 'dpad' | 'halves' | null): void;
  setFps(fps: number | null): void;
  /** True when a menu/text field has focus so gameplay input should be ignored. */
  capturesInput(): boolean;
}

export type { GameConfig };

/**
 * On-screen touch controls dispatch this on `window` so the input system can consume them:
 *   window.dispatchEvent(new CustomEvent<TouchControlDetail>('ss-touch', { detail }))
 */
export type TouchControlDetail =
  | { kind: 'dir'; dir: 'up' | 'down' | 'left' | 'right' }
  | { kind: 'half'; side: 'left' | 'right'; down: boolean };
