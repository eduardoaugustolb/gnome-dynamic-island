#!/usr/bin/env -S gjs -m
/* Suíte que precisa ser executada dentro de um processo GNOME Shell.
 * O GJS standalone usado no CI não instala o typelib Clutter nem os
 * recursos resource:///org/gnome/shell, portanto não pode carregar
 * Animator/Panel/Pill/Banner diretamente. */
import {tests as animatorTests} from './animator.test.js';
import System from 'system';

let passed = 0;
let failed = 0;
for (const [name, test] of Object.entries(animatorTests)) {
    try {
        test();
        passed++;
        print(`ok - ${name}`);
    } catch (e) {
        failed++;
        print(`FAIL - ${name}: ${e.message ?? e}`);
    }
}
print(`${passed} passaram, ${failed} falharam`);
if (failed)
    System.exit(1);
