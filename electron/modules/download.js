const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const { safeDecode, decodeBuffer, sanitizeFileComponent } = require('./utils');
const { SPOTIFY_TRACK_SOURCES } = require('./constants');
const { resolveFfmpegBinary, resolveFfprobeBinary, validateDownloadedAudioFile } = require('./tools');

// ── Estado local de pausa ─────────────────────────────────────────────────────
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
  if (downloadPause.resume) downloadPause.resume();
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
  await new Promise((resolve) => { downloadPause.resume = resolve; });
  downloadPause.resume = null;
  downloadPause.paused = false;
  event.sender.send('download:pause-state', { state: 'running' });
  event.sender.send('download:log', '[INFO] Retomando a forja.');
}

function getPauseState() { return downloadPause; }

// ── yt-dlp runner ─────────────────────────────────────────────────────────────

function buildYtDlpArgs({
  outputTemplate, quality, ffmpegLocation, input,
  noPlaylist = false, yesPlaylist = false,
  singleTrackNumber = null, playlistItems = null
}) {
  const args = [
    '--format', 'bestaudio/best[acodec!=none]',
    '--extract-audio', '--audio-format', 'mp3',
    '--audio-quality', String(quality || '5'),
    '--embed-metadata', '--embed-thumbnail',
    '--convert-thumbnails', 'jpg',
    '--no-mtime', '--newline',
    '--output', outputTemplate
  ];
  if (noPlaylist) args.push('--no-playlist');
  if (yesPlaylist) args.push('--yes-playlist');
  if (playlistItems) args.push('--playlist-items', String(playlistItems));
  if (ffmpegLocation) args.unshift('--ffmpeg-location', ffmpegLocation);
  if (singleTrackNumber) args.push('--postprocessor-args', `Metadata+FFmpeg_o:-metadata track=${singleTrackNumber}`);
  args.push(input);
  return args;
}

function runYtDlp(ytDlpBin, args, event, sendProgress, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(ytDlpBin, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });

    const handleOutput = (chunk) => {
      const text = decodeBuffer(chunk);
      const parsedLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let liveDownloadLine = null;

      parsedLines.forEach((line) => {
        const itemMatch = line.match(/Downloading item (\d+) of (\d+)/i);
        if (itemMatch) sendProgress({ itemIndex: options.itemIndex || Number(itemMatch[1]), itemCount: options.itemCount || Number(itemMatch[2]) });

        const destMatch = line.match(/Destination:\s(.+)/i);
        if (destMatch) sendProgress({ title: safeDecode(path.basename(destMatch[1]).replace(/\.[^/.]+$/, '')) });

        const percentMatch = line.match(/\s(\d{1,3}(?:\.\d+)?)%\s/);
        if (percentMatch) sendProgress({ percent: Number(percentMatch[1]) });

        const speedMatch = line.match(/at\s+([^\s]+)\s+ETA\s+([0-9:]+)/i);
        if (speedMatch) sendProgress({ speed: speedMatch[1], eta: speedMatch[2] });

        if (percentMatch) {
          const details = speedMatch ? ` • ${speedMatch[1]} • ETA ${speedMatch[2]}` : '';
          liveDownloadLine = `[PROGRESS] Download em andamento: ${percentMatch[1]}%${details}`;
        }
      });

      const visibleLines = parsedLines.filter((l) => !/^\[download\]\s+\d{1,3}(?:\.\d+)?%/i.test(l));
      if (visibleLines.length) event.sender.send('download:log', visibleLines.join('\n'));
      if (liveDownloadLine) event.sender.send('download:log', liveDownloadLine);
    };

    proc.stdout.on('data', handleOutput);
    proc.stderr.on('data', handleOutput);
    proc.on('close', (code) => resolve(code));
  });
}

// ── Inspeção de URLs do YouTube ───────────────────────────────────────────────

function inspectYoutubeUrl(inputUrl) {
  const info = { hasPlaylist: false, isRadio: false, playlistId: null };
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
  } catch { return info; }
}

function countYoutubePlaylistEntries(inputUrl, ytDlpBin) {
  return new Promise((resolve) => {
    if (!ytDlpBin) { resolve(null); return; }
    const proc = spawn(ytDlpBin, ['--flat-playlist', '--print', '%(playlist_index)s', inputUrl], {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    let lastIndex = null;
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { proc.kill(); finish(lastIndex); }, 20000);
    proc.stdout.on('data', (chunk) => {
      decodeBuffer(chunk).split(/\r?\n/).map((l) => Number(l.trim()))
        .filter((v) => Number.isInteger(v) && v > 0)
        .forEach((v) => { lastIndex = v; });
    });
    proc.on('error', () => finish(lastIndex));
    proc.on('close', () => finish(lastIndex));
  });
}

async function inspectYoutubePlaylistUrl(inputUrl, ytDlpBin, event, sendProgress) {
  const urlInfo = inspectYoutubeUrl(inputUrl);
  if (!urlInfo.hasPlaylist && !urlInfo.isRadio) return { isPlaylist: false, itemCount: null };

  const kindLabel = urlInfo.isRadio ? 'Radio/Mix do YouTube' : 'playlist do YouTube';
  event.sender.send('download:log', `[INFO] ${kindLabel} detectado. Mantendo o link como playlist.`);

  const itemCount = await countYoutubePlaylistEntries(inputUrl, ytDlpBin);
  if (itemCount) {
    sendProgress({ itemIndex: 0, itemCount });
    event.sender.send('download:log', `[INFO] ${itemCount} itens encontrados na lista.`);
  } else if (urlInfo.isRadio) {
    event.sender.send('download:log', '[INFO] O YouTube Radio não informou um total fixo. O progresso será atualizado conforme os itens forem baixados.');
  }
  return { isPlaylist: true, itemCount };
}

function detectPlaylist(url, ytDlpBin) {
  return new Promise((resolve, reject) => {
    if (!ytDlpBin) { reject(new Error('yt-dlp não encontrado.')); return; }
    const proc = spawn(ytDlpBin, ['--dump-single-json', '--skip-download', url], {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(() => {
      proc.kill();
      finish(() => reject(new Error('Tempo esgotado ao analisar o link.')));
    }, 30000);
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('error', (err) => { finish(() => reject(err)); });
    proc.on('close', (code) => {
      finish(() => {
        if (code !== 0) { reject(new Error(stderr || 'Não foi possível analisar o link.')); return; }
        try {
          const info = JSON.parse(stdout);
          resolve(Boolean(Array.isArray(info.entries) || info._type === 'playlist'));
        } catch (err) { reject(err); }
      });
    });
  });
}

// ── Download Spotify ──────────────────────────────────────────────────────────

function buildSpotifySearchQueryVariants(track, fallbackQuery) {
  const title = String(track?.name || '').trim();
  const artists = Array.isArray(track?.artists) ? track.artists.filter(Boolean).join(' ') : '';
  const base = [title, artists].filter(Boolean).join(' ').trim() || String(fallbackQuery || '').trim();
  return {
    base,
    'official-audio': [base, 'official audio'].join(' ').trim(),
    topic: [base, 'topic'].join(' ').trim(),
    lyrics: [base, 'lyrics'].join(' ').trim()
  };
}

function buildSpotifyDownloadCandidates(track, fallbackQuery) {
  const queriesByMode = buildSpotifySearchQueryVariants(track, fallbackQuery);
  const candidates = [];
  const seen = new Set();

  SPOTIFY_TRACK_SOURCES.forEach((source) => {
    const modes = source.queryModes || ['base'];
    modes.forEach((mode) => {
      const query = queriesByMode[mode] || queriesByMode.base || fallbackQuery;
      if (!query) return;
      const resultIndexes = source.resultIndexesByMode?.[mode] || source.resultIndexes || [1];
      const searchCount = Math.max(...resultIndexes, 1);
      resultIndexes.forEach((resultIndex) => {
        const label = resultIndex > 1 ? `${source.label} #${resultIndex}` : source.label;
        const key = `${source.inputPrefix}:${resultIndex}:${query.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ label, inputPrefix: source.inputPrefix, searchCount, resultIndex, query, displayQuery: query });
      });
    });
  });
  return candidates;
}

async function downloadSpotifyTrack({ ytDlpBin, outputTemplate, expectedOutputFile, quality, ffmpegLocation, track, query, event, sendProgress }) {
  const attempts = [];
  const candidates = buildSpotifyDownloadCandidates(track, query);

  for (const source of candidates) {
    event.sender.send('download:log', `[INFO] Caçando em ${source.label}: ${source.displayQuery || source.query}`);
    const args = buildYtDlpArgs({
      outputTemplate, quality, ffmpegLocation,
      input: `${source.inputPrefix}${source.searchCount}:${source.query}`,
      playlistItems: source.resultIndex
    });
    const code = await runYtDlp(ytDlpBin, args, event, sendProgress);
    if (code === 0) {
      const validation = await validateDownloadedAudioFile({ filePath: expectedOutputFile, ffmpegLocation, expectedDurationMs: track?.durationMs });
      if (!validation.ok) {
        await cleanupInvalidDownloadArtifacts(expectedOutputFile);
        attempts.push(`${source.label}: ${validation.reason}`);
        event.sender.send('download:log', `[AVISO] ${source.label} retornou um arquivo sem audio (${validation.reason}). Tentando outra fonte...`);
        continue;
      }
      event.sender.send('download:log', `[INFO] Fonte encontrada: ${source.label}.`);
      return { ok: true, source: source.label, sources: attempts.concat(source.label) };
    }
    attempts.push(source.label);
    event.sender.send('download:log', `[INFO] ${source.label} não entregou essa faixa. Tentando outra fonte...`);
  }
  return { ok: false, reason: `nenhuma fonte retornou download válido (${attempts.join(', ')})`, sources: attempts };
}

async function cleanupInvalidDownloadArtifacts(filePath) {
  if (!filePath) return;
  const parsed = path.parse(filePath);
  const candidates = [
    filePath,
    ...['jpg', 'jpeg', 'png', 'webp', 'm4a', 'webm', 'part'].map(
      (ext) => path.join(parsed.dir, `${parsed.name}.${ext}`)
    )
  ];
  await Promise.all(candidates.map((c) => fs.promises.unlink(c).catch(() => {})));
}

// ── Metadados MP3 ─────────────────────────────────────────────────────────────

function downloadCoverFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Soundforge' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadCoverFile(res.headers.location, destinationPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Download retornou HTTP ${res.statusCode}.`)); return; }
      const file = fs.createWriteStream(destinationPath);
      res.pipe(file);
      file.on('finish', () => { file.close(resolve); });
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += decodeBuffer(chunk); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Processo finalizou com código ${code}.`));
    });
  });
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

  const args = ['-y', '-i', filePath];
  if (useCover) {
    args.push('-i', coverPath, '-map', '0:a', '-map', '1:v', '-codec', 'copy',
      '-id3v2_version', '3', '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)', '-disposition:v:0', 'attached_pic');
  } else {
    args.push('-map', '0', '-codec', 'copy', '-id3v2_version', '3');
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

module.exports = {
  downloadPause,
  sendPauseState,
  resetPauseState,
  waitIfPaused,
  getPauseState,
  buildYtDlpArgs,
  runYtDlp,
  inspectYoutubeUrl,
  inspectYoutubePlaylistUrl,
  countYoutubePlaylistEntries,
  detectPlaylist,
  downloadSpotifyTrack,
  buildSpotifyDownloadCandidates,
  cleanupInvalidDownloadArtifacts,
  writeMp3Metadata,
  downloadCoverFile,
  runProcess
};
