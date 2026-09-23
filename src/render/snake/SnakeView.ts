// Snake renderer: procedural scaled tube + head parts, per-skin physical material.
import * as THREE from 'three';
import type { ISnakeView } from '../contract';
import type { CharacterId, QualityLevel, RenderFrame, SkinId, SnakeSkinId } from '../../types';
import { isLegend } from '../../skins/skins';
import { createCharacter } from '../characters';
import type { ICharacterView } from '../characters/contract';
import { SnakeBody, type RingFrame } from './SnakeBody';
import { SnakeHead } from './SnakeHead';
import { DeathChain } from './DeathChain';
import { applySkin, createSnakeMaterial, setGlass, type SnakeUniforms } from './snakeMaterial';
import type { SkinLook } from './skinLooks';

const WAVE_LEN = 2.6;

export class SnakeView implements ISnakeView {
  readonly object = new THREE.Group();
  private body = new SnakeBody();
  private head = new SnakeHead();
  private chain = new DeathChain();
  private mesh: THREE.Mesh;
  private mat: THREE.MeshPhysicalMaterial;
  private u: SnakeUniforms;
  private skin: SkinId | null = null;
  private phase = 0;
  private amp = 0;
  private lead = 0;
  private wasAlive = true;
  private r = 0.34;
  private look: SkinLook | null = null;
  private quality: QualityLevel = 'high';
  /** Crystal on low quality: alpha-blended glass instead of transmission. */
  private glassBlend = false;
  /** renderer.transmissionResolutionScale while the crystal uses transmission (0 = leave alone). */
  private transScale = 0;
  /** Debug hook: constant tongue flicks. */
  set debugTongue(v: boolean) { this.head.forceTongue = v; }
  private frameAtBound: (s: number, out: RingFrame) => RingFrame;

  constructor() {
    const { mat, u } = createSnakeMaterial();
    this.mat = mat; this.u = u;
    this.mesh = new THREE.Mesh(this.body.geometry, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'snake-body';
    // crystal: the transmission target is the main cost, so size it by quality (takes effect next frame)
    this.mesh.onBeforeRender = (r) => {
      if (this.transScale > 0 && r.transmissionResolutionScale !== this.transScale) r.transmissionResolutionScale = this.transScale;
    };
    this.object.name = 'snake';
    this.object.add(this.mesh, this.head.group);
    this.frameAtBound = (s, out) => this.body.frameAt(s, this.r, out);
    this.setSkin('obsidian');
  }

  private character: ICharacterView | null = null;
  private characters = new Map<CharacterId, ICharacterView | null>();

  setSkin(id: SkinId) {
    if (id === this.skin) return;
    this.skin = id;
    if (this.character) {
      this.object.remove(this.character.object);
      this.character = null;
    }
    if (isLegend(id)) {
      const cid = id as CharacterId;
      if (!this.characters.has(cid)) this.characters.set(cid, createCharacter(cid));
      this.character = this.characters.get(cid) ?? null;
      if (this.character) {
        this.object.add(this.character.object);
        this.mesh.visible = false;
        this.head.group.visible = false;
        return;
      }
      id = 'obsidian'; // not implemented yet: fall back to the default snake look
    }
    const L = applySkin(this.mat, this.u, id as SnakeSkinId);
    this.head.setLook(L);
    this.look = L;
    this.applyGlass();
  }

  /**
   * Quality level (from GameRenderer.applyQuality). Only the crystal skin cares: medium+ uses real
   * transmission (three renders the opaque scene once more into a transmission target), low uses a
   * cheap alpha-blended glass. High/ultra add chromatic dispersion.
   */
  setQuality(q: QualityLevel) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyGlass();
  }

  private applyGlass() {
    const L = this.look;
    const glass = !!L?.glass;
    const mode = !glass ? 'none' : this.quality === 'low' ? 'blend' : 'transmission';
    const disp = this.quality === 'ultra' ? 0.3 : 0;
    this.glassBlend = setGlass(this.mat, this.u, mode, disp);
    this.transScale = mode === 'transmission' ? (this.quality === 'medium' ? 0.5 : this.quality === 'high' ? 0.75 : 1) : 0;
    // hint for the contact-shadow pass (glass casts a lighter shadow)
    this.mesh.userData.shadowOpacity = L?.shadow ?? 1;
  }

  update(f: RenderFrame) {
    const s = f.snake;
    if (s.skin && s.skin !== this.skin) this.setSkin(s.skin);
    if (this.character) {
      this.mesh.visible = false;
      this.head.group.visible = false;
      this.character.update(f);
      return;
    }
    const dt = Math.max(0, Math.min(0.1, f.dt));
    this.r = s.radius || 0.34;
    this.u.uR.value = this.r;
    this.u.uTime.value = f.time;

    // --- death writhe
    let px = s.points;
    if (!s.alive) {
      if (this.wasAlive || !this.chain.active) this.chain.seed(s.points, Math.min(s.count, s.points.length >> 1), s.spacing);
      if (!f.paused) this.chain.step(dt);
      px = this.chain.x;
    } else if (!this.wasAlive) {
      this.chain.active = false;
    }
    this.wasAlive = s.alive;
    this.u.uDead.value = s.alive ? 0 : Math.min(1, s.deathT / 1.2);

    // --- undulation (visual only)
    const spd = Math.abs(s.speed);
    const turn = Math.min(1, Math.abs(s.turnRate) / 3);
    let targetAmp = Math.min(0.12, (0.004 + spd * 0.0105) * (1 + 0.35 * turn));
    if (!s.alive) targetAmp = 0;
    const kA = 1 - Math.exp(-dt * (s.alive ? 3 : 8));
    this.amp += (targetAmp - this.amp) * kA;
    if (!f.paused) this.phase = (this.phase + (Math.PI * 2 * spd * dt) / WAVE_LEN) % (Math.PI * 2000);
    const targetLead = s.alive ? Math.max(-0.07, Math.min(0.07, -s.turnRate * 0.018)) : 0;
    this.lead += (targetLead - this.lead) * (1 - Math.exp(-dt * 8));

    const count = Math.min(s.count, s.points.length >> 1, px.length >> 1);
    this.body.build({
      px, count, spacing: s.spacing, radius: this.r,
      fwdX: s.dirX, fwdY: s.dirY, bulges: s.bulges,
      waveAmp: this.amp, wavePhase: this.phase, waveLen: WAVE_LEN, headLead: this.lead,
      headWidth: this.look?.headWidth ?? 0,
    });
    this.u.uLen.value = Math.max(0.05, this.body.endS - this.body.tipS);

    // --- ghost
    let opacity = 1;
    if (s.ghost) {
      opacity = 0.34 + 0.07 * Math.sin(f.time * 23) * Math.sin(f.time * 7.3) + 0.05 * Math.sin(f.time * 3.1);
      this.u.uGhost.value = Math.min(1, (this.u.uGhost.value as number) + dt * 5);
    } else {
      this.u.uGhost.value = Math.max(0, (this.u.uGhost.value as number) - dt * 5);
    }
    const gh = (this.u.uGhost.value as number) > 0.01;
    const tr = gh || this.glassBlend;
    if (this.mat.transparent !== tr) { this.mat.transparent = tr; this.mat.needsUpdate = true; }
    this.mat.opacity = gh ? 1 - (1 - opacity) * (this.u.uGhost.value as number) : 1;
    this.mat.depthWrite = true;
    this.mesh.visible = count >= 2;
    this.head.group.visible = count >= 2;

    if (count >= 2) {
      this.head.update(this.frameAtBound, this.body.tipS, this.r, f.paused ? 0 : dt, s.alive, s.deathT, s.interest, gh, this.mat.opacity);
    }
  }

  dispose() {
    for (const c of this.characters.values()) c?.dispose();
    this.body.geometry.dispose();
    this.mat.dispose();
    this.head.dispose();
  }
}
