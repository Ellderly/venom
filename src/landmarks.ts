// Знаковые объекты Киева: процедурные модели на реальных координатах. Здания OSM под ними убираются.
// Новый объект = запись в LANDMARKS: координаты, радиус расчистки, габариты для столкновений и функция-строитель.
import * as THREE from 'three';
import { MapData } from './map';
import { U, LIT_GLSL } from './env';

type RGB = [number, number, number];
const WHITE: RGB = [236, 232, 222], GOLD: RGB = [214, 170, 58], GREEN: RGB = [62, 128, 98], STEEL: RGB = [176, 182, 188], BLUE: RGB = [150, 190, 214], SAND: RGB = [214, 196, 160], DARK: RGB = [58, 62, 68], RED: RGB = [196, 52, 40], CONC: RGB = [160, 158, 150];
/** Вид поверхности: 0 матовая, 1 металл/позолота (блик), 2 огонь — светится ночью, 3 стекло. */
type Kind = 0 | 1 | 2 | 3;

/** Сборщик геометрии: примитивы складываются в один меш. Координаты — метры от основания объекта, y вверх. */
class Builder {
  pos: number[] = []; nrm: number[] = []; col: number[] = [];
  private m = new THREE.Matrix4(); private n = new THREE.Matrix3(); private v = new THREE.Vector3();
  add(g: THREE.BufferGeometry, c: RGB, kind: Kind = 0) {
    if (g.index) g = g.toNonIndexed();
    const p = g.getAttribute('position'), q = g.getAttribute('normal'); this.n.getNormalMatrix(this.m);
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(this.m); this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(q, i).applyMatrix3(this.n).normalize(); this.nrm.push(this.v.x, this.v.y, this.v.z);
      this.col.push(c[0], c[1], c[2], kind);
    }
  }
  /** Положение следующего примитива: сдвиг, поворот вокруг Y, наклон вокруг Z и X. */
  at(x: number, y: number, z: number, ry = 0, rz = 0, rx = 0) { this.m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')).setPosition(x, y, z); return this; }
  box(w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, kind: Kind = 0, ry = 0) { this.at(x, y + h / 2, z, ry).add(new THREE.BoxGeometry(w, h, d), c, kind); }
  /** Цилиндр или усечённый конус на основании y. */
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, c: RGB, kind: Kind = 0, seg = 14) { this.at(x, y + h / 2, z).add(new THREE.CylinderGeometry(rt, rb, h, seg), c, kind); }
  ball(r: number, x: number, y: number, z: number, c: RGB, kind: Kind = 0, sy = 1) { const g = new THREE.SphereGeometry(r, 12, 8); g.scale(1, sy, 1); this.at(x, y, z).add(g, c, kind); }
  /** Церковный купол-«луковица» с крестом; y — основание, r — радиус барабана. */
  onion(r: number, x: number, y: number, z: number, c: RGB, drum: RGB = WHITE, drumH = r * 1.4) {
    this.cyl(r * 0.85, r * 0.85, drumH, x, y, z, drum, 0, 10);
    const pts = [[0.9, 0], [1.12, 0.3], [1.08, 0.7], [0.75, 1.15], [0.32, 1.5], [0.07, 1.85], [0.001, 2.1]].map(p => new THREE.Vector2(p[0] * r, p[1] * r));
    this.at(x, y + drumH, z).add(new THREE.LatheGeometry(pts, 12), c, 1);
    this.box(r * 0.07, r * 0.9, r * 0.07, x, y + drumH + r * 2.05, z, GOLD, 1); this.box(r * 0.4, r * 0.07, r * 0.07, x, y + drumH + r * 2.6, z, GOLD, 1);
  }
  /** Балка между двумя точками. */
  beam(a: number[], b: number[], r: number, c: RGB, kind: Kind = 0, seg = 6) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
    this.m.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.add(new THREE.CylinderGeometry(r, r, len, seg), c, kind);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('aC', new THREE.BufferAttribute(new Uint8Array(this.col), 4, true)); g.computeBoundingSphere(); return g;
  }
}

interface Def {
  name: string; lat: number; lon: number; rot?: number;
  clear: number;                 // радиус, в котором убираются здания OSM
  r: number; h: number;          // цилиндр столкновений: радиус и высота
  build(b: Builder, spin: Builder): void; // spin — вращающаяся часть (колесо обозрения)
}

function ellipseRing(b: Builder, a: number, c: number, prof: number[][], col: RGB, kind: Kind = 0) { // тело вращения вокруг эллипса: prof — [доля радиуса, высота]
  const S = 48, g = new THREE.BufferGeometry(), p: number[] = [];
  for (let k = 0; k < prof.length - 1; k++) for (let i = 0; i < S; i++) {
    const a0 = i / S * 6.2832, a1 = (i + 1) / S * 6.2832, P = (ang: number, q: number[]) => [Math.cos(ang) * a * q[0], q[1], Math.sin(ang) * c * q[0]];
    const q0 = P(a0, prof[k]), q1 = P(a1, prof[k]), q2 = P(a1, prof[k + 1]), q3 = P(a0, prof[k + 1]); p.push(...q0, ...q2, ...q1, ...q0, ...q3, ...q2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3)); g.computeVertexNormals(); b.at(0, 0, 0).add(g, col, kind);
}
/** Ярусная колокольня. */
function belfry(b: Builder, tiers: [number, number][], wall: RGB, trim: RGB, dome: RGB) {
  let y = 0;
  for (const [r, h] of tiers) { b.cyl(r, r, h, 0, y, 0, wall, 0, 8); b.cyl(r * 1.08, r * 1.08, h * 0.06, 0, y + h * 0.94, 0, trim, 0, 8); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832 + 0.39; b.box(r * 0.2, h * 0.42, 0.4, Math.cos(a) * r * 0.93, y + h * 0.25, Math.sin(a) * r * 0.93, DARK, 3, -a + Math.PI / 2); } y += h; }
  const r = tiers[tiers.length - 1][0]; b.onion(r * 0.95, 0, y, 0, dome, wall, r * 0.5); return y;
}

export const LANDMARKS: Def[] = [
  { name: 'Родина-мать', lat: 50.42655, lon: 30.56305, rot: 0.6, clear: 34, r: 12, h: 102, build(b) {
    b.cyl(17, 27, 16, 0, 0, 0, CONC, 0, 24); b.cyl(7, 9.5, 24, 0, 16, 0, CONC, 0, 16);                          // музей и постамент
    b.cyl(2.6, 5.2, 30, 0, 40, 0, STEEL, 1, 12); b.cyl(2.9, 2.6, 11, 0, 70, 0, STEEL, 1, 12);                     // фигура: платье, торс
    b.ball(3.1, 0, 82, 0, STEEL, 1, 0.8); b.cyl(0.9, 1.1, 2.2, 0, 84, 0, STEEL, 1, 8); b.ball(1.9, 0, 87.6, 0, STEEL, 1, 1.15);
    b.beam([-2.8, 81, 0], [-6.5, 92, 0], 0.95, STEEL, 1); b.beam([-6.5, 92, 0], [-6.5, 101.5, 0], 0.5, STEEL, 1); b.box(0.5, 9, 1.4, -6.5, 92.5, 0, STEEL, 1); b.box(0.5, 0.6, 4.2, -6.5, 92.2, 0, STEEL, 1); // меч
    b.beam([2.8, 81, 0], [7, 89, 0], 0.95, STEEL, 1); b.box(0.7, 13, 8, 8, 84, 0, STEEL, 1);                       // щит
  } },
  { name: 'Лавра', lat: 50.43465, lon: 30.55735, clear: 14, r: 11, h: 96, build(b) {
    b.cyl(11, 12, 5, 0, 0, 0, WHITE, 0, 8); belfry(b, [[9.5, 25], [8, 21], [6.4, 17], [5, 11]], [226, 228, 230], WHITE, GOLD);
  } },
  { name: 'Успенский собор', lat: 50.43475, lon: 30.5588, rot: 0.1, clear: 34, r: 24, h: 52, build(b) {
    b.box(34, 22, 44, 0, 0, 0, WHITE); b.box(36, 2, 46, 0, 22, 0, GREEN); b.box(14, 26, 10, 0, 0, -24, WHITE);
    b.onion(6, 0, 23, 0, GOLD, WHITE, 9); for (const [x, z, r] of [[-10, -12, 3.4], [10, -12, 3.4], [-10, 12, 3.4], [10, 12, 3.4], [0, -15, 2.6], [0, 15, 2.6]]) b.onion(r, x, 23, z, GOLD, WHITE, r * 1.8);
  } },
  { name: 'Софийский собор', lat: 50.45285, lon: 30.51435, rot: 0.2, clear: 30, r: 24, h: 38, build(b) {
    b.box(40, 13, 46, 0, 0, 0, WHITE); b.box(30, 4, 36, 0, 13, 0, WHITE); b.box(42, 1.2, 48, 0, 13, 0, GREEN);
    b.onion(4.6, 0, 17, 0, GOLD, WHITE, 8); for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) b.onion(2.8, x, 17, z, GREEN, WHITE, 5);
    for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15], [0, -17], [0, 17], [-17, 0], [17, 0]]) b.onion(2.1, x, 13.5, z, GREEN, WHITE, 3.5);
  } },
  { name: 'Колокольня Софии', lat: 50.45295, lon: 30.5163, clear: 12, r: 9, h: 76, build(b) { belfry(b, [[8.5, 22], [7, 18], [5.6, 14], [4.4, 8]], BLUE, WHITE, GOLD); } },
  { name: 'Андреевская церковь', lat: 50.45895, lon: 30.5179, rot: 0.5, clear: 20, r: 14, h: 62, build(b) {
    b.box(30, 12, 34, 0, 0, 0, CONC); b.box(13, 20, 30, 0, 12, 0, [118, 176, 172]); b.box(30, 20, 13, 0, 12, 0, [118, 176, 172]); // стилобат и крестообразный храм
    b.box(13.6, 1, 30.6, 0, 32, 0, WHITE); b.box(30.6, 1, 13.6, 0, 32, 0, WHITE);
    b.onion(5.2, 0, 33, 0, GREEN, WHITE, 8); for (const [x, z] of [[-8.5, -8.5], [8.5, -8.5], [-8.5, 8.5], [8.5, 8.5]]) { b.cyl(1.5, 1.7, 26, x, 12, z, WHITE, 0, 8); b.onion(1.7, x, 38, z, GREEN, WHITE, 2.5); }
  } },
  { name: 'Телебашня', lat: 50.47115, lon: 30.45335, rot: 0.78, clear: 40, r: 13, h: 385, build(b) {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { // четыре опоры сходятся к шахте
      b.beam([sx * 46, 0, sz * 46], [sx * 9, 82, sz * 9], 1.6, STEEL, 1); b.beam([sx * 46, 0, sz * 46], [sx * 9, 40, -sz * 9], 0.5, STEEL, 1); b.beam([sx * 46, 0, sz * 46], [-sx * 9, 40, sz * 9], 0.5, STEEL, 1);
      b.beam([sx * 9, 82, sz * 9], [sx * 7, 200, sz * 7], 0.9, STEEL, 1);
      for (let y = 82; y < 200; y += 14.75) { b.beam([sx * 9, y, sz * 9], [-sx * 9, y + 14.75, sz * 9], 0.3, STEEL, 1); b.beam([sx * 9, y, sz * 9], [sx * 9, y + 14.75, -sz * 9], 0.3, STEEL, 1); }
    }
    b.cyl(2.2, 2.2, 200, 0, 0, 0, STEEL, 1, 10); b.cyl(15, 15, 12, 0, 80, 0, [200, 204, 208], 1, 20); b.cyl(11.5, 11.5, 9, 0, 192, 0, [200, 204, 208], 1, 20);
    for (let y = 201, i = 0; y < 385; y += 23, i++) b.cyl(Math.max(0.5, 5.2 - i * 0.62), Math.max(0.6, 5.8 - i * 0.62), 23, 0, y, 0, i % 2 ? WHITE : RED, 0, 8); // мачта в красно-белую полосу
    for (const y of [92, 201, 270, 330, 384]) for (let i = 0; i < 4; i++) b.ball(1.3, Math.cos(i * 1.57) * (y < 250 ? 12 : 2.5), y, Math.sin(i * 1.57) * (y < 250 ? 12 : 2.5), [255, 40, 30], 2); // заградительные огни
  } },
  { name: 'Монумент Независимости', lat: 50.4494, lon: 30.5247, clear: 9, r: 6, h: 61, build(b) {
    b.box(11, 9, 11, 0, 0, 0, WHITE); b.box(8, 4, 8, 0, 9, 0, WHITE); b.cyl(1.7, 2.1, 36, 0, 13, 0, WHITE, 0, 14); b.cyl(2.9, 1.8, 2.6, 0, 49, 0, GOLD, 1, 12);
    b.cyl(0.9, 1.9, 6, 0, 51.6, 0, GOLD, 1, 10); b.ball(0.85, 0, 58.4, 0, GOLD, 1); b.beam([-0.8, 56.6, 0], [-2.8, 60, 0], 0.3, GOLD, 1); b.beam([0.8, 56.6, 0], [2.8, 60, 0], 0.3, GOLD, 1); b.beam([-2.8, 60, 0], [2.8, 60, 0], 0.22, GOLD, 1);
  } },
  { name: 'НСК «Олимпийский»', lat: 50.43345, lon: 30.52195, rot: 0.32, clear: 150, r: 0, h: 50, build(b) {
    ellipseRing(b, 148, 122, [[1, 0], [1, 28], [0.97, 31], [0.62, 6], [0.5, 2], [0.5, 0]], CONC);          // чаша трибун
    ellipseRing(b, 148, 122, [[0.985, 28.5], [0.62, 6.5]], [70, 110, 190]);                                 // кресла
    ellipseRing(b, 152, 126, [[1.02, 38], [1.0, 44], [0.6, 40], [0.6, 39], [1.02, 38]], [232, 234, 236], 1); // мембранная крыша
    for (let i = 0; i < 40; i++) { const a = i / 40 * 6.2832; b.beam([Math.cos(a) * 150, 0, Math.sin(a) * 124], [Math.cos(a) * 156, 46, Math.sin(a) * 130], 0.7, WHITE, 1); }
    ellipseRing(b, 148, 122, [[0.52, 2.2], [0.001, 2.2]], [150, 70, 56]); b.box(105, 0.5, 68, 0, 2.0, 0, [70, 140, 66]);   // беговые дорожки и поле
  } },
  { name: 'Вокзал', lat: 50.4406, lon: 30.4893, rot: -0.37, clear: 70, r: 60, h: 40, build(b) {
    b.box(170, 20, 34, 0, 0, 0, SAND); b.box(172, 1.5, 36, 0, 20, 0, [110, 104, 96]); b.box(46, 38, 42, 0, 0, 0, SAND); b.box(48, 2, 44, 0, 38, 0, [110, 104, 96]);
    b.at(0, 4, 21.2).add(new THREE.CircleGeometry(16, 20, 0, Math.PI), DARK, 3); b.box(32, 4, 0.6, 0, 0, 21.2, DARK, 3);            // арочное окно портала
    for (const sx of [-1, 1]) { b.box(14, 30, 14, sx * 30, 0, 12, SAND); b.cyl(0.1, 8, 7, sx * 30, 30, 12, [110, 104, 96], 0, 4); for (let i = 0; i < 7; i++) b.box(5, 11, 0.5, sx * (44 + i * 6.2), 5, 17.1, DARK, 3); }
  } },
  { name: 'Арка Свободы', lat: 50.4543, lon: 30.5297, rot: 0.9, clear: 0, r: 30, h: 35, build(b) {
    const g = new THREE.TorusGeometry(27, 3.2, 10, 36, Math.PI); b.at(0, 0, 0).add(g, [196, 200, 206], 1); b.cyl(20, 22, 1.2, 0, 0, 0, CONC, 0, 24);
  } },
  { name: 'Колесо обозрения', lat: 50.4662, lon: 30.5158, rot: 0.3, clear: 0, r: 22, h: 46, build(b, w) {
    for (const s of [-1, 1]) { b.beam([-11, 0, s * 4], [0, 24, s * 2.2], 0.6, WHITE, 1); b.beam([11, 0, s * 4], [0, 24, s * 2.2], 0.6, WHITE, 1); }
    b.beam([0, 24, -2.6], [0, 24, 2.6], 1, STEEL, 1);
    for (const s of [-1.3, 1.3]) { w.at(0, 0, s).add(new THREE.TorusGeometry(20, 0.35, 6, 40), WHITE, 1); for (let i = 0; i < 20; i++) { const a = i / 20 * 6.2832; w.beam([0, 0, s], [Math.cos(a) * 20, Math.sin(a) * 20, s], 0.12, WHITE, 1, 4); } }
    for (let i = 0; i < 20; i++) { const a = i / 20 * 6.2832, x = Math.cos(a) * 20, y = Math.sin(a) * 20; w.box(2.2, 2.4, 2.2, x, y - 1.2, 0, i % 2 ? [230, 80, 60] : [70, 140, 220], 3); w.ball(0.45, x * 1.03, y * 1.03, 1.5, [255, 230, 150], 2); }
  } },
];

export class Landmarks {
  group = new THREE.Group();
  marks: { x: number; z: number; name: string }[] = [];
  private spinners: THREE.Mesh[] = [];
  private mat = new THREE.ShaderMaterial({
    uniforms: { ...U }, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 aC; varying vec3 vW; varying vec3 vN; varying vec4 vC;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = mat3(modelMatrix) * normal; vC = aC; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; varying vec3 vN; varying vec4 vC; ${LIT_GLSL}
      void main(){
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW), alb = vC.rgb * vC.rgb; if (dot(n, v) < 0.0) n = -n;
        float kind = vC.a * 255.0, metal = step(0.5, kind) * step(kind, 1.5), light = step(1.5, kind) * step(kind, 2.5), glassK = step(2.5, kind);
        float sh = shadowAt(vW, n), fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 c = alb * (uAmb * (0.75 + 0.25 * n.y) + uSunCol * max(dot(n, uSun), 0.0) * sh + pointLights(vW, n));
        c += alb * vec3(1.0, 0.82, 0.58) * uNight * 0.3 * (0.6 + 0.4 * n.y) * (1.0 - light);                                  // ночная подсветка памятников
        c += (uSunCol * pow(max(dot(reflect(-uSun, n), v), 0.0), 26.0) * 0.8 * sh + uFogCol * fres * 0.35) * (metal + glassK) * mix(vec3(1.0), alb * 2.5, metal);
        c = mix(c, alb * (0.35 + 1.6 * uNight), light);
        gl_FragColor = vec4(sqrt(applyFog(c, distance(cameraPosition, vW))), 1.0);
      }`,
  });

  /** Вызывается до создания зданий: убирает дома OSM под моделями и регистрирует препятствия. */
  constructor(map: MapData) {
    const MX = 111320 * Math.cos(map.meta.lat0 * Math.PI / 180), MZ = 110574;
    for (const d of LANDMARKS) {
      const x = (d.lon - map.meta.lon0) * MX, z = -(d.lat - map.meta.lat0) * MZ, y = map.heightAt(x, z);
      if (x < map.meta.x0 || x > map.meta.x1 || z < map.meta.z0 || z > map.meta.z1) continue;
      if (d.clear) for (const b of map.buildingsNear(x, z, d.clear)) map.bH[b] = 0;
      if (d.r) map.obstacles.push({ x, z, r: d.r, top: y + d.h, name: d.name });
      this.marks.push({ x, z, name: d.name });
      const b = new Builder(), w = new Builder(); d.build(b, w);
      const m = new THREE.Mesh(b.geometry(), this.mat); m.position.set(x, y - 0.5, z); m.rotation.y = d.rot ?? 0; m.updateMatrixWorld(); this.group.add(m);
      if (w.pos.length) { const s = new THREE.Mesh(w.geometry(), this.mat); s.position.set(0, 24, 0); m.add(s); this.spinners.push(s); }
    }
  }
  update(dt: number) { for (const s of this.spinners) { s.rotation.z += dt * 0.05; s.updateMatrixWorld(); } }
}
