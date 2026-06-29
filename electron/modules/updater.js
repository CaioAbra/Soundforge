const { autoUpdater } = require('electron-updater');
const { isDev } = require('./constants');

function setupAutoUpdater(win) {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const sendLog = (message) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('download:log', message);
  };

  autoUpdater.on('checking-for-update', () => {
    sendLog('[INFO] Procurando atualização do Soundforge...');
  });

  autoUpdater.on('update-available', (info) => {
    sendLog(`[INFO] Atualização ${info.version} encontrada. Baixando em segundo plano...`);
  });

  autoUpdater.on('update-not-available', () => {
    sendLog('[INFO] Soundforge já está atualizado.');
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendLog(`[INFO] Atualização ${info.version} pronta. Ela será instalada ao fechar o Soundforge.`);
    if (!win || win.isDestroyed()) return;
    win.webContents.send('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    sendLog(`[AVISO] Não foi possível verificar atualização: ${err?.message || 'erro desconhecido'}.`);
  });

  win.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      sendLog(`[AVISO] Não foi possível iniciar o auto-update: ${err?.message || 'erro desconhecido'}.`);
    });
  });
}

module.exports = { setupAutoUpdater };
