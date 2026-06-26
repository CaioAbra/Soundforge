const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soundforge', {
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSpotifyClientId: (clientId) => ipcRenderer.invoke('settings:save-spotify-client-id', clientId),
  saveSpotifyToken: (token) => ipcRenderer.invoke('settings:save-spotify-token', token),
  clearSpotifyToken: () => ipcRenderer.invoke('settings:clear-spotify-token'),
  connectSpotify: (clientId) => ipcRenderer.invoke('spotify:connect', clientId),
  startSpotifyLogin: (clientId) => ipcRenderer.invoke('spotify:start-login', clientId),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  disconnectSpotify: () => ipcRenderer.invoke('spotify:disconnect'),
  getSpotifyPreview: (payload) => ipcRenderer.invoke('spotify:preview', payload),
  startDownload: (payload) => ipcRenderer.send('download:start', payload),
  pauseDownload: () => ipcRenderer.invoke('download:pause'),
  resumeDownload: () => ipcRenderer.invoke('download:resume'),
  onLog: (cb) => ipcRenderer.on('download:log', (_, data) => cb(data)),
  onProgress: (cb) => ipcRenderer.on('download:progress', (_, data) => cb(data)),
  onPauseState: (cb) => ipcRenderer.on('download:pause-state', (_, data) => cb(data)),
  onTrackComplete: (cb) => ipcRenderer.on('download:track-complete', (_, data) => cb(data)),
  onTrackSkipped: (cb) => ipcRenderer.on('download:track-skipped', (_, data) => cb(data)),
  onComplete: (cb) => ipcRenderer.on('download:complete', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('download:error', (_, data) => cb(data)),
  onSpotifyAuthComplete: (cb) => ipcRenderer.on('spotify:auth-complete', (_, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_, data) => cb(data)),
  restartAndInstallUpdate: () => ipcRenderer.invoke('update:restart-and-install')
});
