// Частицы и эффекты взрыва. Один буфер инстансов на «огонь» (аддитивный) и один на «дым».
import * as THREE from 'three';
import { U } from './env';

function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out'; // рваные края
  for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r = 34 + Math.random() * 26, s = 8 + Math.random() * 14; const h = g.createRadialGradient(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0, 64 + Math.cos(a) * r, 64 + Math.sin(a) * r, s); h.addColorStop(0, 'rgba(0,0,0,0.5)'); h.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = h; g.fillRect(0, 0, 128, 128); }
  return new THREE.CanvasTexture(c);
}

class Layer {
  n = 0; mesh: THREE.Mesh;
  p: Float32Array; v: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; grow: Float32Array; col: Float32Array; drag: Float32Array; grav: Float32Array;
  private aPos: THREE.InstancedBufferAttribute; private aCol: THREE.InstancedBufferAttribute;
  constructor(public cap: number, additive: boolean, tex: THREE.Texture) {
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.size = new Float32Array(cap); this.grow = new Float32Array(cap); this.col = new Float32Array(cap * 3); this.drag = new Float32Array(cap); this.grav = new Float32Array(cap);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aCol.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iCol', this.aCol);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uAmb: U.uAmb, uSunCol: U.uSunCol, uLit: { value: additive ? 0 : 1 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 iPos; attribute vec4 iCol; varying vec2 vUv; varying vec4 vC;
        void main(){ vUv = position.xy*0.5+0.5; vC = iCol; vec4 mv = viewMatrix * vec4(iPos.xyz,1.0); mv.xy += position.xy * iPos.w; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uAmb, uSunCol; uniform float uLit; varying vec2 vUv; varying vec4 vC;
        void main(){ float a = texture2D(map, vUv).a * vC.a; vec3 c = vC.rgb * mix(vec3(1.0), uAmb*1.3 + uSunCol*0.45, uLit); gl_FragColor = vec4(sqrt(c), a); }`,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 21 : 20;
  }
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, r: number, g: number, b: number, drag = 1, grav = 0) {
    if (this.n >= this.cap) { // буфер полон — вытесняем самую старую долю
      let k = 0, best = 1e9; for (let i = 0; i < 16; i++) { const j = (Math.random() * this.n) | 0; if (this.life[j] < best) { best = this.life[j]; k = j; } } this.kill(k);
    }
    const i = this.n++; this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = life; this.size[i] = size; this.grow[i] = grow; this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.drag[i] = drag; this.grav[i] = grav;
  }
  private kill(i: number) {
    const j = --this.n; if (i === j) return;
    for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[j * 3 + k]; this.v[i * 3 + k] = this.v[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
    this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j]; this.grow[i] = this.grow[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
  }
  update(dt: number, wind: number) {
    const P = this.aPos.array as Float32Array, C = this.aCol.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt; if (this.life[i] <= 0) { this.kill(i); i--; continue; }
      const d = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] = this.v[i * 3] * d + wind * dt * (1 - this.grav[i] * 0.1); this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt; this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const k = this.life[i] / this.max[i], a = Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12);
      P[i * 4] = this.p[i * 3]; P[i * 4 + 1] = this.p[i * 3 + 1]; P[i * 4 + 2] = this.p[i * 3 + 2]; P[i * 4 + 3] = this.size[i];
      C[i * 4] = this.col[i * 3]; C[i * 4 + 1] = this.col[i * 3 + 1]; C[i * 4 + 2] = this.col[i * 3 + 2]; C[i * 4 + 3] = a;
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.n;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true;
  }
}

interface Emitter { x: number; y: number; z: number; t: number; dur: number; s: number; acc: number }
interface Ring { mesh: THREE.Mesh; t: number; r: number }

export class FX {
  group = new THREE.Group();
  private fire: Layer; private smoke: Layer; private emitters: Emitter[] = []; private rings: Ring[] = [];
  private ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  constructor(cap: number) {
    const tex = puffTexture();
    this.smoke = new Layer(cap, false, tex); this.fire = new Layer(Math.round(cap / 2), true, tex);
    this.group.add(this.smoke.mesh, this.fire.mesh);
  }
  get count() { return this.fire.n + this.smoke.n; }

  /** Взрыв боевой части. tnt — тротиловый эквивалент, кг. */
  explode(x: number, y: number, z: number, tnt: number) {
    const s = Math.cbrt(tnt), R = Math.random, rnd = () => R() * 2 - 1;
    this.fire.add(x, y + s, z, 0, 0, 0, 0.14, s * 14, s * 60, 1.6, 1.4, 1.0);                       // вспышка
    for (let i = 0; i < 26; i++) { const v = s * 5 * (0.4 + R()); this.fire.add(x + rnd() * s, y + R() * s, z + rnd() * s, rnd() * v, R() * v * 1.3 + s * 2, rnd() * v, 0.5 + R() * 0.7, s * 1.6, s * 2.2, 1.0, 0.42 + R() * 0.25, 0.08, 2.2); } // огненный шар
    for (let i = 0; i < 46; i++) { const v = s * 16 * (0.3 + R()); this.fire.add(x, y + 1, z, rnd() * v, R() * v * 1.2, rnd() * v, 0.7 + R() * 1.4, 0.35 + R() * 0.3, -0.15, 1.0, 0.6, 0.2, 0.5, 14); }         // искры
    for (let i = 0; i < 34; i++) { const v = s * 3.5 * (0.3 + R()); const g = 0.06 + R() * 0.07; this.smoke.add(x + rnd() * s * 1.5, y + R() * s * 2, z + rnd() * s * 1.5, rnd() * v, R() * v * 1.6 + s * 1.5, rnd() * v, 5 + R() * 9, s * 2.2, s * 1.1, g, g, g, 0.9, -0.5); } // клуб дыма
    for (let i = 0; i < 28; i++) { const a = i / 28 * 6.283, v = s * 9 * (0.7 + R() * 0.5); const g = 0.42 + R() * 0.1; this.smoke.add(x, y + 0.8, z, Math.cos(a) * v, R() * 1.5, Math.sin(a) * v, 3 + R() * 3, s * 1.5, s * 1.6, g, g * 0.94, g * 0.84, 1.6); } // пыль по земле
    for (let i = 0; i < 30; i++) { const v = s * 9 * (0.3 + R()); this.smoke.add(x, y + 1, z, rnd() * v, R() * v * 1.4 + 4, rnd() * v, 1.6 + R() * 2, 0.5 + R() * 0.7, 0, 0.05, 0.045, 0.04, 0.2, 18); }      // обломки
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ring.position.set(x, y + 1.5, z); this.group.add(ring); this.rings.push({ mesh: ring, t: 0, r: s * 28 });
    this.emitters.push({ x, y, z, t: 0, dur: 90 + R() * 60, s, acc: 0 });
  }

  /** Дым без взрыва — для уже повреждённых зданий при подключении к сессии. */
  smolder(x: number, y: number, z: number, tnt: number) { this.emitters.push({ x, y, z, t: 25, dur: 80, s: Math.cbrt(tnt), acc: 0 }); }

  update(dt: number) {
    const R = Math.random;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]; e.t += dt; if (e.t > e.dur) { this.emitters.splice(i, 1); continue; }
      const k = 1 - e.t / e.dur, burn = Math.max(0, 1 - e.t / (e.dur * 0.6));
      e.acc += dt * (3 + 7 * k);
      while (e.acc > 1) {
        e.acc -= 1; const g = 0.05 + R() * 0.06 + (1 - burn) * 0.12;
        this.smoke.add(e.x + (R() - 0.5) * e.s * 2, e.y + R() * 2, e.z + (R() - 0.5) * e.s * 2, (R() - 0.5) * 1.5, 5 + R() * 4, (R() - 0.5) * 1.5, 9 + R() * 9, e.s * 1.3, e.s * 0.75, g, g, g, 0.12, 0);
        if (R() < burn) this.fire.add(e.x + (R() - 0.5) * e.s * 2.4, e.y + R() * 1.5, e.z + (R() - 0.5) * e.s * 2.4, (R() - 0.5), 3 + R() * 4, (R() - 0.5), 0.5 + R() * 0.6, e.s * (0.6 + R() * 0.6), -e.s * 0.5, 1.0, 0.45 + R() * 0.2, 0.08, 0.4);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt; const k = r.t / 0.9;
      if (k >= 1) { this.group.remove(r.mesh); (r.mesh.material as THREE.Material).dispose(); this.rings.splice(i, 1); continue; }
      r.mesh.scale.setScalar(r.r * (1 - (1 - k) ** 3)); (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
    }
    this.fire.update(dt, 0.6); this.smoke.update(dt, 2.2);
  }
  clear() { this.emitters.length = 0; }
}
