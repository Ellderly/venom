// Время суток, солнце, небо, туман. Общие uniform-ы для всех материалов.
import * as THREE from 'three';

export const U = {
  uSun: { value: new THREE.Vector3(0.3, 0.8, 0.5) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uAmb: { value: new THREE.Color(0.4, 0.45, 0.5) },
  uFogCol: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uFogD: { value: 0.00003 },
  uNight: { value: 0 },
  uTime: { value: 0 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Env {
  hour = 15; speed = 10; // множитель хода времени
  sky: THREE.Mesh; sunLight = new THREE.DirectionalLight(); hemi = new THREE.HemisphereLight();
  private zen = new THREE.Color(); private hor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { uZen: { value: this.zen }, uHor: { value: this.hor }, uSun: U.uSun, uSunCol: U.uSunCol, uNight: U.uNight },
      vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uZen, uHor, uSun, uSunCol; uniform float uNight; varying vec3 vD;
        float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vD); float y = max(d.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(y, 0.45));
          float s = max(dot(d, uSun), 0.0);
          c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight);
          vec3 g = floor(d * 220.0); float st = step(0.9985, h(g)) * uNight * smoothstep(0.02, 0.3, d.y);
          c += vec3(st) * (0.5 + 0.5 * h(g + 1.0));
          if (d.y < 0.0) c = mix(uHor, uHor * 0.6, min(1.0, -d.y * 4.0));
          gl_FragColor = vec4(c, 1.0);
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
    const day = sstep(-0.1, 0.12, sun.y), gold = sstep(0.35, 0.02, Math.abs(sun.y)) * sstep(-0.18, -0.02, sun.y);
    const night = 1 - sstep(-0.16, 0.02, sun.y);
    U.uNight.value = night;
    if (sun.y < 0.03) { // ночью источник света — луна, чтобы город не был плоским
      const k = sstep(0.03, -0.1, sun.y);
      sun.set(lerp(sun.x, -0.4, k), lerp(Math.max(sun.y, 0.03), 0.6, k), lerp(sun.z, 0.5, k)).normalize();
    }
    U.uSunCol.value.setRGB(lerp(0.10, 1.25, day), lerp(0.12, lerp(1.2, 0.8, gold), day), lerp(0.2, lerp(1.1, 0.5, gold), day));
    U.uAmb.value.setRGB(lerp(0.035, 0.5, day), lerp(0.045, 0.55, day), lerp(0.08, 0.64, day));
    this.zen.setRGB(lerp(0.004, 0.16, day), lerp(0.008, 0.36, day), lerp(0.03, 0.72, day));
    this.hor.setRGB(lerp(0.03, lerp(0.66, 0.95, gold), day), lerp(0.04, lerp(0.78, 0.55, gold), day), lerp(0.08, lerp(0.92, 0.35, gold), day));
    U.uFogCol.value.copy(this.hor).lerp(this.zen, 0.15);
    (scene.fog as THREE.FogExp2).color.copy(U.uFogCol.value); (scene.fog as THREE.FogExp2).density = U.uFogD.value;
    this.sunLight.position.copy(sun).multiplyScalar(1000); this.sunLight.color.copy(U.uSunCol.value); this.sunLight.intensity = 2.2;
    this.hemi.color.copy(U.uAmb.value); this.hemi.groundColor.copy(U.uAmb.value).multiplyScalar(0.5); this.hemi.intensity = 3;
    this.sky.position.copy(cam.position); this.sky.scale.setScalar(1000);
  }

  clock() { const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}

export const FOG_GLSL = `
  uniform vec3 uFogCol; uniform float uFogD;
  vec3 applyFog(vec3 c, float dist){ float f = 1.0 - exp(-dist*dist*uFogD*uFogD); return mix(c, uFogCol, f); }`;
