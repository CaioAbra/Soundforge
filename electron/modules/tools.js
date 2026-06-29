const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { decodeBuffer } = require('./utils');

const YTDLP_RELEASE_BASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const YTDLP_BINARY_NAME = 'yt-dlp.exe';

// Estado local do módulo
let ytDlpPreparePromise = null;
let ffmpegLocationCache = null;
let ffmpegLocationChecked = false;
const toolsStatus = {
  state: 'idle',
  ytDlpReady: false,
  ffmpegReady: false,
  message: 'Ferramentas ainda nao verificadas.',
  updatedAt: null
};

// ── Caminhos de binários ──────────────────────────────────────────────────────

function getUserYtDlpDir() {
  return path.join(app.getPath('userData'), 'yt-dlp');
}

function getUserYtDlpBinaryPath() {
  return path.join(getUserYtDlpDir(), 'yt-dlp.exe');
}

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

function getCachedFfmpegLocation() {
  if (ffmpegLocationChecked && ffmpegLocationCache) return ffmpegLocationCache;
  ffmpegLocationCache = resolveFfmpegLocation();
  ffmpegLocationChecked = true;
  return ffmpegLocationCache;
}

function resolveFfmpegBinary(ffmpegLocation) {
  if (!ffmpegLocation) return null;
  const winPath = path.join(ffmpegLocation, 'ffmpeg.exe');
  if (fs.existsSync(winPath)) return winPath;
  const unixPath = path.join(ffmpegLocation, 'ffmpeg');
  if (fs.existsSync(unixPath)) return unixPath;
  return null;
}

function resolveFfprobeBinary(ffmpegLocation) {
  if (!ffmpegLocation) return null;
  const winPath = path.join(ffmpegLocation, 'ffprobe.exe');
  if (fs.existsSync(winPath)) return winPath;
  const unixPath = path.join(ffmpegLocation, 'ffprobe');
  if (fs.existsSync(unixPath)) return unixPath;
  return null;
}

// ── Download do yt-dlp ───────────────────────────────────────────────────────

function downloadText(url, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        downloadText(res.headers.location, maxBytes).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download retornou HTTP ${res.statusCode}.`));
        return;
      }

      let received = 0;
      let data = '';
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          request.destroy(new Error('Resposta maior que o limite esperado.'));
          return;
        }
        data += chunk.toString('utf8');
      });
      res.on('end', () => resolve(data));
    });
    request.on('error', reject);
  });
}

function parseSha256Sum(text, fileName) {
  const target = fileName.toLowerCase();
  const line = String(text || '')
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().includes(target));
  if (!line) return '';

  const hashMatch = line.match(/(?:sha256:)?([a-f0-9]{64})/i);
  return hashMatch ? hashMatch[1].toLowerCase() : '';
}

async function fetchYtDlpSha256() {
  const checksumText = await downloadText(`${YTDLP_RELEASE_BASE_URL}/SHA2-256SUMS`, 64 * 1024);
  const expectedHash = parseSha256Sum(checksumText, YTDLP_BINARY_NAME);
  if (!expectedHash) {
    throw new Error('Nao consegui validar o checksum oficial do yt-dlp.');
  }
  return expectedHash;
}

function verifyFileSha256(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);

    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => {
      const actualHash = hash.digest('hex');
      if (actualHash !== expectedHash.toLowerCase()) {
        reject(new Error('Checksum do yt-dlp nao confere com o publicado oficialmente.'));
        return;
      }
      resolve(true);
    });
  });
}

function downloadFile(url, dest, event, options = {}) {
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
            if (options.sha256) {
              await verifyFileSha256(tempDest, options.sha256);
            }
            await fs.promises.rename(tempDest, dest);
            resolve();
          } catch (err) {
            await fs.promises.unlink(tempDest).catch(() => {});
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

async function ensureYtDlpBinary(event) {
  const existing = resolveYtDlpBinary();
  if (existing) return existing;
  if (ytDlpPreparePromise) return ytDlpPreparePromise;

  ytDlpPreparePromise = (async () => {
    const targetDir = getUserYtDlpDir();
    const targetPath = getUserYtDlpBinaryPath();
    event?.sender.send('download:log', '[INFO] yt-dlp não encontrado. Baixando automaticamente para o perfil do usuário.');
    await fs.promises.mkdir(targetDir, { recursive: true });
    const expectedHash = await fetchYtDlpSha256();
    await downloadFile(`${YTDLP_RELEASE_BASE_URL}/${YTDLP_BINARY_NAME}`, targetPath, event, { sha256: expectedHash });
    try { fs.chmodSync(targetPath, 0o755); } catch { /* Ignora erros de permissão no Windows. */ }
    return targetPath;
  })();

  try {
    return await ytDlpPreparePromise;
  } finally {
    ytDlpPreparePromise = null;
  }
}

// ── Status das ferramentas ───────────────────────────────────────────────────

function getToolsStatus() {
  return { ...toolsStatus };
}

function updateToolsStatus(win, partial) {
  Object.assign(toolsStatus, partial, { updatedAt: Date.now() });
  if (win && !win.isDestroyed()) {
    win.webContents.send('tools:status', getToolsStatus());
  }
}

async function warmUpTools(win) {
  updateToolsStatus(win, { state: 'preparing', message: 'Preparando ferramentas em segundo plano.' });
  try {
    const ytDlpBin = await ensureYtDlpBinary(null);
    const ffmpegLocation = getCachedFfmpegLocation();
    updateToolsStatus(win, {
      state: ffmpegLocation ? 'ready' : 'warning',
      ytDlpReady: Boolean(ytDlpBin),
      ffmpegReady: Boolean(ffmpegLocation),
      message: ffmpegLocation
        ? 'Ferramentas prontas para baixar.'
        : 'yt-dlp pronto. ffmpeg/ffprobe nao encontrados.'
    });
  } catch (err) {
    updateToolsStatus(win, {
      state: 'error',
      ytDlpReady: false,
      ffmpegReady: Boolean(getCachedFfmpegLocation()),
      message: err?.message || 'Nao foi possivel preparar as ferramentas.'
    });
  }
}

// ── Validação de arquivos baixados ───────────────────────────────────────────

function runProcessCapture(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += decodeBuffer(chunk); });
    proc.stderr.on('data', (chunk) => { stderr += decodeBuffer(chunk); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `Processo finalizou com codigo ${code}.`));
    });
  });
}

async function validateDownloadedAudioFile({ filePath, ffmpegLocation, expectedDurationMs = 0 }) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'MP3 final nao foi criado' };
  }
  const stats = await fs.promises.stat(filePath).catch(() => null);
  if (!stats || stats.size < 16 * 1024) {
    return { ok: false, reason: 'arquivo final vazio ou pequeno demais' };
  }
  const ffprobeBin = resolveFfprobeBinary(ffmpegLocation);
  if (!ffprobeBin) return { ok: true };

  try {
    const output = await runProcessCapture(ffprobeBin, [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type,duration:format=duration',
      '-of', 'json', filePath
    ]);
    const data = JSON.parse(output.stdout || '{}');
    const audioStream = Array.isArray(data.streams)
      ? data.streams.find((s) => s?.codec_type === 'audio')
      : null;
    if (!audioStream) return { ok: false, reason: 'nenhuma faixa de audio detectada' };

    const durationSeconds = Number(audioStream.duration || data.format?.duration || 0);
    const expectedSeconds = Number(expectedDurationMs || 0) / 1000;
    if (expectedSeconds > 0 && durationSeconds > 0) {
      const tolerance = Math.max(25, expectedSeconds * 0.35);
      if (Math.abs(durationSeconds - expectedSeconds) > tolerance) {
        return {
          ok: false,
          reason: `duracao diferente do Spotify (${Math.round(durationSeconds)}s vs ${Math.round(expectedSeconds)}s)`
        };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'ffprobe nao conseguiu ler audio no MP3' };
  }
}

module.exports = {
  getUserYtDlpDir,
  getUserYtDlpBinaryPath,
  resolveYtDlpBinary,
  resolveFfmpegLocation,
  getCachedFfmpegLocation,
  resolveFfmpegBinary,
  resolveFfprobeBinary,
  downloadText,
  parseSha256Sum,
  fetchYtDlpSha256,
  verifyFileSha256,
  downloadFile,
  ensureYtDlpBinary,
  getToolsStatus,
  updateToolsStatus,
  warmUpTools,
  runProcessCapture,
  validateDownloadedAudioFile
};
