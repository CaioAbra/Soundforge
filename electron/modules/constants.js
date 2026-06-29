const { app } = require('electron');

const isDev = !app.isPackaged;
const APP_PROTOCOL = 'soundforge';
const SPOTIFY_REDIRECT_URI = `${APP_PROTOCOL}://spotify/callback`;
const SPOTIFY_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'];
const ENV_SPOTIFY_CLIENT_ID = process.env.SOUNDFORGE_SPOTIFY_CLIENT_ID || '';

const SPOTIFY_TRACK_SOURCES = [
  {
    label: 'YouTube',
    inputPrefix: 'ytsearch',
    resultIndexes: [1, 2, 3],
    resultIndexesByMode: {
      'official-audio': [1],
      topic: [1],
      lyrics: [1],
      base: [1, 2, 3]
    },
    queryModes: ['official-audio', 'topic', 'base', 'lyrics']
  },
  {
    label: 'SoundCloud',
    inputPrefix: 'scsearch',
    resultIndexes: [1, 2, 3],
    queryModes: ['base']
  },
  {
    label: 'Google Video',
    inputPrefix: 'gvsearch',
    resultIndexes: [1],
    queryModes: ['base']
  },
  {
    label: 'Yahoo Video',
    inputPrefix: 'yvsearch',
    resultIndexes: [1],
    queryModes: ['base']
  }
];

module.exports = {
  isDev,
  APP_PROTOCOL,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
  ENV_SPOTIFY_CLIENT_ID,
  SPOTIFY_TRACK_SOURCES
};
