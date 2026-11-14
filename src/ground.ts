// Земля: общая сетка рельефа с обзорной текстурой + детальные тайлы вокруг камеры.
import * as THREE from 'three';
import { MapData, TILE } from './map';
import { U, FOG_GLSL } from './env';
import { Quality } from './quality';

const AREA_COL = ['#3d6a86', '#4d6b3a', '#6f9350', '#a9a79b', '#9c978d', '#b3ae78', '#d6cb9f', '#8d8a86'];
const LAND = '#8c9a68';
const ROAD_W = [24, 17, 13, 10, 7.5, 4.5];

function groundMaterial(tex: THREE.Texture, offset: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, ...U },
    polygonOffset: offset, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normal; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 uSun, uSunCol, uAmb; uniform float uNight; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      ${FOG_GLSL}
      void main(){
        vec3 t = texture2D(map, vUv).rgb; t = t*t;
        vec3 n = normalize(vN);
        float water = step(t.b, 0.34) * step(t.r, 0.09) * step(0.1, t.b);
        vec3 c = t * (uAmb + uSunCol * max(dot(n, uSun), 0.0) * 0.85);
        vec3 v = normalize(cameraPosition - vW);
        c += water * uSunCol * pow(max(dot(reflect(-uSun, vec3(0.,1.,0.)), v), 0.0), 60.0) * 0.6;
        c += water * uFogCol * 0.18 * pow(1.0 - max(v.y, 0.0), 3.0);
        c = applyFog(c, distance(cameraPosition, vW));
        gl_FragColor = vec4(sqrt(c), 1.0);
      }`,
  });
}

export class Ground {
  group = new THREE.Group();
  private detail = new Map<number, { mesh: THREE.Mesh; tex: THREE.CanvasTexture; used: number }>();
  private frame = 0;

  constructor(private map: MapData, private q: Quality, private maxAniso: number) {}

  /** Обзорная текстура всей карты. Рисуется один раз при загрузке. */
  async buildOverview(progress: (p: number) => void) {
    const m = this.map.meta, W = m.x1 - m.x0, H = m.z1 - m.z0;
    const cw = this.q.overviewRes, ch = Math.round(cw * H / W);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d')!; const s = cw / W;
    g.setTransform(s, 0, 0, s, -m.x0 * s, -m.z0 * s);
    g.fillStyle = LAND; g.fillRect(m.x0, m.z0, W, H);
    const all = (n: number) => Array.from({ length: n }, (_, i) => i);
    this.drawAreas(g, all(this.map.aN)); progress(0.3); await new Promise(r => setTimeout(r));
    this.drawLines(g, all(this.map.lN), 1 / s, 3); progress(0.6); await new Promise(r => setTimeout(r));
    // контуры зданий: издалека город читается и там, где геометрия не загружена
    const mp = this.map, p = mp.bPts; g.fillStyle = '#b4aea2';
    g.beginPath();
    for (let b = 0; b < mp.bN; b++) {
      const a = mp.bStart[b], e = mp.bStart[b + 1];
      g.moveTo(p[a * 2], p[a * 2 + 1]); for (let i = a + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.closePath();
      if (b % 4000 === 3999) { g.fill(); g.beginPath(); }
    }
    g.fill(); progress(0.9);
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = this.maxAniso; tex.flipY = false; tex.generateMipmaps = true;
    // общая сетка рельефа
    const nx = mp.hNx, nz = mp.hNz, geo = new THREE.BufferGeometry();
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    for (let j = 0, k = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) {
      pos[k * 3] = m.x0 + i * m.cell; pos[k * 3 + 1] = mp.hgt[k] / 10; pos[k * 3 + 2] = m.z0 + j * m.cell;
      uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = j / (nz - 1);
    }
    for (let j = 0, t = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i; idx[t++] = a; idx[t++] = a + nx + 1; idx[t++] = a + 1; idx[t++] = a; idx[t++] = a + nx; idx[t++] = a + nx + 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, groundMaterial(tex, false)); mesh.frustumCulled = false; this.group.add(mesh);
    // «подложка» за границей карты, чтобы не было края мира
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(600000, 600000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { ...U }, vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uSun, uSunCol, uAmb; varying vec3 vW; ${FOG_GLSL}
        void main(){ vec3 c = vec3(0.26,0.32,0.14) * (uAmb + uSunCol*max(uSun.y,0.0)*0.85); gl_FragColor = vec4(sqrt(applyFog(c, distance(cameraPosition, vW))),1.0); }`,
    }));
    skirt.position.set((m.x0 + m.x1) / 2, m.hmin - 3, (m.z0 + m.z1) / 2); this.group.add(skirt);
  }

  private drawAreas(g: CanvasRenderingContext2D, ids: number[]) {
    const mp = this.map, p = mp.aPts;
    for (const a of ids) {
      g.fillStyle = AREA_COL[mp.aCls[a]]; g.beginPath();
      for (let r = mp.aStart[a]; r < mp.aStart[a + 1]; r++) {
        const s = mp.aRing[r], e = mp.aRing[r + 1];
        g.moveTo(p[s * 2], p[s * 2 + 1]); for (let i = s + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.closePath();
      }
      g.fill('evenodd');
    }
  }

  /** minPx — минимальная толщина в мировых метрах на 1 пиксель; maxCls — самые мелкие дороги, которые ещё рисуем. */
  private drawLines(g: CanvasRenderingContext2D, ids: number[], mPerPx: number, maxCls: number) {
    const mp = this.map, p = mp.lPts; g.lineCap = 'round'; g.lineJoin = 'round';
    const stroke = (l: number) => { const s = mp.lStart[l], e = mp.lStart[l + 1]; g.beginPath(); g.moveTo(p[s * 2], p[s * 2 + 1]); for (let i = s + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.stroke(); };
    const detail = mPerPx < 2.5;
    for (const pass of [0, 1, 2]) for (const l of ids) { // 0 — вода, 1 — дороги на земле, 2 — мосты
      const c = mp.lCls[l] & 0x3f, bridge = (mp.lCls[l] & 0x40) !== 0;
      if (c >= 9) { if (pass !== 0) continue; g.strokeStyle = AREA_COL[0]; g.lineWidth = Math.max(c === 9 ? 14 : 3, mPerPx); stroke(l); continue; }
      if (pass === 0 || (pass === 2) !== bridge) continue;
      if (c === 8) { if (!detail && mPerPx > 6) continue; g.strokeStyle = '#4a4744'; g.lineWidth = Math.max(3.2, mPerPx * 0.9); stroke(l); continue; }
      if (c > maxCls) continue;
      const w = Math.max(ROAD_W[c], mPerPx * (c <= 1 ? 1.6 : 1.1));
      if (detail || bridge) { g.strokeStyle = bridge ? '#8f8d88' : '#6e6c66'; g.lineWidth = w + (bridge ? 5 : 2.4); stroke(l); }
      g.strokeStyle = c <= 1 ? '#4c4d50' : '#56575a'; g.lineWidth = w; stroke(l);
      if (detail && c <= 3) { g.strokeStyle = 'rgba(235,235,225,0.75)'; g.lineWidth = 0.35; g.setLineDash(c <= 1 ? [] : [4, 6]); stroke(l); g.setLineDash([]); }
    }
  }

  private makeDetail(t: number) {
    const mp = this.map, m = mp.meta, res = this.q.detailRes;
    const tx = t % mp.tilesX, tz = (t / mp.tilesX) | 0, x0 = m.x0 + tx * TILE, z0 = m.z0 + tz * TILE;
    const cv = document.createElement('canvas'); cv.width = cv.height = res;
    const g = cv.getContext('2d')!; const s = res / TILE;
    g.setTransform(s, 0, 0, s, -x0 * s, -z0 * s);
    g.fillStyle = LAND; g.fillRect(x0, z0, TILE, TILE);
    this.drawAreas(g, mp.tileA[t]); this.drawLines(g, mp.tileL[t], 1 / s, 5);
    const tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.anisotropy = this.maxAniso;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const n = 17, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), nr = new Float32Array(n * n * 3), idx = new Uint16Array(16 * 16 * 6);
    const c = m.cell;
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const x = x0 + i * c, z = z0 + j * c;
      pos[k * 3] = x; pos[k * 3 + 1] = mp.heightAt(x, z); pos[k * 3 + 2] = z; uv[k * 2] = i / 16; uv[k * 2 + 1] = j / 16;
      const dx = mp.heightAt(x + c, z) - mp.heightAt(x - c, z), dz = mp.heightAt(x, z + c) - mp.heightAt(x, z - c), l = Math.hypot(dx, 2 * c, dz);
      nr[k * 3] = -dx / l; nr[k * 3 + 1] = 2 * c / l; nr[k * 3 + 2] = -dz / l;
    }
    for (let j = 0, q = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const a = j * n + i; idx[q++] = a; idx[q++] = a + n + 1; idx[q++] = a + 1; idx[q++] = a; idx[q++] = a + n; idx[q++] = a + n + 1; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, groundMaterial(tex, true)); mesh.renderOrder = 1;
    this.group.add(mesh);
    return { mesh, tex, used: this.frame };
  }

  /** Раз в кадр: держим детальные тайлы вокруг точки взгляда, не более одного нового за кадр. */
  update(tx: number, tz: number, camDist: number) {
    this.frame++;
    const mp = this.map, R = camDist > 9000 ? -1 : this.q.detailRadius + (camDist > 2500 ? 1 : 0);
    const ci = Math.floor((tx - mp.meta.x0) / TILE), cj = Math.floor((tz - mp.meta.z0) / TILE);
    let best = -1, bestD = 1e9;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= mp.tilesX || j >= mp.tilesZ) continue;
      const t = j * mp.tilesX + i, d = this.detail.get(t);
      if (d) d.used = this.frame; else { const dd = (i - ci) ** 2 + (j - cj) ** 2; if (dd < bestD) { bestD = dd; best = t; } }
    }
    if (best >= 0) this.detail.set(best, this.makeDetail(best));
    const cap = (2 * this.q.detailRadius + 3) ** 2 + 8;
    if (this.detail.size > cap) for (const [t, d] of this.detail) if (d.used < this.frame - 120) {
      this.group.remove(d.mesh); d.mesh.geometry.dispose(); d.tex.dispose(); (d.mesh.material as THREE.Material).dispose(); this.detail.delete(t);
      if (this.detail.size <= cap) break;
    }
  }
}
