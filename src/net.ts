// Сессия: локальная (всё в браузере) или сетевая (сервер рассылает события всем игрокам). Плюс список миров.
import { Launch } from './sim';
import { GunRec } from './aa';
import { UNITS, RULES, GameMode } from './units';
import { OpState } from './op';
import { Side } from './units';

export interface Player { id: number; name: string; side: Side | null; launches: number; hits: number; downs: number; ping: number; points: number } // points — очки на момент рассылки списка, дальше клиент досчитывает доход сам

export type Msg =
  | { type: 'welcome'; you: number; now: number; world: string; players: Player[]; launches: Launch[]; guns?: GunRec[]; mode?: GameMode; op?: OpState | null; env?: { hour: number; speed: number } }
  | { type: 'players'; players: Player[] }
  | { type: 'hello'; name: string; side: Side | null }
  | { type: 'side'; side: Side }
  | { type: 'name'; name: string }
  | { type: 'launch'; launch: Launch; delay?: number }                         // delay — на планировании операции: через сколько секунд после начала боя вылетит
  | { type: 'op'; op: OpState | null }                                         // состояние операции
  | { type: 'opStart'; targets: { name: string; x: number; z: number; r: number; bridge: number }[]; zones: { x: number; z: number; r: number }[]; planS: number; budget: Record<Side, number> }
  | { type: 'opReady' } | { type: 'opUnplan'; id: number } | { type: 'opHit'; i: number; tnt: number; launch: number }
  | { type: 'planned'; launch: Launch & { delay?: number } } | { type: 'unplanned'; id: number } // отложенные запуски — видит только атака
  | { type: 'hit'; id: number; buildings: number }
  | { type: 'down'; id: number; t: number; gun: number }                       // цель сбита (решает ведущий клиент)
  | { type: 'aaPlace'; unit: string; x: number; z: number }                    // поставить огневую группу
  | { type: 'aaMove'; id: number; x0: number; z0: number; x: number; z: number; path: number[] } // перегнать: откуда (где она сейчас), куда и маршрут по дорогам
  | { type: 'mode'; mode: GameMode }                                           // админ: песочница или игра на очки
  | { type: 'deny'; reason: string }                                           // сервер отказал: не хватает очков
  | { type: 'aa'; gun: GunRec }                                                // группа поставлена или получила приказ
  | { type: 'aaDel'; id: number }
  | { type: 'ping'; t: number; rtt: number }
  | { type: 'pong'; t: number; now: number }
  | { type: 'env'; hour: number; speed: number }
  | { type: 'reset' }
  | { type: 'closed'; reason: string };

export interface Session {
  online: boolean; me: number; world: string; addr: string;
  now(): number;                               // общие часы сессии, с
  send(m: Msg): void;
  /** Назначить обработчик входящих событий. */
  listen(h: (m: Msg) => void): void;
  close(): void;
}

export interface WorldInfo { id: string; name: string; updated: number; hits: number; active?: boolean; players?: number }
export interface Worlds {
  /** true — миры хранит сервер на этом компьютере, к миру могут подключаться друзья. */
  hosted: boolean; addrs: string[];
  list(): Promise<WorldInfo[]>;
  create(name: string): Promise<WorldInfo>;
  remove(id: string): Promise<void>;
  open(w: WorldInfo, name: string): Promise<Session>;
}

// ---------- локальные миры (хранилище браузера) ----------
const INDEX = 'venom.worlds', OLD_SOLO = 'venom.save.solo';
const wkey = (id: string) => 'venom.world.' + id;
const read = <T>(k: string, def: T): T => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : def; } catch { return def; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* хранилище недоступно или переполнено */ } };

function localWorlds(): Worlds {
  let index = read<WorldInfo[]>(INDEX, []);
  if (!index.length) { // первое открытие: переносим сохранение старого формата
    const old = read<Launch[]>(OLD_SOLO, []);
    index = [{ id: 'w' + Date.now().toString(36), name: 'Мир 1', updated: Date.now(), hits: old.length }];
    write(wkey(index[0].id), old); write(INDEX, index);
  }
  const touch = (id: string, hits: number) => { const w = index.find(x => x.id === id); if (w) { w.updated = Date.now(); w.hits = hits; write(INDEX, index); } };
  return {
    hosted: false, addrs: [],
    list: async () => [...index].sort((a, b) => b.updated - a.updated),
    create: async name => { const w = { id: 'w' + Date.now().toString(36), name: name.trim().slice(0, 32) || 'Новый мир', updated: Date.now(), hits: 0 }; index.push(w); write(INDEX, index); write(wkey(w.id), []); return w; },
    remove: async id => { index = index.filter(w => w.id !== id); write(INDEX, index); try { localStorage.removeItem(wkey(id)); } catch { /* нет доступа */ } },
    open: async (w, name) => localSession(w, name, touch),
  };
}

/** Игра без сервера: всё локально, попадания сохраняются в хранилище браузера. */
function localSession(w: WorldInfo, name: string, touch: (id: string, hits: number) => void): Session {
  let handler: (m: Msg) => void = () => {};
  let log = read<Launch[]>(wkey(w.id), []), nextId = log.reduce((m, L) => Math.max(m, (L.id || 0) + 1), 1);
  const me: Player = { id: 1, name: name || 'Игрок', side: null, launches: 0, hits: 0, downs: 0, ping: 0, points: RULES.economy.start };
  // экономика: те же правила, что на сервере (server/server.mjs)
  const E = RULES.economy, eco = read<{ mode: GameMode; p: number }>(wkey(w.id) + '.eco', { mode: 'sandbox', p: E.start }); let mode = eco.mode, wp = eco.p, wat = performance.now() / 1000;
  const bal = () => Math.min(E.cap, wp + E.income * (performance.now() / 1000 - wat));
  const setBal = (v: number) => { wp = Math.max(0, Math.min(E.cap, v)); wat = performance.now() / 1000; me.points = wp; write(wkey(w.id) + '.eco', { mode, p: wp }); };
  const spend = (c: number) => { if (mode !== 'game') return true; const b = bal(); if (b < c) { queueMicrotask(() => handler({ type: 'deny', reason: 'Не хватает очков' })); return false; } setBal(b - c); return true; };
  me.points = bal();
  let guns: GunRec[] = read<GunRec[]>(wkey(w.id) + '.aa', []).map(g => ({ ...g, x0: g.x, z0: g.z, t: -1e7, path: undefined })), nextGun = guns.reduce((m, g) => Math.max(m, g.id + 1), 1);
  const saveGuns = () => write(wkey(w.id) + '.aa', guns);
  const persist = () => { write(wkey(w.id), log.map(L => L.down ? { ...L, down: { t: L.down.t, gun: L.down.gun } } : L)); touch(w.id, log.length); };
  const roster = () => queueMicrotask(() => { me.points = bal(); handler({ type: 'players', players: [{ ...me }] }); });
  const s: Session = { online: false, me: 1, world: w.name, addr: '', now: () => performance.now() / 1000, close: () => {},
    listen: h => { handler = h; h({ type: 'welcome', you: 1, now: s.now(), world: w.name, players: [{ ...me }], launches: log.map(L => ({ ...L, t0: -1e7 })), guns, mode }); },
    send(m) {
      if (m.type === 'opStart') { queueMicrotask(() => handler({ type: 'deny', reason: 'Операция идёт через сервер: запустите программу VENOM (или npm run server) и откройте мир в ней' })); return; }
      if (m.type === 'launch') { if (me.side !== 'attack' || !(m.launch.unit in RULES.cost)) return;
        if (mode !== 'sandbox' && Math.hypot(m.launch.sx - m.launch.tx, m.launch.sz - m.launch.tz) < RULES.minRange * 0.97) { queueMicrotask(() => handler({ type: 'deny', reason: 'Слишком близко' })); return; }
        if (!spend(RULES.cost[m.launch.unit])) return; const L = m.launch; L.id = nextId++; L.by = me.name; L.pid = 1; L.t0 = s.now(); log.push({ ...L }); me.launches++; persist(); roster(); }
      else if (m.type === 'hit') { me.hits += m.buildings; roster(); return; }
      else if (m.type === 'down') { const L = log.find(x => x.id === m.id); if (!L || L.down) return; L.down = { t: m.t, gun: m.gun } as Launch['down']; me.downs++; if (mode === 'game') setBal(bal() + E.bounty * (RULES.cost[L.unit] ?? 0)); persist(); roster(); }
      else if (m.type === 'aaPlace') {
        const A = UNITS[m.unit]?.aa; if (me.side !== 'defense' || !A || guns.length >= A.max || !spend(RULES.cost[m.unit] ?? 0)) return; roster();
        const gun: GunRec = { id: nextGun++, pid: 1, by: me.name, unit: m.unit, x0: m.x, z0: m.z, x: m.x, z: m.z, t: s.now() }; guns.push(gun); saveGuns();
        queueMicrotask(() => handler({ type: 'aa', gun: { ...gun } })); return;
      }
      else if (m.type === 'aaMove') {
        const gun = guns.find(g => g.id === m.id); if (me.side !== 'defense' || !gun) return;
        gun.x0 = m.x0; gun.z0 = m.z0; gun.x = m.x; gun.z = m.z; gun.t = s.now(); gun.path = m.path; saveGuns();
        queueMicrotask(() => handler({ type: 'aa', gun: { ...gun } })); return;
      }
      else if (m.type === 'aaDel') { const gun = guns.find(g => g.id === m.id); if (me.side !== 'defense' || !gun) return; guns = guns.filter(g => g.id !== m.id); saveGuns(); if (mode === 'game') setBal(bal() + E.refund * (RULES.cost[gun.unit] ?? 0)); roster(); }
      else if (m.type === 'mode') { mode = m.mode === 'game' ? 'game' : 'sandbox'; setBal(E.start); roster(); }
      else if (m.type === 'side') { me.side = m.side; roster(); return; }
      else if (m.type === 'name') { me.name = m.name; roster(); return; }
      else if (m.type === 'reset') { log = []; me.launches = me.hits = me.downs = 0; persist(); roster(); }
      else if (m.type !== 'env') return;
      queueMicrotask(() => handler(m));
    } };
  return s;
}

// ---------- сетевая сессия ----------
export function remoteSession(addr: string, name: string): Promise<Session> {
  return new Promise((resolve, reject) => {
    let url = addr.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''); const shown = url.replace(/^wss?:\/\//, '');
    if (!/^wss?:\/\//.test(url)) url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
    if (!/:\d+/.test(url.replace(/^wss?:\/\//, '')) && !url.startsWith('wss://')) url += ':8080';
    let ws: WebSocket; try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    let offset = 0, done = false, rtt = 0, pinger = 0;
    let handler: ((m: Msg) => void) | null = null; const queue: Msg[] = []; // события до назначения обработчика не теряются
    const emit = (m: Msg) => { if (handler) handler(m); else queue.push(m); };
    const send = (m: Msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
    const s: Session = { online: true, me: 0, world: '', addr: shown, now: () => performance.now() / 1000 + offset, send,
      close: () => { clearInterval(pinger); ws.onclose = null; ws.close(); },
      listen: h => { handler = h; for (const m of queue.splice(0)) h(m); } };
    const timer = setTimeout(() => { if (!done) { ws.close(); reject(new Error('timeout')); } }, 6000);
    ws.onopen = () => send({ type: 'hello', name, side: null });
    ws.onmessage = e => {
      let m: Msg; try { m = JSON.parse(e.data) as Msg; } catch { return; }
      if (m.type === 'pong') { rtt = (performance.now() - m.t); offset += ((m.now + rtt / 2000) - s.now()) * 0.3; return; } // часы плавно подстраиваются
      if (m.type === 'welcome') {
        offset = m.now - performance.now() / 1000; s.me = m.you; s.world = m.world; done = true; clearTimeout(timer); resolve(s);
        const ping = () => send({ type: 'ping', t: performance.now(), rtt }); ping(); pinger = window.setInterval(ping, 3000);
      }
      emit(m);
    };
    ws.onerror = () => { if (!done) { clearTimeout(timer); reject(new Error('connect')); } };
    ws.onclose = () => { clearInterval(pinger); if (done) emit({ type: 'closed', reason: 'Соединение с сессией потеряно' }); else { clearTimeout(timer); reject(new Error('closed')); } };
  });
}

/** Где лежат миры: на сервере этого компьютера (программа или npm run server) либо в хранилище браузера. */
export async function worldStore(): Promise<Worlds> {
  try {
    const info = await (await fetch('./api/info', { cache: 'no-store' })).json() as { host: boolean; addrs: string[]; port: number };
    if (!info.host) return localWorlds();
    const call = async (path: string, method = 'GET', body?: unknown) => {
      const r = await fetch('./api/worlds' + path, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error('api ' + r.status); return r.json();
    };
    return {
      hosted: true, addrs: info.addrs.map(a => `${a}:${info.port}`),
      list: () => call(''), create: name => call('', 'POST', { name }), remove: async id => { await call('/' + id, 'DELETE'); },
      open: async (w, name) => { await call(`/${w.id}/open`, 'POST'); return remoteSession(location.host, name); },
    };
  } catch { return localWorlds(); }
}
