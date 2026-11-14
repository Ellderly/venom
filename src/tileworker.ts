// Фоновый поток: строит склеенную геометрию зданий одного тайла.
import earcut from 'earcut';
import { sampleHeight } from './map';

let bPts: Float32Array, bStart: Uint32Array, bH: Uint16Array, bType: Uint8Array, hgt: Uint16Array;
let hNx = 0, hNz = 0, x0 = 0, z0 = 0, cell = 1;

// палитры: [стены], [крыши] по типу здания
const WALLS: number[][][] = [
  [[196, 188, 170], [178, 172, 160], [205, 196, 182], [168, 160, 150], [214, 204, 186]],            // 0 прочее
  [[232, 226, 210], [214, 196, 170], [190, 120, 92], [240, 236, 226], [206, 180, 140]],             // 1 частный дом
  [[188, 186, 178], [204, 196, 180], [172, 170, 166], [214, 208, 198], [196, 170, 150], [226, 222, 214]], // 2 многоэтажка
  [[150, 156, 160], [170, 168, 160], [136, 142, 150], [182, 176, 164]],                             // 3 промзона
  [[120, 118, 114], [140, 134, 126], [104, 104, 104]],                                              // 4 гаражи
  [[150, 176, 196], [170, 186, 200], [196, 200, 204], [128, 156, 180]],                             // 5 офисы/торговля
  [[222, 206, 160], [214, 200, 172], [200, 188, 160]],                                              // 6 школы, больницы
  [[240, 238, 230], [232, 226, 210]],                                                               // 7 храмы
];
const ROOFS: number[][][] = [
  [[92, 90, 88], [110, 106, 100], [80, 80, 82]],
  [[150, 70, 52], [110, 60, 48], [90, 92, 96], [60, 90, 70], [128, 84, 60]],
  [[78, 78, 80], [96, 94, 90], [66, 68, 72]],
  [[120, 124, 128], [96, 100, 104], [140, 136, 128]],
  [[84, 82, 80], [100, 96, 92]],
  [[90, 96, 104], [110, 112, 116]],
  [[120, 76, 60], [96, 96, 98]],
  [[70, 130, 100], [206, 170, 70], [64, 110, 90]],
];

function hash(n: number) { n = Math.imul(n ^ (n >>> 15), 2246822519); n = Math.imul(n ^ (n >>> 13), 3266489917); return (n ^ (n >>> 16)) >>> 0; }

self.onmessage = (e: MessageEvent) => {
  const d = e.data;
  if (d.type === 'init') {
    ({ bPts, bStart, bH, bType, hgt, hNx, hNz, x0, z0, cell } = d);
    return;
  }
  const ids: number[] = d.ids;
  // крупные здания первыми — дальние тайлы рисуют только их
  const area = (b: number) => { let a = 0; const s = bStart[b], n = bStart[b + 1] - s; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += bPts[(s + i) * 2] * bPts[(s + j) * 2 + 1] - bPts[(s + j) * 2] * bPts[(s + i) * 2 + 1]; } return Math.abs(a / 2); };
  const big = ids.map(b => (bH[b] >= 140 || area(b) >= 900) ? 1 : 0);
  const order = ids.map((_, i) => i).sort((a, b) => big[b] - big[a]);
  let nv = 0, ni = 0;
  for (const b of ids) { const n = bStart[b + 1] - bStart[b]; nv += n * 5; ni += n * 6 + (n - 2) * 3; }
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), nrm = new Int8Array(nv * 4), col = new Uint8Array(nv * 4);
  const idx = new Uint32Array(ni), vStart = new Uint32Array(ids.length + 1), base = new Float32Array(ids.length), sorted = new Uint32Array(ids.length);
  let v = 0, ii = 0, bigIdx = 0;
  const flat: number[] = [];
  order.forEach((oi, k) => {
    const b = ids[oi]; sorted[k] = b; vStart[k] = v;
    const s = bStart[b], n = bStart[b + 1] - s, h = bH[b] / 10, t = bType[b];
    let cx = 0, cz = 0, gmin = 1e9;
    for (let i = 0; i < n; i++) { const x = bPts[(s + i) * 2], z = bPts[(s + i) * 2 + 1]; cx += x; cz += z; const g = sampleHeight(hgt, hNx, hNz, x0, z0, cell, x, z); if (g < gmin) gmin = g; }
    const g0 = sampleHeight(hgt, hNx, hNz, x0, z0, cell, cx / n, cz / n);
    base[k] = g0; const top = g0 + h, bot = gmin - 2;
    const hs = hash(b + 1), seed = 1 + hs % 254;
    const wp = WALLS[t], rp = ROOFS[t], w = wp[hs % wp.length], r = rp[(hs >>> 8) % rp.length];
    const sh = 0.92 + ((hs >>> 16) % 16) / 100;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = bPts[(s + i) * 2], az = bPts[(s + i) * 2 + 1], bx = bPts[(s + j) * 2], bz = bPts[(s + j) * 2 + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-6;
      // контур с положительной площадью в (x, z) => наружная нормаль (dz, -dx)
      const nx = Math.round(dz / len * 127), nz = Math.round(-dx / len * 127);
      const q = [ax, bot, az, u, bot - g0, bx, bot, bz, u + len, bot - g0, bx, top, bz, u + len, h, ax, top, az, u, h];
      for (let c = 0; c < 4; c++) {
        pos[v * 3] = q[c * 5]; pos[v * 3 + 1] = q[c * 5 + 1]; pos[v * 3 + 2] = q[c * 5 + 2];
        uv[v * 2] = q[c * 5 + 3]; uv[v * 2 + 1] = q[c * 5 + 4];
        nrm[v * 4] = nx; nrm[v * 4 + 1] = 0; nrm[v * 4 + 2] = nz;
        col[v * 4] = w[0] * sh; col[v * 4 + 1] = w[1] * sh; col[v * 4 + 2] = w[2] * sh; col[v * 4 + 3] = seed;
        v++;
      }
      idx[ii++] = v - 4; idx[ii++] = v - 2; idx[ii++] = v - 3; idx[ii++] = v - 4; idx[ii++] = v - 1; idx[ii++] = v - 2;
      u += len;
    }
    flat.length = 0;
    const rv = v;
    for (let i = 0; i < n; i++) {
      const x = bPts[(s + i) * 2], z = bPts[(s + i) * 2 + 1]; flat.push(x, z);
      pos[v * 3] = x; pos[v * 3 + 1] = top; pos[v * 3 + 2] = z; uv[v * 2] = x; uv[v * 2 + 1] = z;
      nrm[v * 4 + 1] = 127; col[v * 4] = r[0]; col[v * 4 + 1] = r[1]; col[v * 4 + 2] = r[2]; col[v * 4 + 3] = 255;
      v++;
    }
    const tri = earcut(flat);
    for (let i = 0; i < tri.length; i += 3) { idx[ii++] = rv + tri[i]; idx[ii++] = rv + tri[i + 2]; idx[ii++] = rv + tri[i + 1]; }
    if (big[oi]) bigIdx = ii;
  });
  vStart[ids.length] = v;
  const out = { tile: d.tile, pos: pos.subarray(0, v * 3), uv: uv.subarray(0, v * 2), nrm: nrm.subarray(0, v * 4), col: col.subarray(0, v * 4), idx: idx.slice(0, ii), bigIdx, vStart, base, sorted };
  (self as any).postMessage(out, [pos.buffer, uv.buffer, nrm.buffer, col.buffer, out.idx.buffer, vStart.buffer, base.buffer, sorted.buffer]);
};
