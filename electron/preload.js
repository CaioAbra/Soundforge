const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soundforge', {
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  getSpotifyPreview: (payload) => ipcRenderer.invoke('spotify:preview', payload),
  startDownload: (payload) => ipcRenderer.send('download:start', payload),
  onLog: (cb) => ipcRenderer.on('download:log', (_, data) => cb(data)),
  onProgress: (cb) => ipcRenderer.on('download:progress', (_, data) => cb(data)),
  onComplete: (cb) => ipcRenderer.on('download:complete', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('download:error', (_, data) => cb(data))
});
