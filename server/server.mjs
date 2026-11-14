// Сервер сессии: раздаёт собранную игру (dist/) и рассылает события между игроками.
// Запуск: npm run build && npm run server   → друзья открывают http://АДРЕС_ХОСТА:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DIST, path.normalize(p));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Не найдено. Сначала выполните: npm run build'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});

const t0 = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - t0) / 1e9;
let launches = [], nextId = 1, nextPlayer = 1;
let env = { hour: 15, speed: 10, at: now() };
const hourNow = () => (env.hour + (now() - env.at) * env.speed / 3600) % 24;

const NUM = ['sx', 'sz', 'tx', 'tz', 'seed', 'cruiseY', 'dur', 'impactT', 'ix', 'iy', 'iz', 'building'];
const validLaunch = L => L && typeof L.unit === 'string' && L.unit.length < 32 && NUM.every(k => Number.isFinite(L[k]));

const wss = new WebSocketServer({ server });
const broadcast = m => { const s = JSON.stringify(m); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };

wss.on('connection', ws => {
  const you = 'Игрок ' + nextPlayer++;
  ws.send(JSON.stringify({ type: 'welcome', you, now: now(), players: wss.clients.size, launches, env: { hour: hourNow(), speed: env.speed } }));
  broadcast({ type: 'players', players: wss.clients.size });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'launch' && validLaunch(m.launch) && launches.length < 5000) {
      const L = m.launch; L.id = nextId++; L.by = you; L.t0 = now() + 0.25; // небольшой запас, чтобы у всех старт был одновременным
      launches.push(L); broadcast({ type: 'launch', launch: L });
    } else if (m.type === 'env') { env = { hour: Number(m.hour) || 0, speed: Number(m.speed) || 0, at: now() }; broadcast({ type: 'env', hour: env.hour, speed: env.speed }); }
    else if (m.type === 'reset') { launches = []; broadcast({ type: 'reset' }); }
  });
  ws.on('close', () => broadcast({ type: 'players', players: wss.clients.size }));
});

server.on('error', e => console.error(e.code === 'EADDRINUSE' ? `Порт ${PORT} занят: сессия уже запущена на этом компьютере.` : e));
server.listen(PORT, () => console.log(`VENOM: сессия запущена, порт ${PORT}. Откройте http://localhost:${PORT}`));
