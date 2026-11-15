// Камера как в градостроительных симуляторах: точка на земле + дистанция, поворот, наклон.
import * as THREE from 'three';
import { MapData } from './map';
import { S } from './settings';

export class CityCamera {
  cam = new THREE.PerspectiveCamera(45, 1, 1, 100000);
  tx = 0; tz = 0; dist = 2600; yaw = 0.5; pitch = 0.75;         // целевые значения
  private sx = 0; private sz = 0; private sd = 2600; private syaw = 0.5; private sp = 0.75; private sy = 100; // сглаженные
  private keys = new Set<string>();
  private drag: { btn: number; x: number; y: number; moved: number } | null = null;
  follow: (() => THREE.Vector3 | null) | null = null;
  shake = 0;
  locked = false; // открыто окно или карта — клавиши камеры не действуют
  get yawNow() { return this.syaw; }
  onClick: ((x: number, y: number) => void) | null = null;
  readonly MIN = 25; readonly MAX = 90000;

  constructor(private el: HTMLElement, private map: MapData) {
    window.addEventListener('keydown', e => { if ((e.target as HTMLElement).tagName !== 'INPUT' && !this.locked) this.keys.add(e.code); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { this.drag = { btn: e.button, x: e.clientX, y: e.clientY, moved: 0 }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      const d = this.drag; if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.btn === 0) { // перетаскивание карты
        if (d.moved < 5) return;
        const k = this.dist * 0.0016; this.follow = null;
        this.tx -= (Math.cos(this.yaw) * dx + Math.sin(this.yaw) * dy) * k; this.tz -= (-Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dy) * k;
      } else { this.yaw -= dx * 0.005; this.pitch = Math.min(1.55, Math.max(0.08, this.pitch + dy * 0.004)); }
    });
    el.addEventListener('pointerup', e => { const d = this.drag; this.drag = null; if (d && d.btn === 0 && d.moved < 5) this.onClick?.(e.clientX, e.clientY); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022), nd = Math.min(this.MAX, Math.max(this.MIN, this.dist * f));
      const p = this.follow ? null : this.pick(e.clientX, e.clientY); // зум к точке под курсором
      if (p) { const k = 1 - nd / this.dist; this.tx += (p.x - this.tx) * k; this.tz += (p.z - this.tz) * k; }
      this.dist = nd;
    }, { passive: false });
  }

  resize(w: number, h: number) { this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }

  /** Луч из точки экрана до пересечения с рельефом. */
  pick(px: number, py: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect();
    const o = this.cam.position, d = new THREE.Vector3((px - r.left) / r.width * 2 - 1, -(py - r.top) / r.height * 2 + 1, 0.5).unproject(this.cam).sub(o).normalize();
    if (d.y >= -0.001) return null;
    const p = new THREE.Vector3(); let t = 0, prev = 0;
    const tmax = Math.min(400000, (o.y - this.map.meta.hmin + 5) / -d.y);
    for (let i = 0; i < 400; i++) {
      p.copy(o).addScaledVector(d, t);
      const g = this.map.heightAt(p.x, p.z);
      if (p.y <= g) { let a = prev, b = t; for (let k = 0; k < 12; k++) { const m = (a + b) / 2; p.copy(o).addScaledVector(d, m); if (p.y > this.map.heightAt(p.x, p.z)) a = m; else b = m; } return p; }
      if (t >= tmax) break;
      prev = t; t = Math.min(tmax, t + Math.max(4, (p.y - g) * 0.5));
    }
    return null;
  }

  flyTo(x: number, z: number, dist?: number) { this.tx = x; this.tz = z; if (dist) this.dist = dist; this.follow = null; }

  update(dt: number) {
    const ks = this.keys, K = S.keys, k = { has: (a: string) => ks.has(K[a]) };
    const sp = this.dist * 1.1 * dt * (k.has('fast') ? 2.5 : 1);
    let mx = 0, mz = 0;
    if (k.has('fwd') || ks.has('ArrowUp')) mz -= 1; if (k.has('back') || ks.has('ArrowDown')) mz += 1;
    if (k.has('left') || ks.has('ArrowLeft')) mx -= 1; if (k.has('right') || ks.has('ArrowRight')) mx += 1;
    if (mx || mz) { this.follow = null; this.tx += (Math.cos(this.yaw) * mx + Math.sin(this.yaw) * mz) * sp; this.tz += (-Math.sin(this.yaw) * mx + Math.cos(this.yaw) * mz) * sp; }
    if (k.has('rotL')) this.yaw += dt * 1.4; if (k.has('rotR')) this.yaw -= dt * 1.4;
    if (k.has('tiltUp')) this.pitch = Math.min(1.55, this.pitch + dt); if (k.has('tiltDown')) this.pitch = Math.max(0.08, this.pitch - dt);
    if (k.has('zoomIn')) this.dist = Math.max(this.MIN, this.dist * Math.exp(-dt * 1.8)); if (k.has('zoomOut')) this.dist = Math.min(this.MAX, this.dist * Math.exp(dt * 1.8));
    const m = this.map.meta; let ty: number | null = null;
    const f = this.follow?.();
    if (f) { this.tx = f.x; this.tz = f.z; ty = f.y; } else if (this.follow) this.follow = null;
    this.tx = Math.min(m.x1 + 30000, Math.max(m.x0 - 30000, this.tx)); this.tz = Math.min(m.z1 + 30000, Math.max(m.z0 - 30000, this.tz));
    const a = 1 - Math.exp(-dt * (f ? 30 : 12));
    this.sx += (this.tx - this.sx) * a; this.sz += (this.tz - this.sz) * a; this.sd += (this.dist - this.sd) * a;
    this.syaw += (this.yaw - this.syaw) * a; this.sp += (this.pitch - this.sp) * a;
    this.sy += ((ty ?? this.map.heightAt(this.sx, this.sz)) - this.sy) * a;
    const c = this.cam, ch = Math.cos(this.sp) * this.sd;
    c.position.set(this.sx + Math.sin(this.syaw) * ch, this.sy + Math.sin(this.sp) * this.sd, this.sz + Math.cos(this.syaw) * ch);
    const minY = this.map.heightAt(c.position.x, c.position.z) + 3; if (c.position.y < minY) c.position.y = minY;
    c.lookAt(this.sx, this.sy, this.sz);
    if (this.shake > 0.001) { c.position.x += (Math.random() - 0.5) * this.shake; c.position.y += (Math.random() - 0.5) * this.shake; c.rotateZ((Math.random() - 0.5) * this.shake * 0.004); this.shake *= Math.exp(-dt * 5); }
    c.near = Math.max(0.5, this.sd * 0.02); c.far = Math.max(80000, this.sd * 8); c.updateProjectionMatrix(); c.updateMatrixWorld();
  }
  get target() { return { x: this.sx, y: this.sy, z: this.sz, dist: this.sd }; }
}
