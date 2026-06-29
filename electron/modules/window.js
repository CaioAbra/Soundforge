const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { isDev, APP_PROTOCOL } = require('./constants');
const { handleSpotifyProtocolUrl } = require('./spotify');
const { warmUpTools } = require('./tools');

let mainWindow = null;
const DEV_SERVER_URL = 'http://localhost:5173';

function getMainWindow() {
  return mainWindow;
}

function isAllowedAppUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (isDev) return parsed.origin === DEV_SERVER_URL;
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

function resolveAppIconPath() {
  const devIcon = path.join(app.getAppPath(), 'resources', 'logo_soundforge.png');
  if (fs.existsSync(devIcon)) return devIcon;
  const prodIcon = path.join(process.resourcesPath || '', 'logo_soundforge.png');
  if (fs.existsSync(prodIcon)) return prodIcon;
  return undefined;
}

function createWindow() {
  const icon = resolveAppIconPath();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f0b07',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: isDev
    }
  });

  if (isDev) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  win.setMenuBarVisibility(false);
  mainWindow = win;

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedAppUrl(targetUrl)) event.preventDefault();
  });

  win.webContents.once('did-finish-load', () => {
    warmUpTools(win);
  });

  return win;
}

function registerAppProtocol() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
    return;
  }
  app.setAsDefaultProtocolClient(APP_PROTOCOL);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function handleSpotifyProtocolFromArgv(argv = []) {
  const callbackUrl = argv.find(
    (arg) => typeof arg === 'string' && arg.startsWith(`${APP_PROTOCOL}://spotify/callback?`)
  );
  if (callbackUrl) handleSpotifyProtocolUrl(callbackUrl);
}

module.exports = {
  getMainWindow,
  createWindow,
  registerAppProtocol,
  focusMainWindow,
  isAllowedAppUrl,
  handleSpotifyProtocolFromArgv
};
