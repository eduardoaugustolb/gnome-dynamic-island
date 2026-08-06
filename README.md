# Dynamic Island

Uma **Dynamic Island** para o GNOME Shell, no estilo Apple, que substitui a barra superior. Relógio, mídia, notificações e controles rápidos em uma única ilha compacta com animações suaves.

![Licença: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)
[![CI](https://github.com/eduardoaugustolb/gnome-dynamic-island/actions/workflows/ci.yml/badge.svg)](https://github.com/eduardoaugustolb/gnome-dynamic-island/actions)

> Testado no **GNOME Shell 50**. Requer o GJS/Clutter/St do próprio Shell (nenhuma dependência extra).

## Funcionalidades

- **Substitui a barra superior**: a ilha fica centralizada no topo, em modo pill, mostrando data, horário e bateria.
- **Mídia (MPRIS)**: player de mídia do sistema (Spotify, YouTube Music, etc.) com capa do álbum, título/artista, controles de play/pause/anterior/próxima e ação "Abrir no app".
- **Notificações**: toasts sequenciais (fila de amostragem) e lista rolável dentro do painel, com "Limpar" e ação por clique.
- **Controles rápidos**: volume, brilho, Wi-Fi, Bluetooth, Modo escuro, Luz noturna, Não perturbe.
- **Ações de sistema**: Bloquear, Suspender e Desligar (com confirmação de dois cliques para evitar acidentes).
- **Painel paginado**: o painel expandido desliza horizontalmente entre **Mídia / Controles / Notificações** por arrastar, pelos indicadores (bolinhas) ou pelas setas do teclado.
- **Tema claro/escuro**: segue o `color-scheme` do GNOME automaticamente.

## Como funciona

A ilha tem três camadas, trocadas com animação de tamanho/opacidade:

| Estado | Comportamento |
| --- | --- |
| **Pill** | Estado ocioso: relógio, data, bateria e, se houver mídia, controles rápidos. |
| **Banner** | "Live activity" temporária (notificação ou mídia que acabou de começar a tocar), que se recolhe sozinha. |
| **Painel** | Expandido por clique/roda no centro, com as 3 páginas deslizáveis. |

## Instalação

### Manual (recomendado para desenvolvimento)

```bash
make install        # copia para ~/.local/share/gnome-shell/extensions e habilita
make restart        # desabilita, reinstala e reabilita (recarrega o código)
```

### Pela loja de extensões

_Em breve: pacote publicado no [extensions.gnome.org](https://extensions.gnome.org)._

## Uso

| Gestos | Ação |
| --- | --- |
| `scroll` (esquerda/direita) na pill | Alterna a área ativa (relógio / mídia / notificações) |
| Clique na pill | Abre o painel |
| `scroll` para baixo na pill | Recolhe |
| `Escape` | Recolhe o banner/painel |
| `Super+Shift+Espaço` | Play/pausa da mídia (atalho global) |
| Arrastar para o lado no painel | Troca de página |
| Clique nas bolinhas | Vai para a página |
| Setas `←`/`→` (com foco no painel) | Troca de página |

> A ilha **nunca rouba o teclado** do aplicativo: ao contrário de implementações que dão foco ao Shell e "engoliam" a tecla Espaço (o famoso bug do play/pause fantasma), aqui o teclado continua indo direto para o app — a ilha apenas escuta `Escape` e cliques fora dela.

## Configuração

Abra *Configurações → Extensões → Dynamic Island* (ou use o botão de engrenagem). As preferências incluem:

- Largura do painel expandido / altura da pill
- Duração dos toasts (peek) e do banner de mídia
- Mostrar/ocultar controles, notificações e mídia
- Cor de destaque
- Animações (desligáveis)

## Desenvolvimento

### Estrutura

```
extension.js   Entrada da extensão (enable/disable, keybinding global)
island.js      A ilha: pill, banner, painel paginado e toda a UI
prefs.js       Painel de preferências
modules/       Módulos de dados (media.js, controls.js, notifications.js, notifQueue.js)
schemas/       Esquema GSettings
tests/         Suíte de testes sem framework (roda com GJS puro)
```

### Testes

```bash
gjs -m tests/run.js     # 37 testes: media, notifications, notifQueue e integração
node --check island.js  # verificação de sintaxe
```

Os testes cobrem apenas os módulos independentes do Shell (`media.js`, `notifications.js`, `notifQueue.js`) — `island.js`/`controls.js` dependem de `resource:///org/gnome/shell` e só rodam dentro do Shell de verdade.

### CI

`.github/workflows/ci.yml` roda os testes e a checagem de sintaxe em cada push/PR.

## Licença

Distribuído sob a **GNU General Public License v3.0**. Veja [LICENSE](LICENSE).
