/* ================================================================
 * layout.js — geometria pura da ilha (responsividade).
 *
 * Todas as fórmulas de medida/encaixe que antes viviam dentro do
 * island.js (_measurePillWidth, _maxHeight, _fitPages, _fitControlGrid,
 * _positionTrack) viram funções puras: sem importar o Shell nem Clutter,
 * testáveis em GJS puro (tests/layout.test.js). A parte que DEPENDE de
 * ator real (get_preferred_width/height, Main.layoutManager) continua no
 * island.js; aqui fica só a matemática, o que torna a responsividade
 * testável e a cada fórmula um lugar único de verdade.
 * ================================================================ */

export const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

/* Teto da largura da pill: ~45% do monitor, nunca abaixo da largura
 * mínima; sem monitor, um teto fixo. */
export const pillWidthCap = (monitorWidth, minWidth = 210,
    fallback = 560) => {
    if (!monitorWidth)
        return fallback;
    return Math.max(minWidth, Math.round(monitorWidth * 0.45));
};

export const clampPillWidth = (natural, minWidth, monitorWidth) =>
    clamp(natural, minWidth, pillWidthCap(monitorWidth, minWidth));

/* Teto de altura do painel expandido: a viewport menos o gap do topo e
 * uma margem inferior (48px no total), nunca acima de 560 nem abaixo de
 * 240. */
export const maxPanelHeight = (monitorHeight, {
    verticalReserve = 48,
    min = 240,
    max = 560,
    fallback = 700,
} = {}) => {
    const avail = monitorHeight ? monitorHeight - verticalReserve : fallback;
    return clamp(avail, min, max);
};

/* Largura interna do painel: a largura-alvo menos o padding vertical
 * das bordas (32px). */
export const panelInnerWidth = (expandedWidth, padding = 32) =>
    Math.max(0, expandedWidth - padding);

/* Track do carrossel: cada página tem a largura do viewport, então o
 * track tem PAGE_COUNT vezes isso. */
export const carouselTrackWidth = (pageWidth, count) => pageWidth * count;

/* Deslocamento do track para mostrar a página `index`. */
export const pageShift = (pageWidth, index) => -(pageWidth * index);

/* Chrome fixo do painel fora das páginas: header + indicadores + os
 * 32px de padding e os dois espaços de 16px do CSS (64px). */
export const panelChromeHeight = (headerH, indicatorsH,
    {verticalPadding = 64} = {}) => headerH + indicatorsH + verticalPadding;

/* Teto da altura de uma página: o que sobra do teto do painel após o
 * chrome, nunca abaixo do mínimo. */
export const maxPageHeight = (maxPanelH, chromeH, min = 96) =>
    Math.max(min, maxPanelH - chromeH);

export const clampPageHeight = (pageH, maxH, min = 96) =>
    clamp(pageH, min, maxH);

/* Altura-alvo do painel inteiro a partir da altura natural: um pequeno
 * respiro (+8) e nunca abaixo de 200 nem acima do teto. */
export const panelTargetHeight = (naturalH, maxH,
    {extra = 8, min = 200} = {}) => clamp(naturalH + extra, min, maxH);

/* Célula da grade de controles: três colunas fixas, com gaps, nunca
 * menor que 1px (evita larguras negativas em painéis muito estreitos). */
export const controlCellWidth = (innerWidth,
    {columns = 3, gap = 8} = {}) =>
    Math.max(1, Math.floor((innerWidth - gap * (columns - 1)) / columns));
