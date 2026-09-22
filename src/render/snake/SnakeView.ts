// STUB – to be replaced by render-snake agent.
import * as THREE from 'three';
import type { ISnakeView } from '../contract';
import type { RenderFrame, SkinId } from '../../types';

export class SnakeView implements ISnakeView {
  readonly object = new THREE.Group();
  private spheres: THREE.InstancedMesh;
  constructor() {
    this.spheres = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.5 }),
      800,
    );
    this.object.add(this.spheres);
  }
  setSkin(_id: SkinId) {}
  update(f: RenderFrame) {
    const m = new THREE.Matrix4();
    const s = f.snake;
    let n = 0;
    for (let i = 0; i < s.count && n < 800; i += 2) {
      const r = s.radius * (i < 4 ? 1.1 : Math.max(0.2, 1 - i / s.count));
      m.makeScale(r, r, r * 0.7).setPosition(s.points[i * 2], s.points[i * 2 + 1], r * 0.5);
      this.spheres.setMatrixAt(n++, m);
    }
    this.spheres.count = n;
    this.spheres.instanceMatrix.needsUpdate = true;
  }
  dispose() {}
}
