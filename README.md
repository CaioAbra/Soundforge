# Soundforge

Soundforge e um app desktop em Electron + React para baixar audio em MP3. Ele aceita links do YouTube e playlists do Spotify: no modo Spotify, o app le as faixas, caca cada musica em fontes suportadas pelo `yt-dlp`, grava metadados quando possivel e salva os resultados na pasta escolhida.

O app preserva uma identidade visual escura em marrom/dourado, com logo propria, painel de configuracoes lateral e fluxo pensado para acompanhar downloads longos sem poluir a tela com logs tecnicos.

## Recursos

- Downloads do YouTube como MP3, com qualidade configuravel.
- Suporte a videos individuais, playlists, Mix e Radio do YouTube.
- Links de YouTube Radio/Mix (`start_radio=1`, `radio=1`, `list=RD...` ou `/mix/`) sao mantidos como playlists.
- Contagem previa de itens de playlists do YouTube quando o `yt-dlp` consegue informar.
- Download de playlists do Spotify usando um token Bearer temporario, com busca por faixa no YouTube, SoundCloud, Google Video e Yahoo Video.
- Previa de playlists do Spotify antes do download.
- Login Spotify via OAuth PKCE, com renovacao automatica da sessao quando houver refresh token.
- Fallback sem login para tentar ler a previa publica de playlists do Spotify.
- Token manual do Spotify salvo localmente no perfil do app como alternativa avancada.
- Gravacao de metadados ID3 em MP3s baixados a partir do Spotify, incluindo titulo, artista, playlist/album, numero da faixa e capa quando disponivel.
- Continuidade em playlists do Spotify: se uma faixa nao for encontrada, o app segue para a proxima e lista as pendencias no fim.
- Download automatico do `yt-dlp` no primeiro uso, caso nenhum binario seja encontrado.
- Barra de progresso com faixa atual, velocidade, ETA e indice da playlist quando disponivel.
- Pausa cooperativa: ao pausar, a faixa atual termina e a fila continua depois que o usuario retomar.
- Painel de acompanhamento em quatro areas: progresso, relatorio, musicas baixadas e musicas nao baixadas.
- Relatorio enxuto, com mensagens essenciais em vez da saida tecnica completa do `yt-dlp`.
- Logo propria aplicada na interface, janela do app e instalador Windows.

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

O instalador cria atalho no Desktop, pasta "Soundforge" no Menu Iniciar e entrada oficial em "Aplicativos instalados" / "Programas e Recursos" do Windows. A desinstalacao deve ser feita por essa entrada do Windows, exibida como "Soundforge". O instalador e a janela usam a logo oficial do app.

Para publicar uma nova versao:

1. Atualize o campo `version` em `package.json`.
2. Crie uma tag no formato `vX.Y.Z`, por exemplo `v0.1.7`.
3. Envie a tag para o GitHub.

```powershell
git tag v0.1.7
git push origin v0.1.7
```

O GitHub Actions executa `.github/workflows/release.yml`, gera o instalador Windows e publica os arquivos no GitHub Releases. O `GITHUB_TOKEN` padrao do Actions e usado automaticamente pelo workflow.

## Auto-update

O auto-update roda apenas na versao instalada/empacotada, nunca no `npm run dev`. Quando o app instalado abre, ele consulta o GitHub Releases do repositorio publico `CaioAbra/Soundforge`. Se existir uma versao mais nova publicada com metadados de update, ela e baixada em segundo plano. Quando o download termina, o app mostra um botao para reiniciar e instalar a atualizacao.

Notas importantes:

- No Windows, o instalador funciona sem certificado, mas o SmartScreen pode exibir aviso enquanto o app nao tiver reputacao/assinatura.
- O auto-update so funciona depois que o usuario instalou uma versao gerada por release, porque builds de desenvolvimento nao consultam updates.
- Para macOS, seria necessario configurar assinatura/notarizacao antes de distribuir com auto-update.

## Como Usar

1. Escolha a fonte: YouTube ou Spotify.
2. Cole o link do video, playlist, Mix/Radio do YouTube ou playlist do Spotify.
3. No modo Spotify, cole a playlist. Se nao houver login, o app tenta a previa publica; para mais estabilidade, conecte sua conta Spotify.
4. Escolha a qualidade do MP3.
5. Escolha a pasta de destino.
6. Inicie o download.

Durante o download, o usuario pode pedir pausa. O app termina a faixa atual, pausa a fila e permite continuar de onde parou.

Playlists do YouTube sao salvas em uma subpasta com o titulo da playlist. Playlists do Spotify sao salvas em uma subpasta com o nome da playlist, com prefixos numericos na ordem das faixas.

## Spotify

O Soundforge tenta trabalhar em tres niveis, nesta ordem:

1. Sessao Spotify conectada por OAuth PKCE, com renovacao automatica.
2. Token Bearer manual salvo localmente, como alternativa avancada.
3. Previa publica do embed do Spotify, sem login, quando a playlist permitir.

O login Spotify por OAuth PKCE evita copiar token a cada hora: o Spotify entrega um access token temporario e um refresh token, e o app renova a sessao automaticamente quando precisar.

Para conectar com Client ID proprio:

1. Crie ou use um app no Spotify Developer Dashboard.
2. Cadastre esta Redirect URI no app Spotify:

```text
soundforge://spotify/callback
```

3. Copie o Client ID do app Spotify.
4. Abra as configuracoes do Soundforge, cole o Client ID proprio e clique em "Conectar Spotify".
5. Autorize no navegador e volte para o Soundforge.

Ao clicar em "Conectar Spotify", o Soundforge gera o link oficial de login, tenta abrir o navegador automaticamente e tambem deixa um botao "Abrir login no Spotify" visivel para repetir a abertura se o ambiente de desenvolvimento nao acionar o navegador corretamente.

Tambem e possivel empacotar o app com um Client ID oficial do Soundforge. O app le esse valor da variavel de ambiente `SOUNDFORGE_SPOTIFY_CLIENT_ID` em tempo de execucao ou do campo `soundforge.spotifyClientId` em `package.json`. Nesse caso, o usuario comum pode clicar em "Conectar Spotify" sem colar Client ID proprio, sujeito aos limites e aprovacoes do Spotify para esse app.

A sessao Spotify fica salva localmente no perfil do app, em um arquivo JSON da propria instalacao do usuario, e e preservada nas atualizacoes. O token manual continua disponivel como alternativa avancada nas configuracoes.

O Soundforge nao baixa audio do Spotify; ele usa os metadados da playlist para procurar cada faixa no YouTube e, se a primeira fonte falhar, em outras fontes suportadas pelo `yt-dlp`. Por isso, algumas correspondencias podem variar.

Algumas playlists do Spotify podem retornar HTTP 404 pela Web API mesmo abrindo normalmente no navegador. Nesses casos, o app tenta usar a previa publica do embed do Spotify como fallback para ler nome da playlist e faixas.

Faixas nao encontradas sao puladas, e o app continua a playlist. Ao final, a area "Musicas nao baixadas" lista as pendencias e o motivo.

## Observacoes

- Use apenas conteudos que voce tem permissao para baixar.
- Nao versione tokens do Spotify nem caminhos locais sensiveis.
- YouTube Radio pode nao informar um total fixo de itens; nesses casos, o progresso mostra os indices conforme o download avanca.
