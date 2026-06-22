const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const iconv = require('iconv-lite');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f0b07',
    autoHideMenuBar: true,
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
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
        return;
      }
    } else if (!url || !outputDir) {
      event.sender.send('download:error', 'URL e pasta de destino são obrigatórias.');
      return;
    }

    const finalUrl = typeof url === 'string' ? url.trim() : url;

    const ytDlpBin = await ensureYtDlpBinary(event);
    if (!ytDlpBin) {
      event.sender.send(
        'download:error',
        'Não foi possível preparar o yt-dlp automaticamente. Verifique sua conexão ou configure YTDLP_BIN.'
      );
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
        return;
      }

      event.sender.send('download:log', '[INFO] Buscando faixas da playlist no Spotify...');
      const playlistData = await fetchSpotifyPlaylist(spotifyToken, playlistId);
      const spotifyTracks = playlistData.tracks || [];
      const playlistName = playlistData.name || 'Spotify Playlist';

      if (spotifyTracks.length === 0) {
        event.sender.send('download:error', 'Não encontrei faixas na playlist.');
        return;
      }

      sendProgress({ itemIndex: 0, itemCount: spotifyTracks.length });

      const safeFolder = sanitizeFileComponent(playlistName);
      const baseFolder = path.join(outputDir, safeFolder || 'Spotify Playlist');

      for (let index = 0; index < spotifyTracks.length; index += 1) {
        const track = spotifyTracks[index];
        const query = buildSpotifyQuery(track);
        sendProgress({
          itemIndex: index + 1,
          itemCount: spotifyTracks.length,
          title: track.name || query
        });
        event.sender.send('download:log', `[INFO] Buscando no YouTube: ${query}`);

        const indexPrefix = String(index + 1).padStart(2, '0');
        const outputTemplate = path.join(baseFolder, `${indexPrefix} - %(title)s.%(ext)s`);
        const args = buildYtDlpArgs({
          outputTemplate,
          quality,
          ffmpegLocation,
          input: `ytsearch1:${query}`,
          noPlaylist: true
        });

        const code = await runYtDlp(ytDlpBin, args, event, sendProgress);
        if (code !== 0) {
          event.sender.send('download:error', `Falha no download. Código ${code}.`);
          return;
        }
      }

      sendProgress({ percent: 100 });
      event.sender.send('download:complete', { isPlaylist: true });
      return;
    }

    const youtubePlaylistInfo = await inspectYoutubePlaylistUrl(finalUrl, ytDlpBin, event, sendProgress);
    const isPlaylist = youtubePlaylistInfo.isPlaylist || await detectPlaylist(finalUrl, ytDlpBin);
    const outputTemplate = isPlaylist
      ? path.join(outputDir, '%(playlist_title)s', '%(title)s.%(ext)s')
      : path.join(outputDir, '%(title)s.%(ext)s');

    const args = buildYtDlpArgs({
      outputTemplate,
      quality,
      ffmpegLocation,
      input: finalUrl,
      yesPlaylist: isPlaylist
    });

    const code = await runYtDlp(ytDlpBin, args, event, sendProgress);
    if (code === 0) {
      sendProgress({ percent: 100 });
      event.sender.send('download:complete', { isPlaylist });
    } else {
      event.sender.send('download:error', `Falha no download. Código ${code}.`);
    }
  } catch (err) {
    event.sender.send('download:error', err?.message || 'Erro inesperado.');
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

function buildYtDlpArgs({ outputTemplate, quality, ffmpegLocation, input, noPlaylist = false, yesPlaylist = false }) {
  const args = [
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', String(quality || '5'),
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

  if (ffmpegLocation) {
    args.unshift('--ffmpeg-location', ffmpegLocation);
  }

  args.push(input);
  return args;
}

function runYtDlp(ytDlpBin, args, event, sendProgress) {
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
      event.sender.send('download:log', text);

      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const itemMatch = line.match(/Downloading item (\d+) of (\d+)/i);
          if (itemMatch) {
            sendProgress({
              itemIndex: Number(itemMatch[1]),
              itemCount: Number(itemMatch[2])
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
        });
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
  const playlist = await fetchSpotifyApi(
    `/v1/playlists/${playlistId}?fields=name`,
    token
  );
  const tracks = [];
  let offset = 0;
  const limit = 100;
  let total = 0;

  while (true) {
    const data = await fetchSpotifyApi(
      `/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=items(track(name,artists(name))),total`,
      token
    );
    total = data.total || total;
    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach((item) => {
      if (!item || !item.track) return;
      const name = item.track.name || '';
      const artists = Array.isArray(item.track.artists)
        ? item.track.artists.map((artist) => artist.name).filter(Boolean)
        : [];
      if (name) tracks.push({ name, artists });
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

function fetchSpotifyApi(endpoint, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.spotify.com',
      path: endpoint,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
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
          if (res.statusCode === 401) {
            reject(new Error('Token do Spotify expirou ou é inválido.'));
            return;
          }
          reject(new Error(`Spotify API retornou HTTP ${res.statusCode}.`));
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

function sanitizeFileComponent(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
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
