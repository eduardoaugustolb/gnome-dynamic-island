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
    expandedWidth,
    positionIsland,
    strutHeight,
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

    'expandedWidth nunca ultrapassa o monitor atual'() {
        assertEqual(expandedWidth(900, 1920), 900);
        assertEqual(expandedWidth(900, 640), 608);
        assertEqual(expandedWidth(420, 320), 288);
        assertEqual(expandedWidth(420, null), 420);
        assertEqual(expandedWidth(420, 320, 8), 304);
    },

    'expandedWidth cobre escalas fracionárias em logical pixels'() {
        for (const scale of [1, 1.25, 1.5, 2]) {
            const physicalWidth = 1920;
            const logicalWidth = physicalWidth / scale;
            assertTrue(expandedWidth(900, logicalWidth, 16) <= logicalWidth - 32);
        }
    },

    'positionIsland centraliza e ancora a ilha sem overflow'() {
        const monitor = {x: 0, y: 0, width: 1920, height: 1080};
        assertEqual(positionIsland({
            monitor, islandWidth: 420, islandHeight: 300,
            position: 'center', topGap: 8,
        }), {x: 750, y: 8});
        assertEqual(positionIsland({
            monitor, islandWidth: 420, islandHeight: 300,
            position: 'left', topGap: 8,
        }), {x: 8, y: 8});
        assertEqual(positionIsland({
            monitor, islandWidth: 420, islandHeight: 300,
            position: 'right', topGap: 8,
        }), {x: 1492, y: 8});
        assertEqual(positionIsland({
            monitor: {x: -1280, y: 0, width: 1280, height: 720},
            islandWidth: 900, islandHeight: 300,
            position: 'center', topGap: 0,
        }), {x: -1090, y: 0});
    },

    'strutHeight reserva somente quando a barra está escondida'() {
        assertEqual(strutHeight(34, 8, true), 50);
        assertEqual(strutHeight(34, 0, true), 34);
        assertEqual(strutHeight(34, 8, false), 0);
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

    'troca de monitor recalcula largura, posição e strut'() {
        const config = {width: 1400, position: 'right', collapsedHeight: 34};
        const large = {x: 0, y: 0, width: 1920, height: 1080};
        const small = {x: -1280, y: 0, width: 1280, height: 720};
        const largeWidth = expandedWidth(config.width, large.width);
        const smallWidth = expandedWidth(config.width, small.width);

        assertEqual(largeWidth, 1400);
        assertEqual(smallWidth, 1248);
        assertEqual(positionIsland({
            monitor: small, islandWidth: smallWidth, islandHeight: 300,
            position: config.position, topGap: 0,
        }), {x: -1248, y: 0});
        assertEqual(strutHeight(config.collapsedHeight, 0, true), 34);
    },

    'mudanças de configuração mantêm limites geométricos'() {
        const monitor = {x: 0, y: 0, width: 640, height: 480};
        for (const mode of ['pill', 'notch']) {
            for (const position of ['left', 'center', 'right']) {
                const width = expandedWidth(900, monitor.width);
                const gap = mode === 'notch' ? 0 : 8;
                const point = positionIsland({
                    monitor, islandWidth: width, islandHeight: 300,
                    position, topGap: gap,
                });
                assertTrue(point.x >= monitor.x);
                assertTrue(point.x + width <= monitor.x + monitor.width);
                assertTrue(point.y === monitor.y + gap);
            }
        }
        assertTrue(maxPanelHeight(monitor.height) >= 240);
        assertTrue(panelTargetHeight(1000, maxPanelHeight(monitor.height)) <=
            maxPanelHeight(monitor.height));
    },
};
