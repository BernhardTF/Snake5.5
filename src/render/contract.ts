import type { BiomeId, QualityLevel, RenderFrame, SkinId } from '../types';
import type * as THREE from 'three';

/** Options applied from settings. */
export interface RenderOptions {
  quality: QualityLevel;
  renderScale: number;
  bloom: boolean;
  dof: boolean;
  particles: boolean;
  reducedMotion: boolean;
  highContrastFood: boolean;
}

/** Owned by render-sand agent: src/render/GameRenderer.ts */
export interface IGameRenderer {
  readonly canvas: HTMLCanvasElement;
  setOptions(o: RenderOptions): void;
  /** Switch biome visuals (sand material, frame, lighting, particles, props style). Clears sand. */
  setBiome(id: BiomeId): void;
  /** Board size in cells; re-fits camera, re-allocates deform target, clears sand. */
  setBoard(w: number, h: number): void;
  /** Wipe all trails (new run). */
  clearSand(): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  render(frame: RenderFrame): void;
  /** Screen-space rect (css px) of the board, for UI layout. */
  boardRect(): { x: number; y: number; w: number; h: number };
  /** Converts css pixel to board/world coords. */
  screenToWorld(px: number, py: number): { x: number; y: number };
  /** PNG of the current frame (for "save picture of your garden"). */
  snapshot(): Promise<Blob | null>;
  /** Fraction of the board raked/disturbed so far, 0..1 (sampled lazily, may lag). */
  patternCoverage(): number;
  /** Rolling average ms per frame, for auto-quality. */
  readonly frameMs: number;
  dispose(): void;
}

/** Owned by render-snake agent: src/render/snake/SnakeView.ts */
export interface ISnakeView {
  readonly object: THREE.Object3D;
  setSkin(id: SkinId): void;
  update(frame: RenderFrame): void;
  dispose(): void;
}

/** Owned by render-snake agent: src/render/props/PropsView.ts (food, obstacles, powerups). */
export interface IPropsView {
  readonly object: THREE.Object3D;
  setBiome(id: BiomeId): void;
  setHighContrast(on: boolean): void;
  update(frame: RenderFrame): void;
  dispose(): void;
}
