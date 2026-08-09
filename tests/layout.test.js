import {
    clamp,
    pillWidthCap,
    clampPillWidth,
    maxPanelHeight,
    panelInnerWidth,
    carouselTrackWidth,
    pageShift,
    panelChromeHeight,
    maxPageHeight,
    clampPageHeight,
    panelTargetHeight,
    controlCellWidth,
} from '../core/layout.js';
import {assertEqual, assertTrue} from './lib/assert.js';

export const tests = {
    'clamp limita por baixo e por cima'() {
        assertEqual(clamp(5, 0, 10), 5);
        assertEqual(clamp(-5, 0, 10), 0);
        assertEqual(clamp(15, 0, 10), 10);
        assertEqual(clamp(10, 0, 10), 10);
    },

    'pillWidthCap usa ~45% do monitor, nunca abaixo do mínimo'() {
        assertEqual(pillWidthCap(1920, 210), 864); // round(1920*0.45)
        assertEqual(pillWidthCap(800, 210), 360);  // round(800*0.45)
        assertEqual(pillWidthCap(400, 210), 210);  // 45% < minWidth
        assertEqual(pillWidthCap(null, 210), 560); // fallback sem monitor
        assertEqual(pillWidthCap(0, 210), 560);
    },

    'clampPillWidth nunca sai de [mínimo, teto]'() {
        assertEqual(clampPillWidth(100, 210, 1920), 210); // estica ao mínimo
        assertEqual(clampPillWidth(500, 210, 1920), 500); // dentro do teto
        assertEqual(clampPillWidth(1200, 210, 800), 360); // corta no teto
        assertEqual(clampPillWidth(2000, 210, null), 560); // fallback
    },

    'maxPanelHeight respeita a viewport e os tetos fixos'() {
        assertEqual(maxPanelHeight(1080), 560); // teto máximo
        assertEqual(maxPanelHeight(300), 252);  // 300 - 48
        assertEqual(maxPanelHeight(250), 240);  // piso mínimo
        assertEqual(maxPanelHeight(2000), 560); // nunca passa de 560
        assertEqual(maxPanelHeight(null), 560); // fallback 700 clampado
    },

    'panelInnerWidth desconta o padding e nunca fica negativa'() {
        assertEqual(panelInnerWidth(420), 388);
        assertEqual(panelInnerWidth(32), 0);
        assertEqual(panelInnerWidth(10), 0);
    },

    'carouselTrackWidth = página x quantidade'() {
        assertEqual(carouselTrackWidth(388, 3), 1164);
        assertEqual(carouselTrackWidth(0, 3), 0);
    },

    'pageShift desloca o track para o índice da página'() {
        assertEqual(pageShift(388, 0), 0);
        assertEqual(pageShift(388, 1), -388);
        assertEqual(pageShift(388, 2), -776);
    },

    'panelChromeHeight soma header + indicadores + 64px'() {
        assertEqual(panelChromeHeight(40, 20), 124);
        assertEqual(panelChromeHeight(0, 0), 64);
    },

    'maxPageHeight é o que sobra após o chrome, com piso'() {
        assertEqual(maxPageHeight(560, 124), 436);
        assertEqual(maxPageHeight(100, 200), 96); // piso
    },

    'clampPageHeight limita a altura da página ao teto'() {
        assertEqual(clampPageHeight(260, 436), 260);
        assertEqual(clampPageHeight(500, 436), 436);
        assertEqual(clampPageHeight(50, 436), 96); // piso
    },

    'panelTargetHeight dá respiro de 8px e respeita o teto'() {
        assertEqual(panelTargetHeight(320, 560), 328);
        assertEqual(panelTargetHeight(600, 560), 560);
        assertEqual(panelTargetHeight(100, 560), 200); // piso
    },

    'controlCellWidth divide em três colunas sem nunca zerar'() {
        assertEqual(controlCellWidth(388), 124); // (388 - 16) / 3
        assertEqual(controlCellWidth(32, {columns: 2, gap: 4}), 14);
        assertEqual(controlCellWidth(10), 1); // nunca menor que 1px
    },

    // Fluxo completo do _fitPages: geometria calculada como o island.js
    // faz hoje (monitor 1080, largura expandida 420, página de 260px).
    'geometria integrada do painel (mesmos valores do _fitPages)'() {
        const inner = panelInnerWidth(420);
        assertEqual(inner, 388);
        assertTrue(carouselTrackWidth(inner, 3) === 1164);
        assertTrue(pageShift(inner, 0) === 0);

        const maxH = maxPanelHeight(1080);
        const chrome = panelChromeHeight(40, 20);
        const pageH = clampPageHeight(260, maxPageHeight(maxH, chrome));
        assertTrue(maxH === 560 && chrome === 124);
        assertEqual(pageH, 260);
        assertEqual(panelTargetHeight(260, maxH), 268);
    },
};
