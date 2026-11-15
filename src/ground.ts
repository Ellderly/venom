// Земля: общая сетка рельефа с обзорной текстурой + детальные тайлы 1×1 км вокруг камеры + ближние тайлы 250×250 м
// с разметкой, переходами и шпалами. Вода, мелкая фактура поверхностей, тени и свет взрывов — в шейдере.
import * as THREE from 'three';
import { MapData, TILE } from './map';
import { U, LIT_GLSL } from './env';
import { Quality } from './quality';
import { Painter, LAND } from './groundpaint';

const MICRO = 250;

function groundMaterial(tex: THREE.Texture, offset: number) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, ...U },
    polygonOffset: offset > 0, polygonOffsetFactor: -2 * offset, polygonOffsetUnits: -4 * offset,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normal; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      ${LIT_GLSL}
      float wave(vec2 p){ return vnoise(p * 0.07 + uTime * vec2(0.13, 0.08)) + 0.5 * vnoise(p * 0.23 - uTime * vec2(0.21, 0.15)) + 0.25 * vnoise(p * 0.61 + uTime * vec2(-0.3, 0.27)); }
      void main(){
        vec3 t = texture2D(map, vUv).rgb; t = t*t;
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
        float dist = distance(cameraPosition, vW), near = 1.0 - smoothstep(120.0, 1100.0, dist);
        float water = step(t.r * 1.5, t.b) * step(t.g * 1.08, t.b);
        vec3 c;
        if (water > 0.5) {
          float k = 1.0 - smoothstep(600.0, 5000.0, dist), e = 0.7, h0 = wave(vW.xz);
          vec3 wn = normalize(vec3((h0 - wave(vW.xz + vec2(e, 0.0))) * 0.55 * k, 1.0, (h0 - wave(vW.xz + vec2(0.0, e))) * 0.55 * k));
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, v), 0.0), 5.0), sh = shadowAt(vW, wn);
          vec3 refl = reflect(-v, wn);
          vec3 sky = mix(uFogCol, uAmb * 1.25 + uSunCol * 0.1, clamp(refl.y * 1.6, 0.0, 1.0));
          vec3 deep = t * (uAmb * 0.9 + uSunCol * max(uSun.y, 0.0) * 0.55 * (0.4 + 0.6 * sh));
          c = mix(deep, sky, fres * 0.85);
          c += uSunCol * (pow(max(dot(reflect(-uSun, wn), v), 0.0), 220.0) * 3.0 + pow(max(dot(reflect(-uSun, wn), v), 0.0), 24.0) * 0.12) * sh * (1.0 - uNight * 0.6);
          c += pointLights(vW, wn) * 0.35;
        } else {
          // мелкая фактура: трава пятнами, асфальт и бетон зерном; вдали остаются только крупные пятна
          float sat = max(t.r, max(t.g, t.b)) - min(t.r, min(t.g, t.b));
          float green = smoothstep(0.015, 0.07, t.g - max(t.r, t.b)), grey = 1.0 - smoothstep(0.01, 0.05, sat);
          float big = vnoise(vW.xz * 0.012) - 0.5, mid = vnoise(vW.xz * 0.11) - 0.5, fine = vnoise(vW.xz * 1.7) - 0.5, grain = hash12(floor(vW.xz * 6.0)) - 0.5;
          t *= 1.0 + green * (big * 0.28 + (mid * 0.3 + fine * 0.22) * near) + grey * ((fine * 0.14 + grain * 0.1) * near + big * 0.06) + (1.0 - green) * (1.0 - grey) * (mid * 0.16 * near + big * 0.1);
          t = mix(t, t * vec3(1.06, 1.0, 0.86), green * smoothstep(0.1, 0.4, big + 0.5 * mid) * 0.6);   // выгоревшие участки травы
          float sh = shadowAt(vW, n);
          c = t * (uAmb + uSunCol * max(dot(n, uSun), 0.0) * 0.85 * sh + pointLights(vW, n));
        }
        c = applyFog(c, dist);
        gl_FragColor = vec4(sqrt(c), 1.0);
      }`,
  });
}

interface Tile { mesh: THREE.Mesh; tex: THREE.Texture; used: number }

export class Ground {
  group = new THREE.Group();
  private detail = new Map<number, Tile>(); private micro = new Map<number, Tile>();
  private frame = 0; private painter: Painter; private worker: Worker; private pending = new Map<string, { store: Map<number, Tile>; t: number; x0: number; z0: number; size: number; level: number }>();
  /** Обзорная картинка всей карты — её же показывают тактическая карта и мини-карта. */
  overview!: HTMLCanvasElement;

  constructor(private map: MapData, private q: Quality, private maxAniso: number) {
    const mp = map, data = { aPts: mp.aPts, aRing: mp.aRing, aStart: mp.aStart, aCls: mp.aCls, lPts: mp.lPts, lStart: mp.lStart, lCls: mp.lCls, lineOnBridge: mp.lineOnBridge, bPts: mp.bPts, bStart: mp.bStart };
    this.painter = new Painter(data);
    // тайлы вокруг камеры рисует фоновый поток: в основном это давало подвисание на каждый новый тайл
    this.worker = new Worker(new URL('./groundworker.ts', import.meta.url), { type: 'module' });
    this.worker.postMessage({ type: 'init', map: data });
    this.worker.onmessage = e => this.onTile(e.data.key, e.data.bitmap);
  }

  /** Обзорная текстура всей карты. Рисуется один раз при загрузке. */
  async buildOverview(progress: (p: number) => void) {
    const m = this.map.meta, W = m.x1 - m.x0, H = m.z1 - m.z0;
    const cw = this.q.overviewRes, ch = Math.round(cw * H / W);
    const cv = this.overview = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d')!; const s = cw / W;
    g.setTransform(s, 0, 0, s, -m.x0 * s, -m.z0 * s);
    g.fillStyle = LAND; g.fillRect(m.x0, m.z0, W, H);
    const all = (n: number) => Array.from({ length: n }, (_, i) => i);
    this.painter.drawAreas(g, all(this.map.aN), 1 / s); progress(0.3); await new Promise(r => setTimeout(r));
    this.painter.drawLines(g, all(this.map.lN), 1 / s, 3); progress(0.6); await new Promise(r => setTimeout(r));
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
    const mesh = new THREE.Mesh(geo, groundMaterial(tex, 0)); mesh.frustumCulled = false; this.group.add(mesh);
    // «подложка» за границей карты, чтобы не было края мира
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(600000, 600000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { ...U }, vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec3 vW; ${LIT_GLSL}
        void main(){ vec3 c = vec3(0.26,0.32,0.14) * (1.0 + 0.3 * (vnoise(vW.xz * 0.0015) - 0.5)) * (uAmb + uSunCol*max(uSun.y,0.0)*0.85); gl_FragColor = vec4(sqrt(applyFog(c, distance(cameraPosition, vW))),1.0); }`,
    }));
    skirt.position.set((m.x0 + m.x1) / 2, m.hmin - 3, (m.z0 + m.z1) / 2); this.group.add(skirt);
  }

  /** Запрос тайла земли у фонового потока: size — сторона в метрах (1000 или 250), t — индекс километрового тайла, из которого берутся объекты. */
  private request(store: Map<number, Tile>, id: number, x0: number, z0: number, size: number, res: number, t: number, level: number) {
    const mp = this.map, key = `${level}:${id}`; if (this.pending.has(key) || this.pending.size >= 3) return;
    const B = mp.buildingsNear(x0 + size / 2, z0 + size / 2, size * 0.72 + 60).filter(b => mp.bH[b]); // дома, заменённые отдельными моделями, тени не дают
    this.pending.set(key, { store, t: id, x0, z0, size, level });
    this.worker.postMessage({ type: 'tile', key, x0, z0, size, res, A: mp.tileA[t], L: mp.tileL[t], B });
  }
  /** Текстура готова: собираем сетку тайла. */
  private onTile(key: string, bitmap: ImageBitmap) {
    const rq = this.pending.get(key); if (!rq) { bitmap.close(); return; } this.pending.delete(key);
    const { store, x0, z0, size, level } = rq, mp = this.map, m = mp.meta;
    const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement); tex.flipY = false; tex.anisotropy = this.maxAniso; tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const c = m.cell, q = Math.round(size / c), n = q + 1, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), nr = new Float32Array(n * n * 3), idx = new Uint16Array(q * q * 6);
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const x = x0 + i * c, z = z0 + j * c;
      pos[k * 3] = x; pos[k * 3 + 1] = mp.heightAt(x, z); pos[k * 3 + 2] = z; uv[k * 2] = i / q; uv[k * 2 + 1] = j / q;
      const dx = mp.heightAt(x + c, z) - mp.heightAt(x - c, z), dz = mp.heightAt(x, z + c) - mp.heightAt(x, z - c), l = Math.hypot(dx, 2 * c, dz);
      nr[k * 3] = -dx / l; nr[k * 3 + 1] = 2 * c / l; nr[k * 3 + 2] = -dz / l;
    }
    for (let j = 0, o = 0; j < q; j++) for (let i = 0; i < q; i++) { const a = j * n + i; idx[o++] = a; idx[o++] = a + n + 1; idx[o++] = a + 1; idx[o++] = a; idx[o++] = a + n; idx[o++] = a + n + 1; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, groundMaterial(tex, level)); mesh.renderOrder = level;
    this.group.add(mesh);
    store.set(rq.t, { mesh, tex, used: this.frame });
    this.drop(store, store === this.detail ? (2 * this.q.detailRadius + 3) ** 2 + 8 : 60);
  }
  private drop(store: Map<number, Tile>, cap: number) {
    if (store.size > cap) for (const [t, d] of store) if (d.used < this.frame - 120) {
      this.group.remove(d.mesh); d.mesh.geometry.dispose(); d.tex.dispose(); (d.mesh.material as THREE.Material).dispose(); store.delete(t);
      if (store.size <= cap) break;
    }
  }

  /** Раз в кадр: держим детальные тайлы вокруг точки взгляда, не более одного нового за кадр. */
  update(tx: number, tz: number, camDist: number) {
    this.frame++;
    const mp = this.map, m = mp.meta, R = camDist > 9000 ? -1 : this.q.detailRadius + (camDist > 2500 ? 1 : 0);
    const ci = Math.floor((tx - m.x0) / TILE), cj = Math.floor((tz - m.z0) / TILE);
    let best = -1, bestD = 1e9;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= mp.tilesX || j >= mp.tilesZ) continue;
      const t = j * mp.tilesX + i, d = this.detail.get(t);
      if (d) d.used = this.frame; else if (!this.pending.has('1:' + t)) { const dd = (i - ci) ** 2 + (j - cj) ** 2; if (dd < bestD) { bestD = dd; best = t; } }
    }
    if (best >= 0) { this.request(this.detail, best, m.x0 + (best % mp.tilesX) * TILE, m.z0 + ((best / mp.tilesX) | 0) * TILE, TILE, this.q.detailRes, best, 1); return; }
    // ближние тайлы: только когда камера низко и километровые уже готовы
    if (!this.q.microRes || camDist > 1500) return;
    const k = TILE / MICRO, nx = mp.tilesX * k, nz = mp.tilesZ * k, mi = Math.floor((tx - m.x0) / MICRO), mj = Math.floor((tz - m.z0) / MICRO), MR = camDist < 500 ? 2 : 3;
    best = -1; bestD = 1e9;
    for (let j = mj - MR; j <= mj + MR; j++) for (let i = mi - MR; i <= mi + MR; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const t = j * nx + i, d = this.micro.get(t);
      if (d) d.used = this.frame; else if (!this.pending.has('2:' + t)) { const dd = (i - mi) ** 2 + (j - mj) ** 2; if (dd < bestD) { bestD = dd; best = t; } }
    }
    if (best >= 0) { const i = best % nx, j = (best / nx) | 0; this.request(this.micro, best, m.x0 + i * MICRO, m.z0 + j * MICRO, MICRO, this.q.microRes, ((j / k) | 0) * mp.tilesX + ((i / k) | 0), 2); }
  }
}
