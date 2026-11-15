// Дорожная сеть для наземной техники: граф из линий дорог карты и поиск кратчайшего пути (A*).
// Строится при первом запросе: вершины — точки линий, совпадающие точки разных линий — один узел (перекрёсток).
import { MapData } from './map';

const CELL = 120;                                    // ячейка сетки для поиска ближайшего узла, м
const SLOW = [1, 1, 1, 1.05, 1.2, 1.6];              // по дворовым проездам ехать «дороже», чем по улицам

export class Roads {
  private n = 0; private x!: Float32Array; private z!: Float32Array;
  private adjStart!: Uint32Array; private adj!: Uint32Array; private w!: Float32Array; private onBr!: Uint8Array; // onBr — ребро идёт по мосту
  private grid = new Map<number, number[]>(); private built = false;
  constructor(private map: MapData) {}

  private build() {
    this.built = true;
    const m = this.map, p = m.lPts, ids = new Map<number, number>(), xs: number[] = [], zs: number[] = [], ea: number[] = [], eb: number[] = [], ew: number[] = [], ebr: number[] = [];
    const node = (i: number) => { // точки с одинаковыми координатами — один узел
      const k = Math.round(p[i * 2] * 2) * 200003 + Math.round(p[i * 2 + 1] * 2); let id = ids.get(k);
      if (id === undefined) { id = xs.length; ids.set(k, id); xs.push(p[i * 2]); zs.push(p[i * 2 + 1]); }
      return id;
    };
    for (let l = 0; l < m.lN; l++) {
      const c = m.lCls[l] & 0x3f; if (c > 5) continue; // только дороги: без рельсов и рек
      let a = node(m.lStart[l]);
      for (let i = m.lStart[l] + 1; i < m.lStart[l + 1]; i++) { const b = node(i); if (b !== a) { ea.push(a); eb.push(b); ew.push(Math.hypot(xs[a] - xs[b], zs[a] - zs[b]) * SLOW[c]); ebr.push(m.lineOnBridge[l]); } a = b; }
    }
    const n = this.n = xs.length; this.x = Float32Array.from(xs); this.z = Float32Array.from(zs);
    const deg = new Uint32Array(n + 1); for (let i = 0; i < ea.length; i++) { deg[ea[i] + 1]++; deg[eb[i] + 1]++; }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    this.adjStart = deg; this.adj = new Uint32Array(ea.length * 2); this.w = new Float32Array(ea.length * 2); this.onBr = new Uint8Array(ea.length * 2);
    const fill = deg.slice(0, n);
    for (let i = 0; i < ea.length; i++) { let k = fill[ea[i]]++; this.adj[k] = eb[i]; this.w[k] = ew[i]; this.onBr[k] = ebr[i]; k = fill[eb[i]]++; this.adj[k] = ea[i]; this.w[k] = ew[i]; this.onBr[k] = ebr[i]; }
    for (let i = 0; i < n; i++) { const k = Math.floor(xs[i] / CELL) * 100003 + Math.floor(zs[i] / CELL); (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(i); }
  }

  /** Ближайшие узлы дорог в радиусе r (по возрастанию расстояния, не больше max штук). */
  private near(x: number, z: number, r: number, max: number) {
    const out: [number, number][] = [], cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), k = Math.ceil(r / CELL);
    for (let i = cx - k; i <= cx + k; i++) for (let j = cz - k; j <= cz + k; j++) for (const id of this.grid.get(i * 100003 + j) ?? []) { const d = Math.hypot(this.x[id] - x, this.z[id] - z); if (d <= r) out.push([d, id]); }
    return out.sort((a, b) => a[0] - b[0]).slice(0, max).map(o => o[1]);
  }

  /**
   * Путь по дорогам от точки до точки: [x, z, x, z, …] — съезд с места на ближайшую дорогу, дороги, заезд на позицию.
   * null — дороги рядом нет или точки не связаны (остров, другой берег без моста).
   */
  route(x0: number, z0: number, x1: number, z1: number): number[] | null {
    if (!this.built) this.build();
    if (Math.hypot(x1 - x0, z1 - z0) < 60) return [x0, z0, x1, z1];
    const from = this.near(x0, z0, 800, 4), to = new Set(this.near(x1, z1, 800, 4)); if (!from.length || !to.size) return null;
    const n = this.n, g = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const heap: number[] = [], hf: number[] = [];   // двоичная куча: узел и его оценка
    const push = (id: number, f: number) => { let i = heap.length; heap.push(id); hf.push(f); while (i > 0) { const q = (i - 1) >> 1; if (hf[q] <= f) break; heap[i] = heap[q]; hf[i] = hf[q]; i = q; } heap[i] = id; hf[i] = f; };
    const pop = () => { const top = heap[0], id = heap.pop()!, f = hf.pop()!, len = heap.length; if (len) { let i = 0; for (;;) { let c = i * 2 + 1; if (c >= len) break; if (c + 1 < len && hf[c + 1] < hf[c]) c++; if (hf[c] >= f) break; heap[i] = heap[c]; hf[i] = hf[c]; i = c; } heap[i] = id; hf[i] = f; } return top; };
    const h = (id: number) => Math.hypot(this.x[id] - x1, this.z[id] - z1);
    for (const s of from) { g[s] = Math.hypot(this.x[s] - x0, this.z[s] - z0) * 2; push(s, g[s] + h(s)); } // вне дороги — вдвое «дороже»
    // разрушенные мосты: рёбра рядом с ними проверяем на разрыв (по флагу линии нельзя — встречная полоса бывает отдельной линией)
    const boxes = this.map.bridges.filter(b => b.cuts.length).map(b => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < b.pts.length; i += 2) { x0 = Math.min(x0, b.pts[i]); x1 = Math.max(x1, b.pts[i]); z0 = Math.min(z0, b.pts[i + 1]); z1 = Math.max(z1, b.pts[i + 1]); } return [x0 - b.w, x1 + b.w, z0 - b.w, z1 + b.w]; });
    const cuts = boxes.length > 0, nearCut = (a: number) => boxes.some(q => this.x[a] > q[0] && this.x[a] < q[1] && this.z[a] > q[2] && this.z[a] < q[3]); // есть разрушенные пролёты — рёбра по мостам проверяем
    const cutBr = this.map.bridges.filter(b => b.cuts.length);
    const overCut = (x: number, z: number) => { // точка над разрушенным участком какого-нибудь моста (bridgeAt такие участки пропускает, поэтому считаем сами)
      for (const b of cutBr) for (let i = 0; i < b.s.length - 1; i++) {
        const ax = b.pts[i * 2], az = b.pts[i * 2 + 1], dx = b.pts[i * 2 + 2] - ax, dz = b.pts[i * 2 + 3] - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) > b.w / 2 + 6) continue;
        const sp = b.s[i] + (b.s[i + 1] - b.s[i]) * t; if (b.cuts.some(q => sp > q[0] - 2 && sp < q[1] + 2)) return true;
      }
      return false;
    };
    const broken = (a: number, b: number) => { const n = Math.max(2, Math.ceil(Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]) / 12)); for (let i = 0; i <= n; i++) { const t = i / n; if (overCut(this.x[a] + (this.x[b] - this.x[a]) * t, this.z[a] + (this.z[b] - this.z[a]) * t)) return true; } return false; };
    let goal = -1;
    while (heap.length) {
      const a = pop(); if (done[a]) continue; done[a] = 1;
      if (to.has(a)) { goal = a; break; }
      for (let k = this.adjStart[a]; k < this.adjStart[a + 1]; k++) { const b = this.adj[k], gb = g[a] + this.w[k]; if (gb < g[b] && !(cuts && (this.onBr[k] || nearCut(a) || nearCut(b)) && broken(a, b))) { g[b] = gb; prev[b] = a; push(b, gb + h(b)); } }
    }
    if (goal < 0) return null;
    const pts: number[] = [x1, z1]; for (let a = goal; a >= 0; a = prev[a]) pts.push(this.x[a], this.z[a]); pts.push(x0, z0);
    const path: number[] = []; for (let i = pts.length - 2; i >= 0; i -= 2) path.push(pts[i], pts[i + 1]);
    return simplify(path);
  }
}

/** Убирает лишние точки на прямых участках, пока путь не станет достаточно коротким для отправки по сети. */
function simplify(p: number[]) {
  for (let tol = 0.6; ; tol *= 2) {
    const out = [p[0], p[1]];
    for (let i = 2; i < p.length - 2; i += 2) {
      const ax = out[out.length - 2], az = out[out.length - 1], bx = p[i + 2], bz = p[i + 3], l = Math.hypot(bx - ax, bz - az) || 1;
      if (Math.abs((p[i] - ax) * (bz - az) - (p[i + 1] - az) * (bx - ax)) / l > tol) out.push(p[i], p[i + 1]);
    }
    out.push(p[p.length - 2], p[p.length - 1]);
    if (out.length <= 800 || tol > 40) return out.map(v => Math.round(v * 10) / 10);
  }
}
