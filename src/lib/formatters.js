// Funções utilitárias puras — sem dependência de React ou estado.

export const QUALITY_OPTIONS = [
  { label: 'Melhor qualidade', detail: 'MP3 mais fiel', value: '0' },
  { label: 'Alta', detail: 'Ótimo equilíbrio', value: '2' },
  { label: 'Média', detail: 'Uso geral', value: '5' },
  { label: 'Boa para voz', detail: 'Podcasts e falas', value: '7' },
  { label: 'Menor arquivo', detail: 'Ocupa menos espaço', value: '9' }
];

export const SOURCE_OPTIONS = [
  { label: 'YouTube', value: 'youtube' },
  { label: 'Spotify', value: 'spotify' }
];

export const TRACK_FILTERS = [
  { label: 'Todas', value: 'all' },
  { label: 'Baixadas', value: 'downloaded' },
  { label: 'Não baixadas', value: 'missing' },
  { label: 'Com erro', value: 'error' }
];

const TECHNICAL_LOG_PATTERNS = [
  /^\[debug\]/i, /^debug:/i, /^warning:/i, /^error:/i,
  /^\[youtube\].*api json/i, /^\[youtube\].*downloading.*player/i,
  /^\[info\]\s+available formats/i, /^\[download\]\s+destination:/i,
  /^\[download\]\s+\d{1,3}(?:\.\d+)?%/i,
  /^\[download\]\s+got error/i, /^\[download\]\s+retrying/i
];

const decodeLine = (line) => {
  if (!line || typeof line !== 'string') return line;
  try { return decodeURIComponent(line); } catch { return line; }
};

const stripLogPrefix = (line) => line.replace(/^\[(?:INFO|download|youtube|ExtractAudio)\]\s*/i, '').trim();
const filenameFromPath = (value) => (value.split(/[\\/]/).pop() || value).replace(/\.[^/.]+$/, '').trim();

export const liveLog = (text, key) => ({ text, key });
export const getLogText = (entry) => (typeof entry === 'string' ? entry : entry?.text || '');

export function formatReportLine(line) {
  const cleaned = decodeLine(String(line || '').trim());
  if (!cleaned) return [];

  return cleaned.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const liveProgressMatch = part.match(/^\[PROGRESS\]\s+(.+)$/i);
    if (liveProgressMatch) return liveLog(liveProgressMatch[1], 'download-progress');

    if (TECHNICAL_LOG_PATTERNS.some((p) => p.test(part))) return null;

    if (/^\[INFO\]\s+Buscando faixas da playlist no Spotify/i.test(part)) return 'Lendo a playlist do Spotify.';

    const youtubeSearchMatch = part.match(/^\[INFO\]\s+Buscando no YouTube:\s*(.+)$/i);
    if (youtubeSearchMatch) return `Buscando na forja: ${youtubeSearchMatch[1]}`;

    const huntMatch = part.match(/^\[INFO\]\s+Caçando em (.+?):\s*(.+)$/i);
    if (huntMatch) return `Caçando em ${huntMatch[1]}: ${huntMatch[2]}`;

    const sourceMatch = part.match(/^\[INFO\]\s+Fonte encontrada:\s*(.+?)\.$/i);
    if (sourceMatch) return `Fonte encontrada: ${sourceMatch[1]}.`;

    if (/^\[INFO\]\s+Pausa solicitada/i.test(part)) return 'Pausa solicitada. A faixa atual será finalizada primeiro.';
    if (/^\[INFO\]\s+Download pausado/i.test(part)) return 'Download pausado. Pronto para continuar.';
    if (/^\[INFO\]\s+Retomando a forja/i.test(part)) return 'Continuando de onde parou.';
    if (/^\[INFO\]\s+.+? não entregou essa faixa/i.test(part)) return 'Essa fonte não entregou a faixa. Procurando outra.';

    const metadataMatch = part.match(/^\[INFO\]\s+Metadados gravados:\s*(.+)$/i);
    if (metadataMatch) return `Metadados gravados: ${metadataMatch[1]}`;

    if (/^\[AVISO\]\s+Não consegui gravar os metadados/i.test(part)) return 'Faixa baixada, mas os metadados não foram gravados.';

    const skippedMatch = part.match(/^\[AVISO\]\s+Faixa pulada:\s*(.+?)\.\s*Motivo:\s*(.+)$/i);
    if (skippedMatch) return `Faixa não encontrada: ${skippedMatch[1]} (${skippedMatch[2]})`;

    const youtubeSkippedMatch = part.match(/^\[AVISO\]\s+Item\s+(\d+)\s+não foi baixado/i);
    if (youtubeSkippedMatch) return `Faixa ${youtubeSkippedMatch[1]} não foi baixada. Seguindo a sequência.`;

    const playlistKindMatch = part.match(/^\[INFO\]\s+(.+?) detectado\. Mantendo o link como playlist\./i);
    if (playlistKindMatch) return `${playlistKindMatch[1]} detectado. Sequência preservada.`;

    const countMatch = part.match(/^\[INFO\]\s+(\d+)\s+itens encontrados na lista\./i);
    if (countMatch) return `${countMatch[1]} faixas encontradas na sequência.`;

    if (/^\[INFO\]\s+Não foi possível contar os itens/i.test(part)) return 'Sequência detectada. Contagem será atualizada durante a forja.';

    const toolMatch = part.match(/^\[INFO\]\s+Baixando yt-dlp\.\.\.\s*(\d+)%/i);
    if (toolMatch) return liveLog(`Preparando ferramentas: ${toolMatch[1]}%.`, 'tool-download');

    const itemMatch = part.match(/Downloading item (\d+) of (\d+)/i);
    if (itemMatch) return `Forjando faixa ${itemMatch[1]} de ${itemMatch[2]}.`;

    if (/Writing video thumbnail/i.test(part)) return liveLog('Preparando capa da faixa.', 'thumbnail');
    if (/^\[ThumbnailsConvertor\]\s+Converting thumbnail/i.test(part)) return liveLog('Convertendo capa para o MP3.', 'thumbnail');
    if (/Deleting original file/i.test(part)) return liveLog('Limpando arquivos temporários.', 'cleanup');

    const extractMatch = part.match(/^\[ExtractAudio\]\s+Destination:\s*(.+)$/i);
    if (extractMatch) return `Áudio finalizado: ${filenameFromPath(extractMatch[1])}.`;

    const destinationMatch = part.match(/Destination:\s*(.+)$/i);
    if (destinationMatch) return `Arquivo preparado: ${filenameFromPath(destinationMatch[1])}.`;

    const finishedMatch = part.match(/Finished downloading playlist:\s*(.+)$/i);
    if (finishedMatch) return `Sequência concluída: ${finishedMatch[1]}.`;

    const normalized = stripLogPrefix(part);
    return normalized || null;
  }).filter(Boolean);
}

export function appendReportLines(setLogs, entries) {
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
}

export function upsertTrack(items, track) {
  if (!track) return items;
  const next = items.filter((item) => item.index !== track.index);
  next.push(track);
  return next.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
}

export function formatTrackArtists(track) {
  return Array.isArray(track?.artists) && track.artists.length ? track.artists.join(', ') : '';
}
