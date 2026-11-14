export interface Quality { name: string; pixelRatio: number; viewDist: number; lodDist: number; detailRadius: number; detailRes: number; overviewRes: number; particles: number; workers: number; voxel: number; debris: number }
export const PRESETS: Record<string, Quality> = {
  low:    { name: 'Низкие',  pixelRatio: 0.75, viewDist: 5000,  lodDist: 1800, detailRadius: 1, detailRes: 512,  overviewRes: 2048, particles: 1500,  workers: 1, voxel: 2.4, debris: 500 },
  medium: { name: 'Средние', pixelRatio: 1,    viewDist: 9000,  lodDist: 3500, detailRadius: 2, detailRes: 1024, overviewRes: 4096, particles: 4000,  workers: 2, voxel: 1.8, debris: 1500 },
  high:   { name: 'Высокие', pixelRatio: 1.5,  viewDist: 16000, lodDist: 6000, detailRadius: 3, detailRes: 1024, overviewRes: 4096, particles: 9000,  workers: 3, voxel: 1.4, debris: 4000 },
  ultra:  { name: 'Ультра',  pixelRatio: 2,    viewDist: 60000, lodDist: 12000, detailRadius: 4, detailRes: 2048, overviewRes: 8192, particles: 20000, workers: 4, voxel: 1.1, debris: 10000 },
};
export function loadQualityName(): string {
  const u = new URLSearchParams(location.search).get('q'); if (u && PRESETS[u]) return u;
  try { const q = localStorage.getItem('venom.quality'); if (q && PRESETS[q]) return q; } catch { /* нет доступа к хранилищу */ }
  const cores = navigator.hardwareConcurrency || 4, mem = (navigator as any).deviceMemory || 8;
  return cores <= 4 || mem <= 4 ? 'low' : cores <= 8 ? 'medium' : 'high';
}
export function saveQualityName(q: string) { try { localStorage.setItem('venom.quality', q); } catch { /* ignore */ } }
