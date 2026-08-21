# Auditoria UI/UX — Ilha Dinâmica (Revisão pós-correções / v2)

## 1. Objetivo deste documento

Este documento complementa a auditoria anterior e analisa a **nova versão da interface após as tentativas de correção**.

Ele cobre:

- O que **melhorou**
- O que **permaneceu com problema**
- O que **piorou** ou foi **introduzido como regressão**
- Problemas de **UI**
- Problemas de **UX**
- Problemas de **interação com teclado**
- Problemas de **sincronização de mídia**
- Recomendações práticas de **correção**
- Regras para **evitar reincidência**

O objetivo aqui não é apenas apontar bugs pontuais, mas consolidar uma visão de produto e engenharia para que a ilha dinâmica passe a funcionar como um sistema consistente, confiável e previsível.

---

# 2. Resumo executivo

## 2.1. O que melhorou

Houve algumas melhorias perceptíveis em relação à versão anterior:

- A grade dos controles rápidos ficou mais organizada do que antes.
- Alguns botões ganharam dimensões mais consistentes.
- A notificação recebeu uma estrutura mais clara.
- O painel expandido ficou mais limpo visualmente do que a versão anterior.
- A hierarquia geral entre cabeçalho, player e controles rápidos está um pouco melhor.

Essas mudanças mostram progresso, mas a interface ainda apresenta problemas importantes.

---

## 2.2. Principais problemas que continuam

Mesmo após as correções, ainda permanecem:

- Títulos truncados sem necessidade:
  - `Quick Contr...`
  - `Notificatio...`
  - `Limp...`
- Mistura de idiomas:
  - `Dark Mode`
  - `Lock`
  - `Power Off`
  - `Suspender`
  - `Quick Contr...`
- Uso ineficiente do espaço horizontal
- White space artificial em alguns componentes
- Problemas de agrupamento semântico
- Estado compacto ainda mostrando informação demais
- Player expandido ainda com áreas vazias
- Notificação ainda com truncamento e distribuição ruim do texto
- Hierarquia tipográfica ainda incompleta em alguns pontos

---

## 2.3. Principais regressões introduzidas

Além dos problemas anteriores, surgiram **novos bugs e regressões**:

1. **Atalho de espaço causando play/pause infinito**
2. **Barra de progresso da mídia quebrada**
3. **Progresso visual causando perda de confiança no componente**
4. **Agrupamento de ações de sistema junto com toggles**
5. **Novas inconsistências de idioma**
6. **Novas inconsistências na ocupação da grade**
7. **Aumento da complexidade visual do player compacto**
8. **Introdução de uma feature instável que deveria ser removida**

Esses pontos são importantes porque não são apenas defeitos visuais: eles afetam diretamente a experiência do usuário e a confiabilidade da interface.

---

# 3. Análise do estado atual por componente

---

# 4. Notificação recebida

## 4.1. O que melhorou

Comparando com a versão anterior:

- O card parece um pouco mais organizado.
- O nome do app, título e horário estão mais separados.
- A estrutura geral está mais legível.

---

## 4.2. Problemas que permanecem

### 4.2.1. O texto ainda quebra/trunca sem necessidade

O corpo da notificação ainda aparece como:

- `This is the text body of the not...`
- `Pretty cool, huh?`

Esse padrão ainda mostra o mesmo problema central da versão anterior: **o texto não está sendo distribuído corretamente dentro do espaço disponível**.

Há espaço visual razoável no componente, mas o bloco de conteúdo continua se comportando como se estivesse preso a uma largura menor do que a real.

### Impacto de UX

- O usuário recebe menos informação do que poderia.
- A interface parece “quebrada”, mesmo quando está funcional.
- O truncamento precoce reduz a confiança na qualidade do sistema.

### Solução recomendada

O corpo deve ser um **único bloco de texto com clamp de duas linhas**, e não duas linhas independentes.

```css
.notification-body {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
```

E o container textual precisa de:

```css
.notification-content {
  min-width: 0;
  flex: 1 1 auto;
}
```

---

### 4.2.2. Ainda existe espaço horizontal pouco aproveitado

Mesmo com o botão de fechar do lado direito, ainda parece haver uma área que não está sendo aproveitada com eficiência pelo bloco textual.

### Possível causa

- coluna do botão de fechar maior do que o necessário
- coluna de horário reservando mais largura do que deveria
- largura fixa ou max-width no bloco textual
- grid mal balanceado

### Solução

Estruturar a notificação assim:

```css
.toast {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 32px;
  gap: 12px;
}
```

---

### 4.2.3. Botão de fechar ainda chama atenção demais

O botão `X` melhorou, mas ainda é mais proeminente do que deveria.

### Impacto

- ele compete com o conteúdo principal
- ele chama atenção antes do título
- ele dá a sensação de ser uma ação principal

### Solução

- reduzir contraste no estado normal
- aplicar hover visível apenas ao passar o mouse
- manter área clicável adequada, mas visualmente mais discreta

```css
.toast-close {
  width: 32px;
  height: 32px;
  opacity: 0.8;
}
```

---

### 4.2.4. A URL adiciona densidade sem prioridade clara

A linha `www.bennish.net` aparece entre o título e o corpo da notificação. Ela pode ser útil, mas atualmente não está clara a sua prioridade visual.

### Problema

- aumenta a altura do componente
- desloca o corpo da mensagem para baixo
- concorre com o título e a mensagem
- pode ser irrelevante em grande parte dos casos

### Solução

Definir política de conteúdo:

- se a URL for essencial, tratá-la como metadado secundário;
- se não for essencial, omitir;
- se for opcional, exibir só em expansão ou hover.

---

# 5. Player compacto (ilha fechada com música)

## 5.1. Problemas que persistem

### 5.1.1. O estado compacto ainda está “pouco compacto”

Mesmo após a reorganização, o player compacto continua carregando muita responsabilidade visual:

- capa
- título
- artista
- três botões
- barra de progresso

Isso torna o estado “compacto” mais próximo de um mini-player completo do que de uma ilha dinâmica compacta.

### Impacto

- maior ruído visual
- menor foco
- componente mais alto
- mais chance de bugs de layout
- pior adaptação a conteúdo variável

### Solução recomendada

O estado compacto deve mostrar apenas:

**opção ideal**
- capa
- título
- artista
- botão play/pause

**opção aceitável**
- capa
- título
- artista
- anterior / play-pause / próximo

Mas **sem barra de progresso**.

---

## 5.2. Nova regressão: barra de progresso instável

### Problema relatado

A barra de progresso:

- avança um segundo
- volta para zero
- avança um segundo
- volta para zero
- nunca progride corretamente

O próprio usuário informou que prefere **remover essa funcionalidade**.

### Diagnóstico de UX

Essa decisão está correta.

Uma barra de progresso que erra constantemente é pior do que não ter barra nenhuma, porque:

- induz o usuário ao erro
- comunica informação falsa
- destrói a confiança no player
- faz o sistema parecer quebrado
- aumenta a carga cognitiva sem entregar valor

### Recomendação de produto

**Remover completamente a barra de progresso** da ilha dinâmica — tanto do player compacto quanto do player expandido — até existir um sistema confiável de sincronização de mídia.

### Solução recomendada

Remover da UI:

- a linha de progresso
- o thumb/ponto
- qualquer animação de avanço

Substituir por nada, ou por um indicador mais confiável:

- label pequena `Tocando`
- ícone de equalizador discreto
- pequeno status `Pausado`

### Regra de produto

> Uma informação temporal só deve existir se puder ser mantida de forma confiável.

---

## 5.3. Nova regressão: espaço ocupado por uma feature ruim

A barra de progresso adiciona:

- altura extra
- mais uma linha visual
- ruído no rodapé do card
- sensação de compressão vertical

Mesmo que estivesse correta, no estado compacto ela já seria discutível. Estando bugada, ela se torna um problema ainda maior.

### Solução

Remover completamente o progresso do estado fechado.

---

## 5.4. Os botões ainda ocupam muito espaço

Mesmo sem a barra, os controles laterais continuam fortes demais para um estado compacto.

### Solução

Se mantiver três botões:

- anterior: `32px`
- play/pause: `36px`
- próximo: `32px`

Se a prioridade for máxima simplicidade:

- mostrar apenas play/pause

---

# 6. Bug crítico de UX: tecla espaço causando play/pause infinito

## 6.1. Descrição do problema

Quando o usuário pressiona a tecla **espaço** para controlar a música no Spotify, a mídia entra em um comportamento de loop:

- toca
- pausa
- toca
- pausa
- repetidamente / infinitamente

Esse é um bug grave de UX e de arquitetura de interação.

---

## 6.2. Impacto na experiência

Esse bug é crítico porque afeta uma ação extremamente comum e natural.

### Consequências

- o usuário perde o controle da mídia
- a interface parece instável
- o atalho de teclado deixa de ser confiável
- o usuário não sabe se o erro veio da ilha ou do Spotify
- a confiança no sistema cai drasticamente

Esse tipo de erro é pior do que um erro puramente visual porque ele transforma uma ação simples em algo imprevisível.

---

## 6.3. Possíveis causas técnicas

Embora sem inspecionar o código não seja possível afirmar com certeza, os cenários mais prováveis são:

### 6.3.1. `keydown` sendo processado repetidamente

A tecla espaço pode estar disparando repetição automática do teclado (`event.repeat`).

Se o sistema não ignora repetições, ele pode enviar múltiplos toggles.

### 6.3.2. Atalho global sem escopo

O listener pode estar ouvindo `Space` globalmente, mesmo quando:

- o foco não está no componente
- o Spotify já processa o espaço
- outro elemento ativo também responde ao espaço

### 6.3.3. Duplicidade de listeners

Pode haver mais de um listener ativo:

- um no documento
- um no componente
- outro recriado a cada render

### 6.3.4. Feedback loop entre comando e sincronização de estado

Esse é um dos cenários mais comuns:

1. usuário pressiona espaço
2. o app envia `togglePlayback()`
3. o Spotify muda o estado
4. o app recebe o novo estado
5. o app reage chamando o toggle novamente
6. cria-se um loop de alternância

### 6.3.5. Falta de separação entre “evento de intenção” e “evento de estado”

A UI pode estar tratando da mesma forma:

- o desejo do usuário de alternar playback
- a atualização externa vinda do Spotify

Essas duas coisas precisam ser tratadas separadamente.

---

## 6.4. Solução recomendada

### Regra 1 — separar comando e sincronização

- `togglePlayback()` só deve ser chamado em ações explícitas do usuário
- atualizações vindas do Spotify devem **apenas atualizar o estado local**
- atualização de estado nunca deve disparar novo toggle

### Regra 2 — ignorar repetição automática

```js
window.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  if (event.repeat) return;
});
```

### Regra 3 — definir escopo do atalho

O espaço não deve ser capturado indiscriminadamente.

Definir quando ele vale:

- apenas com foco na ilha
- apenas quando o player estiver ativo
- apenas quando não houver inputs focados
- ou não interceptar o espaço se o próprio Spotify já controla a mídia

### Regra 4 — impedir múltiplos listeners

Garantir cleanup correto:

```js
useEffect(() => {
  const onKeyDown = (event) => { ... };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, []);
```

### Regra 5 — lock de transição

Ao enviar um comando de play/pause, pode haver um pequeno lock temporário para evitar reentrada até a confirmação do estado.

---

## 6.5. Recomendação de UX

Se o controle global por teclado ainda não estiver estável, é melhor:

- desabilitar temporariamente o atalho na ilha
- manter apenas controle via clique
- ou deixar o controle global apenas com o app de origem

**Melhor remover uma interação instável do que manter um comportamento imprevisível.**

---

# 7. Player expandido

## 7.1. O que melhorou

- O card ficou mais limpo.
- O título e o artista estão mais legíveis.
- Os controles estão mais separados do restante do painel.

---

## 7.2. Problemas que permanecem

### 7.2.1. Ainda há espaço vazio excessivo

O player expandido continua tendo uma grande área vazia entre:

- artista
- linha de progresso
- controles

Agora a barra de progresso ocupa esse espaço, mas como ela é uma feature instável, o problema volta imediatamente quando ela for removida.

### Solução

Após remover a barra de progresso, reorganizar o card:

#### Estrutura melhor
- título
- artista
- pequena separação
- controles

Opcionalmente:
- capa pequena à esquerda
- ou indicador de estado `Tocando` / `Pausado`

---

### 7.2.2. O player expandido ainda não entrega ganho funcional suficiente

Mesmo expandido, ele ainda faz relativamente pouco:

- mostra título
- mostra artista
- mostra botões

Sem progresso confiável, ele não agrega informação temporal.
Sem capa, ele perde reconhecimento visual.
Sem ações adicionais, o ganho sobre o estado compacto ainda é modesto.

### Solução de produto

Decidir qual é o objetivo do estado expandido:

**Opção A — player leve**
- título
- artista
- controles
- botão “Abrir no Spotify”

**Opção B — player completo**
- capa
- título
- artista
- dispositivo de saída
- controles
- abrir app

Se não houver dados confiáveis de progresso, não fingir que há.

---

# 8. Painel expandido — problemas visuais que permaneceram

## 8.1. Títulos de seção ainda truncados

Ainda aparecem:

- `Quick Contr...`
- `Notificatio...`
- `Limp...`

Esse é um problema que já havia sido documentado e continua existindo.

### Impacto

- sensação de interface inacabada
- desperdício de espaço
- baixa polidez
- pior percepção de qualidade

### Solução

Não usar títulos truncados para labels curtas.

Deve ser:

- `Controles rápidos`
- `Notificações`
- `Limpar`

Se a largura for pequena demais, o problema é estrutural, não textual.

---

## 8.2. Mistura de idiomas piorou

Agora aparecem na mesma interface:

- `Dark Mode`
- `Luz noturna`
- `Não perturbe`
- `Lock`
- `Suspender`
- `Power Off`
- `Quick Contr...`
- `Notificatio...`

### Problema

A inconsistência linguística quebra a sensação de produto finalizado.

### Solução

Definir um idioma único.

Se a interface é em português, usar:

- Modo escuro
- Luz noturna
- Não perturbe
- Bloquear
- Suspender
- Desligar
- Controles rápidos
- Notificações
- Limpar

---

## 8.3. Agrupamento semântico incorreto

Na grade atual, `Lock` aparece como se fosse um toggle semelhante a:

- Wi-Fi
- Bluetooth
- Dark Mode
- Luz noturna
- Não perturbe

Mas ele não pertence ao mesmo grupo funcional.

### Problema

Mistura-se:

- toggles de estado contínuo
- ações de sistema

Isso prejudica a compreensão da interface.

### Solução

Separar em duas seções distintas:

### Grupo 1 — Controles rápidos
- Wi-Fi
- Bluetooth
- Modo escuro
- Luz noturna
- Não perturbe

### Grupo 2 — Ações do sistema
- Bloquear
- Suspender
- Desligar

---

## 8.4. Grade com ocupação inconsistente

A grade dos toggles melhorou, mas ainda gera uma composição estranha:

- primeira linha com 3 controles
- segunda linha com 3 controles, mas misturando categoria
- terceira linha com 2 controles apenas

Isso produz:

- quebra de lógica
- peso visual desequilibrado
- espaços vazios estruturais
- leitura menos previsível

### Solução

Separar por blocos:

```text
Controles rápidos
[ Wi‑Fi ] [ Bluetooth ] [ Modo escuro ]
[ Luz noturna ] [ Não perturbe ] [ vazio opcional / outro toggle ]

Ações do sistema
[ Bloquear ] [ Suspender ] [ Desligar ]
```

Ou então:

```text
Controles rápidos
[ Wi‑Fi ] [ Bluetooth ] [ Modo escuro ]
[ Luz noturna ] [ Não perturbe ]

Ações do sistema
[ Bloquear ] [ Suspender ] [ Desligar ]
```

---

## 8.5. Ações destrutivas ainda muito próximas de toggles do dia a dia

`Power Off` continua aparecendo visualmente muito próximo de ações simples como:

- luz noturna
- não perturbe
- bloquear

### Problema de UX

Desligar o sistema é uma ação de altíssima consequência, não pode parecer apenas mais um toggle comum.

### Solução

- separar visualmente
- usar estilo diferenciado sutil
- pedir confirmação ao clicar
- considerar menu secundário em vez de botão imediato

---

# 9. White space e ocupação de espaço — estado atual

## 9.1. O problema foi reduzido, mas não resolvido

Houve redução de white space desnecessário em alguns lugares, porém ele continua aparecendo sob novas formas:

- textos ainda não usam 100% da largura útil
- algumas colunas parecem maiores do que o necessário
- botões ocupam área demais em comparação ao valor que entregam
- a ausência de progresso confiável no player deixa um vazio estrutural
- as seções ainda têm espaços que não parecem intencionais

---

## 9.2. Regra prática para evitar isso

Todo componente deve responder:

- Qual parte tem largura fixa?
- Qual parte cresce?
- Qual parte encolhe?
- Qual parte pode truncar?
- Qual parte pode quebrar em duas linhas?

Sem essa resposta, o layout sempre volta a desperdiçar espaço.

---

# 10. Problemas de confiança do sistema

Esse ponto merece uma seção separada porque vários bugs atuais têm uma consequência comum: **reduzir a confiança do usuário**.

## 10.1. Exemplos atuais

- Tecla espaço causa loop de play/pause
- Barra de progresso avança e volta para zero
- Títulos continuam truncando sem necessidade
- Mistura de idiomas faz parecer que a UI está incompleta
- Agrupamento semântico incorreto dificulta a leitura

## 10.2. Por que isso é grave

Uma ilha dinâmica desse tipo depende fortemente de percepção de qualidade.

Ela precisa parecer:

- leve
- previsível
- confiável
- precisa
- instantânea

Quando ela começa a mostrar dados errados ou responder mal a interações básicas, ela deixa de parecer um recurso nativo e passa a parecer um overlay frágil.

---

# 11. Recomendações de prioridade

## 11.1. Prioridade crítica

1. **Remover a barra de progresso da mídia**
2. **Corrigir o loop infinito de play/pause com a tecla espaço**
3. **Parar de truncar títulos de seção curtos**
4. **Unificar o idioma**
5. **Separar toggles de ações do sistema**

---

## 11.2. Prioridade alta

1. Corrigir o truncamento residual da notificação
2. Reorganizar o player expandido após remover o progresso
3. Reduzir complexidade do player compacto
4. Reorganizar a grade dos controles
5. Melhorar o agrupamento visual das ações de sistema

---

## 11.3. Prioridade média

1. Refinar contraste do botão fechar
2. Revisar o uso da URL na notificação
3. Revisar o peso visual dos botões do player compacto
4. Definir melhor o comportamento do estado expandido
5. Adicionar ação clara “Abrir no Spotify”

---

# 12. Solução recomendada de produto (versão simplificada e segura)

Se o objetivo for estabilizar a interface rapidamente, a versão mais segura seria:

## 12.1. Ilha compacta de mídia
- capa
- título
- artista
- botão play/pause
- opcionalmente anterior/próximo
- **sem barra de progresso**

## 12.2. Player expandido
- título
- artista
- controles
- botão “Abrir no Spotify”
- **sem barra de progresso**
- sem métricas temporais enquanto não houver sincronização confiável

## 12.3. Controles rápidos
- Wi-Fi
- Bluetooth
- Modo escuro
- Luz noturna
- Não perturbe

## 12.4. Ações do sistema
- Bloquear
- Suspender
- Desligar

## 12.5. Notificação
- app
- horário
- título
- corpo com duas linhas
- fechar discreto
- URL só se for realmente importante

---

# 13. Regras para evitar novas regressões

## 13.1. Não introduzir feature instável só para “completar” a UI

Se uma funcionalidade não está confiável, ela deve ser:

- adiada
- escondida
- removida temporariamente

Nunca exibida parcialmente de forma enganosa.

---

## 13.2. Definir uma fonte única de verdade para mídia

O estado de mídia precisa ter um source of truth claro:

- tocando ou pausado
- qual faixa
- posição atual
- duração
- timestamp da última atualização

A UI não pode inventar nem inferir progresso se o backend/source não consegue sustentá-lo.

---

## 13.3. Separar claramente eventos de intenção e eventos de sincronização

- clique/tecla -> intenção do usuário
- callback do Spotify -> atualização de estado

Essas duas coisas não devem chamar a mesma rotina de forma simétrica.

---

## 13.4. Toda correção visual precisa ser testada com conteúdo real

Sempre testar com:

- textos curtos
- textos longos
- labels em português
- labels em inglês
- sem URL
- com URL
- capa presente
- capa ausente
- música pausada
- música tocando
- painel aberto
- painel fechado

---

# 14. Checklist final para a próxima iteração

## Interação de mídia
- [ ] Espaço não gera toggle infinito
- [ ] Não há múltiplos listeners ativos
- [ ] Estado vindo do Spotify não dispara novo toggle
- [ ] Player funciona sem barra de progresso

## Interface de mídia
- [ ] Barra de progresso removida
- [ ] Player compacto ficou realmente compacto
- [ ] Player expandido ganhou hierarquia melhor
- [ ] Há ação clara para abrir o app

## Layout textual
- [ ] Sem `Quick Contr...`
- [ ] Sem `Notificatio...`
- [ ] Sem `Limp...`
- [ ] Corpo da notificação usa duas linhas corretamente
- [ ] Conteúdo textual ocupa largura disponível

## Consistência
- [ ] Idioma único
- [ ] Toggles separados de ações do sistema
- [ ] Desligar tratado como ação destrutiva
- [ ] Espaçamentos seguem tokens

---

# 15. Conclusão

A interface evoluiu em alguns aspectos, mas a nova iteração ainda preserva problemas antigos e introduziu regressões importantes.

Os dois problemas mais graves desta rodada não são visuais: são de **confiabilidade de interação**:

1. **a tecla espaço que entra em loop de play/pause**
2. **a barra de progresso que nunca progride corretamente**

Esses dois pontos afetam a credibilidade do sistema e devem ser tratados imediatamente.

Do ponto de vista de produto e UX, a melhor decisão agora é:

- **remover a barra de progresso**
- **estabilizar o controle de mídia**
- **simplificar o player**
- **corrigir a estrutura semântica do painel**
- **eliminar truncamentos desnecessários**
- **unificar o idioma**

A direção visual é promissora, mas o componente ainda precisa ser guiado por uma regra mais importante:

> Melhor uma UI ligeiramente mais simples, porém confiável, do que uma UI mais completa e visualmente rica, mas instável.


---

# 16. Novo problema crítico: player expandido recorta o container de notificações

## 16.1. Descrição do problema

Quando existe uma mídia em reprodução e a ilha dinâmica está aberta, o player expandido ocupa uma parte grande da altura disponível do painel.

Como consequência:

- o container de notificações perde espaço;
- parte da lista fica escondida;
- o conteúdo parece recortado;
- a barra de rolagem pode começar em uma região muito pequena;
- em alturas menores de tela, a seção de notificações pode praticamente desaparecer;
- o painel ultrapassa a área visual disponível;
- o usuário não consegue acessar todas as notificações com facilidade.

Esse é um problema de **responsividade vertical**, não apenas horizontal.

---

## 16.2. Por que isso acontece

O layout provavelmente está utilizando uma combinação semelhante a:

- altura fixa no painel;
- altura fixa no player;
- altura fixa nos controles rápidos;
- notificações sem `min-height: 0`;
- lista sem `overflow-y: auto`;
- container pai com `overflow: hidden`;
- ausência de cálculo da altura disponível;
- seções empilhadas sem regras de prioridade.

Quando todas as seções têm altura própria e nenhuma delas aceita encolher, o painel ultrapassa o espaço disponível. O navegador então recorta a parte inferior ou comprime o último bloco.

---

## 16.3. Impacto de UI

Visualmente, o problema gera:

- cards cortados;
- scrollbar incompleta;
- bordas inferiores desaparecendo;
- impressão de painel quebrado;
- notificações parcialmente visíveis;
- desequilíbrio entre mídia e conteúdo do sistema.

---

## 16.4. Impacto de UX

Do ponto de vista de experiência, o problema é ainda mais grave:

- o usuário não consegue acessar notificações importantes;
- a mídia passa a bloquear conteúdo não relacionado;
- a interface perde previsibilidade;
- o painel deixa de funcionar em telas menores;
- o usuário precisa pausar ou fechar a mídia para enxergar notificações;
- a prioridade do player se torna excessiva.

Um player de mídia nunca deve impedir o acesso a notificações.

---

# 17. Estratégia correta de responsividade vertical

## 17.1. O painel deve respeitar a altura da viewport

O painel aberto não deve usar apenas uma altura fixa.

Recomendado:

```css
.dynamic-panel {
  width: min(420px, calc(100vw - 24px));
  max-height: min(720px, calc(100dvh - 24px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

Usar `100dvh` é preferível a `100vh` em ambientes onde barras do sistema podem variar.

---

## 17.2. Cabeçalho e controles devem permanecer estáveis

As seções superiores podem permanecer com altura natural:

```css
.panel-header,
.media-player,
.quick-controls,
.system-actions {
  flex: 0 0 auto;
}
```

---

## 17.3. A seção de notificações deve ocupar o restante

A lista de notificações precisa ser a área flexível:

```css
.notifications-section {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

A lista interna deve rolar:

```css
.notification-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
```

O `min-height: 0` é essencial. Sem ele, o item flex pode se recusar a encolher e ultrapassar o painel.

---

## 17.4. Estrutura recomendada

```html
<aside class="dynamic-panel">
  <header class="panel-header">...</header>

  <section class="media-player">...</section>

  <section class="quick-controls">...</section>

  <section class="system-actions">...</section>

  <section class="notifications-section">
    <header class="notifications-header">...</header>
    <div class="notification-list">...</div>
  </section>
</aside>
```

```css
.dynamic-panel {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 24px);
  overflow: hidden;
}

.notifications-section {
  flex: 1;
  min-height: 0;
}

.notification-list {
  height: 100%;
  overflow-y: auto;
}
```

---

# 18. O player também precisa ser responsivo

## 18.1. Não usar altura fixa grande

Evitar:

```css
.media-player {
  height: 170px;
}
```

Preferir:

```css
.media-player {
  min-height: 96px;
  height: auto;
}
```

---

## 18.2. Criar variantes por altura disponível

O player pode ter três densidades:

### Variante confortável

Usada quando existe bastante altura:

- título
- artista
- capa
- controles
- ação “Abrir no Spotify”

### Variante compacta

Usada quando a altura é limitada:

- título
- artista
- controles
- sem capa grande
- sem conteúdo adicional

### Variante mínima

Usada em telas muito baixas:

- título em uma linha
- artista omitido ou reduzido
- apenas play/pause
- player com altura mínima

---

## 18.3. Exemplo com media query por altura

```css
@media (max-height: 760px) {
  .media-player {
    padding: 12px;
  }

  .media-player-cover {
    width: 48px;
    height: 48px;
  }

  .media-secondary-actions {
    display: none;
  }
}

@media (max-height: 620px) {
  .media-player {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 64px;
  }

  .media-player-cover,
  .media-artist,
  .media-secondary-controls {
    display: none;
  }
}
```

---

# 19. Prioridade dinâmica entre player e notificações

## 19.1. Regra de produto

Quando o espaço vertical for insuficiente:

1. preservar cabeçalho;
2. preservar controles essenciais;
3. reduzir o player;
4. manter notificações acessíveis por rolagem;
5. esconder ações secundárias;
6. nunca cortar a lista de notificações.

---

## 19.2. O que deve ser reduzido primeiro

Ordem recomendada:

1. remover barra de progresso;
2. remover capa grande;
3. remover controles secundários;
4. reduzir paddings;
5. reduzir gaps;
6. limitar altura do player;
7. manter notificações roláveis.

---

## 19.3. O que não deve acontecer

Não é aceitável:

- notificações ficarem completamente escondidas;
- cards serem cortados pela borda;
- a scrollbar sair do painel;
- o player exigir fechamento manual para liberar conteúdo;
- o painel ultrapassar a viewport;
- o usuário perder acesso ao botão “Limpar”;
- a seção de notificações ter altura zero.

---

# 20. Solução recomendada para o estado atual

## 20.1. Remover a barra de progresso

Isso reduz imediatamente a altura do player e elimina uma feature instável.

---

## 20.2. Reduzir o player expandido

Estrutura sugerida:

```text
Na Hora Que Você Chamar
Jorge & Mateus

[anterior] [play/pause] [próxima]
```

Sem:

- barra de progresso;
- área vazia;
- capa grande obrigatória;
- informações temporais não confiáveis.

---

## 20.3. Tornar notificações uma área flexível

```css
.panel {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 24px);
}

.notifications {
  flex: 1;
  min-height: 120px;
  overflow: hidden;
}

.notifications-list {
  height: 100%;
  overflow-y: auto;
}
```

Um `min-height` mínimo evita que a seção desapareça completamente.

---

# 21. Testes obrigatórios de responsividade vertical

Testar o painel nas seguintes alturas:

- 900 px
- 768 px
- 700 px
- 640 px
- 600 px
- 540 px

Também testar:

- mídia tocando;
- mídia pausada;
- sem mídia;
- uma notificação;
- dez notificações;
- fonte em 125%;
- fonte em 150%;
- zoom do navegador em 125%;
- painel próximo à borda inferior da tela.

---

# 22. Critérios de aceite

A correção só deve ser considerada concluída quando:

- [ ] o painel nunca ultrapassa a viewport;
- [ ] o player nunca recorta notificações;
- [ ] a lista sempre permanece acessível;
- [ ] a lista possui rolagem própria;
- [ ] o cabeçalho de notificações permanece visível;
- [ ] o player reduz de tamanho em telas baixas;
- [ ] o painel funciona com zoom de 125%;
- [ ] não existe barra de progresso bugada;
- [ ] nenhuma notificação fica parcialmente escondida;
- [ ] o scroll não vaza para fora do painel.

---

# 23. Atualização das prioridades

## Prioridade crítica adicional

- Tornar o painel responsivo verticalmente.
- Garantir que o player não bloqueie notificações.
- Aplicar `min-height: 0` nos containers flexíveis.
- Aplicar `overflow-y: auto` somente na lista de notificações.
- Limitar a altura total com base na viewport.

## Prioridade alta adicional

- Criar variante compacta do player para telas baixas.
- Definir altura mínima visível para notificações.
- Testar diferentes escalas de fonte e zoom.
- Reduzir paddings e gaps de forma responsiva.

---

# 24. Conclusão adicional

O novo problema confirma que a interface ainda está sendo tratada principalmente como um layout de dimensões fixas.

Porém, uma ilha dinâmica precisa responder simultaneamente a:

- largura disponível;
- altura disponível;
- quantidade de notificações;
- presença ou ausência de mídia;
- escala de fonte;
- zoom;
- tamanho do conteúdo.

A solução não é apenas “diminuir o player”. É necessário criar uma arquitetura vertical flexível em que:

- o painel respeita a viewport;
- o player possui variantes de densidade;
- a seção de notificações ocupa o espaço restante;
- a lista rola internamente;
- nenhum conteúdo essencial é recortado.

A regra final deve ser:

> A mídia pode ter destaque, mas nunca pode impedir o acesso às notificações.
