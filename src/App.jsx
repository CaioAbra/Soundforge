import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GiAnvil, GiThorHammer } from 'react-icons/gi';

const QUALITY_OPTIONS = [
  { label: '0 (Melhor)', value: '0' },
  { label: '2 (Alta)', value: '2' },
  { label: '5 (Média)', value: '5' },
  { label: '7 (Boa para voz)', value: '7' },
  { label: '9 (Menor)', value: '9' }
];

const SOURCE_OPTIONS = [
  { label: 'YouTube', value: 'youtube' },
  { label: 'Spotify', value: 'spotify' }
];

export default function App() {
  const [url, setUrl] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [quality, setQuality] = useState('5');
  const [source, setSource] = useState('youtube');
  const [spotifyToken, setSpotifyToken] = useState('');
  const [spotifyPlaylistUrl, setSpotifyPlaylistUrl] = useState('');
  const [spotifyPreview, setSpotifyPreview] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [logs, setLogs] = useState([]);
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
  const forgeStateLabel = isDownloading ? 'Forja ativa' : 'Forja em repouso';
  const decodeLine = (line) => {
    if (!line || typeof line !== 'string') return line;
    try {
      return decodeURIComponent(line);
    } catch {
      return line;
    }
  };

  useEffect(() => {
    if (!window.soundforge) return;

    window.soundforge.onLog((line) => {
      const cleaned = decodeLine(line.trim());
      setLogs((prev) => [...prev, cleaned].filter(Boolean).slice(-200));
    });

    window.soundforge.onProgress((data) => {
      setProgress(data);
    });

    window.soundforge.onComplete(({ isPlaylist }) => {
      const completeMessage = isPlaylist ? 'Download da playlist concluído.' : 'Download concluído.';
      setIsDownloading(false);
      setStatus(isPlaylist ? 'Playlist forjada com sucesso.' : 'Música forjada com sucesso.');
      setLogs([completeMessage]);
      setProgress((prev) => ({ ...prev, percent: 100 }));
    });

    window.soundforge.onError((message) => {
      setIsDownloading(false);
      setStatus(message || 'Falha no download.');
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
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Forja Sonora</p>
          <h1>Soundforge</h1>
          <p className="subtitle">Baixe canções do reino do YouTube com qualidade à sua escolha.</p>
        </div>
        <div className={`crest anvil-crest ${isDownloading ? 'forging' : ''}`} aria-hidden="true">
          <div className="forge-stage">
            <GiAnvil className="forge-anvil" />
            <GiThorHammer className="forge-hammer" />
            <span className="spark spark-a">✦</span>
            <span className="spark spark-b">✦</span>
            <span className="spark spark-c">✦</span>
          </div>
          <span className="crest-state">{forgeStateLabel}</span>
        </div>
      </header>

      <section className="panel">
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
        </div>

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

        {source === 'spotify' && (
          <>
            <label className="label token-label">Token do Spotify</label>
            <input
              className="input"
              type="password"
              placeholder="Cole aqui seu token Bearer"
              value={spotifyToken}
              onChange={(event) => setSpotifyToken(event.target.value)}
            />
            <p className="helper">
              O token é temporário. Não compartilhe nem versione em repositório.
            </p>
            <div className="preview-row">
              <button
                className="button ghost"
                type="button"
                onClick={handleSpotifyPreview}
                disabled={!spotifyToken.trim() || !spotifyPlaylistUrl.trim() || isPreviewing || isDownloading}
              >
                {isPreviewing ? 'Carregando prévia...' : 'Ver prévia da playlist'}
              </button>
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
          </>
        )}

        <div className="grid">
          <div>
            <label className="label">Qualidade do MP3</label>
            <div className="select-row">
              {QUALITY_OPTIONS.map((option) => (
                <label key={option.value} className={`radio ${quality === option.value ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="quality"
                    value={option.value}
                    checked={quality === option.value}
                    onChange={() => setQuality(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Pasta de destino</label>
            <div className="folder-row">
              <button className="button ghost" type="button" onClick={handleSelectFolder}>
                Escolher pasta
              </button>
              <span className="folder-path">{outputDir || 'Nenhuma pasta escolhida'}</span>
            </div>
          </div>
        </div>

        <div className="actions">
          <button
            className="button primary"
            type="button"
            onClick={handleDownload}
            disabled={!isReady || isDownloading || isPreviewing}
          >
            <span className="button-icon">{isDownloading ? '*' : 'v'}</span>
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
        </div>
      </section>

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
          <p>Saída do yt-dlp e etapas do ritual.</p>
        </div>
        <div className="log-box" ref={logBoxRef}>
          {logs.length === 0 ? (
            <p className="log-empty">Nenhuma mensagem ainda.</p>
          ) : (
            logs.map((line, index) => (
              <div key={`${line}-${index}`} className="log-line">
                {line}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
