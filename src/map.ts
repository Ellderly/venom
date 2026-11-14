// Данные карты: здания, площадные объекты, линии, рельеф. Всё в локальных метрах (x — восток, z — юг).
export interface Meta { x0: number; x1: number; z0: number; z1: number; cell: number; buildings: number; hmin: number; hmax: number; attribution: string }

export const TILE = 1000;
const HASH = 100; // ячейка пространственного индекса зданий, м

export class MapData {
  meta!: Meta;
  bN = 0; bPts!: Float32Array; bStart!: Uint32Array; bH!: Uint16Array; bType!: Uint8Array;
  aN = 0; aPts!: Float32Array; aRing!: Uint32Array; aStart!: Uint32Array; aCls!: Uint8Array;
  lN = 0; lPts!: Float32Array; lStart!: Uint32Array; lCls!: Uint8Array;
  hNx = 0; hNz = 0; hgt!: Uint16Array;
  tilesX = 0; tilesZ = 0;
  tileB: number[][] = []; tileA: number[][] = []; tileL: number[][] = [];
  bDamage!: Float32Array; // доля разрушенного объёма; > 0 — здание переведено в воксели
  /** Занятость точки в разрушаемом здании; null — здание ещё целое. Назначается модулем разрушений. */
  solid: ((b: number, x: number, y: number, z: number) => boolean | null) | null = null;
  private hashNx = 0; private hashNz = 0; private hash: (number[] | undefined)[] = [];

  async load(base: string, progress: (p: number, label: string) => void) {
    const get = async (n: string) => (await fetch(base + n)).arrayBuffer();
    this.meta = await (await fetch(base + 'meta.json')).json();
    progress(0.05, 'Рельеф');
    let buf = await get('height.bin');
    let h = new Uint32Array(buf, 0, 2); this.hNx = h[0]; this.hNz = h[1];
    this.hgt = new Uint16Array(buf, 8, this.hNx * this.hNz);
    progress(0.15, 'Здания');
    buf = await get('buildings.bin');
    h = new Uint32Array(buf, 0, 2); this.bN = h[0]; let o = 8;
    this.bPts = new Float32Array(buf, o, h[1] * 2); o += h[1] * 8;
    this.bStart = new Uint32Array(buf, o, this.bN + 1); o += (this.bN + 1) * 4;
    this.bH = new Uint16Array(buf, o, this.bN); o += Math.ceil(this.bN * 2 / 4) * 4;
    this.bType = new Uint8Array(buf, o, this.bN);
    this.bDamage = new Float32Array(this.bN);
    progress(0.45, 'Вода, леса, кварталы');
    buf = await get('areas.bin');
    h = new Uint32Array(buf, 0, 3); this.aN = h[0]; o = 12;
    this.aPts = new Float32Array(buf, o, h[2] * 2); o += h[2] * 8;
    this.aRing = new Uint32Array(buf, o, h[1] + 1); o += (h[1] + 1) * 4;
    this.aStart = new Uint32Array(buf, o, this.aN + 1); o += (this.aN + 1) * 4;
    this.aCls = new Uint8Array(buf, o, this.aN);
    progress(0.6, 'Дороги');
    buf = await get('lines.bin');
    h = new Uint32Array(buf, 0, 2); this.lN = h[0]; o = 8;
    this.lPts = new Float32Array(buf, o, h[1] * 2); o += h[1] * 8;
    this.lStart = new Uint32Array(buf, o, this.lN + 1); o += (this.lN + 1) * 4;
    this.lCls = new Uint8Array(buf, o, this.lN);
    progress(0.7, 'Индексация');
    this.index();
  }

  private index() {
    const m = this.meta;
    this.tilesX = Math.round((m.x1 - m.x0) / TILE); this.tilesZ = Math.round((m.z1 - m.z0) / TILE);
    const nt = this.tilesX * this.tilesZ;
    for (let i = 0; i < nt; i++) { this.tileB.push([]); this.tileA.push([]); this.tileL.push([]); }
    this.hashNx = Math.ceil((m.x1 - m.x0) / HASH); this.hashNz = Math.ceil((m.z1 - m.z0) / HASH);
    this.hash = new Array(this.hashNx * this.hashNz);
    const bbox = (pts: Float32Array, a: number, b: number) => {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let i = a; i < b; i++) { const x = pts[i * 2], z = pts[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      return [x0, z0, x1, z1];
    };
    const bin = (bb: number[], list: number[][], id: number, cell: number, nx: number, nz: number) => {
      const i0 = Math.max(0, Math.floor((bb[0] - m.x0) / cell)), i1 = Math.min(nx - 1, Math.floor((bb[2] - m.x0) / cell));
      const j0 = Math.max(0, Math.floor((bb[1] - m.z0) / cell)), j1 = Math.min(nz - 1, Math.floor((bb[3] - m.z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (list[j * nx + i] ??= []).push(id);
    };
    for (let b = 0; b < this.bN; b++) {
      const bb = bbox(this.bPts, this.bStart[b], this.bStart[b + 1]);
      const cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2;
      const t = this.tileIndex(cx, cz); if (t >= 0) this.tileB[t].push(b);
      bin(bb, this.hash as number[][], b, HASH, this.hashNx, this.hashNz);
    }
    for (let a = 0; a < this.aN; a++) {
      // bbox по внешним кольцам достаточно: внутренние лежат внутри
      const bb = bbox(this.aPts, this.aRing[this.aStart[a]], this.aRing[this.aStart[a + 1]]);
      bin(bb, this.tileA, a, TILE, this.tilesX, this.tilesZ);
    }
    for (let l = 0; l < this.lN; l++) {
      const bb = bbox(this.lPts, this.lStart[l], this.lStart[l + 1]);
      bb[0] -= 15; bb[1] -= 15; bb[2] += 15; bb[3] += 15;
      bin(bb, this.tileL, l, TILE, this.tilesX, this.tilesZ);
    }
  }

  tileIndex(x: number, z: number) {
    const i = Math.floor((x - this.meta.x0) / TILE), j = Math.floor((z - this.meta.z0) / TILE);
    return i < 0 || j < 0 || i >= this.tilesX || j >= this.tilesZ ? -1 : j * this.tilesX + i;
  }

  /** Высота рельефа; интерполяция совпадает с треугольниками сетки (диагональ из (i,j) в (i+1,j+1)). */
  heightAt(x: number, z: number) {
    return sampleHeight(this.hgt, this.hNx, this.hNz, this.meta.x0, this.meta.z0, this.meta.cell, x, z);
  }


  bCenter(b: number): [number, number] {
    let x = 0, z = 0; const a = this.bStart[b], e = this.bStart[b + 1];
    for (let i = a; i < e; i++) { x += this.bPts[i * 2]; z += this.bPts[i * 2 + 1]; }
    return [x / (e - a), z / (e - a)];
  }

  /** Здание, в контур которого попадает точка, либо -1. */
  buildingAt(x: number, z: number) {
    const i = Math.floor((x - this.meta.x0) / HASH), j = Math.floor((z - this.meta.z0) / HASH);
    if (i < 0 || j < 0 || i >= this.hashNx || j >= this.hashNz) return -1;
    const list = this.hash[j * this.hashNx + i]; if (!list) return -1;
    const p = this.bPts;
    for (const b of list) {
      const a = this.bStart[b], e = this.bStart[b + 1]; let inside = false;
      for (let k = a, q = e - 1; k < e; q = k++) {
        const xi = p[k * 2], zi = p[k * 2 + 1], xj = p[q * 2], zj = p[q * 2 + 1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return b;
    }
    return -1;
  }

  /** Здания, центр которых ближе r к точке. */
  buildingsNear(x: number, z: number, r: number) {
    const out = new Set<number>();
    const i0 = Math.floor((x - r - this.meta.x0) / HASH), i1 = Math.floor((x + r - this.meta.x0) / HASH);
    const j0 = Math.floor((z - r - this.meta.z0) / HASH), j1 = Math.floor((z + r - this.meta.z0) / HASH);
    for (let j = Math.max(0, j0); j <= Math.min(this.hashNz - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(this.hashNx - 1, i1); i++)
        for (const b of this.hash[j * this.hashNx + i] ?? []) {
          const [cx, cz] = this.bCenter(b);
          if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) out.add(b);
        }
    return [...out];
  }
}

export function sampleHeight(h: Uint16Array, nx: number, nz: number, x0: number, z0: number, cell: number, x: number, z: number) {
  let fx = (x - x0) / cell, fz = (z - z0) / cell;
  fx = fx < 0 ? 0 : fx > nx - 1.001 ? nx - 1.001 : fx; fz = fz < 0 ? 0 : fz > nz - 1.001 ? nz - 1.001 : fz;
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * nx + i;
  const h00 = h[k], h10 = h[k + 1], h01 = h[k + nx], h11 = h[k + nx + 1];
  return (u > v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v) / 10;
}
