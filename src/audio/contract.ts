import type { BiomeId, GameEvent } from '../types';

export type UiSound = 'hover' | 'click' | 'back' | 'start' | 'toggle' | 'achievement' | 'unlock' | 'countdown' | 'go';

/** Owned by audio agent: src/audio/AudioEngine.ts (export class AudioEngine implements IAudioEngine) */
export interface IAudioEngine {
  /** Must be called from a user gesture handler (click/touch/key). Safe to call repeatedly. */
  unlock(): void;
  setVolumes(master: number, music: number, sfx: number, muted: boolean): void;
  /** Crossfades to the biome's generative score. */
  setBiome(id: BiomeId): void;
  /** 'menu' = calm ambient layer, 'game' = full score with intensity layers, 'over' = sparse outro. */
  setScene(scene: 'menu' | 'game' | 'paused' | 'over'): void;
  /** 0..1 musical intensity (combo / length). */
  setIntensity(v: number): void;
  /** 1 normal, 0.5 slow-time (pitch/tempo drop + lowpass). */
  setTimeScale(v: number): void;
  /** Continuous slither loop: speed in cells/s (0 = silent), turn in rad/s. */
  setSlither(speed: number, turnRate: number): void;
  handleEvents(events: GameEvent[]): void;
  ui(sound: UiSound): void;
  /** Called when tab hidden/visible. */
  suspend(): void;
  resume(): void;
}
