#!/usr/bin/env -S gjs -m
/**
 * Runner de testes da extensão. Sem framework externo (nenhum
 * disponível/instalado neste ambiente) — roda direto com o GJS que já
 * vem com o GNOME.
 *
 *   gjs -m tests/run.js
 *
 * Só cobre os módulos que não dependem de resource:///org/gnome/shell
 * nem de Clutter/St (media.js, notifications.js, notifQueue.js) — esses
 * só existem dentro de um gnome-shell rodando de verdade, então
 * island.js/extension.js/controls.js não dá pra carregar aqui (ver
 * README de testes mais abaixo neste arquivo).
 */
import System from 'system';

import {tests as notifQueueTests} from './notifQueue.test.js';
import {tests as mediaTests} from './media.test.js';
import {tests as notificationsTests} from './notifications.test.js';
import {tests as integrationTests} from './integration.test.js';
import {tests as layoutTests} from './layout.test.js';
import {tests as uiStateTests} from './uiState.test.js';

const suites = [
    ['notifQueue.js (fila de amostragem)', notifQueueTests],
    ['media.js (MediaWatcher/MPRIS)', mediaTests],
    ['notifications.js (NotificationManager)', notificationsTests],
    ['integração: NotificationManager + NotifQueue', integrationTests],
    ['core/layout.js (geometria da ilha)', layoutTests],
    ['core/uiState.js (máquina de estados)', uiStateTests],
];

let passed = 0;
let failed = 0;
const failures = [];

for (const [suiteName, tests] of suites) {
    print(`\n${suiteName}`);
    for (const [name, fn] of Object.entries(tests)) {
        try {
            fn();
            passed += 1;
            print(`  ok - ${name}`);
        } catch (e) {
            failed += 1;
            failures.push({suite: suiteName, name, error: e});
            print(`  FAIL - ${name}`);
            print(`         ${e.message ?? e}`);
        }
    }
}

print(`\n${passed} passaram, ${failed} falharam (${passed + failed} no total)`);

if (failed > 0) {
    print('\nFalhas:');
    for (const {suite, name, error} of failures)
        print(`  [${suite}] ${name}: ${error.message ?? error}`);
    System.exit(1);
}
