const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { normalizeSpotifyClientId, normalizeSpotifyToken } = require('./utils');
const { ENV_SPOTIFY_CLIENT_ID } = require('./constants');

const SECRET_VERSION = 1;

function isEncryptedSecret(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.version === SECRET_VERSION &&
    value.encoding === 'base64' &&
    typeof value.value === 'string'
  );
}

async function hasSecureSecretStorage() {
  if (!safeStorage) return false;
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    return false;
  }
  if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
    return safeStorage.isAsyncEncryptionAvailable();
  }
  return safeStorage.isEncryptionAvailable();
}

async function encryptSecretString(value) {
  const plainText = String(value || '');
  if (!plainText) return null;
  if (!(await hasSecureSecretStorage())) {
    throw new Error('Armazenamento seguro indisponivel para salvar segredos locais.');
  }

  const encrypted = typeof safeStorage.encryptStringAsync === 'function'
    ? await safeStorage.encryptStringAsync(plainText)
    : safeStorage.encryptString(plainText);

  return {
    version: SECRET_VERSION,
    encoding: 'base64',
    value: encrypted.toString('base64')
  };
}

async function decryptSecretString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (!isEncryptedSecret(value)) return '';

  try {
    const encrypted = Buffer.from(value.value, 'base64');
    if (typeof safeStorage.decryptStringAsync === 'function') {
      const result = await safeStorage.decryptStringAsync(encrypted);
      return result?.result || '';
    }
    return safeStorage.decryptString(encrypted);
  } catch {
    return '';
  }
}

async function encryptSecretJson(value) {
  if (!value) return null;
  return encryptSecretString(JSON.stringify(value));
}

async function decryptSecretJson(value) {
  if (!value) return null;
  if (typeof value === 'object' && !isEncryptedSecret(value)) return value;

  const plainText = await decryptSecretString(value);
  if (!plainText) return null;
  try {
    const parsed = JSON.parse(plainText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getUserSettingsPath() {
  return path.join(app.getPath('userData'), 'soundforge-settings.json');
}

function getDefaultSpotifyClientId() {
  if (ENV_SPOTIFY_CLIENT_ID) return ENV_SPOTIFY_CLIENT_ID;
  try {
    const packageJson = require(path.join(__dirname, '..', '..', 'package.json'));
    return normalizeSpotifyClientId(packageJson?.soundforge?.spotifyClientId);
  } catch {
    return '';
  }
}

async function readUserSettings() {
  try {
    const raw = await fs.promises.readFile(getUserSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const secrets = parsed.secrets && typeof parsed.secrets === 'object' ? parsed.secrets : {};
    const spotifyToken = await decryptSecretString(secrets.spotifyToken ?? parsed.spotifyToken);
    const spotifyAuth = await decryptSecretJson(secrets.spotifyAuth ?? parsed.spotifyAuth);

    return {
      spotifyToken: normalizeSpotifyToken(spotifyToken),
      spotifyClientId: typeof parsed.spotifyClientId === 'string' ? parsed.spotifyClientId : '',
      spotifyAuth
    };
  } catch {
    return { spotifyToken: '', spotifyClientId: '', spotifyAuth: null };
  }
}

async function writeUserSettings(settings) {
  const settingsPath = getUserSettingsPath();
  const serialized = {
    spotifyClientId: normalizeSpotifyClientId(settings.spotifyClientId),
    secrets: {
      spotifyToken: await encryptSecretString(normalizeSpotifyToken(settings.spotifyToken)),
      spotifyAuth: await encryptSecretJson(settings.spotifyAuth)
    }
  };

  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.promises.writeFile(settingsPath, `${JSON.stringify(serialized, null, 2)}\n`, 'utf8');
}

module.exports = {
  getUserSettingsPath,
  getDefaultSpotifyClientId,
  readUserSettings,
  writeUserSettings,
  hasSecureSecretStorage
};
