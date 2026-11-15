// Обновление программы: проверяет последний релиз на GitHub, скачивает новый VENOM.exe и подменяет им текущий.
// Не зависит от Electron: версию и «выйти» получает снаружи, поэтому логику можно проверить обычным Node.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

/** v0.1.18 → [0, 1, 18]; сравнение по числам, а не по строкам. */
const parse = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

/**
 * repos — где искать релизы, по порядку (первый доступный); version — текущая версия; exe — путь к VENOM.exe
 * (у переносимой сборки — переменная PORTABLE_EXECUTABLE_FILE); quit — закрыть программу после подмены.
 */
/**
 * Windows не даёт переименовать или перезаписать запущенный exe, поэтому подмену делает помощник — командный файл:
 * ждёт, пока программа закроется и файл освободится, кладёт новый на место старого и запускает его.
 */
function swapScript(exe, tmp) {
  const q = p => p.replace(/%/g, '%%'); // знак процента в пути командный файл понял бы как переменную
  return ['@echo off', 'chcp 65001 >nul', 'set N=0', ':loop',
    `move /Y "${q(tmp)}" "${q(exe)}" >nul 2>&1`, 'if not errorlevel 1 goto ok',
    'set /a N+=1', 'if %N% GEQ 120 goto end', 'ping -n 2 127.0.0.1 >nul', 'goto loop',   // до двух минут, по попытке в секунду
    ':ok', `start "" "${q(exe)}"`, ':end', 'del "%~f0"', ''].join('\r\n');
}

function createUpdater({ repos, version, exe, quit, api = 'https://api.github.com', platform = process.platform }) {
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
        st.progress = 1;
        if (platform === 'win32') { // подмена — после выхода программы, см. swapScript
          const bat = path.join(os.tmpdir(), 'venom-update.bat'); fs.writeFileSync(bat, swapScript(exe, tmp), 'utf8');
          const child = spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }); child.on('error', () => {}); child.unref();
        } else { // там, где запущенный файл можно заменить, меняем сразу
          fs.rmSync(exe + '.old', { force: true }); fs.renameSync(exe, exe + '.old'); fs.renameSync(tmp, exe);
          const child = spawn(exe, [], { detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref();
        }
        st.state = 'restarting';
        setTimeout(quit, 800);
      } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* нечего удалять */ } st.state = 'error'; st.error = String(e && e.message || e); }
    })();
    return st;
  }
  return { check, install, status: () => st };
}
module.exports = { createUpdater, newer, swapScript };
