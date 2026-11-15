// ПВО: огневые группы на карте. Состояние группы — событие «поставлена / едет» (приходит по сети), всё остальное
// (наведение, трассеры, прожектор, расход ленты) каждый клиент считает сам. Сбивает цель только один клиент —
// «ведущий» сессии: он бросает жребий и рассылает событие, поэтому у всех игроков результат одинаковый.
import * as THREE from 'three';
import { MapData } from './map';
import { UNITS, AirDefenseDef } from './units';
import { Launch, State } from './sim';
import { FX } from './fx';

/** Группа, как она хранится на сервере: откуда и куда едет и с какого момента (x0 = x — стоит на месте). */
export interface GunRec { id: number; pid: number; by: string; unit: string; x0: number; z0: number; x: number; z: number; t: number }
export interface Target { L: Launch; s: State; eta: number }

interface Gun {
  rec: GunRec; A: AirDefenseDef; mesh: THREE.Group; mount: THREE.Object3D; barrel: THREE.Object3D; beam: THREE.Mesh; ring: THREE.Mesh;
  x: number; y: number; z: number; moving: boolean; ready: boolean; wait: number;
  target: number; aim: number; ammo: number; reload: number; shot: number; snd: number; yaw: number; pitch: number;
}
export interface GunView { id: number; by: string; x: number; y: number; z: number; r: number; moving: boolean; ready: boolean; wait: number; firing: boolean; reload: number; ammo: number; belt: number }

const TRACERS = 400, TR_SPEED = 850, TR_LEN = 40;

export class AirDefense {
  group = new THREE.Group();
  private guns = new Map<number, Gun>();
  private tr = { p: new Float32Array(TRACERS * 3), v: new Float32Array(TRACERS * 3), life: new Float32Array(TRACERS), n: 0 };
  private lines: THREE.LineSegments; private beamMat: THREE.MeshBasicMaterial; private ringGeo = new THREE.RingGeometry(0.992, 1, 96).rotateX(-Math.PI / 2);
  private v = new THREE.Vector3(); private pending = new Set<number>(); private last = 0;
  /** Показывать кольца дальности (только стороне обороны). */
  showRings = false; selected = 0;

  constructor(private map: MapData, private fx: FX, private proto: (unit: string) => THREE.Group | null) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACERS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff6a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 22; this.group.add(this.lines);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  }

  get count() { return this.guns.size; }
  /** Поставить или обновить группу по событию из сети. */
  upsert(rec: GunRec) {
    const A = UNITS[rec.unit]?.aa; if (!A || ![rec.x0, rec.z0, rec.x, rec.z, rec.t].every(Number.isFinite)) return;
    let g = this.guns.get(rec.id);
    if (!g) {
      const mesh = this.proto(rec.unit); if (!mesh) return;
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2), this.beamMat); beam.visible = false; // вершина в начале координат, раструб в +Z
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.55, depthTest: false, fog: false, side: THREE.DoubleSide })); ring.renderOrder = 29;
      this.group.add(mesh, beam, ring);
      g = { rec, A, mesh, mount: mesh.getObjectByName('mount') ?? mesh, barrel: mesh.getObjectByName('gun') ?? mesh, beam, ring, x: 0, y: 0, z: 0, moving: false, ready: false, wait: 0, target: 0, aim: 0, ammo: A.belt, reload: 0, shot: 0, snd: 0, yaw: 0, pitch: 0.3 };
      this.guns.set(rec.id, g);
    }
    g.rec = rec; g.target = 0;
  }
  remove(id: number) { const g = this.guns.get(id); if (!g) return; this.group.remove(g.mesh, g.beam, g.ring); (g.ring.material as THREE.Material).dispose(); this.guns.delete(id); if (this.selected === id) this.selected = 0; }
  clear() { for (const id of [...this.guns.keys()]) this.remove(id); this.tr.n = 0; this.pending.clear(); }
  /** Где группа сейчас (для приказа на переезд). */
  posOf(id: number) { const g = this.guns.get(id); return g ? { x: g.x, z: g.z } : null; }
  views(): GunView[] { return [...this.guns.values()].map(g => ({ id: g.rec.id, by: g.rec.by, x: g.x, y: g.y, z: g.z, r: g.A.range, moving: g.moving, ready: g.ready, wait: g.wait, firing: g.shot > 0 && g.target > 0, reload: g.reload, ammo: g.ammo, belt: g.A.belt })); }

  /** Положение по времени: свёртывание → переезд по прямой → развёртывание. */
  private place(g: Gun, now: number) {
    const r = g.rec, A = g.A, d = Math.hypot(r.x - r.x0, r.z - r.z0), tt = now - r.t, speed = UNITS[r.unit].speed;
    let k = 1, end = A.placeS; g.moving = false;
    if (d > 1) { const travel = d / speed; end = A.packS + travel + A.deployS; k = Math.min(1, Math.max(0, (tt - A.packS) / travel)); g.moving = tt > A.packS && k < 1; }
    g.x = r.x0 + (r.x - r.x0) * k; g.z = r.z0 + (r.z - r.z0) * k; g.y = this.map.surfaceAt(g.x, g.z);
    g.ready = tt >= end; g.wait = Math.max(0, end - tt);
    if (d > 1) g.mesh.rotation.y = Math.atan2(r.x - r.x0, r.z - r.z0);
  }

  /** Вероятность поражения за секунду огня. */
  static hazard(A: AirDefenseDef, dist: number, speed: number, night: number) {
    return A.pk * Math.max(0, 1 - (dist / A.range) ** 2) * Math.min(1, A.refSpeed / Math.max(1, speed)) ** 1.5 * (1 - (1 - A.nightK) * night);
  }

  /**
   * Раз в кадр. targets — цели в воздухе; lead — этот клиент решает, кто сбит (onKill рассылает событие);
   * onBurst — очередь для звука (точка, откуда стреляют).
   */
  update(dt: number, now: number, targets: Map<number, Target>, night: number, cam: THREE.Camera, lead: boolean, onKill: (launch: number, t: number, gun: number) => void, onBurst: (x: number, y: number, z: number) => void) {
    dt = Math.min(1, Math.max(0, now - this.last)) || dt; this.last = now; // по часам сессии, а не по кадру: при просадке кадров темп огня и шансы те же
    const v = this.v; this.beamMat.opacity = 0.04 + 0.1 * night;
    for (const id of this.pending) if (!targets.has(id) || targets.get(id)!.L.down) this.pending.delete(id);
    for (const g of this.guns.values()) {
      this.place(g, now); const A = g.A, my = g.y + 2.1;
      const dc = cam.position.distanceTo(v.set(g.x, g.y, g.z));
      g.mesh.position.set(g.x, g.y, g.z); g.mesh.scale.setScalar(Math.max(1, dc / 450)); // издалека пикап увеличивается, как и цели
      g.ring.visible = this.showRings; g.ring.position.set(g.x, g.y + 3, g.z); g.ring.scale.setScalar(A.range);
      (g.ring.material as THREE.MeshBasicMaterial).opacity = g.rec.id === this.selected ? 0.95 : g.ready ? 0.5 : 0.2;
      (g.ring.material as THREE.MeshBasicMaterial).color.setHex(g.rec.id === this.selected ? 0xffffff : 0x4aa8ff);
      // цель: держим прежнюю, пока она в зоне; иначе — ближайшая
      const inZone = (t: Target | undefined) => !!t && !t.L.down && t.eta > 0.3 && t.s.y - my > 20 && (t.s.x - g.x) ** 2 + (t.s.y - my) ** 2 + (t.s.z - g.z) ** 2 < A.range * A.range;
      let t = g.ready ? targets.get(g.target) : undefined;
      if (!g.ready || !inZone(t)) {
        t = undefined; g.target = 0; let best = 1e12;
        if (g.ready) for (const c of targets.values()) { if (!inZone(c)) continue; const d = (c.s.x - g.x) ** 2 + (c.s.y - my) ** 2 + (c.s.z - g.z) ** 2; if (d < best) { best = d; t = c; } }
        if (t) { g.target = t.L.id; g.aim = A.aimS; }
      }
      g.reload = Math.max(0, g.reload - dt); if (g.reload === 0 && g.ammo <= 0) g.ammo = A.belt;
      g.beam.visible = false; g.shot = 0;
      if (!t) { g.pitch += (0.3 - g.pitch) * Math.min(1, dt * 2); this.pose(g); continue; }
      // упреждение: туда, где цель будет, когда долетит пуля
      const d0 = Math.hypot(t.s.x - g.x, t.s.y - my, t.s.z - g.z), tof = d0 / TR_SPEED;
      const ax = t.s.x + t.s.vx * tof - g.x, ay = t.s.y + t.s.vy * tof - my, az = t.s.z + t.s.vz * tof - g.z, al = Math.hypot(ax, ay, az) || 1;
      const yaw = Math.atan2(ax, az), pitch = Math.asin(ay / al), k = Math.min(1, dt * 6);
      g.yaw += Math.atan2(Math.sin(yaw - g.yaw), Math.cos(yaw - g.yaw)) * k; g.pitch += (pitch - g.pitch) * k; this.pose(g);
      if (night > 0.3) { // прожектор ведёт цель
        g.beam.visible = true; g.beam.position.set(g.x, my + 0.4, g.z); g.beam.lookAt(t.s.x, t.s.y, t.s.z); g.beam.scale.set(d0 * 0.006, d0 * 0.006, d0 * 1.05);
      }
      g.aim = Math.max(0, g.aim - dt); if (g.aim > 0 || g.reload > 0) continue;
      // огонь: расход ленты, трассеры, звук очередями
      g.shot = 1; g.ammo -= A.rof * dt; if (g.ammo <= 0) g.reload = A.reloadS;
      const cy = Math.cos(g.pitch), dx = Math.sin(g.yaw) * cy, dy = Math.sin(g.pitch), dz = Math.cos(g.yaw) * cy;
      g.snd -= dt; if (g.snd <= 0) { g.snd = 1; onBurst(g.x, my, g.z); }
      for (let n = Math.floor(Math.random() + dt * 5); n > 0; n--) this.tracer(g.x + dx * 2, my + dy * 2, g.z + dz * 2, dx, dy, dz, d0);
      if (Math.random() < dt * 14) this.fx.muzzle(g.x + dx * 2.2, my + dy * 2.2, g.z + dz * 2.2, g.mesh.scale.x);
      if (lead && t.eta > 1 && !this.pending.has(t.L.id) && Math.random() < AirDefense.hazard(A, d0, Math.hypot(t.s.vx, t.s.vy, t.s.vz), night) * dt) {
        this.pending.add(t.L.id); onKill(t.L.id, now - t.L.t0, g.rec.id);
      }
    }
    this.flyTracers(dt);
  }
  private pose(g: Gun) { g.mount.rotation.y = g.yaw - g.mesh.rotation.y; g.barrel.rotation.x = -g.pitch; }

  private tracer(x: number, y: number, z: number, dx: number, dy: number, dz: number, dist: number) {
    const T = this.tr, i = T.n < TRACERS ? T.n++ : (Math.random() * TRACERS) | 0, sp = 0.012; // разброс очереди
    dx += (Math.random() - 0.5) * sp; dy += (Math.random() - 0.5) * sp; dz += (Math.random() - 0.5) * sp;
    T.p[i * 3] = x; T.p[i * 3 + 1] = y; T.p[i * 3 + 2] = z; T.v[i * 3] = dx * TR_SPEED; T.v[i * 3 + 1] = dy * TR_SPEED; T.v[i * 3 + 2] = dz * TR_SPEED;
    T.life[i] = (dist + 250 + Math.random() * 500) / TR_SPEED; // трассер гаснет немного за целью
  }
  private flyTracers(dt: number) {
    const T = this.tr, a = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute, P = a.array as Float32Array;
    for (let i = 0; i < T.n; i++) {
      T.life[i] -= dt;
      if (T.life[i] <= 0) { const j = --T.n; for (let k = 0; k < 3; k++) { T.p[i * 3 + k] = T.p[j * 3 + k]; T.v[i * 3 + k] = T.v[j * 3 + k]; } T.life[i] = T.life[j]; i--; continue; }
      T.v[i * 3 + 1] -= 9.8 * dt;
      for (let k = 0; k < 3; k++) { T.p[i * 3 + k] += T.v[i * 3 + k] * dt; P[i * 6 + k] = T.p[i * 3 + k]; P[i * 6 + 3 + k] = T.p[i * 3 + k] - T.v[i * 3 + k] * (TR_LEN / TR_SPEED); }
    }
    this.lines.geometry.setDrawRange(0, T.n * 2); a.needsUpdate = true;
  }
}
