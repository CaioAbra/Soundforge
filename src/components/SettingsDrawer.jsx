import React, { useEffect, useRef, useState } from 'react';
import { FiCheck, FiCheckCircle, FiCopy, FiEdit2, FiRefreshCw, FiTool, FiX } from 'react-icons/fi';
import { QUALITY_OPTIONS, TRACK_FILTERS } from '../lib/formatters';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export default function SettingsDrawer({
  appVersion,
  canConnectSpotify,
  denseResults,
  handleClearSpotifyToken,
  handleConnectSpotify,
  handleCopyRedirectUri,
  handleDisconnectSpotify,
  handleOpenSpotifyLoginUrl,
  handleRefreshToolsStatus,
  handleRestartAndInstall,
  handleSaveSpotifyClientId,
  handleSaveSpotifyToken,
  handleSelectFolder,
  handleTestSpotifyConnection,
  hasDefaultSpotifyClientId,
  hasSavedSpotifyToken,
  hasSpotifyAuth,
  isClosing,
  isDownloading,
  logoSoundforge,
  onClose,
  outputDir,
  quality,
  readyUpdate,
  redirectCopyState,
  selectedQualityLabel,
  setQuality,
  setSpotifyClientId,
  setSpotifyToken,
  setTokenSaveState,
  source,
  spotifyAuthLabel,
  spotifyClientId,
  spotifyLoginUrl,
  spotifyRedirectUri,
  spotifyStatusText,
  spotifyTestState,
  spotifyToken,
  tokenSaveState,
  toolRows,
  toolsStatus,
  trackFilter
}) {
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showQualitySettings, setShowQualitySettings] = useState(false);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousActiveElementRef = useRef(null);
  const selectedTrackFilterLabel = TRACK_FILTERS.find((filter) => filter.value === trackFilter)?.label || 'Todas';

  useEffect(() => {
    previousActiveElementRef.current = document.activeElement;
    closeButtonRef.current?.focus();

    return () => {
      const previous = previousActiveElementRef.current;
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = Array.from(drawerRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [])
      .filter((element) => element.offsetParent !== null || element === document.activeElement);

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={`settings-overlay ${isClosing ? 'closing' : ''}`} role="presentation" onClick={onClose} onKeyDown={handleKeyDown}>
      <aside
        ref={drawerRef}
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <p className="eyebrow">Preferências</p>
            <h2 id="settings-title">Configurações</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="Fechar configurações">
            <FiX />
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-header"><span className="settings-label">Geral</span><strong>Soundforge</strong></div>
          <div className="settings-about">
            <img className="settings-about-logo" src={logoSoundforge} alt="Soundforge" />
            <div>
              <p>Forja sonora para baixar MP3 do YouTube e playlists do Spotify, com metadados e atualizações automáticas.</p>
              <div className="settings-summary-grid">
                <span>Fonte ativa</span><strong>{source === 'spotify' ? 'Spotify' : 'YouTube'}</strong>
                <span>Visual das listas</span><strong>{denseResults ? 'Compacto' : 'Confortável'}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-header"><span className="settings-label">Downloads</span><strong>Preferências atuais</strong></div>
          <div className="settings-edit-list">
            <div className="settings-edit-row">
              <div className="settings-edit-main"><span>Qualidade MP3</span><strong>{selectedQualityLabel}</strong></div>
              <button className={`button ghost icon-text-button settings-edit-button ${showQualitySettings ? 'saving' : ''}`} type="button" onClick={() => setShowQualitySettings((value) => !value)}>
                {showQualitySettings ? <FiCheck aria-hidden="true" /> : <FiEdit2 aria-hidden="true" />}
                {showQualitySettings ? 'Salvar' : 'Editar'}
              </button>
            </div>
            {showQualitySettings && (
              <div className="settings-quality-options">
                {QUALITY_OPTIONS.map((option) => (
                  <label key={option.value} className={`radio quality-option ${quality === option.value ? 'active' : ''}`}>
                    <input type="radio" name="settings-quality" value={option.value} checked={quality === option.value} onChange={() => setQuality(option.value)} />
                    <span className="quality-copy"><span className="quality-label">{option.label}</span><span className="quality-detail">{option.detail}</span></span>
                  </label>
                ))}
              </div>
            )}
            <div className="settings-edit-row">
              <div className="settings-edit-main"><span>Local favorito</span><strong>{outputDir || 'Nenhuma pasta escolhida'}</strong></div>
              <button className="button ghost icon-text-button settings-edit-button" type="button" onClick={handleSelectFolder}><FiEdit2 aria-hidden="true" />Editar</button>
            </div>
            <div className="settings-edit-row">
              <div className="settings-edit-main"><span>Filtro de músicas</span><strong>{selectedTrackFilterLabel}</strong></div>
            </div>
          </div>
          <p className="helper">Nome de arquivo, duplicados e subpastas entram na próxima fase de controle de download.</p>
        </div>

        <div className="settings-section">
          <div className="settings-section-header"><span className="settings-label">Spotify</span><strong>{spotifyStatusText}</strong></div>
          <div className="settings-status-card">
            <FiCheckCircle aria-hidden="true" />
            <div><span>{spotifyAuthLabel}</span><p>Sem login, o app tenta ler playlists públicas. Para mais estabilidade, conecte uma conta Spotify.</p></div>
          </div>
          {hasDefaultSpotifyClientId && <p className="helper success">Login Spotify pronto para uso neste build.</p>}
          <label className="label settings-token-label">Client ID próprio do Spotify</label>
          <input className="input" type="text" placeholder="Opcional: cole aqui o Client ID do seu app Spotify" value={spotifyClientId} onChange={(event) => { setSpotifyClientId(event.target.value); setTokenSaveState(''); }} />
          {spotifyRedirectUri && (
            <div className="redirect-row">
              <span>{spotifyRedirectUri}</span>
              <button className="button ghost icon-text-button" type="button" onClick={handleCopyRedirectUri}><FiCopy aria-hidden="true" />Copiar</button>
            </div>
          )}
          {redirectCopyState && <p className={`helper ${redirectCopyState.includes('Não consegui') ? 'error' : 'success'}`}>{redirectCopyState}</p>}
          <div className="settings-actions spotify-actions">
            <button className="button ghost" type="button" onClick={handleSaveSpotifyClientId} disabled={!spotifyClientId.trim() || isDownloading}>Salvar Client ID</button>
            <button className="button update" type="button" onClick={handleConnectSpotify} disabled={!canConnectSpotify || isDownloading}>{hasSpotifyAuth ? 'Reconectar Spotify' : 'Conectar Spotify'}</button>
            <button className="button ghost icon-text-button" type="button" onClick={handleTestSpotifyConnection} disabled={isDownloading || (!hasSpotifyAuth && !hasSavedSpotifyToken && !spotifyToken.trim())}><FiRefreshCw aria-hidden="true" />Testar conexão</button>
            {spotifyLoginUrl && !hasSpotifyAuth && <button className="button ghost" type="button" onClick={handleOpenSpotifyLoginUrl}>Abrir login no Spotify</button>}
            <button className="button danger" type="button" onClick={handleDisconnectSpotify} disabled={!hasSpotifyAuth || isDownloading}>Desconectar</button>
          </div>
          {spotifyTestState && <p className={`helper ${spotifyTestState.includes('Não consegui') || spotifyTestState.includes('expirou') ? 'error' : 'success'}`}>{spotifyTestState}</p>}
          {tokenSaveState && <p className={`helper ${tokenSaveState.includes('Não consegui') ? 'error' : 'success'}`}>{tokenSaveState}</p>}

          <div className="settings-advanced">
            <button className="settings-advanced-toggle" type="button" onClick={() => setShowAdvancedSettings((value) => !value)} aria-expanded={showAdvancedSettings}>
              Avançado
              <span>{showAdvancedSettings ? 'Ocultar token manual' : 'Token manual'}</span>
            </button>
            {showAdvancedSettings && (
              <div className="settings-advanced-body">
                <label className="label settings-token-label">Token manual</label>
                <input className="input" type="password" placeholder="Cole aqui seu token Bearer" value={spotifyToken} onChange={(event) => { setSpotifyToken(event.target.value); setTokenSaveState(''); }} />
                <div className="settings-actions">
                  <button className="button ghost" type="button" onClick={handleSaveSpotifyToken} disabled={!spotifyToken.trim() || isDownloading}>Salvar token atual</button>
                  <button className="button danger" type="button" onClick={handleClearSpotifyToken} disabled={!hasSavedSpotifyToken || isDownloading}>Limpar token</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-header"><span className="settings-label">Ferramentas</span><strong>{toolsStatus?.message || 'Ferramentas ainda não verificadas.'}</strong></div>
          <div className="tool-status-list">
            {toolRows.map((tool) => (
              <div key={tool.label} className={`tool-status-row ${tool.ready ? 'ready' : 'warning'}`}>
                <FiTool aria-hidden="true" />
                <div><strong>{tool.label}</strong><p>{tool.description}</p></div>
                <span>{tool.ready ? 'Pronto' : 'Atenção'}</span>
              </div>
            ))}
          </div>
          <div className="settings-actions">
            <button className="button ghost icon-text-button" type="button" onClick={handleRefreshToolsStatus}><FiRefreshCw aria-hidden="true" />Verificar ferramentas</button>
          </div>
        </div>

        <div className="settings-section settings-section-final">
          <div className="settings-section-header"><span className="settings-label">Atualizações</span><strong>{appVersion ? `Soundforge v${appVersion}` : 'Versão local'}</strong></div>
          <p className="helper">{readyUpdate ? `Atualização ${readyUpdate.version || ''} pronta para instalar.` : 'Auto-update ativo.'}</p>
          {readyUpdate && <button className="button update drawer-update" type="button" onClick={handleRestartAndInstall}>Reiniciar e instalar</button>}
        </div>
      </aside>
    </div>
  );
}
