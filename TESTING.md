# Checklist de validação

## Verificação automatizada

- [ ] `make check`
- [ ] `git diff --check`
- [ ] `glib-compile-schemas --strict schemas` (somente quando o artefato compilado puder ser removido depois)

## GNOME Shell 50

- [ ] Ativar e desativar a extensão duas vezes consecutivas.
- [ ] Pill: `center`, `left` e `right`.
- [ ] Notch: `center`, `left` e `right`.
- [ ] Notch com barra superior visível e escondida.
- [ ] Escalas 100%, 125%, 150% e 200%.
- [ ] Monitor pequeno, ultrawide e dois monitores com resoluções diferentes.
- [ ] Trocar monitor primário, resolução e escala durante a sessão.
- [ ] Expandir e recolher rapidamente com painel vazio, mídia e muitas notificações.
- [ ] Abrir e fechar durante Overview, fullscreen, bloqueio e desbloqueio.
- [ ] Confirmar que `Escape` fecha banner/painel sem capturar o teclado da aplicação.
- [ ] Confirmar foco visível, nomes acessíveis e navegação por teclado.
- [ ] Testar tema claro, escuro e alto contraste quando disponível.
- [ ] Testar `animations=false` e `reduced-motion`.
- [ ] Confirmar que não há actors, timers, listeners ou keybindings após disable.

## Ambiente

Registre antes de publicar uma release:

- Versão do GNOME Shell:
- Distribuição e versão:
- Escala:
- Monitores e resoluções:
- Tema:
- Resultado visual:
- Regressões encontradas:
