import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiSettings, FiX } from 'react-icons/fi';

const QUALITY_OPTIONS = [
  { label: 'Melhor qualidade', detail: 'MP3 mais fiel', value: '0' },
  { label: 'Alta', detail: 'Ótimo equilíbrio', value: '2' },
  { label: 'Média', detail: 'Uso geral', value: '5' },
  { label: 'Boa para voz', detail: 'Podcasts e falas', value: '7' },
  { label: 'Menor arquivo', detail: 'Ocupa menos espaço', value: '9' }
];

const SOURCE_OPTIONS = [
  { label: 'YouTube', value: 'youtube' },
  { label: 'Spotify', value: 'spotify' }
];

const TECHNICAL_LOG_PATTERNS = [
  /^\[debug\]/i,
  /^debug:/i,
  /^warning:/i,
  /^error:/i,
  /^\[youtube\].*api json/i,
  /^\[youtube\].*downloading.*player/i,
  /^\[info\]\s+available formats/i,
  /^\[download\]\s+destination:/i,
  /^\[download\]\s+\d{1,3}(?:\.\d+)?%/i,
  /^\[download\]\s+got error/i,
  /^\[download\]\s+retrying/i
];

const decodeLine = (line) => {
  if (!line || typeof line !== 'string') return line;
  try {
    return decodeURIComponent(line);
  } catch {
    return line;
  }
};

const stripLogPrefix = (line) => line.replace(/^\[(?:INFO|download|youtube|ExtractAudio)\]\s*/i, '').trim();

const filenameFromPath = (value) => {
  const filename = value.split(/[\\/]/).pop() || value;
  return filename.replace(/\.[^/.]+$/, '').trim();
};

const liveLog = (text, key) => ({ text, key });
const getLogText = (entry) => (typeof entry === 'string' ? entry : entry?.text || '');

const formatReportLine = (line) => {
  const cleaned = decodeLine(String(line || '').trim());
  if (!cleaned) return [];

  return cleaned
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const liveProgressMatch = part.match(/^\[PROGRESS\]\s+(.+)$/i);
      if (liveProgressMatch) return liveLog(liveProgressMatch[1], 'download-progress');

      if (TECHNICAL_LOG_PATTERNS.some((pattern) => pattern.test(part))) return null;

      const spotifyMatch = part.match(/^\[INFO\]\s+Buscando faixas da playlist no Spotify/i);
      if (spotifyMatch) return 'Lendo a playlist do Spotify.';

      const youtubeSearchMatch = part.match(/^\[INFO\]\s+Buscando no YouTube:\s*(.+)$/i);
      if (youtubeSearchMatch) return `Buscando na forja: ${youtubeSearchMatch[1]}`;

      const huntMatch = part.match(/^\[INFO\]\s+Caçando em (.+?):\s*(.+)$/i);
      if (huntMatch) return `Caçando em ${huntMatch[1]}: ${huntMatch[2]}`;

      const sourceMatch = part.match(/^\[INFO\]\s+Fonte encontrada:\s*(.+?)\.$/i);
      if (sourceMatch) return `Fonte encontrada: ${sourceMatch[1]}.`;

      if (/^\[INFO\]\s+.+? não entregou essa faixa/i.test(part)) {
        return 'Essa fonte não entregou a faixa. Procurando outra.';
      }

      const metadataMatch = part.match(/^\[INFO\]\s+Metadados gravados:\s*(.+)$/i);
      if (metadataMatch) return `Metadados gravados: ${metadataMatch[1]}`;

      if (/^\[AVISO\]\s+Não consegui gravar os metadados/i.test(part)) {
        return 'Faixa baixada, mas os metadados não foram gravados.';
      }

      const skippedMatch = part.match(/^\[AVISO\]\s+Faixa pulada:\s*(.+?)\.\s*Motivo:\s*(.+)$/i);
      if (skippedMatch) return `Faixa não encontrada: ${skippedMatch[1]} (${skippedMatch[2]})`;

      const playlistKindMatch = part.match(/^\[INFO\]\s+(.+?) detectado\. Mantendo o link como playlist\./i);
      if (playlistKindMatch) return `${playlistKindMatch[1]} detectado. Sequência preservada.`;

      const countMatch = part.match(/^\[INFO\]\s+(\d+)\s+itens encontrados na lista\./i);
      if (countMatch) return `${countMatch[1]} faixas encontradas na sequência.`;

      if (/^\[INFO\]\s+Não foi possível contar os itens/i.test(part)) {
        return 'Sequência detectada. Contagem será atualizada durante a forja.';
      }

      const toolMatch = part.match(/^\[INFO\]\s+Baixando yt-dlp\.\.\.\s*(\d+)%/i);
      if (toolMatch) return liveLog(`Preparando ferramentas: ${toolMatch[1]}%.`, 'tool-download');

      const itemMatch = part.match(/Downloading item (\d+) of (\d+)/i);
      if (itemMatch) return `Forjando faixa ${itemMatch[1]} de ${itemMatch[2]}.`;

      const extractMatch = part.match(/^\[ExtractAudio\]\s+Destination:\s*(.+)$/i);
      if (extractMatch) return `Áudio finalizado: ${filenameFromPath(extractMatch[1])}.`;

      const destinationMatch = part.match(/Destination:\s*(.+)$/i);
      if (destinationMatch) return `Arquivo preparado: ${filenameFromPath(destinationMatch[1])}.`;

      const finishedMatch = part.match(/Finished downloading playlist:\s*(.+)$/i);
      if (finishedMatch) return `Sequência concluída: ${finishedMatch[1]}.`;

      const normalized = stripLogPrefix(part);
      return normalized || null;
    })
    .filter(Boolean);
};

const appendReportLines = (setLogs, entries) => {
  if (!entries.length) return;
  setLogs((prev) => {
    const next = [...prev];
    entries.forEach((entry) => {
      if (entry?.key) {
        const existingIndex = next.findIndex((item) => item?.key === entry.key);
        if (existingIndex !== -1) next.splice(existingIndex, 1);
        next.push(entry);
        return;
      }

      if (getLogText(next[next.length - 1]) !== entry) next.push(entry);
    });
    return next.slice(-40);
  });
};

const upsertTrack = (items, track) => {
  if (!track) return items;
  const next = items.filter((item) => item.index !== track.index);
  next.push(track);
  return next.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
};

const formatTrackArtists = (track) => (
  Array.isArray(track?.artists) && track.artists.length ? track.artists.join(', ') : ''
);

export default function App() {
  const [url, setUrl] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [quality, setQuality] = useState('5');
  const [source, setSource] = useState('youtube');
  const [spotifyToken, setSpotifyToken] = useState('');
  const [tokenSaveState, setTokenSaveState] = useState('');
  const [hasSavedSpotifyToken, setHasSavedSpotifyToken] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [spotifyPlaylistUrl, setSpotifyPlaylistUrl] = useState('');
  const [spotifyPreview, setSpotifyPreview] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [downloadedTracks, setDownloadedTracks] = useState([]);
  const [skippedTracks, setSkippedTracks] = useState([]);
  const [readyUpdate, setReadyUpdate] = useState(null);
  const [status, setStatus] = useState('Aguardando um link.');
  const [progress, setProgress] = useState({
    percent: 0,
    speed: '',
    eta: '',
    title: '',
    itemIndex: null,
    itemCount: null
  });
  const [isCompact, setIsCompact] = useState(false);
  const logBoxRef = useRef(null);

  const isReady = useMemo(() => {
    if (source === 'spotify') {
      return (
        spotifyToken.trim().length > 0 &&
        spotifyPlaylistUrl.trim().length > 0 &&
        outputDir.trim().length > 0
      );
    }
    return url.trim().length > 0 && outputDir.trim().length > 0;
  }, [source, spotifyToken, spotifyPlaylistUrl, url, outputDir]);
  const progressPercent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const progressLabel = `${progressPercent.toFixed(1)}%`;
  const trackLabel = progress.title || (isDownloading ? 'Invocando faixa...' : 'Nenhuma faixa em execução');
  const playlistLabel =
    progress.itemIndex && progress.itemCount ? `Faixa ${progress.itemIndex} de ${progress.itemCount}` : null;
  const hasSpotifyToken = hasSavedSpotifyToken || spotifyToken.trim().length > 0;
  const showSpotifyTokenWarning = source === 'spotify' && !hasSpotifyToken;
  const showSubtleSpotifyNotice = source !== 'spotify' && !hasSavedSpotifyToken;
  const hasDashboardContent = isDownloading || logs.length > 0 || downloadedTracks.length > 0 || skippedTracks.length > 0;
  useEffect(() => {
    if (!window.soundforge) return;

    window.soundforge.getSettings?.().then((settings) => {
      if (settings?.appVersion) setAppVersion(settings.appVersion);
      if (settings?.spotifyToken) {
        setSpotifyToken(settings.spotifyToken);
        setHasSavedSpotifyToken(true);
        setTokenSaveState('Token carregado deste computador.');
      }
    }).catch(() => {});

    window.soundforge.onLog((line) => {
      appendReportLines(setLogs, formatReportLine(line));
    });

    window.soundforge.onProgress((data) => {
      setProgress(data);
    });

    window.soundforge.onTrackComplete((track) => {
      setDownloadedTracks((prev) => upsertTrack(prev, track));
    });

    window.soundforge.onTrackSkipped((track) => {
      setSkippedTracks((prev) => upsertTrack(prev, track));
    });

    window.soundforge.onComplete(({ isPlaylist, downloadedTracks = [], skippedTracks = [] }) => {
      const completed = Array.isArray(downloadedTracks) ? downloadedTracks : [];
      const skipped = Array.isArray(skippedTracks) ? skippedTracks : [];
      const skippedCount = skipped.length;
      const completeMessage = isPlaylist
        ? skippedCount
          ? `Download da playlist concluído com ${skippedCount} faixa(s) não baixada(s).`
          : 'Download da playlist concluído.'
        : 'Download concluído.';
      setIsDownloading(false);
      setStatus(skippedCount ? 'Playlist forjada com pendências.' : isPlaylist ? 'Playlist forjada com sucesso.' : 'Música forjada com sucesso.');
      setLogs([completeMessage]);
      setDownloadedTracks(completed);
      setSkippedTracks(skipped);
      setProgress({
        percent: 0,
        speed: '',
        eta: '',
        title: completeMessage,
        itemIndex: null,
        itemCount: null
      });
    });

    window.soundforge.onError((message) => {
      setIsDownloading(false);
      setStatus(message || 'Falha no download.');
      appendReportLines(setLogs, [`Falha na forja: ${message || 'download interrompido.'}`]);
    });

    window.soundforge.onUpdateDownloaded?.((info) => {
      setReadyUpdate(info || {});
      setStatus(`Atualização ${info?.version || ''} pronta para instalar.`.trim());
    });
  }, []);

  useEffect(() => {
    if (!logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const updateCompact = () => {
      setIsCompact(window.innerWidth <= 560);
    };
    updateCompact();
    window.addEventListener('resize', updateCompact);
    return () => window.removeEventListener('resize', updateCompact);
  }, []);

  useEffect(() => {
    setSpotifyPreview(null);
    setPreviewError('');
  }, [source, spotifyPlaylistUrl, spotifyToken]);

  const handleSelectFolder = async () => {
    if (!window.soundforge) return;
    const selected = await window.soundforge.selectOutputDir();
    if (selected) setOutputDir(selected);
  };

  const handleDownload = () => {
    if (!window.soundforge || !isReady || isDownloading) return;

    setLogs([]);
    setDownloadedTracks([]);
    setSkippedTracks([]);
    setStatus('Invocando a forja...');
    setIsDownloading(true);
    setProgress({
      percent: 0,
      speed: '',
      eta: '',
      title: '',
      itemIndex: null,
      itemCount: null
    });

    window.soundforge.startDownload({
      source,
      url: url.trim(),
      spotifyToken: spotifyToken.trim(),
      spotifyPlaylistUrl: spotifyPlaylistUrl.trim(),
      outputDir: outputDir.trim(),
      quality
    });
  };

  const handleRestartAndInstall = () => {
    if (!window.soundforge?.restartAndInstallUpdate) return;
    window.soundforge.restartAndInstallUpdate();
  };

  const handleSaveSpotifyToken = async () => {
    if (!window.soundforge?.saveSpotifyToken || !spotifyToken.trim()) return;
    setTokenSaveState('Salvando token...');
    try {
      await window.soundforge.saveSpotifyToken(spotifyToken.trim());
      setHasSavedSpotifyToken(true);
      setTokenSaveState('Token salvo neste computador.');
    } catch {
      setTokenSaveState('Não consegui salvar o token.');
    }
  };

  const handleClearSpotifyToken = async () => {
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
  };

  const handleSpotifyPreview = async () => {
    if (!window.soundforge || isPreviewing || isDownloading) return;
    if (!spotifyToken.trim() || !spotifyPlaylistUrl.trim()) return;
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
  };

  return (
    <div className={`app ${isCompact ? 'compact' : ''}`}>
      <nav className="topbar" aria-label="Navegação principal">
        <div className="topbar-brand">
          <span className="topbar-eyebrow">Forja Sonora</span>
          <span className="topbar-title">Soundforge</span>
          <span className="topbar-subtitle">Baixe canções do reino do YouTube com qualidade à sua escolha.</span>
        </div>
        <button className="icon-button" type="button" onClick={() => setIsSettingsOpen(true)} aria-label="Abrir configurações">
          <FiSettings />
        </button>
      </nav>

      <section className="panel control-panel">
        <div className="source-block">
          <label className="label">Fonte</label>
          <div className="select-row">
            {SOURCE_OPTIONS.map((option) => (
              <label key={option.value} className={`radio ${source === option.value ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="source"
                  value={option.value}
                  checked={source === option.value}
                  onChange={() => setSource(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {showSpotifyTokenWarning && (
            <p className="source-notice warning">Spotify indisponível: nenhum token configurado.</p>
          )}
          {showSubtleSpotifyNotice && (
            <p className="source-notice subtle">Spotify sem token salvo neste computador.</p>
          )}
        </div>

        <div className="control-field control-field-wide">
          {source === 'youtube' ? (
            <label className="label link-label">Link do YouTube</label>
          ) : (
            <label className="label link-label">Link da playlist do Spotify</label>
          )}
          <input
            className="input"
            placeholder={source === 'youtube' ? 'Cole aqui o link da música ou playlist' : 'Cole aqui o link da playlist do Spotify'}
            value={source === 'youtube' ? url : spotifyPlaylistUrl}
            onChange={(event) => {
              if (source === 'youtube') setUrl(event.target.value);
              else setSpotifyPlaylistUrl(event.target.value);
            }}
          />
        </div>

        {source === 'spotify' && (
          <div className="control-field control-field-wide spotify-token-block">
            <label className="label token-label">Token do Spotify</label>
            <input
              className="input"
              type="password"
              placeholder="Cole aqui seu token Bearer"
              value={spotifyToken}
              onChange={(event) => {
                setSpotifyToken(event.target.value);
                setTokenSaveState('');
              }}
            />
            <div className="preview-row">
              <button
                className="button ghost"
                type="button"
                onClick={handleSaveSpotifyToken}
                disabled={!spotifyToken.trim() || isDownloading}
              >
                Salvar token
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={handleSpotifyPreview}
                disabled={!spotifyToken.trim() || !spotifyPlaylistUrl.trim() || isPreviewing || isDownloading}
              >
                {isPreviewing ? 'Carregando prévia...' : 'Ver prévia da playlist'}
              </button>
              {tokenSaveState && <span className="helper success">{tokenSaveState}</span>}
              {previewError && <span className="helper error">{previewError}</span>}
            </div>
            {spotifyPreview && (
              <div className="preview-box">
                <div className="preview-header">
                  <h3>{spotifyPreview.name || 'Playlist do Spotify'}</h3>
                  <span>
                    {spotifyPreview.total ? `${spotifyPreview.total} faixas` : `${spotifyPreview.tracks.length} faixas`}
                  </span>
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
                  <p className="helper">
                    Mostrando {spotifyPreview.tracks.length} de {spotifyPreview.total} faixas.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid control-grid">
          <div className="quality-block">
            <label className="label">Qualidade do MP3</label>
            <p className="field-hint">Afeta o equilíbrio entre fidelidade, tamanho do arquivo e tempo de processamento.</p>
            <div className="select-row">
              {QUALITY_OPTIONS.map((option) => (
                <label key={option.value} className={`radio quality-option ${quality === option.value ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="quality"
                    value={option.value}
                    checked={quality === option.value}
                    onChange={() => setQuality(option.value)}
                  />
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
              <button className="button ghost" type="button" onClick={handleSelectFolder}>
                Escolher pasta
              </button>
              <span className="folder-path">{outputDir || 'Nenhuma pasta escolhida'}</span>
            </div>
          </div>
        </div>

        <div className="actions control-actions">
          <button
            className="button primary"
            type="button"
            onClick={handleDownload}
            disabled={!isReady || isDownloading || isPreviewing}
          >
            <span className={`button-icon ${isDownloading ? 'loading' : ''}`} aria-hidden="true">
              {isDownloading ? '' : '↓'}
            </span>
            <span className="button-content">
              <span className="button-title">{isDownloading ? 'Forjando...' : 'Iniciar download'}</span>
              <span className="button-subtitle">
                {isDownloading ? 'Mantendo o ritual em execução' : 'MP3 com qualidade escolhida'}
              </span>
            </span>
          </button>
          <div className="status">
            <span className={`status-dot ${isDownloading ? 'busy' : ''}`}></span>
            <span>{status}</span>
          </div>
          {readyUpdate && (
            <button className="button update" type="button" onClick={handleRestartAndInstall}>
              Reiniciar e instalar
            </button>
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
            <div className="logs-header">
              <h2>Relatório da forja</h2>
            </div>
            <div className="log-box" ref={logBoxRef}>
              {logs.length === 0 ? (
                <p className="log-empty">Nenhuma mensagem ainda.</p>
              ) : (
                logs.map((line, index) => (
                  <div key={`${getLogText(line)}-${index}`} className="log-line">
                    {getLogText(line)}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="forge-column">
          <section className="panel track-results">
            <div className="logs-header">
              <h2>Músicas baixadas</h2>
              <span className="progress-pill">{downloadedTracks.length}</span>
            </div>
            <div className="track-list success-list">
              {downloadedTracks.length === 0 ? (
                <p className="log-empty">Nenhuma música baixada ainda.</p>
              ) : (
                downloadedTracks.map((track) => {
                  const artists = formatTrackArtists(track);
                  return (
                    <div key={`downloaded-${track.index}-${track.name}`} className="track-result success">
                      <span className="track-result-index">{String(track.index).padStart(2, '0')}</span>
                      <span className="track-result-main">
                        <span className="track-result-title">{track.name}</span>
                        <span className="track-result-meta">
                          {artists ? `${artists} • ${track.source || 'Fonte encontrada'}` : track.source || 'Fonte encontrada'}
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="panel track-results">
            <div className="logs-header">
              <h2>Músicas não baixadas</h2>
              <span className="progress-pill">{skippedTracks.length}</span>
            </div>
            <div className="track-list missing-list">
              {skippedTracks.length === 0 ? (
                <p className="log-empty">Nenhuma pendência registrada.</p>
              ) : (
                skippedTracks.map((track) => {
                  const artists = formatTrackArtists(track);
                  return (
                    <div key={`skipped-${track.index}-${track.name}`} className="track-result missing">
                      <span className="track-result-index">{String(track.index).padStart(2, '0')}</span>
                      <span className="track-result-main">
                        <span className="track-result-title">{track.name}</span>
                        <span className="track-result-meta">
                          {artists ? `${artists} • ${track.reason}` : track.reason}
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>

      <footer className="app-footer">
        <span>{hasSavedSpotifyToken ? 'Token Spotify salvo' : 'Token Spotify não salvo'}</span>
      </footer>

      {isSettingsOpen && (
        <div className="settings-overlay" role="presentation" onClick={() => setIsSettingsOpen(false)}>
          <aside
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
              <button className="icon-button" type="button" onClick={() => setIsSettingsOpen(false)} aria-label="Fechar configurações">
                <FiX />
              </button>
            </div>

            <div className="settings-section">
              <span className="settings-label">Versão do app</span>
              <strong>{appVersion ? `v${appVersion}` : 'Versão local'}</strong>
            </div>

            <div className="settings-section">
              <span className="settings-label">Spotify</span>
              <strong>{hasSavedSpotifyToken ? 'Token salvo neste computador' : 'Nenhum token salvo'}</strong>
              <div className="settings-actions">
                <button
                  className="button ghost"
                  type="button"
                  onClick={handleSaveSpotifyToken}
                  disabled={!spotifyToken.trim() || isDownloading}
                >
                  Salvar token atual
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={handleClearSpotifyToken}
                  disabled={!hasSavedSpotifyToken || isDownloading}
                >
                  Limpar token
                </button>
              </div>
              {tokenSaveState && <p className="helper success">{tokenSaveState}</p>}
            </div>

            <div className="settings-section">
              <span className="settings-label">Atualizações</span>
              <strong>{readyUpdate ? `Atualização ${readyUpdate.version || ''} pronta` : 'Auto-update ativo na versão instalada'}</strong>
              {readyUpdate && (
                <button className="button update drawer-update" type="button" onClick={handleRestartAndInstall}>
                  Reiniciar e instalar
                </button>
              )}
            </div>

            <footer className="settings-footer">
              <span>Soundforge</span>
              <strong>{appVersion ? `v${appVersion}` : 'versão local'}</strong>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}
