# Soundforge

App Electron + React com tema medieval para baixar músicas do YouTube como MP3. Se o link for playlist, a lista é detectada automaticamente e os arquivos são salvos em uma pasta de destino escolhida pelo usuário.

## Requisitos
- Node.js 18+
- `yt-dlp` instalado e disponível no PATH
- `ffmpeg` instalado e disponível no PATH

Opcional: defina `YTDLP_BIN` no ambiente para apontar para o binário do `yt-dlp`.

## Como rodar
1. `npm install`
2. `npm run dev`

## Build
- `npm run build`
- `npm run electron`

## Observação
Use apenas conteúdos que você tem permissão para baixar.
