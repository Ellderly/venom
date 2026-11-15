export interface Quality {
  name: string; pixelRatio: number; viewDist: number; lodDist: number; detailRadius: number; detailRes: number; overviewRes: number; particles: number; workers: number; voxel: number; debris: number;
  microRes: number;   // текстура ближних тайлов земли 250×250 м (разметка, переходы, шпалы); 0 — выключено
  treeDist: number;   // дальность объёмных деревьев, м; 0 — только пятна крон на земле
  treeStep: number;   // множитель шага посадки: больше — реже
  shadow: number;     // размер карты теней; 0 — без теней
  msaa: number;       // сглаживание, число выборок
  bloom: boolean;     // свечение ярких источников
  lamps: boolean;     // уличные фонари ночью
  clouds: boolean;
  roofDetail: boolean; // надстройки на крышах, парапеты
}
export const PRESETS: Record<string, Quality> = {
  low:    { name: 'Низкие',  pixelRatio: 0.75, viewDist: 5000,  lodDist: 1800, detailRadius: 1, detailRes: 512,  overviewRes: 2048, particles: 1500,  workers: 1, voxel: 2.4, debris: 500,   microRes: 0,    treeDist: 0,    treeStep: 2,    shadow: 0,    msaa: 0, bloom: false, lamps: false, clouds: false, roofDetail: false },
  medium: { name: 'Средние', pixelRatio: 1,    viewDist: 9000,  lodDist: 3500, detailRadius: 2, detailRes: 1024, overviewRes: 4096, particles: 4000,  workers: 2, voxel: 1.8, debris: 1500,  microRes: 512,  treeDist: 1300, treeStep: 1.5,  shadow: 1536, msaa: 2, bloom: true,  lamps: true,  clouds: true,  roofDetail: true },
  high:   { name: 'Высокие', pixelRatio: 1.5,  viewDist: 16000, lodDist: 6000, detailRadius: 3, detailRes: 1024, overviewRes: 4096, particles: 9000,  workers: 3, voxel: 1.4, debris: 4000,  microRes: 1024, treeDist: 2400, treeStep: 1.15, shadow: 2048, msaa: 4, bloom: true,  lamps: true,  clouds: true,  roofDetail: true },
  ultra:  { name: 'Ультра',  pixelRatio: 2,    viewDist: 60000, lodDist: 12000, detailRadius: 4, detailRes: 2048, overviewRes: 8192, particles: 20000, workers: 4, voxel: 1.1, debris: 10000, microRes: 2048, treeDist: 4000, treeStep: 1,    shadow: 4096, msaa: 4, bloom: true,  lamps: true,  clouds: true,  roofDetail: true },
};
export function loadQualityName(): string {
  const u = new URLSearchParams(location.search).get('q'); if (u && PRESETS[u]) return u;
  try { const q = localStorage.getItem('venom.quality'); if (q && PRESETS[q]) return q; } catch { /* нет доступа к хранилищу */ }
  const cores = navigator.hardwareConcurrency || 4, mem = (navigator as any).deviceMemory || 8;
  return cores <= 4 || mem <= 4 ? 'low' : cores <= 8 ? 'medium' : 'high';
}
export function saveQualityName(q: string) { try { localStorage.setItem('venom.quality', q); } catch { /* ignore */ } }
