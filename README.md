# Soundforge

Soundforge e um app desktop em Electron + React para baixar audio em MP3 a partir do YouTube. Ele tambem aceita playlists do Spotify: o app le as faixas via API do Spotify, busca cada musica no YouTube e salva os resultados na pasta escolhida.

## Recursos

- Downloads do YouTube como MP3, com qualidade configuravel.
- Suporte a videos individuais, playlists, Mix e Radio do YouTube.
- Links de YouTube Radio/Mix (`start_radio=1`, `radio=1`, `list=RD...` ou `/mix/`) sao mantidos como playlists.
- Contagem previa de itens de playlists do YouTube quando o `yt-dlp` consegue informar.
- Download de playlists do Spotify usando um token Bearer temporario.
- Previa de playlists do Spotify antes do download.
- Download automatico do `yt-dlp` no primeiro uso, caso nenhum binario seja encontrado.
- Barra de progresso com faixa atual, velocidade, ETA e indice da playlist quando disponivel.
- Relatorio final enxuto depois de downloads concluidos.

## Requisitos

- Node.js 18+
- npm
- Windows, para usar os binarios `.exe` incluidos/configurados neste checkout
- Conexao com a internet no primeiro uso, se o app precisar baixar o `yt-dlp`

O `ffmpeg` e o `ffprobe` podem ficar em `resources/ffmpeg/`, como neste projeto. Como alternativa, defina `FFMPEG_LOCATION` apontando para a pasta onde eles estao. Para usar um `yt-dlp` especifico, defina `YTDLP_BIN` com o caminho completo do executavel.

## Como Rodar

```powershell
npm install
npm run dev
```

O comando `npm run dev` inicia o Vite e abre o Electron pelo launcher `scripts/run-electron.js`, que remove `ELECTRON_RUN_AS_NODE` do ambiente antes de iniciar o app.

## Build e Execucao

```powershell
npm run build
npm run electron
```

`npm run electron` abre a versao gerada em `dist/` depois do build.

## Como Usar

1. Escolha a fonte: YouTube ou Spotify.
2. Cole o link do video, playlist, Mix/Radio do YouTube ou playlist do Spotify.
3. No modo Spotify, cole um token Bearer valido e, se quiser, use a previa da playlist.
4. Escolha a qualidade do MP3.
5. Escolha a pasta de destino.
6. Inicie o download.

Playlists do YouTube sao salvas em uma subpasta com o titulo da playlist. Playlists do Spotify sao salvas em uma subpasta com o nome da playlist, com prefixos numericos na ordem das faixas.

## Spotify

O token do Spotify e temporario e deve ter permissao para ler a playlist informada. O Soundforge nao baixa audio do Spotify; ele usa os metadados da playlist para procurar cada faixa no YouTube. Por isso, algumas correspondencias podem variar.

## Observacoes

- Use apenas conteudos que voce tem permissao para baixar.
- Nao versione tokens do Spotify nem caminhos locais sensiveis.
- YouTube Radio pode nao informar um total fixo de itens; nesses casos, o progresso mostra os indices conforme o download avanca.
