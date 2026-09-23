// Common scaffolding for Legend characters: timing, travelled distance, ghost blend, events, track.
import * as THREE from 'three';
import type { CharacterId, RenderFrame } from '../../../types';
import type { ICharacterView } from '../contract';
import { PathTrack } from './track';
import { applyGhost, clamp, ghostOpacity } from './util';

export abstract class LegendBase implements ICharacterView {
  abstract readonly id: CharacterId;
  readonly object = new THREE.Group();
  protected track = new PathTrack();
  /** Solid materials that fade for the ghost look. */
  protected solids: THREE.Material[] = [];
  /** Animation clock (stops while paused). */
  protected t = 0;
  protected dt = 0;
  /** Distance travelled along the path (cells), drives gaits/wheels. */
  protected dist = 0;
  protected ghostK = 0;
  protected ghostOp = 1;
  /** Number of 'eat' events this frame. */
  protected eats = 0;
  protected wasAlive = true;
  /** True on the first frame after dying. */
  protected justDied = false;
  protected r = 0.34;
  /** Smoothing half-window of the centreline (cells). */
  protected smoothLen = 0.18;

  constructor() {
    this.object.name = 'legend';
  }

  update(f: RenderFrame) {
    const s = f.snake;
    const dt = f.paused ? 0 : clamp(f.dt, 0, 0.1);
    this.dt = dt;
    this.t += dt;
    this.r = s.radius || 0.34;
    if (s.alive) this.dist += Math.abs(s.speed) * dt;
    this.justDied = !s.alive && this.wasAlive;
    this.wasAlive = s.alive;
    this.eats = 0;
    for (let i = 0; i < f.events.length; i++) if (f.events[i].type === 'eat') this.eats++;
    if (dt > 0 || this.track.n === 0 || f.paused === false) {
      this.track.update(s.points, s.count, s.spacing, this.smoothLen, s.dirX, s.dirY);
    }
    this.ghostK = s.ghost ? Math.min(1, this.ghostK + dt * 5) : Math.max(0, this.ghostK - dt * 5);
    if (f.paused && s.ghost) this.ghostK = 1;
    this.ghostOp = ghostOpacity(f.time);
    applyGhost(this.solids, this.ghostK, this.ghostOp);
    this.object.visible = this.track.n >= 2;
    if (this.track.n < 2) return;
    this.draw(f);
  }

  protected abstract draw(f: RenderFrame): void;

  /** Bulge amount (0..~1) at arclength s. */
  protected bulgeAt(f: RenderFrame, s: number, width = 0.42) {
    const b = f.snake.bulges;
    let v = 0;
    for (let i = 0; i < b.length; i++) {
      const d = (s - b[i].s) / width;
      if (d > -3 && d < 3) v += clamp(b[i].amount, 0, 1) * Math.exp(-d * d);
    }
    return v;
  }

  /** Current alpha multiplier for additive glows (dims them in ghost mode). */
  protected get glowFade() { return 1 - this.ghostK * 0.45; }

  dispose() {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
  }
}
