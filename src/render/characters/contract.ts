import type * as THREE from 'three';
import type { CharacterId, RenderFrame } from '../../types';

/**
 * A "Legend" character renderer. It receives the exact same RenderFrame as the snake
 * (frame.snake.points = centreline head→tail, radius, bulges, alive/deathT, ghost...),
 * and must visually occupy the same footprint (≈ radius 0.34 cells) so gameplay stays fair.
 */
export interface ICharacterView {
  readonly id: CharacterId;
  readonly object: THREE.Object3D;
  update(frame: RenderFrame): void;
  dispose(): void;
}
