// Здания: тайлы 1×1 км, геометрия строится в фоновых потоках, дальние тайлы рисуют только крупные дома.
import * as THREE from 'three';
import { MapData, TILE } from './map';
import { U, FOG_GLSL } from './env';
import { Quality } from './quality';

interface TileMesh { mesh: THREE.Mesh; idxCount: number; bigIdx: number; vStart: Uint32Array; base: Float32Array; sorted: Uint32Array }

export class Buildings {
  group = new THREE.Group();
  tiles = new Map<number, TileMesh>();
  private pending = new Set<number>();
  private workers: Worker[] = []; private busy: number[] = [];
  private mat: THREE.ShaderMaterial;
  stats = { tiles: 0, tris: 0 };

  constructor(private map: MapData, public q: Quality) {
    for (let i = 0; i < q.workers; i++) {
      const w = new Worker(new URL('./tileworker.ts', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', bPts: map.bPts, bStart: map.bStart, bH: map.bH, bType: map.bType, hgt: map.hgt, hNx: map.hNx, hNz: map.hNz, x0: map.meta.x0, z0: map.meta.z0, cell: map.meta.cell });
      w.onmessage = e => { this.busy[i]--; this.onTile(e.data); };
      this.workers.push(w); this.busy.push(0);
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...U }, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 aN; attribute vec4 aC; varying vec3 vN; varying vec4 vC; varying vec2 vUv; varying vec3 vW;
        void main(){ vN = aN.xyz; vC = aC; vUv = uv; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uSun, uSunCol, uAmb; uniform float uNight; varying vec3 vN; varying vec4 vC; varying vec2 vUv; varying vec3 vW;
        ${FOG_GLSL}
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){
          vec3 n = normalize(vN); vec3 alb = vC.rgb * vC.rgb; vec3 emis = vec3(0.0);
          float dist = distance(cameraPosition, vW);
          float burnt = step(vC.a, 0.002);             // альфа 0 — выгоревшее здание
          if (vC.a < 0.999 && burnt < 0.5) {            // стена: процедурные окна
            float seed = vC.a * 255.0;
            vec2 cell = vec2(vUv.x / 3.3, vUv.y / 3.0); vec2 f = fract(cell); vec2 id = floor(cell);
            float win = step(0.3, f.x) * step(f.x, 0.72) * step(0.34, f.y) * step(f.y, 0.78) * step(0.0, vUv.y);
            float fade = 1.0 - smoothstep(900.0, 2600.0, dist);
            win *= fade;
            float lit = step(0.62, h2(id + seed)) * uNight;
            alb = mix(alb, vec3(0.06, 0.085, 0.11), win * 0.8);
            emis = vec3(1.0, 0.78, 0.42) * win * lit * (0.5 + 0.6 * h2(id * 1.7 + seed));
            emis += vec3(1.0, 0.75, 0.4) * (1.0 - fade) * uNight * 0.1 * step(0.0, vUv.y);  // вдали — общее свечение фасада
            alb *= 0.9 + 0.1 * smoothstep(0.0, 4.0, vUv.y);
          }
          alb = mix(alb, vec3(0.012), burnt);
          float d = max(dot(n, uSun), 0.0);
          vec3 c = alb * (uAmb * (0.75 + 0.25 * n.y) + uSunCol * d) + emis;
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
    for (let k = 0; k < tm.sorted.length; k++) if (this.map.bDamage[tm.sorted[k]] > 0) this.applyDamage(tm, k);
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

  private applyDamage(tm: TileMesh, k: number) {
    const b = tm.sorted[k], dmg = this.map.bDamage[b], top = tm.base[k] + this.map.bHeight(b);
    const pos = tm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute, col = tm.mesh.geometry.getAttribute('aC') as THREE.BufferAttribute;
    const p = pos.array as Float32Array, c = col.array as Uint8Array, s = 1 - 0.75 * Math.min(1, dmg * 1.5);
    for (let v = tm.vStart[k]; v < tm.vStart[k + 1]; v++) {
      // неровная кромка обрушения
      const jag = dmg > 0.3 ? (Math.sin(p[v * 3] * 1.7) + Math.sin(p[v * 3 + 2] * 2.3)) * 0.8 * dmg : 0;
      if (p[v * 3 + 1] > top + jag) p[v * 3 + 1] = Math.max(tm.base[k] + 0.4, top + jag);
      c[v * 4] *= s; c[v * 4 + 1] *= s; c[v * 4 + 2] *= s;
      if (dmg > 0.3) c[v * 4 + 3] = 0;
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }

  /** Вызывается после изменения map.bDamage[b]. */
  damaged(b: number) {
    const [cx, cz] = this.map.bCenter(b), tm = this.tiles.get(this.map.tileIndex(cx, cz));
    if (!tm) return;
    const k = tm.sorted.indexOf(b); if (k >= 0) this.applyDamage(tm, k);
  }

  /** Сброс разрушений: тайлы пересобираются. */
  reset() { for (const [t, tm] of this.tiles) { this.group.remove(tm.mesh); tm.mesh.geometry.dispose(); this.tiles.delete(t); } }
}
