import * as THREE from 'three';
import { MapData } from './map';
import { Env, U } from './env';
import { Ground } from './ground';
import { Buildings } from './buildings';
import { CityCamera } from './camera';
import { FX } from './fx';
import { Sound, Heard } from './audio';
import { buildGeran2 } from './model';
import { UNITS, UnitDef, Side, SIDE_NAME, CATEGORIES, unitsOf } from './units';
import { Launch, State, trajectory, planLaunch } from './sim';
import { Destruction } from './voxels';
import { Session, Msg, Player, Worlds, WorldInfo, worldStore, remoteSession } from './net';
import { PRESETS, loadQualityName } from './quality';
import { S, saveSettings, isKey, keyName, applyUiScale } from './settings';
import { $, el, esc, fmt, modal, Modal, topModal, closeTopModal, showHelp, showSettings } from './ui';
import { CardView } from './card';
import { TacMap, Minimap, TacData } from './tacmap';
import { Trees } from './trees';
import { Bridges } from './bridges';
import { Shadows } from './shadows';
import { Post } from './post';
import { Landmarks } from './landmarks';

declare const __BUILD__: string;

const qName = loadQualityName(), Q = PRESETS[qName];
const canvas = $<HTMLCanvasElement>('view');
const usePost = Q.msaa > 0 || Q.bloom;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost && qName !== 'low', powerPreference: 'high-performance' });
renderer.info.autoReset = false; // кадр состоит из нескольких проходов — счётчики сбрасываем сами
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // свои шейдеры сами переводят цвет в sRGB
const scene = new THREE.Scene();
const map = new MapData(), sound = new Sound(); sound.volume = S.volume;
let env: Env, ground: Ground, buildings: Buildings, cc: CityCamera, fx: FX, destr: Destruction, tac: TacMap, mini: Minimap, trees: Trees, bridges: Bridges, landmarks: Landmarks;
let shadows: Shadows | null = null, post: Post | null = null;
let session: Session | null = null, worlds: Worlds;
let players: Player[] = [];
let dyn = 1; // динамическое разрешение

interface Drone { L: Launch; mesh: THREE.Group; prop: THREE.Object3D; label: HTMLElement; row: HTMLElement; s: State; eta: number }
const drones = new Map<number, Drone>();
const hits: { x: number; z: number }[] = [];
/** Модели юнитов: по одной заготовке на тип, в игру идут копии. */
const protos: Record<string, THREE.Group> = { geran2: buildGeran2() };
const cards = new CardView(Object.fromEntries(Object.entries(protos).map(([k, p]) => [k, () => p.clone()])));

const me = () => players.find(p => p.id === session?.me) ?? null;
const mySide = (): Side | null => me()?.side ?? null;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1), Q.pixelRatio) * dyn); renderer.setSize(w, h, false); cc?.resize(w, h); post?.resize();
}
window.addEventListener('resize', resize);

// ---------- запуск ----------
const launchUI = { armed: null as UnitDef | null, step: 0, mode: 60 as number, count: 1, tx: 0, tz: 0 };
const MODES: [number, string][] = [[0, 'С точки клика'], [15, '15 с'], [60, '1 мин'], [180, '3 мин']];
const marker = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff6a4a, depthTest: false, fog: false }));
marker.visible = aimLine.visible = false; marker.renderOrder = aimLine.renderOrder = 30; aimLine.frustumCulled = false;

function arm(u: UnitDef | null) {
  if (u && mySide() !== u.side) { feed(`«${u.name}» доступна стороне «${SIDE_NAME[u.side]}». Смените сторону: ${keyName(S.keys.side)}`, 'sys'); u = null; }
  launchUI.armed = u; launchUI.step = 0; marker.visible = aimLine.visible = false;
  $('launch').classList.toggle('hidden', !u); canvas.classList.toggle('aim', !!u);
  document.querySelectorAll('[data-unit]').forEach(e => e.classList.toggle('on', !!u && (e as HTMLElement).dataset.unit === u.id));
  renderLaunch(); renderTacUnits();
}
function renderLaunch() {
  const u = launchUI.armed; if (!u) return;
  $('step').innerHTML = launchUI.step === 0 ? `<b>Шаг 1.</b> Кликните по цели в городе — туда ударит ${u.name}`
    : launchUI.mode === 0 ? '<b>Шаг 2.</b> Кликните точку, откуда прилетит цель' : '<b>Шаг 2.</b> Кликните, с какой стороны прилетит цель';
  $('modes').innerHTML = ''; for (const [m, n] of MODES) { const b = el('button', m === launchUI.mode ? 'on' : ''); b.textContent = n; b.onclick = () => { launchUI.mode = m; renderLaunch(); }; $('modes').append(b); }
  $('counts').innerHTML = ''; for (const c of [1, 3, 5, 10]) { const b = el('button', c === launchUI.count ? 'on' : ''); b.textContent = c === 1 ? '1' : `рой ×${c}`; b.onclick = () => { launchUI.count = c; renderLaunch(); }; $('counts').append(b); }
  const km = launchUI.mode * u.speed / 1000;
  $('launchNote').textContent = launchUI.mode === 0 ? `Летит с реальной скоростью ${Math.round(u.speed * 3.6)} км/ч от точки клика: 10 км — примерно ${fmt(10000 / u.speed)}.`
    : `Скорость реальная (${Math.round(u.speed * 3.6)} км/ч), поэтому цель появится в ${km.toFixed(1)} км от точки удара.`;
  $('tacHint').innerHTML = $('step').innerHTML;
}
/** Клик по точке мира — из 3D-вида или с тактической карты. */
function clickWorld(x: number, z: number) {
  sound.unlock();
  const u = launchUI.armed; if (!u || !session) return false;
  if (launchUI.step === 0) { launchUI.tx = x; launchUI.tz = z; launchUI.step = 1; marker.position.set(x, map.heightAt(x, z) + 1, z); marker.visible = true; renderLaunch(); return true; }
  let dx = x - launchUI.tx, dz = z - launchUI.tz; const d = Math.hypot(dx, dz); if (d < 30) return true; dx /= d; dz /= d;
  const dist = launchUI.mode === 0 ? Math.max(d, 400) : launchUI.mode * u.speed;
  for (let i = 0; i < launchUI.count; i++) {
    const k = i === 0 ? 0 : 1, lat = (Math.random() - 0.5) * 500 * k, back = Math.random() * 700 * k, sc = (Math.random() - 0.5) * 140 * k, sc2 = (Math.random() - 0.5) * 140 * k;
    const L = { id: 0, unit: u.id, by: '', t0: 0, seed: Math.random() * 100, tx: launchUI.tx + sc, tz: launchUI.tz + sc2,
      sx: launchUI.tx + dx * (dist + back) - dz * lat, sz: launchUI.tz + dz * (dist + back) + dx * lat } as Launch;
    planLaunch(L, map); session.send({ type: 'launch', launch: L });
  }
  launchUI.step = 0; marker.visible = aimLine.visible = false; renderLaunch(); return true;
}
canvas.addEventListener('pointermove', e => {
  if (!launchUI.armed || launchUI.step !== 1) return;
  const p = cc.pick(e.clientX, e.clientY); if (!p) return;
  const a = aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
  a.setXYZ(0, marker.position.x, marker.position.y + 2, marker.position.z); a.setXYZ(1, p.x, p.y + 2, p.z); a.needsUpdate = true; aimLine.visible = true;
});

// ---------- события сессии ----------
function feed(t: string, cls = '') { const d = el('div', cls); d.textContent = t; $('feed').append(d); setTimeout(() => d.remove(), 9000); while ($('feed').children.length > 6) $('feed').firstChild!.remove(); }

function follow(d: Drone) { cc.follow = () => drones.has(d.L.id) ? d.mesh.position : null; cc.dist = Math.min(cc.dist, 160); tac.show(false); syncLock(); }
function addDrone(L: Launch) {
  const u = UNITS[L.unit];
  if (!u || !protos[L.unit] || ![L.sx, L.sz, L.tx, L.tz, L.t0].every(Number.isFinite)) return; // чужие данные по сети не должны ломать игру
  L = { ...L };
  if (L.impactT === undefined) planLaunch(L, map);
  if (session!.now() >= L.t0 + L.impactT) { impact(L, true); return; } // подключились позже — попадание уже было
  const mesh = protos[L.unit].clone(); scene.add(mesh);
  const label = el('div', 'lbl'); $('labels').append(label);
  const row = el('div', 'it'); row.dataset.type = L.unit; $('tgList').append(row);
  const d: Drone = { L, mesh, prop: mesh.getObjectByName('prop')!, label, row, s: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, eta: L.impactT };
  label.onclick = row.onclick = () => follow(d);
  drones.set(L.id, d); $('targets').classList.remove('hidden');
  if (mySide() === 'defense') feed(`Воздушная тревога: ${u.name}, подлёт через ${fmt(L.impactT)}`, 'def');
  else feed(`Запуск: ${u.name} (${L.by}), подлёт через ${fmt(L.impactT)}`);
  if (drones.size === 1) sound.siren();
}

function impact(L: Launch, silent = false) {
  const u = UNITS[L.unit];
  const rad = 1.6 * Math.cbrt(u.tntKg), [hit, fell] = destr.blast(L.ix, L.iy, L.iz, rad, b => buildings.hide(b)), br = bridges.blast(L.ix, L.iy, L.iz, rad);
  const onGround = !hit && !br && L.iy - map.heightAt(L.ix, L.iz) < 2;
  hits.push({ x: L.ix, z: L.iz });
  if (silent) { fx.smolder(L.ix, L.iy, L.iz, u.tntKg); if (onGround) fx.scorch(L.ix, L.iy, L.iz, Math.cbrt(u.tntKg) * 3.6); return; }
  fx.explode(L.ix, L.iy, L.iz, u.tntKg, onGround);
  const dist = cc.cam.position.distanceTo(new THREE.Vector3(L.ix, L.iy, L.iz));
  sound.explosion(dist, u.tntKg, fell > 40, u.sounds); cc.shake = Math.max(cc.shake, Math.min(6, 900 / Math.max(60, dist)));
  const lm = map.obstacles.find(o => (L.ix - o.x) ** 2 + (L.iz - o.z) ** 2 < (o.r + 3) ** 2 && L.iy < o.top + 3);
  feed(lm && !hit ? `Попадание: ${u.name} — ${lm.name}` : br ? `Попадание: ${u.name} — пролёт моста обрушен` : hit ? `Попадание: ${u.name} — повреждено зданий: ${hit}` + (fell > 40 ? ', часть конструкций обрушилась' : '') : `Попадание: ${u.name} — открытая местность`);
  if (session && L.pid === session.me) session.send({ type: 'hit', id: L.id, buildings: hit });
}

function removeDrone(d: Drone) { scene.remove(d.mesh); d.label.remove(); d.row.remove(); drones.delete(d.L.id); if (!drones.size) $('targets').classList.add('hidden'); }
function resetDamage() { map.bDamage.fill(0); destr.reset(); buildings.reset(); bridges.reset(); fx.clear(); hits.length = 0; for (const d of [...drones.values()]) removeDrone(d); }

function setPlayers(list: Player[], quiet = false) {
  const old = players, was = mySide(); players = list;
  const myId = session?.me;
  if (!quiet && session?.online) for (const p of list) { // лента: кто пришёл, кто сменил сторону
    const o = old.find(x => x.id === p.id);
    if (!o) { if (p.id !== myId) feed(`${p.name} подключился`, 'sys'); }
    else if (o.side !== p.side && p.side && p.id !== myId) feed(`${p.name}: сторона «${SIDE_NAME[p.side]}»`, 'sys');
  }
  if (!quiet && session?.online) for (const o of old) if (!list.some(p => p.id === o.id)) feed(`${o.name} вышел`, 'sys');
  $('sess').textContent = session ? `${session.world} · ${session.online ? 'игроков: ' + list.length : 'без сети'}` : '';
  if (mySide() !== was) applySide();
  if (!$('score').classList.contains('hidden')) renderScore();
  renderSidePick();
}

function onMsg(m: Msg) {
  if (m.type === 'welcome') { if (m.env) { env.hour = m.env.hour; env.speed = m.env.speed; } setPlayers(m.players, true); m.launches.forEach(addDrone); if (m.launches.length) feed(`Мир загружен: попаданий ${m.launches.length}`, 'sys'); }
  else if (m.type === 'launch') addDrone(m.launch);
  else if (m.type === 'env') { env.hour = m.hour; env.speed = m.speed; }
  else if (m.type === 'reset') { resetDamage(); feed('Разрушения сброшены', 'sys'); }
  else if (m.type === 'players') setPlayers(m.players);
  else if (m.type === 'closed') { const r = m.reason; toMenu(); modal(`<h2>Сессия завершена</h2><p>${esc(r)}</p><button data-close>Понятно</button>`); }
}

function start(s: Session) {
  session = s; players = []; s.listen(onMsg);
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); sound.unlock();
  applySide(); pickSide(true);
}
function toMenu() {
  session?.close(); session = null; players = []; arm(null); showCard(null); tac.show(false); resetDamage();
  while (topModal()) (topModal() as any)._close(); sideModal = null;
  $('hud').classList.add('hidden'); $('score').classList.add('hidden'); $('menu').classList.remove('hidden'); menuScreen('mMain'); syncLock();
}

// ---------- сторона ----------
let sideModal: Modal | null = null;
/** Выбор стороны. first — сразу после входа: окно нельзя закрыть, пока сторона не выбрана. */
function pickSide(first = false) {
  if (sideModal || !session) return;
  sideModal = modal(`<h2>${first ? 'Выберите сторону' : 'Сменить сторону'}</h2><p class="note">Сторону можно сменить в любой момент: кнопка вверху, клавиша <kbd>${esc(keyName(S.keys.side))}</kbd> или «Меню».</p>
    <div class="sides">
      <button class="sidebtn attack" data-side="attack"><b>Атака</b><span>Запускайте воздушные цели по городу: выбирайте точку удара, направление и время подлёта.</span><small data-n></small></button>
      <button class="sidebtn defense" data-side="defense"><b>Оборона</b><span>Следите за небом: список целей, оповещения, тактическая карта. Средства ПВО появятся на следующем этапе.</span><small data-n></small></button>
    </div>${first ? '<button id="spLeave">Выйти в меню</button>' : '<button data-close>Отмена</button>'}`, { locked: first, onClose: () => { sideModal = null; syncLock(); } });
  sideModal.root.querySelectorAll('[data-side]').forEach(b => (b as HTMLElement).onclick = () => { const s = (b as HTMLElement).dataset.side as Side; session?.send({ type: 'side', side: s }); sideModal?.close(); });
  if (first) sideModal.q('#spLeave').onclick = toMenu;
  renderSidePick(); syncLock();
}
function renderSidePick() {
  if (!sideModal) return;
  sideModal.root.querySelectorAll('[data-side]').forEach(b => {
    const s = (b as HTMLElement).dataset.side as Side, list = players.filter(p => p.side === s);
    b.classList.toggle('cur', mySide() === s);
    b.querySelector('[data-n]')!.textContent = list.length ? `Игроков: ${list.length} — ${list.map(p => p.name).join(', ')}` : 'Пока никого';
  });
}
function applySide() {
  const s = mySide(), b = $('sideBadge');
  b.className = s ?? ''; b.textContent = s ? SIDE_NAME[s] : 'Сторона не выбрана';
  document.documentElement.style.setProperty('--acc', s === 'defense' ? 'var(--def)' : 'var(--atk)');
  if (launchUI.armed && launchUI.armed.side !== s) arm(null);
  if (cards.host === $('card')) showCard(null);
  renderArsenal(); renderQuick(); renderTacUnits();
  if (s && session) feed(`Вы играете за сторону «${SIDE_NAME[s]}»`, s === 'defense' ? 'def' : '');
}

// ---------- арсенал, быстрая панель, карточка ----------
const icon = (u: UnitDef) => `<svg viewBox="0 0 64 40">${u.icon}</svg>`;
function tile(u: UnitDef, onPick: () => void, onInfo: () => void) {
  const t = el('div', 'tile', `<button class="info" title="Карточка">i</button>${icon(u)}<b>${u.name}</b><div class="meta"><span>${u.cost} оч.</span><span>${u.reload} с</span></div>`);
  t.dataset.unit = u.id; t.title = `${u.name} / ${u.alt}`; t.onclick = onPick;
  (t.querySelector('.info') as HTMLElement).onclick = e => { e.stopPropagation(); onInfo(); };
  return t;
}
function renderArsenal() {
  const side = mySide(), body = $('arBody'), q = $<HTMLInputElement>('arSearch').value.trim().toLowerCase(); body.innerHTML = '';
  $('arTitle').innerHTML = side ? `Арсенал · <span class="${side === 'attack' ? 'atk' : 'def'}">${SIDE_NAME[side]}</span>` : 'Арсенал';
  if (!side) { body.append(el('div', 'soon', 'Выберите сторону, чтобы открыть арсенал')); return; }
  let shown = 0;
  for (const c of CATEGORIES.filter(c => c.side === side)) {
    const us = unitsOf(side, c.id).filter(u => !q || (u.name + ' ' + u.alt).toLowerCase().includes(q));
    if (q && !us.length) continue;
    const box = el('div', 'cat', `<div class="t"><span>${c.name}</span><small>${c.hint}</small></div>`), grid = el('div', us.length ? 'tiles' : 'soon');
    if (!us.length) grid.textContent = 'Появится в следующих обновлениях';
    for (const u of us) {
      const t = tile(u, () => arm(launchUI.armed === u ? null : u), () => showCard(u)); t.classList.toggle('on', launchUI.armed === u);
      t.draggable = true; t.addEventListener('dragstart', e => { e.dataTransfer!.setData('text/venom-unit', u.id); e.dataTransfer!.effectAllowed = 'copy'; });
      const k = S.quick[side].indexOf(u.id); if (k >= 0) t.append(el('span', 'key', String(k + 1)));
      grid.append(t); shown++;
    }
    box.append(grid); body.append(box);
  }
  if (q && !shown) body.append(el('div', 'soon', 'Ничего не найдено'));
  if (side === 'defense') body.prepend(el('div', 'note', 'Оборона пока наблюдает: цели видны в списке справа и на карте. Перетаскивать на быструю панель можно будет, когда появятся средства ПВО.'));
}
function renderQuick() {
  const side = mySide(), bar = $('quick'); bar.innerHTML = ''; bar.classList.toggle('hidden', !side); if (!side) return;
  const slots = S.quick[side];
  for (let i = 0; i < 9; i++) {
    const u = UNITS[slots[i] ?? ''], q = el('div', 'q' + (u ? ' full' : ''), `<span class="key">${i + 1}</span>` + (u ? `${icon(u)}<b>${u.name}</b>` : ''));
    if (u) { q.dataset.unit = u.id; q.title = `${u.name} — правый клик убирает с панели`; q.classList.toggle('on', launchUI.armed === u); q.onclick = () => arm(launchUI.armed === u ? null : u); }
    else q.title = 'Перетащите сюда юнит из арсенала';
    q.addEventListener('contextmenu', e => { e.preventDefault(); slots[i] = null; saveSettings(); renderQuick(); renderArsenal(); });
    q.addEventListener('dragover', e => { if (e.dataTransfer!.types.includes('text/venom-unit')) { e.preventDefault(); q.classList.add('over'); } });
    q.addEventListener('dragleave', () => q.classList.remove('over'));
    q.addEventListener('drop', e => {
      e.preventDefault(); const id = e.dataTransfer!.getData('text/venom-unit'); if (!UNITS[id] || UNITS[id].side !== side) return;
      const old = slots.indexOf(id); if (old >= 0) slots[old] = null; // юнит занимает один слот
      while (slots.length <= i) slots.push(null); slots[i] = id; saveSettings(); renderQuick(); renderArsenal();
    });
    bar.append(q);
  }
}
/** Карточка юнита в боковой панели справа; null — закрыть. */
function showCard(u: UnitDef | null) {
  const host = $('card');
  if (!u || (cards.unit === u && cards.host === host)) { host.classList.add('hidden'); if (cards.host === host) cards.hide(); $('targets').style.visibility = ''; return; }
  host.classList.remove('hidden'); $('targets').style.visibility = 'hidden';
  cards.show(host, u, [{ label: u.side === 'attack' ? 'Выбрать для запуска' : 'Выбрать', primary: true, fn: () => { showCard(null); arm(u); } }, { label: 'Закрыть', fn: () => showCard(null) }]);
}
function renderTacUnits() {
  const box = $('tacUnits'); box.innerHTML = ''; const side = mySide(); if (!side) return;
  for (const id of S.quick[side]) { const u = UNITS[id ?? '']; if (!u) continue; const b = el('button', launchUI.armed === u ? 'on' : ''); b.textContent = u.name; b.onclick = () => arm(launchUI.armed === u ? null : u); box.append(b); }
  if (!launchUI.armed) $('tacHint').textContent = side === 'attack' ? 'Выберите юнит справа вверху, чтобы спланировать налёт. Клик по карте переносит камеру.' : 'Клик по карте переносит камеру. Колесо — масштаб, перетаскивание — сдвиг.';
}

// ---------- игроки (Tab) и меню паузы ----------
function renderScore() {
  const grp = (side: Side | null, title: string, cls: string) => {
    const list = players.filter(p => p.side === side); if (!list.length && side === null) return '';
    return `<tr class="grp"><td colspan="5" class="${cls}">${title} · ${list.length}</td></tr>` + (list.length ? list.map(p =>
      `<tr class="${p.id === session?.me ? 'me' : ''}"><td>${esc(p.name)}${p.id === session?.me ? ' <span class="dim">(вы)</span>' : ''}</td><td class="n">${p.launches}</td><td class="n">${p.hits}</td><td class="n">${session?.online ? p.ping + ' мс' : '—'}</td></tr>`).join('')
      : '<tr><td colspan="5" class="dim">никого</td></tr>');
  };
  $('scoreBody').innerHTML = `<div class="row"><h2 style="margin:0">${esc(session?.world ?? '')}</h2><span class="sp"></span><span class="dim">${session?.online ? `адрес: ${esc(session.addr)} · игроков: ${players.length}` : 'игра без сети'}</span></div>
    <table><tr><th>Игрок</th><th class="n">Запусков</th><th class="n">Поражено зданий</th><th class="n">Пинг</th></tr>
    ${grp('attack', 'Атака', 'atk')}${grp('defense', 'Оборона', 'def')}${grp(null, 'Выбирают сторону', 'dim')}</table>`;
}
function showScore(on: boolean) { $('score').classList.toggle('hidden', !on); if (on) renderScore(); }

function showPause() {
  const m = modal(`<h2>Меню</h2>
    <button class="big" data-close>Продолжить</button>
    <button class="big" id="pSide">Сменить сторону<small>Сейчас: ${mySide() ? SIDE_NAME[mySide()!] : 'не выбрана'}</small></button>
    <button class="big" id="pPlayers">Игроки<small>Кто на сервере</small></button>
    <button class="big" id="pSettings">Настройки</button>
    <button class="big" id="pHelp">Как играть</button>
    <button class="big" id="pAdmin">Админ-панель<small>Время суток, сброс разрушений</small></button>
    <button class="big" id="pExit">Выйти в главное меню</button>`, { id: 'pause', onClose: syncLock });
  m.q('#pSide').onclick = () => { m.close(); pickSide(); };
  m.q('#pPlayers').onclick = () => { m.close(); const s = modal('<div id="psBody" style="width:680px;max-width:88vw"></div><p></p><button data-close>Закрыть</button>', { onClose: syncLock }); renderScore(); s.q('#psBody').innerHTML = $('scoreBody').innerHTML; syncLock(); };
  m.q('#pSettings').onclick = () => { m.close(); openSettings(); };
  m.q('#pHelp').onclick = () => { m.close(); showHelp(); };
  m.q('#pAdmin').onclick = () => { m.close(); showAdmin(); };
  m.q('#pExit').onclick = toMenu;
  syncLock();
}
function openSettings() { showSettings(sound, () => { $('perf').classList.toggle('hidden', !S.perf); $('mini').classList.toggle('hidden', !S.minimap); if (session) { renderArsenal(); } syncLock(); }); syncLock(); }
function showAdmin() {
  const speeds = [0, 1, 5, 10, 60, 600, 3600];
  const m = modal(`<div class="form"><h2>Админ-панель</h2>
    <label>Время суток <input type="range" id="ah" min="0" max="24" step="0.05" value="${env.hour}"> <b id="ahv">${env.clock()}</b></label>
    <label>Скорость времени <select id="as">${speeds.map(s => `<option value="${s}" ${s === env.speed ? 'selected' : ''}>${s === 0 ? 'пауза' : '×' + s}</option>`).join('')}</select></label>
    <p class="note">×1 — как в жизни, ×60 — час за минуту, ×3600 — сутки за 24 секунды. В сетевой игре меняется у всех.</p>
    <button id="ar">Сбросить разрушения</button> <button data-close>Закрыть</button></div>`, { onClose: syncLock });
  const push = () => session?.send({ type: 'env', hour: env.hour, speed: env.speed });
  m.q<HTMLInputElement>('#ah').oninput = e => { env.hour = Number((e.target as HTMLInputElement).value) % 24; m.q('#ahv').textContent = env.clock(); };
  m.q<HTMLInputElement>('#ah').onchange = push;
  m.q<HTMLSelectElement>('#as').onchange = e => { env.speed = Number((e.target as HTMLSelectElement).value); push(); };
  m.q('#ar').onclick = () => session?.send({ type: 'reset' });
  syncLock();
}
/** Пока открыто окно, карта или главное меню — клавиши камеры не действуют. */
function syncLock() { if (cc) cc.locked = !!topModal() || tac.open || !session; }
function toggleTac(on = !tac.open) { tac.show(on, cc.target); if (on) { renderTacUnits(); if (launchUI.armed) renderLaunch(); } syncLock(); }

// ---------- главное меню ----------
function menuScreen(id: string) {
  for (const s of ['mMain', 'mWorlds', 'mJoin']) $(s).classList.toggle('hidden', s !== id);
  $('catalog').classList.add('hidden'); if (cards.host === $('catCard')) cards.hide();
}
const nick = () => $<HTMLInputElement>('nick').value.trim().slice(0, 20) || 'Игрок';
async function renderWorlds() {
  const box = $('worldList'); $('worldErr').textContent = '';
  $('hostNote').innerHTML = worlds.hosted
    ? `Мир открыт для друзей, пока вы в нём: пусть подключаются по адресу ${worlds.addrs.length ? worlds.addrs.map(a => `<kbd>${esc(a)}</kbd>`).join(' или ') : '<kbd>ваш адрес:порт</kbd>'} (общая сеть или VPN). Миры сохраняются автоматически.`
    : 'Миры хранятся в этом браузере и сохраняются автоматически. Чтобы играть с друзьями, запустите программу VENOM — в ней любой мир открыт для подключения.';
  let list: WorldInfo[] = []; try { list = await worlds.list(); } catch { $('worldErr').textContent = 'Не удалось получить список миров'; }
  box.innerHTML = '';
  for (const w of list) {
    const row = el('div', 'world', `<div><b>${esc(w.name)}</b><span class="note">${new Date(w.updated).toLocaleString('ru')} · попаданий: ${w.hits}${w.players ? ` · игроков: ${w.players}` : ''}</span></div><button class="on">Играть</button><button title="Удалить мир">✕</button>`);
    const [play, del] = row.querySelectorAll('button');
    play.onclick = async () => { play.disabled = true; try { saveNick(); start(await worlds.open(w, nick())); } catch { $('worldErr').textContent = 'Не удалось открыть мир'; play.disabled = false; } };
    del.onclick = async () => { if (del.textContent === '✕') { del.textContent = 'Удалить?'; setTimeout(() => { del.textContent = '✕'; }, 3000); return; } await worlds.remove(w.id).catch(() => {}); void renderWorlds(); };
    box.append(row);
  }
  if (!list.length) box.append(el('div', 'soon', 'Миров пока нет — создайте первый'));
}
function saveNick() { S.nick = $<HTMLInputElement>('nick').value.trim().slice(0, 20); saveSettings(); }
function renderCatalog() {
  const list = $('catList'); list.innerHTML = '<h2>Арсенал</h2>';
  for (const side of ['attack', 'defense'] as Side[]) {
    list.append(el('h3', side === 'attack' ? 'atk' : 'def', SIDE_NAME[side]));
    for (const c of CATEGORIES.filter(c => c.side === side)) {
      const us = unitsOf(side, c.id), box = el('div', 'cat', `<div class="t"><span>${c.name}</span><small>${c.hint}</small></div>`), grid = el('div', us.length ? 'tiles' : 'soon');
      if (!us.length) grid.textContent = 'Появится в следующих обновлениях';
      for (const u of us) { const pick = () => { cards.show($('catCard'), u, []); list.querySelectorAll('.tile').forEach(t => t.classList.toggle('on', (t as HTMLElement).dataset.unit === u.id)); }; grid.append(tile(u, pick, pick)); }
      box.append(grid); list.append(box);
    }
  }
  const first = Object.values(UNITS)[0]; if (first) { cards.show($('catCard'), first, []); list.querySelector('.tile')?.classList.add('on'); }
}
function initMenu() {
  const n = $<HTMLInputElement>('nick'); n.value = S.nick; n.onchange = saveNick;
  $('btnPlay').onclick = () => { menuScreen('mWorlds'); void renderWorlds(); };
  $('btnJoin').onclick = () => { menuScreen('mJoin'); const a = $<HTMLInputElement>('netAddr'); if (!a.value) a.value = S.addr || (location.protocol === 'http:' && !worlds.hosted ? location.host : ''); a.focus(); };
  $('btnArsenal').onclick = () => { const c = $('catalog'), on = c.classList.contains('hidden'); menuScreen('mMain'); c.classList.toggle('hidden', !on); if (on) renderCatalog(); };
  document.querySelectorAll('#menu [data-back]').forEach(b => (b as HTMLElement).onclick = () => menuScreen('mMain'));
  $('btnWorldNew').onclick = async () => { const i = $<HTMLInputElement>('worldName'); try { await worlds.create(i.value.trim() || `Мир ${new Date().toLocaleDateString('ru')}`); i.value = ''; } catch { $('worldErr').textContent = 'Не удалось создать мир'; } void renderWorlds(); };
  $<HTMLInputElement>('worldName').onkeydown = e => { if (e.key === 'Enter') $('btnWorldNew').click(); };
  const connect = async () => {
    const addr = $<HTMLInputElement>('netAddr').value.trim(); if (!addr) { $('netErr').textContent = 'Введите адрес хоста'; return; }
    $('netErr').textContent = 'Подключение…'; saveNick();
    try { const s = await remoteSession(addr, nick()); S.addr = addr; saveSettings(); $('netErr').textContent = ''; start(s); }
    catch { $('netErr').textContent = 'Не удалось подключиться. Проверьте адрес и что у хоста запущена игра.'; }
  };
  $('btnConnect').onclick = connect; $<HTMLInputElement>('netAddr').onkeydown = e => { if (e.key === 'Enter') void connect(); };
  $('btnSettings0').onclick = openSettings; $('btnHelp0').onclick = showHelp;
}

// ---------- клавиши ----------
window.addEventListener('keydown', e => {
  const inInput = (e.target as HTMLElement).tagName === 'INPUT';
  if (e.code === 'Escape') {
    if (inInput) { (e.target as HTMLElement).blur(); return; }
    if (closeTopModal()) { syncLock(); return; }
    if (topModal()) return;
    if (tac?.open) { toggleTac(false); return; }
    if (!session) { menuScreen('mMain'); return; }
    if (!$('card').classList.contains('hidden')) { showCard(null); return; }
    if (launchUI.armed) { arm(null); return; }
    showPause(); return;
  }
  if (inInput || !session) return;
  if (isKey(e, 'players')) { e.preventDefault(); if (!e.repeat) showScore(true); return; }
  if (topModal()) return;
  if (isKey(e, 'map')) { toggleTac(); return; }
  if (isKey(e, 'side')) { pickSide(); return; }
  if (tac.open) return;
  if (isKey(e, 'arsenal')) $('arsenal').classList.toggle('min');
  else if (isKey(e, 'hud')) { const c = $('hud').classList.toggle('clean'); $('labels').classList.toggle('hidden', c); }
  else if (isKey(e, 'follow')) { let best: Drone | null = null, bd = 1e12; for (const d of drones.values()) { const q = (d.s.x - cc.target.x) ** 2 + (d.s.z - cc.target.z) ** 2; if (q < bd) { bd = q; best = d; } } if (best) follow(best); }
  else if (/^Digit[1-9]$/.test(e.code)) { const s = mySide(), u = s ? UNITS[S.quick[s][Number(e.code.slice(5)) - 1] ?? ''] : null; if (u) arm(launchUI.armed === u ? null : u); }
});
window.addEventListener('keyup', e => { if (isKey(e, 'players')) showScore(false); });
window.addEventListener('blur', () => showScore(false));

// ---------- главный цикл ----------
const v3 = new THREE.Vector3(), fwd = new THREE.Vector3(), heard: Heard[] = [];
const tacData: TacData = { drones: [], hits, cam: { x: 0, z: 0, yaw: 0, dist: 0 }, aim: null, cursor: null };
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0, frameNo = 0;
function frame(nowMs: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs; frameNo++;
  U.uTime.value += dt;
  cc.update(dt); const t = cc.target;
  env.update(dt, scene, cc.cam);
  U.uFogD.value = 1 / Math.max(45000, t.dist * 3.2);
  ground.update(t.x, t.z, t.dist); buildings.update(t.x, t.z, t.dist); trees.update(t.x, t.z, t.dist, canvas.height);
  heard.length = 0; tacData.drones.length = 0;
  if (session) {
    const now = session.now(), filter = $<HTMLSelectElement>('tgFilter').value;
    for (const d of [...drones.values()]) {
      const tt = now - d.L.t0, u = UNITS[d.L.unit];
      if (tt >= d.L.impactT) { removeDrone(d); impact(d.L); continue; }
      trajectory(d.L, map, Math.max(0, tt), d.s); d.eta = d.L.impactT - tt;
      d.mesh.position.set(d.s.x, d.s.y, d.s.z); fwd.set(d.s.vx, d.s.vy, d.s.vz);
      d.mesh.lookAt(v3.copy(d.mesh.position).add(fwd)); d.prop.rotation.z += dt * 90;
      const dist = cc.cam.position.distanceTo(d.mesh.position);
      d.mesh.scale.setScalar(Math.max(1, dist / 260)); // издалека модель увеличивается, чтобы цель оставалась видимой
      const closing = -fwd.dot(v3.copy(d.mesh.position).sub(cc.cam.position).normalize());
      v3.copy(d.mesh.position).project(cc.cam);
      heard.push({ dist, closing, pan: v3.z > 1 ? -v3.x : v3.x, dive: Math.min(1, Math.max(0, 1 - d.eta / 3.5)), seed: d.L.seed, near: u.sounds.engineNear, far: u.sounds.engineFar });
      // метка всегда на экране: если цель вне кадра, прижимается к краю
      if (v3.z > 1) { v3.x = -v3.x; v3.y = -v3.y; }
      const off = v3.z > 1 || Math.abs(v3.x) > 0.94 || v3.y > 0.8 || v3.y < -0.94;
      if (off) { const k = Math.max(Math.abs(v3.x) / 0.94, v3.y > 0 ? v3.y / 0.8 : -v3.y / 0.94, 1e-6); v3.x /= k; v3.y /= k; }
      d.label.style.left = `${(v3.x + 1) / 2 * innerWidth}px`; d.label.style.top = `${(1 - v3.y) / 2 * innerHeight}px`; d.label.style.opacity = off ? '0.7' : '1';
      const eta = fmt(d.eta); d.label.textContent = `${u.name} ${eta}`;
      if (frameNo % 6 === 0) { d.row.innerHTML = `<span>${u.name} №${d.L.id} <small>${esc(d.L.by)}</small></span><b>${eta}</b>`; d.row.classList.toggle('hidden', !!filter && filter !== d.L.unit); }
      tacData.drones.push({ x: d.s.x, z: d.s.z, sx: d.L.sx, sz: d.L.sz, tx: d.L.tx, tz: d.L.tz, hdg: Math.atan2(d.s.vx, -d.s.vz), label: eta });
    }
    if (frameNo % 30 === 0 && drones.size > 1) { // список целей: ближайшие по времени подлёта сверху
      const rows = [...drones.values()].sort((a, b) => a.eta - b.eta), list = $('tgList'); let i = 0;
      for (const d of rows) { if (list.children[i] !== d.row) list.insertBefore(d.row, list.children[i] ?? null); i++; }
    }
    if (frameNo % 6 === 0) $('tgCount').textContent = String(drones.size);
  }
  sound.engines(heard);
  if (marker.visible) marker.scale.setScalar(Math.max(12, t.dist * 0.018) * (1 + 0.08 * Math.sin(nowMs / 150)));
  destr.update(dt); landmarks.update(dt); fx.update(dt); fx.lights(t.x, t.y, t.z);
  if (!tac.open) { renderer.info.reset(); shadows?.render(renderer, t); if (post) post.render(scene, cc.cam); else renderer.render(scene, cc.cam); }
  cards.render(dt, nowMs);
  if (session && (tac.open || (S.minimap && frameNo % 6 === 0))) {
    const u = launchUI.armed; tacData.cam.x = t.x; tacData.cam.z = t.z; tacData.cam.yaw = cc.yawNow; tacData.cam.dist = t.dist; tacData.cursor = tac.cursor;
    tacData.aim = u && launchUI.step === 1 ? { tx: launchUI.tx, tz: launchUI.tz, rings: launchUI.mode ? [{ r: launchUI.mode * u.speed, label: `точка появления · ${fmt(launchUI.mode)}` }] : [15, 60, 180].map(s => ({ r: s * u.speed, label: fmt(s) })) } : null;
    if (tac.open) { tac.draw(tacData); $('tacInfo').textContent = `· целей в воздухе: ${drones.size} · попаданий: ${hits.length}`; } else mini.draw(tacData);
  }
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    const fps = fpsN / fpsAcc, i = renderer.info.render;
    if (S.perf) $('perf').textContent = `${fps.toFixed(0)} к/с · ${(1000 / fps).toFixed(1)} мс · вызовов ${i.calls} · треуг. ${(i.triangles / 1e6).toFixed(2)} млн\nтайлов ${buildings.stats.tiles} · частиц ${fx.count} · деревьев ${trees.count} · обломков ${destr.debris} · разрешение ${Math.round(dyn * 100)}% · ${Q.name}`;
    $('clock').textContent = env.clock(); $('tspeed').textContent = env.speed ? `×${env.speed}` : 'пауза';
    const nd = fps < 40 ? Math.max(0.5, dyn - 0.1) : fps > 57 ? Math.min(1, dyn + 0.05) : dyn;
    if (nd !== dyn && document.hasFocus() && !location.search.includes('nodyn')) { dyn = nd; resize(); }
    fpsAcc = fpsN = fpsT = 0;
  }
}

async function boot() {
  applyUiScale();
  const bar = (p: number, label: string) => { $('loadBar').style.width = `${p * 100}%`; $('loadText').textContent = label; };
  const ws = worldStore();
  await map.load('./data/', bar);
  env = new Env(scene, Q.clouds); cc = new CityCamera(canvas, map); cc.onClick = (px, py) => { const p = cc.pick(px, py); if (p) clickWorld(p.x, p.z); else sound.unlock(); };
  ground = new Ground(map, Q, renderer.capabilities.getMaxAnisotropy());
  bar(0.75, 'Отрисовка карты');
  await ground.buildOverview(p => bar(0.75 + p * 0.23, 'Отрисовка карты'));
  landmarks = new Landmarks(map); // до зданий: убирает дома OSM под моделями
  buildings = new Buildings(map, Q); fx = new FX(Q.particles); destr = new Destruction(map, buildings.mat, fx, Q.voxel, Q.debris);
  trees = new Trees(map, Q); bridges = new Bridges(map, fx, destr);
  scene.add(ground.group, buildings.group, landmarks.group, bridges.group, trees.group, destr.group, trees.lampGroup, fx.group, marker, aimLine);
  if (Q.shadow) { shadows = new Shadows(Q.shadow); shadows.casters.push(buildings.group, landmarks.group, bridges.group, trees.group, destr.group); }
  if (usePost) post = new Post(renderer, Q.msaa, Q.bloom);
  tac = new TacMap($('tac'), ground.overview, map.meta, landmarks.marks, (x, z) => { if (!clickWorld(x, z)) { cc.flyTo(x, z); toggleTac(false); } });
  mini = new Minimap($('mini').querySelector('canvas')!, ground.overview, map.meta, (x, z) => cc.flyTo(x, z));
  worlds = await ws;
  resize(); initMenu();
  $('tgFilter').innerHTML = '<option value="">все типы</option>' + unitsOf('attack').map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  $('perf').classList.toggle('hidden', !S.perf); $('mini').classList.toggle('hidden', !S.minimap);
  $('attr').textContent = map.meta.attribution; $('ver').textContent = 'Сборка ' + __BUILD__;
  $('loading').classList.add('hidden'); $('menu').classList.remove('hidden');
  $('btnMenu').onclick = showPause; $('btnMap').onclick = () => toggleTac(); $('tacClose').onclick = () => toggleTac(false);
  $('btnPlayers').onclick = () => showScore($('score').classList.contains('hidden')); $('sideBadge').onclick = () => pickSide();
  $('btnCancel').onclick = () => arm(null); $('arMin').onclick = () => $('arsenal').classList.toggle('min');
  $<HTMLInputElement>('arSearch').oninput = renderArsenal;
  syncLock();
  (window as any).venom = { U, map, cc, env, drones, buildings, ground, fx, destr, trees, bridges, landmarks, arm, clickWorld, UNITS, S, scene, renderer, get session() { return session; }, get players() { return players; } };
  requestAnimationFrame(frame);
}
boot().catch(e => { $('loadText').textContent = 'Ошибка загрузки: ' + (e?.message ?? e); console.error(e); });
