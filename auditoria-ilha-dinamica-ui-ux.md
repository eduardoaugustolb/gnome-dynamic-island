# Auditoria Completa de UI/UX — Ilha Dinâmica, Painel Expandido, Notificações e Player de Música

## 1. Objetivo deste documento

Este documento reúne uma análise completa dos problemas visuais e funcionais encontrados na interface da ilha dinâmica, considerando os seguintes estados:

- Ilha fechada em estado padrão
- Ilha aberta com controles rápidos
- Recebimento de notificação
- Música tocando com a ilha fechada
- Música pausada com a ilha aberta
- Lista de notificações
- Sliders de volume e brilho
- Botões de ação e toggles
- Casos de textos quebrando linha sem necessidade
- Casos de espaços vazios excessivos
- Problemas de distribuição interna dos componentes
- Estratégias para evitar reincidência desses erros no futuro

O foco principal não é apenas corrigir a interface atual, mas estabelecer um sistema previsível de layout, tipografia, espaçamento, dimensionamento e comportamento responsivo.

---

# 2. Diagnóstico geral

A interface possui uma boa direção visual: fundo escuro, superfícies arredondadas, controles rápidos, notificações e player de mídia integrados. Porém, os componentes ainda parecem ter sido montados de maneira independente, sem um sistema global suficientemente rígido.

Isso causa:

- Quebras de texto mesmo com espaço horizontal disponível
- Textos truncados precocemente
- Botões ocupando menos ou mais largura do que deveriam
- Colunas internas mal dimensionadas
- Espaços vazios excessivos
- Elementos desalinhados
- Controles com larguras inconsistentes
- Falta de regras claras para conteúdo variável
- Duplicidade de ações
- Diferenças entre o estado compacto e o estado expandido
- Componentes que não crescem nem encolhem corretamente
- Falta de uma estratégia de prioridade entre texto, ícones e botões

O problema central não está apenas no CSS isolado, mas na arquitetura de layout.

---

# 3. Problema principal: textos quebrando linha sem necessidade

## 3.1. O que está acontecendo

Em vários componentes, há espaço horizontal disponível, mas o texto quebra linha ou é truncado.

Exemplos comuns:

- Título da música quebrando ou ficando comprimido
- Nome do aplicativo ocupando apenas uma faixa estreita
- Corpo da notificação usando reticências cedo demais
- Rótulos como “Não perturbe” ficando apertados
- Títulos de seção aparecendo como “Quick Contr...”
- Botão “Limpar” aparecendo como “Limp...”
- Mensagens de notificação quebrando enquanto existe espaço livre ao lado
- Título e artista sendo limitados por uma coluna artificialmente pequena
- Texto não ocupando o espaço liberado por um botão menor

Isso normalmente é causado por uma combinação de:

```css
width: fixa;
max-width: muito pequena;
flex-basis inadequado;
flex-shrink configurado errado;
white-space: nowrap em elementos incorretos;
overflow: hidden em containers intermediários;
grid-template-columns mal dimensionado;
posição absoluta;
largura reservada excessiva para ícones ou botões;
```

---

## 3.2. Por que isso acontece mesmo havendo espaço

O espaço visual disponível na tela não significa que o texto realmente pode usá-lo.

Por exemplo:

```css
.notification {
  display: flex;
}

.notification-content {
  width: 170px;
}

.close-button {
  width: 48px;
}
```

Mesmo que o card tenha 320 px de largura, o conteúdo continuará preso em 170 px.

Outro exemplo:

```css
.notification-content {
  flex: 1;
  min-width: auto;
}
```

Em layouts flex, `min-width: auto` pode impedir que o item encolha corretamente ou causar overflow estranho. Em muitos casos, a correção é:

```css
.notification-content {
  flex: 1;
  min-width: 0;
}
```

Esse detalhe é extremamente importante.

---

## 3.3. Regra obrigatória para textos dentro de flex

Sempre que um bloco de texto estiver dentro de um container flexível:

```css
.text-content {
  flex: 1;
  min-width: 0;
}
```

Sem `min-width: 0`, o navegador pode manter a largura mínima baseada no conteúdo e gerar:

- Overflow
- Truncamento incorreto
- Quebra inesperada
- Compressão de outros elementos
- Botões empurrados para fora
- Espaços vazios que parecem inexplicáveis

---

## 3.4. Como tratar textos de uma linha

Para títulos que devem permanecer em uma linha:

```css
.single-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
```

Uso recomendado:

- Nome da música na ilha fechada
- Nome do aplicativo
- Títulos curtos de notificação
- Nome do dispositivo
- Texto em botões compactos

Não usar `white-space: nowrap` em parágrafos que deveriam aceitar duas linhas.

---

## 3.5. Como tratar textos de duas linhas

Para notificações, descrições e textos secundários:

```css
.two-lines {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
```

O erro comum é truncar apenas a primeira linha manualmente.

Errado:

```html
<p>This is the text body of the n...</p>
<p>Pretty cool, huh?</p>
```

Correto:

```html
<p class="notification-body">
  This is the text body of the notification. Pretty cool, huh?
</p>
```

```css
.notification-body {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
```

Assim, o navegador utiliza as duas linhas antes de inserir reticências.

---

# 4. Arquitetura correta para componentes flexíveis

## 4.1. Estrutura base recomendada

A maior parte dos componentes deve seguir:

```text
[ícone/capa/avatar] [conteúdo flexível] [ações]
```

Exemplo:

```html
<div class="media-card">
  <img class="media-cover" />

  <div class="media-content">
    <strong class="media-title">Na Hora Que Você Chamar</strong>
    <span class="media-artist">Jorge & Mateus</span>
  </div>

  <div class="media-actions">
    ...
  </div>
</div>
```

```css
.media-card {
  display: flex;
  align-items: center;
  gap: 12px;
}

.media-cover {
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
}

.media-content {
  flex: 1 1 auto;
  min-width: 0;
}

.media-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
}
```

Essa estrutura evita:

- Texto espremido sem motivo
- Botões consumindo espaço indefinido
- Capas aumentando ou diminuindo
- Ações deslocadas
- Quebras imprevisíveis

---

## 4.2. Evitar larguras fixas desnecessárias

Evite:

```css
.media-content {
  width: 160px;
}
```

Prefira:

```css
.media-content {
  flex: 1;
  min-width: 0;
}
```

Use largura fixa somente quando o elemento realmente exige uma medida constante, como:

- Avatar
- Ícone
- Botão circular
- Coluna de horário
- Thumb de slider
- Capa de álbum

---

# 5. Sistema de espaçamento

## 5.1. Problema atual

A interface apresenta distâncias inconsistentes entre:

- Hora e data
- Títulos de seção e conteúdo
- Ícones e sliders
- Slider e percentual
- Botões rápidos
- Cards de notificação
- Player e controles
- Conteúdo e bordas externas
- Botão de fechar e texto
- Capa da música e título
- Linhas de texto dentro de cards

A ausência de uma escala fixa gera sensação de interface improvisada.

---

## 5.2. Escala recomendada

Adotar uma escala única:

```text
4 px   — microespaço
8 px   — ícone + texto
12 px  — componentes relacionados
16 px  — padding interno padrão
20 px  — padding lateral do painel
24 px  — separação entre seções
32 px  — separação estrutural forte
```

Tokens:

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

---

## 5.3. Regra prática

- Dentro de uma linha: `8–12 px`
- Dentro de um card: `12–16 px`
- Entre blocos do mesmo contexto: `16 px`
- Entre seções: `24 px`
- Padding lateral do painel: `20 px`

---

# 6. Ilha fechada padrão

## 6.1. Problemas encontrados

- Conteúdo não centralizado perfeitamente
- Horário com mais espaço à esquerda do que a data à direita
- Ícone da bateria pequeno
- Distância excessiva entre hora e grupo de status
- Conteúdo direito comprimido
- Borda visualmente irregular
- Altura maior do que o conteúdo exige

---

## 6.2. Estrutura recomendada

```html
<div class="island-compact">
  <time class="island-time">14:40</time>

  <div class="island-status">
    <BatteryIcon />
    <span>51%</span>
    <span>6 ago</span>
  </div>
</div>
```

```css
.island-compact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-inline: 18px;
  min-height: 36px;
}

.island-status {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

---

## 6.3. Como evitar desequilíbrio

Não usar margens manuais diferentes:

```css
.time {
  margin-left: 30px;
}

.status {
  margin-right: 10px;
}
```

Usar padding simétrico no pai e distribuição com `space-between`.

---

# 7. Painel aberto

## 7.1. Problemas principais

- Títulos truncados sem necessidade
- Mistura de idiomas
- Espaçamento irregular
- Botões com larguras diferentes
- Sliders desalinhados
- Notificações densas
- Ações inferiores sem rótulo
- Player ocupando espaço sem agregar controle suficiente
- Hierarquia fraca entre seções

---

## 7.2. Estrutura geral recomendada

```html
<aside class="panel">
  <header class="panel-header">...</header>

  <section class="media-section">...</section>

  <section class="quick-controls">...</section>

  <section class="session-actions">...</section>

  <section class="notifications">...</section>
</aside>
```

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
  overflow: hidden;
}
```

Cada seção deve controlar apenas seu próprio layout.

---

# 8. Títulos de seção

## 8.1. Problema

Títulos como:

- `Quick Contr...`
- `Notificatio...`
- `Limp...`

parecem bugs de layout.

---

## 8.2. Correção

Não aplicar largura fixa arbitrária em títulos.

```css
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  flex: 1;
  min-width: 0;
}
```

O botão deve ser independente:

```css
.section-action {
  flex: 0 0 auto;
}
```

Use texto completo:

- Controles rápidos
- Notificações
- Limpar

---

# 9. Sliders de volume e brilho

## 9.1. Problemas atuais

- Percentual não corresponde visualmente à posição do thumb
- Ícones muito próximos da margem
- Percentuais apertados contra a borda direita
- Trilhas não compartilham uma mesma coluna
- Thumb muito grande
- Espaçamento desigual entre ícone, trilha e valor

---

## 9.2. Layout correto

```html
<div class="slider-row">
  <span class="slider-icon">...</span>
  <input class="slider-control" type="range" />
  <output class="slider-value">77%</output>
</div>
```

```css
.slider-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 40px;
  align-items: center;
  gap: 10px;
}

.slider-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

A coluna do valor deve ter largura fixa para evitar variações entre `7%`, `77%` e `100%`.

---

## 9.3. Evitar erro visual no percentual

O valor mostrado deve ser derivado da mesma variável usada no slider:

```js
const percentage = Number(value);
```

A posição visual e o número exibido não podem ter estados independentes.

---

# 10. Grade de controles rápidos

## 10.1. Problema atual

Há cinco botões na mesma linha com larguras diferentes. Alguns textos cabem, outros quebram.

Isso gera:

- Cards assimétricos
- Rótulos comprimidos
- Botões que parecem mais importantes só porque são maiores
- “Não perturbe” com pouco espaço
- Falta de consistência entre ativos e inativos

---

## 10.2. Solução recomendada

Usar grid:

```css
.quick-controls-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
```

Os cinco controles podem ocupar:

```text
Linha 1: Wi-Fi | Bluetooth | Modo escuro
Linha 2: Luz noturna | Não perturbe | espaço reservado/futuro
```

Ou:

```css
.quick-control:last-child {
  grid-column: span 2;
}
```

Porém, o mais consistente é manter todos iguais.

---

## 10.3. Altura e largura

```css
.quick-control {
  min-width: 0;
  min-height: 58px;
  padding: 10px 8px;
}
```

Texto:

```css
.quick-control-label {
  max-width: 100%;
  text-align: center;
  white-space: normal;
  line-height: 1.15;
}
```

Para rótulos longos, permitir duas linhas controladas em vez de apertar a fonte.

---

# 11. Estados ativo, inativo e indisponível

## 11.1. Problema atual

Há diferentes tratamentos para botões ativos e inativos, mas sem consistência.

---

## 11.2. Sistema recomendado

```css
.control {
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.control[data-state="on"] {
  background: var(--accent);
  border-color: transparent;
}

.control[data-state="off"] {
  background: var(--surface-2);
}

.control[data-state="disabled"] {
  opacity: 0.45;
  pointer-events: none;
}
```

Não variar o raio, a espessura da borda e o tamanho de acordo com o estado.

---

# 12. Botões inferiores: bloquear, suspender e desligar

## 12.1. Problemas

- Ícones sem texto
- Possível duplicidade com modo noturno
- Ações destrutivas sem confirmação
- Diferença de forma em relação aos outros controles
- Significado ambíguo

---

## 12.2. Correção

Use tooltips e rótulos acessíveis:

```html
<button aria-label="Bloquear sessão">...</button>
<button aria-label="Suspender">...</button>
<button aria-label="Desligar">...</button>
```

Para desligar:

- confirmar ação
- ou exibir menu secundário

O botão da lua deve ser “Suspender”, não duplicar “Modo escuro” ou “Luz noturna”.

---

# 13. Notificação recebida

## 13.1. Problemas observados

- Texto quebrando cedo demais
- Espaço livre à direita não aproveitado
- Avatar desalinhado
- Botão fechar grande demais
- Hierarquia vertical comprimida
- Título e corpo separados de forma ruim
- Horário distante
- Raio muito alto
- Card parecendo cápsula e não notificação
- Conteúdo sem comportamento claro de clique

---

## 13.2. Estrutura ideal

```html
<article class="toast">
  <img class="toast-avatar" />

  <div class="toast-content">
    <div class="toast-meta">
      <span class="toast-app">Brave Origin</span>
      <time class="toast-time">14:42</time>
    </div>

    <strong class="toast-title">Notification #10</strong>

    <p class="toast-body">
      This is the text body of the notification. Pretty cool, huh?
    </p>
  </div>

  <button class="toast-close" aria-label="Fechar notificação">×</button>
</article>
```

```css
.toast {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 32px;
  gap: 12px;
  align-items: start;
  padding: 14px 14px 14px 16px;
}

.toast-content {
  min-width: 0;
}

.toast-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
```

---

## 13.3. Corrigir o white space visual

O botão fechar não deve reservar uma coluna maior do que sua área real.

Errado:

```css
.toast-close-wrapper {
  width: 64px;
}
```

Correto:

```css
.toast-close {
  width: 32px;
  height: 32px;
}
```

---

## 13.4. Raio

Para cards com múltiplas linhas:

```css
border-radius: 24px;
```

Evitar cápsula completa com `9999px`, pois ela consome área útil nas extremidades.

---

# 14. Lista de notificações

## 14.1. Problemas

- Cards muito próximos
- Ícones inconsistentes
- Texto secundário com baixo contraste
- Horários pouco legíveis
- Barra de rolagem muito evidente
- Lista competindo com controles
- Falta de estado de hover
- Falta de ações claras

---

## 14.2. Estrutura recomendada

```css
.notification-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 4px;
}
```

Card:

```css
.notification-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 12px;
}
```

---

## 14.3. Texto

```css
.notification-app {
  font-size: 11px;
  color: var(--text-secondary);
}

.notification-title {
  font-size: 13px;
  color: var(--text-primary);
}

.notification-time {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
```

---

# 15. Player de música fechado

## 15.1. Problemas

- Estado “fechado” ainda muito grande
- Três controles ocupando espaço demais
- Título comprimido
- Artista disputando atenção
- Botões maiores do que o necessário
- Falta de feedback de reprodução
- Espaço dedicado aos controles maior do que o dedicado ao conteúdo
- Texto pode quebrar apesar de haver espaço global

---

## 15.2. Estrutura correta

```html
<div class="compact-player">
  <img class="compact-cover" />

  <div class="compact-info">
    <strong class="compact-title">Na Hora Que Você Chamar</strong>
    <span class="compact-artist">Jorge & Mateus</span>
  </div>

  <div class="compact-actions">
    <button>Anterior</button>
    <button>Pausar</button>
    <button>Próxima</button>
  </div>
</div>
```

```css
.compact-player {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.compact-info {
  min-width: 0;
}
```

---

## 15.3. Evitar wrap no título

```css
.compact-title,
.compact-artist {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Não colocar largura fixa no bloco de texto.

---

## 15.4. Reduzir prioridade das ações

No estado compacto:

- botão principal: `36 px`
- laterais: `32 px`

Ou exibir apenas play/pause.

---

# 16. Player aberto

## 16.1. Problemas

- Card alto demais para pouco conteúdo
- Grande área vazia
- Controles muito baixos
- Falta de barra de progresso
- Capa ausente ou pouco aproveitada
- Aberto não adiciona controle suficiente
- Conteúdo não preenche bem a largura
- Título e artista presos no canto superior esquerdo

---

## 16.2. Layout recomendado

### Opção horizontal

```html
<div class="expanded-player">
  <img class="expanded-cover" />

  <div class="expanded-main">
    <div class="expanded-copy">
      <strong>Na Hora Que Você Chamar</strong>
      <span>Jorge & Mateus</span>
    </div>

    <div class="progress">...</div>

    <div class="controls">...</div>
  </div>
</div>
```

```css
.expanded-player {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 16px;
}
```

### Opção vertical

- Título
- Artista
- Progresso
- Tempos
- Controles

A primeira opção aproveita melhor a largura.

---

## 16.3. Barra de progresso

```css
.track-progress-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 8px;
}
```

---

# 17. Diferença entre fechado e aberto

## 17.1. Problema atual

O fechado mostra muitos controles e o aberto adiciona pouco valor.

---

## 17.2. Regra de produto

### Estado fechado

Deve responder:

- O que está acontecendo?
- Qual é a ação principal?

### Estado aberto

Deve responder:

- Como controlar isso completamente?
- Qual é o progresso?
- Quais ações secundárias existem?
- Como abrir o aplicativo de origem?

---

# 18. Tipografia

## 18.1. Escala recomendada

```css
:root {
  --font-time: 30px;
  --font-title: 14px;
  --font-body: 12px;
  --font-label: 11px;
  --font-meta: 10px;
}
```

---

## 18.2. Pesos

- Hora: 700
- Título de música/notificação: 600
- Título de seção: 600
- Texto principal: 400
- Metadados: 400 ou 500

---

## 18.3. Line-height

```css
.title {
  line-height: 1.2;
}

.body {
  line-height: 1.35;
}

.meta {
  line-height: 1.2;
}
```

Sem line-height adequado, os textos parecem apertados mesmo quando há espaço vertical.

---

# 19. Contraste

## 19.1. Problema

Alguns textos secundários estão escuros demais.

---

## 19.2. Tokens recomendados

```css
:root {
  --text-primary: rgba(255, 255, 255, 0.96);
  --text-secondary: rgba(255, 255, 255, 0.68);
  --text-tertiary: rgba(255, 255, 255, 0.46);
  --border-subtle: rgba(255, 255, 255, 0.12);
}
```

Não usar opacidade muito baixa para horários e títulos de seção.

---

# 20. Raios e superfícies

## 20.1. Problema

Há mistura de:

- Cápsulas
- Cards retangulares
- Botões quadrados
- Botões circulares
- Raios diferentes sem função clara

---

## 20.2. Sistema recomendado

```css
:root {
  --radius-panel: 32px;
  --radius-card: 18px;
  --radius-control: 14px;
  --radius-small: 10px;
  --radius-round: 999px;
}
```

Usar `999px` apenas para:

- Botão circular
- Badge
- Slider thumb
- Ilha realmente compacta

Não usar em cards de texto multilinha.

---

# 21. Responsive design

## 21.1. Evitar quebra por largura variável

Use:

```css
width: min(420px, calc(100vw - 24px));
```

E internamente:

```css
minmax(0, 1fr)
```

---

## 21.2. Breakpoints

```css
@media (max-width: 380px) {
  .quick-controls-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .compact-actions .secondary {
    display: none;
  }
}
```

O layout deve reduzir complexidade, não apenas diminuir fontes.

---

# 22. Regras para evitar white space desnecessário

## 22.1. Nunca reservar espaço sem necessidade

Evitar:

```css
padding-right: 70px;
```

para compensar um botão.

Prefira grid ou flex com colunas reais.

---

## 22.2. Não usar posição absoluta para layout principal

Errado:

```css
.close {
  position: absolute;
  right: 20px;
}
```

Isso pode obrigar padding artificial no texto.

Melhor:

```css
grid-template-columns: minmax(0, 1fr) auto;
```

Posição absoluta deve ser usada somente quando o elemento realmente sobrepõe o conteúdo.

---

## 22.3. Usar `gap`, não margens aleatórias

Errado:

```css
.item-1 { margin-right: 9px; }
.item-2 { margin-left: 13px; }
```

Correto:

```css
.container {
  display: flex;
  gap: 12px;
}
```

---

# 23. Regras para evitar wrap incorreto

## 23.1. Verificar o elemento pai

Muitas vezes o problema não está no texto, mas no pai.

Checklist:

- O pai tem largura fixa?
- O pai está com `overflow: hidden`?
- O pai está em flex?
- O pai tem `min-width: auto`?
- O pai reserva espaço para botão?
- Existe `max-width` desnecessário?
- Existe grid com coluna fixa pequena?
- Existe padding excessivo?

---

## 23.2. Regras por tipo de texto

### Uma linha

```css
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
```

### Duas linhas

```css
display: -webkit-box;
-webkit-box-orient: vertical;
-webkit-line-clamp: 2;
overflow: hidden;
```

### Texto livre

```css
white-space: normal;
overflow-wrap: anywhere;
```

Não aplicar `overflow-wrap: anywhere` em títulos comuns, pois isso pode quebrar palavras de forma feia.

---

# 24. Componentes que crescem e encolhem

## 24.1. Princípio

Cada componente deve declarar claramente:

- Cresce?
- Encolhe?
- Mantém tamanho?
- Pode truncar?
- Pode quebrar linha?

Exemplo:

```css
.cover {
  flex: 0 0 48px;
}

.content {
  flex: 1 1 auto;
  min-width: 0;
}

.actions {
  flex: 0 0 auto;
}
```

---

# 25. Design tokens

Criar um arquivo central:

```css
:root {
  --panel-width: 420px;
  --panel-padding: 20px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  --radius-panel: 32px;
  --radius-card: 18px;
  --radius-control: 14px;

  --control-height: 58px;
  --icon-button-size: 40px;

  --text-primary: rgba(255,255,255,.96);
  --text-secondary: rgba(255,255,255,.68);
  --text-tertiary: rgba(255,255,255,.46);
}
```

Sem tokens, cada componente tende a receber valores diferentes.

---

# 26. QA visual

## 26.1. Testes obrigatórios

Testar a interface com:

- Título curto
- Título muito longo
- Nome de aplicativo longo
- Artista longo
- Texto de notificação de uma linha
- Texto de notificação de três linhas
- Horário com dois e três dígitos
- Percentual em 0%, 7%, 77% e 100%
- Cinco notificações
- Nenhuma notificação
- Capa ausente
- Ícone ausente
- Escala de fonte em 125% e 150%
- Largura pequena
- Idioma português
- Idioma inglês
- Textos com palavras grandes

---

## 26.2. Stress test de conteúdo

Use textos reais longos:

```text
Título:
Na Hora Que Você Chamar — Versão Ao Vivo em Goiânia

Aplicativo:
Brave Browser Developer Edition

Notificação:
Esta é uma notificação com um texto mais longo para testar corretamente o limite de duas linhas sem truncamento precoce.
```

Se o layout só funciona com textos curtos, ele não está pronto.

---

# 27. Acessibilidade

## 27.1. Áreas clicáveis

- Mínimo: `40 × 40 px`
- Recomendado: `44 × 44 px`

---

## 27.2. Labels

Todo ícone isolado deve ter:

```html
aria-label="Pausar música"
```

---

## 27.3. Foco

```css
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

---

# 28. Animações

## 28.1. Transição entre estados

A animação deve preservar a identidade do componente.

Recomendado:

1. Expandir largura
2. Expandir altura
3. Reposicionar conteúdo
4. Aplicar fade no conteúdo novo
5. Manter capa/título como elemento compartilhado

---

## 28.2. Evitar reflow brusco

Não alternar layouts completamente diferentes sem transição.

Use:

```css
transition:
  width 220ms ease,
  height 220ms ease,
  border-radius 220ms ease;
```

---

# 29. Organização do código

## 29.1. Componentes sugeridos

```text
DynamicIsland
├── CompactStatus
├── CompactMediaPlayer
├── ExpandedPanel
│   ├── Header
│   ├── ExpandedMediaPlayer
│   ├── SliderControl
│   ├── QuickControlsGrid
│   ├── SessionActions
│   └── NotificationList
└── NotificationToast
```

Cada componente deve ter responsabilidade única.

---

# 30. Checklist preventivo para futuros componentes

Antes de finalizar qualquer componente, responder:

## Layout

- O componente usa flex ou grid de forma previsível?
- O conteúdo textual tem `min-width: 0`?
- Existe alguma largura fixa desnecessária?
- O botão ocupa apenas o espaço necessário?
- Os ícones têm tamanho fixo?
- O texto ocupa o restante?
- O gap é definido no pai?

## Texto

- O texto deve ter uma ou duas linhas?
- Existe truncamento prematuro?
- O texto usa a largura disponível?
- Há palavras quebrando de forma estranha?
- O idioma aumenta o comprimento do rótulo?

## Espaçamento

- O padding é simétrico?
- Os gaps vêm da escala de tokens?
- Há margens manuais conflitantes?
- Existe espaço vazio reservado artificialmente?

## Estados

- Ativo, inativo e desabilitado são claros?
- O estado tocando é diferente do pausado?
- O estado compacto é realmente compacto?
- O estado expandido adiciona valor?

## Acessibilidade

- Botões possuem `aria-label`?
- O contraste é suficiente?
- A área de toque é adequada?
- Há foco visível?

## Responsividade

- O componente funciona em largura menor?
- Os controles secundários podem ser escondidos?
- O texto se adapta sem quebrar indevidamente?
- O grid muda de colunas quando necessário?

---

# 31. Prioridades de correção

## Prioridade alta

1. Corrigir `min-width: 0` nos conteúdos flexíveis
2. Remover larguras fixas desnecessárias
3. Corrigir truncamento de textos
4. Padronizar grid dos controles rápidos
5. Corrigir estrutura das notificações
6. Corrigir sliders
7. Tornar o estado compacto realmente compacto
8. Adicionar progresso no player expandido

## Prioridade média

1. Melhorar tipografia
2. Padronizar raios
3. Melhorar contraste
4. Padronizar estados ativos
5. Corrigir barra de rolagem
6. Adicionar hover e tooltips

## Prioridade baixa

1. Refinar animações
2. Adicionar equalizador animado
3. Adicionar microinterações
4. Adicionar ações avançadas no player

---

# 32. Exemplo completo de uma base CSS segura

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

.dynamic-island {
  width: min(420px, calc(100vw - 24px));
  color: var(--text-primary);
}

.flex-text {
  flex: 1 1 auto;
  min-width: 0;
}

.one-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.two-lines {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.icon-button {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
}

.media-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.notification-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
}

.slider-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 40px;
  align-items: center;
  gap: 10px;
}

.quick-controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
```

---

# 33. Conclusão

O principal erro da interface não é apenas “o texto quebrar linha”. A quebra é consequência de uma estrutura de layout que não define corretamente quem deve crescer, quem deve permanecer fixo e quem pode encolher.

A correção passa por cinco fundamentos:

1. Usar `min-width: 0` em todo conteúdo textual flexível
2. Evitar larguras fixas sem necessidade
3. Distribuir componentes com grid ou flex de forma explícita
4. Definir regras específicas para uma linha, duas linhas e texto livre
5. Criar tokens globais de espaçamento, tipografia, raio e tamanho

Quando essas regras são aplicadas, o white space deixa de ser acidental, os textos passam a utilizar a largura disponível e os botões ocupam somente o espaço necessário.

O resultado esperado é uma interface:

- Mais compacta
- Mais previsível
- Mais legível
- Mais responsiva
- Mais consistente
- Mais fácil de manter
- Menos suscetível a erros futuros
- Mais próxima de um componente nativo de sistema operacional
