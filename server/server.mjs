// Сервер сессии: раздаёт собранную игру (dist/), хранит миры и рассылает события между игроками.
// Запуск: npm run build && npm run server   → друзья открывают http://АДРЕС_ХОСТА:8080
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

const t0 = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - t0) / 1e9;

// ---------- миры ----------
// Мир — журнал попаданий и время суток. Разрушения восстанавливаются повтором попаданий.
const WORLDS = process.env.VENOM_WORLDS || path.join(process.cwd(), 'venom-worlds');
const OLD_SAVE = process.env.VENOM_SAVE || path.join(process.cwd(), 'venom-save.json');
fs.mkdirSync(WORLDS, { recursive: true });
const worldFile = id => path.join(WORLDS, id + '.json');
const validId = id => /^[a-z0-9]{4,24}$/.test(id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanName = (s, def) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32) || def;

function readWorld(id) { try { const d = JSON.parse(fs.readFileSync(worldFile(id), 'utf8')); d.id = id; d.launches ||= []; return d; } catch { return null; } }
function listWorlds() {
  const out = [];
  for (const f of fs.readdirSync(WORLDS)) {
    if (!f.endsWith('.json')) continue;
    const d = readWorld(f.slice(0, -5)); if (d) out.push({ id: d.id, name: d.name, updated: d.updated || 0, hits: d.launches.length });
  }
  return out.sort((a, b) => b.updated - a.updated);
}
function createWorld(name, extra = {}) {
  const w = { id: newId(), name: cleanName(name, 'Новый мир'), created: Date.now(), updated: Date.now(), launches: [], env: { hour: 15, speed: 10 }, ...extra };
  fs.writeFileSync(worldFile(w.id), JSON.stringify(w)); return w;
}

let world = null;              // активный мир
let launches = [], nextId = 1;
let guns = [], nextGun = 1;   // огневые группы ПВО
// Правила, общие с клиентом: цены, экономика, лимиты.
const RULES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'rules.json'), 'utf8'));
const E = RULES.economy, COST = RULES.cost, AA = RULES.aaMax;
let mode = 'sandbox';         // 'sandbox' — без очков, 'game' — запуск и постановка стоят очков
const wallets = new Map();    // ник → { p, at }: очки сохраняются за игроком, пока открыт мир
const bal = me => Math.min(E.cap, me.wallet.p + E.income * (now() - me.wallet.at));
const setBal = (me, v) => { me.wallet.p = Math.max(0, Math.min(E.cap, v)); me.wallet.at = now(); };
const spend = (me, c) => { if (mode !== 'game') return true; const b = bal(me); if (b < c) return false; setBal(me, b - c); return true; };
let env = { hour: 15, speed: 10, at: now() };
const hourNow = () => (env.hour + (now() - env.at) * env.speed / 3600) % 24;

let saveTimer = null;
const flush = () => { clearTimeout(saveTimer); saveTimer = null; if (!world) return; world.launches = launches; world.guns = guns.map(g => ({ ...g, path: undefined })); world.mode = mode; world.env = { hour: hourNow(), speed: env.speed }; world.updated = Date.now(); try { fs.writeFileSync(worldFile(world.id), JSON.stringify(world)); } catch (e) { console.error('VENOM: мир не сохранён', e.message); } };
const save = () => { if (!saveTimer) saveTimer = setTimeout(flush, 500); };
setInterval(() => { if (players.size) save(); }, 60000).unref();
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { flush(); process.exit(0); });

function openWorld(id) {
  const w = readWorld(id); if (!w) return false;
  flush(); world = w;
  launches = w.launches.map(L => ({ ...L, t0: -1e7 })); // всё, что было в воздухе при выходе, считается долетевшим
  nextId = launches.reduce((m, L) => Math.max(m, (L.id || 0) + 1), 1);
  mode = w.mode === 'game' ? 'game' : 'sandbox'; wallets.clear();
  guns = (w.guns || []).map(g => ({ ...g, x0: g.x, z0: g.z, t: -1e7, path: undefined })); nextGun = guns.reduce((m, g) => Math.max(m, (g.id || 0) + 1), 1); // после загрузки все группы стоят на местах
  env = { hour: Number(w.env?.hour) || 15, speed: Number(w.env?.speed) || 0, at: now() };
  console.log(`VENOM: открыт мир «${w.name}», попаданий: ${launches.length}`);
  return true;
}

{ // при старте: перенос сохранения старого формата, затем открываем последний мир
  let list = listWorlds();
  if (!list.length) {
    let old = null; try { old = JSON.parse(fs.readFileSync(OLD_SAVE, 'utf8')); } catch { /* старого сохранения нет */ }
    createWorld('Мир 1', old ? { launches: old.launches || [], env: old.env || { hour: 15, speed: 10 } } : {});
    list = listWorlds();
  }
  openWorld(list[0].id);
}

// ---------- HTTP ----------
const isLocal = req => { const a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
const lanAddrs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const json = (res, code, data) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
const body = req => new Promise(resolve => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e4) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });
let port = PORT;

async function api(req, res, p) {
  if (p === '/api/info') return json(res, 200, { host: isLocal(req), addrs: isLocal(req) ? lanAddrs() : [], port, world: world?.name ?? '', players: players.size });
  if (!isLocal(req)) return json(res, 403, { error: 'Только для хоста' }); // мирами управляет только тот, у кого запущена игра
  const m = p.match(/^\/api\/worlds(?:\/([a-z0-9]+)(\/open)?)?$/);
  if (!m) return json(res, 404, {});
  const [, id, open] = m;
  if (!id && req.method === 'GET') return json(res, 200, listWorlds().map(w => ({ ...w, active: w.id === world?.id, players: w.id === world?.id ? players.size : 0 })));
  if (!id && req.method === 'POST') { const w = createWorld((await body(req)).name); return json(res, 200, { id: w.id, name: w.name, updated: w.updated, hits: 0 }); }
  if (!id || !validId(id)) return json(res, 404, {});
  if (open && req.method === 'POST') {
    if (world?.id !== id) { kickAll('Хост открыл другой мир'); if (!openWorld(id)) return json(res, 404, {}); }
    return json(res, 200, { ok: true });
  }
  if (req.method === 'DELETE') {
    if (world?.id === id) { kickAll('Мир удалён'); world = null; launches = []; clearTimeout(saveTimer); saveTimer = null; }
    try { fs.unlinkSync(worldFile(id)); } catch { /* уже удалён */ }
    if (!world) { const l = listWorlds(); openWorld((l[0] ?? createWorld('Мир 1')).id); }
    return json(res, 200, { ok: true });
  }
  json(res, 405, {});
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.startsWith('/api/')) { api(req, res, p).catch(() => json(res, 500, {})); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DIST, path.normalize(p));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Не найдено. Сначала выполните: npm run build'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  });
});

// ---------- игроки и события ----------
const NUM = ['sx', 'sz', 'tx', 'tz', 'seed', 'cruiseY', 'dur', 'impactT', 'ix', 'iy', 'iz', 'building'];
const validLaunch = L => L && typeof L.unit === 'string' && L.unit.length < 32 && NUM.every(k => Number.isFinite(L[k]));
const SIDES = ['attack', 'defense'];

const wss = new WebSocketServer({ server, maxPayload: 16384 });
wss.on('error', () => {}); // ошибки порта обрабатываются ниже, на самом сервере
const players = new Map(); // ws -> { id, name, side, launches, hits, ping }
let nextPlayer = 1;
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const broadcast = m => { const s = JSON.stringify(m); for (const ws of players.keys()) if (ws.readyState === 1) ws.send(s); };
const roster = () => [...players.values()].map(({ wallet, ...p }) => ({ ...p, points: Math.round(bal({ wallet }) * 10) / 10 }));
const sendRoster = () => broadcast({ type: 'players', players: roster() });
function kickAll(reason) { for (const ws of players.keys()) { send(ws, { type: 'closed', reason }); ws.close(); } players.clear(); }
function uniqueName(name, self) {
  const taken = new Set([...players.values()].filter(p => p !== self).map(p => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
}

wss.on('connection', ws => {
  let me = null; // появляется после hello
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'hello') {
      if (me || !world) return;
      me = { id: nextPlayer++, name: '', side: SIDES.includes(m.side) ? m.side : null, launches: 0, hits: 0, downs: 0, ping: 0 };
      me.name = uniqueName(cleanName(m.name, 'Игрок ' + me.id), me);
      me.wallet = wallets.get(me.name) ?? { p: E.start, at: now() }; wallets.set(me.name, me.wallet);
      players.set(ws, me);
      send(ws, { type: 'welcome', you: me.id, now: now(), world: world.name, players: roster(), launches, guns, mode, env: { hour: hourNow(), speed: env.speed } });
      sendRoster();
      return;
    }
    if (!me) return;
    if (m.type === 'launch' && validLaunch(m.launch) && launches.length < 5000) {
      if (me.side !== 'attack' || !(m.launch.unit in COST)) return; // запускает только сторона атаки
      if (!spend(me, COST[m.launch.unit])) { send(ws, { type: 'deny', reason: 'Не хватает очков' }); return; }
      const L = m.launch; L.id = nextId++; L.by = me.name; L.pid = me.id; L.t0 = now() + 0.25; // небольшой запас, чтобы у всех старт был одновременным
      launches.push(L); me.launches++; broadcast({ type: 'launch', launch: L }); sendRoster(); save();
    } else if (m.type === 'hit') { // владелец запуска сообщает результат — для таблицы игроков
      const L = launches.find(x => x.id === m.id);
      if (L && L.pid === me.id && !L.counted) { L.counted = 1; me.hits += Math.max(0, Math.min(50, Number(m.buildings) || 0)); sendRoster(); }
    } else if (m.type === 'down') { // ведущий клиент сообщает, что цель сбита; первое сообщение о цели — окончательное
      const L = launches.find(x => x.id === m.id), t = Number(m.t);
      if (L && !L.down && Number.isFinite(t) && t > 0 && t < L.impactT && now() < L.t0 + L.impactT + 2) {
        const g = guns.find(x => x.id === m.gun); L.down = { t, gun: g ? g.id : 0 };
        const owner = g && [...players.values()].find(p => p.id === g.pid); if (owner) { owner.downs++; if (mode === 'game') setBal(owner, bal(owner) + E.bounty * (COST[L.unit] || 0)); }
        broadcast({ type: 'down', id: L.id, t, gun: L.down.gun }); sendRoster(); save();
      }
    } else if (m.type === 'aaPlace') {
      const x = Number(m.x), z = Number(m.z);
      if (me.side !== 'defense' || !AA[m.unit] || !Number.isFinite(x) || !Number.isFinite(z) || guns.filter(g => g.unit === m.unit).length >= AA[m.unit]) return;
      if (!spend(me, COST[m.unit] || 0)) { send(ws, { type: 'deny', reason: 'Не хватает очков' }); return; }
      const g = { id: nextGun++, pid: me.id, by: me.name, unit: m.unit, x0: x, z0: z, x, z, t: now() };
      guns.push(g); broadcast({ type: 'aa', gun: g }); sendRoster(); save();
    } else if (m.type === 'aaMove') {
      const g = guns.find(x => x.id === m.id), v = [m.x0, m.z0, m.x, m.z].map(Number);
      const p = Array.isArray(m.path) && m.path.length >= 4 && m.path.length <= 1200 && m.path.length % 2 === 0 && m.path.every(Number.isFinite) ? m.path : undefined; // маршрут по дорогам считает клиент
      if (me.side !== 'defense' || !g || !v.every(Number.isFinite)) return;
      [g.x0, g.z0, g.x, g.z] = v; g.path = p; g.t = now(); g.pid = me.id; g.by = me.name; broadcast({ type: 'aa', gun: g }); save();
    } else if (m.type === 'aaDel') {
      const g = guns.find(x => x.id === m.id); if (me.side !== 'defense' || !g) return;
      guns = guns.filter(x => x.id !== m.id); broadcast({ type: 'aaDel', id: m.id });
      if (mode === 'game') setBal(me, bal(me) + E.refund * (COST[g.unit] || 0)); // за снятую группу возвращается часть цены
      sendRoster(); save();
    } else if (m.type === 'mode') { // админ переключает режим: у всех очки сбрасываются к стартовым
      mode = m.mode === 'game' ? 'game' : 'sandbox'; for (const w of wallets.values()) { w.p = E.start; w.at = now(); }
      broadcast({ type: 'mode', mode }); sendRoster(); save();
    } else if (m.type === 'side') { if (SIDES.includes(m.side) && me.side !== m.side) { me.side = m.side; sendRoster(); } }
    else if (m.type === 'name') { const n = uniqueName(cleanName(m.name, me.name), me); if (n !== me.name) { me.name = n; sendRoster(); } }
    else if (m.type === 'ping') { me.ping = Math.max(0, Math.min(9999, Math.round(Number(m.rtt) || 0))); send(ws, { type: 'pong', t: m.t, now: now() }); }
    else if (m.type === 'env') { env = { hour: Number(m.hour) || 0, speed: Math.max(0, Math.min(3600, Number(m.speed) || 0)), at: now() }; broadcast({ type: 'env', hour: env.hour, speed: env.speed }); save(); }
    else if (m.type === 'reset') { launches = []; for (const p of players.values()) p.launches = p.hits = p.downs = 0; broadcast({ type: 'reset' }); sendRoster(); save(); }
  });
  ws.on('close', () => { if (players.delete(ws)) { sendRoster(); if (!players.size) flush(); } });
  ws.on('error', () => {});
});
setInterval(sendRoster, 5000).unref(); // пинг в таблице обновляется у всех

// Если порт занят (например, осталась запущенной старая копия игры), берём следующий свободный.
export const ready = new Promise(resolve => {
  server.on('error', e => { if (e.code === 'EADDRINUSE' && port < PORT + 20) server.listen(++port); else console.error(e); });
  server.on('listening', () => {
    console.log(`VENOM: сессия запущена, порт ${port}. Откройте http://localhost:${port}`);
    for (const a of lanAddrs()) console.log(`       адрес для друзей: ${a}:${port}`);
    resolve(port);
  });
  server.listen(port);
});
