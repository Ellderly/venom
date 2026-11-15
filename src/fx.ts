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
      uniforms: { map: { value: tex }, uAmb: U.uAmb, uSunCol: U.uSunCol, uLit: { value: additive ? 0 : 1 }, uA: { value: additive ? 1 : 0.6 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 iPos; attribute vec4 iCol; varying vec2 vUv; varying vec4 vC;
        void main(){ vUv = position.xy*0.5+0.5; vC = iCol; vec4 mv = viewMatrix * vec4(iPos.xyz,1.0); mv.xy += position.xy * iPos.w; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uAmb, uSunCol; uniform float uLit, uA; varying vec2 vUv; varying vec4 vC;
        void main(){ float a = texture2D(map, vUv).a * vC.a * uA; vec3 c = vC.rgb * mix(vec3(1.0), uAmb*1.3 + uSunCol*0.45, uLit); gl_FragColor = vec4(sqrt(c), a); }`,
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
interface Flash { x: number; y: number; z: number; t: number; dur: number; r: number; k: number }
interface Ring { mesh: THREE.Mesh; t: number; r: number }

export class FX {
  group = new THREE.Group();
  private fire: Layer; private smoke: Layer; private emitters: Emitter[] = []; private rings: Ring[] = []; private flashes: Flash[] = [];
  private scorches: THREE.Mesh[] = []; private scorchGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2); private scorchTex: THREE.Texture;
  private ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  constructor(cap: number) {
    const tex = puffTexture();
    this.smoke = new Layer(cap, false, tex); this.fire = new Layer(Math.round(cap / 2), true, tex);
    this.group.add(this.smoke.mesh, this.fire.mesh);
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; // подпалина: тёмное пятно с рваным краем
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(8,7,6,0.95)'); gr.addColorStop(0.35, 'rgba(14,12,10,0.85)'); gr.addColorStop(0.75, 'rgba(20,18,15,0.4)'); gr.addColorStop(1, 'rgba(20,18,15,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, r = 20 + Math.random() * 40; g.strokeStyle = `rgba(10,9,8,${0.15 + Math.random() * 0.3})`; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); g.moveTo(64 + Math.cos(a) * 8, 64 + Math.sin(a) * 8); g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); g.stroke(); }
    this.scorchTex = new THREE.CanvasTexture(c);
  }
  get count() { return this.fire.n + this.smoke.n; }

  /** Взрыв боевой части. tnt — тротиловый эквивалент, кг. */
  explode(x: number, y: number, z: number, tnt: number, ground = false) {
    const s = Math.cbrt(tnt), R = Math.random, rnd = () => R() * 2 - 1;
    this.flashes.push({ x, y: y + s * 2, z, t: 0, dur: 0.9, r: s * 75, k: 5 });
    if (ground) this.scorch(x, y, z, s * 3.6);
    for (let i = 0; i < 9; i++) { const a = R() * 6.283, v = s * (3 + R() * 5); this.fire.add(x + Math.cos(a) * s, y + s * 0.5, z + Math.sin(a) * s, Math.cos(a) * v, s * (5 + R() * 6), Math.sin(a) * v, 0.9 + R() * 0.8, s * 2.4, s * 1.4, 1.0, 0.36 + R() * 0.2, 0.05, 1.3); } // вторичные клубы огня уходят вверх
    for (let i = 0; i < 16; i++) { const g = 0.035 + R() * 0.04; this.smoke.add(x + rnd() * s, y + s * (1 + R() * 2), z + rnd() * s, rnd() * 1.2, s * (2.2 + R() * 2.2), rnd() * 1.2, 9 + R() * 9, s * 2.2, s * 0.75, g, g, g, 0.25, -0.2); }   // столб дыма
    this.fire.add(x, y + s, z, 0, 0, 0, 0.14, s * 14, s * 60, 1.6, 1.4, 1.0);                       // вспышка
    for (let i = 0; i < 26; i++) { const v = s * 5 * (0.4 + R()); this.fire.add(x + rnd() * s, y + R() * s, z + rnd() * s, rnd() * v, R() * v * 1.3 + s * 2, rnd() * v, 0.5 + R() * 0.7, s * 1.6, s * 2.2, 1.0, 0.42 + R() * 0.25, 0.08, 2.2); } // огненный шар
    for (let i = 0; i < 46; i++) { const v = s * 16 * (0.3 + R()); this.fire.add(x, y + 1, z, rnd() * v, R() * v * 1.2, rnd() * v, 0.7 + R() * 1.4, 0.35 + R() * 0.3, -0.15, 1.0, 0.6, 0.2, 0.5, 14); }         // искры
    for (let i = 0; i < 34; i++) { const v = s * 3.5 * (0.3 + R()); const g = 0.06 + R() * 0.07; this.smoke.add(x + rnd() * s * 1.5, y + R() * s * 2, z + rnd() * s * 1.5, rnd() * v, R() * v * 1.6 + s * 1.5, rnd() * v, 4 + R() * 6, s * 1.6, s * 0.5, g, g, g, 0.9, -0.5); } // клуб дыма
    for (let i = 0; i < 28; i++) { const a = i / 28 * 6.283, v = s * 9 * (0.7 + R() * 0.5); const g = 0.42 + R() * 0.1; this.smoke.add(x, y + 0.8, z, Math.cos(a) * v, R() * 1.5, Math.sin(a) * v, 2.5 + R() * 2.5, s * 1.2, s * 0.9, g, g * 0.94, g * 0.84, 1.6); } // пыль по земле
    for (let i = 0; i < 30; i++) { const v = s * 9 * (0.3 + R()); this.smoke.add(x, y + 1, z, rnd() * v, R() * v * 1.4 + 4, rnd() * v, 1.6 + R() * 2, 0.5 + R() * 0.7, 0, 0.05, 0.045, 0.04, 0.2, 18); }      // обломки
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ring.position.set(x, y + 1.5, z); this.group.add(ring); this.rings.push({ mesh: ring, t: 0, r: s * 16 });
    this.emitters.push({ x, y, z, t: 0, dur: 90 + R() * 60, s, acc: 0 });
  }

  /** Подпалина на земле. Остаётся до сброса разрушений. */
  scorch(x: number, y: number, z: number, r: number) {
    const m = new THREE.Mesh(this.scorchGeo, new THREE.MeshBasicMaterial({ map: this.scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16, fog: true }));
    m.position.set(x, y + 0.15, z); m.scale.setScalar(r); m.rotation.y = Math.random() * 6.283; m.renderOrder = 5; this.group.add(m); this.scorches.push(m);
    if (this.scorches.length > 300) { const o = this.scorches.shift()!; this.group.remove(o); (o.material as THREE.Material).dispose(); }
  }

  /** Раз в кадр: четыре самых заметных источника света (вспышки, пожары) — в общие uniform-ы освещения. */
  lights(cx: number, cy: number, cz: number) {
    const cand: [number, number, number, number, number, number, number, number][] = []; // вес, x, y, z, радиус, r, g, b
    for (const f of this.flashes) { const k = f.k * Math.pow(1 - f.t / f.dur, 2.2); cand.push([k * f.r / (60 + Math.hypot(f.x - cx, f.y - cy, f.z - cz)), f.x, f.y, f.z, f.r, k, k * 0.62, k * 0.3]); }
    for (const e of this.emitters) {
      const burn = Math.max(0, 1 - e.t / (e.dur * 0.6)); if (burn <= 0) continue;
      const k = burn * (1.1 + 0.5 * Math.sin(e.t * 11 + e.x) + 0.3 * Math.sin(e.t * 23.7)), r = e.s * 24;
      cand.push([k * r / (60 + Math.hypot(e.x - cx, e.y - cy, e.z - cz)), e.x, e.y + e.s * 1.5, e.z, r, k, k * 0.42, k * 0.12]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < 4; i++) { const c = cand[i]; if (c) { U.uLP.value[i].set(c[1], c[2], c[3], c[4]); U.uLC.value[i].set(c[5], c[6], c[7]); } else { U.uLP.value[i].set(0, -1e5, 0, 1); U.uLC.value[i].set(0, 0, 0); } }
  }

  /** Облако пыли от падающих обломков. */
  dust(x: number, y: number, z: number, size: number) { const g = 0.4 + Math.random() * 0.12; this.smoke.add(x, y + size * 0.3, z, (Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4, 3 + Math.random() * 3, size, size * 0.8, g, g * 0.95, g * 0.86, 1.2); }

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
        this.smoke.add(e.x + (R() - 0.5) * e.s * 2, e.y + R() * 2, e.z + (R() - 0.5) * e.s * 2, (R() - 0.5) * 1.5, 5 + R() * 4, (R() - 0.5) * 1.5, 8 + R() * 8, e.s * 0.9, e.s * 0.32, g, g, g, 0.12, 0);
        if (R() < burn) this.fire.add(e.x + (R() - 0.5) * e.s * 2.4, e.y + R() * 1.5, e.z + (R() - 0.5) * e.s * 2.4, (R() - 0.5), 3 + R() * 4, (R() - 0.5), 0.5 + R() * 0.6, e.s * (0.6 + R() * 0.6), -e.s * 0.5, 1.0, 0.45 + R() * 0.2, 0.08, 0.4);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].t += dt; if (this.flashes[i].t >= this.flashes[i].dur) this.flashes.splice(i, 1); }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt; const k = r.t / 0.45;
      if (k >= 1) { this.group.remove(r.mesh); (r.mesh.material as THREE.Material).dispose(); this.rings.splice(i, 1); continue; }
      r.mesh.scale.setScalar(r.r * (1 - (1 - k) ** 3)); (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - k);
    }
    this.fire.update(dt, 0.6); this.smoke.update(dt, 2.2);
  }
  clear() { this.emitters.length = 0; this.flashes.length = 0; for (const m of this.scorches) { this.group.remove(m); (m.material as THREE.Material).dispose(); } this.scorches.length = 0; }
}
