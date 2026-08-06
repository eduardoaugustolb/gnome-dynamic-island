# Changelog

Todas as mudanças notáveis deste projeto serão documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

## [Não publicado]

### Adicionado
- Repositório público no GitHub com CI (testes + sintaxe em cada push/PR).
- README, CONTRIBUTING e licença GPL-3.0.

## [4] - 2026-08-06

### Adicionado
- Navegação paginada no painel expandido: 3 páginas (**Mídia / Controles / Notificações**) com arrastar horizontal, indicadores clicáveis e navegação por setas no teclado.
- Status "Tocando/Pausado" no player do painel e empty state "Nenhuma mídia ativa".
- A lista de notificações agora ocupa a página inteira e rola internamente — nada é recortado pela borda do painel.

### Corrigido
- **Play/pause fantasma ao apertar Espaço no Spotify**: a ilha não rouba mais o foco de teclado do aplicativo (a barra de espaço voltava "engolida" pelo Shell). O teclado agora chega intacto ao app; a ilha apenas escuta `Escape` e cliques fora.
- Barra de progresso de mídia removida (substituída pelo status Tocando/Pausado).
- Labels em pt-BR completos e "Desligar" com confirmação de dois cliques.

## [3] - 2026-08-05

### Corrigido
- Posicionamento da data na pill (espelhado para manter a hora centrada).
- Capa de álbum via URL (`http(s)://`) além de `file://` — capas do Spotify passam a aparecer.
- Elipsização do título na pill limitada à largura do monitor.

## [2] - 2026-08-04

### Adicionado
- Ação "Abrir no app" no player.
- Confirmação em dois cliques para desligar.
- Lista de notificações rolável dentro do painel.

## [1] - 2026-08-01

### Adicionado
- Versão inicial: pill com relógio/bateria, toasts de notificação, player MPRIS e controles rápidos (volume, brilho, toggles e ações de sistema).
