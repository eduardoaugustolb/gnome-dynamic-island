/**
 * Mini biblioteca de asserção pra suíte de testes da extensão. Sem
 * dependências externas de propósito: os módulos testados aqui só
 * precisam do runtime GJS (gi://GObject, gi://Gio, gi://GLib) — não do
 * gnome-shell rodando — então o harness de teste também fica livre de
 * qualquer framework externo (não há nenhum instalado/disponível nesse
 * ambiente).
 */

export class AssertionError extends Error {}

function stringify(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

export function assertEqual(actual, expected, msg = '') {
    const a = stringify(actual);
    const e = stringify(expected);
    if (a !== e) {
        throw new AssertionError(
            `${msg ? `${msg}: ` : ''}esperado ${e}, obtido ${a}`);
    }
}

export function assertTrue(value, msg = 'esperava um valor truthy') {
    if (!value)
        throw new AssertionError(msg);
}

export function assertFalse(value, msg = 'esperava um valor falsy') {
    if (value)
        throw new AssertionError(msg);
}

export function assertUndefined(value, msg = 'esperava undefined') {
    if (value !== undefined)
        throw new AssertionError(`${msg}: obtido ${stringify(value)}`);
}

export function assertThrows(fn, msg = 'esperava que a função lançasse') {
    try {
        fn();
    } catch (_) {
        return;
    }
    throw new AssertionError(msg);
}
