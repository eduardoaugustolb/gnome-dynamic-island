import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

// O histórico precisa ser grande o bastante para que a página rolável seja
// útil, mas sempre finito: guardar referências a todas as notificações que
// já chegaram transformaria uma rajada longa em consumo de memória/layout
// sem limite dentro do Shell.
export const MAX_NOTIFICATIONS = 50;

/**
 * Acompanha notificações do messageTray. Mantém uma lista dos mais recentes
 * e emite sinais para a ilha reagir.
 *
 * Não importa `Main`/`resource:///org/gnome/shell/...` diretamente de
 * propósito: o messageTray é injetado em start(tray) pelo chamador
 * (island.js passa Main.messageTray). Isso mantém o módulo carregável e
 * testável fora do processo do gnome-shell (ver tests/notifications.test.js).
 */
export const NotificationManager = GObject.registerClass({
    Signals: {
        'added': {},
        'removed': {},
        'updated': {},
    },
}, class NotificationManager extends GObject.Object {
    _init() {
        super._init();
        // `notifications` continua sendo a API legada: uma lista de
        // notificações reais, da mais recente para a mais antiga. O modelo
        // agrupado é derivado dela e não substitui essa lista, pois a fila
        // de banners e os callbacks públicos ainda trabalham com objetos de
        // Notification do GNOME Shell.
        this.notifications = [];
        this.notificationGroups = [];
        this._notificationSet = new Set();
        this._groupsByKey = new Map();
        this._fallbackSourceKeys = new WeakMap();
        this._fallbackNotificationKeys = new WeakMap();
        this._nextSourceKey = 1;
        this._sources = new Map();
    }

    start(tray) {
        if (this._started)
            return;
        this._started = true;
        this._tray = tray;

        tray.connectObject('source-added',
            (_tray, source) => this._trackSource(source), this);
        for (const source of tray.getSources())
            this._trackSource(source);
    }

    stop() {
        if (!this._started)
            return;
        this._started = false;

        if (this._tray)
            this._tray.disconnectObject(this);
        this._tray = null;
        for (const source of this._sources.keys())
            source.disconnectObject(this);
        this._sources.clear();
        for (const notif of this.notifications) {
            try { notif.disconnectObject(this); } catch (_) {}
        }
        this.notifications = [];
        this.notificationGroups = [];
        this._notificationSet.clear();
        this._groupsByKey.clear();
    }

    destroy() {
        this.stop();
    }

    _trackSource(source) {
        if (this._sources.has(source))
            return;
        this._sources.set(source, true);
        source.connectObject('notification-added',
            (_src, notif) => this._onAdded(notif), this);
    }

    _onAdded(notif) {
        if (!this._started || !notif || this._notificationSet.has(notif))
            return;
        // O Shell normalmente emite este sinal uma vez, mas algumas fontes
        // podem reenviar o mesmo objeto durante uma atualização. A identidade
        // do objeto é a única deduplicação segura: duas notificações iguais
        // em texto continuam sendo duas notificações distintas.
        this._notificationSet.add(notif);
        notif.connectObject('destroy',
            () => this._onDestroyed(notif), this);
        // Atualizações do mesmo objeto devem refletir título/corpo na lista,
        // sem inserir uma segunda entrada nem alterar sua posição temporal.
        try {
            notif.connectObject('updated',
                () => this._onUpdated(notif), this);
        } catch (_) {}

        this.notifications.unshift(notif);
        if (this.notifications.length > MAX_NOTIFICATIONS) {
            const evicted = this.notifications.pop();
            this._notificationSet.delete(evicted);
            try { evicted.disconnectObject(this); } catch (_) {}
        }
        this._rebuildGroups();
        this.emit('added');
    }

    _onDestroyed(notif) {
        if (!this._notificationSet.has(notif))
            return;
        this._notificationSet.delete(notif);
        const i = this.notifications.indexOf(notif);
        if (i >= 0)
            this.notifications.splice(i, 1);
        this._rebuildGroups();
        this.emit('removed');
    }

    _onUpdated(notif) {
        if (!this._notificationSet.has(notif))
            return;
        this._rebuildGroups();
        this.emit('updated');
    }

    _sourceKey(notif) {
        const source = notif?.source;
        // Títulos são o identificador estável exposto pelo MessageTray e
        // agrupam instâncias equivalentes do mesmo app/fonte.
        const title = source?.title ?? source?.name ?? source?.appName;
        if (typeof title === 'string' && title.length > 0)
            return `title:${title}`;
        if (source && (typeof source === 'object' || typeof source === 'function')) {
            if (!this._fallbackSourceKeys.has(source))
                this._fallbackSourceKeys.set(source, `object:${this._nextSourceKey++}`);
            return this._fallbackSourceKeys.get(source);
        }
        // Sem uma fonte não há base segura para agrupar: não misture
        // notificações de apps desconhecidos só porque ambas não têm meta.
        if (notif && (typeof notif === 'object' || typeof notif === 'function')) {
            if (!this._fallbackNotificationKeys.has(notif))
                this._fallbackNotificationKeys.set(
                    notif, `notification:${this._nextSourceKey++}`);
            return this._fallbackNotificationKeys.get(notif);
        }
        return `notification:${this._nextSourceKey++}`;
    }

    /* Recalcula o índice agrupado a partir da lista canônica. Assim, a
     * ordem dos grupos é exatamente a ordem da primeira ocorrência mais
     * recente e a remoção de um item nunca deixa contadores obsoletos. */
    _rebuildGroups() {
        const groups = [];
        const byKey = new Map();
        for (const notif of this.notifications) {
            const key = this._sourceKey(notif);
            let group = byKey.get(key);
            if (!group) {
                group = {
                    key,
                    source: notif.source ?? null,
                    latest: notif,
                    notifications: [],
                    count: 0,
                };
                byKey.set(key, group);
                groups.push(group);
            }
            group.notifications.push(notif);
            group.count += 1;
        }
        this.notificationGroups = groups;
        this._groupsByKey = byKey;
    }

    getNotificationGroups() {
        return this.notificationGroups;
    }

    getLatest() {
        return this.notifications[0] ?? null;
    }

    /* Descarta de verdade cada notificação rastreada (não só limpa a
     * lista local) — dessa forma ela também some do message tray do
     * GNOME, não só do painel da ilha. destroy() dispara _onDestroyed
     * pra cada uma, que já remove do array; iteramos sobre uma cópia
     * porque o array original muda durante o loop. */
    clearAll() {
        const list = [...this.notifications];
        for (const notif of list) {
            try { notif.destroy(); } catch (_) {}
        }
        if (this.notifications.length > 0) {
            this.notifications = [];
            this._notificationSet.clear();
            this._rebuildGroups();
            this.emit('removed');
        }
    }
});
