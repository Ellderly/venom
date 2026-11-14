import * as THREE from 'three';
import { MapData } from './map';
import { Env, U } from './env';
import { Ground } from './ground';
import { Buildings } from './buildings';
import { CityCamera } from './camera';
import { FX } from './fx';
import { Sound, Heard } from './audio';
import { buildGeran2 } from './model';
import { UNITS, UnitDef } from './units';
import { Launch, State, trajectory, planLaunch } from './sim';
import { Destruction } from './voxels';
import { Session, Msg, localSession, remoteSession } from './net';
import { PRESETS, loadQualityName, saveQualityName } from './quality';

declare const __BUILD__: string;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (s: number) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const qName = loadQualityName(), Q = PRESETS[qName];
const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: qName !== 'low', powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // свои шейдеры сами переводят цвет в sRGB
const scene = new THREE.Scene();
const map = new MapData(), sound = new Sound();
let env: Env, ground: Ground, buildings: Buildings, cc: CityCamera, fx: FX, destr: Destruction;
let session: Session | null = null;
let dyn = 1; // динамическое разрешение

interface Drone { L: Launch; mesh: THREE.Group; prop: THREE.Object3D; label: HTMLElement; row: HTMLElement; s: State }
const drones = new Map<number, Drone>();
const proto = buildGeran2();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1), Q.pixelRatio) * dyn); renderer.setSize(w, h, false); cc?.resize(w, h);
}
window.addEventListener('resize', resize);

// ---------- запуск ----------
const launchUI = { armed: null as UnitDef | null, step: 0, mode: 60 as number, count: 1, tx: 0, tz: 0 };
const MODES: [number, string][] = [[0, 'С точки клика'], [15, '15 с'], [60, '1 мин'], [180, '3 мин']];
const marker = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff6a4a, depthTest: false, fog: false }));
marker.visible = aimLine.visible = false; marker.renderOrder = aimLine.renderOrder = 30; aimLine.frustumCulled = false;

function arm(u: UnitDef | null) {
  launchUI.armed = u; launchUI.step = 0; marker.visible = aimLine.visible = false;
  $('launch').classList.toggle('hidden', !u); canvas.classList.toggle('aim', !!u);
  document.querySelectorAll('.slot').forEach(e => e.classList.toggle('on', !!u && (e as HTMLElement).dataset.unit === u.id));
  renderLaunch();
}
function renderLaunch() {
  const u = launchUI.armed; if (!u) return;
  $('step').innerHTML = launchUI.step === 0 ? `<b>Шаг 1.</b> Кликните по цели в городе — туда ударит ${u.name}`
    : launchUI.mode === 0 ? '<b>Шаг 2.</b> Кликните точку, откуда прилетит цель' : '<b>Шаг 2.</b> Кликните, с какой стороны прилетит цель';
  $('modes').innerHTML = ''; for (const [m, n] of MODES) { const b = document.createElement('button'); b.textContent = n; b.className = m === launchUI.mode ? 'on' : ''; b.onclick = () => { launchUI.mode = m; renderLaunch(); }; $('modes').append(b); }
  $('counts').innerHTML = ''; for (const c of [1, 3, 5, 10]) { const b = document.createElement('button'); b.textContent = c === 1 ? '1' : `рой ×${c}`; b.className = c === launchUI.count ? 'on' : ''; b.onclick = () => { launchUI.count = c; renderLaunch(); }; $('counts').append(b); }
  const km = launchUI.mode * u.speed / 1000;
  $('launchNote').textContent = launchUI.mode === 0 ? `Летит с реальной скоростью ${Math.round(u.speed * 3.6)} км/ч от точки клика: 10 км — примерно ${fmt(10000 / u.speed)}.`
    : `Скорость реальная (${Math.round(u.speed * 3.6)} км/ч), поэтому цель появится в ${km.toFixed(1)} км от точки удара.`;
}
function onMapClick(px: number, py: number) {
  sound.unlock();
  const u = launchUI.armed; if (!u || !session) return;
  const p = cc.pick(px, py); if (!p) return;
  if (launchUI.step === 0) { launchUI.tx = p.x; launchUI.tz = p.z; launchUI.step = 1; marker.position.set(p.x, p.y + 1, p.z); marker.visible = true; renderLaunch(); return; }
  let dx = p.x - launchUI.tx, dz = p.z - launchUI.tz; const d = Math.hypot(dx, dz); if (d < 30) return; dx /= d; dz /= d;
  const dist = launchUI.mode === 0 ? Math.max(d, 400) : launchUI.mode * u.speed;
  for (let i = 0; i < launchUI.count; i++) {
    const k = i === 0 ? 0 : 1, lat = (Math.random() - 0.5) * 500 * k, back = Math.random() * 700 * k, sc = (Math.random() - 0.5) * 140 * k, sc2 = (Math.random() - 0.5) * 140 * k;
    const L = { id: 0, unit: u.id, by: session.me, t0: 0, seed: Math.random() * 100, tx: launchUI.tx + sc, tz: launchUI.tz + sc2,
      sx: launchUI.tx + dx * (dist + back) - dz * lat, sz: launchUI.tz + dz * (dist + back) + dx * lat } as Launch;
    planLaunch(L, map); session.send({ type: 'launch', launch: L });
  }
  launchUI.step = 0; marker.visible = aimLine.visible = false; renderLaunch();
}
canvas.addEventListener('pointermove', e => {
  if (!launchUI.armed || launchUI.step !== 1) return;
  const p = cc.pick(e.clientX, e.clientY); if (!p) return;
  const a = aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
  a.setXYZ(0, marker.position.x, marker.position.y + 2, marker.position.z); a.setXYZ(1, p.x, p.y + 2, p.z); a.needsUpdate = true; aimLine.visible = true;
});

// ---------- события сессии ----------
let localId = 1;
function feed(t: string) { const d = document.createElement('div'); d.textContent = t; $('feed').append(d); setTimeout(() => d.remove(), 9000); while ($('feed').children.length > 6) $('feed').firstChild!.remove(); }

function addDrone(L: Launch) {
  if (!UNITS[L.unit] || ![L.sx, L.sz, L.tx, L.tz, L.t0].every(Number.isFinite)) return; // чужие данные по сети не должны ломать игру
  if (!session!.online) L.id = localId++;
  if (L.impactT === undefined) planLaunch(L, map);
  const u = UNITS[L.unit];
  if (session!.now() >= L.t0 + L.impactT) { impact(L, true); return; } // подключились позже — попадание уже было
  const mesh = proto.clone(); scene.add(mesh);
  const label = document.createElement('div'); label.className = 'lbl'; $('labels').append(label);
  const row = document.createElement('div'); row.className = 'it'; $('active').append(row);
  const d: Drone = { L, mesh, prop: mesh.getObjectByName('prop')!, label, row, s: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 } };
  const follow = () => { cc.follow = () => drones.has(L.id) ? mesh.position : null; cc.dist = Math.min(cc.dist, 160); };
  label.onclick = row.onclick = follow;
  drones.set(L.id, d); $('active').classList.remove('hidden');
  feed(`Запуск: ${u.name} (${L.by}), подлёт через ${fmt(L.impactT)}`);
  if (drones.size === 1) sound.siren();
}

function impact(L: Launch, silent = false) {
  const u = UNITS[L.unit];
  const [hit, fell] = destr.blast(L.ix, L.iy, L.iz, 1.6 * Math.cbrt(u.tntKg), b => buildings.hide(b));
  if (silent) { fx.smolder(L.ix, L.iy, L.iz, u.tntKg); return; }
  fx.explode(L.ix, L.iy, L.iz, u.tntKg);
  const dist = cc.cam.position.distanceTo(new THREE.Vector3(L.ix, L.iy, L.iz));
  sound.explosion(dist, u.tntKg, fell > 40); cc.shake = Math.max(cc.shake, Math.min(6, 900 / Math.max(60, dist)));
  feed(hit ? `Попадание: ${u.name} — повреждено зданий: ${hit}` + (fell > 40 ? ', часть конструкций обрушилась' : '') : `Попадание: ${u.name} — открытая местность`);
}

function removeDrone(d: Drone) { scene.remove(d.mesh); d.label.remove(); d.row.remove(); drones.delete(d.L.id); if (!drones.size) $('active').classList.add('hidden'); }

function resetDamage() { map.bDamage.fill(0); destr.reset(); buildings.reset(); fx.clear(); for (const d of [...drones.values()]) removeDrone(d); }

function onMsg(m: Msg) {
  if (m.type === 'welcome') { env.hour = m.env.hour; env.speed = m.env.speed; m.launches.forEach(addDrone); setPlayers(m.players); }
  else if (m.type === 'launch') addDrone(m.launch);
  else if (m.type === 'env') { env.hour = m.hour; env.speed = m.speed; }
  else if (m.type === 'reset') { resetDamage(); feed('Разрушения сброшены'); }
  else if (m.type === 'players') { if (m.players < 0) { feed('Соединение с сессией потеряно'); $('sess').textContent = 'Нет связи'; } else setPlayers(m.players); }
}
function setPlayers(n: number) { $('sess').textContent = session?.online ? `Сетевая · игроков: ${n}` : 'Одиночная'; }

function start(s: Session) {
  session = s; setPlayers(1); s.listen(onMsg);
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); sound.unlock();
}
function toMenu() { session?.close(); session = null; arm(null); resetDamage(); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); $('menuMain').classList.remove('hidden'); $('menuNet').classList.add('hidden'); }

// ---------- окна ----------
function modal(html: string, cls = '') {
  const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="panel ${cls}">${html}</div>`;
  m.addEventListener('pointerdown', e => { if (e.target === m) close(); });
  const close = () => { m.remove(); if (cardView?.host === m) cardView = null; };
  m.querySelectorAll('[data-close]').forEach(b => (b as HTMLElement).onclick = close);
  $('modals').append(m); return m;
}
let cardView: { host: HTMLElement; r: THREE.WebGLRenderer; s: THREE.Scene; c: THREE.PerspectiveCamera; m: THREE.Object3D } | null = null;
function showCard(u: UnitDef) {
  const m = modal(`<div class="card"><div><canvas width="660" height="500"></canvas><p class="note">Модель в игре построена по реальным габаритам. Поздняя тёмная окраска для ночных налётов.</p></div>
    <div><div class="tag">${u.kind}</div><h2>${u.name} <span style="color:var(--dim);font-weight:400">/ ${u.alt}</span></h2><p>${u.about}</p>
    <table><tr><td>Происхождение</td><td>${u.origin}</td></tr>${u.card.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <p class="note">Данные из открытых источников, приблизительные. В игре: скорость ${Math.round(u.speed * 3.6)} км/ч, высота маршрута до ${u.cruiseAgl} м, пикирование под ${u.diveDeg}°, эквивалент ${u.tntKg} кг ТНТ.</p>
    <button data-close>Закрыть</button> <button class="on" id="cardArm">Запустить</button></div></div>`);
  (m.querySelector('#cardArm') as HTMLElement).onclick = () => { m.remove(); cardView = null; arm(u); };
  const r = new THREE.WebGLRenderer({ canvas: m.querySelector('canvas')!, antialias: true, alpha: true }), s = new THREE.Scene(), c = new THREE.PerspectiveCamera(32, 660 / 500, 0.1, 50);
  s.add(new THREE.HemisphereLight(0xdde8ff, 0x5a5040, 4)); const dl = new THREE.DirectionalLight(0xffffff, 5); dl.position.set(3, 5, 4); s.add(dl);
  const mm = proto.clone(); s.add(mm); c.position.set(0, 1.9, 4.9); c.lookAt(0, 0, 0);
  cardView = { host: m, r, s, c, m: mm };
}
function showHelp() {
  modal(`<h2>Управление</h2><table class="help">
    <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / стрелки</td><td>движение камеры (<kbd>Shift</kbd> — быстрее)</td></tr>
    <tr><td>Левая кнопка + тянуть</td><td>перетаскивание карты</td></tr>
    <tr><td>Правая / средняя кнопка + тянуть</td><td>поворот и наклон</td></tr>
    <tr><td>Колесо, <kbd>Z</kbd> / <kbd>X</kbd></td><td>приближение и отдаление (до вида на весь регион)</td></tr>
    <tr><td><kbd>Q</kbd> / <kbd>E</kbd>, <kbd>R</kbd> / <kbd>F</kbd></td><td>поворот, наклон</td></tr>
    <tr><td><kbd>1</kbd></td><td>выбрать «Герань-2» для запуска</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>отменить запуск / закрыть окно</td></tr>
    <tr><td>Клик по метке цели</td><td>камера следует за целью</td></tr></table>
    <h2 style="margin-top:14px">Как запустить «Герань-2»</h2>
    <p>1. Нажмите слот «Герань-2» внизу (или <kbd>1</kbd>).<br>2. Выберите время подлёта и количество.<br>3. Кликните по цели в городе.<br>4. Кликните, откуда она прилетит.</p>
    <button data-close>Закрыть</button>`);
}
function showSettings() {
  const m = modal(`<div class="form"><h2>Настройки</h2>
    <label>Качество графики <select id="sq">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}" ${k === qName ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
    <p class="note">Смена качества перезагружает игру. При просадке кадров разрешение картинки снижается автоматически.</p>
    <label>Громкость <input type="range" id="sv" min="0" max="1" step="0.05" value="${sound.volume}"></label>
    <button data-close>Закрыть</button></div>`);
  (m.querySelector('#sq') as HTMLSelectElement).onchange = e => { saveQualityName((e.target as HTMLSelectElement).value); location.reload(); };
  (m.querySelector('#sv') as HTMLInputElement).oninput = e => sound.setVolume(Number((e.target as HTMLInputElement).value));
}
function showAdmin() {
  const speeds = [0, 1, 5, 10, 60, 600, 3600];
  const m = modal(`<div class="form"><h2>Админ-панель</h2>
    <label>Время суток <input type="range" id="ah" min="0" max="24" step="0.05" value="${env.hour}"> <b id="ahv">${env.clock()}</b></label>
    <label>Скорость времени <select id="as">${speeds.map(s => `<option value="${s}" ${s === env.speed ? 'selected' : ''}>${s === 0 ? 'пауза' : '×' + s}</option>`).join('')}</select></label>
    <p class="note">×1 — как в жизни, ×60 — час за минуту, ×3600 — сутки за 24 секунды. В сетевой игре меняется у всех.</p>
    <button id="ar">Сбросить разрушения</button> <button data-close>Закрыть</button></div>`);
  const push = () => session?.send({ type: 'env', hour: env.hour, speed: env.speed });
  (m.querySelector('#ah') as HTMLInputElement).oninput = e => { env.hour = Number((e.target as HTMLInputElement).value) % 24; m.querySelector('#ahv')!.textContent = env.clock(); };
  (m.querySelector('#ah') as HTMLInputElement).onchange = push;
  (m.querySelector('#as') as HTMLSelectElement).onchange = e => { env.speed = Number((e.target as HTMLSelectElement).value); push(); };
  (m.querySelector('#ar') as HTMLElement).onclick = () => session?.send({ type: 'reset' });
}

function buildSlots() {
  const icon = `<svg viewBox="0 0 64 40"><path d="M32 2 L35 9 L58 30 L58 35 L38 37 L26 37 L6 35 L6 30 L29 9 Z" fill="#cfd6dc"/><rect x="29.5" y="36" width="5" height="3" fill="#8a6a44"/></svg>`;
  const el = $('slots'); el.innerHTML = '';
  Object.values(UNITS).forEach((u, i) => {
    const s = document.createElement('div'); s.className = 'slot'; s.dataset.unit = u.id;
    s.innerHTML = `<span class="key">${i + 1}</span><button class="info" title="Карточка">i</button>${icon}<b>${u.name}</b>`;
    s.onclick = () => arm(launchUI.armed === u ? null : u);
    (s.querySelector('.info') as HTMLElement).onclick = e => { e.stopPropagation(); showCard(u); };
    el.append(s);
  });
  for (const n of ['Ракеты', 'ПВО', 'Скоро']) { const s = document.createElement('div'); s.className = 'slot lock'; s.innerHTML = `<b>${n}</b><span class="note">в разработке</span>`; el.append(s); }
}

window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'Escape') { const m = $('modals').lastElementChild; if (m) { m.remove(); cardView = null; } else arm(null); }
  if (e.code === 'Digit1' && session) arm(UNITS.geran2);
});

// ---------- главный цикл ----------
const v3 = new THREE.Vector3(), fwd = new THREE.Vector3(), heard: Heard[] = [];
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
function frame(nowMs: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs;
  U.uTime.value += dt;
  cc.update(dt); const t = cc.target;
  env.update(dt, scene, cc.cam);
  U.uFogD.value = 1 / Math.max(45000, t.dist * 3.2);
  ground.update(t.x, t.z, t.dist); buildings.update(t.x, t.z, t.dist);
  if (session) {
    const now = session.now(); heard.length = 0;
    for (const d of [...drones.values()]) {
      const tt = now - d.L.t0;
      if (tt >= d.L.impactT) { removeDrone(d); impact(d.L); continue; }
      trajectory(d.L, map, Math.max(0, tt), d.s);
      d.mesh.position.set(d.s.x, d.s.y, d.s.z); fwd.set(d.s.vx, d.s.vy, d.s.vz);
      d.mesh.lookAt(v3.copy(d.mesh.position).add(fwd)); d.prop.rotation.z += dt * 90;
      const dist = cc.cam.position.distanceTo(d.mesh.position);
      d.mesh.scale.setScalar(Math.max(1, dist / 260)); // издалека модель увеличивается, чтобы цель оставалась видимой
      const closing = -fwd.dot(v3.copy(d.mesh.position).sub(cc.cam.position).normalize());
      v3.copy(d.mesh.position).project(cc.cam);
      heard.push({ dist, closing, pan: v3.z > 1 ? -v3.x : v3.x, dive: Math.min(1, Math.max(0, 1 - (d.L.impactT - tt) / 3.5)), seed: d.L.seed });
      // метка всегда на экране: если цель вне кадра, прижимается к краю
      if (v3.z > 1) { v3.x = -v3.x; v3.y = -v3.y; }
      const off = v3.z > 1 || Math.abs(v3.x) > 0.94 || v3.y > 0.8 || v3.y < -0.94;
      if (off) { const k = Math.max(Math.abs(v3.x) / 0.94, v3.y > 0 ? v3.y / 0.8 : -v3.y / 0.94, 1e-6); v3.x /= k; v3.y /= k; }
      d.label.style.left = `${(v3.x + 1) / 2 * innerWidth}px`; d.label.style.top = `${(1 - v3.y) / 2 * innerHeight}px`; d.label.style.opacity = off ? '0.7' : '1';
      const eta = fmt(d.L.impactT - tt); d.label.textContent = `${UNITS[d.L.unit].name} ${eta}`; d.row.innerHTML = `<span>${UNITS[d.L.unit].name} №${d.L.id}</span><b>${eta}</b>`;
    }
  } else heard.length = 0;
  sound.engines(heard);
  if (marker.visible) marker.scale.setScalar(Math.max(12, t.dist * 0.018) * (1 + 0.08 * Math.sin(nowMs / 150)));
  destr.update(dt); fx.update(dt);
  renderer.render(scene, cc.cam);
  if (cardView) { cardView.m.rotation.y += dt * 0.6; cardView.m.rotation.z = 0.25 * Math.sin(nowMs / 1700); cardView.r.render(cardView.s, cardView.c); }
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    const fps = fpsN / fpsAcc, i = renderer.info.render;
    $('perf').textContent = `${fps.toFixed(0)} к/с · ${(1000 / fps).toFixed(1)} мс · вызовов ${i.calls} · треуг. ${(i.triangles / 1e6).toFixed(2)} млн\nтайлов ${buildings.stats.tiles} · частиц ${fx.count} · обломков ${destr.debris} · разрешение ${Math.round(dyn * 100)}% · ${Q.name}`;
    $('clock').textContent = env.clock(); $('tspeed').textContent = env.speed ? `×${env.speed}` : 'пауза';
    const nd = fps < 40 ? Math.max(0.5, dyn - 0.1) : fps > 57 ? Math.min(1, dyn + 0.05) : dyn;
    if (nd !== dyn && document.hasFocus() && !location.search.includes('nodyn')) { dyn = nd; resize(); }
    fpsAcc = fpsN = fpsT = 0;
  }
}

async function boot() {
  const bar = (p: number, label: string) => { $('loadBar').style.width = `${p * 100}%`; $('loadText').textContent = label; };
  await map.load('./data/', bar);
  env = new Env(scene); cc = new CityCamera(canvas, map); cc.onClick = onMapClick;
  ground = new Ground(map, Q, renderer.capabilities.getMaxAnisotropy());
  bar(0.75, 'Отрисовка карты');
  await ground.buildOverview(p => bar(0.75 + p * 0.23, 'Отрисовка карты'));
  buildings = new Buildings(map, Q); fx = new FX(Q.particles); destr = new Destruction(map, buildings.mat, fx, Q.voxel, Q.debris);
  scene.add(ground.group, buildings.group, destr.group, fx.group, marker, aimLine);
  resize(); buildSlots();
  $('attr').textContent = map.meta.attribution; $('ver').textContent = 'Сборка ' + __BUILD__;
  $('loading').classList.add('hidden'); $('menu').classList.remove('hidden');
  $('btnSolo').onclick = () => start(localSession());
  $('btnNet').onclick = () => { $('menuMain').classList.add('hidden'); $('menuNet').classList.remove('hidden'); if (location.protocol === 'http:' && !$<HTMLInputElement>('netAddr').value) $<HTMLInputElement>('netAddr').value = location.host; };
  $('btnNetBack').onclick = () => { $('menuNet').classList.add('hidden'); $('menuMain').classList.remove('hidden'); };
  $('btnConnect').onclick = async () => {
    $('netErr').textContent = 'Подключение…';
    try { start(await remoteSession($<HTMLInputElement>('netAddr').value)); $('netErr').textContent = ''; }
    catch { $('netErr').textContent = 'Не удалось подключиться. Проверьте адрес и что сессия запущена.'; }
  };
  $('btnSettings0').onclick = $('btnSettings').onclick = showSettings; $('btnHelp0').onclick = $('btnHelp').onclick = showHelp;
  $('btnAdmin').onclick = showAdmin; $('btnMenu').onclick = toMenu; $('btnCancel').onclick = () => arm(null);
  (window as any).venom = { map, cc, env, drones, buildings, fx, destr, arm, UNITS, get session() { return session; } };
  requestAnimationFrame(frame);
}
boot().catch(e => { $('loadText').textContent = 'Ошибка загрузки: ' + (e?.message ?? e); console.error(e); });
