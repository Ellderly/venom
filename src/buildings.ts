// Здания: тайлы 1×1 км, геометрия строится в фоновых потоках, дальние тайлы рисуют только крупные дома.
import * as THREE from 'three';
import { MapData, TILE } from './map';
import { U, LIT_GLSL } from './env';
import { Quality } from './quality';

interface TileMesh { mesh: THREE.Mesh; idxCount: number; bigIdx: number; vStart: Uint32Array; base: Float32Array; sorted: Uint32Array }

export class Buildings {
  group = new THREE.Group();
  tiles = new Map<number, TileMesh>();
  private pending = new Set<number>();
  private workers: Worker[] = []; private busy: number[] = [];
  mat: THREE.ShaderMaterial;
  stats = { tiles: 0, tris: 0 };

  constructor(private map: MapData, public q: Quality) {
    for (let i = 0; i < q.workers; i++) {
      const w = new Worker(new URL('./tileworker.ts', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', bPts: map.bPts, bStart: map.bStart, bH: map.bH, bType: map.bType, hgt: map.hgt, hNx: map.hNx, hNz: map.hNz, x0: map.meta.x0, z0: map.meta.z0, cell: map.meta.cell, roofDetail: q.roofDetail });
      w.onmessage = e => { this.busy[i]--; this.onTile(e.data); };
      this.workers.push(w); this.busy.push(0);
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...U }, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 aN; attribute vec4 aC; varying vec3 vN; varying vec4 vC; varying vec2 vUv; varying vec3 vW; varying float vS;
        void main(){ vN = aN.xyz; vS = aN.w * 127.0 / 12.0; vC = aC; vUv = uv; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vN; varying vec4 vC; varying vec2 vUv; varying vec3 vW; varying float vS;
        ${LIT_GLSL}
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float rect(vec2 f, vec2 a, vec2 b){ return step(a.x, f.x) * step(f.x, b.x) * step(a.y, f.y) * step(f.y, b.y); }
        void main(){
          vec3 n = normalize(vN);
          vec3 alb = vC.rgb * vC.rgb, emis = vec3(0.0), v = normalize(cameraPosition - vW);
          float dist = distance(cameraPosition, vW), glass = 0.0;
          float fade = 1.0 - smoothstep(900.0, 2600.0, dist), fine = 1.0 - smoothstep(150.0, 600.0, dist);
          if (vC.a > 0.999) {                              // крыша
            float st = floor(vS + 0.5);
            if (st > 0.5) alb *= 0.86 + 0.14 * step(0.5, fract(vUv.y * 2.2)) * fine + 0.1 * (vnoise(vW.xz * 0.9) - 0.5);   // черепица, шифер
            else alb *= 0.88 + 0.24 * (vnoise(vW.xz * 0.35) - 0.5) + 0.1 * (vnoise(vW.xz * 2.1) - 0.5) * fine;             // рубероид с пятнами
          } else if (vC.a > 0.002 && vUv.y > 0.0) {        // стена: фасад по стилю дома
            float seed = vC.a * 255.0, st = floor(vS + 0.5);
            vec2 cs = st < 0.5 ? vec2(3.0, 3.0) : st < 1.5 ? vec2(4.2, 2.9) : st < 2.5 ? vec2(3.2, 2.8) : st < 3.5 ? vec2(2.7, 3.3) : st < 4.5 ? vec2(6.0, 5.0) : st < 5.5 ? vec2(3.3, 3.2) : st < 6.5 ? vec2(1.6, 3.6) : st < 7.5 ? vec2(3.6, 3.4) : vec2(4.5, 7.0);
            vec2 cell = vUv / cs, f = fract(cell), id = floor(cell);
            float r1 = h2(id + seed), r2 = h2(id * 1.7 + seed + 3.1), col1 = h2(vec2(id.x, seed)), ground = step(id.y, 0.5);
            float win = 0.0, litP = 0.38, shop = 0.0;
            if (st < 0.5) win = rect(f, vec2(0.3, 0.34), vec2(0.72, 0.78));
            else if (st < 1.5) { win = rect(f, vec2(0.32, 0.36), vec2(0.68, 0.76)) * step(0.3, r1); litP = 0.3; }
            else if (st < 2.5) {                           // панельный: швы плит, балконы и лоджии столбцами
              win = rect(f, vec2(0.24, 0.32), vec2(0.76, 0.82));
              float seam = max(step(f.x, 0.025), step(f.y, 0.035)); alb *= 1.0 - 0.22 * seam * fine * (1.0 - smoothstep(0.02, 0.06, max(fwidth(cell.x), fwidth(cell.y))));
              float balc = step(0.62, col1) * rect(f, vec2(0.06, 0.06), vec2(0.94, 0.4)) * (1.0 - ground);
              alb = mix(alb, mix(vec3(0.5, 0.52, 0.5), vec3(0.34, 0.42, 0.5), step(0.5, h2(vec2(seed, 2.0)))) * (0.75 + 0.5 * r2), balc * 0.85); win *= 1.0 - balc;
            } else if (st < 3.5) {                         // кирпичный: высокие окна, пояса карнизов, кладка
              win = rect(f, vec2(0.3, 0.26), vec2(0.7, 0.84));
              alb *= 1.0 - 0.1 * step(0.5, fract(vUv.y * 6.0)) * fine;
              float band = step(f.y, 0.07); alb = mix(alb, alb * 1.25 + 0.03, band * 0.7);
              alb = mix(alb, alb * 1.18 + 0.02, (1.0 - win) * rect(f, vec2(0.25, 0.2), vec2(0.75, 0.9)) * 0.5);   // наличники
            } else if (st < 4.5) {                         // промзона: ленточное остекление под крышей пролёта, ворота
              win = rect(f, vec2(0.06, 0.62), vec2(0.94, 0.86)) * step(0.35, r1); litP = 0.12;
              float gate = ground * step(0.72, r1) * rect(f, vec2(0.2, 0.0), vec2(0.8, 0.8)); alb = mix(alb, vec3(0.1, 0.12, 0.14) + 0.1 * r2, gate * 0.9);
              alb *= 1.0 - 0.12 * step(0.92, fract(vUv.x * 0.8)) * fine;
            } else if (st < 5.5) {                         // гаражи: ворота разного цвета
              float gate = ground * rect(f, vec2(0.1, 0.0), vec2(0.9, 0.74));
              alb = mix(alb, mix(vec3(0.22, 0.12, 0.08), vec3(0.1, 0.2, 0.16), step(0.5, r1)) * (0.6 + 0.8 * r2), gate); litP = 0.0;
            } else if (st < 6.5) { win = rect(f, vec2(0.05, 0.05), vec2(0.95, 0.95)); glass = win; litP = 0.3; }   // сплошное остекление
            else if (st < 7.5) { win = rect(f, vec2(0.1, 0.3), vec2(0.9, 0.8)); litP = 0.14; }
            else { win = rect(f, vec2(0.38, 0.2), vec2(0.62, 0.8)) * step(length((f - vec2(0.5, 0.8)) * vec2(1.0, 0.5)), 0.2) + rect(f, vec2(0.38, 0.2), vec2(0.62, 0.72)); win = min(win, 1.0); litP = 0.1; }
            // первый этаж с витринами у многоэтажных и торговых зданий
            if (ground > 0.5 && (st < 0.5 || st > 5.5 && st < 6.5 || (st > 1.5 && st < 3.5 && h2(vec2(seed, 7.0)) > 0.45))) {
              shop = rect(f, vec2(0.07, 0.1), vec2(0.93, 0.74)); win = shop;
              float sign = rect(f, vec2(0.05, 0.8), vec2(0.95, 0.96)) * step(0.4, r2);
              vec3 sc = 0.5 + 0.5 * cos(6.283 * (r1 + vec3(0.0, 0.33, 0.67)));
              alb = mix(alb, sc * 0.5, sign * 0.8); emis += sc * sign * uNight * 0.7 * fade;
            }
            float aa = 1.0 - smoothstep(0.22, 0.55, max(fwidth(cell.x), fwidth(cell.y)));   // вдали окна сливаются в ровный тон, без ряби
            alb *= 1.0 - 0.16 * (1.0 - aa) * step(0.01, litP); win *= fade * aa;
            // стекло: тёмное днём, с отражением неба; ночью часть окон светится — тёплым, холодным или синим «телевизором»
            vec3 gl = mix(vec3(0.05, 0.075, 0.1), uFogCol * 0.55, 0.25 + 0.5 * pow(1.0 - max(dot(n, v), 0.0), 3.0) + 0.3 * glass);
            alb = mix(alb, gl, win * (0.82 + 0.1 * glass));
            float lit = step(1.0 - max(litP, shop * 0.75), r1) * uNight;
            vec3 lc = r2 < 0.62 ? vec3(1.0, 0.76, 0.42) : r2 < 0.85 ? vec3(1.0, 0.9, 0.72) : r2 < 0.95 ? vec3(0.8, 0.9, 1.0) : vec3(0.45, 0.6, 1.0);
            emis += lc * win * lit * (0.35 + 0.75 * h2(id * 2.3 + seed));
            emis += vec3(1.0, 0.75, 0.4) * (1.0 - fade * aa) * uNight * 0.11 * litP;   // вдали — общее свечение фасада
            alb *= 0.74 + 0.26 * smoothstep(0.0, 5.0, vUv.y);                              // затемнение у земли
            alb *= 1.0 - 0.1 * (vnoise(vec2(vUv.x * 0.15, vUv.y * 0.6) + seed) - 0.5);   // потёки
          }
          float sh = shadowAt(vW, n), d = max(dot(n, uSun), 0.0);
          vec3 c = alb * (uAmb * (0.75 + 0.25 * n.y) + uSunCol * d * sh + pointLights(vW, n)) + emis;
          c += uSunCol * pow(max(dot(reflect(-uSun, n), v), 0.0), 30.0) * glass * 0.7 * sh * (1.0 - uNight);   // блик на стекле
          gl_FragColor = vec4(sqrt(applyFog(c, dist)), 1.0);
        }`,
    });
  }

  private onTile(d: any) {
    this.pending.delete(d.tile);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    geo.setAttribute('aN', new THREE.BufferAttribute(d.nrm, 4, true));
    geo.setAttribute('aC', new THREE.BufferAttribute(d.col, 4, true));
    geo.setIndex(new THREE.BufferAttribute(d.idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mat);
    const tm: TileMesh = { mesh, idxCount: d.idx.length, bigIdx: d.bigIdx, vStart: d.vStart, base: d.base, sorted: d.sorted };
    this.tiles.set(d.tile, tm); this.group.add(mesh);
    for (let k = 0; k < tm.sorted.length; k++) if (this.map.bDamage[tm.sorted[k]] > 0) this.hideAt(tm, k);
  }

  update(cx: number, cz: number, camDist: number) {
    const mp = this.map, q = this.q;
    const R = Math.min(q.viewDist, 1500 + camDist * 1.6), lod = camDist > 14000 ? 0 : q.lodDist;
    const ci = (cx - mp.meta.x0) / TILE - 0.5, cj = (cz - mp.meta.z0) / TILE - 0.5, rt = R / TILE;
    const want: [number, number][] = [];
    for (let j = Math.max(0, Math.floor(cj - rt)); j <= Math.min(mp.tilesZ - 1, Math.ceil(cj + rt)); j++)
      for (let i = Math.max(0, Math.floor(ci - rt)); i <= Math.min(mp.tilesX - 1, Math.ceil(ci + rt)); i++) {
        const d = Math.hypot(i - ci, j - cj); if (d > rt) continue;
        const t = j * mp.tilesX + i, tm = this.tiles.get(t);
        if (tm) tm.mesh.geometry.setDrawRange(0, d * TILE > lod ? tm.bigIdx : tm.idxCount);
        else if (!this.pending.has(t) && mp.tileB[t].length) want.push([d, t]);
      }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, t] of want) {
      let w = 0; for (let i = 1; i < this.workers.length; i++) if (this.busy[i] < this.busy[w]) w = i;
      if (this.busy[w] >= 2) break;
      this.busy[w]++; this.pending.add(t); this.workers[w].postMessage({ type: 'build', tile: t, ids: mp.tileB[t] });
    }
    let tris = 0;
    for (const [t, tm] of this.tiles) {
      const i = t % mp.tilesX, j = (t / mp.tilesX) | 0;
      if (Math.hypot(i - ci, j - cj) > rt * 1.25 + 1) { this.group.remove(tm.mesh); tm.mesh.geometry.dispose(); this.tiles.delete(t); }
      else tris += tm.mesh.geometry.drawRange.count / 3;
    }
    this.stats.tiles = this.tiles.size; this.stats.tris = tris;
  }

  private hideAt(tm: TileMesh, k: number) {
    const pos = tm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute, p = pos.array as Float32Array, a = tm.vStart[k];
    for (let v = a + 1; v < tm.vStart[k + 1]; v++) { p[v * 3] = p[a * 3]; p[v * 3 + 1] = p[a * 3 + 1]; p[v * 3 + 2] = p[a * 3 + 2]; } // вырожденные треугольники не рисуются
    pos.needsUpdate = true;
  }

  /** Убирает здание из геометрии тайла — его теперь рисует модуль разрушений. */
  hide(b: number) {
    const [cx, cz] = this.map.bCenter(b), tm = this.tiles.get(this.map.tileIndex(cx, cz));
    if (!tm) return;
    const k = tm.sorted.indexOf(b); if (k >= 0) this.hideAt(tm, k);
  }

  /** Сброс разрушений: тайлы пересобираются. */
  reset() { for (const [t, tm] of this.tiles) { this.group.remove(tm.mesh); tm.mesh.geometry.dispose(); this.tiles.delete(t); } }
}
