import { useCallback, useState } from 'react';

/**
 * Gerencia estado e handlers relacionados ao Spotify:
 * - Autenticação (PKCE, token manual)
 * - Preview de playlist
 * - Configurações do Client ID
 */
export function useSpotify({ setStatus }) {
  const [spotifyToken, setSpotifyToken] = useState('');
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('');
  const [spotifyLoginUrl, setSpotifyLoginUrl] = useState('');
  const [hasDefaultSpotifyClientId, setHasDefaultSpotifyClientId] = useState(false);
  const [tokenSaveState, setTokenSaveState] = useState('');
  const [spotifyTestState, setSpotifyTestState] = useState('');
  const [redirectCopyState, setRedirectCopyState] = useState('');
  const [hasSavedSpotifyToken, setHasSavedSpotifyToken] = useState(false);
  const [hasSpotifyAuth, setHasSpotifyAuth] = useState(false);
  const [spotifyPlaylistUrl, setSpotifyPlaylistUrl] = useState('');
  const [spotifyPreview, setSpotifyPreview] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // ── IPC subscription ────────────────────────────────────────────────────────
  const subscribeSpotifyEvents = useCallback(() => {
    if (!window.soundforge) return () => {};

    const unsubSpotifyAuth = window.soundforge.onSpotifyAuthComplete?.((result) => {
      if (result?.connected) {
        setHasSpotifyAuth(true);
        setSpotifyLoginUrl('');
        setTokenSaveState('Spotify conectado. O Soundforge renovará a sessão automaticamente.');
        return;
      }
      setTokenSaveState(result?.error || 'Não consegui concluir o login Spotify.');
    });

    return () => { unsubSpotifyAuth?.(); };
  }, []);

  // ── Inicialização de settings ───────────────────────────────────────────────
  const loadSpotifySettings = useCallback((settings) => {
    if (settings?.spotifyClientId) setSpotifyClientId(settings.spotifyClientId);
    if (settings?.spotifyRedirectUri) setSpotifyRedirectUri(settings.spotifyRedirectUri);
    setHasDefaultSpotifyClientId(Boolean(settings?.hasDefaultSpotifyClientId));
    if (settings?.hasSpotifyAuth) {
      setHasSpotifyAuth(true);
      setTokenSaveState('Spotify conectado neste computador.');
    }
    if (settings?.hasSavedSpotifyToken) {
      setHasSavedSpotifyToken(true);
      if (!settings?.hasSpotifyAuth) setTokenSaveState('Token salvo neste computador.');
    }
    if (settings?.spotifyToken) {
      setSpotifyToken(settings.spotifyToken);
      setHasSavedSpotifyToken(true);
      if (!settings?.hasSpotifyAuth) setTokenSaveState('Token carregado deste computador.');
    }
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSaveSpotifyToken = useCallback(async () => {
    if (!window.soundforge?.saveSpotifyToken || !spotifyToken.trim()) return;
    setTokenSaveState('Salvando token...');
    try {
      await window.soundforge.saveSpotifyToken(spotifyToken.trim());
      setHasSavedSpotifyToken(true);
      setTokenSaveState('Token salvo neste computador.');
    } catch {
      setTokenSaveState('Não consegui salvar o token.');
    }
  }, [spotifyToken]);

  const handleSaveSpotifyClientId = useCallback(async () => {
    if (!window.soundforge?.saveSpotifyClientId || !spotifyClientId.trim()) return;
    setTokenSaveState('Salvando Client ID...');
    try {
      await window.soundforge.saveSpotifyClientId(spotifyClientId.trim());
      setTokenSaveState('Client ID salvo. Você já pode conectar o Spotify.');
    } catch {
      setTokenSaveState('Não consegui salvar o Client ID.');
    }
  }, [spotifyClientId]);

  const handleConnectSpotify = useCallback(async () => {
    if (!window.soundforge?.startSpotifyLogin) return;
    setTokenSaveState('Gerando link de login do Spotify...');
    try {
      const result = await window.soundforge.startSpotifyLogin(spotifyClientId.trim());
      setSpotifyLoginUrl(result?.authUrl || '');
      if (result?.authUrl) await window.soundforge.openExternal?.(result.authUrl);
      setTokenSaveState('Login aberto no navegador. Se não abrir, use o botão de login abaixo.');
    } catch (err) {
      setTokenSaveState(err?.message || 'Não consegui conectar o Spotify.');
    }
  }, [spotifyClientId]);

  const handleOpenSpotifyLoginUrl = useCallback(async () => {
    if (!spotifyLoginUrl || !window.soundforge?.openExternal) return;
    await window.soundforge.openExternal(spotifyLoginUrl);
  }, [spotifyLoginUrl]);

  const handleCopyRedirectUri = useCallback(async () => {
    if (!spotifyRedirectUri) return;
    setRedirectCopyState('Copiando...');
    try {
      if (window.soundforge?.copyText) await window.soundforge.copyText(spotifyRedirectUri);
      else await navigator.clipboard.writeText(spotifyRedirectUri);
      setRedirectCopyState('Redirect URI copiado.');
    } catch {
      setRedirectCopyState('Não consegui copiar automaticamente.');
    }
  }, [spotifyRedirectUri]);

  const handleTestSpotifyConnection = useCallback(async () => {
    if (!window.soundforge?.testSpotifyConnection) return;
    setSpotifyTestState('Testando conexão...');
    try {
      const result = await window.soundforge.testSpotifyConnection(spotifyToken.trim());
      setSpotifyTestState(result?.name ? `Conexão OK: ${result.name}.` : 'Conexão Spotify OK.');
      setHasSpotifyAuth((current) => current || Boolean(result?.ok && !spotifyToken.trim()));
    } catch (err) {
      setSpotifyTestState(err?.message || 'Não consegui validar o Spotify agora.');
    }
  }, [spotifyToken]);

  const handleDisconnectSpotify = useCallback(async () => {
    if (!window.soundforge?.disconnectSpotify) return;
    setTokenSaveState('Desconectando Spotify...');
    try {
      await window.soundforge.disconnectSpotify();
      setHasSpotifyAuth(false);
      setTokenSaveState('Spotify desconectado deste computador.');
    } catch {
      setTokenSaveState('Não consegui desconectar o Spotify.');
    }
  }, []);

  const handleClearSpotifyToken = useCallback(async () => {
    if (!window.soundforge?.clearSpotifyToken) return;
    setTokenSaveState('Removendo token...');
    try {
      await window.soundforge.clearSpotifyToken();
      setSpotifyToken('');
      setHasSavedSpotifyToken(false);
      setTokenSaveState('Token removido deste computador.');
    } catch {
      setTokenSaveState('Não consegui remover o token.');
    }
  }, []);

  const handleSpotifyPreview = useCallback(async () => {
    if (!window.soundforge || isPreviewing) return;
    if (!spotifyPlaylistUrl.trim()) return;
    setPreviewError('');
    setIsPreviewing(true);
    try {
      const data = await window.soundforge.getSpotifyPreview({
        spotifyToken: spotifyToken.trim(),
        spotifyPlaylistUrl: spotifyPlaylistUrl.trim()
      });
      setSpotifyPreview(data);
    } catch (err) {
      setSpotifyPreview(null);
      setPreviewError(err?.message || 'Falha ao buscar prévia da playlist.');
    } finally {
      setIsPreviewing(false);
    }
  }, [spotifyPlaylistUrl, spotifyToken, isPreviewing]);

  return {
    spotifyToken, setSpotifyToken,
    spotifyClientId, setSpotifyClientId,
    spotifyRedirectUri,
    spotifyLoginUrl,
    hasDefaultSpotifyClientId,
    tokenSaveState, setTokenSaveState,
    spotifyTestState,
    redirectCopyState,
    hasSavedSpotifyToken,
    hasSpotifyAuth,
    spotifyPlaylistUrl, setSpotifyPlaylistUrl,
    spotifyPreview, setSpotifyPreview,
    isPreviewing,
    previewError,
    loadSpotifySettings,
    subscribeSpotifyEvents,
    handleSaveSpotifyToken,
    handleSaveSpotifyClientId,
    handleConnectSpotify,
    handleOpenSpotifyLoginUrl,
    handleCopyRedirectUri,
    handleTestSpotifyConnection,
    handleDisconnectSpotify,
    handleClearSpotifyToken,
    handleSpotifyPreview
  };
}
