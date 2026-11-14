// Отдельная программа: поднимает сервер сессии у себя и открывает игру в окне.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.whenReady().then(async () => {
  await import(pathToFileURL(path.join(__dirname, '..', 'server', 'server.mjs')).href);
  const win = new BrowserWindow({ width: 1600, height: 900, autoHideMenuBar: true, backgroundColor: '#0b0e11', title: 'VENOM' });
  win.maximize();
  win.loadURL(`http://localhost:${process.env.PORT || 8080}/`);
});
app.on('window-all-closed', () => app.quit());
