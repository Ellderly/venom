// Общие мелочи интерфейса: доступ к элементам, окна, настройки, справка.
import { PRESETS, loadQualityName, saveQualityName } from './quality';
import { S, saveSettings, ACTIONS, keyName, applyUiScale } from './settings';
import type { Sound } from './audio';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const fmt = (s: number) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function el(tag: string, cls = '', html = '') { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }

export interface Modal { root: HTMLElement; close(): void; q<T extends HTMLElement = HTMLElement>(sel: string): T }
/** Окно поверх игры. locked — нельзя закрыть щелчком мимо и клавишей Esc. */
export function modal(html: string, opts: { cls?: string; id?: string; locked?: boolean; onClose?: () => void } = {}): Modal {
  const m = el('div', 'modal', `<div class="panel ${opts.cls ?? ''}">${html}</div>`); if (opts.id) m.id = opts.id; if (opts.locked) m.dataset.locked = '1';
  const close = () => { if (m.isConnected) { m.remove(); opts.onClose?.(); } };
  (m as any)._close = close;
  m.addEventListener('pointerdown', e => { if (e.target === m && !opts.locked) close(); });
  m.querySelectorAll('[data-close]').forEach(b => (b as HTMLElement).onclick = close);
  $('modals').append(m);
  return { root: m, close, q: sel => m.querySelector(sel) as any };
}
export const topModal = () => $('modals').lastElementChild as HTMLElement | null;
/** Закрывает верхнее окно; false — закрывать нечего или окно заперто. */
export function closeTopModal() { const m = topModal(); if (!m || m.dataset.locked) return false; (m as any)._close(); return true; }

export function showHelp() {
  const k = (a: string) => `<kbd>${esc(keyName(S.keys[a]))}</kbd>`;
  modal(`<h2>Как играть</h2>
    <p class="note" style="max-width:560px">После входа выберите сторону. <b class="atk">Атака</b> запускает цели по городу. <b class="def">Оборона</b> расставляет огневые группы ПВО (клик по юниту, затем по карте; клик по метке группы — перегнать или снять) и получает оповещения — средства ПВО появятся на следующем этапе. Сторону можно сменить в любой момент: кнопка стороны вверху, ${k('side')} или «Меню».</p>
    <table class="help">
    <tr><td>${k('fwd')}${k('left')}${k('back')}${k('right')} / стрелки</td><td>движение камеры (${k('fast')} — быстрее)</td></tr>
    <tr><td>Левая кнопка + тянуть</td><td>перетаскивание карты</td></tr>
    <tr><td>Правая / средняя кнопка + тянуть</td><td>поворот и наклон</td></tr>
    <tr><td>Колесо, ${k('zoomIn')} / ${k('zoomOut')}</td><td>приближение и отдаление (до вида на весь регион)</td></tr>
    <tr><td>${k('rotL')} / ${k('rotR')}, ${k('tiltUp')} / ${k('tiltDown')}</td><td>поворот, наклон</td></tr>
    <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>быстрая панель (перетащите туда юнит из арсенала, правый клик — убрать)</td></tr>
    <tr><td>${k('map')}</td><td>тактическая карта: обстановка и планирование налёта</td></tr>
    <tr><td>${k('players')} (держать)</td><td>кто на сервере</td></tr>
    <tr><td>${k('follow')}</td><td>камера следит за ближайшей целью</td></tr>
    <tr><td>${k('arsenal')} / ${k('hud')}</td><td>свернуть арсенал / скрыть интерфейс</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>отмена, закрыть окно, меню</td></tr></table>
    <h3>Запуск «Герани-2»</h3>
    <p>1. Выберите сторону «Атака» и юнит в арсенале или на быстрой панели.<br>2. Задайте время подлёта и количество.<br>3. Кликните по цели в городе, затем — откуда она прилетит. То же можно сделать на тактической карте.</p>
    <button data-close>Закрыть</button>`);
}

export function showSettings(sound: Sound, onChange: () => void) {
  const qName = loadQualityName();
  const m = modal(`<div class="form"><h2>Настройки</h2>
    <h3>Графика</h3>
    <label>Качество <select id="sq">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}" ${k === qName ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
    <p class="note">Смена качества перезагружает игру. При просадке кадров разрешение картинки снижается автоматически.</p>
    <label>Счётчик кадров <input type="checkbox" id="sp" ${S.perf ? 'checked' : ''}></label>
    <h3>Звук</h3>
    <label>Громкость <input type="range" id="sv" min="0" max="1" step="0.05" value="${S.volume}"></label>
    <p class="note">${sound.recorded ? `Загружено записей: ${sound.recorded}. Остальное синтезируется.` : 'Записей в папке sounds/ нет — весь звук синтезируется.'}</p>
    <h3>Интерфейс</h3>
    <label>Масштаб <span><b id="suv">${Math.round(S.uiScale * 100)}%</b> <input type="range" id="su" min="0.8" max="1.6" step="0.05" value="${S.uiScale}"></span></label>
    <label>Мини-карта <input type="checkbox" id="sm" ${S.minimap ? 'checked' : ''}></label>
    <h3>Управление</h3>
    <div class="keys" id="sk"></div>
    <p class="note">Нажмите на клавишу, затем на новую. Стрелки всегда двигают камеру, <kbd>1</kbd>–<kbd>9</kbd> — быстрая панель, <kbd>Esc</kbd> — отмена.</p>
    <button id="skr">Клавиши по умолчанию</button> <button data-close>Закрыть</button></div>`, { onClose: () => { window.removeEventListener('keydown', grab, true); saveSettings(); onChange(); } });
  let waiting: string | null = null;
  const keys = () => { m.q('#sk').innerHTML = Object.entries(ACTIONS).map(([a, [label]]) => `<label>${label} <button data-a="${a}">${waiting === a ? '…' : esc(keyName(S.keys[a]))}</button></label>`).join(''); m.root.querySelectorAll('#sk button').forEach(b => (b as HTMLElement).onclick = () => { waiting = (b as HTMLElement).dataset.a!; keys(); }); };
  const grab = (e: KeyboardEvent) => {
    if (!waiting) return; e.preventDefault(); e.stopPropagation();
    if (e.code !== 'Escape' && !/^Digit[1-9]$/.test(e.code)) {
      for (const a of Object.keys(S.keys)) if (S.keys[a] === e.code) S.keys[a] = S.keys[waiting]; // занятая клавиша меняется местами
      S.keys[waiting] = e.code;
    }
    waiting = null; keys();
  };
  window.addEventListener('keydown', grab, true); keys();
  m.q('#skr').onclick = () => { for (const [a, [, code]] of Object.entries(ACTIONS)) S.keys[a] = code; keys(); };
  m.q<HTMLSelectElement>('#sq').onchange = e => { saveQualityName((e.target as HTMLSelectElement).value); saveSettings(); location.reload(); };
  m.q<HTMLInputElement>('#sv').oninput = e => { S.volume = Number((e.target as HTMLInputElement).value); sound.setVolume(S.volume); };
  m.q<HTMLInputElement>('#su').oninput = e => { S.uiScale = Number((e.target as HTMLInputElement).value); m.q('#suv').textContent = Math.round(S.uiScale * 100) + '%'; };
  m.q<HTMLInputElement>('#su').onchange = () => applyUiScale(); // применяем по отпусканию, чтобы ползунок не убегал из-под курсора
  m.q<HTMLInputElement>('#sp').onchange = e => { S.perf = (e.target as HTMLInputElement).checked; onChange(); };
  m.q<HTMLInputElement>('#sm').onchange = e => { S.minimap = (e.target as HTMLInputElement).checked; onChange(); };
}
