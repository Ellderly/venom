// Земля: общая сетка рельефа с обзорной текстурой + детальные тайлы 1×1 км вокруг камеры + ближние тайлы 250×250 м
// с разметкой, переходами и шпалами. Вода, мелкая фактура поверхностей, тени и свет взрывов — в шейдере.
import * as THREE from 'three';
import { MapData, TILE, ROAD_W } from './map';
import { U, LIT_GLSL } from './env';
import { Quality } from './quality';

//                 вода       лес        парк       жилое      промзона   поле       песок      ж/д
const AREA_COL = ['#3d6a86', '#3f5c33', '#6f9350', '#a9a79b', '#9c978d', '#b3ae78', '#d6cb9f', '#8d8a86'];
const LAND = '#8c9a68', SHALLOW = '#6f9db0';
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

/** Узор крон: сверху лес выглядит не ровной заливкой, а пятнами деревьев. Размер плитки — 64 м. */
function canopyPattern() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 128, y = rnd() * 128, r = 3.5 + rnd() * 5, l = rnd();
    for (const [ox, oy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) { // плитка без швов
      const gr = g.createRadialGradient(x + ox - r * 0.3, y + oy - r * 0.3, 0, x + ox, y + oy, r);
      gr.addColorStop(0, `rgba(${90 + l * 50},${125 + l * 45},${60 + l * 30},0.55)`); gr.addColorStop(0.7, `rgba(${40 + l * 30},${70 + l * 30},${30 + l * 20},0.45)`); gr.addColorStop(1, 'rgba(20,35,15,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.283); g.fill();
    }
  }
  return c;
}

interface Tile { mesh: THREE.Mesh; tex: THREE.CanvasTexture; used: number }

export class Ground {
  group = new THREE.Group();
  private detail = new Map<number, Tile>(); private micro = new Map<number, Tile>();
  private frame = 0; private canopy = canopyPattern();
  /** Обзорная картинка всей карты — её же показывают тактическая карта и мини-карта. */
  overview!: HTMLCanvasElement;

  constructor(private map: MapData, private q: Quality, private maxAniso: number) {}

  /** Обзорная текстура всей карты. Рисуется один раз при загрузке. */
  async buildOverview(progress: (p: number) => void) {
    const m = this.map.meta, W = m.x1 - m.x0, H = m.z1 - m.z0;
    const cw = this.q.overviewRes, ch = Math.round(cw * H / W);
    const cv = this.overview = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d')!; const s = cw / W;
    g.setTransform(s, 0, 0, s, -m.x0 * s, -m.z0 * s);
    g.fillStyle = LAND; g.fillRect(m.x0, m.z0, W, H);
    const all = (n: number) => Array.from({ length: n }, (_, i) => i);
    this.drawAreas(g, all(this.map.aN), 1 / s); progress(0.3); await new Promise(r => setTimeout(r));
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
    const mesh = new THREE.Mesh(geo, groundMaterial(tex, 0)); mesh.frustumCulled = false; this.group.add(mesh);
    // «подложка» за границей карты, чтобы не было края мира
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(600000, 600000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { ...U }, vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec3 vW; ${LIT_GLSL}
        void main(){ vec3 c = vec3(0.26,0.32,0.14) * (1.0 + 0.3 * (vnoise(vW.xz * 0.0015) - 0.5)) * (uAmb + uSunCol*max(uSun.y,0.0)*0.85); gl_FragColor = vec4(sqrt(applyFog(c, distance(cameraPosition, vW))),1.0); }`,
    }));
    skirt.position.set((m.x0 + m.x1) / 2, m.hmin - 3, (m.z0 + m.z1) / 2); this.group.add(skirt);
  }

  private areaPath(g: CanvasRenderingContext2D, a: number) {
    const mp = this.map, p = mp.aPts; g.beginPath();
    for (let r = mp.aStart[a]; r < mp.aStart[a + 1]; r++) {
      const s = mp.aRing[r], e = mp.aRing[r + 1];
      g.moveTo(p[s * 2], p[s * 2 + 1]); for (let i = s + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.closePath();
    }
  }
  private drawAreas(g: CanvasRenderingContext2D, ids: number[], mPerPx: number) {
    const mp = this.map, pat = g.createPattern(this.canopy, 'repeat')!; pat.setTransform(new DOMMatrix().scale(0.5)); // 128 пикселей узора = 64 м
    for (const a of ids) {
      const c = mp.aCls[a]; g.fillStyle = AREA_COL[c]; this.areaPath(g, a); g.fill('evenodd');
      if (c === 1) { g.fillStyle = pat; g.fill('evenodd'); }
      else if (c === 2 && mPerPx < 6) { g.globalAlpha = 0.3; g.fillStyle = pat; g.fill('evenodd'); g.globalAlpha = 1; }
      else if (c === 0) { // мелководье у берега: светлая кромка внутри контура воды
        g.save(); g.clip('evenodd'); g.strokeStyle = SHALLOW; g.lineJoin = 'round';
        g.globalAlpha = 0.13; for (const w of [120, 96, 74, 54, 36, 20]) { g.lineWidth = Math.max(w, mPerPx * w / 20); g.stroke(); } // плавный переход к глубине
        g.restore();
      }
    }
  }

  /** mPerPx — метров на пиксель; maxCls — самые мелкие дороги, которые ещё рисуем. */
  private drawLines(g: CanvasRenderingContext2D, ids: number[], mPerPx: number, maxCls: number) {
    const mp = this.map, p = mp.lPts; g.lineCap = 'round'; g.lineJoin = 'round';
    const path = (l: number) => { const s = mp.lStart[l], e = mp.lStart[l + 1]; g.beginPath(); g.moveTo(p[s * 2], p[s * 2 + 1]); for (let i = s + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); };
    const stroke = (l: number, col: string, w: number, dash?: number[]) => { g.strokeStyle = col; g.lineWidth = w; if (dash) { g.setLineDash(dash); g.lineCap = 'butt'; } path(l); g.stroke(); if (dash) { g.setLineDash([]); g.lineCap = 'round'; } };
    const detail = mPerPx < 2.5, fine = mPerPx < 0.7;
    const roads: number[] = [], rails: number[] = [];
    for (const l of ids) {
      const c = mp.lCls[l] & 0x3f;
      if (c >= 9) { stroke(l, AREA_COL[0], Math.max(c === 9 ? 14 : 3, mPerPx)); continue; } // реки и ручьи
      if (mp.lineOnBridge[l]) { if (detail) stroke(l, 'rgba(0,0,0,0.16)', (c === 8 ? 6 : ROAD_W[c]) + 4); continue; } // мост — отдельная 3D-модель, на земле только тень
      if (c === 8) { if (detail || mPerPx <= 6) rails.push(l); } else if (c <= maxCls) roads.push(l);
    }
    const W = (l: number) => { const c = mp.lCls[l] & 0x3f; return Math.max(ROAD_W[c], mPerPx * (c <= 1 ? 1.6 : 1.1)); };
    // слоями, чтобы на перекрёстках асфальт перекрывал бордюры соседних дорог
    if (detail) for (const l of roads) { const c = mp.lCls[l] & 0x3f; stroke(l, c <= 4 ? '#9a978f' : '#85837c', W(l) + (c <= 4 ? (fine ? 6 : 4) : 1.6)); }      // тротуар
    if (fine) for (const l of roads) if ((mp.lCls[l] & 0x3f) <= 4) stroke(l, '#5f5d58', W(l) + 0.7);                                                       // бордюр
    for (const l of roads) { const c = mp.lCls[l] & 0x3f; stroke(l, c <= 1 ? '#4a4b4e' : c <= 4 ? '#545558' : '#6a6964', W(l)); }
    if (detail) for (const l of roads) { // разметка
      const c = mp.lCls[l] & 0x3f, w = ROAD_W[c], white = 'rgba(238,238,228,0.8)', asph = c <= 1 ? '#4a4b4e' : '#545558';
      if (c > 4) continue;
      if (!fine) { if (c <= 3) stroke(l, white, 0.35, c <= 1 ? undefined : [4, 6]); continue; }
      // пары линий, симметричных оси: широкая белая полоса, середина закрывается асфальтом — от краёв к оси
      const pairs: [number, boolean][] = c === 0 ? [[w / 2 - 0.6, false], [7.2, true], [3.6, true]] : c === 1 ? [[w / 2 - 0.6, false], [3.6, true]] : c === 2 ? [[3.25, true]] : [];
      for (const [off, dashed] of pairs) { stroke(l, white, off * 2 + 0.16, dashed ? [3, 7] : undefined); stroke(l, asph, off * 2 - 0.16); }
      if (c <= 2) { stroke(l, white, 0.62); stroke(l, asph, 0.3); } else stroke(l, white, 0.15, [3, 5]); // двойная сплошная / прерывистая осевая
    }
    if (fine) for (const l of roads) { // пешеходные переходы у концов улиц
      const c = mp.lCls[l] & 0x3f, s = mp.lStart[l], e = mp.lStart[l + 1]; if (c < 2 || c > 4) continue;
      let len = 0; for (let i = s + 1; i < e; i++) len += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (len < 70) continue;
      for (const [a, b] of [[s, s + 1], [e - 1, e - 2]]) {
        let dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1]; const d = Math.hypot(dx, dz); if (d < 16) continue; dx /= d; dz /= d;
        const cx = p[a * 2] + dx * 13, cz = p[a * 2 + 1] + dz * 13, w = ROAD_W[c];
        g.fillStyle = 'rgba(240,240,232,0.85)'; g.beginPath();
        for (let k = -w / 2 + 0.4; k < w / 2 - 0.4; k += 1.1) { // полосы зебры вдоль движения
          const ox = cx - dz * k, oz = cz + dx * k;
          g.moveTo(ox - dx * 1.6, oz - dz * 1.6); g.lineTo(ox + dx * 1.6, oz + dz * 1.6); g.lineTo(ox + dx * 1.6 - dz * 0.5, oz + dz * 1.6 + dx * 0.5); g.lineTo(ox - dx * 1.6 - dz * 0.5, oz - dz * 1.6 + dx * 0.5); g.closePath();
        }
        g.fill();
      }
    }
    for (const l of rails) { // железная дорога: балласт, шпалы, рельсы
      if (!detail) { stroke(l, '#4a4744', Math.max(3.2, mPerPx * 0.9)); continue; }
      stroke(l, '#6b655d', 4.4);
      if (fine) { stroke(l, '#3d342c', 2.7, [0.26, 0.4]); stroke(l, '#b9bcc0', 1.62); stroke(l, '#6b655d', 1.36); stroke(l, '#3d342c', 1.36, [0.26, 0.4]); }
      else { stroke(l, '#4a4039', 2.6, [0.8, 1.2]); stroke(l, '#8d8f92', 1.7); stroke(l, '#5a534c', 1.0); }
    }
  }
  /** Мягкое затемнение земли у оснований домов — здания перестают «висеть» над землёй. */
  private drawContact(g: CanvasRenderingContext2D, cx: number, cz: number, r: number, pxPerM: number) {
    const mp = this.map, p = mp.bPts;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = Math.max(2, 3.2 * pxPerM); g.fillStyle = 'rgba(52,50,46,0.9)'; g.beginPath(); let n = 0;
    for (const b of mp.buildingsNear(cx, cz, r)) {
      const a = mp.bStart[b], e = mp.bStart[b + 1];
      g.moveTo(p[a * 2], p[a * 2 + 1]); for (let i = a + 1; i < e; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); g.closePath();
      if (++n % 300 === 0) { g.fill(); g.beginPath(); }
    }
    g.fill(); g.restore();
  }

  /** Тайл земли: size — сторона в метрах (1000 или 250), t — индекс километрового тайла, из которого берутся объекты. */
  private makeTile(x0: number, z0: number, size: number, res: number, t: number, level: number): Tile {
    const mp = this.map, m = mp.meta;
    const cv = document.createElement('canvas'); cv.width = cv.height = res;
    const g = cv.getContext('2d')!; const s = res / size;
    g.setTransform(s, 0, 0, s, -x0 * s, -z0 * s);
    g.fillStyle = LAND; g.fillRect(x0, z0, size, size);
    this.drawAreas(g, mp.tileA[t], 1 / s); this.drawContact(g, x0 + size / 2, z0 + size / 2, size * 0.72 + 60, s); this.drawLines(g, mp.tileL[t], 1 / s, 5);
    const tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.anisotropy = this.maxAniso;
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
    return { mesh, tex, used: this.frame };
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
      if (d) d.used = this.frame; else { const dd = (i - ci) ** 2 + (j - cj) ** 2; if (dd < bestD) { bestD = dd; best = t; } }
    }
    if (best >= 0) { this.detail.set(best, this.makeTile(m.x0 + (best % mp.tilesX) * TILE, m.z0 + ((best / mp.tilesX) | 0) * TILE, TILE, this.q.detailRes, best, 1)); this.drop(this.detail, (2 * this.q.detailRadius + 3) ** 2 + 8); return; }
    // ближние тайлы: только когда камера низко и километровые уже готовы
    if (!this.q.microRes || camDist > 1500) return;
    const k = TILE / MICRO, nx = mp.tilesX * k, nz = mp.tilesZ * k, mi = Math.floor((tx - m.x0) / MICRO), mj = Math.floor((tz - m.z0) / MICRO), MR = camDist < 500 ? 2 : 3;
    best = -1; bestD = 1e9;
    for (let j = mj - MR; j <= mj + MR; j++) for (let i = mi - MR; i <= mi + MR; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const t = j * nx + i, d = this.micro.get(t);
      if (d) d.used = this.frame; else { const dd = (i - mi) ** 2 + (j - mj) ** 2; if (dd < bestD) { bestD = dd; best = t; } }
    }
    if (best >= 0) { const i = best % nx, j = (best / nx) | 0; this.micro.set(best, this.makeTile(m.x0 + i * MICRO, m.z0 + j * MICRO, MICRO, this.q.microRes, ((j / k) | 0) * mp.tilesX + ((i / k) | 0), 2)); this.drop(this.micro, 60); }
  }
}
