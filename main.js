const { app, BrowserWindow, ipcMain, dialog, nativeImage, Tray, Menu, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Pitaya Core: dane w ~/.config/Pitayas/Media, ustawienia, logi, aktualizacje, rejestr dla huba
const core = require('./core').create({
  id: 'media',
  folder: 'Media',
  name: 'Pitayas Media',
  repo: 'Pitayas-Team/Pitayas-Media',
  appDir: __dirname,
  defaults: { port: 8193, downloadDir: '', format: 'mp4', height: 1080 },
});
const { createEngine } = require('./engine');
const { createServer } = require('./server');

// ffmpeg dołączony do aplikacji (w paczce leży poza app.asar)
let ffmpeg = 'ffmpeg';
try { ffmpeg = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked'); } catch {}

const downloadDir = () => core.settings.get('downloadDir') || path.join(app.getPath('downloads'), 'Pitayas Media');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let server = null;
let serverError = '';
let pushTimer = null;
const notified = new Set();

const engine = createEngine({
  dataDir: core.paths.data,
  ffmpeg,
  getDownloadDir: downloadDir,
  log: core.log,
  onChange: () => {
    // Okno dostaje listę najwyżej 4× na sekundę
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const jobs = engine.list();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media:jobs', jobs);
      core.setStatus({ port: core.settings.get('port'), active: engine.active(), jobs: jobs.length });
      for (const j of jobs) {
        if (j.state === 'done' && !notified.has(j.id) && Date.now() - j.createdAt < 24 * 3600 * 1000) {
          notified.add(j.id);
          if (Notification.isSupported() && !(mainWindow && mainWindow.isFocused())) {
            new Notification({ title: 'Pitayas Media — pobrano', body: j.file || j.title }).show();
          }
        }
      }
    }, 250);
  },
});
engine.list().forEach((j) => notified.add(j.id));

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const info = async () => ({
  app: 'media', name: 'Pitayas Media', version: app.getVersion(), ytdlp: engine.hasYtdlp(), active: engine.active(),
});

function startServer() {
  const port = Number(core.settings.get('port')) || 8193;
  if (server) server.close();
  serverError = '';
  server = createServer({ engine, info, log: core.log });
  server.on('error', (err) => {
    serverError = err.code === 'EADDRINUSE' ? `Port ${port} jest zajęty — zmień go w ustawieniach` : err.message;
    core.log.error('Serwer:', serverError);
    if (mainWindow) mainWindow.webContents.send('media:server', serverInfo());
  });
  server.listen(port, '0.0.0.0', () => {
    core.log.info(`Serwer dla telefonu: port ${port}`);
    core.setStatus({ port, active: engine.active() });
    if (mainWindow) mainWindow.webContents.send('media:server', serverInfo());
  });
}

const serverInfo = () => ({ port: Number(core.settings.get('port')) || 8193, addresses: addresses(), error: serverError });

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quit() {
  isQuitting = true;
  engine.cancelAll();
  app.quit();
}

function appIcon() {
  const p = path.join(__dirname, 'icon.png');
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : null;
}

function createWindow() {
  const icon = appIcon();
  mainWindow = new BrowserWindow({
    width: 760,
    height: 780,
    minWidth: 600,
    minHeight: 600,
    frame: false,
    title: 'Pitayas Media',
    backgroundColor: '#121116',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload wczytuje core/bridge.js
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // Zamknięcie okna chowa je do zasobnika — telefon dalej może zlecać pobieranie
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (!tray && icon) {
    tray = new Tray(icon.resize({ width: 22, height: 22 }));
    tray.setToolTip('Pitayas Media');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Otwórz Pitayas Media', click: showWindow },
      { label: 'Otwórz folder pobranych', click: () => { fs.mkdirSync(downloadDir(), { recursive: true }); shell.openPath(downloadDir()); } },
      { type: 'separator' },
      { label: 'Zamknij aplikację całkowicie', click: quit },
    ]));
    tray.on('click', () => (mainWindow.isVisible() ? mainWindow.hide() : showWindow()));
  }
}

if (core.singleInstance(showWindow)) {
  core.registerIpc({ beforeRestart: () => { isQuitting = true; engine.cancelAll(); } });
  // Hub i inne aplikacje Pitayas mogą zlecać pobieranie: core.send('media', 'download', { type: 'ytdlp', url })
  core.control.handle('download', (args) => engine.add(args || {}).id);
  core.control.handle('jobs', () => engine.list());
  core.onQuit(() => { engine.cancelAll(); if (server) server.close(); });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.pitayas.media');
    createWindow();
    startServer();
    // yt-dlp w tle przy pierwszym uruchomieniu, żeby pierwszy link nie czekał
    if (!engine.hasYtdlp()) engine.ensureYtdlp().catch((err) => core.log.warn('yt-dlp:', err.message));
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

// ───── Okno ─────
ipcMain.on('pitaya:win-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('pitaya:win-close', () => mainWindow && mainWindow.hide());
ipcMain.on('app-quit', quit);

ipcMain.handle('media:state', () => ({
  jobs: engine.list(), server: serverInfo(), downloadDir: downloadDir(),
  format: core.settings.get('format'), height: core.settings.get('height'),
}));
ipcMain.handle('media:analyze', (e, url) => engine.analyze(url));
ipcMain.handle('media:add', (e, job) => {
  if (job.type === 'ytdlp') core.settings.set({ format: job.format, height: job.height || core.settings.get('height') });
  return engine.add(job).id;
});
ipcMain.handle('media:cancel', (e, id) => engine.cancel(id));
ipcMain.handle('media:remove', (e, id) => engine.remove(id));
ipcMain.handle('media:open-file', (e, id) => {
  const j = engine.get(id);
  if (j && j.output && fs.existsSync(j.output)) shell.showItemInFolder(j.output);
});
ipcMain.handle('media:open-dir', () => {
  fs.mkdirSync(downloadDir(), { recursive: true });
  return shell.openPath(downloadDir());
});
ipcMain.handle('media:choose-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: downloadDir(), title: 'Folder na pobrane pliki' });
  if (r.canceled || !r.filePaths.length) return downloadDir();
  core.settings.set('downloadDir', r.filePaths[0]);
  return r.filePaths[0];
});
ipcMain.handle('media:set-port', (e, port) => {
  port = parseInt(port, 10);
  if (!(port > 1023 && port < 65536)) throw new Error('Port: 1024–65535');
  core.settings.set('port', port);
  startServer();
  return serverInfo();
});
ipcMain.handle('media:ytdlp-version', () => engine.ytdlpVersion().catch((err) => `błąd: ${err.message}`));
ipcMain.handle('media:ytdlp-update', () => engine.updateYtdlp());
