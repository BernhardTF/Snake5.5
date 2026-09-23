// Soft contact shadows: render occluders (snake + props) top-down into a low-res RT.
// R = sun-projected shadow (geometry sheared along the sun's ground projection by height)
// G = ambient occlusion footprint (vertical projection, blurred wider).
// B = second-sun shadow (twin-sun worlds only, LIGHT.sun2Dir; 0 elsewhere and the pass is skipped).
// Objects with `userData.noShadow = true` (or invisible) are skipped. `userData.shadowOpacity`
// (0..1, e.g. 0.35 for the glass snake) scales that object's shadow + occlusion.
import * as THREE from 'three';
import { LIGHT } from '../lighting';
import { FullscreenPass, makeRT, passMaterial } from '../fsq';

const OCC_VERT = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSun2;
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
  else if (uMode > 1.5) wp.xy -= uSun2.xy / max(uSun2.z, 0.2) * h;
  wp.z = 0.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const OCC_FRAG = /* glsl */ `
uniform float uMode;
uniform float uOpacity;
varying float vH;
void main() {
  if (uMode < 0.5) gl_FragColor = vec4(uOpacity, 0.0, 0.0, 1.0);
  else if (uMode > 1.5) gl_FragColor = vec4(0.0, 0.0, uOpacity, 1.0);
  else gl_FragColor = vec4(0.0, clamp(1.15 - vH * 0.9, 0.0, 1.0) * uOpacity, 0.0, 1.0);
}
`;

export const BLUR_FRAG = /* glsl */ `
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

// Same as BLUR_FRAG, plus the B channel (second-sun shadow) blurred with the R radius.
const BLUR3_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDirR;
uniform vec2 uDirG;
void main() {
  float w0 = 0.2270270270, w1 = 0.1945945946, w2 = 0.1216216216, w3 = 0.0540540541, w4 = 0.0162162162;
  vec3 c0 = texture2D(uTex, vUv).rgb;
  vec2 rb = c0.rb * w0;
  float g = c0.g * w0;
  rb += (texture2D(uTex, vUv + uDirR).rb + texture2D(uTex, vUv - uDirR).rb) * w1;
  rb += (texture2D(uTex, vUv + uDirR * 2.0).rb + texture2D(uTex, vUv - uDirR * 2.0).rb) * w2;
  rb += (texture2D(uTex, vUv + uDirR * 3.0).rb + texture2D(uTex, vUv - uDirR * 3.0).rb) * w3;
  rb += (texture2D(uTex, vUv + uDirR * 4.0).rb + texture2D(uTex, vUv - uDirR * 4.0).rb) * w4;
  g += (texture2D(uTex, vUv + uDirG).g + texture2D(uTex, vUv - uDirG).g) * w1;
  g += (texture2D(uTex, vUv + uDirG * 2.0).g + texture2D(uTex, vUv - uDirG * 2.0).g) * w2;
  g += (texture2D(uTex, vUv + uDirG * 3.0).g + texture2D(uTex, vUv - uDirG * 3.0).g) * w3;
  g += (texture2D(uTex, vUv + uDirG * 4.0).g + texture2D(uTex, vUv - uDirG * 4.0).g) * w4;
  gl_FragColor = vec4(rb.x, g, rb.y, 1.0);
}
`;

export class ContactShadows {
  /** Blur scale of the sun shadows (1 = default soft contact shadow; luna uses a crisp 0.3). */
  softness = 1;
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
  private hideVisit = (o: THREE.Object3D) => {
    if (o.visible && (o.userData.noShadow || (o as any).isPoints || (o as any).isSprite || (o as any).isLine)) {
      o.visible = false; this.hidden.push(o);
      return;
    }
    const op = o.userData.shadowOpacity;
    if (typeof op === 'number' && op < 0.999) {
      // partial shadow: the pass uses one override material, so set its opacity around this draw
      this.opObjs.push(o);
      this.opBefore.push(o.onBeforeRender);
      this.opAfter.push(o.onAfterRender);
      o.onBeforeRender = this.opSet;
      o.onAfterRender = this.opReset;
    }
  };
  private opObjs: THREE.Object3D[] = [];
  private opBefore: THREE.Object3D['onBeforeRender'][] = [];
  private opAfter: THREE.Object3D['onAfterRender'][] = [];
  private opSet: THREE.Object3D['onBeforeRender'];
  private opReset: THREE.Object3D['onAfterRender'];

  constructor() {
    this.occMat = new THREE.ShaderMaterial({
      vertexShader: OCC_VERT, fragmentShader: OCC_FRAG,
      uniforms: { uSun: LIGHT.sunDir, uSun2: LIGHT.sun2Dir, uMode: { value: 0 }, uOpacity: { value: 1 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const occ = this.occMat;
    // three calls these with `this` = the object being drawn
    this.opSet = function (this: THREE.Object3D) {
      occ.uniforms.uOpacity.value = this.userData.shadowOpacity ?? 1;
      occ.uniformsNeedUpdate = true;
    };
    this.opReset = function () {
      occ.uniforms.uOpacity.value = 1;
      occ.uniformsNeedUpdate = true;
    };
    this.blurMat = passMaterial(BLUR3_FRAG, {
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
    for (const root of this.roots) root.traverse(this.hideVisit);
    const prevAuto = r.autoClear;
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.occMat;
    r.autoClear = false;
    const s2 = LIGHT.sun2Color.value;
    const modes = s2.r + s2.g + s2.b > 1e-5 ? 3 : 2; // second-sun pass only on twin-sun worlds
    for (let mode = 0; mode < modes; mode++) {
      this.occMat.uniforms.uMode.value = mode;
      r.render(scene, this.cam);
    }
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    r.autoClear = prevAuto;
    for (const o of this.hidden) o.visible = true;
    for (let i = 0; i < this.opObjs.length; i++) {
      this.opObjs[i].onBeforeRender = this.opBefore[i];
      this.opObjs[i].onAfterRender = this.opAfter[i];
    }
    this.opObjs.length = 0; this.opBefore.length = 0; this.opAfter.length = 0;
    this.occMat.uniforms.uOpacity.value = 1;
    // blur (texel units)
    const w = this.rtA.width, h = this.rtA.height;
    const cellsPerTexel = this.region.z / w;
    const rR = 0.07 * this.softness / cellsPerTexel, rG = 0.16 / cellsPerTexel;
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
