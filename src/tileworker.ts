// Фоновый поток: строит склеенную геометрию зданий одного тайла — стены, крыши (плоские с парапетом,
// скатные, шатровые), надстройки на крышах и купола храмов.
import earcut from 'earcut';
import { sampleHeight } from './map';
import { WALLS, ROOFS, hash, facadeStyle } from './palette';

let bPts: Float32Array, bStart: Uint32Array, bH: Uint16Array, bType: Uint8Array, hgt: Uint16Array;
let hNx = 0, hNz = 0, x0 = 0, z0 = 0, cell = 1, roofDetail = true;

// растущие буферы на один тайл
let pos = new Float32Array(0), uv = new Float32Array(0), nrm = new Int8Array(0), col = new Uint8Array(0), idx = new Uint32Array(0), v = 0, ii = 0;
/** Вершина: положение, uv, нормаль, цвет; a — признак (0 — без окон, 1..254 — стена с окнами, 255 — крыша), st — стиль фасада. */
function vert(x: number, y: number, z: number, u: number, w: number, nx: number, ny: number, nz: number, c: number[], k: number, a: number, st: number) {
  pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; uv[v * 2] = u; uv[v * 2 + 1] = w;
  nrm[v * 4] = nx * 127; nrm[v * 4 + 1] = ny * 127; nrm[v * 4 + 2] = nz * 127; nrm[v * 4 + 3] = st * 12;
  col[v * 4] = c[0] * k; col[v * 4 + 1] = c[1] * k; col[v * 4 + 2] = c[2] * k; col[v * 4 + 3] = a; return v++;
}
/** Плоская грань по 3–4 точкам [x,y,z]; нормаль — из первых трёх. uv задаётся в метрах вдоль грани. */
function face(p: number[][], c: number[], k: number, a: number, st: number, ox = NaN, oz = 0) {
  const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2], bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (ny < 0 && a === 255) { nx = -nx; ny = -ny; nz = -nz; }
  if (ox === ox && nx * (p[0][0] - ox) + nz * (p[0][2] - oz) < 0) { nx = -nx; ny = -ny; nz = -nz; } // наружу от центра (ox, oz)
  const la = Math.hypot(ax, ay, az) || 1, b = v;
  for (const q of p) { const dx = q[0] - p[0][0], dy = q[1] - p[0][1], dz = q[2] - p[0][2], u = (dx * ax + dy * ay + dz * az) / la; vert(q[0], q[1], q[2], u, Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - u * u)), nx, ny, nz, c, k, a, st); }
  idx[ii++] = b; idx[ii++] = b + 1; idx[ii++] = b + 2; if (p.length === 4) { idx[ii++] = b; idx[ii++] = b + 2; idx[ii++] = b + 3; }
}
function box(cx: number, cz: number, y0: number, w: number, d: number, h: number, ang: number, c: number[], top: number[]) {
  const co = Math.cos(ang), si = Math.sin(ang), P = (lx: number, lz: number, y: number) => [cx + lx * co - lz * si, y, cz + lx * si + lz * co];
  const q = [[-w, -d], [w, -d], [w, d], [-w, d]];
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; face([P(a[0], a[1], y0), P(b[0], b[1], y0), P(b[0], b[1], y0 + h), P(a[0], a[1], y0 + h)], c, 1, 0, 0, cx, cz); }
  face([P(-w, -d, y0 + h), P(w, -d, y0 + h), P(w, d, y0 + h), P(-w, d, y0 + h)], top, 1, 255, 0);
}
/** Барабан и купол храма. */
function dome(cx: number, cz: number, y0: number, r: number, wall: number[], gold: number[]) {
  const S = 10, ring = (rad: number, y: number, i: number) => { const a = i / S * 6.2832; return [cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad]; };
  const prof = [[1, 0], [1.12, 0.35], [1.05, 0.75], [0.72, 1.15], [0.3, 1.45], [0.06, 1.75]]; // «луковица»: радиус и высота в долях r
  const dh = r * 1.1;
  for (let i = 0; i < S; i++) face([ring(r * 0.86, y0, i), ring(r * 0.86, y0, i + 1), ring(r * 0.86, y0 + dh, i + 1), ring(r * 0.86, y0 + dh, i)], wall, 1, 0, 0, cx, cz);
  for (let k = 0; k < prof.length - 1; k++) for (let i = 0; i < S; i++) {
    const a = prof[k], b = prof[k + 1], sh = 0.8 + 0.25 * Math.sin(i / S * 6.2832 + 0.8);
    face([ring(r * a[0], y0 + dh + r * a[1], i), ring(r * a[0], y0 + dh + r * a[1], i + 1), ring(r * b[0], y0 + dh + r * b[1], i + 1), ring(r * b[0], y0 + dh + r * b[1], i)], gold, sh, 0, 0, cx, cz);
  }
  return y0 + dh + r * 1.75;
}
function inside(s: number, n: number, x: number, z: number) {
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = bPts[(s + i) * 2], zi = bPts[(s + i) * 2 + 1], xj = bPts[(s + j) * 2], zj = bPts[(s + j) * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; }
  return c;
}

self.onmessage = (e: MessageEvent) => {
  const d = e.data;
  if (d.type === 'init') { ({ bPts, bStart, bH, bType, hgt, hNx, hNz, x0, z0, cell, roofDetail } = d); return; }
  const ids: number[] = d.ids;
  // крупные здания первыми — дальние тайлы рисуют только их
  const areaOf = (b: number) => { let a = 0; const s = bStart[b], n = bStart[b + 1] - s; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += bPts[(s + i) * 2] * bPts[(s + j) * 2 + 1] - bPts[(s + j) * 2] * bPts[(s + i) * 2 + 1]; } return Math.abs(a / 2); };
  const areas = ids.map(areaOf), big = ids.map((b, i) => (bH[b] >= 140 || areas[i] >= 900) ? 1 : 0);
  const order = ids.map((_, i) => i).sort((a, b) => big[b] - big[a]);
  let nv = 0, ni = 0;
  for (const b of ids) { const n = bStart[b + 1] - bStart[b]; nv += n * 7 + 60 + (bType[b] === 7 ? 500 : 0); ni += n * 9 + 90 + (bType[b] === 7 ? 750 : 0); }
  pos = new Float32Array(nv * 3); uv = new Float32Array(nv * 2); nrm = new Int8Array(nv * 4); col = new Uint8Array(nv * 4); idx = new Uint32Array(ni); v = 0; ii = 0;
  const vStart = new Uint32Array(ids.length + 1), base = new Float32Array(ids.length), sorted = new Uint32Array(ids.length);
  let bigIdx = 0;
  const flat: number[] = [];
  order.forEach((oi, k) => {
    const b = ids[oi]; sorted[k] = b; vStart[k] = v;
    const s = bStart[b], n = bStart[b + 1] - s, h = bH[b] / 10, t = bType[b], area = areas[oi];
    if (h <= 0) return; // здание заменено отдельной моделью (знаковые объекты)
    let cx = 0, cz = 0, gmin = 1e9;
    for (let i = 0; i < n; i++) { const x = bPts[(s + i) * 2], z = bPts[(s + i) * 2 + 1]; cx += x; cz += z; const g = sampleHeight(hgt, hNx, hNz, x0, z0, cell, x, z); if (g < gmin) gmin = g; }
    cx /= n; cz /= n;
    const g0 = sampleHeight(hgt, hNx, hNz, x0, z0, cell, cx, cz);
    base[k] = g0; const bot = gmin - 2;
    const hs = hash(b + 1), seed = 1 + hs % 254, st = facadeStyle(t, h, hs);
    const wp = WALLS[t], rp = ROOFS[t], w = wp[hs % wp.length], r = rp[(hs >>> 8) % rp.length];
    const sh = 0.92 + ((hs >>> 16) % 16) / 100;
    // форма крыши: двускатная у прямоугольных домов, шатровая у небольших частных и храмов, иначе плоская с парапетом
    let shortSide = 1e9, longI = 0, longL = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(bPts[(s + j) * 2] - bPts[(s + i) * 2], bPts[(s + j) * 2 + 1] - bPts[(s + i) * 2 + 1]); if (l < shortSide) shortSide = l; if (l > longL) { longL = l; longI = i; } }
    const pitched = (st === 1 || st === 8) && h >= 3 && area < 900 && (n === 4 || (n <= 8 && inside(s, n, cx, cz)));
    const roofH = pitched ? Math.min(st === 8 ? 5 : 3.2, h * 0.45, Math.sqrt(area) * 0.3) : 0;
    const eave = g0 + h - roofH;                                                    // верх стен
    const parapet = !pitched && roofDetail && h >= 8 && st !== 4 && st !== 5 ? 0.7 : 0;
    const wallTop = eave + parapet;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = bPts[(s + i) * 2], az = bPts[(s + i) * 2 + 1], bx = bPts[(s + j) * 2], bz = bPts[(s + j) * 2 + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-6;
      // контур с положительной площадью в (x, z) => наружная нормаль (dz, -dx)
      const nx = dz / len, nz = -dx / len, b0 = v;
      vert(ax, bot, az, u, bot - g0, nx, 0, nz, w, sh, seed, st); vert(bx, bot, bz, u + len, bot - g0, nx, 0, nz, w, sh, seed, st);
      vert(bx, wallTop, bz, u + len, wallTop - g0, nx, 0, nz, w, sh, seed, st); vert(ax, wallTop, az, u, wallTop - g0, nx, 0, nz, w, sh, seed, st);
      idx[ii++] = b0; idx[ii++] = b0 + 2; idx[ii++] = b0 + 1; idx[ii++] = b0; idx[ii++] = b0 + 3; idx[ii++] = b0 + 2;
      u += len;
    }
    const P = (i: number, y: number) => [bPts[(s + (i % n)) * 2], y, bPts[(s + (i % n)) * 2 + 1]];
    if (pitched && n === 4) { // конёк вдоль длинной стороны
      const i0 = longI, top = eave + roofH, mid = (a: number[], c: number[]) => [(a[0] + c[0]) / 2, top, (a[2] + c[2]) / 2];
      const p0 = P(i0, eave), p1 = P(i0 + 1, eave), p2 = P(i0 + 2, eave), p3 = P(i0 + 3, eave), m1 = mid(p1, p2), m2 = mid(p3, p0);
      face([p0, p1, m1, m2], r, 1, 255, 1); face([p2, p3, m2, m1], r, 1, 255, 1);
      face([p1, p2, m1], w, sh, 0, 0, cx, cz); face([p3, p0, m2], w, sh, 0, 0, cx, cz);                // фронтоны
    } else if (pitched) {
      const apex = [cx, eave + roofH, cz]; for (let i = 0; i < n; i++) face([P(i, eave), P(i + 1, eave), apex], r, 1, 255, 1);
    } else {
      flat.length = 0; const rv = v;
      for (let i = 0; i < n; i++) { const x = bPts[(s + i) * 2], z = bPts[(s + i) * 2 + 1]; flat.push(x, z); vert(x, eave, z, x, z, 0, 1, 0, r, 1, 255, 0); }
      const tri = earcut(flat);
      for (let i = 0; i < tri.length; i += 3) { idx[ii++] = rv + tri[i]; idx[ii++] = rv + tri[i + 2]; idx[ii++] = rv + tri[i + 1]; }
    }
    if (st === 8 && inside(s, n, cx, cz)) { // купола: главный и, у больших храмов, малые по углам
      const R = Math.min(7, Math.max(1.6, Math.sqrt(area) * 0.2)), gold = (hs >>> 12) % 3 ? [212, 172, 60] : [70, 132, 104], y = eave + roofH * (pitched ? 0.75 : 0);
      dome(cx, cz, y, R, w, gold);
      if (area > 500) { const a0 = Math.atan2(bPts[(s + ((longI + 1) % n)) * 2 + 1] - bPts[(s + longI) * 2 + 1], bPts[(s + ((longI + 1) % n)) * 2] - bPts[(s + longI) * 2]);
        for (let q = 0; q < 4; q++) { const a = a0 + Math.PI / 4 + q * Math.PI / 2, x = cx + Math.cos(a) * R * 2.1, z = cz + Math.sin(a) * R * 2.1; if (inside(s, n, x, z)) dome(x, z, eave, R * 0.45, w, gold); } }
    } else if (parapet && roofDetail && h >= 13 && area >= 260 && st !== 1) { // лифтовые и вентиляционные надстройки
      const ang = Math.atan2(bPts[(s + ((longI + 1) % n)) * 2 + 1] - bPts[(s + longI) * 2 + 1], bPts[(s + ((longI + 1) % n)) * 2] - bPts[(s + longI) * 2]);
      const cnt = Math.min(4, 1 + Math.floor(longL / 45)), conc = [150, 146, 138];
      for (let q = 0; q < cnt; q++) {
        const f = cnt === 1 ? 0 : (q / (cnt - 1) - 0.5) * 0.62 * longL, x = cx + Math.cos(ang) * f, z = cz + Math.sin(ang) * f;
        const bw = 1.6 + ((hs >>> (q * 3)) % 4) * 0.5, bd = 1.3 + ((hs >>> (q * 2 + 5)) % 3) * 0.5;
        const co = Math.cos(ang), si = Math.sin(ang), ok = [[-bw, -bd], [bw, -bd], [bw, bd], [-bw, bd]].every(c => inside(s, n, x + c[0] * co - c[1] * si, z + c[0] * si + c[1] * co));
        if (ok) box(x, z, eave, bw, bd, 2.2 + ((hs >>> (q + 9)) % 3) * 0.5, ang, conc, r);
      }
    }
    if (big[oi]) bigIdx = ii;
  });
  vStart[ids.length] = v;
  const out = { tile: d.tile, pos: pos.slice(0, v * 3), uv: uv.slice(0, v * 2), nrm: nrm.slice(0, v * 4), col: col.slice(0, v * 4), idx: idx.slice(0, ii), bigIdx, vStart, base, sorted };
  (self as any).postMessage(out, [out.pos.buffer, out.uv.buffer, out.nrm.buffer, out.col.buffer, out.idx.buffer, vStart.buffer, base.buffer, sorted.buffer]);
};
