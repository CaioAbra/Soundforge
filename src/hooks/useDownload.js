import { useCallback, useRef, useState } from 'react';
import { appendReportLines, formatReportLine, upsertTrack } from '../lib/formatters';

const EMPTY_PROGRESS = { percent: 0, speed: '', eta: '', title: '', itemIndex: null, itemCount: null };

/**
 * Gerencia todo o estado e lógica de download:
 * - Estado: isDownloading, pauseState, logs, downloadedTracks, skippedTracks, progress
 * - IPC: onLog, onProgress, onPauseState, onTrackComplete, onTrackSkipped, onComplete, onError
 * - Handlers: startDownload, handlePauseToggle
 * Retorna também `setStatus` para que o chamador possa ser notificado de mudanças de status.
 */
export function useDownload({ setStatus }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [pauseState, setPauseState] = useState('idle');
  const [logs, setLogs] = useState([]);
  const [downloadedTracks, setDownloadedTracks] = useState([]);
  const [skippedTracks, setSkippedTracks] = useState([]);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const isDownloadingRef = useRef(false);

  // Mantém a ref sincronizada para uso em closures assíncronas
  const syncIsDownloading = useCallback((value) => {
    isDownloadingRef.current = value;
    setIsDownloading(value);
  }, []);

  // ── IPC subscriptions ───────────────────────────────────────────────────────
  const subscribeDownloadEvents = useCallback(() => {
    if (!window.soundforge) return () => {};

    const unsubLog = window.soundforge.onLog((line) => {
      appendReportLines(setLogs, formatReportLine(line));
    });

    const unsubProgress = window.soundforge.onProgress((data) => {
      setProgress(data);
    });

    const unsubPauseState = window.soundforge.onPauseState?.(({ state }) => {
      setPauseState(state || 'idle');
      if (state === 'pausing') setStatus('Pausando após a faixa atual.');
      if (state === 'paused') setStatus('Download pausado.');
      if (state === 'running') setStatus('Forja em andamento.');
    });

    const unsubTrackComplete = window.soundforge.onTrackComplete((track) => {
      setDownloadedTracks((prev) => upsertTrack(prev, track));
    });

    const unsubTrackSkipped = window.soundforge.onTrackSkipped((track) => {
      setSkippedTracks((prev) => upsertTrack(prev, track));
    });

    const unsubComplete = window.soundforge.onComplete(({ isPlaylist, downloadedTracks: dl = [], skippedTracks: sk = [] }) => {
      const completed = Array.isArray(dl) ? dl : [];
      const skipped = Array.isArray(sk) ? sk : [];
      const skippedCount = skipped.length;
      const completeMessage = isPlaylist
        ? (skippedCount ? `Download da playlist concluído com ${skippedCount} faixa(s) não baixada(s).` : 'Download da playlist concluído.')
        : 'Download concluído.';
      syncIsDownloading(false);
      setPauseState('idle');
      setStatus(skippedCount ? 'Playlist forjada com pendências.' : isPlaylist ? 'Playlist forjada com sucesso.' : 'Música forjada com sucesso.');
      setLogs([completeMessage]);
      setDownloadedTracks(completed);
      setSkippedTracks(skipped);
      setProgress({ ...EMPTY_PROGRESS, title: completeMessage });
    });

    const unsubError = window.soundforge.onError((message) => {
      syncIsDownloading(false);
      setPauseState('idle');
      setStatus(message || 'Falha no download.');
      appendReportLines(setLogs, [`Falha na forja: ${message || 'download interrompido.'}`]);
    });

    return () => {
      unsubLog?.();
      unsubProgress?.();
      unsubPauseState?.();
      unsubTrackComplete?.();
      unsubTrackSkipped?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, [setStatus, syncIsDownloading]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const startDownload = useCallback((payload) => {
    if (!window.soundforge || isDownloadingRef.current) return;
    setLogs([]);
    setDownloadedTracks([]);
    setSkippedTracks([]);
    setStatus('Invocando a forja...');
    syncIsDownloading(true);
    setPauseState('running');
    setProgress(EMPTY_PROGRESS);
    window.soundforge.startDownload(payload);
  }, [setStatus, syncIsDownloading]);

  const handlePauseToggle = useCallback(async () => {
    if (!window.soundforge || !isDownloadingRef.current) return;
    if (pauseState === 'paused') {
      setPauseState('running');
      await window.soundforge.resumeDownload?.();
      return;
    }
    setPauseState('pausing');
    await window.soundforge.pauseDownload?.();
  }, [pauseState]);

  return {
    isDownloading,
    isDownloadingRef,
    pauseState,
    logs,
    setLogs,
    downloadedTracks,
    skippedTracks,
    progress,
    startDownload,
    handlePauseToggle,
    subscribeDownloadEvents
  };
}
