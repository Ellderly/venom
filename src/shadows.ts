// Тени от солнца (ночью — от луны): одна карта теней вокруг точки взгляда, размер области подстраивается под высоту камеры.
import * as THREE from 'three';
import { U, depthOf } from './env';

export class Shadows {
  private rt: THREE.WebGLRenderTarget; private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 9000);
  /** Группы, отбрасывающие тень. Материалы — ShaderMaterial с мировыми координатами в вершинном шейдере. */
  casters: THREE.Object3D[] = [];
  private swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private v = new THREE.Vector3(); private scene = new THREE.Scene();

  constructor(private size: number) {
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.NearestFilter;
    U.uShadowMap.value = this.rt.depthTexture;
    this.scene.matrixWorldAutoUpdate = false;
  }

  render(renderer: THREE.WebGLRenderer, t: { x: number; y: number; z: number; dist: number }) {
    const sun = U.uSun.value;
    const strength = Math.min(1, Math.max(0, (sun.y - 0.06) / 0.12)) * (1 - 0.45 * U.uNight.value) * Math.min(1, Math.max(0, (9000 - t.dist) / 3000));
    U.uShadowOn.value = strength; if (strength <= 0.01) return;
    const R = Math.min(3200, Math.max(220, t.dist * 0.95)), texel = 2 * R / this.size, c = this.cam;
    U.uShadowTexel.value = texel;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 10; c.far = 9000; c.updateProjectionMatrix();
    c.position.set(t.x + sun.x * 4500, t.y + sun.y * 4500, t.z + sun.z * 4500); c.up.set(0, 1, 0); c.lookAt(t.x, t.y, t.z); c.updateMatrixWorld();
    // привязка к сетке текселей: тени не «плывут» при движении камеры
    const p = this.v.set(t.x, t.y, t.z).applyMatrix4(c.matrixWorldInverse), dx = p.x - Math.round(p.x / texel) * texel, dy = p.y - Math.round(p.y / texel) * texel;
    c.position.addScaledVector(this.v.setFromMatrixColumn(c.matrixWorld, 0), dx).addScaledVector(this.v.setFromMatrixColumn(c.matrixWorld, 1), dy); c.updateMatrixWorld();
    U.uShadowMat.value.multiplyMatrices(this.bias, c.projectionMatrix).multiply(c.matrixWorldInverse);
    this.swapped.length = 0; this.scene.children.length = 0;
    for (const g of this.casters) {
      this.scene.children.push(g);
      g.traverseVisible(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.ShaderMaterial).isShaderMaterial) { this.swapped.push([m, m.material]); m.material = depthOf(m.material as THREE.ShaderMaterial); } });
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt); renderer.clear(); renderer.render(this.scene, c); renderer.setRenderTarget(prev);
    for (const [m, mat] of this.swapped) m.material = mat;
    this.scene.children.length = 0;
  }
}
