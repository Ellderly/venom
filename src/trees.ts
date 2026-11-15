// Деревья (объёмные, инстансами) и уличные фонари. Расстановка — в фоновом потоке, по тайлам вокруг камеры.
import * as THREE from 'three';
import { MapData, TILE } from './map';
import { U, LIT_GLSL } from './env';
import { Quality } from './quality';

/** Низкополигональные заготовки высотой 1: лиственное, сосна, тополь. aPart: 0 — ствол, 1 — крона. */
function treeGeometry(kind: number) {
  const parts: THREE.BufferGeometry[] = [], flags: number[] = [];
  const push = (g: THREE.BufferGeometry, crown: number) => { if (g.index) g = g.toNonIndexed(); g.computeVertexNormals(); parts.push(g); flags.push(crown); };
  const blob = (r: number, sy: number, x: number, y: number, z: number, det = 1) => { const g = new THREE.IcosahedronGeometry(r, det); g.scale(1, sy, 1); g.translate(x, y, z); return g; };
  if (kind === 0) { push(new THREE.CylinderGeometry(0.02, 0.036, 0.34, 5).translate(0, 0.17, 0), 0); push(blob(0.36, 0.92, 0, 0.64, 0), 1); push(blob(0.25, 0.85, 0.2, 0.5, 0.1, 0), 1); push(blob(0.23, 0.85, -0.18, 0.54, -0.13, 0), 1); push(blob(0.2, 0.8, 0.02, 0.5, -0.22, 0), 1); }
  else if (kind === 1) { push(new THREE.CylinderGeometry(0.016, 0.03, 0.72, 5).translate(0, 0.36, 0), 0); push(blob(0.2, 0.75, 0, 0.82, 0), 1); push(blob(0.13, 0.7, 0.1, 0.68, -0.06, 0), 1); }
  else { push(new THREE.CylinderGeometry(0.018, 0.03, 0.3, 5).translate(0, 0.15, 0), 0); push(blob(0.13, 3.3, 0, 0.56, 0), 1); }
  let n = 0; for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), part = new Float32Array(n); let o = 0;
  parts.forEach((p, k) => { const a = p.getAttribute('position'), b = p.getAttribute('normal'); pos.set(a.array as Float32Array, o * 3); nrm.set(b.array as Float32Array, o * 3); part.fill(flags[k], o, o + a.count); o += a.count; });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return g;
}

interface TreeTile { meshes: THREE.Mesh[]; lamps: THREE.Object3D[] }

export class Trees {
  group = new THREE.Group();      // деревья — отбрасывают тень
  lampGroup = new THREE.Group();  // фонари — нет
  private tiles = new Map<number, TreeTile>(); private pending = new Set<number>(); private worker: Worker | null = null; private busy = 0;
  private geos = [0, 1, 2].map(treeGeometry);
  private mat: THREE.ShaderMaterial; private bulbMat: THREE.ShaderMaterial; private poolMat: THREE.ShaderMaterial; private poolGeo: THREE.BufferGeometry;
  count = 0;

  constructor(private map: MapData, private q: Quality) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...U },
      vertexShader: `attribute vec4 iPos; attribute vec4 iVar; attribute float aPart; varying vec3 vW; varying vec3 vN; varying vec3 vC; uniform float uTime;
        void main(){
          float c = cos(iVar.x), s = sin(iVar.x); mat2 R = mat2(c, s, -s, c);
          vec3 p = position; p.xz = R * p.xz * iVar.z; p *= iPos.w;
          p.xz += aPart * position.y * position.y * iPos.w * 0.02 * vec2(sin(uTime * 1.1 + iPos.x * 0.07 + iPos.z * 0.05), cos(uTime * 0.9 + iPos.z * 0.06)); // ветер
          vN = normal; vN.xz = R * vN.xz; vW = iPos.xyz + p;
          float kind = iVar.w, hue = iVar.y;
          vec3 leaf = kind > 0.5 && kind < 1.5 ? mix(vec3(0.07, 0.16, 0.08), vec3(0.12, 0.22, 0.09), hue) : mix(vec3(0.13, 0.26, 0.07), vec3(0.27, 0.36, 0.1), hue);
          leaf *= 0.62 + 0.55 * smoothstep(0.35, 0.95, position.y);            // низ кроны в тени
          vC = mix(vec3(0.2, 0.15, 0.11), leaf, aPart);
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: `varying vec3 vW; varying vec3 vN; varying vec3 vC; ${LIT_GLSL}
        void main(){
          vec3 n = normalize(vN); float sh = shadowAt(vW, n);
          vec3 c = vC * (uAmb * (0.8 + 0.2 * n.y) + uSunCol * (0.25 + 0.75 * max(dot(n, uSun), 0.0)) * 0.9 * sh + pointLights(vW, n));
          gl_FragColor = vec4(sqrt(applyFog(c, distance(cameraPosition, vW))), 1.0);
        }`,
    });
    // фонари: светящаяся точка и пятно света на земле; работают только ночью
    this.bulbMat = new THREE.ShaderMaterial({
      uniforms: { uNight: U.uNight, uFogD: U.uFogD, uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aS; uniform float uScale, uFogD; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z; gl_PointSize = clamp(uScale * aS * 2.6 / d, 1.5, 22.0); vA = exp(-d * d * uFogD * uFogD) * clamp(2.0 - d / 9000.0, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uNight; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.2); gl_FragColor = vec4(vec3(1.0, 0.8, 0.5) * a * vA * uNight * 1.6, 1.0); }`,
    });
    this.poolMat = new THREE.ShaderMaterial({
      uniforms: { uNight: U.uNight, uFogD: U.uFogD }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12,
      vertexShader: `attribute vec4 iPos; uniform float uFogD; varying vec2 vUv; varying float vA;
        void main(){ vUv = position.xz; vec3 w = vec3(iPos.x, iPos.y, iPos.z) + position * 17.0 * iPos.w; vec4 mv = viewMatrix * vec4(w, 1.0); vA = exp(-mv.z * mv.z * uFogD * uFogD); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uNight; varying vec2 vUv; varying float vA; void main(){ float a = pow(max(0.0, 1.0 - length(vUv)), 1.8); gl_FragColor = vec4(vec3(1.0, 0.72, 0.4) * a * 0.3 * uNight * vA, 1.0); }`,
    });
    this.poolGeo = new THREE.BufferGeometry(); this.poolGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3)); this.poolGeo.setIndex([0, 2, 1, 0, 3, 2]);
    if (q.treeDist > 0) {
      const w = this.worker = new Worker(new URL('./treeworker.ts', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', aPts: map.aPts, aRing: map.aRing, aStart: map.aStart, aCls: map.aCls, lPts: map.lPts, lStart: map.lStart, lCls: map.lCls, bPts: map.bPts, bStart: map.bStart, hgt: map.hgt, hNx: map.hNx, hNz: map.hNz, x0: map.meta.x0, z0: map.meta.z0, cell: map.meta.cell });
      w.onmessage = e => { this.busy--; this.onTile(e.data); };
    }
  }

  private onTile(d: { tile: number; trees: Float32Array; lamps: Float32Array }) {
    if (!this.pending.delete(d.tile)) return; // тайл уже не нужен
    const mp = this.map, cx = mp.meta.x0 + (d.tile % mp.tilesX + 0.5) * TILE, cz = mp.meta.z0 + (((d.tile / mp.tilesX) | 0) + 0.5) * TILE, cy = mp.heightAt(cx, cz);
    const sphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), 760), tt: TreeTile = { meshes: [], lamps: [] }, n = d.trees.length / 8;
    for (let kind = 0; kind < 3; kind++) {
      let c = 0; for (let i = 0; i < n; i++) if (d.trees[i * 8 + 7] === kind) c++;
      if (!c) continue;
      const pos = new Float32Array(c * 4), vr = new Float32Array(c * 4); let o = 0;
      for (let i = 0; i < n; i++) if (d.trees[i * 8 + 7] === kind) { pos.set(d.trees.subarray(i * 8, i * 8 + 4), o * 4); vr.set(d.trees.subarray(i * 8 + 4, i * 8 + 8), o * 4); o++; }
      const g = new THREE.InstancedBufferGeometry(); const src = this.geos[kind];
      for (const a of ['position', 'normal', 'aPart']) g.setAttribute(a, src.getAttribute(a));
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 4)); g.setAttribute('iVar', new THREE.InstancedBufferAttribute(vr, 4)); g.instanceCount = c; g.boundingSphere = sphere;
      const m = new THREE.Mesh(g, this.mat); tt.meshes.push(m); this.group.add(m);
    }
    this.count += n;
    const ln = d.lamps.length / 4;
    if (ln && this.q.lamps) {
      const bp = new Float32Array(ln * 3), bs = new Float32Array(ln);
      for (let i = 0; i < ln; i++) { bp[i * 3] = d.lamps[i * 4]; bp[i * 3 + 1] = d.lamps[i * 4 + 1]; bp[i * 3 + 2] = d.lamps[i * 4 + 2]; bs[i] = d.lamps[i * 4 + 3]; d.lamps[i * 4 + 1] -= bs[i] > 1.1 ? 9.6 : 7.6; }
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bg.setAttribute('aS', new THREE.BufferAttribute(bs, 1)); bg.boundingSphere = sphere;
      const pg = new THREE.InstancedBufferGeometry(); pg.setAttribute('position', this.poolGeo.getAttribute('position')); pg.setIndex(this.poolGeo.getIndex()); pg.setAttribute('iPos', new THREE.InstancedBufferAttribute(d.lamps, 4)); pg.instanceCount = ln; pg.boundingSphere = sphere;
      const bulbs = new THREE.Points(bg, this.bulbMat), pools = new THREE.Mesh(pg, this.poolMat); bulbs.renderOrder = 12; pools.renderOrder = 11;
      tt.lamps.push(bulbs, pools); this.lampGroup.add(bulbs, pools);
    }
    this.tiles.set(d.tile, tt);
  }
  private dropTile(t: number, tt: TreeTile) {
    for (const m of tt.meshes) { this.group.remove(m); this.count -= (m.geometry as THREE.InstancedBufferGeometry).instanceCount; m.geometry.dispose(); }
    for (const l of tt.lamps) { this.lampGroup.remove(l); (l as THREE.Mesh).geometry.dispose(); }
    this.tiles.delete(t);
  }

  update(cx: number, cz: number, camDist: number, viewH: number) {
    if (!this.worker) return;
    const mp = this.map, R = camDist > 7000 ? 0 : Math.min(this.q.treeDist, 700 + camDist * 1.3);
    this.lampGroup.visible = U.uNight.value > 0.03; this.bulbMat.uniforms.uScale.value = viewH * 0.5;
    const ci = (cx - mp.meta.x0) / TILE - 0.5, cj = (cz - mp.meta.z0) / TILE - 0.5, rt = R / TILE + 0.5;
    let best = -1, bd = 1e9;
    if (R > 0) for (let j = Math.max(0, Math.floor(cj - rt)); j <= Math.min(mp.tilesZ - 1, Math.ceil(cj + rt)); j++)
      for (let i = Math.max(0, Math.floor(ci - rt)); i <= Math.min(mp.tilesX - 1, Math.ceil(ci + rt)); i++) {
        const dd = Math.hypot(i - ci, j - cj), t = j * mp.tilesX + i; if (dd > rt || this.tiles.has(t) || this.pending.has(t)) continue;
        if (dd < bd) { bd = dd; best = t; }
      }
    if (best >= 0 && this.busy < 2) {
      const i = best % mp.tilesX, j = (best / mp.tilesX) | 0; const B: number[] = [];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < mp.tilesX && jj < mp.tilesZ) B.push(...mp.tileB[jj * mp.tilesX + ii]); } // здания соседей у границ
      this.busy++; this.pending.add(best);
      this.worker.postMessage({ type: 'build', tile: best, x0: mp.meta.x0 + i * TILE, z0: mp.meta.z0 + j * TILE, step: this.q.treeStep, A: mp.tileA[best], L: mp.tileL[best], B });
    }
    for (const [t, tt] of this.tiles) { const i = t % mp.tilesX, j = (t / mp.tilesX) | 0; if (Math.hypot(i - ci, j - cj) > rt * 1.3 + 1) this.dropTile(t, tt); }
    for (const t of this.pending) { const i = t % mp.tilesX, j = (t / mp.tilesX) | 0; if (Math.hypot(i - ci, j - cj) > rt * 1.3 + 1) this.pending.delete(t); }
  }
}
