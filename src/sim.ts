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
}

export interface State { x: number; y: number; z: number; vx: number; vy: number; vz: number }

/** Положение и скорость цели через t секунд после запуска. */
export function trajectory(L: Launch, map: MapData, t: number, out: State): State {
  const u = UNITS[L.unit], dx = L.tx - L.sx, dz = L.tz - L.sz, D = Math.hypot(dx, dz) || 1, ux = dx / D, uz = dz / D;
  const pos = (tt: number, o: { x: number; y: number; z: number }) => {
    const s = Math.min(tt * u.speed, D), k = s / D;
    // лёгкое рыскание по курсу, затухает к началу и концу маршрута
    const amp = Math.min(60, D * 0.02) * Math.sin(Math.PI * k) , w = Math.sin(s / 700 + L.seed) * amp;
    o.x = L.sx + ux * s - uz * w; o.z = L.sz + uz * s + ux * w;
    const ty = map.heightAt(L.tx, L.tz), dd = (L.cruiseY - ty) / Math.tan(u.diveDeg * Math.PI / 180), rem = D - s;
    if (rem < dd) { const q = 1 - rem / dd; o.y = L.cruiseY - (L.cruiseY - ty) * q * q * (1.6 - 0.6 * q); } else o.y = L.cruiseY;
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
  L.cruiseY = top + agl; L.dur = D / u.speed;
  const s: State = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const tDive = Math.max(0, L.dur - (agl + 150) / Math.tan(u.diveDeg * Math.PI / 180) / u.speed - 2);
  for (let t = tDive; t < L.dur + 5; t += 0.02) {
    trajectory(L, map, t, s);
    const g = map.heightAt(s.x, s.z), b = map.buildingAt(s.x, s.z);
    const hitB = b >= 0 && (map.solid?.(b, s.x, s.y, s.z) ?? s.y <= g + map.bH[b] / 10);
    const dk = map.deckAt(s.x, s.z), hitD = s.y <= dk + 0.3 && s.y >= dk - 4; // полотно моста
    const hitO = map.obstacles.some(o => s.y < o.top && (s.x - o.x) ** 2 + (s.z - o.z) ** 2 < o.r * o.r);
    if (hitB || hitD || hitO || s.y <= g + 0.3) { L.impactT = t; L.ix = s.x; L.iy = Math.max(s.y, g); L.iz = s.z; L.building = hitB ? b : -1; return; }
  }
  trajectory(L, map, L.dur, s); L.impactT = L.dur; L.ix = s.x; L.iy = map.heightAt(s.x, s.z); L.iz = s.z; L.building = -1;
}

