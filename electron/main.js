const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
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

ipcMain.on('download:start', async (event, payload) => {
  try {
    const { url, outputDir, quality } = payload;
    if (!url || !outputDir) {
      event.sender.send('download:error', 'URL e pasta de destino são obrigatórias.');
      return;
    }

    const ytDlpBin = resolveYtDlpBinary();
    if (!ytDlpBin) {
      event.sender.send(
        'download:error',
        'Não encontrei o yt-dlp.exe. Coloque em resources/yt-dlp/yt-dlp.exe.'
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

    const isPlaylist = await detectPlaylist(url, ytDlpBin);
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

    const outputTemplate = isPlaylist
      ? path.join(outputDir, '%(playlist_title)s', '%(title)s.%(ext)s')
      : path.join(outputDir, '%(title)s.%(ext)s');

    const args = [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', String(quality || '5'),
      '--no-mtime',
      '--newline',
      '--output', outputTemplate,
      url
    ];

    if (ffmpegLocation) {
      args.unshift('--ffmpeg-location', ffmpegLocation);
    }

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
      if (code === 0) {
        sendProgress({ percent: 100 });
        event.sender.send('download:complete', { isPlaylist });
      } else {
        event.sender.send('download:error', `Falha no download. Código ${code}.`);
      }
    });
  } catch (err) {
    event.sender.send('download:error', err?.message || 'Erro inesperado.');
  }
});

function resolveYtDlpBinary() {
  if (process.env.YTDLP_BIN && fs.existsSync(process.env.YTDLP_BIN)) {
    return process.env.YTDLP_BIN;
  }

  const devCandidate = path.join(app.getAppPath(), 'resources', 'yt-dlp', 'yt-dlp.exe');
  if (fs.existsSync(devCandidate)) return devCandidate;

  const prodCandidate = path.join(process.resourcesPath, 'yt-dlp', 'yt-dlp.exe');
  if (fs.existsSync(prodCandidate)) return prodCandidate;

  return null;
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
