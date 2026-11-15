// Карточка юнита: характеристики и вращающаяся 3D-модель. Один рендерер на все карточки.
import * as THREE from 'three';
import { UnitDef, CATEGORIES, SIDE_NAME } from './units';
import { el } from './ui';

export interface CardAction { label: string; primary?: boolean; fn: () => void }

export class CardView {
  private r: THREE.WebGLRenderer | null = null; private canvas = document.createElement('canvas');
  private scene = new THREE.Scene(); private cam = new THREE.PerspectiveCamera(32, 330 / 220, 0.1, 80); private model: THREE.Object3D | null = null;
  host: HTMLElement | null = null; unit: UnitDef | null = null;

  constructor(private models: Record<string, () => THREE.Object3D>) {
    this.canvas.width = 660; this.canvas.height = 440;
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x5a5040, 4)); const dl = new THREE.DirectionalLight(0xffffff, 5); dl.position.set(3, 5, 4); this.scene.add(dl);
  }

  show(host: HTMLElement, u: UnitDef, actions: CardAction[]) {
    this.r ??= new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    if (this.model) this.scene.remove(this.model);
    this.model = this.models[u.id]?.() ?? null;
    if (this.model) { // камера подбирается по размеру модели
      this.scene.add(this.model); const s = new THREE.Box3().setFromObject(this.model).getBoundingSphere(new THREE.Sphere()).radius;
      this.cam.position.set(0, s * 0.85, s * 2.35); this.cam.lookAt(0, 0, 0);
    }
    const cat = CATEGORIES.find(c => c.id === u.cat);
    host.innerHTML = `<div class="tag ${u.side === 'attack' ? 'atk' : 'def'}">${SIDE_NAME[u.side]} · ${cat?.name ?? ''}</div>
      <h2>${u.name} <span class="dim" style="font-weight:400">/ ${u.alt}</span></h2><div data-c></div>
      <div class="stats"><div><b>${Math.round(u.speed * 3.6)}</b>км/ч</div><div><b>${u.tntKg}</b>кг ТНТ</div><div><b>${u.cost}</b>очков</div><div><b>${u.reload} с</b>перезарядка</div></div><div data-a class="row" style="margin-bottom:8px"></div>
      <p>${u.about}</p><div class="tag">${u.kind}</div>
      <table><tr><td>Происхождение</td><td>${u.origin}</td></tr>${u.card.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
      <p class="note">Данные из открытых источников, приблизительные. Модель построена по реальным габаритам. В песочнице цена и перезарядка не ограничивают запуск.</p>`;
    host.querySelector('[data-c]')!.append(this.canvas);
    for (const a of actions) { const b = el('button', a.primary ? 'on' : ''); b.textContent = a.label; b.onclick = a.fn; host.querySelector('[data-a]')!.append(b); }
    this.host = host; this.unit = u;
  }
  hide() { this.host = null; this.unit = null; }

  render(dt: number, nowMs: number) {
    if (!this.host || !this.r || !this.model || !this.canvas.isConnected || this.canvas.offsetParent === null) return;
    this.model.rotation.y += dt * 0.6; this.model.rotation.z = 0.25 * Math.sin(nowMs / 1700); this.r.render(this.scene, this.cam);
  }
}
