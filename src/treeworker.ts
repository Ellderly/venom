// Фоновый поток: расставляет деревья и уличные фонари в тайле 1×1 км.
// Маска тайла рисуется на холсте: леса, парки, дворы — где сажать; вода, дороги, здания — где нельзя.
import { sampleHeight } from './map';

let d: any; // данные карты, приходят один раз
const ROAD_W = [24, 17, 13, 10, 7.5, 4.5], N = 500, TILE = 1000;
const cv = new OffscreenCanvas(N, N), g = cv.getContext('2d', { willReadFrequently: true })!;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') { d = m; return; }
  const { tile, x0, z0, step } = m as { tile: number; x0: number; z0: number; step: number };
  const s = N / TILE; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.setTransform(s, 0, 0, s, -x0 * s, -z0 * s);
  const aP: Float32Array = d.aPts, lP: Float32Array = d.lPts, bP: Float32Array = d.bPts;
  const COL: Record<number, string> = { 1: '#ff0000', 2: '#960000', 3: '#3c0000', 0: '#0000ff' };
  for (const pass of [1, 0]) for (const a of m.A as number[]) { // вода поверх всего остального
    const c = d.aCls[a]; if ((c === 0) !== (pass === 0) || !COL[c]) continue;
    g.fillStyle = COL[c]; g.beginPath();
    for (let r = d.aStart[a]; r < d.aStart[a + 1]; r++) { const p0 = d.aRing[r], p1 = d.aRing[r + 1]; g.moveTo(aP[p0 * 2], aP[p0 * 2 + 1]); for (let i = p0 + 1; i < p1; i++) g.lineTo(aP[i * 2], aP[i * 2 + 1]); g.closePath(); }
    g.fill('evenodd');
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const l of m.L as number[]) {
    const c = d.lCls[l] & 0x3f, p0 = d.lStart[l], p1 = d.lStart[l + 1];
    g.strokeStyle = c >= 9 ? '#0000ff' : '#000078'; g.lineWidth = c >= 9 ? (c === 9 ? 16 : 5) : c === 8 ? 9 : ROAD_W[c] + 3;
    g.beginPath(); g.moveTo(lP[p0 * 2], lP[p0 * 2 + 1]); for (let i = p0 + 1; i < p1; i++) g.lineTo(lP[i * 2], lP[i * 2 + 1]); g.stroke();
  }
  g.fillStyle = g.strokeStyle = '#00ff00'; g.lineWidth = 5; g.beginPath();
  for (const b of m.B as number[]) { const p0 = d.bStart[b], p1 = d.bStart[b + 1]; g.moveTo(bP[p0 * 2], bP[p0 * 2 + 1]); for (let i = p0 + 1; i < p1; i++) g.lineTo(bP[i * 2], bP[i * 2 + 1]); g.closePath(); }
  g.fill(); g.stroke();
  const px = g.getImageData(0, 0, N, N).data;
  const at = (x: number, z: number) => { const i = Math.floor((x - x0) * s), j = Math.floor((z - z0) * s); return i < 0 || j < 0 || i >= N || j >= N ? -1 : (j * N + i) * 4; };
  let seed = (tile * 2654435761) >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const H = (x: number, z: number) => sampleHeight(d.hgt, d.hNx, d.hNz, d.x0, d.z0, d.cell, x, z);
  const trees: number[] = [], lamps: number[] = [];
  const add = (x: number, z: number, size: number, kind: number) => trees.push(x, H(x, z) - 0.3, z, size, rnd() * 6.283, rnd(), 0.8 + rnd() * 0.45, kind);
  // площадная посадка: лес густо, парк куртинами, дворы редко
  const st = 6.5 * step;
  for (let z = z0 + st / 2; z < z0 + TILE; z += st) for (let x = x0 + st / 2; x < x0 + TILE; x += st) {
    const jx = x + (rnd() - 0.5) * st * 0.9, jz = z + (rnd() - 0.5) * st * 0.9, r = rnd(), r2 = rnd(), o = at(jx, jz); if (o < 0 || px[o + 1] > 90 || px[o + 2] > 50) continue;
    const R = px[o];
    if (R > 220) { if (r < 0.92) { const pine = Math.sin(jx * 0.004) + Math.cos(jz * 0.005) + r2 > 0.9; add(jx, jz, pine ? 17 + r2 * 9 : 13 + r2 * 10, pine ? 1 : 0); } }
    else if (R > 120 && R < 180) { const clump = Math.sin(jx * 0.031 + 1.7) * Math.cos(jz * 0.027) > 0.1; if (r < (clump ? 0.45 : 0.05)) add(jx, jz, 9 + r2 * 8, r2 > 0.9 ? 2 : 0); }
    else if (R > 40 && R < 80) { if (r < 0.05) add(jx, jz, 7 + r2 * 6, r2 > 0.85 ? 2 : 0); }
  }
  // вдоль улиц — рядами; фонари — через равные промежутки
  for (const l of m.L as number[]) {
    const c = d.lCls[l] & 0x3f, bridge = (d.lCls[l] & 0x40) !== 0; if (c > 4 || bridge) continue;
    const p0 = d.lStart[l], p1 = d.lStart[l + 1], w = ROAD_W[c]; let acc = rnd() * 10, lacc = rnd() * 20, side = 1;
    for (let i = p0; i < p1 - 1; i++) {
      const ax = lP[i * 2], az = lP[i * 2 + 1]; let dx = lP[i * 2 + 2] - ax, dz = lP[i * 2 + 3] - az; const len = Math.hypot(dx, dz); if (len < 0.01) continue; dx /= len; dz /= len;
      if (c >= 2) for (; acc < len; acc += 15 * step + rnd() * 4) for (const sd of [-1, 1]) { // деревья по обеим сторонам
        const x = ax + dx * acc - dz * sd * (w / 2 + 3.2), z = az + dz * acc + dx * sd * (w / 2 + 3.2), o = at(x, z);
        if (o >= 0 && px[o + 1] < 90 && px[o + 2] < 50 && rnd() < 0.7) add(x, z, 8 + rnd() * 5, rnd() < 0.2 ? 2 : 0);
      }
      acc -= len;
      for (; lacc < len; lacc += c <= 1 ? 34 : 42) { // фонари в шахматном порядке
        side = -side; const off = w / 2 + 0.8, x = ax + dx * lacc - dz * side * off, z = az + dz * lacc + dx * side * off;
        if (x >= x0 && z >= z0 && x < x0 + TILE && z < z0 + TILE) lamps.push(x, H(x, z) + (c <= 1 ? 10 : 8), z, c <= 1 ? 1.3 : 1);
      }
      lacc -= len;
    }
  }
  const t = new Float32Array(trees), lp = new Float32Array(lamps);
  (self as any).postMessage({ tile, trees: t, lamps: lp }, [t.buffer, lp.buffer]);
};
