// Время суток, солнце, небо, облака, туман. Общие uniform-ы и общий кусок шейдера освещения для всех материалов.
import * as THREE from 'three';

export const U = {
  uSun: { value: new THREE.Vector3(0.3, 0.8, 0.5) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uAmb: { value: new THREE.Color(0.4, 0.45, 0.5) },
  uFogCol: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uFogD: { value: 0.00003 },
  uNight: { value: 0 },
  uTime: { value: 0 },
  // тени от солнца (shadows.ts)
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMat: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },      // сила тени 0..1
  uShadowTexel: { value: 1 },   // размер текселя карты теней в метрах
  // точечные источники: вспышки взрывов и пожары (fx.ts). xyz — положение, w — радиус
  uLP: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  uLC: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
};

/** Общая часть шейдеров: объявления uniform-ов, тень, свет взрывов, туман, шум. */
export const LIT_GLSL = `
  uniform vec3 uSun, uSunCol, uAmb, uFogCol; uniform float uFogD, uNight, uTime;
  uniform sampler2D uShadowMap; uniform mat4 uShadowMat; uniform float uShadowOn, uShadowTexel;
  uniform vec4 uLP[4]; uniform vec3 uLC[4];
  float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash12(i), hash12(i+vec2(1.,0.)), f.x), mix(hash12(i+vec2(0.,1.)), hash12(i+vec2(1.,1.)), f.x), f.y); }
  float shadowAt(vec3 w, vec3 n){
    if (uShadowOn < 0.01) return 1.0;
    vec3 q = (uShadowMat * vec4(w + n * uShadowTexel * 1.6, 1.0)).xyz;
    vec2 e = abs(q.xy - 0.5) * 2.0; float edge = max(e.x, e.y);
    if (edge >= 1.0 || q.z >= 1.0) return 1.0;
    float z = q.z - 0.0012, px = 1.0 / float(textureSize(uShadowMap, 0).x), s = 0.0;
    float a = hash12(gl_FragCoord.xy) * 6.283; vec2 r = vec2(cos(a), sin(a)) * px * 1.3; // поворот выборок убирает «лесенку»
    s += step(z, texture2D(uShadowMap, q.xy + r).r); s += step(z, texture2D(uShadowMap, q.xy - r).r);
    s += step(z, texture2D(uShadowMap, q.xy + vec2(-r.y, r.x)).r); s += step(z, texture2D(uShadowMap, q.xy - vec2(-r.y, r.x)).r);
    s = mix(s * 0.25, 1.0, smoothstep(0.85, 1.0, edge));
    return mix(1.0, s, uShadowOn);
  }
  vec3 pointLights(vec3 w, vec3 n){
    vec3 c = vec3(0.0);
    for (int i = 0; i < 4; i++) { vec3 d = uLP[i].xyz - w; float l = length(d), a = max(0.0, 1.0 - l / max(uLP[i].w, 1.0)); c += uLC[i] * a * a * (0.3 + 0.7 * max(dot(n, d / max(l, 0.01)), 0.0)); }
    return c;
  }
  vec3 applyFog(vec3 c, float dist){ float f = 1.0 - exp(-dist*dist*uFogD*uFogD); return mix(c, uFogCol, f); }`;
/** Старое имя: только туман (для материалов без освещения). */
export const FOG_GLSL = `
  uniform vec3 uFogCol; uniform float uFogD;
  vec3 applyFog(vec3 c, float dist){ float f = 1.0 - exp(-dist*dist*uFogD*uFogD); return mix(c, uFogCol, f); }`;

/** Материал для прохода теней: тот же вершинный шейдер, пустой фрагментный. */
export function depthOf(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  return m.userData.depth ??= new THREE.ShaderMaterial({ uniforms: m.uniforms, vertexShader: m.vertexShader, fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }', side: THREE.DoubleSide, colorWrite: false });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Env {
  hour = 15; speed = 10; // множитель хода времени
  sky: THREE.Mesh; sunLight = new THREE.DirectionalLight(); hemi = new THREE.HemisphereLight(); // для стандартных материалов (модели целей, обломки)
  /** Настоящее направление на солнце (uSun ночью указывает на луну). */
  sunDir = new THREE.Vector3();
  private zen = new THREE.Color(); private hor = new THREE.Color();

  constructor(scene: THREE.Scene, clouds = true) {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, defines: clouds ? { CLOUDS: 1 } : {},
      uniforms: { uZen: { value: this.zen }, uHor: { value: this.hor }, uSun: U.uSun, uSunCol: U.uSunCol, uNight: U.uNight, uTime: U.uTime, uCamH: { value: 0 } },
      vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uZen, uHor, uSun, uSunCol; uniform float uNight, uTime, uCamH; varying vec3 vD;
        float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
        float h2(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1.,0.)), f.x), mix(h2(i+vec2(0.,1.)), h2(i+vec2(1.,1.)), f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vD); float y = max(d.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(y, 0.45));
          float s = max(dot(d, uSun), 0.0), day = 1.0 - uNight;
          c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * day;
          c += uHor * pow(s, 4.0) * 0.35 * day * (1.0 - y);                       // ореол у горизонта на закате
          c += vec3(0.75, 0.8, 0.9) * (smoothstep(0.9995, 0.99975, s) * 0.9 + pow(s, 60.0) * 0.05) * uNight; // луна
          vec3 g = floor(d * 220.0); float st = step(0.9985, h(g)) * uNight * smoothstep(0.02, 0.3, d.y);
          vec3 stars = vec3(st) * (0.5 + 0.5 * h(g + 1.0));
          c += vec3(1.0, 0.55, 0.25) * uNight * 0.1 * pow(1.0 - y, 8.0);          // зарево города
          #ifdef CLOUDS
          if (d.y > 0.01) {
            vec2 uv = d.xz / (d.y + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0017);
            float n = fbm(uv), n2 = fbm(uv * 2.7 + 5.0);
            float cov = smoothstep(0.48, 0.78, n + 0.18 * n2);
            float lit = smoothstep(0.35, 0.9, fbm(uv + uSun.xz * 0.12));          // подсветка со стороны солнца
            vec3 cc = mix(uHor * 0.75 + uSunCol * 0.2, vec3(0.62) * uSunCol + uZen * 0.3 + 0.25 * uSunCol * pow(s, 3.0), lit) * (0.55 + 0.45 * day);
            cc += vec3(0.5, 0.26, 0.12) * uNight * 0.12;                          // ночью облака подсвечены городом
            float a = cov * smoothstep(0.01, 0.2, d.y) * 0.85;
            stars *= 1.0 - a; c = mix(c, cc, a);
          }
          #endif
          c += stars;
          if (d.y < 0.0) c = mix(uHor, uHor * 0.6, min(1.0, -d.y * 4.0));
          gl_FragColor = vec4(sqrt(max(c, 0.0)) , 1.0);
        }`,
    }));
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    scene.add(this.sky, this.sunLight, this.hemi);
    scene.fog = new THREE.FogExp2(0xffffff, 0.00003);
  }

  update(dtReal: number, scene: THREE.Scene, cam: THREE.Camera) {
    this.hour = (this.hour + dtReal * this.speed / 3600 + 24) % 24;
    // высота солнца: упрощённая модель для широты Киева, равноденствие
    const a = (this.hour - 12) / 12 * Math.PI;
    const el = Math.asin(Math.cos(a) * 0.64 + 0.02);
    const az = a + Math.PI;
    const sun = U.uSun.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sunDir.copy(sun);
    const day = sstep(-0.1, 0.12, sun.y), gold = sstep(0.35, 0.02, Math.abs(sun.y)) * sstep(-0.18, -0.02, sun.y);
    const night = 1 - sstep(-0.16, 0.02, sun.y);
    U.uNight.value = night;
    if (sun.y < 0.03) { // ночью источник света — луна, чтобы город не был плоским
      const k = sstep(0.03, -0.1, sun.y);
      sun.set(lerp(sun.x, -0.4, k), lerp(Math.max(sun.y, 0.03), 0.6, k), lerp(sun.z, 0.5, k)).normalize();
    }
    U.uSunCol.value.setRGB(lerp(0.10, 1.0, day), lerp(0.12, lerp(0.96, 0.66, gold), day), lerp(0.2, lerp(0.88, 0.42, gold), day));
    U.uAmb.value.setRGB(lerp(0.035, 0.4, day), lerp(0.045, 0.45, day), lerp(0.08, 0.54, day));
    this.zen.setRGB(lerp(0.004, 0.16, day), lerp(0.008, 0.36, day), lerp(0.03, 0.72, day));
    this.hor.setRGB(lerp(0.035, lerp(0.56, 0.82, gold), day), lerp(0.04, lerp(0.68, 0.48, gold), day), lerp(0.075, lerp(0.82, 0.3, gold), day));
    U.uFogCol.value.copy(this.hor).lerp(this.zen, 0.15);
    (scene.fog as THREE.FogExp2).color.copy(U.uFogCol.value); (scene.fog as THREE.FogExp2).density = U.uFogD.value;
    this.sunLight.position.copy(sun).multiplyScalar(1000); this.sunLight.color.copy(U.uSunCol.value); this.sunLight.intensity = 2.2;
    this.hemi.color.copy(U.uAmb.value); this.hemi.groundColor.copy(U.uAmb.value).multiplyScalar(0.5); this.hemi.intensity = 3;
    this.sky.position.copy(cam.position); this.sky.scale.setScalar(1000);
  }

  clock() { const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
