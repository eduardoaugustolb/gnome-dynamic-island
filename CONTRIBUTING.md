# Contribuindo

Obrigado por querer contribuir com o **Dynamic Island**! Este guia é curto e direto ao ponto.

## Começando

1. Clone e instale para desenvolvimento:

   ```bash
   make install    # instala e habilita
   make restart    # recarrega o código após mudanças
   ```

2. Depois de cada alteração, rode a suíte e a checagem de sintaxe:

   ```bash
   gjs -m tests/run.js
   node --check island.js extension.js prefs.js modules/*.js
   ```

## O que esperar de uma contribuição

- **Mudanças focadas**: prefira PRs pequenos e com um único propósito.
- **Comentários em pt-BR**: o código do projeto é comentado em português; mantenha o padrão.
- **Testes**: se a mudança tocar `modules/media.js`, `modules/notifications.js` ou `modules/notifQueue.js`, adicione/atualize testes em `tests/`.
- **Sem dependências novas** sem necessidade: a extensão roda só com o que o GNOME Shell já entrega.
- **Não quebre o teclado do app**: a regra central do projeto é que a ilha **nunca** rouba o foco de teclado do aplicativo. Mudanças que reintroduzem `grab_key_focus()`/`pushModal` para interação por teclado serão rejeitadas.

## Como testar o comportamento

- A extensão só funciona dentro do GNOME Shell de verdade (Wayland/X11). `tests/` cobre apenas os módulos independentes do Shell.
- Testes manuais úteis: apertar `Espaço` com o Spotify tocando (não deve pausar por engano), deslizar as páginas do painel, arrastar sliders e rolar a lista de notificações sem trocar de página.

## Processo de PR

1. Faça `git pull` da `main` antes de começar.
2. Crie uma branch descritiva: `fix/play-pause-fantasma`, `feat/pagina-notifs`, etc.
3. Commit com mensagem clara no estilo do repositório.
4. Abra o PR; a CI roda testes e sintaxe automaticamente.
5. Descreva o que mudou e como você testou.
