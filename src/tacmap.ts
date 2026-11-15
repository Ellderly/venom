// Тактическая карта (вид сверху на весь регион) и мини-карта. Рисуются на 2D-холсте поверх обзорной текстуры земли.
import { Meta } from './map';

export interface TacDrone { x: number; z: number; sx: number; sz: number; tx: number; tz: number; hdg: number; label: string }
export interface TacData {
  drones: TacDrone[]; hits: { x: number; z: number }[];
  cam: { x: number; z: number; yaw: number; dist: number };
  /** Планирование запуска: выбранная точка удара и кольца «время подлёта». */
  aim: { tx: number; tz: number; rings: { r: number; label: string }[] } | null;
  cursor: { x: number; z: number } | null;
  /** Огневые группы ПВО (видит только оборона). */
  guns: { x: number; z: number; r: number; ready: boolean; sel: boolean; label: string }[];
}

function drawDrone(g: CanvasRenderingContext2D, px: number, py: number, hdg: number, s: number) {
  g.save(); g.translate(px, py); g.rotate(hdg); g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.8, s * 0.8); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.8, s * 0.8); g.closePath();
  g.fillStyle = '#ff4326'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#fff'; g.stroke(); g.restore();
}

export class TacMap {
  open = false;
  private cv: HTMLCanvasElement; private g: CanvasRenderingContext2D;
  private cx: number; private cz: number; private k = 0.02; // центр вида (мир) и масштаб, пикселей на метр
  private drag: { x: number; y: number; moved: number } | null = null;
  cursor: { x: number; z: number } | null = null;

  constructor(private root: HTMLElement, private overview: HTMLCanvasElement, private m: Meta, private marks: { x: number; z: number; name: string }[], private onClick: (x: number, z: number) => void) {
    this.cv = root.querySelector('canvas')!; this.g = this.cv.getContext('2d')!;
    this.cx = (m.x0 + m.x1) / 2; this.cz = (m.z0 + m.z1) / 2;
    const cv = this.cv;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, moved: 0 }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      this.cursor = this.toWorld(e.clientX, e.clientY);
      const d = this.drag; if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.moved > 5) { this.cx -= dx / this.k; this.cz -= dy / this.k; this.clamp(); }
    });
    cv.addEventListener('pointerup', e => { const d = this.drag; this.drag = null; if (d && d.moved <= 5 && e.button === 0) { const w = this.toWorld(e.clientX, e.clientY); this.onClick(w.x, w.z); } });
    cv.addEventListener('pointerleave', () => { this.cursor = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const w = this.toWorld(e.clientX, e.clientY);
      this.k = Math.min(1.2, Math.max(this.fitK() * 0.5, this.k * Math.exp(-Math.sign(e.deltaY) * 0.2)));
      const w2 = this.toWorld(e.clientX, e.clientY); this.cx += w.x - w2.x; this.cz += w.z - w2.z; this.clamp();
    }, { passive: false });
  }
  private fitK() { return Math.min(innerWidth / (this.m.x1 - this.m.x0), innerHeight / (this.m.z1 - this.m.z0)); }
  private clamp() { const m = this.m; this.cx = Math.min(m.x1 + 8000, Math.max(m.x0 - 8000, this.cx)); this.cz = Math.min(m.z1 + 8000, Math.max(m.z0 - 8000, this.cz)); }
  private toWorld(px: number, py: number) { return { x: this.cx + (px - innerWidth / 2) / this.k, z: this.cz + (py - innerHeight / 2) / this.k }; }

  show(on: boolean, at?: { x: number; z: number }) {
    this.open = on; this.root.classList.toggle('hidden', !on);
    if (on) { this.k = Math.max(this.fitK() * 0.95, Math.min(this.k, 0.2)); if (at) { this.cx = at.x; this.cz = at.z; } if (this.k <= this.fitK()) { this.cx = (this.m.x0 + this.m.x1) / 2; this.cz = (this.m.z0 + this.m.z1) / 2; } this.clamp(); }
  }

  draw(d: TacData) {
    const cv = this.cv, g = this.g, dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight, m = this.m, k = this.k;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#10161b'; g.fillRect(0, 0, W, H);
    const X = (x: number) => (x - this.cx) * k + W / 2, Y = (z: number) => (z - this.cz) * k + H / 2;
    g.imageSmoothingQuality = 'high'; g.globalAlpha = 0.92;
    g.drawImage(this.overview, X(m.x0), Y(m.z0), (m.x1 - m.x0) * k, (m.z1 - m.z0) * k); g.globalAlpha = 1;
    g.fillStyle = 'rgba(8,12,16,0.28)'; g.fillRect(0, 0, W, H); // приглушаем подложку, чтобы обстановка читалась
    g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
    // кольца дальности от центра города
    g.setLineDash([6, 6]); g.lineWidth = 1;
    for (let r = 5000; r <= 30000; r += 5000) { g.strokeStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(X(0), Y(0), r * k, 0, 6.283); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(`${r / 1000} км`, X(0), Y(-r) - 3); }
    g.setLineDash([]);
    if (k > 0.035) for (const mk of this.marks) { const x = X(mk.x), y = Y(mk.z); g.fillStyle = '#ffe9a8'; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y); g.fill(); g.fillStyle = 'rgba(255,240,200,0.9)'; g.fillText(mk.name, x, y + 17); } // знаковые объекты — ориентиры
    for (const h of d.hits) { const x = X(h.x), y = Y(h.z); g.fillStyle = 'rgba(20,10,8,0.85)'; g.beginPath(); g.arc(x, y, Math.max(2.5, 40 * k), 0, 6.283); g.fill(); g.strokeStyle = '#ff9a3d'; g.lineWidth = 1; g.stroke(); }
    for (const q of d.guns) { // зона огня и сама группа
      const x = X(q.x), y = Y(q.z); g.lineWidth = q.sel ? 2 : 1.2; g.strokeStyle = q.sel ? '#fff' : q.ready ? 'rgba(74,168,255,0.9)' : 'rgba(74,168,255,0.4)'; g.fillStyle = 'rgba(74,168,255,0.08)';
      g.beginPath(); g.arc(x, y, q.r * k, 0, 6.283); g.fill(); g.stroke();
      g.fillStyle = q.ready ? '#4aa8ff' : '#7f93a6'; g.fillRect(x - 4, y - 4, 8, 8); g.fillStyle = '#cfe6ff'; g.fillText(q.label, x, y + 17);
    }
    for (const t of d.drones) { // маршрут: пройденная часть тусклая, оставшаяся яркая
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,90,54,0.3)'; g.beginPath(); g.moveTo(X(t.sx), Y(t.sz)); g.lineTo(X(t.x), Y(t.z)); g.stroke();
      g.strokeStyle = 'rgba(255,90,54,0.9)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(t.x), Y(t.z)); g.lineTo(X(t.tx), Y(t.tz)); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#ff5a36'; g.beginPath(); g.arc(X(t.tx), Y(t.tz), 5, 0, 6.283); g.moveTo(X(t.tx) - 8, Y(t.tz)); g.lineTo(X(t.tx) + 8, Y(t.tz)); g.moveTo(X(t.tx), Y(t.tz) - 8); g.lineTo(X(t.tx), Y(t.tz) + 8); g.stroke();
    }
    for (const t of d.drones) { drawDrone(g, X(t.x), Y(t.z), t.hdg, 7); g.fillStyle = '#fff'; g.fillText(t.label, X(t.x), Y(t.z) - 11); }
    if (d.aim) {
      const x = X(d.aim.tx), y = Y(d.aim.tz);
      for (const r of d.aim.rings) { g.strokeStyle = 'rgba(255,200,80,0.8)'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, r.r * k, 0, 6.283); g.stroke(); g.fillStyle = 'rgba(255,220,130,0.95)'; g.fillText(r.label, x, y - r.r * k - 4); }
      g.strokeStyle = '#ffd24a'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, 6.283); g.stroke();
      if (d.cursor) { g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x, y); g.lineTo(X(d.cursor.x), Y(d.cursor.z)); g.stroke(); g.setLineDash([]); }
    }
    // камера: точка взгляда и направление
    const c = d.cam, cxp = X(c.x), cyp = Y(c.z);
    g.save(); g.translate(cxp, cyp); g.rotate(-c.yaw); g.fillStyle = 'rgba(255,255,255,0.16)'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 30, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cxp, cyp, 3, 0, 6.283); g.fill();
    // масштабная линейка
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000]; const sm = steps.find(s => s * k > 70) ?? 10000;
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(20, H - 30); g.lineTo(20 + sm * k, H - 30); g.stroke(); g.textAlign = 'left'; g.fillStyle = '#fff'; g.fillText(sm >= 1000 ? `${sm / 1000} км` : `${sm} м`, 20, H - 36);
  }
}

export class Minimap {
  private g: CanvasRenderingContext2D; private base: HTMLCanvasElement;
  constructor(private cv: HTMLCanvasElement, overview: HTMLCanvasElement, private m: Meta, onFly: (x: number, z: number) => void) {
    this.g = cv.getContext('2d')!;
    this.base = document.createElement('canvas'); this.base.width = cv.width; this.base.height = cv.height; // уменьшенная копия — рисуется быстро
    const bg = this.base.getContext('2d')!; bg.imageSmoothingQuality = 'high'; bg.drawImage(overview, 0, 0, cv.width, cv.height); bg.fillStyle = 'rgba(8,12,16,0.25)'; bg.fillRect(0, 0, cv.width, cv.height);
    const fly = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); onFly(m.x0 + (e.clientX - r.left) / r.width * (m.x1 - m.x0), m.z0 + (e.clientY - r.top) / r.height * (m.z1 - m.z0)); };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); fly(e); });
    cv.addEventListener('pointermove', e => { if (e.buttons & 1) fly(e); });
  }
  draw(d: TacData) {
    const g = this.g, W = this.cv.width, H = this.cv.height, m = this.m;
    const X = (x: number) => (x - m.x0) / (m.x1 - m.x0) * W, Y = (z: number) => (z - m.z0) / (m.z1 - m.z0) * H;
    g.drawImage(this.base, 0, 0);
    g.fillStyle = '#ff9a3d'; for (const h of d.hits) g.fillRect(X(h.x) - 1, Y(h.z) - 1, 2, 2);
    g.fillStyle = '#4aa8ff'; for (const q of d.guns) g.fillRect(X(q.x) - 1.5, Y(q.z) - 1.5, 3, 3);
    for (const t of d.drones) { g.strokeStyle = 'rgba(255,90,54,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(t.x), Y(t.z)); g.lineTo(X(t.tx), Y(t.tz)); g.stroke(); drawDrone(g, X(t.x), Y(t.z), t.hdg, 4.5); }
    const c = d.cam, x = Math.min(W - 3, Math.max(3, X(c.x))), y = Math.min(H - 3, Math.max(3, Y(c.z)));
    g.save(); g.translate(x, y); g.rotate(-c.yaw); g.fillStyle = 'rgba(255,255,255,0.25)'; g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 16, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 2, 0, 6.283); g.fill();
  }
}
