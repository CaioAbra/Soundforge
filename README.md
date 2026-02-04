# Soundforge (v0.5)

App Electron + React com tema medieval para baixar músicas do YouTube como MP3. Se o link for playlist, a lista é detectada automaticamente e os arquivos são salvos em uma pasta de destino escolhida pelo usuário.

## Requisitos
- Node.js 18+
- `ffmpeg` instalado e disponível no PATH (necessário para conversão em MP3)

## Novidades da v0.5
- Download automático do `yt-dlp` no primeiro uso (sem binário no repositório).
- Suporte a playlists do Spotify via token temporário (busca no YouTube por faixa).
- Prévia de playlist do Spotify (lista de faixas).
- Detecção e normalização de links Mix/Radio do YouTube.
- UI/UX do botão principal e responsividade melhoradas (modo compacto automático).

## Observações importantes
- O token do Spotify é temporário. Não compartilhe nem versione em repositório.
- O modo Spotify baixa via busca no YouTube e pode haver diferenças em algumas faixas.
- Se quiser apontar um binário específico do `yt-dlp`, defina `YTDLP_BIN` no ambiente.

## Como rodar
1. `npm install`
2. `npm run dev`

## Build
- `npm run build`
- `npm run electron`

## Observação
Use apenas conteúdos que você tem permissão para baixar.
