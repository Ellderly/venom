// Постобработка: сглаживание (MSAA) и свечение ярких источников — окон, взрывов, пожаров, фонарей.
import * as THREE from 'three';
import { U } from './env';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const pass = (fs: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });

export class Post {
  private main: THREE.WebGLRenderTarget; private a: THREE.WebGLRenderTarget[] = []; private b: THREE.WebGLRenderTarget[] = [];
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); private scene = new THREE.Scene();
  private bright = pass(`uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(0.94, 1.0, l), 1.0); }`, { t: { value: null } });
  private blur = pass(`uniform sampler2D t; uniform vec2 d; varying vec2 vUv;
    void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227; c += (texture2D(t, vUv + d * 1.385).rgb + texture2D(t, vUv - d * 1.385).rgb) * 0.316; c += (texture2D(t, vUv + d * 3.231).rgb + texture2D(t, vUv - d * 3.231).rgb) * 0.070; gl_FragColor = vec4(c, 1.0); }`, { t: { value: null }, d: { value: new THREE.Vector2() } });
  private comp = pass(`uniform sampler2D t, b0, b1, b2; uniform float k; varying vec2 vUv;
    void main(){ vec3 c = texture2D(t, vUv).rgb; vec3 g = texture2D(b0, vUv).rgb * 0.5 + texture2D(b1, vUv).rgb * 0.35 + texture2D(b2, vUv).rgb * 0.3;
      c += g * k; vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.22; gl_FragColor = vec4(c, 1.0); }`, { t: { value: null }, b0: { value: null }, b1: { value: null }, b2: { value: null }, k: { value: 1 } });

  constructor(private r: THREE.WebGLRenderer, samples: number, private bloom: boolean) {
    this.main = new THREE.WebGLRenderTarget(4, 4, { samples, depthBuffer: true });
    for (let i = 0; i < 3; i++) { this.a.push(new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false })); this.b.push(new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false })); }
    this.scene.add(this.quad); this.quad.frustumCulled = false;
  }
  resize() {
    const s = this.r.getDrawingBufferSize(new THREE.Vector2()); this.main.setSize(s.x, s.y);
    for (let i = 0; i < 3; i++) { const w = Math.max(2, s.x >> (i + 1)), h = Math.max(2, s.y >> (i + 1)); this.a[i].setSize(w, h); this.b[i].setSize(w, h); }
  }
  private draw(m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) { this.quad.material = m; this.r.setRenderTarget(to); this.r.render(this.scene, this.cam); }

  render(scene: THREE.Scene, cam: THREE.Camera) {
    const r = this.r;
    r.setRenderTarget(this.main); r.render(scene, cam);
    if (this.bloom) {
      let src: THREE.Texture = this.main.texture;
      for (let i = 0; i < 3; i++) { // яркие области → три уровня размытия
        if (i === 0) { this.bright.uniforms.t.value = src; this.draw(this.bright, this.b[0]); src = this.b[0].texture; }
        this.blur.uniforms.t.value = src; this.blur.uniforms.d.value.set(1 / this.a[i].width, 0); this.draw(this.blur, this.a[i]);
        this.blur.uniforms.t.value = this.a[i].texture; this.blur.uniforms.d.value.set(0, 1 / this.a[i].height); this.draw(this.blur, this.b[i]);
        src = this.b[i].texture;
      }
    }
    const u = this.comp.uniforms; u.t.value = this.main.texture; u.b0.value = this.b[0].texture; u.b1.value = this.b[1].texture; u.b2.value = this.b[2].texture; u.k.value = this.bloom ? 0.4 + 0.8 * U.uNight.value : 0; // днём свечение почти незаметно
    this.draw(this.comp, null);
  }
}
