// Обновление программы: проверяет последний релиз на GitHub, скачивает новый VENOM.exe и подменяет им текущий.
// Не зависит от Electron: версию и «выйти» получает снаружи, поэтому логику можно проверить обычным Node.
const fs = require('node:fs');
const { spawn } = require('node:child_process');

/** v0.1.18 → [0, 1, 18]; сравнение по числам, а не по строкам. */
const parse = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

/**
 * repos — где искать релизы, по порядку (первый доступный); version — текущая версия; exe — путь к VENOM.exe
 * (у переносимой сборки — переменная PORTABLE_EXECUTABLE_FILE); quit — закрыть программу после подмены.
 */
function createUpdater({ repos, version, exe, quit, api = 'https://api.github.com' }) {
  const st = { current: version, latest: null, notes: '', size: 0, available: false, canInstall: !!exe, state: 'idle', progress: 0, error: '' };
  let asset = null, checked = 0;
  try { if (exe) fs.rmSync(exe + '.old', { force: true }); } catch { /* старая копия ещё занята — удалится в следующий раз */ }

  async function check(force = false) {
    if (!force && Date.now() - checked < 10 * 60 * 1000) return st; checked = Date.now();
    for (const repo of repos) {
      try {
        const r = await fetch(`${api}/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'venom-updater', Accept: 'application/vnd.github+json' } });
        if (!r.ok) continue; // закрытый репозиторий без входа отвечает 404 — пробуем следующий
        const rel = await r.json(), a = (rel.assets || []).find(x => /\.exe$/i.test(x.name));
        st.latest = String(rel.tag_name || '').replace(/^v/, ''); st.notes = String(rel.body || '').slice(0, 4000);
        asset = a ? { url: a.browser_download_url, size: a.size } : null; st.size = a ? a.size : 0;
        st.available = !!a && newer(st.latest, version); if (st.state === 'error') { st.state = 'idle'; st.error = ''; }
        return st;
      } catch { /* нет сети — пробуем следующий */ }
    }
    st.available = false; return st;
  }

  async function install() {
    if (st.state === 'downloading' || st.state === 'restarting') return st;
    if (!exe) { st.state = 'error'; st.error = 'Обновление работает только в программе VENOM.exe'; return st; }
    await check(true); if (!st.available || !asset) { st.state = 'error'; st.error = 'Новая версия не найдена'; return st; }
    st.state = 'downloading'; st.progress = 0; st.error = '';
    const tmp = exe + '.new';
    (async () => {
      try {
        const r = await fetch(asset.url, { headers: { 'User-Agent': 'venom-updater' } }); if (!r.ok || !r.body) throw new Error('Не удалось скачать: ' + r.status);
        const out = fs.createWriteStream(tmp); let got = 0;
        for await (const chunk of r.body) { got += chunk.length; st.progress = asset.size ? got / asset.size : 0; if (!out.write(chunk)) await new Promise(res => out.once('drain', res)); }
        await new Promise((res, rej) => { out.on('error', rej); out.end(res); });
        if (asset.size && got !== asset.size) throw new Error('Файл скачан не полностью');
        // запущенный exe в Windows нельзя перезаписать, но можно переименовать: старый — в .old, новый — на его место
        fs.rmSync(exe + '.old', { force: true }); fs.renameSync(exe, exe + '.old'); fs.renameSync(tmp, exe);
        st.state = 'restarting'; st.progress = 1;
        const child = spawn(exe, [], { detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref(); // не запустилась — пользователь откроет сам, файл уже новый
        setTimeout(quit, 800);
      } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* нечего удалять */ } st.state = 'error'; st.error = String(e && e.message || e); }
    })();
    return st;
  }
  return { check, install, status: () => st };
}
module.exports = { createUpdater, newer };
