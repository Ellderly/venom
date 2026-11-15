// Отдельная программа: поднимает сервер сессии у себя и открывает игру в окне.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createUpdater } = require('./updater.cjs');
const pkg = require('../package.json');

app.whenReady().then(async () => {
  process.env.VENOM_SAVE = path.join(app.getPath('userData'), 'venom-save.json'); // %APPDATA%\\VENOM, старый формат
  process.env.VENOM_WORLDS = path.join(app.getPath('userData'), 'worlds');
  // обновление: сервер игры отдаёт его состояние странице меню через /api/update
  globalThis.venomUpdater = createUpdater({ repos: pkg.venom.updates, version: app.getVersion(), exe: process.env.PORTABLE_EXECUTABLE_FILE || '', quit: () => app.quit() });
  const { ready } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'server.mjs')).href);
  const port = await ready;
  await session.defaultSession.clearCache(); // после обновления не должна открываться старая версия
  const win = new BrowserWindow({ width: 1600, height: 900, autoHideMenuBar: true, backgroundColor: '#0b0e11', title: 'VENOM' });
  win.maximize();
  win.loadURL(`http://localhost:${port}/`);
});
app.on('window-all-closed', () => app.quit());
