// Процедурная модель «Герань-2»: «бесхвостка» с треугольным крылом, кили на законцовках, толкающий винт.
// Габариты по открытым данным: длина 3,5 м, размах 2,5 м. Нос смотрит в +Z.
import * as THREE from 'three';

function skinTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#2b2d2f'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,0.02)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; // стыки панелей
  for (const y of [40, 96, 160, 214]) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (const x of [64, 128, 192]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildGeran2(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ map: skinTexture(), color: 0xffffff, roughness: 0.82, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.6, metalness: 0.4 });
  // крыло: треугольное со срезанными законцовками, корневая хорда ≈ 2,2 м
  const half = 1.25, w = new THREE.Shape();
  w.moveTo(0, 1.0); w.lineTo(0.22, 0.86); w.lineTo(half, -1.02); w.lineTo(half, -1.3); w.lineTo(0.3, -1.38); w.lineTo(-0.3, -1.38); w.lineTo(-half, -1.3); w.lineTo(-half, -1.02); w.lineTo(-0.22, 0.86); w.closePath();
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(w, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.05, bevelSegments: 2 }), skin);
  wing.rotation.x = Math.PI / 2; wing.position.y = 0.035; g.add(wing);
  // фюзеляж: оживальный нос, цилиндр ≈ 0,45 м, сужение к мотору
  const prof = [[0, 2.1], [0.07, 2.02], [0.15, 1.8], [0.21, 1.45], [0.225, 0.9], [0.225, -0.9], [0.19, -1.25], [0.13, -1.4], [0, -1.4]].map(p => new THREE.Vector2(p[0], p[1]));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), skin); body.rotation.x = Math.PI / 2; body.position.y = 0.05; g.add(body);
  // кили на законцовках, вверх и вниз от плоскости крыла
  const f = new THREE.Shape(); f.moveTo(-0.27, -0.3); f.lineTo(0.2, -0.3); f.lineTo(0.02, 0.36); f.lineTo(-0.27, 0.36); f.closePath();
  for (const sx of [-1, 1]) { const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(f, { depth: 0.03, bevelEnabled: false }), skin); fin.rotation.y = -Math.PI / 2; fin.position.set(sx * half + 0.015, 0.02, -1.1); g.add(fin); }
  // мотор и двухлопастный толкающий винт
  const eng = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2), dark); eng.position.set(0, 0.05, -1.46); g.add(eng);
  for (const sx of [-1, 1]) { const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10), dark); cyl.rotation.z = Math.PI / 2; cyl.position.set(sx * 0.24, 0.05, -1.46); g.add(cyl); }
  const prop = new THREE.Group(); prop.name = 'prop'; prop.position.set(0, 0.05, -1.6);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.07, 0.015), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.7 })); prop.add(blade);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 10), dark); hub.rotation.x = Math.PI / 2; prop.add(hub); g.add(prop);
  return g;
}
