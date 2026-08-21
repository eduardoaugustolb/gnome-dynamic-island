import {UiState, DEFAULT_TRANSITIONS} from '../core/uiState.js';
import {assertEqual, assertFalse, assertTrue, assertThrows} from './lib/assert.js';

export const tests = {
    'começa em collapsed'() {
        const s = new UiState();
        assertEqual(s.value, 'collapsed');
        assertTrue(s.isCollapsed);
        assertFalse(s.expanded);
    },

    'estado inicial customizado é respeitado'() {
        const s = new UiState('banner');
        assertEqual(s.value, 'banner');
        assertTrue(s.isBanner);
    },

    'estado inicial inválido lança'() {
        assertThrows(() => new UiState('nope'));
    },

    'collapsed abre banner e painel'() {
        const s = new UiState();
        assertTrue(s.set('banner'));
        assertEqual(s.value, 'banner');
        assertTrue(s.set('panel'));
        assertEqual(s.value, 'panel');
    },

    'banner volta para collapsed e abre painel'() {
        const s = new UiState('banner');
        assertTrue(s.set('collapsed'));
        assertEqual(s.value, 'collapsed');
        const p = new UiState('banner');
        assertTrue(p.set('panel'));
        assertEqual(p.value, 'panel');
    },

    'panel só recolhe (nunca vai para banner)'() {
        const s = new UiState('panel');
        assertFalse(s.set('banner'));
        assertEqual(s.value, 'panel');
        assertTrue(s.set('collapsed'));
        assertEqual(s.value, 'collapsed');
    },

    'transição inválida não muda o estado'() {
        const s = new UiState('collapsed');
        assertFalse(s.set('unknown'));
        assertEqual(s.value, 'collapsed');
    },

    're-entrada no mesmo estado é permitida e não dispara listeners'() {
        const s = new UiState('collapsed');
        let calls = 0;
        s.onTransition(() => (calls += 1));
        assertTrue(s.set('collapsed'));
        assertEqual(calls, 0);
        assertEqual(s.value, 'collapsed');
    },

    'expanded reflete qualquer estado diferente de collapsed'() {
        const s = new UiState();
        assertFalse(s.expanded);
        s.set('banner');
        assertTrue(s.expanded);
        s.set('panel');
        assertTrue(s.expanded);
        s.collapse();
        assertFalse(s.expanded);
    },

    'can() consulta sem transicionar'() {
        const s = new UiState('panel');
        assertTrue(s.can('collapsed'));
        assertFalse(s.can('banner'));
        assertEqual(s.value, 'panel');
    },

    'listeners recebem (novo, anterior) e unsubscribe funciona'() {
        const s = new UiState('collapsed');
        const seen = [];
        const off = s.onTransition((next, prev) => seen.push([next, prev]));
        s.set('banner');
        s.set('panel');
        assertEqual(seen, [['banner', 'collapsed'], ['panel', 'banner']]);
        off();
        s.collapse();
        assertEqual(seen.length, 2);
        assertEqual(s.value, 'collapsed');
    },

    'collapse() é sempre permitido a partir de qualquer estado'() {
        for (const start of ['collapsed', 'banner', 'panel']) {
            const s = new UiState(start);
            assertTrue(s.collapse());
            assertEqual(s.value, 'collapsed');
        }
    },

    'transições customizadas substituem as padrão'() {
        const custom = {
            collapsed: ['panel'],
            panel: ['collapsed'],
        };
        const s = new UiState('collapsed', {transitions: custom});
        assertTrue(s.set('panel'));
        assertFalse(s.set('banner')); // não está nas customizadas
        assertEqual(s.value, 'panel');
        assertTrue(s.set('collapsed')); // panel→collapsed está
        assertEqual(s.value, 'collapsed');
    },

    'objeto padrão de transições cobre todos os estados'() {
        for (const state of ['collapsed', 'banner', 'panel'])
            assertTrue(Array.isArray(DEFAULT_TRANSITIONS[state]));
    },
};
