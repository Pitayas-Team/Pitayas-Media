const { contextBridge, ipcRenderer } = require('electron');
const { makeBridge } = require('./core/bridge');

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('media:state'),
  analyze: (url) => ipcRenderer.invoke('media:analyze', url),
  add: (job) => ipcRenderer.invoke('media:add', job),
  cancel: (id) => ipcRenderer.invoke('media:cancel', id),
  remove: (id) => ipcRenderer.invoke('media:remove', id),
  openFile: (id) => ipcRenderer.invoke('media:open-file', id),
  openDir: () => ipcRenderer.invoke('media:open-dir'),
  chooseDir: () => ipcRenderer.invoke('media:choose-dir'),
  setPort: (port) => ipcRenderer.invoke('media:set-port', port),
  ytdlpVersion: () => ipcRenderer.invoke('media:ytdlp-version'),
  ytdlpUpdate: () => ipcRenderer.invoke('media:ytdlp-update'),
  onJobs: (cb) => ipcRenderer.on('media:jobs', (e, jobs) => cb(jobs)),
  onServer: (cb) => ipcRenderer.on('media:server', (e, s) => cb(s)),
  quit: () => ipcRenderer.send('app-quit'),
});

// Pasek okna, ustawienia, folder danych i aktualizacje — wspólne z innymi aplikacjami (Pitaya Core)
contextBridge.exposeInMainWorld('pitayaBridge', makeBridge(ipcRenderer));
