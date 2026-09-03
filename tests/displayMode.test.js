import {assertEqual, assertTrue} from './lib/assert.js';
import {DISPLAY_MODES, isNotchMode, normalizeDisplayMode} from '../core/displayMode.js';

export const tests = {
    'modo visual expõe somente pill e notch'() {
        assertEqual(DISPLAY_MODES.length, 2);
        assertTrue(DISPLAY_MODES.includes('pill'));
        assertTrue(DISPLAY_MODES.includes('notch'));
    },

    'modo visual inválido retorna pill'() {
        for (const value of [null, '', 'invalid', undefined])
            assertEqual(normalizeDisplayMode(value), 'pill');
    },

    'modo notch é identificado com fallback seguro'() {
        assertTrue(isNotchMode('notch'));
        assertTrue(!isNotchMode('pill'));
        assertTrue(!isNotchMode('unexpected'));
    },
};
