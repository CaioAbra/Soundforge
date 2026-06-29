const { app, Menu, session } = require('electron');
const { isDev } = require('./modules/constants');
const { createWindow, registerAppProtocol, focusMainWindow, handleSpotifyProtocolFromArgv } = require('./modules/window');
const { setupAutoUpdater } = require('./modules/updater');
const { registerIpcHandlers } = require('./modules/ipc-handlers');

function denyPermissionRequests() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

// ── Single instance ───────────────────────────────────────────────────────────
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    handleSpotifyProtocolFromArgv(argv);
    focusMainWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    const { handleSpotifyProtocolUrl } = require('./modules/spotify');
    handleSpotifyProtocolUrl(url);
    focusMainWindow();
  });

  // ── Startup ─────────────────────────────────────────────────────────────────
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('com.caioabra.soundforge');

    // Content Security Policy
    const cspPolicy = isDev
      ? [
          "default-src 'self' http://localhost:5173",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob: https:",
          "connect-src 'self' http://localhost:5173 ws://localhost:5173",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
          "frame-src 'none'",
          "child-src 'none'",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
          "media-src 'none'",
          "script-src-attr 'none'"
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
          "frame-src 'none'",
          "child-src 'none'",
          "worker-src 'none'",
          "manifest-src 'self'",
          "media-src 'none'",
          "script-src-attr 'none'"
        ].join('; ');

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [cspPolicy] } });
    });
    denyPermissionRequests();

    registerAppProtocol();
    registerIpcHandlers();

    const win = createWindow();
    setupAutoUpdater(win);
    handleSpotifyProtocolFromArgv(process.argv);

    app.on('activate', () => {
      if (require('electron').BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
