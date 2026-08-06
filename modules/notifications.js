import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

export const MAX_NOTIFICATIONS = 8;

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
    },
}, class NotificationManager extends GObject.Object {
    _init() {
        super._init();
        this.notifications = [];
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
        this.notifications = [];
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
        if (!this._started)
            return;
        // Guarda uma referência e remove quando a notificação for destruída.
        notif.connectObject('destroy',
            () => this._onDestroyed(notif), this);

        this.notifications.unshift(notif);
        if (this.notifications.length > MAX_NOTIFICATIONS)
            this.notifications.pop();
        this.emit('added');
    }

    _onDestroyed(notif) {
        const i = this.notifications.indexOf(notif);
        if (i < 0)
            return;
        this.notifications.splice(i, 1);
        this.emit('removed');
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
            this.emit('removed');
        }
    }
});
