import {NotificationManager, MAX_NOTIFICATIONS} from '../modules/notifications.js';
import {assertEqual, assertTrue, assertFalse} from './lib/assert.js';

/* O messageTray/source/notification reais do gnome-shell usam
 * connectObject/disconnectObject (monkeypatchado pelo próprio shell em
 * cima de GObject.Object). Fora do processo do shell isso não existe
 * (verificado: GObject.Object.prototype não tem connectObject sob gjs
 * puro), então essas fakes replicam só a fatia da API que
 * modules/notifications.js realmente usa. */
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
        const list = this._listeners.get(signal) ?? [];
        for (const {cb} of [...list])
            cb(this, ...args);
    }
}

class FakeNotif extends FakeEmitter {
    constructor(props = {}) {
        super();
        this.destroyCount = 0;
        Object.assign(this, props);
    }

    destroy() {
        this.destroyCount += 1;
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
        this.emit('source-added', source);
    }
}

export const tests = {
    'start() rastreia fontes já existentes no tray'() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        // addSource acima já dispara 'source-added', mas ainda sem
        // listener nenhum (start() não rodou); precisa continuar
        // presente em getSources() pra start() pegar na varredura
        // inicial.
        mgr.start(tray);

        const notif = new FakeNotif({title: 'Oi'});
        source.fireNotification(notif);

        assertEqual(mgr.notifications.length, 1);
        assertEqual(mgr.getLatest().title, 'Oi');
    },

    'start() também rastreia fontes adicionadas depois (source-added dinâmico)'() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        mgr.start(tray);

        const source = new FakeSource();
        tray.addSource(source);
        source.fireNotification(new FakeNotif({title: 'Depois'}));

        assertEqual(mgr.notifications.length, 1);
        assertEqual(mgr.getLatest().title, 'Depois');
    },

    'notificação nova vira a mais recente (getLatest) e emite added'() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        mgr.start(tray);

        let addedCount = 0;
        mgr.connect('added', () => addedCount += 1);

        source.fireNotification(new FakeNotif({title: 'Primeira'}));
        source.fireNotification(new FakeNotif({title: 'Segunda'}));

        assertEqual(addedCount, 2);
        assertEqual(mgr.getLatest().title, 'Segunda');
        assertEqual(mgr.notifications.map(n => n.title),
            ['Segunda', 'Primeira']);
    },

    // Garantia de estabilidade: por mais notificações que cheguem, o
    // histórico nunca cresce sem limite (MAX_NOTIFICATIONS), e o corte
    // sempre acontece pelas mais ANTIGAS, nunca pelas recém-chegadas.
    [`respeita o teto de MAX_NOTIFICATIONS (${MAX_NOTIFICATIONS}) descartando as mais antigas`]() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        mgr.start(tray);

        const total = MAX_NOTIFICATIONS + 3;
        for (let i = 0; i < total; i++)
            source.fireNotification(new FakeNotif({title: `n${i}`}));

        assertEqual(mgr.notifications.length, MAX_NOTIFICATIONS);
        assertEqual(mgr.getLatest().title, `n${total - 1}`);
        // A mais antiga sobrevivente deve ser a n{total - MAX}, não n0.
        const oldest = mgr.notifications[mgr.notifications.length - 1];
        assertEqual(oldest.title, `n${total - MAX_NOTIFICATIONS}`);
    },

    'destruir uma notificação a remove da lista e emite removed'() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        mgr.start(tray);

        const notif = new FakeNotif({title: 'Vai sumir'});
        source.fireNotification(notif);
        assertEqual(mgr.notifications.length, 1);

        let removedCount = 0;
        mgr.connect('removed', () => removedCount += 1);
        notif.destroy();

        assertEqual(removedCount, 1);
        assertEqual(mgr.notifications.length, 0);
    },

    'clearAll() destrói todas de verdade (não só limpa a lista local)'() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        mgr.start(tray);

        const notifs = [
            new FakeNotif({title: 'a'}),
            new FakeNotif({title: 'b'}),
            new FakeNotif({title: 'c'}),
        ];
        for (const n of notifs)
            source.fireNotification(n);

        mgr.clearAll();

        assertEqual(mgr.notifications.length, 0);
        assertTrue(notifs.every(n => n.destroyCount === 1));
    },

    'clearAll() em fila vazia não lança erro nem emite removed à toa'() {
        const mgr = new NotificationManager();
        let removedCount = 0;
        mgr.connect('removed', () => removedCount += 1);
        mgr.clearAll();
        assertEqual(removedCount, 0);
    },

    'stop() desliga os listeners — notificações depois disso não são mais capturadas'() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        mgr.start(tray);
        source.fireNotification(new FakeNotif({title: 'antes'}));
        assertEqual(mgr.notifications.length, 1);

        mgr.stop();
        assertEqual(mgr.notifications.length, 0);

        source.fireNotification(new FakeNotif({title: 'depois'}));
        assertEqual(mgr.notifications.length, 0);
    },

    'getLatest() em manager vazio devolve null'() {
        const mgr = new NotificationManager();
        assertFalse(!!mgr.getLatest());
    },

    'start() chamado duas vezes é no-op (não duplica listeners)'() {
        const mgr = new NotificationManager();
        const tray = new FakeTray();
        const source = new FakeSource();
        tray.addSource(source);
        mgr.start(tray);
        mgr.start(tray);

        let addedCount = 0;
        mgr.connect('added', () => addedCount += 1);
        source.fireNotification(new FakeNotif({title: 'única'}));

        assertEqual(addedCount, 1);
        assertEqual(mgr.notifications.length, 1);
    },
};
