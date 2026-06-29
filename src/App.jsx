import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiSettings } from 'react-icons/fi';
import logoSoundforge from './assets/logo_soundforge.png';
import { QUALITY_OPTIONS, SOURCE_OPTIONS, TRACK_FILTERS, formatTrackArtists, getLogText } from './lib/formatters';
import SettingsDrawer from './components/SettingsDrawer';
import { useDownload } from './hooks/useDownload';
import { useSpotify } from './hooks/useSpotify';

export default function App() {
  // UI state (local ao componente)
  const [url, setUrl] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [quality, setQuality] = useState('5');
  const [source, setSource] = useState('youtube');
  const [trackFilter, setTrackFilter] = useState('all');
  const [denseResults, setDenseResults] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsClosing, setIsSettingsClosing] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [readyUpdate, setReadyUpdate] = useState(null);
  const [toolsStatus, setToolsStatus] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const [status, setStatus] = useState('Aguardando um link.');
  const logBoxRef = useRef(null);

  // Custom hooks
  const {
    isDownloading, isDownloadingRef, pauseState,
    logs, downloadedTracks, skippedTracks, progress,
    startDownload, handlePauseToggle, subscribeDownloadEvents
  } = useDownload({ setStatus });

  const {
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
    spotifyPreview, setSpotifyPreview, isPreviewing, previewError,
    loadSpotifySettings, subscribeSpotifyEvents,
    handleSaveSpotifyToken, handleSaveSpotifyClientId,
    handleConnectSpotify, handleOpenSpotifyLoginUrl,
    handleCopyRedirectUri, handleTestSpotifyConnection,
    handleDisconnectSpotify, handleClearSpotifyToken,
    handleSpotifyPreview
  } = useSpotify({ setStatus });

  // IPC setup
  useEffect(() => {
    if (!window.soundforge) return;

    window.soundforge.getSettings?.().then((settings) => {
      if (settings?.appVersion) setAppVersion(settings.appVersion);
      loadSpotifySettings(settings);
    }).catch(() => {});

    const applyToolsStatus = (tools) => {
      if (!tools?.message) return;
      setToolsStatus(tools);
      setStatus((current) => {
        if (isDownloadingRef.current || current.includes('forjada') || current.includes('Download')) return current;
        return tools.message;
      });
    };
    window.soundforge.getToolsStatus?.().then(applyToolsStatus).catch(() => {});
    const unsubToolsStatus = window.soundforge.onToolsStatus?.(applyToolsStatus);

    const unsubUpdate = window.soundforge.onUpdateDownloaded?.((info) => {
      setReadyUpdate(info || {});
      setStatus(`Atualização ${info?.version || ''} pronta para instalar.`.trim());
    });

    const unsubDownload = subscribeDownloadEvents();
    const unsubSpotify = subscribeSpotifyEvents();

    return () => {
      unsubToolsStatus?.();
      unsubUpdate?.();
      unsubDownload?.();
      unsubSpotify?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const updateCompact = () => setIsCompact(window.innerWidth <= 560);
    updateCompact();
    window.addEventListener('resize', updateCompact);
    return () => window.removeEventListener('resize', updateCompact);
  }, []);

  useEffect(() => {
    setSpotifyPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, spotifyPlaylistUrl, spotifyToken, hasSpotifyAuth]);

  useEffect(() => {
    if (!isSettingsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [isSettingsOpen]);

  // Computed values
  const isReady = useMemo(() => {
    if (source === 'spotify') return spotifyPlaylistUrl.trim().length > 0 && outputDir.trim().length > 0;
    return url.trim().length > 0 && outputDir.trim().length > 0;
  }, [source, spotifyPlaylistUrl, url, outputDir]);

  const progressPercent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const progressLabel = `${progressPercent.toFixed(1)}%`;
  const trackLabel = progress.title || (isDownloading ? 'Invocando faixa...' : 'Nenhuma faixa em execução');
  const playlistLabel = progress.itemIndex && progress.itemCount ? `Faixa ${progress.itemIndex} de ${progress.itemCount}` : null;
  const latestReportLine = useMemo(() => {
    const lastEntry = [...logs].reverse().find((entry) => getLogText(entry).trim());
    return getLogText(lastEntry).trim();
  }, [logs]);
  const progressStepLabel = playlistLabel || (isDownloading ? 'Faixa em andamento' : 'Faixa única');
  const progressDetailLabel = latestReportLine || (isDownloading ? 'Preparando a próxima etapa.' : 'Aguardando início.');
  const hasSpotifyAccess = hasSpotifyAuth || hasSavedSpotifyToken || spotifyToken.trim().length > 0;
  const showSpotifyPublicNotice = source === 'spotify' && !hasSpotifyAccess;
  const showSubtleSpotifyNotice = source !== 'spotify' && !hasSpotifyAuth && !hasSavedSpotifyToken;
  const hasDashboardContent = isDownloading || logs.length > 0 || downloadedTracks.length > 0 || skippedTracks.length > 0;
  const showDownloadedResults = trackFilter === 'all' || trackFilter === 'downloaded';
  const showSkippedResults = trackFilter === 'all' || trackFilter === 'missing' || trackFilter === 'error';
  const isSingleResultView = !showDownloadedResults || !showSkippedResults;
  const pauseButtonLabel = pauseState === 'paused' ? 'Continuar' : pauseState === 'pausing' ? 'Pausando...' : 'Pausar';
  const pauseButtonHint = pauseState === 'paused' ? 'Retomar de onde parou' : 'Para após a faixa atual';
  const canConnectSpotify = hasDefaultSpotifyClientId || spotifyClientId.trim().length > 0;
  const selectedQualityLabel = QUALITY_OPTIONS.find((option) => option.value === quality)?.label || 'Média';
  const spotifyStatusText = hasSpotifyAuth ? 'Conta Spotify conectada' : hasSavedSpotifyToken ? 'Token manual salvo neste computador' : 'Spotify não conectado';
  const spotifyAuthLabel = hasSpotifyAuth ? 'Sessão automática' : hasSavedSpotifyToken ? 'Token manual' : hasDefaultSpotifyClientId ? 'Login pronto para conectar' : 'Aguardando configuração';
  const toolRows = [
    { label: 'yt-dlp', ready: Boolean(toolsStatus?.ytDlpReady), description: toolsStatus?.ytDlpReady ? 'Pronto para baixar.' : 'Será preparado automaticamente.' },
    { label: 'ffmpeg', ready: Boolean(toolsStatus?.ffmpegReady), description: toolsStatus?.ffmpegReady ? 'Pronto para converter e gravar metadados.' : 'Não encontrado no pacote/local.' },
    { label: 'ffprobe', ready: Boolean(toolsStatus?.ffmpegReady), description: toolsStatus?.ffmpegReady ? 'Pronto para validar áudio final.' : 'Usa a mesma pasta do ffmpeg.' }
  ];
  const getTrackFilterCount = (filter) => {
    if (filter === 'downloaded') return downloadedTracks.length;
    if (filter === 'missing' || filter === 'error') return skippedTracks.length;
    return downloadedTracks.length + skippedTracks.length;
  };

  // Handlers locais
  const handleSelectFolder = async () => {
    if (!window.soundforge) return;
    const selected = await window.soundforge.selectOutputDir();
    if (selected) setOutputDir(selected);
  };

  const handleDownload = () => {
    if (!window.soundforge || !isReady || isDownloading) return;
    startDownload({
      source,
      url: url.trim(),
      spotifyToken: spotifyToken.trim(),
      spotifyPlaylistUrl: spotifyPlaylistUrl.trim(),
      outputDir: outputDir.trim(),
      quality
    });
  };

  const handleRefreshToolsStatus = async () => {
    if (!window.soundforge?.getToolsStatus) return;
    try {
      const tools = await window.soundforge.getToolsStatus();
      setToolsStatus(tools);
    } catch {
      setToolsStatus((current) => current || { state: 'error', ytDlpReady: false, ffmpegReady: false, message: 'Não consegui ler o status das ferramentas.' });
    }
  };

  const handleRestartAndInstall = () => {
    if (!window.soundforge?.restartAndInstallUpdate) return;
    window.soundforge.restartAndInstallUpdate();
  };

  const handleOpenSettings = () => {
    setIsSettingsClosing(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    if (isSettingsClosing) return;
    setIsSettingsClosing(true);
    window.setTimeout(() => {
      setIsSettingsOpen(false);
      setIsSettingsClosing(false);
    }, 240);
  };

  // Render
  return (
    <div className={`app ${isCompact ? 'compact' : ''}`}>
      <nav className="topbar" aria-label="Navegação principal">
        <div className="topbar-brand">
          <img className="topbar-logo" src={logoSoundforge} alt="Soundforge" />
          <span className="topbar-copy">
            <span className="topbar-eyebrow">Forja Sonora</span>
            <span className="topbar-title">Soundforge</span>
            <span className="topbar-subtitle">Baixe canções do reino do YouTube com qualidade à sua escolha.</span>
          </span>
        </div>
        <button className="icon-button" type="button" onClick={handleOpenSettings} aria-label="Abrir configurações">
          <FiSettings />
        </button>
      </nav>

      <section className="panel control-panel">
        <div className="source-block">
          <label className="label">Fonte</label>
          <div className="select-row">
            {SOURCE_OPTIONS.map((option) => (
              <label key={option.value} className={`radio ${source === option.value ? 'active' : ''}`}>
                <input type="radio" name="source" value={option.value} checked={source === option.value} onChange={() => setSource(option.value)} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {showSpotifyPublicNotice && <p className="source-notice subtle">Sem login, o Soundforge tenta ler apenas a prévia pública da playlist.</p>}
          {showSubtleSpotifyNotice && <p className="source-notice subtle">Spotify ainda não conectado neste computador.</p>}
        </div>

        <div className="control-field control-field-wide">
          {source === 'youtube' ? <label className="label link-label">Link do YouTube</label> : <label className="label link-label">Link da playlist do Spotify</label>}
          <input
            className="input"
            placeholder={source === 'youtube' ? 'Cole aqui o link da música ou playlist' : 'Cole aqui o link da playlist do Spotify'}
            value={source === 'youtube' ? url : spotifyPlaylistUrl}
            onChange={(event) => { if (source === 'youtube') setUrl(event.target.value); else setSpotifyPlaylistUrl(event.target.value); }}
          />
        </div>

        {source === 'spotify' && (
          <>
            <div className="preview-row">
              {!hasSpotifyAuth && (
                <button className="button update" type="button" onClick={canConnectSpotify ? handleConnectSpotify : handleOpenSettings} disabled={isDownloading}>
                  Conectar Spotify
                </button>
              )}
              <button className="button ghost" type="button" onClick={handleSpotifyPreview} disabled={!spotifyPlaylistUrl.trim() || isPreviewing || isDownloading}>
                {isPreviewing ? 'Carregando prévia...' : 'Ver prévia da playlist'}
              </button>
              {spotifyLoginUrl && !hasSpotifyAuth && (
                <button className="button ghost" type="button" onClick={handleOpenSpotifyLoginUrl}>Abrir login no Spotify</button>
              )}
              {previewError && <span className="helper error">{previewError}</span>}
            </div>
            {spotifyPreview && (
              <div className="preview-box">
                <div className="preview-header">
                  <h3>{spotifyPreview.name || 'Playlist do Spotify'}</h3>
                  <span>{spotifyPreview.total ? `${spotifyPreview.total} faixas` : `${spotifyPreview.tracks.length} faixas`}</span>
                </div>
                <div className="preview-list">
                  {spotifyPreview.tracks.map((track, index) => (
                    <div key={`${track.name}-${index}`} className="preview-item">
                      <span className="preview-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="preview-title">{track.name}</span>
                      <span className="preview-artist">{(track.artists || []).join(', ')}</span>
                    </div>
                  ))}
                </div>
                {spotifyPreview.total && spotifyPreview.total > spotifyPreview.tracks.length && (
                  <p className="helper">Mostrando {spotifyPreview.tracks.length} de {spotifyPreview.total} faixas.</p>
                )}
              </div>
            )}
          </>
        )}

        <div className="grid control-grid">
          <div className="quality-block">
            <label className="label">Qualidade do MP3</label>
            <p className="field-hint">Afeta o equilíbrio entre fidelidade, tamanho do arquivo e tempo de processamento.</p>
            <div className="select-row">
              {QUALITY_OPTIONS.map((option) => (
                <label key={option.value} className={`radio quality-option ${quality === option.value ? 'active' : ''}`}>
                  <input type="radio" name="quality" value={option.value} checked={quality === option.value} onChange={() => setQuality(option.value)} />
                  <span className="quality-copy">
                    <span className="quality-label">{option.label}</span>
                    <span className="quality-detail">{option.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="destination-block">
            <label className="label">Pasta de destino</label>
            <div className="folder-row">
              <button className="button ghost" type="button" onClick={handleSelectFolder}>Escolher pasta</button>
              <span className="folder-path">{outputDir || 'Nenhuma pasta escolhida'}</span>
            </div>
          </div>
        </div>

        <div className="actions control-actions">
          <button className="button primary" type="button" onClick={handleDownload} disabled={!isReady || isDownloading || isPreviewing}>
            <span className={`button-icon ${isDownloading ? 'loading' : ''}`} aria-hidden="true">{isDownloading ? '' : '↓'}</span>
            <span className="button-content">
              <span className="button-title">{isDownloading ? 'Forjando...' : 'Iniciar download'}</span>
              <span className="button-subtitle">{isDownloading ? 'Mantendo o ritual em execução' : 'MP3 com qualidade escolhida'}</span>
            </span>
          </button>
          {isDownloading && (
            <button className={`button pause ${pauseState === 'paused' ? 'paused' : ''}`} type="button" onClick={handlePauseToggle} disabled={pauseState === 'pausing'}>
              <span className="button-title">{pauseButtonLabel}</span>
              <span className="button-subtitle">{pauseButtonHint}</span>
            </button>
          )}
          <div className="status">
            <span className={`status-dot ${isDownloading ? 'busy' : ''}`}></span>
            <span>{status}</span>
          </div>
          {readyUpdate && (
            <button className="button update" type="button" onClick={handleRestartAndInstall}>Reiniciar e instalar</button>
          )}
        </div>
      </section>

      <div className={`forge-dashboard ${hasDashboardContent ? 'has-content' : 'is-empty'}`}>
        <div className="forge-column">
          <section className="panel progress-card">
            <div className="progress-header">
              <h2>Progresso da forja</h2>
              <span className="progress-pill">{playlistLabel || 'Faixa única'}</span>
            </div>
            <p className="progress-track">{trackLabel}</p>
            <div className="progress-readout">
              <span className="progress-percent">{Math.round(progressPercent)}%</span>
              <span className="progress-step">{progressStepLabel}</span>
              <span className="progress-detail">{progressDetailLabel}</span>
            </div>
            <div className="progress-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="progress-meta">
              <span>{progressLabel}</span>
              <span>{progress.speed ? `Velocidade ${progress.speed}` : 'Velocidade --'}</span>
              <span>{progress.eta ? `ETA ${progress.eta}` : 'ETA --'}</span>
            </div>
          </section>

          <section className="panel logs">
            <div className="logs-header"><h2>Relatório da forja</h2></div>
            <div className="log-box" ref={logBoxRef}>
              {logs.length === 0 ? (
                <p className="log-empty">Nenhuma mensagem ainda.</p>
              ) : (
                logs.map((line, index) => (
                  <div key={`${getLogText(line)}-${index}`} className="log-line">{getLogText(line)}</div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className={`forge-column results-column ${isSingleResultView ? 'single-result-view' : ''} ${denseResults ? 'dense-results' : ''}`}>
          <div className="track-toolbar">
            <div className="track-filters" aria-label="Filtrar músicas">
              {TRACK_FILTERS.map((filter) => (
                <button key={filter.value} className={`track-filter ${trackFilter === filter.value ? 'active' : ''}`} type="button" onClick={() => setTrackFilter(filter.value)}>
                  <span>{filter.label}</span>
                  <span className="track-filter-count">{getTrackFilterCount(filter.value)}</span>
                </button>
              ))}
            </div>
            <button className={`track-density-toggle ${denseResults ? 'active' : ''}`} type="button" onClick={() => setDenseResults((v) => !v)} aria-pressed={denseResults}>
              Compacto
            </button>
          </div>

          {showDownloadedResults && (
            <section className="panel track-results">
              <div className="logs-header">
                <h2>Músicas baixadas</h2>
                <span className="progress-pill">{downloadedTracks.length}</span>
              </div>
              <div className="track-list success-list">
                {downloadedTracks.length === 0 ? (
                  <p className="log-empty">As músicas concluídas aparecerão aqui durante a playlist.</p>
                ) : (
                  downloadedTracks.map((track) => {
                    const artists = formatTrackArtists(track);
                    return (
                      <div key={`downloaded-${track.index}-${track.name}`} className="track-result success">
                        <span className="track-result-index">{String(track.index).padStart(2, '0')}</span>
                        <span className="track-result-main">
                          <span className="track-result-title">{track.name}</span>
                          {artists && <span className="track-result-meta">{artists}</span>}
                          <span className="track-result-source">Fonte: {track.source || 'encontrada'}</span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {showSkippedResults && (
            <section className="panel track-results">
              <div className="logs-header">
                <h2>{trackFilter === 'error' ? 'Com erro' : 'Músicas não baixadas'}</h2>
                <span className="progress-pill">{skippedTracks.length}</span>
              </div>
              <div className="track-list missing-list">
                {skippedTracks.length === 0 ? (
                  <p className="log-empty">As faixas que precisarem de revisão aparecerão aqui com o motivo.</p>
                ) : (
                  skippedTracks.map((track) => {
                    const artists = formatTrackArtists(track);
                    return (
                      <div key={`skipped-${track.index}-${track.name}`} className="track-result missing">
                        <span className="track-result-index">{String(track.index).padStart(2, '0')}</span>
                        <span className="track-result-main">
                          <span className="track-result-title">{track.name}</span>
                          {artists && <span className="track-result-meta">{artists}</span>}
                          <span className="track-result-reason"><span aria-hidden="true">!</span>{track.reason || 'Nenhuma fonte retornou download válido.'}</span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <footer className="app-footer">
        <span>{hasSavedSpotifyToken ? 'Token Spotify salvo' : 'Token Spotify não salvo'}</span>
      </footer>

      {isSettingsOpen && (
        <SettingsDrawer
          appVersion={appVersion}
          canConnectSpotify={canConnectSpotify}
          denseResults={denseResults}
          handleClearSpotifyToken={handleClearSpotifyToken}
          handleConnectSpotify={handleConnectSpotify}
          handleCopyRedirectUri={handleCopyRedirectUri}
          handleDisconnectSpotify={handleDisconnectSpotify}
          handleOpenSpotifyLoginUrl={handleOpenSpotifyLoginUrl}
          handleRefreshToolsStatus={handleRefreshToolsStatus}
          handleRestartAndInstall={handleRestartAndInstall}
          handleSaveSpotifyClientId={handleSaveSpotifyClientId}
          handleSaveSpotifyToken={handleSaveSpotifyToken}
          handleSelectFolder={handleSelectFolder}
          handleTestSpotifyConnection={handleTestSpotifyConnection}
          hasDefaultSpotifyClientId={hasDefaultSpotifyClientId}
          hasSavedSpotifyToken={hasSavedSpotifyToken}
          hasSpotifyAuth={hasSpotifyAuth}
          isDownloading={isDownloading}
          logoSoundforge={logoSoundforge}
          isClosing={isSettingsClosing}
          onClose={handleCloseSettings}
          outputDir={outputDir}
          quality={quality}
          readyUpdate={readyUpdate}
          redirectCopyState={redirectCopyState}
          selectedQualityLabel={selectedQualityLabel}
          setQuality={setQuality}
          setSpotifyClientId={setSpotifyClientId}
          setSpotifyToken={setSpotifyToken}
          setTokenSaveState={setTokenSaveState}
          source={source}
          spotifyAuthLabel={spotifyAuthLabel}
          spotifyClientId={spotifyClientId}
          spotifyLoginUrl={spotifyLoginUrl}
          spotifyRedirectUri={spotifyRedirectUri}
          spotifyStatusText={spotifyStatusText}
          spotifyTestState={spotifyTestState}
          spotifyToken={spotifyToken}
          tokenSaveState={tokenSaveState}
          toolRows={toolRows}
          toolsStatus={toolsStatus}
          trackFilter={trackFilter}
        />
      )}
    </div>
  );
}
