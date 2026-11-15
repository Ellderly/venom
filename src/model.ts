// Процедурные модели целей. Габариты по открытым данным, нос смотрит в +Z.
// Детали с именами: `prop` — винт (вращается), `glow` — свечение сопла (яркость зависит от времени суток).
import * as THREE from 'three';

interface SkinOpts {
  size: number; base: [number, number, number];
  seamsX: number[]; seamsY: number[];           // стыки панелей, доли ширины/высоты
  draw?: (g: CanvasRenderingContext2D, b: CanvasRenderingContext2D, s: number) => void; // свои детали: g — цвет, b — рельеф
  repeat?: boolean;
}
let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Обшивка: цвет и карта рельефа. Стыки и лючки утоплены, заклёпки выступают; потёртости и грязь — только в цвете. */
function skin(o: SkinOpts) {
  const S = o.size, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const cc = mk(), cb = mk(), g = cc.getContext('2d')!, b = cb.getContext('2d')!;
  const [r0, g0, b0] = o.base; seed = 7 + r0 * 31 + S;
  g.fillStyle = `rgb(${r0},${g0},${b0})`; g.fillRect(0, 0, S, S); b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) { // неровный тон матовой краски
    const x = rnd() * S, y = rnd() * S, r = S * (0.04 + rnd() * 0.12), h = g.createRadialGradient(x, y, 0, x, y, r), v = rnd() < 0.5 ? 255 : 0;
    h.addColorStop(0, `rgba(${v},${v},${v},0.045)`); h.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = h; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < S * 14; i++) { const v = rnd() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},0.035)`; g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    for (const [c, w, st] of [[g, S / 420, 'rgba(0,0,0,0.55)'], [b, S / 300, '#303030']] as const) { c.strokeStyle = st; c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = S / 500; g.beginPath(); g.moveTo(x0 + S / 400, y0 + S / 400); g.lineTo(x1 + S / 400, y1 + S / 400); g.stroke();
  };
  const rivet = (x: number, y: number) => {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + 0.6, y + 0.6, S / 520, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.13)'; g.beginPath(); g.arc(x, y, S / 640, 0, 6.3); g.fill();
    b.fillStyle = '#c8c8c8'; b.beginPath(); b.arc(x, y, S / 520, 0, 6.3); b.fill();
  };
  const step = S / 46;
  for (const k of o.seamsX) { const x = k * S; line(x, 0, x, S); for (let y = step / 2; y < S; y += step) { rivet(x - S / 110, y); rivet(x + S / 110, y); } }
  for (const k of o.seamsY) { const y = k * S; line(0, y, S, y); for (let x = step / 2; x < S; x += step) { rivet(x, y - S / 110); rivet(x, y + S / 110); } }
  o.draw?.(g, b, S);
  for (let i = 0; i < 70; i++) { // потёртости: короткие светлые штрихи
    const x = rnd() * S, y = rnd() * S, a = rnd() * 6.28, l = S * (0.01 + rnd() * 0.04);
    g.strokeStyle = `rgba(190,195,200,${0.04 + rnd() * 0.1})`; g.lineWidth = 0.6 + rnd() * 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 26; i++) { // потёки грязи вдоль потока (ось Y текстуры)
    const x = rnd() * S, y = rnd() * S, l = S * (0.05 + rnd() * 0.16), h = g.createLinearGradient(0, y, 0, y - l);
    h.addColorStop(0, 'rgba(0,0,0,0.16)'); h.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = h; g.fillRect(x, y - l, 1.5 + rnd() * S / 130, l);
  }
  const map = new THREE.CanvasTexture(cc), bump = new THREE.CanvasTexture(cb); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  if (o.repeat) map.wrapS = map.wrapT = bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  else map.flipY = bump.flipY = false; // развёртка корпуса: y текстуры = доля длины от носа к хвосту
  return { map, bump };
}
/** Лючок: утопленный контур со скруглением и винтами по углам. */
function hatch(g: CanvasRenderingContext2D, b: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  for (const [c, st, lw] of [[g, 'rgba(0,0,0,0.6)', 1.6], [b, '#383838', 2.4]] as const) { c.strokeStyle = st; c.lineWidth = lw; c.beginPath(); c.roundRect(x, y, w, h, Math.min(w, h) * 0.2); c.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(x, y, w, h);
  for (const [px, py] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(px, py, 1.6, 0, 6.3); g.fill(); b.fillStyle = '#d0d0d0'; b.beginPath(); b.arc(px, py, 1.8, 0, 6.3); b.fill(); }
}
/** Надпись вдоль фюзеляжа (ось Y текстуры — вдоль корпуса). */
function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, flip: boolean) {
  g.save(); g.translate(x, y); g.rotate(Math.PI / 2); if (flip) g.scale(-1, -1); else g.scale(1, -1); // на бортах развёртка идёт в разные стороны — иначе одна из надписей зеркальная g.font = `bold ${px}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(text, 0, 0); g.restore();
}
/** Копоть: темнеет к хвосту, начиная с доли длины from. */
function soot(g: CanvasRenderingContext2D, S: number, from: number, alpha: number) {
  const h = g.createLinearGradient(0, S * from, 0, S); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(1, `rgba(0,0,0,${alpha})`); g.fillStyle = h; g.fillRect(0, S * from, S, S * (1 - from));
}
const std = (t: { map: THREE.Texture; bump: THREE.Texture }, rough = 0.8, bumpScale = 1.4) => new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale, roughness: rough, metalness: 0.08 });

/** Тело вращения вдоль оси Z: профиль — пары [радиус, z] от носа к хвосту. На текстуре u — вокруг корпуса (0.25 — правый борт, 0.5 — верх), v — от носа к хвосту. */
function lathe(prof: number[][], seg: number, mat: THREE.Material) {
  const geo = new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), seg), pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  const z0 = prof[0][1], len = z0 - prof[prof.length - 1][1] || 1;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (z0 - pos.getY(i)) / len); // v по длине, а не по номеру точки профиля — текстура не растягивается
  const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; return m;
}
/** Плоская деталь в плане (крыло, стабилизатор): контур в координатах x, z; толщина по Y. */
function plate(pts: number[][], thick: number, mat: THREE.Material, bevel = thick * 0.45) {
  const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: thick - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 1.4, bevelSegments: 2 }), mat);
  m.rotation.x = Math.PI / 2; m.position.y = thick / 2 - bevel; return m;
}
/** Вертикальная деталь (киль): контур в координатах z, y; толщина по X. */
function fin(pts: number[][], thick: number, mat: THREE.Material) {
  const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: thick * 0.5, bevelEnabled: true, bevelThickness: thick * 0.25, bevelSize: thick * 0.4, bevelSegments: 1 }), mat);
  m.rotation.y = -Math.PI / 2; m.position.x = thick / 4; return m;
}

let glowTex: THREE.Texture | null = null;
/** Свечение сопла: раскалённый срез, короткий факел и ореол. Яркость по времени суток выставляет main.ts. */
function jetGlow(r: number) {
  if (!glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!, h = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    h.addColorStop(0, 'rgba(255,255,255,1)'); h.addColorStop(0.18, 'rgba(255,214,150,0.85)'); h.addColorStop(0.5, 'rgba(255,120,40,0.25)'); h.addColorStop(1, 'rgba(255,80,20,0)');
    g.fillStyle = h; g.fillRect(0, 0, 128, 128); glowTex = new THREE.CanvasTexture(c);
  }
  const grp = new THREE.Group(); grp.name = 'glow';
  const add = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 18), add(0xffb070, 1)); core.rotation.y = Math.PI; core.name = 'core'; grp.add(core);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, r * 9, 14, 1, true), add(0xff8a3c, 0.5)); flame.rotation.x = -Math.PI / 2; flame.position.z = -r * 4.5; flame.name = 'flame'; grp.add(flame);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa860, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); halo.scale.setScalar(r * 9); halo.position.z = -r * 1.5; halo.name = 'halo'; grp.add(halo);
  return grp;
}

/** «Герань-2»: «бесхвостка» с треугольным крылом, кили на законцовках, толкающий винт. Длина 3,5 м, размах 2,5 м. */
export function buildGeran2(): THREE.Group {
  const g = new THREE.Group();
  const panel = std(skin({ size: 512, base: [43, 45, 47], seamsX: [0.25, 0.75], seamsY: [0.3, 0.8], repeat: true, draw: (c, b) => { hatch(c, b, 300, 190, 70, 46); hatch(c, b, 60, 420, 44, 60); } }));
  const body = std(skin({ size: 1024, base: [43, 45, 47], seamsX: [0, 0.5], seamsY: [0.1, 0.33, 0.62, 0.86], draw: (c, b, S) => {
    hatch(c, b, S * 0.44, S * 0.4, S * 0.12, S * 0.14); hatch(c, b, S * 0.45, S * 0.14, S * 0.1, S * 0.1);
    label(c, 'Ы 4071', S * 0.25, S * 0.2, S * 0.045, 'rgba(205,208,210,0.85)', false); label(c, 'Ы 4071', S * 0.75, S * 0.2, S * 0.045, 'rgba(205,208,210,0.85)', true);
    soot(c, S, 0.84, 0.75);                                                      // масло и копоть от мотора
  } }));
  const dark = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.6, metalness: 0.4 });
  // крыло: треугольное со срезанными законцовками, корневая хорда ≈ 2,2 м
  const half = 1.25;
  g.add(plate([[0, 1.0], [0.22, 0.86], [half, -1.02], [half, -1.3], [0.3, -1.38], [-0.3, -1.38], [-half, -1.3], [-half, -1.02], [-0.22, 0.86]], 0.14, panel, 0.035));
  // фюзеляж: оживальный нос, цилиндр ≈ 0,45 м, сужение к мотору
  const fus = lathe([[0, 2.1], [0.07, 2.02], [0.15, 1.8], [0.21, 1.45], [0.225, 0.9], [0.225, -0.9], [0.19, -1.25], [0.13, -1.4], [0, -1.4]], 24, body); fus.position.y = 0.05; g.add(fus);
  // кили на законцовках, вверх и вниз от плоскости крыла
  for (const sx of [-1, 1]) { const f = fin([[-1.37, -0.3], [-0.9, -0.3], [-1.08, 0.36], [-1.37, 0.36]], 0.04, panel); f.position.x += sx * half; f.position.y = 0.02; g.add(f); }
  // мотор и двухлопастный толкающий винт
  const eng = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2), dark); eng.position.set(0, 0.05, -1.46); g.add(eng);
  for (const sx of [-1, 1]) { const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10), dark); cyl.rotation.z = Math.PI / 2; cyl.position.set(sx * 0.24, 0.05, -1.46); g.add(cyl); }
  const prop = new THREE.Group(); prop.name = 'prop'; prop.position.set(0, 0.05, -1.6);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.07, 0.015), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.7 })); prop.add(blade);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 10), dark); hub.rotation.x = Math.PI / 2; prop.add(hub); g.add(prop);
  return g;
}

/** «Герань-5»: обычная самолётная схема — прямое крыло, стабилизатор с шайбами-килями, ТРД в гондоле над хвостом. Длина 6 м, размах 5,5 м. */
export function buildGeran5(): THREE.Group {
  const g = new THREE.Group();
  const panel = std(skin({ size: 512, base: [50, 53, 56], seamsX: [0.2, 0.6], seamsY: [0.35, 0.85], repeat: true, draw: (c, b) => { hatch(c, b, 250, 60, 90, 50); hatch(c, b, 90, 300, 50, 70); } }));
  const body = std(skin({ size: 1024, base: [58, 62, 64], seamsX: [0, 0.5], seamsY: [0.12, 0.3, 0.52, 0.72, 0.9], draw: (c, b, S) => {
    c.fillStyle = 'rgba(150,40,34,0.9)'; c.fillRect(0, S * 0.155, S, S * 0.012);                 // красная полоса за боевой частью
    hatch(c, b, S * 0.43, S * 0.36, S * 0.14, S * 0.1); hatch(c, b, S * 0.19, S * 0.58, S * 0.12, S * 0.09); hatch(c, b, S * 0.69, S * 0.58, S * 0.12, S * 0.09); hatch(c, b, S * 0.05, S * 0.4, S * 0.09, S * 0.07);
    label(c, 'Г5-0904', S * 0.25, S * 0.225, S * 0.042, 'rgba(200,203,198,0.85)', false); label(c, 'Г5-0904', S * 0.75, S * 0.225, S * 0.042, 'rgba(200,203,198,0.85)', true);
    const h = c.createLinearGradient(S * 0.38, 0, S * 0.62, 0); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.5, 'rgba(0,0,0,0.6)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = h; c.fillRect(S * 0.38, S * 0.9, S * 0.24, S * 0.1);                           // копоть на спине под соплом
  } }));
  const metal = new THREE.MeshStandardMaterial({ color: 0x6c6a66, roughness: 0.45, metalness: 0.7 });
  const hot = new THREE.MeshStandardMaterial({ color: 0x3a332e, roughness: 0.55, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.7, metalness: 0.2 });
  // фюзеляж: скруглённый нос, цилиндр ≈ 0,6 м, сужение к хвосту
  const prof: number[][] = [[0, 3.0]]; for (let i = 7; i >= 0; i--) { const a = i / 8 * Math.PI / 2; prof.push([0.3 * Math.cos(a), 2.45 + 0.55 * Math.sin(a)]); }
  prof.push([0.3, -1.8], [0.27, -2.2], [0.21, -2.6], [0.13, -2.9], [0.06, -3.0], [0, -3.0]);
  g.add(lathe(prof, 28, body));
  // прямое крыло посередине: корневая хорда 0,8 м, концевая 0,5 м; наплыв у корня
  const hw = 2.75; g.add(plate([[0, 1.05], [0.34, 1.02], [hw, 0.78], [hw, 0.28], [0.34, 0.2], [-0.34, 0.2], [-hw, 0.28], [-hw, 0.78], [-0.34, 1.02]], 0.1, panel, 0.03));
  const root = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.95), panel); root.position.set(0, -0.02, 0.6); g.add(root);
  // хвост: прямой стабилизатор с килями-шайбами на концах
  const hs = 0.98; const st = plate([[0, -2.0], [hs, -2.1], [hs, -2.52], [-hs, -2.52], [-hs, -2.1]], 0.07, panel, 0.02); st.position.y += 0.02; g.add(st);
  for (const sx of [-1, 1]) { const f = fin([[-2.52, -0.14], [-2.14, -0.14], [-2.06, 0.02], [-2.32, 0.36], [-2.52, 0.36]], 0.045, panel); f.position.x += sx * hs; g.add(f); }
  // ТРД в гондоле на пилоне над хвостовой частью: воздухозаборник спереди, сопло сзади
  const ny = 0.55;
  const pylon = fin([[-2.25, 0.2], [-1.45, 0.2], [-1.6, 0.42], [-2.2, 0.42]], 0.09, panel); g.add(pylon);
  const nac = lathe([[0.11, -1.42], [0.135, -1.38], [0.16, -1.42], [0.165, -1.6], [0.155, -2.4]], 20, panel); nac.position.y = ny; g.add(nac);
  const lip = lathe([[0.11, -1.46], [0.11, -1.42], [0.135, -1.38]], 20, metal); lip.position.y = ny; g.add(lip);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.112, 20), dark); fan.position.set(0, ny, -1.45); g.add(fan);
  const spin = lathe([[0, -1.36], [0.03, -1.4], [0.045, -1.46]], 12, metal); spin.position.y = ny; g.add(spin);
  const noz = lathe([[0.155, -2.4], [0.13, -2.55], [0.095, -2.62], [0.085, -2.62], [0.075, -2.5]], 20, hot); noz.position.y = ny; g.add(noz);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.22), dark); ant.position.set(0, 0.31, 0.9); g.add(ant); // антенна спутниковой навигации
  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), dark); pitot.rotation.x = Math.PI / 2; pitot.position.set(0, 0, 3.1); g.add(pitot);
  const glow = jetGlow(0.085); glow.position.set(0, ny, -2.6); g.add(glow);
  return g;
}

/** Огневая группа: пикап с крупнокалиберным пулемётом в кузове и прожектором. `mount` поворачивается по курсу, `gun` — по углу места. */
export function buildPickup(): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 0.75, metalness: 0.15 }), dark = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.7, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.2, metalness: 0.6 }), steel = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.5, metalness: 0.7 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, to: THREE.Object3D = g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); to.add(b); return b; };
  box(1.85, 0.5, 5.2, 0, 0.75, 0, paint);                          // рама и борта
  box(1.8, 0.35, 1.5, 0, 1.1, 1.75, paint);                        // капот
  box(1.75, 0.75, 1.7, 0, 1.4, 0.25, paint);                       // кабина
  box(1.6, 0.5, 0.06, 0, 1.47, 1.1, glass).rotation.x = -0.35;      // лобовое стекло
  box(1.77, 0.42, 1.2, 0, 1.47, 0.2, glass);                       // боковые стёкла
  box(1.85, 0.45, 0.08, 0, 1.2, -2.56, paint);                     // задний борт
  for (const sx of [-1, 1]) box(0.08, 0.45, 1.9, sx * 0.89, 1.2, -1.6, paint);
  box(1.9, 0.18, 0.2, 0, 0.62, 2.6, dark); box(1.9, 0.18, 0.2, 0, 0.62, -2.6, dark); // бамперы
  for (const sx of [-1, 1]) for (const z of [1.65, -1.6]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14), dark); w.rotation.z = Math.PI / 2; w.position.set(sx * 0.85, 0.4, z); g.add(w); }
  box(0.25, 0.14, 0.2, 0, 1.86, 0.6, steel);                       // прожектор на крыше
  const mount = new THREE.Group(); mount.name = 'mount'; mount.position.set(0, 1.0, -1.5); g.add(mount);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.0, 8), steel); post.position.y = 0.5; mount.add(post); // тумба
  const gun = new THREE.Group(); gun.name = 'gun'; gun.position.y = 1.1; mount.add(gun);
  box(0.16, 0.2, 0.7, 0, 0, 0.05, steel, gun);                     // ствольная коробка
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.5, 8), steel); barrel.rotation.x = Math.PI / 2; barrel.position.z = 1.1; gun.add(barrel);
  box(0.3, 0.22, 0.3, 0.24, -0.02, 0, paint, gun);                 // патронная коробка
  box(0.5, 0.04, 0.04, 0, 0, -0.45, steel, gun);                   // рукоятки
  box(0.6, 0.5, 0.03, 0, 0.1, 0.45, paint, gun);                   // щиток
  return g;
}
