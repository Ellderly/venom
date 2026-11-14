// Сессия: одиночная (всё локально) или сетевая (сервер рассылает события всем игрокам).
import { Launch } from './sim';

export type Msg =
  | { type: 'welcome'; you: string; now: number; players: number; launches: Launch[]; env: { hour: number; speed: number } }
  | { type: 'players'; players: number }
  | { type: 'launch'; launch: Launch }
  | { type: 'env'; hour: number; speed: number }
  | { type: 'reset' };

export interface Session {
  online: boolean; me: string;
  now(): number;                               // общие часы сессии, с
  send(m: Msg): void;
  /** Назначить обработчик входящих событий. */
  listen(h: (m: Msg) => void): void;
  close(): void;
}

export function localSession(): Session {
  let handler: (m: Msg) => void = () => {};
  const s: Session = { online: false, me: 'я', now: () => performance.now() / 1000, close: () => {}, listen: h => { handler = h; },
    send(m) { if (m.type === 'launch') m.launch.t0 = s.now(); queueMicrotask(() => handler(m)); } };
  return s;
}

export function remoteSession(addr: string): Promise<Session> {
  return new Promise((resolve, reject) => {
    let url = addr.trim(); if (!/^wss?:\/\//.test(url)) url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
    if (!/:\d+/.test(url.replace(/^wss?:\/\//, '')) && !url.startsWith('wss://')) url += ':8080';
    let ws: WebSocket; try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    let offset = 0, done = false;
    let handler: ((m: Msg) => void) | null = null; const queue: Msg[] = []; // события до назначения обработчика не теряются
    const emit = (m: Msg) => { if (handler) handler(m); else queue.push(m); };
    const s: Session = { online: true, me: '', now: () => performance.now() / 1000 + offset, close: () => ws.close(), send: m => ws.send(JSON.stringify(m)),
      listen: h => { handler = h; for (const m of queue.splice(0)) h(m); } };
    const timer = setTimeout(() => { if (!done) { ws.close(); reject(new Error('timeout')); } }, 6000);
    ws.onmessage = e => {
      const m = JSON.parse(e.data) as Msg;
      if (m.type === 'welcome') { offset = m.now - performance.now() / 1000; s.me = m.you; done = true; clearTimeout(timer); resolve(s); }
      emit(m);
    };
    ws.onerror = () => { if (!done) { clearTimeout(timer); reject(new Error('connect')); } };
    ws.onclose = () => { if (done) emit({ type: 'players', players: -1 }); };
  });
}
