// Tiny fullscreen-pass helper shared by sim / blur / post passes.
import * as THREE from 'three';

export const FSQ_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class FullscreenPass {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mesh: THREE.Mesh;
  private scene = new THREE.Scene();
  constructor() {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(r: THREE.WebGLRenderer, mat: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.mesh.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
  }
  compile(r: THREE.WebGLRenderer, mat: THREE.Material) {
    this.mesh.material = mat;
    r.compile(this.scene, this.camera);
  }
  dispose() { this.mesh.geometry.dispose(); }
}

export function passMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, any> = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: FSQ_VERT,
    fragmentShader: frag,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export function makeRT(w: number, h: number, opts: Partial<THREE.RenderTargetOptions> = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
    ...opts,
  });
}
