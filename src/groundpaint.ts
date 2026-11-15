// Рисование земли (площади, дороги, разметка, тени домов) на холсте. Работает и в основном потоке (обзорная текстура),
// и в фоновом (тайлы вокруг камеры — src/groundworker.ts), поэтому не трогает DOM напрямую.
import { ROAD_W } from './map';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Данные карты, нужные для рисования. */
export interface PaintMap {
  aPts: Float32Array; aRing: Uint32Array; aStart: Uint32Array; aCls: Uint8Array;
  lPts: Float32Array; lStart: Uint32Array; lCls: Uint8Array; lineOnBridge: Uint8Array;
  bPts: Float32Array; bStart: Uint32Array;
}
export const makeCanvas = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
};

//                 вода       лес        парк       жилое      промзона   поле       песок      ж/д
const AREA_COL = ['#3d6a86', '#3f5c33', '#6f9350', '#a9a79b', '#9c978d', '#b3ae78', '#d6cb9f', '#8d8a86'];
export const LAND = '#8c9a68'; const SHALLOW = '#6f9db0';

/** Узор крон: сверху лес выглядит не ровной заливкой, а пятнами деревьев. Размер плитки — 64 м. */
function canopyPattern() {
  const c = makeCanvas(128, 128), g = c.getContext('2d') as Ctx;
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 128, y = rnd() * 128, r = 3.5 + rnd() * 5, l = rnd();
    for (const [ox, oy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) { // плитка без швов
      const gr = g.createRadialGradient(x + ox - r * 0.3, y + oy - r * 0.3, 0, x + ox, y + oy, r);
      gr.addColorStop(0, `rgba(${90 + l * 50},${125 + l * 45},${60 + l * 30},0.55)`); gr.addColorStop(0.7, `rgba(${40 + l * 30},${70 + l * 30},${30 + l * 20},0.45)`); gr.addColorStop(1, 'rgba(20,35,15,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.283); g.fill();
    }
  }
  return c;
}

export class Painter {
  private canopy = canopyPattern();
  constructor(private map: PaintMap) {}

  areaPath(g: Ctx, a: number) {
    const mp = this.map, p = mp.aPts; g.beginPath();
    for (let r = mp.aStart[a]; r < mp.aStart[a + 1]; r++) {
      const s = mp.aRing[r], e = mp.aRing[r + 1];
      g.moveTo(p[s * 2], p[s * 2 + 1]); for (let i = s + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.closePath();
    }
  }
  drawAreas(g: Ctx, ids: number[], mPerPx: number) {
    const mp = this.map, pat = g.createPattern(this.canopy as CanvasImageSource, 'repeat')!; pat.setTransform(new DOMMatrix().scale(0.5)); // 128 пикселей узора = 64 м
    for (const a of ids) {
      const c = mp.aCls[a]; g.fillStyle = AREA_COL[c]; this.areaPath(g, a); g.fill('evenodd');
      if (c === 1) { g.fillStyle = pat; g.fill('evenodd'); }
      else if (c === 2 && mPerPx < 6) { g.globalAlpha = 0.3; g.fillStyle = pat; g.fill('evenodd'); g.globalAlpha = 1; }
      else if (c === 0) { // мелководье у берега: светлая кромка внутри контура воды
        g.save(); g.clip('evenodd'); g.strokeStyle = SHALLOW; g.lineJoin = 'round';
        g.globalAlpha = 0.13; for (const w of [120, 96, 74, 54, 36, 20]) { g.lineWidth = Math.max(w, mPerPx * w / 20); g.stroke(); } // плавный переход к глубине
        g.restore();
      }
    }
  }

  /** mPerPx — метров на пиксель; maxCls — самые мелкие дороги, которые ещё рисуем. */
  drawLines(g: Ctx, ids: number[], mPerPx: number, maxCls: number) {
    const mp = this.map, p = mp.lPts; g.lineCap = 'round'; g.lineJoin = 'round';
    const path = (l: number) => { const s = mp.lStart[l], e = mp.lStart[l + 1]; g.beginPath(); g.moveTo(p[s * 2], p[s * 2 + 1]); for (let i = s + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); };
    const stroke = (l: number, col: string, w: number, dash?: number[]) => { g.strokeStyle = col; g.lineWidth = w; if (dash) { g.setLineDash(dash); g.lineCap = 'butt'; } path(l); g.stroke(); if (dash) { g.setLineDash([]); g.lineCap = 'round'; } };
    const detail = mPerPx < 2.5, fine = mPerPx < 0.7;
    const roads: number[] = [], rails: number[] = [];
    for (const l of ids) {
      const c = mp.lCls[l] & 0x3f;
      if (c >= 9) { stroke(l, AREA_COL[0], Math.max(c === 9 ? 14 : 3, mPerPx)); continue; } // реки и ручьи
      if (mp.lineOnBridge[l]) { if (detail) stroke(l, 'rgba(0,0,0,0.16)', (c === 8 ? 6 : ROAD_W[c]) + 4); continue; } // мост — отдельная 3D-модель, на земле только тень
      if (c === 8) { if (detail || mPerPx <= 6) rails.push(l); } else if (c <= maxCls) roads.push(l);
    }
    const W = (l: number) => { const c = mp.lCls[l] & 0x3f; return Math.max(ROAD_W[c], mPerPx * (c <= 1 ? 1.6 : 1.1)); };
    // слоями, чтобы на перекрёстках асфальт перекрывал бордюры соседних дорог
    if (detail) for (const l of roads) { const c = mp.lCls[l] & 0x3f; stroke(l, c <= 4 ? '#9a978f' : '#85837c', W(l) + (c <= 4 ? (fine ? 6 : 4) : 1.6)); }      // тротуар
    if (fine) for (const l of roads) if ((mp.lCls[l] & 0x3f) <= 4) stroke(l, '#5f5d58', W(l) + 0.7);                                                       // бордюр
    for (const l of roads) { const c = mp.lCls[l] & 0x3f; stroke(l, c <= 1 ? '#4a4b4e' : c <= 4 ? '#545558' : '#6a6964', W(l)); }
    if (detail) for (const l of roads) { // разметка
      const c = mp.lCls[l] & 0x3f, w = ROAD_W[c], white = 'rgba(238,238,228,0.8)', asph = c <= 1 ? '#4a4b4e' : '#545558';
      if (c > 4) continue;
      if (!fine) { if (c <= 3) stroke(l, white, 0.35, c <= 1 ? undefined : [4, 6]); continue; }
      // пары линий, симметричных оси: широкая белая полоса, середина закрывается асфальтом — от краёв к оси
      const pairs: [number, boolean][] = c === 0 ? [[w / 2 - 0.6, false], [7.2, true], [3.6, true]] : c === 1 ? [[w / 2 - 0.6, false], [3.6, true]] : c === 2 ? [[3.25, true]] : [];
      for (const [off, dashed] of pairs) { stroke(l, white, off * 2 + 0.16, dashed ? [3, 7] : undefined); stroke(l, asph, off * 2 - 0.16); }
      if (c <= 2) { stroke(l, white, 0.62); stroke(l, asph, 0.3); } else stroke(l, white, 0.15, [3, 5]); // двойная сплошная / прерывистая осевая
    }
    if (fine) for (const l of roads) { // пешеходные переходы у концов улиц
      const c = mp.lCls[l] & 0x3f, s = mp.lStart[l], e = mp.lStart[l + 1]; if (c < 2 || c > 4) continue;
      let len = 0; for (let i = s + 1; i < e; i++) len += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (len < 70) continue;
      for (const [a, b] of [[s, s + 1], [e - 1, e - 2]]) {
        let dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1]; const d = Math.hypot(dx, dz); if (d < 16) continue; dx /= d; dz /= d;
        const cx = p[a * 2] + dx * 13, cz = p[a * 2 + 1] + dz * 13, w = ROAD_W[c];
        g.fillStyle = 'rgba(240,240,232,0.85)'; g.beginPath();
        for (let k = -w / 2 + 0.4; k < w / 2 - 0.4; k += 1.1) { // полосы зебры вдоль движения
          const ox = cx - dz * k, oz = cz + dx * k;
          g.moveTo(ox - dx * 1.6, oz - dz * 1.6); g.lineTo(ox + dx * 1.6, oz + dz * 1.6); g.lineTo(ox + dx * 1.6 - dz * 0.5, oz + dz * 1.6 + dx * 0.5); g.lineTo(ox - dx * 1.6 - dz * 0.5, oz - dz * 1.6 + dx * 0.5); g.closePath();
        }
        g.fill();
      }
    }
    for (const l of rails) { // железная дорога: балласт, шпалы, рельсы
      if (!detail) { stroke(l, '#4a4744', Math.max(3.2, mPerPx * 0.9)); continue; }
      stroke(l, '#6b655d', 4.4);
      if (fine) { stroke(l, '#3d342c', 2.7, [0.26, 0.4]); stroke(l, '#b9bcc0', 1.62); stroke(l, '#6b655d', 1.36); stroke(l, '#3d342c', 1.36, [0.26, 0.4]); }
      else { stroke(l, '#4a4039', 2.6, [0.8, 1.2]); stroke(l, '#8d8f92', 1.7); stroke(l, '#5a534c', 1.0); }
    }
  }
  /** Мягкое затемнение земли у оснований домов — здания перестают «висеть» над землёй. ids — дома рядом с тайлом. */
  drawContact(g: Ctx, ids: ArrayLike<number>, pxPerM: number) {
    const mp = this.map, p = mp.bPts;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = Math.max(2, 3.2 * pxPerM); g.fillStyle = 'rgba(52,50,46,0.9)'; g.beginPath();
    for (let n = 0; n < ids.length; n++) {
      const a = mp.bStart[ids[n]], e = mp.bStart[ids[n] + 1];
      g.moveTo(p[a * 2], p[a * 2 + 1]); for (let i = a + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.closePath();
      if (n % 300 === 299) { g.fill(); g.beginPath(); }
    }
    g.fill(); g.restore();
  }
  /** Текстура тайла земли: площади, тени домов, дороги. Холст уже нужного размера. */
  paintTile(g: Ctx, x0: number, z0: number, size: number, res: number, A: number[], L: number[], B: ArrayLike<number>) {
    const s = res / size; g.setTransform(s, 0, 0, s, -x0 * s, -z0 * s);
    g.fillStyle = LAND; g.fillRect(x0, z0, size, size);
    this.drawAreas(g, A, 1 / s); this.drawContact(g, B, s); this.drawLines(g, L, 1 / s, 5);
  }
}
