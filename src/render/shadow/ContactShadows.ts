// Soft contact shadows: render occluders (snake + props) top-down into a low-res RT.
// R = sun-projected shadow (geometry sheared along the sun's ground projection by height)
// G = ambient occlusion footprint (vertical projection, blurred wider).
// Objects with `userData.noShadow = true` (or invisible) are skipped.
import * as THREE from 'three';
import { LIGHT } from '../lighting';
import { FullscreenPass, makeRT, passMaterial } from '../fsq';

const OCC_VERT = /* glsl */ `
uniform vec3 uSun;
uniform float uMode;
varying float vH;
void main() {
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
#endif
  float h = max(wp.z, 0.0);
  vH = h;
  if (uMode < 0.5) wp.xy -= uSun.xy / max(uSun.z, 0.2) * h;
  wp.z = 0.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const OCC_FRAG = /* glsl */ `
uniform float uMode;
varying float vH;
void main() {
  if (uMode < 0.5) gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
  else gl_FragColor = vec4(0.0, clamp(1.15 - vH * 0.9, 0.0, 1.0), 0.0, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDirR;
uniform vec2 uDirG;
void main() {
  // 9-tap gaussian per channel with independent radii
  float w0 = 0.2270270270, w1 = 0.1945945946, w2 = 0.1216216216, w3 = 0.0540540541, w4 = 0.0162162162;
  float r = texture2D(uTex, vUv).r * w0;
  float g = texture2D(uTex, vUv).g * w0;
  r += (texture2D(uTex, vUv + uDirR).r + texture2D(uTex, vUv - uDirR).r) * w1;
  r += (texture2D(uTex, vUv + uDirR * 2.0).r + texture2D(uTex, vUv - uDirR * 2.0).r) * w2;
  r += (texture2D(uTex, vUv + uDirR * 3.0).r + texture2D(uTex, vUv - uDirR * 3.0).r) * w3;
  r += (texture2D(uTex, vUv + uDirR * 4.0).r + texture2D(uTex, vUv - uDirR * 4.0).r) * w4;
  g += (texture2D(uTex, vUv + uDirG).g + texture2D(uTex, vUv - uDirG).g) * w1;
  g += (texture2D(uTex, vUv + uDirG * 2.0).g + texture2D(uTex, vUv - uDirG * 2.0).g) * w2;
  g += (texture2D(uTex, vUv + uDirG * 3.0).g + texture2D(uTex, vUv - uDirG * 3.0).g) * w3;
  g += (texture2D(uTex, vUv + uDirG * 4.0).g + texture2D(uTex, vUv - uDirG * 4.0).g) * w4;
  gl_FragColor = vec4(r, g, 0.0, 1.0);
}
`;

export class ContactShadows {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private cam = new THREE.OrthographicCamera(0, 1, 1, 0, -100, 100);
  private occMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private fsq = new FullscreenPass();
  private res = 256;
  private region = new THREE.Vector4(0, 0, 1, 1);
  private roots: THREE.Object3D[] = [];
  private hidden: THREE.Object3D[] = [];
  private clearColor = new THREE.Color(0, 0, 0);
  private prevClear = new THREE.Color();

  constructor() {
    this.occMat = new THREE.ShaderMaterial({
      vertexShader: OCC_VERT, fragmentShader: OCC_FRAG,
      uniforms: { uSun: LIGHT.sunDir, uMode: { value: 0 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.blurMat = passMaterial(BLUR_FRAG, {
      uTex: { value: null }, uDirR: { value: new THREE.Vector2() }, uDirG: { value: new THREE.Vector2() },
    });
    this.rtA = makeRT(4, 4, { type: THREE.UnsignedByteType });
    this.rtB = makeRT(4, 4, { type: THREE.UnsignedByteType });
  }

  get texture() { return this.rtB.texture; }

  setRoots(...roots: THREE.Object3D[]) { this.roots = roots; }

  /** region = world rect (x0,y0,w,h) the shadow texture covers. */
  configure(region: THREE.Vector4, res: number) {
    this.region.copy(region);
    this.res = res;
    const texel = Math.max(region.z, region.w) / res;
    const w = Math.max(4, Math.round(region.z / texel)), h = Math.max(4, Math.round(region.w / texel));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.cam.left = region.x; this.cam.right = region.x + region.z;
    this.cam.bottom = region.y; this.cam.top = region.y + region.w;
    this.cam.position.set(0, 0, 50);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }

  render(r: THREE.WebGLRenderer, scene: THREE.Scene, exclude: THREE.Object3D[]) {
    r.getClearColor(this.prevClear);
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(this.clearColor, 0);
    r.setRenderTarget(this.rtA);
    r.clear(true, false, false);
    // hide non-occluders and opted-out objects, render the main scene with the override material
    this.hidden.length = 0;
    for (const o of exclude) if (o.visible) { o.visible = false; this.hidden.push(o); }
    for (const root of this.roots) {
      root.traverse((o) => {
        if (o.visible && (o.userData.noShadow || (o as any).isPoints || (o as any).isSprite || (o as any).isLine)) {
          o.visible = false; this.hidden.push(o);
        }
      });
    }
    const prevAuto = r.autoClear;
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.occMat;
    r.autoClear = false;
    for (let mode = 0; mode < 2; mode++) {
      this.occMat.uniforms.uMode.value = mode;
      r.render(scene, this.cam);
    }
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    r.autoClear = prevAuto;
    for (const o of this.hidden) o.visible = true;
    // blur (texel units)
    const w = this.rtA.width, h = this.rtA.height;
    const cellsPerTexel = this.region.z / w;
    const rR = 0.07 / cellsPerTexel, rG = 0.16 / cellsPerTexel;
    const u = this.blurMat.uniforms;
    u.uTex.value = this.rtA.texture;
    (u.uDirR.value as THREE.Vector2).set(rR / w, 0);
    (u.uDirG.value as THREE.Vector2).set(rG / w, 0);
    this.fsq.render(r, this.blurMat, this.rtB);
    u.uTex.value = this.rtB.texture;
    (u.uDirR.value as THREE.Vector2).set(0, rR / h);
    (u.uDirG.value as THREE.Vector2).set(0, rG / h);
    this.fsq.render(r, this.blurMat, this.rtA);
    // second iteration for extra softness
    u.uTex.value = this.rtA.texture;
    (u.uDirR.value as THREE.Vector2).set(rR * 0.6 / w, 0);
    (u.uDirG.value as THREE.Vector2).set(rG * 0.6 / w, 0);
    this.fsq.render(r, this.blurMat, this.rtB);
    u.uTex.value = this.rtB.texture;
    (u.uDirR.value as THREE.Vector2).set(0, rR * 0.6 / h);
    (u.uDirG.value as THREE.Vector2).set(0, rG * 0.6 / h);
    this.fsq.render(r, this.blurMat, this.rtA);
    // result in rtA -> swap so .texture (rtB) is final
    const t = this.rtA; this.rtA = this.rtB; this.rtB = t;
    r.setRenderTarget(null);
    r.setClearColor(this.prevClear, prevAlpha);
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.occMat.dispose(); this.blurMat.dispose(); this.fsq.dispose();
  }
}
