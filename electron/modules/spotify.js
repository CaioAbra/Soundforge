const { shell } = require('electron');
const https = require('https');
const crypto = require('crypto');
const {
  normalizeSpotifyToken,
  normalizeSpotifyClientId,
  base64Url,
  makeSpotifyVerifier,
  makeSpotifyChallenge
} = require('./utils');
const { readUserSettings, writeUserSettings, getDefaultSpotifyClientId } = require('./settings');
const { SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } = require('./constants');

// ── Estado local do módulo ───────────────────────────────────────────────────
let pendingSpotifyCallback = null;

// ── Parsing de URLs ──────────────────────────────────────────────────────────

function extractSpotifyPlaylistId(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  const trimmed = inputUrl.trim();
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname.includes('spotify.com')) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'playlist');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  } catch {
    return null;
  }
  return null;
}

/** Chamado pela camada de window quando chega um deep-link spotify://. */
function handleSpotifyProtocolUrl(callbackUrl) {
  if (!pendingSpotifyCallback) return false;
  try {
    const url = new URL(callbackUrl);
    if (url.protocol !== 'soundforge:' || url.hostname !== 'spotify' || url.pathname !== '/callback') {
      return false;
    }
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    pendingSpotifyCallback.finish({ state, code, error });
    return true;
  } catch (err) {
    pendingSpotifyCallback.finish({ error: err.message || 'callback inválido' });
    return false;
  }
}

// ── PKCE / Auth ───────────────────────────────────────────────────────────────

function buildSpotifyLoginRequest(clientId) {
  const verifier = makeSpotifyVerifier();
  const challenge = makeSpotifyChallenge(verifier);
  const state = base64Url(crypto.randomBytes(24));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SPOTIFY_SCOPES.join(' '),
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state
  });
  return { verifier, state, authUrl: `https://accounts.spotify.com/authorize?${params.toString()}` };
}

function waitForSpotifyProtocolCallback(expectedState) {
  return new Promise((resolve, reject) => {
    if (pendingSpotifyCallback) {
      pendingSpotifyCallback.reject(new Error('Um login Spotify anterior foi substituido por uma nova tentativa.'));
    }
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingSpotifyCallback = null;
      reject(new Error('Tempo esgotado esperando o login do Spotify.'));
    }, 5 * 60 * 1000);

    const finish = ({ state, code, error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingSpotifyCallback = null;
      if (state !== expectedState) { reject(new Error('O retorno do Spotify nao confere com a sessao iniciada.')); return; }
      if (error) { reject(new Error(`Login Spotify cancelado ou recusado: ${error}.`)); return; }
      if (!code) { reject(new Error('O Spotify nao retornou o codigo de autorizacao.')); return; }
      resolve(code);
    };

    pendingSpotifyCallback = { finish, reject };
  });
}

function requestSpotifyToken(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(parseSpotifyApiError(data) || `Spotify Auth retornou HTTP ${res.statusCode}.`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function buildSpotifyAuth(tokenData, clientId, previousAuth = null) {
  const accessToken = tokenData?.access_token || '';
  const refreshToken = tokenData?.refresh_token || previousAuth?.refreshToken || '';
  const expiresIn = Number(tokenData?.expires_in || 3600);
  if (!accessToken || !refreshToken) {
    throw new Error('O Spotify não retornou uma sessão completa para o Soundforge.');
  }
  return {
    clientId,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000
  };
}

async function resolveSpotifyAccessToken(manualToken = '') {
  const token = normalizeSpotifyToken(manualToken);
  const settings = await readUserSettings();
  const auth = settings.spotifyAuth;

  if (auth?.accessToken && Number(auth.expiresAt || 0) > Date.now() + 60000) return auth.accessToken;

  if (auth?.refreshToken && settings.spotifyClientId) {
    try {
      const tokenData = await requestSpotifyToken({
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
        client_id: settings.spotifyClientId
      });
      const nextAuth = buildSpotifyAuth(tokenData, settings.spotifyClientId, auth);
      await writeUserSettings({ ...settings, spotifyAuth: nextAuth });
      return nextAuth.accessToken;
    } catch (err) {
      if (token) return token;
      err.publicFallback = true;
      throw err;
    }
  }

  if (token) return token;
  const err = new Error('Sem sessão Spotify. Tentando ler a prévia pública da playlist.');
  err.publicFallback = true;
  throw err;
}

async function connectSpotifyAccount(clientIdOverride = '') {
  const settings = await readUserSettings();
  const clientId =
    normalizeSpotifyClientId(clientIdOverride) ||
    normalizeSpotifyClientId(settings.spotifyClientId) ||
    getDefaultSpotifyClientId();
  if (!clientId) throw new Error('Salve o Client ID do Spotify antes de conectar a conta.');

  const login = buildSpotifyLoginRequest(clientId);
  const callbackPromise = waitForSpotifyProtocolCallback(login.state);
  await shell.openExternal(login.authUrl);
  const code = await callbackPromise;
  const tokenData = await requestSpotifyToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: clientId,
    code_verifier: login.verifier
  });
  const spotifyAuth = buildSpotifyAuth(tokenData, clientId, settings.spotifyAuth);
  await writeUserSettings({ ...settings, spotifyClientId: clientId, spotifyAuth });
  return { connected: true, expiresAt: spotifyAuth.expiresAt, redirectUri: SPOTIFY_REDIRECT_URI };
}

async function startSpotifyLogin(clientIdOverride = '', sender = null) {
  const settings = await readUserSettings();
  const clientId =
    normalizeSpotifyClientId(clientIdOverride) ||
    normalizeSpotifyClientId(settings.spotifyClientId) ||
    getDefaultSpotifyClientId();
  if (!clientId) throw new Error('Salve o Client ID do Spotify antes de conectar a conta.');

  const login = buildSpotifyLoginRequest(clientId);
  waitForSpotifyProtocolCallback(login.state)
    .then(async (code) => {
      const tokenData = await requestSpotifyToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: clientId,
        code_verifier: login.verifier
      });
      const spotifyAuth = buildSpotifyAuth(tokenData, clientId, settings.spotifyAuth);
      await writeUserSettings({ ...settings, spotifyClientId: clientId, spotifyAuth });
      if (sender && !sender.isDestroyed()) {
        sender.send('spotify:auth-complete', {
          connected: true,
          expiresAt: spotifyAuth.expiresAt,
          redirectUri: SPOTIFY_REDIRECT_URI
        });
      }
    })
    .catch((err) => {
      if (sender && !sender.isDestroyed()) {
        sender.send('spotify:auth-complete', {
          connected: false,
          error: err?.message || 'Não consegui concluir o login Spotify.'
        });
      }
    });

  return { authUrl: login.authUrl, state: login.state, redirectUri: SPOTIFY_REDIRECT_URI };
}

// ── Spotify API ───────────────────────────────────────────────────────────────

function parseSpotifyApiError(data) {
  try {
    const parsed = JSON.parse(data);
    return parsed?.error?.message || parsed?.error_description || '';
  } catch { return ''; }
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
  if (statusCode === 400) return makeError(spotifyMessage || 'A requisição para o Spotify não foi aceita. Confira se você colou um access token válido, não o Client ID ou Client Secret.');
  if (statusCode === 401) return makeError('Token do Spotify expirou ou é inválido. Gere um access token novo e cole somente o token, com ou sem "Bearer".');
  if (statusCode === 403) return makeError(spotifyMessage || 'O token do Spotify não tem permissão para ler essa playlist.');
  if (statusCode === 404) {
    const suffix = context.playlistId ? ` ID lido: ${context.playlistId}.` : '';
    return makeError(`O Spotify não liberou essa playlist pela Web API ou ela não existe para esse token.${suffix} Playlists algorítmicas/editoriais do Spotify podem retornar 404 mesmo abrindo no navegador.`);
  }
  if (statusCode === 429) return makeError('O Spotify limitou as requisições agora. Aguarde um pouco e tente novamente.');
  return makeError(spotifyMessage || `Spotify API retornou HTTP ${statusCode}.`);
}

function fetchSpotifyApi(endpoint, token, context = {}) {
  return new Promise((resolve, reject) => {
    const accessToken = normalizeSpotifyToken(token);
    const req = https.request({
      hostname: 'api.spotify.com',
      path: endpoint,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(buildSpotifyApiError(res.statusCode, data, context)); return; }
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

// ── Playlists ─────────────────────────────────────────────────────────────────

function selectSpotifyImageUrl(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  const sorted = images.filter((img) => img?.url).sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
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

function parseSpotifyEmbedDurationMs(track) {
  const candidates = [
    track?.duration_ms, track?.durationMs,
    track?.duration?.totalMilliseconds, track?.duration?.milliseconds,
    track?.duration?.ms, track?.trackDuration
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

async function fetchSpotifyPlaylistFromApi(token, playlistId, maxTracks = null) {
  const playlist = await fetchSpotifyApi(`/v1/playlists/${playlistId}?fields=name`, token, { playlistId });
  const tracks = [];
  let offset = 0;
  const limit = 100;
  let total = 0;

  while (true) {
    const data = await fetchSpotifyApi(
      `/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=items(track(name,duration_ms,artists(name),album(name,images(url,width,height)))),total`,
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
      const durationMs = Number(item.track.duration_ms || 0);
      if (name) tracks.push({ name, artists, albumName, coverUrl, durationMs });
    });
    if (maxTracks && tracks.length >= maxTracks) { tracks.length = maxTracks; break; }
    offset += limit;
    if (!data.total || offset >= data.total || items.length === 0) break;
  }
  return { name: playlist?.name, tracks, total };
}

function fetchSpotifyEmbedHtml(playlistId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'open.spotify.com',
      path: `/embed/playlist/${encodeURIComponent(playlistId)}`,
      method: 'GET',
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Soundforge' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`Spotify embed retornou HTTP ${res.statusCode}.`)); return; }
        resolve(data);
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function fetchSpotifyEmbedPlaylist(playlistId, maxTracks = null) {
  const html = await fetchSpotifyEmbedHtml(playlistId);
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('O Spotify bloqueou a API e não consegui ler a prévia pública da playlist.');

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
      coverUrl: selectSpotifyEmbedImageUrl(track),
      durationMs: parseSpotifyEmbedDurationMs(track)
    }))
    .filter((track) => track.name);

  if (maxTracks && tracks.length > maxTracks) tracks.length = maxTracks;
  if (tracks.length === 0) throw new Error('O Spotify bloqueou a API e a prévia pública não trouxe faixas.');

  return {
    name: entity?.name || entity?.title || 'Spotify Playlist',
    tracks,
    total: trackList.length || tracks.length
  };
}

async function fetchSpotifyPlaylist(token, playlistId, maxTracks = null) {
  try {
    return await fetchSpotifyPlaylistFromApi(token, playlistId, maxTracks);
  } catch (err) {
    if (err?.statusCode === 404) return fetchSpotifyEmbedPlaylist(playlistId, maxTracks);
    throw err;
  }
}

async function fetchSpotifyPlaylistWithBestAuth(manualToken, playlistId, maxTracks = null) {
  try {
    const accessToken = await resolveSpotifyAccessToken(manualToken);
    return await fetchSpotifyPlaylist(accessToken, playlistId, maxTracks);
  } catch (err) {
    if (err?.publicFallback || [401, 403, 404].includes(Number(err?.statusCode))) {
      return fetchSpotifyEmbedPlaylist(playlistId, maxTracks);
    }
    throw err;
  }
}

// ── Helpers de query/output ───────────────────────────────────────────────────

function buildSpotifyQuery(track) {
  if (!track) return '';
  const artists = Array.isArray(track.artists) ? track.artists.join(' ') : '';
  return `${track.name} ${artists}`.trim();
}

function buildSpotifyOutputBase(track, indexPrefix) {
  const { sanitizeFileComponent } = require('./utils');
  const artists = Array.isArray(track?.artists) ? track.artists.join(', ') : '';
  const title = sanitizeFileComponent(track?.name || 'Faixa');
  const artistSuffix = sanitizeFileComponent(artists);
  const name = artistSuffix ? `${title} - ${artistSuffix}` : title;
  return `${indexPrefix} - ${(name || 'Faixa').slice(0, 150)}`;
}

module.exports = {
  extractSpotifyPlaylistId,
  handleSpotifyProtocolUrl,
  buildSpotifyLoginRequest,
  waitForSpotifyProtocolCallback,
  requestSpotifyToken,
  buildSpotifyAuth,
  resolveSpotifyAccessToken,
  connectSpotifyAccount,
  startSpotifyLogin,
  fetchSpotifyApi,
  fetchSpotifyPlaylist,
  fetchSpotifyPlaylistWithBestAuth,
  fetchSpotifyEmbedPlaylist,
  buildSpotifyQuery,
  buildSpotifyOutputBase,
  selectSpotifyImageUrl,
  selectSpotifyEmbedImageUrl,
  parseSpotifyEmbedDurationMs
};
