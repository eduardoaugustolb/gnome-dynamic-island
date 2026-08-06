/**
 * Teste de integração entre NotificationManager e NotifQueue — os dois
 * módulos reais e sem alteração nenhuma pro teste, ligados através de
 * um "coordenador" mínimo que espelha DE PROPÓSITO a mesma regra de
 * decisão que island.js usa (_onNotificationAdded/_pumpNotifQueue):
 * só mostra uma notificação de cada vez, na ordem de chegada, e nunca
 * descarta nenhuma.
 *
 * island.js em si não dá pra carregar fora do processo do gnome-shell
 * (depende de Clutter/St e de resource:///org/gnome/shell/...), então
 * isto é o mais próximo de um teste ponta-a-ponta que dá pra rodar
 * neste ambiente. Se a regra de orquestração em island.js mudar, este
 * coordenador precisa acompanhar.
 */
import {NotificationManager} from '../modules/notifications.js';
import {NotifQueue} from '../modules/notifQueue.js';
import {assertEqual, assertTrue} from './lib/assert.js';

class FakeEmitter {
    constructor() {
        this._listeners = new Map();
    }

    connectObject(signal, cb, owner) {
        if (!this._listeners.has(signal))
            this._listeners.set(signal, []);
        this._listeners.get(signal).push({cb, owner});
        return this;
    }

    disconnectObject(owner) {
        for (const list of this._listeners.values()) {
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].owner === owner)
                    list.splice(i, 1);
            }
        }
    }

    emit(signal, ...args) {
        for (const {cb} of [...(this._listeners.get(signal) ?? [])])
            cb(this, ...args);
    }
}

class FakeNotif extends FakeEmitter {
    constructor(props = {}) {
        super();
        Object.assign(this, props);
    }

    destroy() {
        this.emit('destroy');
    }
}

class FakeSource extends FakeEmitter {
    fireNotification(notif) {
        this.emit('notification-added', notif);
    }
}

class FakeTray extends FakeEmitter {
    constructor() {
        super();
        this._sources = [];
    }

    getSources() {
        return this._sources;
    }

    addSource(source) {
        this._sources.push(source);
    }
}

/* Espelha a máquina de estado relevante de island.js: 'collapsed' (pill
 * ociosa) ou 'banner' (peek mostrando uma notificação). displayed[]
 * registra a ordem em que os peeks realmente apareceram. */
class FakeCoordinator {
    constructor(manager, queue) {
        this.state = 'collapsed';
        this.displayed = [];
        this._manager = manager;
        this._queue = queue;

        manager.connect('added',
            () => this._onNotificationAdded(manager.getLatest()));
        manager.connect('removed', () => {
            this._queue.discard(n => !manager.notifications.includes(n));
        });
    }

    _onNotificationAdded(notif) {
        this._queue.push(notif);
        this._pump();
    }

    _pump() {
        if (this.state !== 'collapsed')
            return;
        const notif = this._queue.next();
        if (!notif)
            return;
        this.state = 'banner';
        this.displayed.push(notif);
    }

    /* Simula o peek terminando (timer expirando) e voltando pra pill —
     * exatamente o gatilho que, em island.js, chama _pumpNotifQueue()
     * de novo a partir de _showCollapsed(). */
    dismissPeek() {
        this.state = 'collapsed';
        this._pump();
    }
}

export const tests = {
    'duas notificações disparadas juntas: a segunda espera e depois aparece'() {
        const manager = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        manager.start(tray);

        const queue = new NotifQueue();
        const coord = new FakeCoordinator(manager, queue);

        const n1 = new FakeNotif({title: 'n1'});
        const n2 = new FakeNotif({title: 'n2'});
        // "Ao mesmo tempo": as duas chegam antes de qualquer peek
        // terminar.
        source.fireNotification(n1);
        source.fireNotification(n2);

        assertEqual(coord.displayed.map(n => n.title), ['n1']);
        assertEqual(coord.state, 'banner');

        coord.dismissPeek();
        assertEqual(coord.displayed.map(n => n.title), ['n1', 'n2']);
    },

    'rajada de 5 notificações: todas aparecem, em ordem, nenhuma some'() {
        const manager = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        manager.start(tray);

        const queue = new NotifQueue();
        const coord = new FakeCoordinator(manager, queue);

        const burst = ['a', 'b', 'c', 'd', 'e']
            .map(title => new FakeNotif({title}));
        for (const n of burst)
            source.fireNotification(n);

        assertEqual(coord.displayed.length, 1);

        // Vai "terminando" cada peek até esvaziar a fila.
        while (queue.size > 0)
            coord.dismissPeek();

        assertEqual(coord.displayed.map(n => n.title),
            burst.map(n => n.title));
    },

    'notificação destruída antes da vez dela some da fila sem quebrar a sequência'() {
        const manager = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        manager.start(tray);

        const queue = new NotifQueue();
        const coord = new FakeCoordinator(manager, queue);

        const n1 = new FakeNotif({title: 'n1'});
        const n2 = new FakeNotif({title: 'n2'});
        const n3 = new FakeNotif({title: 'n3'});
        source.fireNotification(n1);
        source.fireNotification(n2);
        source.fireNotification(n3);

        assertEqual(coord.displayed.map(n => n.title), ['n1']);

        // n2 é destruída (app cancelou) antes de chegar a vez dela.
        n2.destroy();

        coord.dismissPeek();
        assertEqual(coord.displayed.map(n => n.title), ['n1', 'n3']);

        coord.dismissPeek();
        assertEqual(coord.displayed.map(n => n.title), ['n1', 'n3']);
        assertTrue(queue.size === 0);
    },
};
