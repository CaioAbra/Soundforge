# Soundforge

Soundforge e um app desktop em Electron + React para baixar audio em MP3. Ele aceita links do YouTube e playlists do Spotify: no modo Spotify, o app le as faixas, caca cada musica em fontes suportadas pelo `yt-dlp`, grava metadados quando possivel e salva os resultados na pasta escolhida.

## Recursos

- Downloads do YouTube como MP3, com qualidade configuravel.
- Suporte a videos individuais, playlists, Mix e Radio do YouTube.
- Links de YouTube Radio/Mix (`start_radio=1`, `radio=1`, `list=RD...` ou `/mix/`) sao mantidos como playlists.
- Contagem previa de itens de playlists do YouTube quando o `yt-dlp` consegue informar.
- Download de playlists do Spotify usando um token Bearer temporario, com busca por faixa no YouTube, SoundCloud, Google Video e Yahoo Video.
- Previa de playlists do Spotify antes do download.
- Gravacao de metadados ID3 em MP3s baixados a partir do Spotify, incluindo titulo, artista, playlist/album e numero da faixa.
- Continuidade em playlists do Spotify: se uma faixa nao for encontrada, o app segue para a proxima e lista as pendencias no fim.
- Download automatico do `yt-dlp` no primeiro uso, caso nenhum binario seja encontrado.
- Barra de progresso com faixa atual, velocidade, ETA e indice da playlist quando disponivel.
- Painel de acompanhamento em quatro areas: progresso, relatorio, musicas baixadas e musicas nao baixadas.
- Relatorio enxuto, com mensagens essenciais em vez da saida tecnica completa do `yt-dlp`.

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

## Instalador e Releases

Este projeto usa `electron-builder` para gerar instalador Windows e `electron-updater` para buscar atualizacoes publicadas no GitHub Releases.

Para gerar um instalador local sem publicar:

```powershell
npm run dist
```

Os artefatos locais ficam em `release/`, que nao deve ser versionado.

Para publicar uma nova versao:

1. Atualize o campo `version` em `package.json`.
2. Crie uma tag no formato `vX.Y.Z`, por exemplo `v0.1.1`.
3. Envie a tag para o GitHub.

```powershell
git tag v0.1.1
git push origin v0.1.1
```

O GitHub Actions executa `.github/workflows/release.yml`, gera o instalador Windows e publica os arquivos no GitHub Releases. O `GITHUB_TOKEN` padrao do Actions e usado automaticamente pelo workflow.

## Auto-update

O auto-update roda apenas na versao instalada/empacotada, nunca no `npm run dev`. Quando o app instalado abre, ele consulta o GitHub Releases do repositorio publico `CaioAbra/Soundforge`. Se existir uma versao mais nova publicada com metadados de update, ela e baixada em segundo plano e instalada quando o Soundforge for fechado.

Notas importantes:

- No Windows, o instalador funciona sem certificado, mas o SmartScreen pode exibir aviso enquanto o app nao tiver reputacao/assinatura.
- O auto-update so funciona depois que o usuario instalou uma versao gerada por release, porque builds de desenvolvimento nao consultam updates.
- Para macOS, seria necessario configurar assinatura/notarizacao antes de distribuir com auto-update.

## Como Usar

1. Escolha a fonte: YouTube ou Spotify.
2. Cole o link do video, playlist, Mix/Radio do YouTube ou playlist do Spotify.
3. No modo Spotify, cole um token Bearer valido e, se quiser, use a previa da playlist.
4. Escolha a qualidade do MP3.
5. Escolha a pasta de destino.
6. Inicie o download.

Playlists do YouTube sao salvas em uma subpasta com o titulo da playlist. Playlists do Spotify sao salvas em uma subpasta com o nome da playlist, com prefixos numericos na ordem das faixas.

## Spotify

O token do Spotify e temporario e deve ter permissao para ler a playlist informada. O Soundforge nao baixa audio do Spotify; ele usa os metadados da playlist para procurar cada faixa no YouTube e, se a primeira fonte falhar, em outras fontes suportadas pelo `yt-dlp`. Por isso, algumas correspondencias podem variar.

Algumas playlists do Spotify podem retornar HTTP 404 pela Web API mesmo abrindo normalmente no navegador. Nesses casos, o app tenta usar a previa publica do embed do Spotify como fallback para ler nome da playlist e faixas.

Faixas nao encontradas sao puladas, e o app continua a playlist. Ao final, a area "Musicas nao baixadas" lista as pendencias e o motivo.

## Observacoes

- Use apenas conteudos que voce tem permissao para baixar.
- Nao versione tokens do Spotify nem caminhos locais sensiveis.
- YouTube Radio pode nao informar um total fixo de itens; nesses casos, o progresso mostra os indices conforme o download avanca.
