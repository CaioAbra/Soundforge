const { ipcMain, dialog, clipboard, app } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { isDev, SPOTIFY_REDIRECT_URI } = require('./constants');
const { normalizeSpotifyToken, normalizeSpotifyClientId } = require('./utils');
const { readUserSettings, writeUserSettings, getDefaultSpotifyClientId } = require('./settings');
const { getToolsStatus, ensureYtDlpBinary, getCachedFfmpegLocation } = require('./tools');
const {
  extractSpotifyPlaylistId,
  fetchSpotifyPlaylistWithBestAuth,
  connectSpotifyAccount,
  startSpotifyLogin,
  fetchSpotifyApi,
  resolveSpotifyAccessToken
} = require('./spotify');
const {
  resetPauseState,
  waitIfPaused,
  sendPauseState,
  downloadPause,
  buildYtDlpArgs,
  runYtDlp,
  inspectYoutubePlaylistUrl,
  detectPlaylist,
  downloadSpotifyTrack,
  writeMp3Metadata
} = require('./download');
const { sanitizeFileComponent } = require('./utils');
const { buildSpotifyQuery, buildSpotifyOutputBase } = require('./spotify');
const { getMainWindow } = require('./window');

function isTrustedIpcEvent(event) {
  const win = getMainWindow();
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;

  const frameUrl = event.senderFrame?.url || event.sender.getURL();
  try {
    const parsed = new URL(frameUrl);
    if (isDev) return parsed.origin === 'http://localhost:5173';
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

function assertTrustedIpcEvent(event) {
  if (!isTrustedIpcEvent(event)) {
    throw new Error('Origem IPC nao autorizada.');
  }
}

function trustedHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcEvent(event);
    return handler(event, ...args);
  });
}

function registerIpcHandlers() {
  // ── Sistema / Utilitários ────────────────────────────────────────────────

  trustedHandle('update:restart-and-install', () => {
    if (isDev) return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

  trustedHandle('tools:status', () => getToolsStatus());

  trustedHandle('clipboard:write-text', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  trustedHandle('select-output-dir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  trustedHandle('settings:get', async () => {
    const settings = await readUserSettings();
    return {
      spotifyToken: '',
      spotifyClientId: settings.spotifyClientId,
      hasSavedSpotifyToken: Boolean(settings.spotifyToken),
      hasDefaultSpotifyClientId: Boolean(getDefaultSpotifyClientId()),
      hasSpotifyAuth: Boolean(settings.spotifyAuth?.refreshToken),
      spotifyAuthExpiresAt: settings.spotifyAuth?.expiresAt || null,
      spotifyRedirectUri: SPOTIFY_REDIRECT_URI,
      appVersion: app.getVersion()
    };
  });

  trustedHandle('settings:save-spotify-token', async (_event, token) => {
    const spotifyToken = normalizeSpotifyToken(token);
    const settings = await readUserSettings();
    await writeUserSettings({ ...settings, spotifyToken });
    return { saved: true, hasSpotifyToken: Boolean(spotifyToken) };
  });

  trustedHandle('settings:save-spotify-client-id', async (_event, clientId) => {
    const spotifyClientId = normalizeSpotifyClientId(clientId);
    const settings = await readUserSettings();
    await writeUserSettings({ ...settings, spotifyClientId });
    return { saved: true, hasSpotifyClientId: Boolean(spotifyClientId) };
  });

  trustedHandle('settings:clear-spotify-token', async () => {
    const settings = await readUserSettings();
    await writeUserSettings({ ...settings, spotifyToken: '' });
    return { saved: true, hasSpotifyToken: false };
  });

  // ── Spotify ───────────────────────────────────────────────────────────────

  trustedHandle('spotify:connect', async (_event, clientId) => {
    return connectSpotifyAccount(clientId);
  });

  trustedHandle('spotify:start-login', async (event, clientId) => {
    return startSpotifyLogin(clientId, event.sender);
  });

  trustedHandle('open-external', async (_event, url) => {
    const { shell } = require('electron');
    const target = String(url || '');
    if (!/^https:\/\/accounts\.spotify\.com\/authorize\?/i.test(target)) return false;
    await shell.openExternal(target);
    return true;
  });

  trustedHandle('spotify:disconnect', async () => {
    const settings = await readUserSettings();
    await writeUserSettings({ ...settings, spotifyAuth: null });
    return { connected: false };
  });

  trustedHandle('spotify:test-connection', async (_event, manualToken = '') => {
    const accessToken = await resolveSpotifyAccessToken(manualToken);
    const profile = await fetchSpotifyApi('/v1/me', accessToken);
    return {
      ok: true,
      id: profile?.id || '',
      name: profile?.display_name || profile?.id || 'Conta Spotify',
      product: profile?.product || ''
    };
  });

  trustedHandle('spotify:preview', async (_event, payload) => {
    const { spotifyToken, spotifyPlaylistUrl } = payload || {};
    if (!spotifyPlaylistUrl) throw new Error('Link da playlist do Spotify é obrigatório.');
    const playlistId = extractSpotifyPlaylistId(spotifyPlaylistUrl);
    if (!playlistId) throw new Error('Não foi possível identificar o ID da playlist do Spotify.');
    return fetchSpotifyPlaylistWithBestAuth(spotifyToken, playlistId, 50);
  });

  // ── Pausa/Retomada ────────────────────────────────────────────────────────

  trustedHandle('download:pause', () => {
    if (!downloadPause.active) return { ok: false, state: 'idle' };
    downloadPause.pauseRequested = true;
    if (downloadPause.paused) { sendPauseState('paused'); return { ok: true, state: 'paused' }; }
    sendPauseState('pausing');
    downloadPause.sender?.send('download:log', '[INFO] Pausa solicitada. Vou terminar a faixa atual antes de parar.');
    return { ok: true, state: 'pausing' };
  });

  trustedHandle('download:resume', () => {
    if (!downloadPause.active) return { ok: false, state: 'idle' };
    downloadPause.pauseRequested = false;
    if (downloadPause.resume) downloadPause.resume();
    sendPauseState('running');
    return { ok: true, state: 'running' };
  });

  // ── Download principal ────────────────────────────────────────────────────

  ipcMain.on('download:start', async (event, payload) => {
    if (!isTrustedIpcEvent(event)) return;
    try {
      resetPauseState(event.sender);
      const { source = 'youtube', url, outputDir, quality, spotifyToken, spotifyPlaylistUrl } = payload;

      if (source === 'spotify') {
        if (!spotifyPlaylistUrl || !outputDir) {
          event.sender.send('download:error', 'Link da playlist do Spotify e pasta de destino são obrigatórios.');
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
        event.sender.send('download:error', 'Não foi possível preparar o yt-dlp automaticamente. Verifique sua conexão ou configure YTDLP_BIN.');
        resetPauseState(null);
        return;
      }

      const ffmpegLocation = getCachedFfmpegLocation();
      if (!ffmpegLocation) {
        event.sender.send('download:log', '[AVISO] ffmpeg/ffprobe não encontrados. Coloque em resources/ffmpeg/ para evitar erro pós-download.');
      }

      const progressState = { percent: 0, speed: '', eta: '', title: '', itemIndex: null, itemCount: null };
      const sendProgress = (partial) => {
        Object.assign(progressState, partial);
        event.sender.send('download:progress', progressState);
      };

      // ── Spotify ──────────────────────────────────────────────────────────
      if (source === 'spotify') {
        const playlistId = extractSpotifyPlaylistId(spotifyPlaylistUrl);
        if (!playlistId) { event.sender.send('download:error', 'Não foi possível identificar o ID da playlist do Spotify.'); resetPauseState(null); return; }

        event.sender.send('download:log', '[INFO] Buscando faixas da playlist no Spotify...');
        const playlistData = await fetchSpotifyPlaylistWithBestAuth(spotifyToken, playlistId);
        const spotifyTracks = playlistData.tracks || [];
        const playlistName = playlistData.name || 'Spotify Playlist';

        if (spotifyTracks.length === 0) { event.sender.send('download:error', 'Não encontrei faixas na playlist.'); resetPauseState(null); return; }

        sendProgress({ itemIndex: 0, itemCount: spotifyTracks.length });
        const safeFolder = sanitizeFileComponent(playlistName);
        const baseFolder = path.join(outputDir, safeFolder || 'Spotify Playlist');
        const downloadedTracks = [];
        const skippedTracks = [];

        for (let index = 0; index < spotifyTracks.length; index += 1) {
          await waitIfPaused(event);
          const track = spotifyTracks[index];
          const query = buildSpotifyQuery(track);
          sendProgress({ itemIndex: index + 1, itemCount: spotifyTracks.length, title: track.name || query });

          const indexPrefix = String(index + 1).padStart(2, '0');
          const outputBase = buildSpotifyOutputBase(track, indexPrefix);
          const outputTemplate = path.join(baseFolder, `${outputBase}.%(ext)s`);
          const outputFile = path.join(baseFolder, `${outputBase}.mp3`);
          const downloaded = await downloadSpotifyTrack({ ytDlpBin, outputTemplate, expectedOutputFile: outputFile, quality, ffmpegLocation, track, query, event, sendProgress });

          if (!downloaded.ok) {
            const skippedTrack = { index: index + 1, name: track.name || query, artists: Array.isArray(track.artists) ? track.artists : [], query, reason: downloaded.reason, sources: downloaded.sources };
            skippedTracks.push(skippedTrack);
            event.sender.send('download:track-skipped', skippedTrack);
            event.sender.send('download:log', `[AVISO] Faixa pulada: ${query}. Motivo: ${downloaded.reason}`);
            continue;
          }

          await writeMp3Metadata({ ffmpegLocation, filePath: outputFile, track, playlistName, trackNumber: index + 1, trackTotal: spotifyTracks.length, coverUrl: track.coverUrl, event });

          const downloadedTrack = { index: index + 1, name: track.name || query, artists: Array.isArray(track.artists) ? track.artists : [], source: downloaded.source, filePath: outputFile };
          downloadedTracks.push(downloadedTrack);
          event.sender.send('download:track-complete', downloadedTrack);
        }

        sendProgress({ percent: 100 });
        event.sender.send('download:complete', { isPlaylist: true, downloadedTracks, skippedTracks });
        resetPauseState(null);
        return;
      }

      // ── YouTube / URL ─────────────────────────────────────────────────────
      const youtubePlaylistInfo = await inspectYoutubePlaylistUrl(finalUrl, ytDlpBin, event, sendProgress);
      const isPlaylist = youtubePlaylistInfo.isPlaylist || await detectPlaylist(finalUrl, ytDlpBin);
      const outputTemplate = isPlaylist
        ? path.join(outputDir, '%(playlist_title)s', '%(title)s.%(ext)s')
        : path.join(outputDir, '%(title)s.%(ext)s');

      if (isPlaylist && youtubePlaylistInfo.itemCount) {
        for (let index = 1; index <= youtubePlaylistInfo.itemCount; index += 1) {
          await waitIfPaused(event);
          sendProgress({ itemIndex: index, itemCount: youtubePlaylistInfo.itemCount, percent: 0, speed: '', eta: '' });
          const args = buildYtDlpArgs({ outputTemplate, quality, ffmpegLocation, input: finalUrl, yesPlaylist: true, playlistItems: index });
          const code = await runYtDlp(ytDlpBin, args, event, sendProgress, { itemIndex: index, itemCount: youtubePlaylistInfo.itemCount });
          if (code !== 0) event.sender.send('download:log', `[AVISO] Item ${index} não foi baixado. Seguindo para o próximo.`);
        }
        sendProgress({ percent: 100 });
        event.sender.send('download:complete', { isPlaylist });
        resetPauseState(null);
        return;
      }

      const args = buildYtDlpArgs({ outputTemplate, quality, ffmpegLocation, input: finalUrl, yesPlaylist: isPlaylist, singleTrackNumber: isPlaylist ? null : 1 });
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
}

module.exports = { registerIpcHandlers };
