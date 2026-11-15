import * as THREE from 'three';
import { MapData } from './map';
import { Env, U } from './env';
import { Ground } from './ground';
import { Buildings } from './buildings';
import { CityCamera } from './camera';
import { FX } from './fx';
import { Sound, Heard } from './audio';
import { buildGeran2, buildGeran5, buildPickup, buildKh101 } from './model';
import { Roads } from './roads';
import { OpState, makeOperation } from './op';
import { AirDefense, GunRec } from './aa';
import { UNITS, UnitDef, Side, SIDE_NAME, CATEGORIES, unitsOf, RULES, GameMode, MODE_NAME } from './units';
import { Launch, State, planLaunch, planDown, flightState, endOf } from './sim';
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
let aa: AirDefense, roads: Roads;
// экономика: режим мира и свои очки (сервер присылает остаток, доход досчитываем сами до следующей рассылки)
let gameMode: GameMode = 'sandbox', pointsAt = 0;
const myPoints = () => { const p = me(); return !p || !session ? 0 : gameMode === 'game' ? Math.min(RULES.economy.cap, (p.points ?? 0) + RULES.economy.income * Math.max(0, session.now() - pointsAt)) : p.points ?? 0; };
/** Хватает ли очков; в песочнице — всегда. Если нет — подсказка в ленту. */
function afford(cost: number, what: string) {
  if (gameMode === 'sandbox' || myPoints() >= cost) return true;
  const need = cost - myPoints(); feed(`Не хватает очков на «${what}»: нужно ${cost}, есть ${Math.floor(myPoints())}.` + (gameMode === 'game' ? ` Накопится через ${fmt(need / RULES.economy.income)}` : ' В операции бюджет не пополняется'), 'sys'); return false;
}
let env: Env, ground: Ground, buildings: Buildings, cc: CityCamera, fx: FX, destr: Destruction, tac: TacMap, mini: Minimap, trees: Trees, bridges: Bridges, landmarks: Landmarks;
let shadows: Shadows | null = null, post: Post | null = null;
let session: Session | null = null, worlds: Worlds;
let players: Player[] = [];
let dyn = 1, dynLow = 0, dynHigh = 0; // динамическое разрешение

interface Drone { L: Launch; mesh: THREE.Group; prop: THREE.Object3D | null; glow: THREE.Object3D | null; label: HTMLElement; row: HTMLElement; s: State; eta: number; spin: number }
const drones = new Map<number, Drone>();
const hits: { x: number; z: number }[] = [];
/** Модели юнитов: по одной заготовке на тип, в игру идут копии. */
const protos: Record<string, THREE.Group> = { geran2: buildGeran2(), geran5: buildGeran5(), kh101: buildKh101(), mfg: buildPickup() };
const builders: Record<string, () => THREE.Group> = { geran2: buildGeran2, geran5: buildGeran5, kh101: buildKh101, mfg: buildPickup };
const cards = new CardView(builders); // карточке — своя копия модели: у неё другой рендерер и обычный вывод цвета
// Сцена выводит цвет без преобразования (свои шейдеры отдают готовый sRGB) — стандартным материалам моделей добавляем его сами, иначе они почти чёрные.
for (const p of Object.values(protos)) p.traverse(o => {
  const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <colorspace_fragment>', 'gl_FragColor.rgb = pow(max(gl_FragColor.rgb, 0.0), vec3(1.0 / 2.2));'); };
});

const me = () => players.find(p => p.id === session?.me) ?? null;
/** Ведущий клиент (первый из подключённых) решает спорное: кто сбит, какая цель операции поражена. */
const isLead = () => !!session && players.length > 0 && session.me === Math.min(...players.map(p => p.id));
const mySide = (): Side | null => me()?.side ?? null;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1), Q.pixelRatio) * dyn); renderer.setSize(w, h, false); cc?.resize(w, h); post?.resize();
}
window.addEventListener('resize', resize);

// ---------- запуск ----------
const launchUI = { armed: null as UnitDef | null, step: 0, mode: 60 as number, range: RULES.minRange as number, delay: 0, count: 1, mix: [] as string[], tx: 0, tz: 0 };
// вне песочницы цели стартуют издалека: выбирается дальность, а не время подлёта (0 — от края карты)
const RANGES: [number, string][] = [[RULES.minRange, `${RULES.minRange / 1000} км`], [15000, '15 км'], [0, 'от края карты']];
const DELAYS: [number, string][] = [[0, 'сразу'], [30, '+30 с'], [60, '+1 мин'], [120, '+2 мин'], [240, '+4 мин']];
/** Дальность старта вне песочницы: выбранная или до края карты по направлению подлёта. */
function startRange(tx: number, tz: number, dx: number, dz: number) {
  if (launchUI.range) return launchUI.range;
  const m = map.meta, ex = dx > 0 ? (m.x1 - tx) / dx : dx < 0 ? (m.x0 - tx) / dx : 1e9, ez = dz > 0 ? (m.z1 - tz) / dz : dz < 0 ? (m.z0 - tz) / dz : 1e9;
  return Math.max(RULES.minRange, Math.min(ex, ez) - 300);
}
/** Состав роя: выбранный юнит и отмеченные в «Составе» типы той же категории, по очереди. */
const swarm = (u: UnitDef) => [u, ...launchUI.mix.map(id => UNITS[id]).filter(m => m && m !== u && m.side === u.side)];
const MODES: [number, string][] = [[0, 'С точки клика'], [15, '15 с'], [60, '1 мин'], [180, '3 мин']];
const zoneGeo = new THREE.RingGeometry(0.994, 1, 128).rotateX(-Math.PI / 2);
const marker = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff6a4a, depthTest: false, fog: false }));
marker.visible = aimLine.visible = false; marker.renderOrder = aimLine.renderOrder = 30; aimLine.frustumCulled = false;

function arm(u: UnitDef | null) {
  if (u && mySide() !== u.side) { feed(`«${u.name}» доступна стороне «${SIDE_NAME[u.side]}». Смените сторону: ${keyName(S.keys.side)}`, 'sys'); u = null; }
  launchUI.armed = u; launchUI.step = 0; marker.visible = aimLine.visible = false; if (u) selectGun(0, true);
  $('launch').classList.toggle('hidden', !u && !aaUI.sel); canvas.classList.toggle('aim', !!u || aaUI.move);
  document.querySelectorAll('[data-unit]').forEach(e => e.classList.toggle('on', !!u && (e as HTMLElement).dataset.unit === u.id));
  renderLaunch(); renderTacUnits();
}
function renderLaunch() {
  const u = launchUI.armed, isAA = !!u?.aa || (!u && !!aaUI.sel);
  for (const id of ['modesRow', 'counts', 'countsLbl', 'launchNote']) $(id).classList.toggle('hidden', isAA);
  $('aaRow').classList.toggle('hidden', !isAA); if (isAA) $('mixRow').classList.add('hidden');
  if (isAA) { renderAA(); return; }
  if (!u) return;
  $('step').innerHTML = launchUI.step === 0 ? `<b>Шаг 1.</b> Кликните по цели в городе — туда ударит ${u.name}`
    : launchUI.mode === 0 && gameMode === 'sandbox' ? '<b>Шаг 2.</b> Кликните точку, откуда прилетит цель' : '<b>Шаг 2.</b> Кликните, с какой стороны прилетит цель';
  const far = gameMode !== 'sandbox'; $('modesLbl').textContent = far ? 'Дальность старта' : 'Время подлёта'; $('modes').innerHTML = '';
  if (far) for (const [r, n] of RANGES) { const b = el('button', r === launchUI.range ? 'on' : ''); b.textContent = n; b.onclick = () => { launchUI.range = r; renderLaunch(); }; $('modes').append(b); }
  else for (const [m, n] of MODES) { const b = el('button', m === launchUI.mode ? 'on' : ''); b.textContent = n; b.onclick = () => { launchUI.mode = m; renderLaunch(); }; $('modes').append(b); }
  const planning = op?.phase === 'plan'; $('delayRow').classList.toggle('hidden', !planning); $('delays').innerHTML = ''; // на планировании — когда вылетит после начала боя
  if (planning) for (const [d, n] of DELAYS) { const b = el('button', d === launchUI.delay ? 'on' : ''); b.textContent = n; b.onclick = () => { launchUI.delay = d; renderLaunch(); }; $('delays').append(b); }
  $('counts').innerHTML = ''; for (const c of [1, 3, 5, 10]) { const b = el('button', c === launchUI.count ? 'on' : ''); b.textContent = c === 1 ? '1' : `рой ×${c}`; b.onclick = () => { launchUI.count = c; renderLaunch(); }; $('counts').append(b); }
  const others = unitsOf(u.side).filter(m => m !== u && protos[m.id]), mixRow = $('mixRow'); // состав роя: только когда целей несколько и есть из чего выбирать
  mixRow.classList.toggle('hidden', launchUI.count < 2 || !others.length); $('mix').innerHTML = '';
  for (const m of others) { const on = launchUI.mix.includes(m.id), b = el('button', on ? 'on' : ''); b.textContent = '+ ' + m.name; b.title = `Добавить в рой: ${m.name}`; b.onclick = () => { launchUI.mix = on ? launchUI.mix.filter(i => i !== m.id) : [...launchUI.mix, m.id]; renderLaunch(); }; $('mix').append(b); }
  const km = launchUI.mode * u.speed / 1000;
  $('launchNote').textContent = far ? `Вне песочницы цели стартуют издалека. ${u.name} пролетит ${launchUI.range ? launchUI.range / 1000 + ' км' : 'путь от края карты'} за ${launchUI.range ? fmt(launchUI.range / u.speed) : 'несколько минут'}.` + (planning ? ' Сейчас планирование: запуск отложится до начала боя, оборона его не видит.' : '') : launchUI.mode === 0 ? `Летит с реальной скоростью ${Math.round(u.speed * 3.6)} км/ч от точки клика: 10 км — примерно ${fmt(10000 / u.speed)}.`
    : `Скорость реальная (${Math.round(u.speed * 3.6)} км/ч), поэтому цель появится в ${km.toFixed(1)} км от точки удара.`;
  if (gameMode !== 'sandbox') { const ts = launchUI.count > 1 ? swarm(u) : [u]; let total = 0; for (let i = 0; i < launchUI.count; i++) total += ts[i % ts.length].cost; $('launchNote').textContent += ` Стоимость запуска: ${total} очк.`; }
  if (launchUI.count > 1 && swarm(u).length > 1) $('launchNote').textContent += launchUI.mode === 0 ? ' Смешанный рой стартует из одной точки: быстрые прилетят раньше.' : ' Смешанный рой: каждый тип стартует со своей дальности, чтобы все подошли одновременно.';
  $('tacHint').innerHTML = $('step').innerHTML;
}
/** Клик по точке мира — из 3D-вида или с тактической карты. */
function clickWorld(x: number, z: number) {
  sound.unlock();
  if (!session) return false;
  if (aaUI.sel && aaUI.move) { // приказ на переезд выбранной группы
    const p = aa.posOf(aaUI.sel); if (!p || !canStand(x, z)) return true;
    const path = roads.route(p.x, p.z, x, z); // едет только по дорогам
    if (!path) { feed('Туда нет дороги: выберите место ближе к улице или на этом берегу', 'sys'); return true; }
    session.send({ type: 'aaMove', id: aaUI.sel, x0: p.x, z0: p.z, x, z, path }); aaUI.move = false; canvas.classList.remove('aim'); renderLaunch(); return true;
  }
  const u = launchUI.armed; if (!u) return false;
  if (u.aa) { // постановка огневой группы
    if (aa.count >= u.aa.max) { feed(`Больше ${u.aa.max} групп поставить нельзя — снимите или перегоните имеющиеся`, 'sys'); return true; }
    if (canStand(x, z) && afford(u.cost, u.name)) session.send({ type: 'aaPlace', unit: u.id, x, z });
    return true;
  }
  if (launchUI.step === 0) { launchUI.tx = x; launchUI.tz = z; launchUI.step = 1; marker.position.set(x, map.heightAt(x, z) + 1, z); marker.visible = true; renderLaunch(); return true; }
  let dx = x - launchUI.tx, dz = z - launchUI.tz; const d = Math.hypot(dx, dz); if (d < 30) return true; dx /= d; dz /= d;
  const types = launchUI.count > 1 ? swarm(u) : [u];
  let total = 0; for (let i = 0; i < launchUI.count; i++) total += types[i % types.length].cost;
  if (!afford(total, launchUI.count > 1 ? `рой ×${launchUI.count}` : u.name)) return true;
  for (let i = 0; i < launchUI.count; i++) {
    const ui = types[i % types.length], dist = gameMode !== 'sandbox' ? startRange(launchUI.tx, launchUI.tz, dx, dz) : launchUI.mode === 0 ? Math.max(d, 400) : launchUI.mode * ui.speed;
    const k = i === 0 ? 0 : 1, lat = (Math.random() - 0.5) * 500 * k, back = Math.random() * 700 * k, sc = (Math.random() - 0.5) * 140 * k, sc2 = (Math.random() - 0.5) * 140 * k;
    const L = { id: 0, unit: ui.id, by: '', t0: 0, seed: Math.random() * 100, tx: launchUI.tx + sc, tz: launchUI.tz + sc2,
      sx: launchUI.tx + dx * (dist + back) - dz * lat, sz: launchUI.tz + dz * (dist + back) + dx * lat } as Launch;
    planLaunch(L, map); session.send({ type: 'launch', launch: L, delay: op?.phase === 'plan' ? launchUI.delay : 0 });
  }
  launchUI.step = 0; marker.visible = aimLine.visible = false; renderLaunch(); return true;
}
canvas.addEventListener('pointermove', e => {
  if (!launchUI.armed || launchUI.step !== 1) return;
  const p = cc.pick(e.clientX, e.clientY); if (!p) return;
  const a = aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
  a.setXYZ(0, marker.position.x, marker.position.y + 2, marker.position.z); a.setXYZ(1, p.x, p.y + 2, p.z); a.needsUpdate = true; aimLine.visible = true;
});

/** Свечение сопел: днём — только раскалённый срез, ночью — заметный факел и ореол. Материалы общие у всех копий модели. */
function setGlow(night: number) {
  for (const p of Object.values(protos)) p.getObjectByName('glow')?.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (!m) return;
    m.opacity = o.name === 'core' ? 0.75 + 0.25 * night : o.name === 'flame' ? 0.12 + 0.5 * night : 0.1 + 0.9 * night;
  });
}

// ---------- ПВО: постановка, выбор и переезд огневых групп ----------
const aaUI = { sel: 0, move: false };
const gunLabels = new Map<number, HTMLElement>();
function canStand(x: number, z: number) {
  const m = map.meta;
  if (x < m.x0 || x > m.x1 || z < m.z0 || z > m.z1) { feed('За краем карты группу поставить нельзя', 'sys'); return false; }
  if (map.buildingAt(x, z) >= 0) { feed('Здесь здание — выберите улицу, двор или пустырь', 'sys'); return false; }
  return true;
}
function selectGun(id: number, quiet = false) {
  aaUI.sel = id; aaUI.move = false; aa.selected = id; canvas.classList.toggle('aim', !!launchUI.armed);
  if (id && launchUI.armed) { arm(null); return; } // arm(null) сам обновит панель
  if (!quiet) { $('launch').classList.toggle('hidden', !id && !launchUI.armed); renderLaunch(); }
}
/** Панель ПВО: постановка новой группы или приказы выбранной. */
function renderAA() {
  const u = launchUI.armed, row = $('aaRow'); row.innerHTML = '';
  const btn = (text: string, fn: () => void, on = false) => { const b = el('button', on ? 'on' : ''); b.textContent = text; b.onclick = fn; row.append(b); };
  if (u?.aa) {
    $('step').innerHTML = `<b>${u.name}.</b> Кликните по карте — туда встанет группа. Стоит: ${aa.count} из ${u.aa.max}. Развёртывание ${u.aa.placeS} с, дальность огня ${(u.aa.range / 1000).toFixed(1).replace('.', ',')} км.`;
  } else {
    const g = aa.views().find(v => v.id === aaUI.sel); if (!g) { selectGun(0); return; }
    $('step').innerHTML = aaUI.move ? `<b>Группа №${g.id}.</b> Кликните, куда её перегнать. В дороге она не стреляет.`
      : `<b>Группа №${g.id}</b> <span class="dim">(${esc(g.by)})</span> — ${g.moving ? 'в пути' : g.ready ? 'готова к бою' : 'развёртывается, ещё ' + fmt(g.wait)}`;
    btn('Перегнать', () => { aaUI.move = !aaUI.move; canvas.classList.toggle('aim', aaUI.move); renderLaunch(); }, aaUI.move);
    btn('Показать', () => cc.flyTo(g.x, g.z, Math.min(cc.dist, 900)));
    btn('Снять', () => { session?.send({ type: 'aaDel', id: g.id }); selectGun(0); });
  }
  $('tacHint').innerHTML = $('step').innerHTML;
}
/** Метки групп на экране — только стороне обороны. */
function gunLabelsUpdate() {
  const show = mySide() === 'defense', views = show ? aa.views() : [];
  for (const [id, e] of gunLabels) if (!views.some(v => v.id === id)) { e.remove(); gunLabels.delete(id); }
  for (const g of views) {
    let e = gunLabels.get(g.id); if (!e) { e = el('div', 'lbl gun'); e.onclick = () => selectGun(aaUI.sel === g.id ? 0 : g.id); $('labels').append(e); gunLabels.set(g.id, e); }
    v3.set(g.x, g.y + 6, g.z).project(cc.cam); const off = v3.z > 1 || Math.abs(v3.x) > 1 || Math.abs(v3.y) > 1;
    e.style.display = off ? 'none' : ''; if (off) continue;
    e.style.left = `${(v3.x + 1) / 2 * innerWidth}px`; e.style.top = `${(1 - v3.y) / 2 * innerHeight}px`;
    e.textContent = `ОГ №${g.id}` + (g.moving ? ' · в пути' : !g.ready ? ` · ${fmt(g.wait)}` : g.firing ? ' · огонь' : g.reload > 0 ? ' · лента' : '');
    e.classList.toggle('sel', g.id === aaUI.sel);
  }
}

// ---------- события сессии ----------
function feed(t: string, cls = '') { const d = el('div', cls); d.textContent = t; $('feed').append(d); setTimeout(() => d.remove(), 9000); while ($('feed').children.length > 6) $('feed').firstChild!.remove(); }

function follow(d: Drone) { cc.follow = () => drones.has(d.L.id) ? d.mesh.position : null; cc.dist = Math.min(cc.dist, 160); tac.show(false); syncLock(); }
function addDrone(L: Launch) {
  const u = UNITS[L.unit];
  if (!u || !protos[L.unit] || ![L.sx, L.sz, L.tx, L.tz, L.t0].every(Number.isFinite)) return; // чужие данные по сети не должны ломать игру
  L = { ...L };
  if (L.impactT === undefined) planLaunch(L, map);
  if (L.down) planDown(L, map, L.down.t, L.down.gun); // по сети приходит только момент поражения — падение считаем сами
  if (session!.now() >= L.t0 + endOf(L).t) { impact(L, true); return; } // подключились позже — попадание уже было
  const mesh = protos[L.unit].clone(); scene.add(mesh);
  const label = el('div', 'lbl'); $('labels').append(label);
  const row = el('div', 'it'); row.dataset.type = L.unit; $('tgList').append(row);
  const d: Drone = { L, mesh, prop: mesh.getObjectByName('prop') ?? null, glow: mesh.getObjectByName('glow') ?? null, label, row, s: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, eta: L.impactT, spin: 0 };
  label.onclick = row.onclick = () => follow(d);
  drones.set(L.id, d); $('targets').classList.remove('hidden');
  if (mySide() === 'defense') feed(`Воздушная тревога: ${u.name}, подлёт через ${fmt(L.impactT)}`, 'def');
  else feed(`Запуск: ${u.name} (${L.by}), подлёт через ${fmt(L.impactT)}`);
  if (drones.size === 1) sound.siren();
}

function impact(L: Launch, silent = false) {
  const u = UNITS[L.unit], e = endOf(L), dn = L.down;
  const tnt = dn ? (dn.det ? u.tntKg : 8) : u.tntKg; // сбитый дрон: боевая часть срабатывает не всегда, иначе — только удар и пожар от топлива
  const rad = 1.6 * Math.cbrt(tnt), [hit, fell] = destr.blast(e.x, e.y, e.z, rad, b => buildings.hide(b)), br = bridges.blast(e.x, e.y, e.z, rad);
  const onGround = !hit && !br && e.y - map.heightAt(e.x, e.z) < 2;
  hits.push({ x: e.x, z: e.z });
  if (silent) { fx.smolder(e.x, e.y, e.z, tnt); if (onGround) fx.scorch(e.x, e.y, e.z, Math.cbrt(tnt) * 3.6); return; }
  fx.explode(e.x, e.y, e.z, tnt, onGround);
  const dist = cc.cam.position.distanceTo(new THREE.Vector3(e.x, e.y, e.z));
  sound.explosion(dist, tnt, fell > 40, u.sounds); cc.shake = Math.max(cc.shake, Math.min(6, 900 / Math.max(60, dist)) * Math.min(1, tnt / 40));
  const lm = map.obstacles.find(o => (e.x - o.x) ** 2 + (e.z - o.z) ** 2 < (o.r + 3) ** 2 && e.y < o.top + 3);
  const where = lm && !hit ? lm.name : br ? 'пролёт моста обрушен' : hit ? `повреждено зданий: ${hit}` + (fell > 40 ? ', часть конструкций обрушилась' : '') : 'открытая местность';
  feed(dn ? `Сбитая ${u.name} упала${dn.det ? ' и взорвалась' : ''} — ${where}` : `Попадание: ${u.name} — ${where}`);
  if (op?.phase === 'battle' && session && isLead()) op.targets.forEach((t, i) => { // ведущий клиент сообщает серверу об ударе по цели операции
    const on = t.bridge >= 0 ? br > 0 && bridges.lastId === t.bridge : Math.hypot(e.x - t.x, e.z - t.z) < t.r + rad;
    if (on && t.hp > 0) session!.send({ type: 'opHit', i, tnt, launch: L.id });
  });
  if (session && L.pid === session.me && !dn) session.send({ type: 'hit', id: L.id, buildings: hit });
}

function removeDrone(d: Drone) { scene.remove(d.mesh); d.label.remove(); d.row.remove(); drones.delete(d.L.id); if (!drones.size) $('targets').classList.add('hidden'); }
function resetDamage() { map.bDamage.fill(0); destr.reset(); buildings.reset(); bridges.reset(); fx.clear(); hits.length = 0; for (const d of [...drones.values()]) removeDrone(d); }

function setPlayers(list: Player[], quiet = false) {
  const old = players, was = mySide(); players = list; pointsAt = session?.now() ?? 0;
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
  if (m.type === 'welcome') { gameMode = m.mode ?? 'sandbox'; planned.length = 0; setOp(m.op ?? null, true); if (m.env) { env.hour = m.env.hour; env.speed = m.env.speed; } setPlayers(m.players, true); aa.clear(); (m.guns ?? []).forEach(g => aa.upsert(g)); m.launches.forEach(addDrone); if (m.launches.length) feed(`Мир загружен: попаданий ${m.launches.length}`, 'sys'); }
  else if (m.type === 'launch') addDrone(m.launch);
  else if (m.type === 'down') onDown(m.id, m.t, m.gun);
  else if (m.type === 'op') setOp(m.op);
  else if (m.type === 'planned') { planned.push(m.launch); renderOp(); }
  else if (m.type === 'unplanned') { const i = planned.findIndex(L => L.id === m.id); if (i >= 0) planned.splice(i, 1); renderOp(); }
  else if (m.type === 'mode') { gameMode = m.mode; feed(m.mode === 'op' ? 'Режим «Операция»: бюджет фиксированный, сначала планирование, потом бой' : m.mode === 'game' ? `Режим «Игра»: запуск и постановка стоят очков. У всех по ${RULES.economy.start}, доход ${RULES.economy.income * 60} в минуту` : 'Режим «Песочница»: всё бесплатно', 'sys'); if (launchUI.armed) renderLaunch(); }
  else if (m.type === 'deny') feed(m.reason, 'sys');
  else if (m.type === 'aa') onGun(m.gun);
  else if (m.type === 'aaDel') { aa.remove(m.id); if (aaUI.sel === m.id) selectGun(0); else if (launchUI.armed?.aa) renderLaunch(); if (mySide() === 'defense') feed(`Огневая группа №${m.id} снята`, 'sys'); }
  else if (m.type === 'env') { env.hour = m.hour; env.speed = m.speed; }
  else if (m.type === 'reset') { resetDamage(); feed('Разрушения сброшены', 'sys'); }
  else if (m.type === 'players') setPlayers(m.players);
  else if (m.type === 'closed') { const r = m.reason; toMenu(); modal(`<h2>Сессия завершена</h2><p>${esc(r)}</p><button data-close>Понятно</button>`); }
}

// ---------- операция ----------
let op: OpState | null = null;
const planned: (Launch & { delay?: number })[] = [];   // отложенные запуски атаки (планирование)
const opRings = new THREE.Group(), tgtLabels: HTMLElement[] = [];
function setOp(o: OpState | null, quiet = false) {
  const was = op?.phase; op = o;
  if (!o || o.phase !== 'plan') planned.length = 0;
  while (opRings.children.length) { const r = opRings.children[0] as THREE.Mesh; opRings.remove(r); (r.material as THREE.Material).dispose(); }
  for (const z of o?.zones ?? []) { // районы возможных ударов — жёлтые кольца на земле
    const r = new THREE.Mesh(zoneGeo, new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.6, depthTest: false, fog: false, side: THREE.DoubleSide }));
    r.position.set(z.x, map.heightAt(z.x, z.z) + 4, z.z); r.scale.setScalar(z.r); r.renderOrder = 28; opRings.add(r);
  }
  if (o && !quiet && was !== o.phase) {
    if (o.phase === 'plan') feed('Операция: планирование. Атака намечает удары, оборона расставляет ПВО', 'sys');
    else if (o.phase === 'battle') { feed('Операция: бой начался', 'sys'); sound.siren(); }
    else if (o.result) { const r = o.result; modal(`<h2>Операция завершена</h2><p>Победа стороны «${SIDE_NAME[r.winner]}».</p><p>Поражено целей: ${r.destroyed} из ${r.total} (атаке нужно было ${r.need}).</p><p class="note">${o.targets.map(t => `${esc(t.name)} — ${t.hp <= 0 ? 'поражена' : 'уцелела'}`).join('<br>')}</p><button data-close>Понятно</button>`, { onClose: syncLock }); syncLock(); }
  }
  if (launchUI.armed) renderLaunch(); renderOp();
}
/** Панель операции вверху: фаза, таймер, цели (атаке — точные, обороне — только районы). */
function renderOp() {
  const bar = $('opBar'); bar.classList.toggle('hidden', !op || !session); if (!op || !session) return;
  const side = mySide(), left = Math.max(0, op.endsAt - session.now()), dead = op.targets.filter(t => t.hp <= 0).length, need = Math.ceil(op.targets.length * RULES.op.need);
  const tgs = (all: boolean) => op!.targets.map((t, i) => all || t.hp <= 0 ? `<span class="tg ${t.hp <= 0 ? 'dead' : ''}" data-t="${i}">${esc(t.name)}${t.hp > 0 && t.hp < t.max ? ` · ${Math.round(100 - t.hp / t.max * 100)} %` : ''}</span>` : '').join('');
  let h = '';
  if (op.phase === 'plan') {
    h = `<b class="t">Операция · планирование · ${fmt(left)}</b><br>` + (side === 'attack'
      ? `Ваши цели (нужно поразить ${need} из ${op.targets.length}): ${tgs(true)}<br>Запуски сейчас откладываются до начала боя — оборона их не видит. Запланировано: ${planned.length}. `
      : side === 'defense' ? `Противник ударит по объектам где-то в жёлтых районах (их ${op.zones.length}, часть — ложные). Расставьте огневые группы. `
      : 'Выберите сторону. ') + (side ? `<button id="opUndo" ${side === 'attack' && planned.length ? '' : 'hidden'}>Отменить последний</button> <button id="opReady" class="${op.ready[side] ? '' : 'on'}" ${op.ready[side] ? 'disabled' : ''}>${op.ready[side] ? 'Ждём противника' : 'Готов'}</button>` : '');
  } else if (op.phase === 'battle') {
    h = `<b class="t">Операция · бой · ${fmt(left)}</b> · поражено ${dead} из ${op.targets.length}, атаке нужно ${need}<br>` + (side === 'attack' ? tgs(true) : tgs(false) || 'Цели противника — где-то в жёлтых районах');
  } else if (op.result) h = `<b class="t">Операция завершена</b> · победа стороны «${SIDE_NAME[op.result.winner]}» · поражено ${op.result.destroyed} из ${op.result.total}<br>${tgs(true)}`;
  if (bar.dataset.h === h) return; bar.dataset.h = h; bar.innerHTML = h;
  bar.querySelectorAll<HTMLElement>('[data-t]').forEach(e => e.onclick = () => { const t = op!.targets[Number(e.dataset.t)]; cc.flyTo(t.x, t.z, 900); tac.show(false); syncLock(); });
  const rd = bar.querySelector<HTMLElement>('#opReady'); if (rd) rd.onclick = () => session?.send({ type: 'opReady' });
  const un = bar.querySelector<HTMLElement>('#opUndo'); if (un) un.onclick = () => { const L = planned[planned.length - 1]; if (L) session?.send({ type: 'opUnplan', id: L.id }); };
}
/** Метки целей в мире: атаке — все, обороне — только уже поражённые. */
function tgtLabelsUpdate() {
  const side = mySide(), list = op && session ? op.targets : [];
  while (tgtLabels.length > list.length) tgtLabels.pop()!.remove();
  list.forEach((t, i) => {
    let e = tgtLabels[i]; if (!e) { e = tgtLabels[i] = el('div', 'lbl tgt'); $('labels').append(e); }
    const show = side === 'attack' || t.hp <= 0 || op!.phase === 'done';
    v3.set(t.x, map.surfaceAt(t.x, t.z) + 30, t.z).project(cc.cam); const off = !show || v3.z > 1 || Math.abs(v3.x) > 1 || Math.abs(v3.y) > 1;
    e.style.display = off ? 'none' : ''; if (off) return;
    e.style.left = `${(v3.x + 1) / 2 * innerWidth}px`; e.style.top = `${(1 - v3.y) / 2 * innerHeight}px`; e.textContent = `◆ ${t.name}`; e.classList.toggle('dead', t.hp <= 0);
  });
}
/** Запуск операции из админ-панели: цели и районы выбирает этот клиент. */
function startOperation(n: number, planS: number, attack: number, defense: number) {
  if (!session) return;
  const o = makeOperation(map, landmarks.marks, n, RULES.op.zoneR, RULES.op.decoys);
  session.send({ type: 'opStart', targets: o.targets, zones: o.zones, planS, budget: { attack, defense } });
}

/** Цель сбита: с этого момента она падает. */
function onDown(id: number, t: number, gun: number) {
  const d = drones.get(id); if (!d || d.L.down || !Number.isFinite(t)) return; // уже долетела или уже сбита
  planDown(d.L, map, t, gun); const u = UNITS[d.L.unit];
  fx.airHit(d.s.x, d.s.y, d.s.z, d.mesh.scale.x); if (d.glow) d.glow.visible = false;
  feed(`Сбита: ${u.name} №${id}` + (gun ? ` — огневая группа №${gun}` : ''), 'def');
}
function onGun(g: GunRec) {
  const isNew = !aa.posOf(g.id); aa.upsert(g);
  if (mySide() === 'defense') feed(isNew ? `Огневая группа №${g.id} встала на позицию (${g.by})` : `Огневая группа №${g.id} получила приказ на переезд`, 'def');
  if (launchUI.armed?.aa || aaUI.sel) renderLaunch();
}

function start(s: Session) {
  session = s; players = []; s.listen(onMsg);
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); sound.unlock();
  applySide(); pickSide(true);
}
function toMenu() {
  session?.close(); session = null; players = []; setOp(null, true); tgtLabelsUpdate(); arm(null); selectGun(0); showCard(null); tac.show(false); resetDamage(); aa.clear(); gunLabelsUpdate();
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
  if (s !== 'defense') selectGun(0);
  aa.showRings = s === 'defense';
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
      `<tr class="${p.id === session?.me ? 'me' : ''}"><td>${esc(p.name)}${p.id === session?.me ? ' <span class="dim">(вы)</span>' : ''}</td><td class="n">${p.launches}</td><td class="n">${p.hits}</td><td class="n">${p.downs ?? 0}</td><td class="n">${session?.online ? p.ping + ' мс' : '—'}</td></tr>`).join('')
      : '<tr><td colspan="5" class="dim">никого</td></tr>');
  };
  $('scoreBody').innerHTML = `<div class="row"><h2 style="margin:0">${esc(session?.world ?? '')}</h2><span class="sp"></span><span class="dim">${session?.online ? `адрес: ${esc(session.addr)} · игроков: ${players.length}` : 'игра без сети'}</span></div>
    <table><tr><th>Игрок</th><th class="n">Запусков</th><th class="n">Поражено зданий</th><th class="n">Сбито</th><th class="n">Пинг</th></tr>
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
    <button class="big" id="pAdmin">Админ-панель<small>Время суток, режим игры, сброс разрушений</small></button>
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
    <label>Режим <select id="am">${(['sandbox', 'game'] as GameMode[]).concat(gameMode === 'op' ? ['op' as GameMode] : []).map(k => `<option value="${k}" ${k === gameMode ? 'selected' : ''}>${MODE_NAME[k]}</option>`).join('')}</select></label>
    <p class="note">«Песочница» — всё бесплатно. «Игра» — запуск целей и постановка ПВО стоят очков: на старте ${RULES.economy.start}, доход ${RULES.economy.income * 60} в минуту, копится не больше ${RULES.economy.cap}. За снятую группу возвращается ${RULES.economy.refund * 100} % цены, за сбитую цель обороне — ${RULES.economy.bounty * 100} % её цены. Переезд групп бесплатный. При смене режима очки у всех сбрасываются.</p>
    <h3 style="margin:14px 0 4px">Операция</h3>
    <p class="note">Сначала планирование: атака получает точные цели и намечает удары, оборона видит только районы (часть — ложные) и расставляет ПВО. Потом бой. Бюджет фиксированный, не пополняется. Поле очищается: разрушения и группы сбрасываются. Сторону во время операции менять нельзя — пусть игроки выберут её заранее.</p>
    <div class="row"><label>Целей <select id="opN">${[1, 2, 3, 4, 5].map(k => `<option ${k === RULES.op.targets ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Планирование <select id="opT">${[1, 2, 3, 5, 10].map(k => `<option value="${k * 60}" ${k * 60 === RULES.op.planS ? 'selected' : ''}>${k} мин</option>`).join('')}</select></label>
      <label>Очки атаки <input id="opA" type="number" min="50" max="5000" step="50" value="${RULES.op.budget.attack}" style="width:80px"></label>
      <label>обороны <input id="opD" type="number" min="30" max="5000" step="30" value="${RULES.op.budget.defense}" style="width:80px"></label></div>
    <button id="opGo" class="on">Начать операцию</button> <span class="note">${session?.online ? '' : 'Нужна программа VENOM или сервер: в браузере без сервера операция не запускается.'}</span><p></p>
    <button id="ar">Сбросить разрушения</button> <button data-close>Закрыть</button></div>`, { onClose: syncLock });
  const push = () => session?.send({ type: 'env', hour: env.hour, speed: env.speed });
  m.q<HTMLInputElement>('#ah').oninput = e => { env.hour = Number((e.target as HTMLInputElement).value) % 24; m.q('#ahv').textContent = env.clock(); };
  m.q<HTMLInputElement>('#ah').onchange = push;
  m.q<HTMLSelectElement>('#as').onchange = e => { env.speed = Number((e.target as HTMLSelectElement).value); push(); };
  m.q('#ar').onclick = () => session?.send({ type: 'reset' });
  m.q('#opGo').onclick = () => { startOperation(Number(m.q<HTMLSelectElement>('#opN').value), Number(m.q<HTMLSelectElement>('#opT').value), Number(m.q<HTMLInputElement>('#opA').value) || RULES.op.budget.attack, Number(m.q<HTMLInputElement>('#opD').value) || RULES.op.budget.defense); m.close(); };
  m.q<HTMLSelectElement>('#am').onchange = e => session?.send({ type: 'mode', mode: (e.target as HTMLSelectElement).value as GameMode });
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
/** Плашка «Новая версия» в главном меню: что добавили и кнопка «Обновить». Работает в программе VENOM.exe. */
interface Upd { available: boolean; current: string; latest?: string; notes?: string; size?: number; canInstall?: boolean; state?: string; progress?: number; error?: string }
async function checkUpdate() {
  const box = $('update'); let u: Upd;
  try { const r = await fetch('./api/update', { cache: 'no-store' }); if (!r.ok) return; u = await r.json(); } catch { return; }
  if (u.current) $('ver').textContent = `Версия ${u.current} · сборка ${__BUILD__}`;
  const draw = (v: Upd) => {
    const busy = v.state === 'downloading' || v.state === 'restarting';
    box.classList.toggle('hidden', !v.available && !busy); if (!v.available && !busy) return;
    box.innerHTML = `<h3>Новая версия ${esc(v.latest ?? '')}</h3><div class="dim">У вас ${esc(v.current)} · размер ${((v.size ?? 0) / 1e6).toFixed(0)} МБ</div><div class="notes">${esc(v.notes ?? '')}</div>`
      + (v.state === 'restarting' ? '<b>Готово — программа перезапускается…</b>' : v.state === 'downloading' ? `<b>Скачивание: ${Math.round((v.progress ?? 0) * 100)} %</b><div class="bar"><i style="width:${(v.progress ?? 0) * 100}%"></i></div>`
        : (v.canInstall ? '<button class="on" id="updGo">Обновить</button>' : '<span class="note">Скачайте новую версию со страницы релизов.</span>') + (v.error ? ` <span class="note" style="color:#ff8a70">${esc(v.error)}</span>` : ''));
    const go = box.querySelector<HTMLElement>('#updGo'); if (go) go.onclick = async () => {
      try { draw(await (await fetch('./api/update', { method: 'POST', cache: 'no-store' })).json()); } catch { return; }
      const timer = window.setInterval(async () => { try { const s2: Upd = await (await fetch('./api/update', { cache: 'no-store' })).json(); draw(s2); if (s2.state === 'error') clearInterval(timer); } catch { clearInterval(timer); } }, 500); // после перезапуска сервер пропадёт — опрос остановится сам
    };
  };
  draw(u);
}
function initMenu() {
  void checkUpdate();
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
    if (aaUI.sel) { selectGun(0); return; }
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
const tacData: TacData = { drones: [], hits, cam: { x: 0, z: 0, yaw: 0, dist: 0 }, aim: null, cursor: null, guns: [], zones: [], targets: [], planned: [] };
let worst = 0, prevMs = performance.now(); // самый долгий кадр за последние полсекунды — по нему видны рывки
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0, frameNo = 0;
function frame(nowMs: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs; frameNo++;
  U.uTime.value += dt;
  if (session) { const now = session.now(); for (const d of drones.values()) { flightState(d.L, map, Math.max(0, Math.min(now - d.L.t0, endOf(d.L).t)), d.s); d.mesh.position.set(d.s.x, d.s.y, d.s.z); } } // цели — до камеры: слежение без отставания на кадр
  cc.update(dt); const t = cc.target;
  env.update(dt, scene, cc.cam);
  U.uFogD.value = 1 / Math.max(45000, t.dist * 3.2);
  ground.update(t.x, t.z, t.dist); buildings.update(t.x, t.z, t.dist); trees.update(t.x, t.z, t.dist, canvas.height, cc.cam.position);
  heard.length = 0; tacData.drones.length = 0;
  if (session) {
    const now = session.now(), filter = $<HTMLSelectElement>('tgFilter').value;
    for (const d of [...drones.values()]) {
      const tt = now - d.L.t0, u = UNITS[d.L.unit];
      const endT = endOf(d.L).t, fall = !!d.L.down && tt >= d.L.down.t;
      if (tt >= endT) { removeDrone(d); impact(d.L); continue; }
      d.eta = endT - tt; fwd.set(d.s.vx, d.s.vy, d.s.vz);
      d.mesh.lookAt(v3.copy(d.mesh.position).add(fwd)); if (d.prop && !fall) d.prop.rotation.z += dt * 90;
      if (fall) { d.spin += dt * 4; d.mesh.rotateZ(d.spin); if (Math.random() < dt * 40) fx.wreckTrail(d.s.x, d.s.y, d.s.z, d.mesh.scale.x); } // сбитая цель кувыркается и горит
      if (d.glow) d.glow.scale.set(1, 1, 0.85 + 0.3 * Math.random()); // факел дрожит
      const dist = cc.cam.position.distanceTo(d.mesh.position);
      d.mesh.scale.setScalar(Math.max(1, dist / 260)); // издалека модель увеличивается, чтобы цель оставалась видимой
      const closing = -fwd.dot(v3.copy(d.mesh.position).sub(cc.cam.position).normalize());
      v3.copy(d.mesh.position).project(cc.cam);
      if (!fall) heard.push({ dist, closing, pan: v3.z > 1 ? -v3.x : v3.x, dive: Math.min(1, Math.max(0, 1 - d.eta / 3.5)), seed: d.L.seed, near: u.sounds.engineNear, far: u.sounds.engineFar, engine: u.engine });
      // метка всегда на экране: если цель вне кадра, прижимается к краю
      if (v3.z > 1) { v3.x = -v3.x; v3.y = -v3.y; }
      const off = v3.z > 1 || Math.abs(v3.x) > 0.94 || v3.y > 0.8 || v3.y < -0.94;
      if (off) { const k = Math.max(Math.abs(v3.x) / 0.94, v3.y > 0 ? v3.y / 0.8 : -v3.y / 0.94, 1e-6); v3.x /= k; v3.y /= k; }
      d.label.style.left = `${(v3.x + 1) / 2 * innerWidth}px`; d.label.style.top = `${(1 - v3.y) / 2 * innerHeight}px`; d.label.style.opacity = off ? '0.7' : '1';
      const eta = fall ? 'сбита' : fmt(d.eta); d.label.textContent = `${u.name} ${eta}`; d.label.classList.toggle('down', fall);
      if (frameNo % 6 === 0) { d.row.innerHTML = `<span>${u.name} №${d.L.id} <small>${esc(d.L.by)}</small></span><b>${eta}</b>`; d.row.classList.toggle('hidden', !!filter && filter !== d.L.unit); }
      tacData.drones.push({ x: d.s.x, z: d.s.z, sx: d.L.sx, sz: d.L.sz, tx: d.L.tx, tz: d.L.tz, hdg: Math.atan2(d.s.vx, -d.s.vz), label: eta });
    }
    if (frameNo % 30 === 0 && drones.size > 1) { // список целей: ближайшие по времени подлёта сверху
      const rows = [...drones.values()].sort((a, b) => a.eta - b.eta), list = $('tgList'); let i = 0;
      for (const d of rows) { if (list.children[i] !== d.row) list.insertBefore(d.row, list.children[i] ?? null); i++; }
    }
    if (frameNo % 6 === 0) $('tgCount').textContent = String(drones.size);
  }
  sound.engines(heard); setGlow(U.uNight.value);
  if (session) { // ПВО: ведущий клиент (первый из подключённых) решает, какие цели сбиты
    aa.update(dt, session.now(), drones, U.uNight.value, cc.cam, isLead(), (id, tk, gun) => session?.send({ type: 'down', id, t: tk, gun }),
      (x, y, z) => { v3.set(x, y, z); const dist = cc.cam.position.distanceTo(v3); v3.project(cc.cam); sound.gunBurst(dist, v3.z > 1 ? -v3.x : v3.x); });
    gunLabelsUpdate(); tgtLabelsUpdate(); if (aaUI.sel && frameNo % 20 === 0 && !aaUI.move) renderAA();
  }
  if (marker.visible) marker.scale.setScalar(Math.max(12, t.dist * 0.018) * (1 + 0.08 * Math.sin(nowMs / 150)));
  destr.update(dt); landmarks.update(dt); fx.update(dt); fx.lights(t.x, t.y, t.z);
  if (!tac.open) { renderer.info.reset(); shadows?.render(renderer, t); if (post) post.render(scene, cc.cam); else renderer.render(scene, cc.cam); }
  cards.render(dt, nowMs);
  if (session && (tac.open || (S.minimap && frameNo % 6 === 0))) {
    const u = launchUI.armed; tacData.cam.x = t.x; tacData.cam.z = t.z; tacData.cam.yaw = cc.yawNow; tacData.cam.dist = t.dist; tacData.cursor = tac.cursor;
    tacData.zones = op?.zones ?? []; tacData.targets = op ? op.targets.filter(t2 => mySide() === 'attack' || t2.hp <= 0 || op!.phase === 'done').map(t2 => ({ x: t2.x, z: t2.z, name: t2.name, dead: t2.hp <= 0 })) : [];
    tacData.planned = planned.map(L => ({ sx: L.sx, sz: L.sz, tx: L.tx, tz: L.tz, label: `${UNITS[L.unit]?.name ?? ''}${L.delay ? ' +' + fmt(L.delay) : ''}` }));
    tacData.guns.length = 0; if (mySide() === 'defense') for (const g of aa.views()) tacData.guns.push({ x: g.x, z: g.z, r: g.r, ready: g.ready, sel: g.id === aaUI.sel, label: `№${g.id}`, path: g.path });
    tacData.aim = u && launchUI.step === 1 ? { tx: launchUI.tx, tz: launchUI.tz, rings: gameMode !== 'sandbox' ? (launchUI.range ? [{ r: launchUI.range, label: `точка появления · ${launchUI.range / 1000} км` }] : []) : launchUI.mode ? [{ r: launchUI.mode * u.speed, label: `точка появления · ${fmt(launchUI.mode)}` }] : [15, 60, 180].map(s => ({ r: s * u.speed, label: fmt(s) })) } : null;
    if (tac.open) { tac.draw(tacData); $('tacInfo').textContent = `· целей в воздухе: ${drones.size} · попаданий: ${hits.length}`; } else mini.draw(tacData);
  }
  fpsAcc += dt; fpsN++; fpsT += dt; worst = Math.max(worst, nowMs - prevMs); prevMs = nowMs;
  if (fpsT > 0.5) {
    const fps = fpsN / fpsAcc, i = renderer.info.render;
    if (S.perf) $('perf').textContent = `${fps.toFixed(0)} к/с · ${(1000 / fps).toFixed(1)} мс · худший кадр ${worst.toFixed(0)} мс · вызовов ${i.calls} · треуг. ${(i.triangles / 1e6).toFixed(2)} млн\nтайлов ${buildings.stats.tiles} · частиц ${fx.count} · деревьев ${trees.count} · обломков ${destr.debris} · разрешение ${Math.round(dyn * 100)}% · ${Q.name}`;
    if (session) { // очки и доступность юнитов по цене
      const game = gameMode !== 'sandbox', pts = myPoints();
      renderOp();
      $('points').innerHTML = gameMode === 'op' ? `Бюджет: <b>${Math.floor(pts)}</b>` : game ? `Очки: <b>${Math.floor(pts)}</b> <span class="dim">+${RULES.economy.income * 60}/мин</span>` : '<span class="dim">Песочница</span>';
      document.querySelectorAll<HTMLElement>('#arsenal .tile, #quick .q.full').forEach(t => t.classList.toggle('poor', game && (UNITS[t.dataset.unit ?? '']?.cost ?? 0) > pts));
    }
    $('clock').textContent = env.clock(); $('tspeed').textContent = env.speed ? `×${env.speed}` : 'пауза';
    // динамическое разрешение — только на слабых пресетах и только при долгой просадке: каждое изменение пересоздаёт буферы кадра (рывок и мерцание)
    if (Q.dynRes && document.hasFocus() && !location.search.includes('nodyn')) {
      if (fps < 35) { dynLow++; dynHigh = 0; } else if (fps > 57) { dynHigh++; dynLow = 0; } else dynLow = dynHigh = 0;
      if (dynLow >= 4 && dyn > 0.5) { dyn = Math.max(0.5, dyn - 0.15); dynLow = 0; resize(); } else if (dynHigh >= 12 && dyn < 1) { dyn = Math.min(1, dyn + 0.15); dynHigh = 0; resize(); }
    }
    fpsAcc = fpsN = fpsT = 0; worst = 0;
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
  aa = new AirDefense(map, fx, unit => protos[unit]?.clone() ?? null); roads = new Roads(map);
  scene.add(ground.group, buildings.group, landmarks.group, bridges.group, trees.group, destr.group, trees.lampGroup, fx.group, aa.group, opRings, marker, aimLine);
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
  $('btnCancel').onclick = () => { arm(null); selectGun(0); }; $('arMin').onclick = () => $('arsenal').classList.toggle('min');
  $<HTMLInputElement>('arSearch').oninput = renderArsenal;
  syncLock();
  (window as any).venom = { U, map, cc, env, drones, aa, roads, startOperation, planned, get op() { return op; }, get mode() { return gameMode; }, buildings, ground, fx, destr, trees, bridges, landmarks, arm, clickWorld, UNITS, S, scene, renderer, get session() { return session; }, get players() { return players; } };
  requestAnimationFrame(frame);
}
boot().catch(e => { $('loadText').textContent = 'Ошибка загрузки: ' + (e?.message ?? e); console.error(e); });
