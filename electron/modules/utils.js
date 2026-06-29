const iconv = require('iconv-lite');
const crypto = require('crypto');

/** Tenta decodificar um valor percent-encoded; retorna o original em caso de erro. */
function safeDecode(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Decodifica um Buffer priorizando UTF-8; cai para latin1 se houver caracteres corrompidos. */
function decodeBuffer(buffer) {
  if (!buffer) return '';
  const utf8Text = buffer.toString('utf8');
  if (!utf8Text.includes('?')) return utf8Text;
  const latin1Text = iconv.decode(buffer, 'latin1');
  return latin1Text || utf8Text;
}

/** Remove "Bearer " do início de um token Spotify. */
function normalizeSpotifyToken(token) {
  return String(token || '').trim().replace(/^Bearer\s+/i, '').trim();
}

/** Normaliza um client ID do Spotify (trim). */
function normalizeSpotifyClientId(clientId) {
  return String(clientId || '').trim();
}

/** Remove caracteres inválidos de nomes de arquivo/pasta. */
function sanitizeFileComponent(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
}

/** Converte um Buffer para base64url (sem padding). */
function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** Gera o PKCE verifier aleatório. */
function makeSpotifyVerifier() {
  return base64Url(crypto.randomBytes(64));
}

/** Gera o PKCE challenge a partir do verifier. */
function makeSpotifyChallenge(verifier) {
  return base64Url(crypto.createHash('sha256').update(verifier).digest());
}

module.exports = {
  safeDecode,
  decodeBuffer,
  normalizeSpotifyToken,
  normalizeSpotifyClientId,
  sanitizeFileComponent,
  base64Url,
  makeSpotifyVerifier,
  makeSpotifyChallenge
};
