// Настройки игрока: ник, звук, масштаб интерфейса, клавиши, быстрая панель. Хранятся в браузере/программе.
import { Side } from './units';

/** Действие → [название, клавиша по умолчанию]. Клавиши — физические коды (не зависят от раскладки). */
export const ACTIONS: Record<string, [string, string]> = {
  fwd: ['Камера вперёд', 'KeyW'], back: ['Камера назад', 'KeyS'], left: ['Камера влево', 'KeyA'], right: ['Камера вправо', 'KeyD'],
  fast: ['Быстрое движение', 'ShiftLeft'],
  rotL: ['Поворот влево', 'KeyQ'], rotR: ['Поворот вправо', 'KeyE'], tiltUp: ['Наклон вверх', 'KeyR'], tiltDown: ['Наклон вниз', 'KeyF'],
  zoomIn: ['Приблизить', 'KeyZ'], zoomOut: ['Отдалить', 'KeyX'],
  map: ['Тактическая карта', 'KeyM'], players: ['Список игроков', 'Tab'], arsenal: ['Панель арсенала', 'KeyB'],
  side: ['Сменить сторону', 'KeyT'], follow: ['Следить за ближайшей целью', 'KeyG'], hud: ['Скрыть интерфейс', 'KeyH'],
};

export interface Settings {
  nick: string; volume: number; uiScale: number; perf: boolean; minimap: boolean; addr: string;
  keys: Record<string, string>;
  quick: Record<Side, (string | null)[]>;
  known: string[]; // юниты, которые уже предлагались на быструю панель
}
const DEF: Settings = { nick: '', volume: 0.7, uiScale: 1, perf: true, minimap: true, addr: '', keys: {}, quick: { attack: ['geran2'], defense: [] }, known: ['geran2'] };

export const S: Settings = (() => {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem('venom.settings') || '{}'); } catch { /* нет доступа к хранилищу */ }
  const out = { ...DEF, ...s, keys: { ...s.keys }, quick: { attack: [...(s.quick?.attack ?? DEF.quick.attack)], defense: [...(s.quick?.defense ?? [])] } };
  for (const [a, [, code]] of Object.entries(ACTIONS)) out.keys[a] ??= code;
  out.known = [...(s.known ?? DEF.known)];
  for (const id of ['geran5']) if (!out.known.includes(id)) { // новый юнит обновления — один раз в первый свободный слот
    out.known.push(id); if (!out.quick.attack.includes(id)) { const i = out.quick.attack.findIndex(q => !q); if (i >= 0) out.quick.attack[i] = id; else if (out.quick.attack.length < 9) out.quick.attack.push(id); }
  }
  return out;
})();
export function saveSettings() { try { localStorage.setItem('venom.settings', JSON.stringify(S)); } catch { /* ignore */ } }

/** Нажата ли клавиша действия. */
export const isKey = (e: KeyboardEvent, action: string) => e.code === S.keys[action];

const NAMES: Record<string, string> = { ShiftLeft: 'Shift', ShiftRight: 'Shift пр.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl пр.', AltLeft: 'Alt', AltRight: 'Alt пр.', Space: 'Пробел', Tab: 'Tab', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Caps' };
export const keyName = (code: string) => NAMES[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');

export function applyUiScale() { document.documentElement.style.setProperty('--ui', String(S.uiScale)); }
