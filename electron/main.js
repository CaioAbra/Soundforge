const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const iconv = require('iconv-lite');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
const SPOTIFY_TRACK_SOURCES = [
  { label: 'YouTube', inputPrefix: 'ytsearch1' },
  { label: 'SoundCloud', inputPrefix: 'scsearch1' },
  { label: 'Google Video', inputPrefix: 'gvsearch1' },
  { label: 'Yahoo Video', inputPrefix: 'yvsearch1' }
];

function resolveAppIconPath() {
  const devIcon = path.join(app.getAppPath(), 'resources', 'logo_soundforge.png');
  if (fs.existsSync(devIcon)) return devIcon;

  const prodIcon = path.join(process.resourcesPath || '', 'logo_soundforge.png');
  if (fs.existsSync(prodIcon)) return prodIcon;

  return undefined;
}

const downloadPause = {
  active: false,
  pauseRequested: false,
  paused: false,
  resume: null,
  sender: null
};

function sendPauseState(state) {
  if (!downloadPause.sender || downloadPause.sender.isDestroyed()) return;
  downloadPause.sender.send('download:pause-state', { state });
}

function resetPauseState(sender = null) {
  if (downloadPause.resume) {
    downloadPause.resume();
  }
  downloadPause.active = Boolean(sender);
  downloadPause.pauseRequested = false;
  downloadPause.paused = false;
  downloadPause.resume = null;
  downloadPause.sender = sender;
  if (sender && !sender.isDestroyed()) {
    sender.send('download:pause-state', { state: 'running' });
  }
}

async function waitIfPaused(event) {
  if (!downloadPause.pauseRequested) return;

  downloadPause.paused = true;
  event.sender.send('download:pause-state', { state: 'paused' });
  event.sender.send('download:log', '[INFO] Download pausado. Clique em continuar para retomar.');

  await new Promise((resolve) => {
    downloadPause.resume = resolve;
  });

  downloadPause.resume = null;
  downloadPause.paused = false;
  event.sender.send('download:pause-state', { state: 'running' });
  event.sender.send('download:log', '[INFO] Retomando a forja.');
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.setMenuBarVisibility(false);
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('com.caioabra.soundforge');
  const win = createWindow();
  setupAutoUpdater(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function setupAutoUpdater(win) {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const sendUpdateLog = (message) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('download:log', message);
  };

  autoUpdater.on('checking-for-update', () => {
    sendUpdateLog('[INFO] Procurando atualização do Soundforge...');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateLog(`[INFO] Atualização ${info.version} encontrada. Baixando em segundo plano...`);
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateLog('[INFO] Soundforge já está atualizado.');
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateLog(`[INFO] Atualização ${info.version} pronta. Ela será instalada ao fechar o Soundforge.`);
    if (!win || win.isDestroyed()) return;
    win.webContents.send('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateLog(`[AVISO] Não foi possível verificar atualização: ${err?.message || 'erro desconhecido'}.`);
  });

  win.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      sendUpdateLog(`[AVISO] Não foi possível iniciar o auto-update: ${err?.message || 'erro desconhecido'}.`);
    });
  });
}

ipcMain.handle('update:restart-and-install', () => {
  if (isDev) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
});

ipcMain.handle('settings:get', async () => {
  const settings = await readUserSettings();
  return {
    ...settings,
    appVersion: app.getVersion()
  };
});

ipcMain.handle('settings:save-spotify-token', async (_event, token) => {
  const spotifyToken = normalizeSpotifyToken(token);
  const settings = await readUserSettings();
  const nextSettings = { ...settings, spotifyToken };
  await writeUserSettings(nextSettings);
  return { saved: true, hasSpotifyToken: Boolean(spotifyToken) };
});

ipcMain.handle('settings:clear-spotify-token', async () => {
  const settings = await readUserSettings();
  const nextSettings = { ...settings, spotifyToken: '' };
  await writeUserSettings(nextSettings);
  return { saved: true, hasSpotifyToken: false };
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('download:pause', () => {
  if (!downloadPause.active) return { ok: false, state: 'idle' };
  downloadPause.pauseRequested = true;
  if (downloadPause.paused) {
    sendPauseState('paused');
    return { ok: true, state: 'paused' };
  }
  sendPauseState('pausing');
  downloadPause.sender?.send('download:log', '[INFO] Pausa solicitada. Vou terminar a faixa atual antes de parar.');
  return { ok: true, state: 'pausing' };
});

ipcMain.handle('download:resume', () => {
  if (!downloadPause.active) return { ok: false, state: 'idle' };
  downloadPause.pauseRequested = false;
  if (downloadPause.resume) {
    downloadPause.resume();
  }
  sendPauseState('running');
  return { ok: true, state: 'running' };
});

ipcMain.handle('spotify:preview', async (_event, payload) => {
  const { spotifyToken, spotifyPlaylistUrl } = payload || {};
  if (!spotifyToken || !spotifyPlaylistUrl) {
    throw new Error('Token e link da playlist do Spotify são obrigatórios.');
  }

  const playlistId = extractSpotifyPlaylistId(spotifyPlaylistUrl);
  if (!playlistId) {
    throw new Error('Não foi possível identificar o ID da playlist do Spotify.');
  }

  const previewData = await fetchSpotifyPlaylist(spotifyToken, playlistId, 50);
  return previewData;
});

ipcMain.on('download:start', async (event, payload) => {
  try {
    resetPauseState(event.sender);
    const {
      source = 'youtube',
      url,
      outputDir,
      quality,
      spotifyToken,
      spotifyPlaylistUrl
    } = payload;

    if (source === 'spotify') {
      if (!spotifyToken || !spotifyPlaylistUrl || !outputDir) {
        event.sender.send('download:error', 'Token e link da playlist do Spotify são obrigatórios.');
        resetPauseState(null);
        return;
      }
    } else if (!url || !outputDir) {
      event.sender.send('download:error', 'URL e pasta de destino são obrigatórias.');
      resetPauseState(null);
      return;
    }

    const finalUrl = typeof url === 'string' ? url.trim() : url;

    const ytDlpBin = await ensureYtDlpBinary(event);
    if (!ytDlpBin) {
      event.sender.send(
        'download:error',
        'Não foi possível preparar o yt-dlp automaticamente. Verifique sua conexão ou configure YTDLP_BIN.'
      );
      resetPauseState(null);
      return;
    }

    const ffmpegLocation = resolveFfmpegLocation();
    if (!ffmpegLocation) {
      event.sender.send(
        'download:log',
        '[AVISO] ffmpeg/ffprobe não encontrados. Coloque em resources/ffmpeg/ para evitar erro pós-download.'
      );
    }

    const progressState = {
      percent: 0,
      speed: '',
      eta: '',
      title: '',
      itemIndex: null,
      itemCount: null
    };

    const sendProgress = (partial) => {
      Object.assign(progressState, partial);
      event.sender.send('download:progress', progressState);
    };

    if (source === 'spotify') {
      const playlistId = extractSpotifyPlaylistId(spotifyPlaylistUrl);
      if (!playlistId) {
        event.sender.send('download:error', 'Não foi possível identificar o ID da playlist do Spotify.');
        resetPauseState(null);
        return;
      }

      event.sender.send('download:log', '[INFO] Buscando faixas da playlist no Spotify...');
      const playlistData = await fetchSpotifyPlaylist(spotifyToken, playlistId);
      const spotifyTracks = playlistData.tracks || [];
      const playlistName = playlistData.name || 'Spotify Playlist';

      if (spotifyTracks.length === 0) {
        event.sender.send('download:error', 'Não encontrei faixas na playlist.');
        resetPauseState(null);
        return;
      }

      sendProgress({ itemIndex: 0, itemCount: spotifyTracks.length });

      const safeFolder = sanitizeFileComponent(playlistName);
      const baseFolder = path.join(outputDir, safeFolder || 'Spotify Playlist');
      const downloadedTracks = [];
      const skippedTracks = [];

      for (let index = 0; index < spotifyTracks.length; index += 1) {
        await waitIfPaused(event);

        const track = spotifyTracks[index];
        const query = buildSpotifyQuery(track);
        sendProgress({
          itemIndex: index + 1,
          itemCount: spotifyTracks.length,
          title: track.name || query
        });

        const indexPrefix = String(index + 1).padStart(2, '0');
        const outputBase = buildSpotifyOutputBase(track, indexPrefix);
        const outputTemplate = path.join(baseFolder, `${outputBase}.%(ext)s`);
        const outputFile = path.join(baseFolder, `${outputBase}.mp3`);
        const downloaded = await downloadSpotifyTrack({
          ytDlpBin,
          outputTemplate,
          quality,
          ffmpegLocation,
          query,
          event,
          sendProgress
        });

        if (!downloaded.ok) {
          const skippedTrack = {
            index: index + 1,
            name: track.name || query,
            artists: Array.isArray(track.artists) ? track.artists : [],
            query,
            reason: downloaded.reason,
            sources: downloaded.sources
          };
          skippedTracks.push(skippedTrack);
          event.sender.send('download:track-skipped', skippedTrack);
          event.sender.send('download:log', `[AVISO] Faixa pulada: ${query}. Motivo: ${downloaded.reason}`);
          continue;
        }

        await writeMp3Metadata({
          ffmpegLocation,
          filePath: outputFile,
          track,
          playlistName,
          trackNumber: index + 1,
          trackTotal: spotifyTracks.length,
          coverUrl: track.coverUrl,
          event
        });

        const downloadedTrack = {
          index: index + 1,
          name: track.name || query,
          artists: Array.isArray(track.artists) ? track.artists : [],
          source: downloaded.source,
          filePath: outputFile
        };
        downloadedTracks.push(downloadedTrack);
        event.sender.send('download:track-complete', downloadedTrack);
      }

      sendProgress({ percent: 100 });
      event.sender.send('download:complete', { isPlaylist: true, downloadedTracks, skippedTracks });
      resetPauseState(null);
      return;
    }

    const youtubePlaylistInfo = await inspectYoutubePlaylistUrl(finalUrl, ytDlpBin, event, sendProgress);
    const isPlaylist = youtubePlaylistInfo.isPlaylist || await detectPlaylist(finalUrl, ytDlpBin);
    const outputTemplate = isPlaylist
      ? path.join(outputDir, '%(playlist_title)s', '%(title)s.%(ext)s')
      : path.join(outputDir, '%(title)s.%(ext)s');

    if (isPlaylist && youtubePlaylistInfo.itemCount) {
      for (let index = 1; index <= youtubePlaylistInfo.itemCount; index += 1) {
        await waitIfPaused(event);
        sendProgress({
          itemIndex: index,
          itemCount: youtubePlaylistInfo.itemCount,
          percent: 0,
          speed: '',
          eta: ''
        });

        const args = buildYtDlpArgs({
          outputTemplate,
          quality,
          ffmpegLocation,
          input: finalUrl,
          yesPlaylist: true,
          playlistItems: index
        });

        const code = await runYtDlp(ytDlpBin, args, event, sendProgress, {
          itemIndex: index,
          itemCount: youtubePlaylistInfo.itemCount
        });

        if (code !== 0) {
          event.sender.send('download:log', `[AVISO] Item ${index} não foi baixado. Seguindo para o próximo.`);
          continue;
        }
      }

      sendProgress({ percent: 100 });
      event.sender.send('download:complete', { isPlaylist });
      resetPauseState(null);
      return;
    }

    const args = buildYtDlpArgs({
      outputTemplate,
      quality,
      ffmpegLocation,
      input: finalUrl,
      yesPlaylist: isPlaylist,
      singleTrackNumber: isPlaylist ? null : 1
    });

    const code = await runYtDlp(ytDlpBin, args, event, sendProgress);
    if (code === 0) {
      sendProgress({ percent: 100 });
      event.sender.send('download:complete', { isPlaylist });
      resetPauseState(null);
    } else {
      event.sender.send('download:error', `Falha no download. Código ${code}.`);
      resetPauseState(null);
    }
  } catch (err) {
    event.sender.send('download:error', err?.message || 'Erro inesperado.');
    resetPauseState(null);
  }
});

function resolveYtDlpBinary() {
  if (process.env.YTDLP_BIN && fs.existsSync(process.env.YTDLP_BIN)) {
    return process.env.YTDLP_BIN;
  }

  const userCandidate = getUserYtDlpBinaryPath();
  if (fs.existsSync(userCandidate)) return userCandidate;

  const devCandidate = path.join(app.getAppPath(), 'resources', 'yt-dlp', 'yt-dlp.exe');
  if (fs.existsSync(devCandidate)) return devCandidate;

  const prodCandidate = path.join(process.resourcesPath, 'yt-dlp', 'yt-dlp.exe');
  if (fs.existsSync(prodCandidate)) return prodCandidate;

  return null;
}

function getUserYtDlpDir() {
  return path.join(app.getPath('userData'), 'yt-dlp');
}

function getUserYtDlpBinaryPath() {
  return path.join(getUserYtDlpDir(), 'yt-dlp.exe');
}

function getUserSettingsPath() {
  return path.join(app.getPath('userData'), 'soundforge-settings.json');
}

async function readUserSettings() {
  try {
    const raw = await fs.promises.readFile(getUserSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      spotifyToken: typeof parsed.spotifyToken === 'string' ? parsed.spotifyToken : ''
    };
  } catch {
    return { spotifyToken: '' };
  }
}

async function writeUserSettings(settings) {
  const settingsPath = getUserSettingsPath();
  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.promises.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function ensureYtDlpBinary(event) {
  const existing = resolveYtDlpBinary();
  if (existing) return existing;

  const targetDir = getUserYtDlpDir();
  const targetPath = getUserYtDlpBinaryPath();

  event?.sender.send(
    'download:log',
    '[INFO] yt-dlp não encontrado. Baixando automaticamente para o perfil do usuário.'
  );

  await fs.promises.mkdir(targetDir, { recursive: true });
  await downloadFile(
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    targetPath,
    event
  );

  try {
    fs.chmodSync(targetPath, 0o755);
  } catch {
    // Ignora erros de permissão no Windows.
  }

  return targetPath;
}

function downloadFile(url, dest, event) {
  const tempDest = `${dest}.tmp`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        downloadFile(res.headers.location, dest, event).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Falha ao baixar yt-dlp (HTTP ${res.statusCode}).`));
        return;
      }

      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      let lastPercent = -1;

      const file = fs.createWriteStream(tempDest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (event && total) {
          const percent = Math.floor((received / total) * 100);
          if (percent === 100 || percent >= lastPercent + 5) {
            lastPercent = percent;
            event.sender.send('download:log', `[INFO] Baixando yt-dlp... ${percent}%`);
          }
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close(async () => {
          try {
            await fs.promises.rename(tempDest, dest);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      file.on('error', (err) => {
        res.destroy();
        file.close(() => {
          fs.promises.unlink(tempDest).catch(() => {});
          reject(err);
        });
      });
    });

    request.on('error', (err) => {
      fs.promises.unlink(tempDest).catch(() => {});
      reject(err);
    });
  });
}

function resolveFfmpegLocation() {
  if (process.env.FFMPEG_LOCATION && fs.existsSync(process.env.FFMPEG_LOCATION)) {
    return process.env.FFMPEG_LOCATION;
  }

  const devCandidate = path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe');
  const devProbe = path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffprobe.exe');
  if (fs.existsSync(devCandidate) && fs.existsSync(devProbe)) {
    return path.dirname(devCandidate);
  }

  const prodCandidate = path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  const prodProbe = path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe');
  if (fs.existsSync(prodCandidate) && fs.existsSync(prodProbe)) {
    return path.dirname(prodCandidate);
  }

  return null;
}

function safeDecode(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeBuffer(buffer) {
  if (!buffer) return '';
  const utf8Text = buffer.toString('utf8');
  if (!utf8Text.includes('�')) return utf8Text;
  const latin1Text = iconv.decode(buffer, 'latin1');
  return latin1Text || utf8Text;
}

function buildYtDlpArgs({
  outputTemplate,
  quality,
  ffmpegLocation,
  input,
  noPlaylist = false,
  yesPlaylist = false,
  singleTrackNumber = null,
  playlistItems = null
}) {
  const args = [
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', String(quality || '5'),
    '--embed-metadata',
    '--embed-thumbnail',
    '--convert-thumbnails', 'jpg',
    '--no-mtime',
    '--newline',
    '--output', outputTemplate
  ];

  if (noPlaylist) {
    args.push('--no-playlist');
  }

  if (yesPlaylist) {
    args.push('--yes-playlist');
  }

  if (playlistItems) {
    args.push('--playlist-items', String(playlistItems));
  }

  if (ffmpegLocation) {
    args.unshift('--ffmpeg-location', ffmpegLocation);
  }

  if (singleTrackNumber) {
    args.push('--postprocessor-args', `Metadata+FFmpeg_o:-metadata track=${singleTrackNumber}`);
  }

  args.push(input);
  return args;
}

async function downloadSpotifyTrack({ ytDlpBin, outputTemplate, quality, ffmpegLocation, query, event, sendProgress }) {
  const attempts = [];

  for (const source of SPOTIFY_TRACK_SOURCES) {
    event.sender.send('download:log', `[INFO] Caçando em ${source.label}: ${query}`);
    const args = buildYtDlpArgs({
      outputTemplate,
      quality,
      ffmpegLocation,
      input: `${source.inputPrefix}:${query}`,
      noPlaylist: true
    });

    const code = await runYtDlp(ytDlpBin, args, event, sendProgress);
    if (code === 0) {
      event.sender.send('download:log', `[INFO] Fonte encontrada: ${source.label}.`);
      return { ok: true, source: source.label, sources: attempts.concat(source.label) };
    }

    attempts.push(source.label);
    event.sender.send('download:log', `[INFO] ${source.label} não entregou essa faixa. Tentando outra fonte...`);
  }

  return {
    ok: false,
    reason: `nenhuma fonte retornou download válido (${attempts.join(', ')})`,
    sources: attempts
  };
}

function runYtDlp(ytDlpBin, args, event, sendProgress, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(ytDlpBin, args, {
      shell: false,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });

    const handleOutput = (chunk) => {
      const text = decodeBuffer(chunk);
      const parsedLines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      let liveDownloadLine = null;

      parsedLines.forEach((line) => {
          const itemMatch = line.match(/Downloading item (\d+) of (\d+)/i);
          if (itemMatch) {
            sendProgress({
              itemIndex: options.itemIndex || Number(itemMatch[1]),
              itemCount: options.itemCount || Number(itemMatch[2])
            });
          }

          const destMatch = line.match(/Destination:\s(.+)/i);
          if (destMatch) {
            const filename = path.basename(destMatch[1]);
            const baseTitle = filename.replace(/\.[^/.]+$/, '');
            sendProgress({ title: safeDecode(baseTitle) });
          }

          const percentMatch = line.match(/\s(\d{1,3}(?:\.\d+)?)%\s/);
          if (percentMatch) {
            sendProgress({ percent: Number(percentMatch[1]) });
          }

          const speedMatch = line.match(/at\s+([^\s]+)\s+ETA\s+([0-9:]+)/i);
          if (speedMatch) {
            sendProgress({
              speed: speedMatch[1],
              eta: speedMatch[2]
            });
          }

          if (percentMatch) {
            const details = speedMatch ? ` • ${speedMatch[1]} • ETA ${speedMatch[2]}` : '';
            liveDownloadLine = `[PROGRESS] Download em andamento: ${percentMatch[1]}%${details}`;
          }
        });

      const visibleLines = parsedLines.filter((line) => {
        const isDownloadProgress = /^\[download\]\s+\d{1,3}(?:\.\d+)?%/i.test(line);
        return !isDownloadProgress;
      });

      if (visibleLines.length) {
        event.sender.send('download:log', visibleLines.join('\n'));
      }
      if (liveDownloadLine) {
        event.sender.send('download:log', liveDownloadLine);
      }
    };

    proc.stdout.on('data', handleOutput);
    proc.stderr.on('data', handleOutput);

    proc.on('close', (code) => {
      resolve(code);
    });
  });
}

function inspectYoutubeUrl(inputUrl) {
  const info = {
    hasPlaylist: false,
    isRadio: false,
    playlistId: null
  };

  if (!inputUrl || typeof inputUrl !== 'string') return info;
  try {
    const parsed = new URL(inputUrl);
    const playlistId = parsed.searchParams.get('list');
    const startRadio = parsed.searchParams.get('start_radio') === '1';
    const radioParam = parsed.searchParams.get('radio') === '1';
    const hasMixPath = parsed.pathname.toLowerCase().includes('/mix/');

    info.playlistId = playlistId;
    info.hasPlaylist = Boolean(playlistId);
    info.isRadio = startRadio || radioParam || hasMixPath || Boolean(playlistId && /^rd/i.test(playlistId));

    return info;
  } catch {
    return info;
  }
}

async function inspectYoutubePlaylistUrl(inputUrl, ytDlpBin, event, sendProgress) {
  const urlInfo = inspectYoutubeUrl(inputUrl);
  if (!urlInfo.hasPlaylist && !urlInfo.isRadio) {
    return { isPlaylist: false, itemCount: null };
  }

  const kindLabel = urlInfo.isRadio ? 'Radio/Mix do YouTube' : 'playlist do YouTube';
  event.sender.send('download:log', `[INFO] ${kindLabel} detectado. Mantendo o link como playlist.`);

  const itemCount = await countYoutubePlaylistEntries(inputUrl, ytDlpBin);
  if (itemCount) {
    sendProgress({ itemIndex: 0, itemCount });
    event.sender.send('download:log', `[INFO] ${itemCount} itens encontrados na lista.`);
  } else if (urlInfo.isRadio) {
    event.sender.send(
      'download:log',
      '[INFO] O YouTube Radio não informou um total fixo. O progresso será atualizado conforme os itens forem baixados.'
    );
  }

  return { isPlaylist: true, itemCount };
}

function countYoutubePlaylistEntries(inputUrl, ytDlpBin) {
  return new Promise((resolve) => {
    if (!ytDlpBin) {
      resolve(null);
      return;
    }

    const proc = spawn(ytDlpBin, ['--flat-playlist', '--print', '%(playlist_index)s', inputUrl], {
      shell: false,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });

    let lastIndex = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      proc.kill();
      finish(lastIndex);
    }, 20000);

    proc.stdout.on('data', (chunk) => {
      decodeBuffer(chunk)
        .split(/\r?\n/)
        .map((line) => Number(line.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
        .forEach((value) => {
          lastIndex = value;
        });
    });

    proc.on('error', () => finish(lastIndex));
    proc.on('close', () => finish(lastIndex));
  });
}

function extractSpotifyPlaylistId(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  const trimmed = inputUrl.trim();

  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname.includes('spotify.com')) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const playlistIndex = parts.findIndex((part) => part === 'playlist');
    if (playlistIndex !== -1 && parts[playlistIndex + 1]) {
      return parts[playlistIndex + 1];
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchSpotifyPlaylist(token, playlistId, maxTracks = null) {
  try {
    return await fetchSpotifyPlaylistFromApi(token, playlistId, maxTracks);
  } catch (err) {
    if (err?.statusCode === 404) {
      return fetchSpotifyEmbedPlaylist(playlistId, maxTracks);
    }
    throw err;
  }
}

async function fetchSpotifyPlaylistFromApi(token, playlistId, maxTracks = null) {
  const playlist = await fetchSpotifyApi(
    `/v1/playlists/${playlistId}?fields=name`,
    token,
    { playlistId }
  );
  const tracks = [];
  let offset = 0;
  const limit = 100;
  let total = 0;

  while (true) {
    const data = await fetchSpotifyApi(
      `/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=items(track(name,artists(name),album(name,images(url,width,height)))),total`,
      token,
      { playlistId }
    );
    total = data.total || total;
    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach((item) => {
      if (!item || !item.track) return;
      const name = item.track.name || '';
      const artists = Array.isArray(item.track.artists)
        ? item.track.artists.map((artist) => artist.name).filter(Boolean)
        : [];
      const coverUrl = selectSpotifyImageUrl(item.track.album?.images);
      const albumName = item.track.album?.name || '';
      if (name) tracks.push({ name, artists, albumName, coverUrl });
    });

    if (maxTracks && tracks.length >= maxTracks) {
      tracks.length = maxTracks;
      break;
    }

    offset += limit;
    if (!data.total || offset >= data.total || items.length === 0) break;
  }

  return { name: playlist?.name, tracks, total };
}

async function fetchSpotifyEmbedPlaylist(playlistId, maxTracks = null) {
  const html = await fetchSpotifyEmbedHtml(playlistId);
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('O Spotify bloqueou a API e não consegui ler a prévia pública da playlist.');
  }

  let entity;
  try {
    const data = JSON.parse(match[1]);
    entity = data?.props?.pageProps?.state?.data?.entity;
  } catch {
    throw new Error('O Spotify bloqueou a API e retornou uma prévia pública em formato inesperado.');
  }

  const trackList = Array.isArray(entity?.trackList) ? entity.trackList : [];
  const tracks = trackList
    .map((track) => ({
      name: track?.title || '',
      artists: track?.subtitle ? [track.subtitle] : [],
      coverUrl: selectSpotifyEmbedImageUrl(track)
    }))
    .filter((track) => track.name);

  if (maxTracks && tracks.length > maxTracks) {
    tracks.length = maxTracks;
  }

  if (tracks.length === 0) {
    throw new Error('O Spotify bloqueou a API e a prévia pública não trouxe faixas.');
  }

  return {
    name: entity?.name || entity?.title || 'Spotify Playlist',
    tracks,
    total: trackList.length || tracks.length
  };
}

function fetchSpotifyEmbedHtml(playlistId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'open.spotify.com',
      path: `/embed/playlist/${encodeURIComponent(playlistId)}`,
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 Soundforge'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Spotify embed retornou HTTP ${res.statusCode}.`));
          return;
        }
        resolve(data);
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

function normalizeSpotifyToken(token) {
  return String(token || '').trim().replace(/^Bearer\s+/i, '').trim();
}

function parseSpotifyApiError(data) {
  try {
    const parsed = JSON.parse(data);
    return parsed?.error?.message || parsed?.error_description || '';
  } catch {
    return '';
  }
}

function buildSpotifyApiError(statusCode, data, context = {}) {
  const spotifyMessage = parseSpotifyApiError(data);
  const makeError = (message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.spotifyMessage = spotifyMessage;
    err.context = context;
    return err;
  };

  if (statusCode === 400) {
    return makeError(spotifyMessage || 'A requisição para o Spotify não foi aceita. Confira se você colou um access token válido, não o Client ID ou Client Secret.');
  }
  if (statusCode === 401) {
    return makeError('Token do Spotify expirou ou é inválido. Gere um access token novo e cole somente o token, com ou sem "Bearer".');
  }
  if (statusCode === 403) {
    return makeError(spotifyMessage || 'O token do Spotify não tem permissão para ler essa playlist.');
  }
  if (statusCode === 404) {
    const suffix = context.playlistId ? ` ID lido: ${context.playlistId}.` : '';
    return makeError(`O Spotify não liberou essa playlist pela Web API ou ela não existe para esse token.${suffix} Playlists algorítmicas/editoriais do Spotify podem retornar 404 mesmo abrindo no navegador.`);
  }
  if (statusCode === 429) {
    return makeError('O Spotify limitou as requisições agora. Aguarde um pouco e tente novamente.');
  }
  return makeError(spotifyMessage || `Spotify API retornou HTTP ${statusCode}.`);
}

function fetchSpotifyApi(endpoint, token, context = {}) {
  return new Promise((resolve, reject) => {
    const accessToken = normalizeSpotifyToken(token);
    const options = {
      hostname: 'api.spotify.com',
      path: endpoint,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(buildSpotifyApiError(res.statusCode, data, context));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

function buildSpotifyQuery(track) {
  if (!track) return '';
  const artists = Array.isArray(track.artists) ? track.artists.join(' ') : '';
  return `${track.name} ${artists}`.trim();
}

function selectSpotifyImageUrl(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  const sorted = images
    .filter((image) => image?.url)
    .sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
  return sorted[0]?.url || '';
}

function selectSpotifyEmbedImageUrl(track) {
  const candidates = [
    track?.coverArt?.sources,
    track?.albumOfTrack?.coverArt?.sources,
    track?.album?.coverArt?.sources,
    track?.images
  ];

  for (const candidate of candidates) {
    const imageUrl = selectSpotifyImageUrl(candidate);
    if (imageUrl) return imageUrl;
  }

  return track?.image || track?.thumbnail || '';
}

function buildSpotifyOutputBase(track, indexPrefix) {
  const artists = Array.isArray(track?.artists) ? track.artists.join(', ') : '';
  const title = sanitizeFileComponent(track?.name || 'Faixa');
  const artistSuffix = sanitizeFileComponent(artists);
  const name = artistSuffix ? `${title} - ${artistSuffix}` : title;
  return `${indexPrefix} - ${(name || 'Faixa').slice(0, 150)}`;
}

function sanitizeFileComponent(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
}

function resolveFfmpegBinary(ffmpegLocation) {
  if (!ffmpegLocation) return null;
  const windowsCandidate = path.join(ffmpegLocation, 'ffmpeg.exe');
  if (fs.existsSync(windowsCandidate)) return windowsCandidate;
  const unixCandidate = path.join(ffmpegLocation, 'ffmpeg');
  if (fs.existsSync(unixCandidate)) return unixCandidate;
  return null;
}

async function writeMp3Metadata({ ffmpegLocation, filePath, track, playlistName, trackNumber, trackTotal, coverUrl, event }) {
  const ffmpegBin = resolveFfmpegBinary(ffmpegLocation);
  if (!ffmpegBin || !filePath || !fs.existsSync(filePath)) return;

  const artists = Array.isArray(track?.artists) ? track.artists.filter(Boolean).join(', ') : '';
  const tempPath = `${filePath}.metadata.tmp.mp3`;
  const coverPath = coverUrl ? `${filePath}.cover.tmp.jpg` : '';
  let useCover = false;

  if (coverUrl && coverPath) {
    try {
      await downloadCoverFile(coverUrl, coverPath);
      useCover = true;
    } catch {
      await fs.promises.unlink(coverPath).catch(() => {});
      event?.sender.send('download:log', '[AVISO] Não consegui baixar a capa dessa faixa.');
    }
  }

  const args = [
    '-y',
    '-i', filePath
  ];

  if (useCover) {
    args.push(
      '-i', coverPath,
      '-map', '0:a',
      '-map', '1:v',
      '-codec', 'copy',
      '-id3v2_version', '3',
      '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)',
      '-disposition:v:0', 'attached_pic'
    );
  } else {
    args.push(
      '-map', '0',
      '-codec', 'copy',
      '-id3v2_version', '3'
    );
  }

  args.push(
    '-metadata', `title=${track?.name || ''}`,
    '-metadata', `artist=${artists}`,
    '-metadata', `album=${track?.albumName || playlistName || 'Spotify Playlist'}`,
    '-metadata', `track=${trackNumber}/${trackTotal}`,
    tempPath
  );

  try {
    await runProcess(ffmpegBin, args);
    await fs.promises.copyFile(tempPath, filePath);
    await fs.promises.unlink(tempPath).catch(() => {});
    await fs.promises.unlink(coverPath).catch(() => {});
    event?.sender.send('download:log', `[INFO] Metadados gravados: ${track?.name || path.basename(filePath)}`);
  } catch {
    await fs.promises.unlink(tempPath).catch(() => {});
    await fs.promises.unlink(coverPath).catch(() => {});
    event?.sender.send('download:log', '[AVISO] Não consegui gravar os metadados dessa faixa.');
  }
}

function downloadCoverFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Soundforge' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadCoverFile(res.headers.location, destinationPath).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download retornou HTTP ${res.statusCode}.`));
        return;
      }

      const file = fs.createWriteStream(destinationPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      shell: false,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += decodeBuffer(chunk);
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Processo finalizou com código ${code}.`));
    });
  });
}

function detectPlaylist(url, ytDlpBin) {
  return new Promise((resolve, reject) => {
    if (!ytDlpBin) {
      reject(new Error('yt-dlp não encontrado.'));
      return;
    }

    const args = ['--dump-single-json', '--skip-download', url];
    const proc = spawn(ytDlpBin, args, {
      shell: false,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || 'Não foi possível analisar o link.'));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        const isPlaylist = Array.isArray(info.entries) || info._type === 'playlist';
        resolve(Boolean(isPlaylist));
      } catch (err) {
        reject(err);
      }
    });
  });
}
