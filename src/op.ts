// Операция: выбор целей для атаки и «размытых» районов для обороны. Цели берутся из знаковых объектов,
// инфраструктуры (координаты приблизительные) и больших мостов. Оборона видит только районы, часть из них — ложные.
import { MapData } from './map';
import { Side } from './units';

export interface OpTarget { name: string; x: number; z: number; r: number; bridge: number; hp: number; max: number }
export interface OpZone { x: number; z: number; r: number }
export interface OpState {
  phase: 'plan' | 'battle' | 'done'; endsAt: number; targets: OpTarget[]; zones: OpZone[];
  ready: Partial<Record<Side, boolean>>; budget: Record<Side, number>;
  result: { destroyed: number; total: number; need: number; winner: Side } | null;
}

const INFRA: [string, number, number][] = [
  ['ТЭЦ-5', 50.3936, 30.5697], ['ТЭЦ-6', 50.5325, 30.6628], ['Дарницкая ТЭЦ', 50.448, 30.647], ['Аэропорт Жуляны', 50.4017, 30.4497],
  ['Киевская ГЭС', 50.589, 30.512], ['Правительственный квартал', 50.4478, 30.537], ['Завод «Антонов»', 50.459, 30.39], ['Завод «Артём»', 50.464, 30.486],
];

type Cand = { name: string; x: number; z: number; r: number; bridge: number };
export function targetPool(map: MapData, marks: { x: number; z: number; name: string }[]): Cand[] {
  const m = map.meta, MX = 111320 * Math.cos(m.lat0 * Math.PI / 180), MZ = 110574, out: Cand[] = [];
  for (const k of marks) out.push({ name: k.name, x: k.x, z: k.z, r: 70, bridge: -1 });
  for (const [name, lat, lon] of INFRA) { const x = (lon - m.lon0) * MX, z = -(lat - m.lat0) * MZ; if (x > m.x0 + 500 && x < m.x1 - 500 && z > m.z0 + 500 && z < m.z1 - 500) out.push({ name, x, z, r: 160, bridge: -1 }); }
  for (const b of map.bridges) { // большие автомобильные мосты: цель — обрушить пролёт
    if (b.rail || b.len < 500) continue; let i = 0; while (i < b.s.length - 1 && b.s[i] < b.len / 2) i++;
    out.push({ name: `Мост (${Math.round(b.len / 10) * 10} м)`, x: b.pts[i * 2], z: b.pts[i * 2 + 1], r: b.len / 2, bridge: b.id });
  }
  return out;
}

/** n целей не ближе 2,5 км друг к другу и районы для обороны: по одному на цель (центр смещён) плюс ложные. */
export function makeOperation(map: MapData, marks: { x: number; z: number; name: string }[], n: number, zoneR: number, decoys: number) {
  const pool = targetPool(map, marks).sort(() => Math.random() - 0.5), picked: Cand[] = [];
  const far = (c: Cand, d: number) => picked.every(p => Math.hypot(p.x - c.x, p.z - c.z) > d);
  for (const c of pool) { if (picked.length >= n + decoys) break; if (far(c, 2500)) picked.push(c); }
  const targets = picked.slice(0, n), zones: OpZone[] = [];
  for (const c of picked) { const a = Math.random() * 6.283, d = Math.random() * zoneR * 0.6; zones.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, r: zoneR }); }
  return { targets, zones: zones.sort(() => Math.random() - 0.5) };
}
