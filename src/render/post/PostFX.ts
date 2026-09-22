// Post pipeline: HDR scene RT -> (bloom mip chain) -> (tilt-shift DOF) -> composite
// (tonemap + per-biome grade + vignette + death/slow-time effects + grain) -> screen.
import * as THREE from 'three';
import { FullscreenPass, makeRT, passMaterial } from '../fsq';

const PREFILTER = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
vec3 th(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return min(c * contrib, vec3(30.0));
}
void main() {
  vec2 o = uTexel;
  vec3 c = texture2D(uTex, vUv + vec2(-o.x, -o.y)).rgb + texture2D(uTex, vUv + vec2(o.x, -o.y)).rgb
         + texture2D(uTex, vUv + vec2(-o.x, o.y)).rgb + texture2D(uTex, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(th(c * 0.25), 1.0);
}
`;
const DOWN = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec2 o = uTexel;
  vec3 a = texture2D(uTex, vUv + o * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(uTex, vUv + o * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(uTex, vUv + o * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(uTex, vUv + o * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(uTex, vUv).rgb;
  vec3 f = texture2D(uTex, vUv + o * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(uTex, vUv + o * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(uTex, vUv + o * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(uTex, vUv + o * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(uTex, vUv + o * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(uTex, vUv + o * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(uTex, vUv + o * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(uTex, vUv + o * vec2(1.0, -1.0)).rgb;
  vec3 r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(r, 1.0);
}
`;
const UP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;   // lower (smaller) level being upsampled
uniform sampler2D uBase;  // current level
uniform vec2 uTexel;      // texel of uTex
uniform float uRadius;
void main() {
  vec2 o = uTexel * uRadius;
  vec3 s = texture2D(uTex, vUv).rgb * 4.0;
  s += (texture2D(uTex, vUv + vec2(o.x, 0.0)).rgb + texture2D(uTex, vUv - vec2(o.x, 0.0)).rgb
      + texture2D(uTex, vUv + vec2(0.0, o.y)).rgb + texture2D(uTex, vUv - vec2(0.0, o.y)).rgb) * 2.0;
  s += texture2D(uTex, vUv + o).rgb + texture2D(uTex, vUv - o).rgb
     + texture2D(uTex, vUv + vec2(o.x, -o.y)).rgb + texture2D(uTex, vUv + vec2(-o.x, o.y)).rgb;
  gl_FragColor = vec4(texture2D(uBase, vUv).rgb + s / 16.0, 1.0);
}
`;
const BLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
  c += (texture2D(uTex, vUv + uDir * 1.3846).rgb + texture2D(uTex, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(uTex, vUv + uDir * 3.2308).rgb + texture2D(uTex, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;
const COMPOSITE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uDof;
uniform float uBloomStr, uTime, uVignette, uDeath, uPulse, uSlow, uGrain, uExposure, uSat, uContrast, uDofAmt, uAspect;
uniform vec3 uLift, uGamma, uGain;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = vUv;
  vec3 c = texture2D(uScene, uv).rgb;
  if (uSlow > 0.001) {
    vec2 dir = uv - 0.5;
    float k = uSlow * 0.012 * dot(dir, dir) * 4.0;
    c.r = texture2D(uScene, uv + dir * k).r;
    c.b = texture2D(uScene, uv - dir * k).b;
  }
#ifdef USE_DOF
  float band = smoothstep(0.3, 0.5, abs(uv.y - 0.5));
  c = mix(c, texture2D(uDof, uv).rgb, band * uDofAmt);
#endif
#ifdef USE_BLOOM
  c += texture2D(uBloom, uv).rgb * uBloomStr;
#endif
  c *= uExposure;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  vec3 g = pow(clamp(gl_FragColor.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
  g = uGain * (g + uLift * (1.0 - g));
  g = pow(max(g, 0.0), 1.0 / uGamma);
  g = (g - 0.5) * uContrast + 0.5;
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, uSat * (1.0 - 0.85 * uDeath));
  g *= 1.0 - 0.12 * uDeath;
  g = mix(g, g * vec3(0.86, 0.96, 1.12) + vec3(0.0, 0.01, 0.03), uSlow * 0.6);
  vec2 vq = (uv - 0.5) * vec2(uAspect, 1.0);
  float vr = length(vq) / length(vec2(uAspect, 1.0) * 0.5);
  float vig = uVignette + 0.25 * uPulse;
  g *= 1.0 - vig * smoothstep(0.45, 1.05, vr);
#ifdef USE_GRAIN
  g += (hash(uv * 1920.0 + fract(uTime * 7.3) * 100.0) - 0.5) * uGrain;
#endif
  g = pow(clamp(g, 0.0, 1.0), vec3(2.2));
  gl_FragColor = vec4(g, 1.0);
  #include <colorspace_fragment>
}
`;

export interface PostParams {
  exposure: number; sat: number; contrast: number; vignette: number;
  lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number];
  bloomThreshold: number; bloomStrength: number; bloomRadius: number;
  death: number; pulse: number; slow: number; time: number;
}

export class PostFX {
  enabled = false;
  bloom = false;
  dof = false;
  grain = false;
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private dofA: THREE.WebGLRenderTarget | null = null;
  private dofB: THREE.WebGLRenderTarget | null = null;
  private fsq = new FullscreenPass();
  private prefilter = passMaterial(PREFILTER, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 } });
  private down = passMaterial(DOWN, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private up = passMaterial(UP, { uTex: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
  private blur = passMaterial(BLUR, { uTex: { value: null }, uDir: { value: new THREE.Vector2() } });
  private copy = passMaterial(/* glsl */`varying vec2 vUv; uniform sampler2D uTex; void main(){ gl_FragColor = texture2D(uTex, vUv); }`, { uTex: { value: null } });
  readonly composite: THREE.ShaderMaterial;
  private w = 1; private h = 1;
  private samples = 0;

  constructor() {
    this.composite = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: COMPOSITE,
      uniforms: {
        uScene: { value: null }, uBloom: { value: null }, uDof: { value: null },
        uBloomStr: { value: 0.4 }, uTime: { value: 0 }, uVignette: { value: 0.3 }, uDeath: { value: 0 }, uPulse: { value: 0 },
        uSlow: { value: 0 }, uGrain: { value: 0.035 }, uExposure: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1 },
        uDofAmt: { value: 1 }, uAspect: { value: 1 },
        uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      },
      depthTest: false, depthWrite: false, toneMapped: true,
    });
  }

  /** The target the scene should be rendered into (null = screen). */
  get target() { return this.enabled ? this.sceneRT : null; }

  configure(enabled: boolean, bloom: boolean, dof: boolean, grain: boolean, samples: number) {
    const defs: Record<string, string> = {};
    if (bloom) defs.USE_BLOOM = '';
    if (dof) defs.USE_DOF = '';
    if (grain) defs.USE_GRAIN = '';
    const changed = this.bloom !== bloom || this.dof !== dof || this.grain !== grain;
    this.enabled = enabled; this.bloom = bloom; this.dof = dof; this.grain = grain;
    if (changed) { this.composite.defines = defs; this.composite.needsUpdate = true; }
    if (samples !== this.samples) { this.samples = samples; this.sceneRT?.dispose(); this.sceneRT = null; }
    this.alloc();
  }

  setSize(w: number, h: number) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h && this.sceneRT) return;
    this.w = w; this.h = h;
    this.alloc(true);
  }

  private alloc(force = false) {
    if (!this.enabled) return;
    const w = this.w, h = this.h;
    if (!this.sceneRT || force) {
      this.sceneRT?.dispose();
      this.sceneRT = makeRT(w, h, { depthBuffer: true, samples: this.samples });
    }
    const needBloom = this.bloom;
    if (needBloom && (this.mips.length === 0 || force)) {
      for (const r of [...this.mips, ...this.ups]) r.dispose();
      this.mips = []; this.ups = [];
      let mw = w >> 1, mh = h >> 1;
      for (let i = 0; i < 5; i++) {
        this.mips.push(makeRT(Math.max(1, mw), Math.max(1, mh)));
        this.ups.push(makeRT(Math.max(1, mw), Math.max(1, mh)));
        mw >>= 1; mh >>= 1;
      }
    }
    if (this.dof && (!this.dofA || force)) {
      this.dofA?.dispose(); this.dofB?.dispose();
      this.dofA = makeRT(w >> 1, h >> 1);
      this.dofB = makeRT(w >> 1, h >> 1);
    }
  }

  apply(r: THREE.WebGLRenderer, p: PostParams) {
    if (!this.enabled || !this.sceneRT) return;
    const src = this.sceneRT.texture;
    const cu = this.composite.uniforms;
    if (this.bloom && this.mips.length) {
      const pu = this.prefilter.uniforms;
      pu.uTex.value = src;
      (pu.uTexel.value as THREE.Vector2).set(0.5 / this.w, 0.5 / this.h);
      pu.uThreshold.value = p.bloomThreshold;
      this.fsq.render(r, this.prefilter, this.mips[0]);
      const du = this.down.uniforms;
      for (let i = 1; i < this.mips.length; i++) {
        du.uTex.value = this.mips[i - 1].texture;
        (du.uTexel.value as THREE.Vector2).set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
        this.fsq.render(r, this.down, this.mips[i]);
      }
      const uu = this.up.uniforms;
      uu.uRadius.value = 0.5 + p.bloomRadius;
      let lower = this.mips[this.mips.length - 1];
      for (let i = this.mips.length - 2; i >= 0; i--) {
        uu.uTex.value = lower.texture;
        uu.uBase.value = this.mips[i].texture;
        (uu.uTexel.value as THREE.Vector2).set(1 / lower.width, 1 / lower.height);
        this.fsq.render(r, this.up, this.ups[i]);
        lower = this.ups[i];
      }
      cu.uBloom.value = this.ups[0].texture;
    }
    if (this.dof && this.dofA && this.dofB) {
      this.copy.uniforms.uTex.value = src;
      this.fsq.render(r, this.copy, this.dofA);
      const bu = this.blur.uniforms;
      for (let it = 0; it < 2; it++) {
        bu.uTex.value = this.dofA.texture;
        (bu.uDir.value as THREE.Vector2).set((1.2 + it) / this.dofA.width, 0);
        this.fsq.render(r, this.blur, this.dofB);
        bu.uTex.value = this.dofB.texture;
        (bu.uDir.value as THREE.Vector2).set(0, (1.2 + it) / this.dofA.height);
        this.fsq.render(r, this.blur, this.dofA);
      }
      cu.uDof.value = this.dofA.texture;
    }
    cu.uScene.value = src;
    cu.uBloomStr.value = p.bloomStrength;
    cu.uTime.value = p.time;
    cu.uVignette.value = p.vignette;
    cu.uDeath.value = p.death;
    cu.uPulse.value = p.pulse;
    cu.uSlow.value = p.slow;
    cu.uExposure.value = p.exposure;
    cu.uSat.value = p.sat;
    cu.uContrast.value = p.contrast;
    cu.uAspect.value = this.w / this.h;
    (cu.uLift.value as THREE.Vector3).set(...p.lift);
    (cu.uGamma.value as THREE.Vector3).set(...p.gamma);
    (cu.uGain.value as THREE.Vector3).set(...p.gain);
    this.fsq.render(r, this.composite, null);
  }

  compile(r: THREE.WebGLRenderer) {
    const prev = r.getRenderTarget();
    for (const m of [this.prefilter, this.down, this.up, this.blur, this.copy]) this.fsq.compile(r, m);
    r.setRenderTarget(null);
    this.fsq.compile(r, this.composite);
    r.setRenderTarget(prev);
  }

  dispose() {
    this.sceneRT?.dispose();
    for (const x of [...this.mips, ...this.ups]) x.dispose();
    this.dofA?.dispose(); this.dofB?.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.blur, this.copy, this.composite]) m.dispose();
    this.fsq.dispose();
  }
}
