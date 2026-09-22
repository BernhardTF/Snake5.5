// STUB – to be replaced by render-snake agent.
import * as THREE from 'three';
import type { IPropsView } from '../contract';
import type { BiomeId, RenderFrame } from '../../types';

export class PropsView implements IPropsView {
  readonly object = new THREE.Group();
  private pool = new Map<string, THREE.Mesh>();
  private geo = new THREE.SphereGeometry(1, 16, 12);
  private mats = {
    food: new THREE.MeshStandardMaterial({ color: 0xf29bb5 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xf2c94c, metalness: 0.6, roughness: 0.3 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.9 }),
    pow: new THREE.MeshStandardMaterial({ color: 0x6bc7ff, emissive: 0x2266aa }),
  };
  setBiome(_id: BiomeId) {}
  setHighContrast(_on: boolean) {}
  private get(key: string, mat: THREE.Material) {
    let m = this.pool.get(key);
    if (!m) { m = new THREE.Mesh(this.geo, mat); this.pool.set(key, m); this.object.add(m); }
    m.visible = true;
    return m;
  }
  update(f: RenderFrame) {
    for (const m of this.pool.values()) m.visible = false;
    for (const o of f.foods) this.get('f' + o.id, o.kind === 'golden' ? this.mats.gold : this.mats.food).position.set(o.x, o.y, 0.2).setScalar ? this.pool.get('f' + o.id)!.scale.setScalar(0.3) : 0;
    for (const o of f.foods) this.pool.get('f' + o.id)!.position.set(o.x, o.y, 0.2);
    for (const o of f.obstacles) { const m = this.get('o' + o.id, this.mats.rock); m.position.set(o.x, o.y, 0); m.scale.set(o.r, o.r, o.r * 0.6); }
    for (const o of f.powerups) { const m = this.get('p' + o.id, this.mats.pow); m.position.set(o.x, o.y, 0.3); m.scale.setScalar(0.3); }
  }
  dispose() {}
}
