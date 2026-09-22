// Real THREE lights + a procedural PMREM sky environment per biome (Z-up world).
import * as THREE from 'three';
import type { BiomeVisual } from './biomeVisuals';
import { lin } from './biomeVisuals';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uNadir, uGlow, uSun;
float h12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 d = normalize(vDir);
  float z = d.z;
  vec3 c = z > 0.0 ? mix(uHorizon, uZenith, pow(z, 0.55)) : mix(uHorizon, uNadir, pow(-z, 0.4));
  float s = max(dot(d, normalize(uSun)), 0.0);
  c += uGlow * (pow(s, 600.0) * 40.0 + pow(s, 12.0) * 0.8);
  // soft clouds / canopy breakup so reflections aren't flat
  if (z > 0.0) {
    vec2 uv = d.xy / (z + 0.25) * 2.0;
    float cl = vn(uv) * 0.6 + vn(uv * 2.3) * 0.4;
    c = mix(c, uHorizon * 1.25 + 0.15, smoothstep(0.55, 0.85, cl) * 0.5 * (1.0 - z * 0.5));
  }
  // bright window strip for a pleasing specular stripe on the snake
  float strip = (1.0 - smoothstep(0.0, 0.1, abs(d.x + d.y * 0.3 + 0.2))) * smoothstep(0.2, 0.6, z);
  c += uGlow * strip * 0.6;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private skyMat: THREE.ShaderMaterial;
  private skyMesh: THREE.Mesh;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.hemi.position.set(0, 0, 1);
    scene.add(this.sun, this.sun.target, this.hemi);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uNadir: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() },
      },
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.skyMat);
    this.skyScene.add(this.skyMesh);
  }

  setBiome(v: BiomeVisual, scene: THREE.Scene) {
    const u = this.skyMat.uniforms;
    (u.uZenith.value as THREE.Color).copy(lin(v.env.zenith));
    (u.uHorizon.value as THREE.Color).copy(lin(v.env.horizon));
    (u.uNadir.value as THREE.Color).copy(lin(v.env.nadir));
    (u.uGlow.value as THREE.Color).copy(lin(v.env.sunGlow));
    (u.uSun.value as THREE.Vector3).set(...v.sunDir);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.skyScene, 0.02);
    scene.environment = this.envRT.texture;
    old?.dispose();
    scene.environmentIntensity = v.id === 'svartsandur' ? 0.6 : 1.0;
  }

  /** Mirror LIGHT uniforms into real lights; centre = board centre. */
  sync(sunDir: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color, ground: THREE.Color, cx: number, cy: number) {
    // sunColor holds colour × intensity; split into colour and intensity for THREE
    const m = Math.max(sunColor.r, sunColor.g, sunColor.b, 1e-4);
    this.sun.color.setRGB(sunColor.r / m, sunColor.g / m, sunColor.b / m);
    this.sun.intensity = m * 1.0;
    this.sun.position.set(cx + sunDir.x * 40, cy + sunDir.y * 40, sunDir.z * 40);
    this.sun.target.position.set(cx, cy, 0);
    this.sun.target.updateMatrixWorld();
    const ms = Math.max(sky.r, sky.g, sky.b, 1e-4);
    this.hemi.color.setRGB(sky.r / ms, sky.g / ms, sky.b / ms);
    const mg = Math.max(ground.r, ground.g, ground.b, 1e-4);
    this.hemi.groundColor.setRGB(ground.r / mg, ground.g / mg, ground.b / mg);
    this.hemi.intensity = (ms + mg) * 0.5 * 1.2;
  }

  dispose() {
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.skyMat.dispose();
    this.skyMesh.geometry.dispose();
  }
}
