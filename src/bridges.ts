// Мосты как 3D-объекты: полотно с ограждением и опорами по цепочкам из данных карты. Разрушаются участками.
import * as THREE from 'three';
import { MapData, Bridge } from './map';
import { U, LIT_GLSL } from './env';
import { FX } from './fx';
import { Destruction } from './voxels';

const STEP = 8;

export class Bridges {
  group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private mat = new THREE.ShaderMaterial({
    uniforms: { ...U }, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 aC; varying vec3 vW; varying vec3 vN; varying vec4 vC; varying vec2 vUv;
      void main(){ vW = position; vN = normal; vC = aC; vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vW; varying vec3 vN; varying vec4 vC; varying vec2 vUv; ${LIT_GLSL}
      void main(){
        vec3 n = normalize(vN), alb = vC.rgb * vC.rgb; float kind = vC.a * 255.0, dist = distance(cameraPosition, vW), fine = 1.0 - smoothstep(300.0, 1500.0, dist);
        if (kind > 0.5 && kind < 1.5) {          // проезжая часть: uv.x — метры от оси, uv.y — путь, aC.b — полуширина
          float x = abs(vUv.x), hw = vC.b * 255.0 * 0.1; alb = vec3(0.075, 0.077, 0.083) * (0.9 + 0.2 * vnoise(vW.xz * 1.3));
          float mark = step(x, 0.3) * step(0.12, x);                                              // двойная осевая
          for (float l = 3.5; l < hw - 3.0; l += 3.5) mark += step(abs(x - l), 0.08) * step(fract(vUv.y / 10.0), 0.3);
          mark += step(abs(x - (hw - 1.9)), 0.08);
          alb = mix(alb, vec3(0.72), min(mark, 1.0) * fine * 0.85);
          alb = mix(alb, vec3(0.33, 0.325, 0.31), step(hw - 1.5, x));                             // тротуар
        } else if (kind > 1.5 && kind < 2.5) {   // железнодорожное полотно: шпалы и рельсы
          float x = abs(vUv.x); alb = vec3(0.14, 0.125, 0.11) * (0.85 + 0.3 * vnoise(vW.xz * 2.0));
          alb = mix(alb, vec3(0.05, 0.04, 0.03), step(x, 1.35) * step(fract(vUv.y * 1.5), 0.4) * fine);
          alb = mix(alb, vec3(0.5, 0.52, 0.55), step(abs(x - 0.76), 0.07) * fine);
        } else alb *= 0.9 + 0.2 * vnoise(vW.xz * 0.5 + vW.y);
        float sh = shadowAt(vW, n);
        vec3 c = alb * (uAmb * (0.7 + 0.3 * n.y) + uSunCol * max(dot(n, uSun), 0.0) * sh + pointLights(vW, n));
        gl_FragColor = vec4(sqrt(applyFog(c, dist)), 1.0);
      }`,
  });

  constructor(private map: MapData, private fx: FX, private destr: Destruction) {
    for (const b of map.bridges) this.build(b);
  }

  /** Точка полотна на расстоянии s от начала: [x, y, z, tx, tz]. */
  private at(b: Bridge, s: number, out: number[]) {
    let i = 0; while (i < b.s.length - 2 && b.s[i + 1] < s) i++;
    const seg = b.s[i + 1] - b.s[i] || 1, t = Math.min(1, Math.max(0, (s - b.s[i]) / seg), ), dx = b.pts[i * 2 + 2] - b.pts[i * 2], dz = b.pts[i * 2 + 3] - b.pts[i * 2 + 1], l = Math.hypot(dx, dz) || 1;
    out[0] = b.pts[i * 2] + dx * t; out[1] = b.y[i] + (b.y[i + 1] - b.y[i]) * t; out[2] = b.pts[i * 2 + 1] + dz * t; out[3] = dx / l; out[4] = dz / l; return out;
  }

  private build(b: Bridge) {
    const old = this.meshes.get(b.id); if (old) { this.group.remove(old); old.geometry.dispose(); }
    const pos: number[] = [], nrm: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const hw = b.w / 2, T = b.rail ? 1.5 : Math.min(2.6, 1.1 + b.len / 500), conc = [150, 147, 140], dark = [96, 94, 90], steel = [78, 84, 92];
    const quad = (p: number[][], n: number[], c: number[], kind: number, uvs?: number[][]) => {
      const o = pos.length / 3;
      p.forEach((q, i) => { pos.push(q[0], q[1], q[2]); nrm.push(n[0], n[1], n[2]); col.push(c[0], c[1], kind === 1 ? Math.round(hw * 10) : c[2], kind); uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0); });
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const a = [0, 0, 0, 0, 0], c = [0, 0, 0, 0, 0], cut = (s: number) => b.cuts.some(q => s > q[0] && s < q[1]);
    const n = Math.max(1, Math.round(b.len / STEP)), ds = b.len / n, kind = b.rail ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const s0 = i * ds, s1 = s0 + ds; if (cut((s0 + s1) / 2)) continue;
      this.at(b, s0, a); this.at(b, s1, c);
      const L0 = [a[0] + a[4] * hw, a[1], a[2] - a[3] * hw], R0 = [a[0] - a[4] * hw, a[1], a[2] + a[3] * hw], L1 = [c[0] + c[4] * hw, c[1], c[2] - c[3] * hw], R1 = [c[0] - c[4] * hw, c[1], c[2] + c[3] * hw];
      const dn = (p: number[], d: number) => [p[0], p[1] - d, p[2]];
      quad([L0, R0, R1, L1], [0, 1, 0], conc, kind, [[-hw, s0], [hw, s0], [hw, s1], [-hw, s1]]);
      quad([dn(L0, T), dn(L1, T), dn(R1, T), dn(R0, T)], [0, -1, 0], dark, 0);
      quad([L0, L1, dn(L1, T), dn(L0, T)], [a[4], 0, -a[3]], conc, 0); quad([R0, dn(R0, T), dn(R1, T), R1], [-a[4], 0, a[3]], conc, 0);
      const rh = b.rail ? 1.0 : 1.15; // ограждение
      quad([L0, L1, dn(L1, -rh), dn(L0, -rh)], [a[4], 0, -a[3]], steel, 0); quad([R0, dn(R0, -rh), dn(R1, -rh), R1], [-a[4], 0, a[3]], steel, 0);
      for (const [s, p, t] of [[s0, a, -1], [s1, c, 1]] as [number, number[], number][]) if (cut(s + t * ds * 0.5 * -1) || (s > 0.01 && s < b.len - 0.01 && cut(s - t * ds * 0.5))) { // торец у пролома
        const l = [p[0] + p[4] * hw, p[1], p[2] - p[3] * hw], r = [p[0] - p[4] * hw, p[1], p[2] + p[3] * hw]; quad([l, r, dn(r, T), dn(l, T)], [p[3] * -t, 0, p[4] * -t], [70, 66, 60], 0);
      }
    }
    // опоры
    const gap = b.len > 400 ? 55 : 38;
    for (let s = Math.min(gap, b.len / 2); s < b.len - gap * 0.4; s += gap) {
      this.at(b, s, a); const g = this.map.heightAt(a[0], a[2]); if (a[1] - T - g < 3 || cut(s)) continue;
      const pw = hw * 0.62, pl = 1.5, top = a[1] - T, bot = g - 5, tx = a[3], tz = a[4];
      const P = (lx: number, lz: number, y: number) => [a[0] + tz * lx + tx * lz, y, a[2] - tx * lx + tz * lz];
      const cs = [[-pw, -pl], [pw, -pl], [pw, pl], [-pw, pl]];
      for (let k = 0; k < 4; k++) { const p0 = cs[k], p1 = cs[(k + 1) % 4], nx = k === 0 ? [-tx, 0, -tz] : k === 1 ? [tz, 0, -tx] : k === 2 ? [tx, 0, tz] : [-tz, 0, tx]; quad([P(p0[0], p0[1], bot), P(p1[0], p1[1], bot), P(p1[0], p1[1], top), P(p0[0], p0[1], top)], nx, [128, 126, 120], 0); }
    }
    if (!idx.length) { this.meshes.delete(b.id); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('aC', new THREE.BufferAttribute(new Uint8Array(col), 4, true)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat); this.meshes.set(b.id, m); this.group.add(m);
  }

  /** Взрыв у моста: участок полотна в радиусе обрушивается. Возвращает число повреждённых мостов. */
  blast(x: number, y: number, z: number, r: number) {
    const hit = this.map.bridgeAt(x, z, r); if (!hit) return 0;
    const [b, s, dy] = hit; if (Math.abs(dy - y) > r + 3) return 0;
    let c0 = Math.max(0, s - r * 0.85), c1 = Math.min(b.len, s + r * 0.85);
    b.cuts = b.cuts.filter(q => { if (q[1] < c0 || q[0] > c1) return true; c0 = Math.min(c0, q[0]); c1 = Math.max(c1, q[1]); return false; }); // сливаем с соседними проломами
    b.cuts.push([c0, c1]); this.build(b);
    const p = [0, 0, 0, 0, 0];
    for (let i = 0; i < 26; i++) { // обломки полотна падают вниз
      this.at(b, c0 + Math.random() * (c1 - c0), p); const o = (Math.random() - 0.5) * b.w;
      this.destr.chunk(p[0] + p[4] * o, p[1] - Math.random(), p[2] - p[3] * o, (Math.random() - 0.5) * 9, 2 + Math.random() * 7, (Math.random() - 0.5) * 9, 0.8 + Math.random() * 1.6, 120, 118, 112);
    }
    this.fx.dust(x, dy, z, r * 1.4);
    return 1;
  }

  reset() { for (const b of this.map.bridges) if (b.cuts.length) { b.cuts = []; this.build(b); } }
}
