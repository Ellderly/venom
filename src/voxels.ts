// Разрушения. Здание остаётся обычной геометрией тайла, пока рядом не взорвалось; тогда оно
// превращается в сетку кубиков, взрыв вырезает в ней полость, а всё, что потеряло опору, падает.
import * as THREE from 'three';
import { MapData } from './map';
import { FX } from './fx';
import { WALLS, ROOFS, hash } from './palette';

interface Vox {
  b: number; ox: number; oz: number; cos: number; sin: number; base: number;
  s: number; sy: number; nx: number; ny: number; nz: number; x0: number; z0: number;
  cells: Uint8Array;          // 0 пусто, 1 целый, 2 закопчённый
  total: number; left: number; mesh: THREE.Mesh; wall: number[]; roof: number[]; seed: number;
}

function hash3(x: number, y: number, z: number) { let n = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }


export class Destruction {
  group = new THREE.Group();
  private vox = new Map<number, Vox>();
  // обломки: один InstancedMesh, кольцевой буфер
  private deb: THREE.InstancedMesh; private dN = 0; private dHead = 0;
  private dp: Float32Array; private dv: Float32Array; private dr: Float32Array; private dw: Float32Array; private ds: Float32Array; private dLive: Uint8Array;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(); private col = new THREE.Color();
  private active = 0;

  constructor(private map: MapData, private mat: THREE.Material, private fx: FX, private voxel: number, private cap: number) {
    this.deb = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), cap);
    this.deb.count = 0; this.deb.frustumCulled = false; this.deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(this.deb);
    this.dp = new Float32Array(cap * 3); this.dv = new Float32Array(cap * 3); this.dr = new Float32Array(cap * 3); this.dw = new Float32Array(cap * 3); this.ds = new Float32Array(cap); this.dLive = new Uint8Array(cap);
    map.solid = (b, x, y, z) => { const v = this.vox.get(b); return v ? this.solidAt(v, x, y, z) : null; };
  }
  get voxelized() { return this.vox.size; }
  get debris() { return this.active; }
  has(b: number) { return this.vox.has(b); }

  private toLocal(v: Vox, x: number, z: number): [number, number] { const dx = x - v.ox, dz = z - v.oz; return [dx * v.cos + dz * v.sin, -dx * v.sin + dz * v.cos]; }
  private solidAt(v: Vox, x: number, y: number, z: number) {
    const [lx, lz] = this.toLocal(v, x, z), i = Math.floor((lx - v.x0) / v.s), k = Math.floor((lz - v.z0) / v.s), j = Math.floor((y - v.base) / v.sy);
    if (i < 0 || k < 0 || i >= v.nx || k >= v.nz || j >= v.ny) return false;
    return j < 0 ? true : v.cells[(j * v.nz + k) * v.nx + i] > 0;
  }

  private voxelize(b: number): Vox {
    const mp = this.map, a = mp.bStart[b], n = mp.bStart[b + 1] - a, p = mp.bPts, h = mp.bH[b] / 10;
    const [ox, oz] = mp.bCenter(b);
    // сетка ориентируется вдоль самой длинной стены — прямоугольные дома превращаются в кубики без «лесенки»
    let best = 0, ang = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = p[(a + j) * 2] - p[(a + i) * 2], dz = p[(a + j) * 2 + 1] - p[(a + i) * 2 + 1], l = dx * dx + dz * dz; if (l > best) { best = l; ang = Math.atan2(dz, dx); } }
    const cos = Math.cos(ang), sin = Math.sin(ang), loc = new Float32Array(n * 2);
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, area = 0;
    for (let i = 0; i < n; i++) { const dx = p[(a + i) * 2] - ox, dz = p[(a + i) * 2 + 1] - oz, lx = dx * cos + dz * sin, lz = -dx * sin + dz * cos; loc[i * 2] = lx; loc[i * 2 + 1] = lz; x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += loc[i * 2] * loc[j * 2 + 1] - loc[j * 2] * loc[i * 2 + 1]; }
    const s = Math.max(this.voxel, Math.cbrt(Math.abs(area / 2) * h / 70000)); // очень большие здания — кубики крупнее
    const nx = Math.max(1, Math.round((x1 - x0) / s)), nz = Math.max(1, Math.round((z1 - z0) / s)), ny = Math.max(1, Math.round(h / s)), sy = h / ny;
    const cells = new Uint8Array(nx * ny * nz); let total = 0;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * (x1 - x0) / nx, z = z0 + (k + 0.5) * (z1 - z0) / nz; let inside = false;
      for (let c = 0, d = n - 1; c < n; d = c++) { const xi = loc[c * 2], zi = loc[c * 2 + 1], xj = loc[d * 2], zj = loc[d * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside; }
      if (inside) { for (let j = 0; j < ny; j++) cells[(j * nz + k) * nx + i] = 1; total += ny; }
    }
    const hs = hash(b + 1), t = mp.bType[b], w = WALLS[t][hs % WALLS[t].length], rf = ROOFS[t][(hs >>> 8) % ROOFS[t].length], sh = 0.92 + ((hs >>> 16) % 16) / 100;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat); mesh.frustumCulled = false; this.group.add(mesh);
    const v: Vox = { b, ox, oz, cos, sin, base: mp.heightAt(ox, oz), s: (x1 - x0) / nx, sy, nx, ny, nz, x0, z0, cells, total, left: total, mesh,
      wall: [w[0] * sh, w[1] * sh, w[2] * sh], roof: rf, seed: 1 + hs % 254 };
    (v as any).sz = (z1 - z0) / nz;
    this.vox.set(b, v); return v;
  }

  /** Строит геометрию только из наружных граней. */
  private remesh(v: Vox) {
    const { nx, ny, nz, cells, s, sy } = v, sz = (v as any).sz as number;
    const pos: number[] = [], uv: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
    const at = (i: number, j: number, k: number) => i < 0 || k < 0 || j < 0 || i >= nx || k >= nz || j >= ny ? 0 : cells[(j * nz + k) * nx + i];
    const world = (lx: number, lz: number) => [v.ox + lx * v.cos - lz * v.sin, v.oz + lx * v.sin + lz * v.cos];
    // грань: 4 угла в локальных координатах, нормаль (локальная), признаки
    const face = (c: number[][], nl: number[], kind: number, soot: number, i: number, j: number, k: number) => {
      const base = pos.length / 3, nw = [nl[0] * v.cos - nl[2] * v.sin, nl[1], nl[0] * v.sin + nl[2] * v.cos];
      const r = 0.85 + 0.3 * hash3(i, j, k), dark = 1 - 0.8 * soot;
      for (const q of c) {
        const [wx, wz] = world(q[0], q[2]); pos.push(wx, v.base + q[1], wz);
        uv.push(nl[0] !== 0 ? q[2] : q[0], q[1]); nrm.push(Math.round(nw[0] * 127), Math.round(nw[1] * 127), Math.round(nw[2] * 127), 0);
        if (kind === 0) col.push(v.wall[0] * dark, v.wall[1] * dark, v.wall[2] * dark, soot > 0.3 ? 0 : v.seed);     // фасад с окнами
        else if (kind === 1) col.push(v.roof[0] * dark, v.roof[1] * dark, v.roof[2] * dark, 255);                    // крыша
        else col.push(118 * r * dark, 112 * r * dark, 104 * r * dark, 0);                                             // излом: бетон и кирпич
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = cells[(j * nz + k) * nx + i]; if (!c) continue;
      const xa = v.x0 + i * s, xb = xa + s, za = v.z0 + k * sz, zb = za + sz, ya = j === 0 ? -3 : j * sy, yb = (j + 1) * sy, soot = c === 2 ? 0.75 : 0;
      // наружная грань исходного здания — фасад; грань, открывшаяся после взрыва, — излом
      const side = (di: number, dk: number) => { const ii = i + di, kk = k + dk; return ii < 0 || kk < 0 || ii >= nx || kk >= nz || !this.wasSolid(v, ii, kk) ? 0 : 2; };
      if (!at(i + 1, j, k)) face([[xb, ya, za], [xb, ya, zb], [xb, yb, zb], [xb, yb, za]], [1, 0, 0], side(1, 0), soot, i, j, k);
      if (!at(i - 1, j, k)) face([[xa, ya, zb], [xa, ya, za], [xa, yb, za], [xa, yb, zb]], [-1, 0, 0], side(-1, 0), soot, i, j, k);
      if (!at(i, j, k + 1)) face([[xb, ya, zb], [xa, ya, zb], [xa, yb, zb], [xb, yb, zb]], [0, 0, 1], side(0, 1), soot, i, j, k);
      if (!at(i, j, k - 1)) face([[xa, ya, za], [xb, ya, za], [xb, yb, za], [xa, yb, za]], [0, 0, -1], side(0, -1), soot, i, j, k);
      if (!at(i, j + 1, k)) face([[xa, yb, za], [xb, yb, za], [xb, yb, zb], [xa, yb, zb]], [0, 1, 0], j === ny - 1 ? 1 : 2, soot, i, j, k);
    }
    const g = v.mesh.geometry; g.dispose(); const ng = v.mesh.geometry = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    ng.setAttribute('aN', new THREE.BufferAttribute(new Int8Array(nrm), 4, true)); ng.setAttribute('aC', new THREE.BufferAttribute(new Uint8Array(col), 4, true));
    ng.setIndex(idx);
  }
  private footprint = new Map<Vox, Uint8Array>();
  private wasSolid(v: Vox, i: number, k: number) { return this.footprint.get(v)![k * v.nx + i] === 1; }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, r: number, g: number, b: number) {
    const i = this.dHead; this.dHead = (this.dHead + 1) % this.cap; this.dN = Math.min(this.cap, this.dN + 1); this.deb.count = this.dN;
    this.dp[i * 3] = x; this.dp[i * 3 + 1] = y; this.dp[i * 3 + 2] = z; this.dv[i * 3] = vx; this.dv[i * 3 + 1] = vy; this.dv[i * 3 + 2] = vz;
    this.dr[i * 3] = Math.random() * 6; this.dr[i * 3 + 1] = Math.random() * 6; this.dr[i * 3 + 2] = Math.random() * 6;
    this.dw[i * 3] = (Math.random() - 0.5) * 9; this.dw[i * 3 + 1] = (Math.random() - 0.5) * 9; this.dw[i * 3 + 2] = (Math.random() - 0.5) * 9;
    this.ds[i] = size; this.dLive[i] = 1; this.deb.setColorAt(i, this.col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace));
    if (this.deb.instanceColor) this.deb.instanceColor.needsUpdate = true;
  }

  /** Взрыв в точке. Возвращает [повреждено зданий, обрушено кубиков] для ленты событий. */
  blast(x: number, y: number, z: number, radius: number, hide: (b: number) => void) {
    let hitB = 0, fell = 0, budget = Math.min(260, this.cap >> 2);
    for (const b of this.map.buildingsNear(x, z, radius + 90)) {
      if (!this.vox.has(b)) { // вокселизуем только здания, которые взрыв действительно задевает
        const a = this.map.bStart[b], e = this.map.bStart[b + 1], p = this.map.bPts; let near = false;
        for (let i = a, q = e - 1; i < e && !near; q = i++) { // расстояние до стен
          const ax = p[q * 2], az = p[q * 2 + 1], dx = p[i * 2] - ax, dz = p[i * 2 + 1] - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          if ((ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2 < (radius * 1.5) ** 2) near = true;
        }
        if (!near && this.map.buildingAt(x, z) !== b) continue;
        const g = this.map.heightAt(x, z); if (y > g + this.map.bH[b] / 10 + radius * 1.5) continue;
        const v = this.voxelize(b); const fp = new Uint8Array(v.nx * v.nz); for (let k = 0; k < v.nz; k++) for (let i = 0; i < v.nx; i++) fp[k * v.nx + i] = v.cells[k * v.nx + i] ? 1 : 0; this.footprint.set(v, fp);
        hide(b);
      }
      const v = this.vox.get(b)!, sz = (v as any).sz as number, [lx, lz] = this.toLocal(v, x, z), ly = y - v.base; let changed = false;
      const i0 = Math.max(0, Math.floor((lx - radius * 2 - v.x0) / v.s)), i1 = Math.min(v.nx - 1, Math.floor((lx + radius * 2 - v.x0) / v.s));
      const k0 = Math.max(0, Math.floor((lz - radius * 2 - v.z0) / sz)), k1 = Math.min(v.nz - 1, Math.floor((lz + radius * 2 - v.z0) / sz));
      const j0 = Math.max(0, Math.floor((ly - radius * 2) / v.sy)), j1 = Math.min(v.ny - 1, Math.floor((ly + radius * 2) / v.sy));
      for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
        const c = (j * v.nz + k) * v.nx + i; if (!v.cells[c]) continue;
        const cx = v.x0 + (i + 0.5) * v.s, cz = v.z0 + (k + 0.5) * sz, cy = (j + 0.5) * v.sy, d = Math.hypot(cx - lx, cy - ly, cz - lz);
        const rr = radius * (0.75 + 0.5 * hash3(i + v.b, j, k)); // рваный край пролома
        if (d < rr) {
          v.cells[c] = 0; v.left--; changed = true;
          if (budget > 0 && hash3(i, j + 7, k) < 0.45) { budget--; const wx = v.ox + cx * v.cos - cz * v.sin, wz = v.oz + cx * v.sin + cz * v.cos, wy = v.base + cy, dl = Math.hypot(wx - x, wy - y, wz - z) || 1, sp = 6 + Math.random() * 22;
            this.spawn(wx, wy, wz, (wx - x) / dl * sp, (wy - y) / dl * sp + 5 + Math.random() * 8, (wz - z) / dl * sp, v.s * (0.35 + Math.random() * 0.5), 110 + Math.random() * 40, 104 + Math.random() * 36, 96 + Math.random() * 30); }
        } else if (d < rr * 1.9 && v.cells[c] === 1) { v.cells[c] = 2; changed = true; }
      }
      if (!changed) continue;
      hitB++;
      // опора: всё, что не связано с землёй, падает
      const seen = new Uint8Array(v.cells.length), stack: number[] = [], layer = v.nx * v.nz;
      for (let c = 0; c < layer; c++) if (v.cells[c]) { seen[c] = 1; stack.push(c); }
      while (stack.length) {
        const c = stack.pop()!, i = c % v.nx, k = ((c / v.nx) | 0) % v.nz, j = (c / layer) | 0;
        const tryc = (n: number) => { if (v.cells[n] && !seen[n]) { seen[n] = 1; stack.push(n); } };
        if (i > 0) tryc(c - 1); if (i < v.nx - 1) tryc(c + 1); if (k > 0) tryc(c - v.nx); if (k < v.nz - 1) tryc(c + v.nx); if (j > 0) tryc(c - layer); if (j < v.ny - 1) tryc(c + layer);
      }
      let drop = 0;
      for (let c = 0; c < v.cells.length; c++) if (v.cells[c] && !seen[c]) {
        v.cells[c] = 0; v.left--; drop++;
        const i = c % v.nx, k = ((c / v.nx) | 0) % v.nz, j = (c / layer) | 0;
        if (drop % Math.max(1, Math.ceil(drop / 500)) === 0 && drop < 4000) { const cx = v.x0 + (i + 0.5) * v.s, cz = v.z0 + (k + 0.5) * sz, wx = v.ox + cx * v.cos - cz * v.sin, wz = v.oz + cx * v.sin + cz * v.cos;
          this.spawn(wx, v.base + (j + 0.5) * v.sy, wz, (Math.random() - 0.5) * 3, -Math.random() * 2, (Math.random() - 0.5) * 3, v.s * (0.5 + Math.random() * 0.4), v.wall[0] * 0.8, v.wall[1] * 0.8, v.wall[2] * 0.8);
          if (drop % 12 === 0) this.fx.dust(wx, v.base + 1, wz, v.s * 3); }
      }
      fell += drop;
      this.remesh(v); this.map.bDamage[b] = Math.max(0.001, 1 - v.left / v.total);
    }
    return [hitB, fell];
  }

  update(dt: number) {
    let active = 0; const mp = this.map;
    for (let i = 0; i < this.dN; i++) {
      if (!this.dLive[i]) continue; active++;
      this.dv[i * 3 + 1] -= 9.81 * dt;
      const x = this.dp[i * 3] += this.dv[i * 3] * dt, y = this.dp[i * 3 + 1] += this.dv[i * 3 + 1] * dt, z = this.dp[i * 3 + 2] += this.dv[i * 3 + 2] * dt;
      this.dr[i * 3] += this.dw[i * 3] * dt; this.dr[i * 3 + 1] += this.dw[i * 3 + 1] * dt; this.dr[i * 3 + 2] += this.dw[i * 3 + 2] * dt;
      let floor = mp.heightAt(x, z) + this.ds[i] * 0.4;
      const b = mp.buildingAt(x, z); // обломки ложатся на уцелевшие крыши и перекрытия
      if (b >= 0 && this.dv[i * 3 + 1] < 0) { const v = this.vox.get(b); if (!v) floor += mp.bH[b] / 10; else if (this.solidAt(v, x, y - this.ds[i] * 0.5, z)) floor = y; }
      if (y <= floor) {
        this.dp[i * 3 + 1] = floor; const vy = this.dv[i * 3 + 1];
        if (vy > -3) { this.dLive[i] = 0; this.dw[i * 3] = this.dw[i * 3 + 1] = this.dw[i * 3 + 2] = 0; }
        else { this.dv[i * 3 + 1] = -vy * 0.25; this.dv[i * 3] *= 0.5; this.dv[i * 3 + 2] *= 0.5; this.dw[i * 3] *= 0.5; this.dw[i * 3 + 1] *= 0.5; this.dw[i * 3 + 2] *= 0.5; if (vy < -12 && Math.random() < 0.3) this.fx.dust(x, floor, z, this.ds[i] * 2.5); }
      }
      this.m4.compose(this.v.set(this.dp[i * 3], this.dp[i * 3 + 1], this.dp[i * 3 + 2]), this.q.setFromEuler(this.e.set(this.dr[i * 3], this.dr[i * 3 + 1], this.dr[i * 3 + 2])), this.sc.setScalar(this.ds[i]));
      this.deb.setMatrixAt(i, this.m4);
    }
    if (active || this.active) this.deb.instanceMatrix.needsUpdate = true;
    this.active = active;
  }

  reset() {
    for (const v of this.vox.values()) { this.group.remove(v.mesh); v.mesh.geometry.dispose(); }
    this.vox.clear(); this.footprint.clear(); this.dN = this.dHead = 0; this.deb.count = 0; this.dLive.fill(0);
  }
}
