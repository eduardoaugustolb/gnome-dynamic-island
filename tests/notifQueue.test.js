import {NotifQueue} from '../modules/notifQueue.js';
import {assertEqual, assertUndefined, assertTrue} from './lib/assert.js';

export const tests = {
    'fila vazia não entrega nada'() {
        const q = new NotifQueue();
        assertEqual(q.size, 0);
        assertUndefined(q.next());
    },

    'entrega na ordem de chegada (FIFO)'() {
        const q = new NotifQueue();
        q.push('a');
        q.push('b');
        q.push('c');
        assertEqual(q.size, 3);
        assertEqual(q.next(), 'a');
        assertEqual(q.next(), 'b');
        assertEqual(q.next(), 'c');
        assertUndefined(q.next());
    },

    // O requisito central pedido: se várias notificações chegam juntas
    // (antes de qualquer uma ser consumida), nenhuma pode sumir — todas
    // devem sair depois, uma de cada vez, na ordem certa.
    'várias notificações simultâneas: nenhuma é omitida'() {
        const q = new NotifQueue();
        const incoming = ['n1', 'n2', 'n3', 'n4', 'n5'];
        for (const n of incoming)
            q.push(n);
        assertEqual(q.size, incoming.length);

        const seen = [];
        let item;
        while ((item = q.next()) !== undefined)
            seen.push(item);

        assertEqual(seen, incoming);
        assertEqual(q.size, 0);
    },

    'push/next intercalados preservam ordem'() {
        const q = new NotifQueue();
        q.push('a');
        assertEqual(q.next(), 'a');
        q.push('b');
        q.push('c');
        assertEqual(q.next(), 'b');
        assertEqual(q.next(), 'c');
        assertUndefined(q.next());
    },

    'discard remove só o que casa com o predicado, mantendo a ordem do resto'() {
        const q = new NotifQueue();
        q.push({id: 1});
        q.push({id: 2});
        q.push({id: 3});
        q.discard(item => item.id === 2);
        assertEqual(q.size, 2);
        assertEqual(q.next(), {id: 1});
        assertEqual(q.next(), {id: 3});
    },

    'discard sem nenhum item casando não altera a fila'() {
        const q = new NotifQueue();
        q.push('a');
        q.push('b');
        q.discard(item => item === 'z');
        assertEqual(q.size, 2);
    },

    'clear esvazia e permite continuar usando a fila normalmente'() {
        const q = new NotifQueue();
        q.push('a');
        q.push('b');
        q.clear();
        assertEqual(q.size, 0);
        assertUndefined(q.next());

        q.push('c');
        assertEqual(q.next(), 'c');
    },

    'aceita duplicatas por valor sem descartar nenhuma'() {
        const q = new NotifQueue();
        q.push('dup');
        q.push('dup');
        assertEqual(q.size, 2);
        assertTrue(q.next() === 'dup' && q.next() === 'dup');
    },
};
