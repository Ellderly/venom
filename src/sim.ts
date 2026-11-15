// Ядро симуляции. Не зависит от графики: траектория — чистая функция от параметров запуска и времени,
// поэтому по сети достаточно передать само событие запуска.
import { MapData } from './map';
import { UNITS } from './units';

export interface Launch {
  id: number; unit: string; by: string; pid?: number;   // by — ник запустившего, pid — его номер в сессии
  sx: number; sz: number; tx: number; tz: number;
  t0: number;            // момент запуска по часам сессии, с
  seed: number;
  // вычисляется при запуске:
  cruiseY: number; dur: number;        // dur — расчётное время полёта до точки цели
  impactT: number; ix: number; iy: number; iz: number; building: number;
  down?: Down;           // цель сбита: дальше не летит по маршруту, а падает
}
/** Сбитая цель. По сети и в сохранении — только t и gun; остальное считает planDown (у всех одинаково). */
export interface Down {
  t: number; gun?: number;                 // момент поражения от запуска, с; номер огневой группы
  ct: number; cx: number; cy: number; cz: number; cb: number; // падение: время, точка, здание (или -1)
  det: boolean;                            // боевая часть сдетонировала при падении
  path: Float32Array;                      // точки падения через FALL_STEP: x, y, z
}
const FALL_STEP = 0.02;

export interface State { x: number; y: number; z: number; vx: number; vy: number; vz: number }

/** Положение и скорость цели через t секунд после запуска. */
export function trajectory(L: Launch, map: MapData, t: number, out: State): State {
  const u = UNITS[L.unit], dx = L.tx - L.sx, dz = L.tz - L.sz, D = Math.hypot(dx, dz) || 1, ux = dx / D, uz = dz / D;
  // огибание рельефа: высота над самой высокой точкой на участке от 300 м позади до 600 м впереди
  const follow = (s: number) => { let top = -1e9; for (let o = -300; o <= 600; o += 150) { const q = Math.min(D, Math.max(0, s + o)); top = Math.max(top, map.heightAt(L.sx + ux * q, L.sz + uz * q)); } return top + L.cruiseY; };
  const pos = (tt: number, o: { x: number; y: number; z: number }) => {
    const s = Math.min(tt * u.speed, D), k = s / D;
    // лёгкое рыскание по курсу, затухает к началу и концу маршрута
    const amp = Math.min(60, D * 0.02) * Math.sin(Math.PI * k) , w = Math.sin(s / 700 + L.seed) * amp;
    o.x = L.sx + ux * s - uz * w; o.z = L.sz + uz * s + ux * w;
    const cy = u.terrain ? follow(s) : L.cruiseY;
    const ty = map.surfaceAt(L.tx, L.tz), dd = (cy - ty) / Math.tan(u.diveDeg * Math.PI / 180), rem = D - s;
    if (rem < dd) { const q = 1 - rem / dd; o.y = cy - (cy - ty) * q * q * (1.6 - 0.6 * q); } else o.y = cy;
    if (tt * u.speed > D) o.y -= (tt * u.speed - D) * 0.8; // на случай, если пролетел точку цели, не встретив препятствий
  };
  const a = { x: 0, y: 0, z: 0 }; pos(t, out); pos(t + 0.05, a);
  out.vx = (a.x - out.x) / 0.05; out.vy = (a.y - out.y) / 0.05; out.vz = (a.z - out.z) / 0.05;
  return out;
}

/** Заполняет расчётные поля запуска: высоту маршрута и точку/время встречи с препятствием. */
export function planLaunch(L: Launch, map: MapData) {
  const u = UNITS[L.unit], D = Math.hypot(L.tx - L.sx, L.tz - L.sz);
  const agl = Math.min(u.cruiseAgl, Math.max(60, D * 0.35));
  let top = 0; for (let k = 0; k <= 20; k++) top = Math.max(top, map.heightAt(L.sx + (L.tx - L.sx) * k / 20, L.sz + (L.tz - L.sz) * k / 20));
  L.cruiseY = u.terrain ? agl : top + agl; L.dur = D / u.speed; // при огибании рельефа cruiseY — высота над землёй
  const s: State = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const tDive = Math.max(0, L.dur - (agl + 150) / Math.tan(u.diveDeg * Math.PI / 180) / u.speed - 2);
  const step = Math.min(0.02, 1 / u.speed); // не больше метра за шаг: быстрая цель не должна проскочить стену или мост
  // низколетящая цель может врезаться в высотку или мост по дороге — проверяем весь маршрут (до пикирования — крупным шагом)
  for (let t = u.terrain ? 0 : tDive; t < L.dur + 5; t += t < tDive ? 4 / u.speed : step) {
    trajectory(L, map, t, s);
    const b = obstacle(map, s);
    if (b !== -1) { const g = map.heightAt(s.x, s.z); L.impactT = t; L.ix = s.x; L.iy = Math.max(s.y, g); L.iz = s.z; L.building = Math.max(b, -1); return; }
  }
  trajectory(L, map, L.dur, s); L.impactT = L.dur; L.ix = s.x; L.iy = map.heightAt(s.x, s.z); L.iz = s.z; L.building = -1;
}


/** Во что упирается точка: -1 — ни во что, -2 — земля, мост или знаковый объект, 0 и больше — номер здания. */
function obstacle(map: MapData, s: { x: number; y: number; z: number }) {
  const g = map.heightAt(s.x, s.z), b = map.buildingAt(s.x, s.z);
  if (b >= 0 && (map.solid?.(b, s.x, s.y, s.z) ?? s.y <= g + map.bH[b] / 10)) return b;
  const dk = map.deckAt(s.x, s.z); if (s.y <= dk + 0.3 && s.y >= dk - 4) return -2; // полотно моста
  if (map.obstacles.some(o => s.y < o.top && (s.x - o.x) ** 2 + (s.z - o.z) ** 2 < o.r * o.r)) return -2;
  return s.y <= g + 0.3 ? -2 : -1;
}

/** Цель сбита через t секунд после запуска: считает падение (тяжесть и сопротивление воздуха) до земли или здания. */
export function planDown(L: Launch, map: MapData, t: number, gun?: number) {
  const s = trajectory(L, map, t, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }), pts: number[] = [s.x, s.y, s.z];
  let ft = 0, b = -1;
  while (ft < 60) {
    const k = Math.exp(-0.22 * FALL_STEP); s.vx *= k; s.vz *= k; s.vy = (s.vy - 9.8 * FALL_STEP) * Math.exp(-0.12 * FALL_STEP);
    s.x += s.vx * FALL_STEP; s.y += s.vy * FALL_STEP; s.z += s.vz * FALL_STEP; ft += FALL_STEP; pts.push(s.x, s.y, s.z);
    b = obstacle(map, s); if (b !== -1) break;
  }
  const r = Math.sin(L.seed * 12.9898 + 4.1) * 43758.5453; // детонация — от «зерна» запуска, чтобы у всех игроков совпало
  L.down = { t, gun, ct: t + ft, cx: s.x, cy: Math.max(s.y, map.heightAt(s.x, s.z)), cz: s.z, cb: Math.max(b, -1), det: r - Math.floor(r) < 0.3, path: new Float32Array(pts) };
}

/** Положение цели с учётом того, что её могли сбить. */
export function flightState(L: Launch, map: MapData, t: number, out: State): State {
  const d = L.down; if (!d || t < d.t) return trajectory(L, map, t, out);
  const n = d.path.length / 3, f = Math.min(n - 1.001, Math.max(0, (t - d.t) / FALL_STEP)), i = Math.floor(f), k = f - i, p = d.path;
  out.vx = (p[i * 3 + 3] - p[i * 3]) / FALL_STEP; out.vy = (p[i * 3 + 4] - p[i * 3 + 1]) / FALL_STEP; out.vz = (p[i * 3 + 5] - p[i * 3 + 2]) / FALL_STEP;
  out.x = p[i * 3] + (p[i * 3 + 3] - p[i * 3]) * k; out.y = p[i * 3 + 1] + (p[i * 3 + 4] - p[i * 3 + 1]) * k; out.z = p[i * 3 + 2] + (p[i * 3 + 5] - p[i * 3 + 2]) * k;
  return out;
}
/** Когда и где цель закончит полёт: попадание или падение сбитой. */
export const endOf = (L: Launch) => L.down ? { t: L.down.ct, x: L.down.cx, y: L.down.cy, z: L.down.cz, building: L.down.cb } : { t: L.impactT, x: L.ix, y: L.iy, z: L.iz, building: L.building };
