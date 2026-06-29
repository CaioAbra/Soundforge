const { contextBridge, ipcRenderer } = require('electron');

// Helper: registra listener e retorna função de cleanup para evitar vazamento de memória
const on = (channel, cb) => {
  const handler = (_, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('soundforge', {
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getToolsStatus: () => ipcRenderer.invoke('tools:status'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  saveSpotifyClientId: (clientId) => ipcRenderer.invoke('settings:save-spotify-client-id', clientId),
  saveSpotifyToken: (token) => ipcRenderer.invoke('settings:save-spotify-token', token),
  clearSpotifyToken: () => ipcRenderer.invoke('settings:clear-spotify-token'),
  connectSpotify: (clientId) => ipcRenderer.invoke('spotify:connect', clientId),
  startSpotifyLogin: (clientId) => ipcRenderer.invoke('spotify:start-login', clientId),
  testSpotifyConnection: (token) => ipcRenderer.invoke('spotify:test-connection', token),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  disconnectSpotify: () => ipcRenderer.invoke('spotify:disconnect'),
  getSpotifyPreview: (payload) => ipcRenderer.invoke('spotify:preview', payload),
  startDownload: (payload) => ipcRenderer.send('download:start', payload),
  pauseDownload: () => ipcRenderer.invoke('download:pause'),
  resumeDownload: () => ipcRenderer.invoke('download:resume'),
  restartAndInstallUpdate: () => ipcRenderer.invoke('update:restart-and-install'),

  // Cada método retorna uma função de cleanup: const unsub = soundforge.onLog(cb); unsub();
  onLog: (cb) => on('download:log', cb),
  onToolsStatus: (cb) => on('tools:status', cb),
  onProgress: (cb) => on('download:progress', cb),
  onPauseState: (cb) => on('download:pause-state', cb),
  onTrackComplete: (cb) => on('download:track-complete', cb),
  onTrackSkipped: (cb) => on('download:track-skipped', cb),
  onComplete: (cb) => on('download:complete', cb),
  onError: (cb) => on('download:error', cb),
  onSpotifyAuthComplete: (cb) => on('spotify:auth-complete', cb),
  onUpdateDownloaded: (cb) => on('update:downloaded', cb)
});
