import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

/* Gio.DBusProxy.makeProxyWrapper() só vincula o proxy à PRIMEIRA
 * <interface> do XML (usa nodeInfo.interfaces[0] como g_interface_name).
 * Por isso não dá pra combinar org.mpris.MediaPlayer2 e
 * org.mpris.MediaPlayer2.Player num único proxy — precisamos de dois,
 * exatamente como o js/ui/mpris.js do próprio GNOME Shell faz. */
const ROOT_IFACE_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity"     type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
  </interface>
</node>`;

const PLAYER_IFACE_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata"       type="a{sv}" access="read"/>
    <property name="Position"       type="x" access="read"/>
    <property name="CanGoNext"      type="b" access="read"/>
    <property name="CanGoPrevious"  type="b" access="read"/>
    <property name="CanPlay"        type="b" access="read"/>
    <property name="CanPause"       type="b" access="read"/>
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Play"/>
    <method name="Pause"/>
    <method name="Stop"/>
  </interface>
</node>`;

const RootProxy = Gio.DBusProxy.makeProxyWrapper(ROOT_IFACE_XML);
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE_XML);

// Exportadas (só) pra dar pra testar em isolamento — ver
// tests/media.test.js. Continuam de uso interno do módulo.
export function _unwrap(v) {
    if (v && typeof v.deep_unpack === 'function')
        return v.deep_unpack();
    return v;
}

export function _extractMeta(metadata) {
    if (!metadata)
        return {title: '', artist: '', album: '', artUrl: '', length: 0};
    const get = key => {
        const v = metadata[key];
        return v !== undefined ? _unwrap(v) : null;
    };
    const artist = get('xesam:artist');
    return {
        title: get('xesam:title') ?? '',
        artist: Array.isArray(artist) ? artist.join(', ') : (artist ?? ''),
        album: get('xesam:album') ?? '',
        artUrl: get('mpris:artUrl') ?? '',
        length: get('mpris:length') ?? 0,
    };
}

/**
 * Observa players MPRIS no barramento de sessão e mantém o player ativo
 * (aquele que está tocando, caso contrário o primeiro disponível).
 */
export const MediaWatcher = GObject.registerClass({
    Signals: {
        'changed': {},
        'playing-started': {},
        'playing-stopped': {},
    },
}, class MediaWatcher extends GObject.Object {
    _init() {
        super._init();
        this._players = new Map();
        this._active = null;
        this._activePlaying = false;
    }

    start() {
        this._stopped = false;
        this._nameOwnerId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner && !oldOwner)
                    this._addPlayer(name);
                else if (oldOwner && !newOwner)
                    this._removePlayer(name);
            });
        this._listExistingPlayers().catch(e =>
            logError(e, 'dynamic-island:media:list'));

        this._pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500,
            () => {
                if (this._stopped)
                    return GLib.SOURCE_REMOVE;
                this._recompute();
                return GLib.SOURCE_CONTINUE;
            });
    }

    stop() {
        this._stopped = true;
        if (this._pollTimer) {
            GLib.source_remove(this._pollTimer);
            this._pollTimer = 0;
        }
        if (this._nameOwnerId) {
            try {
                Gio.DBus.session.signal_unsubscribe(this._nameOwnerId);
            } catch (_) {}
            this._nameOwnerId = 0;
        }
        for (const {player} of this._players.values()) {
            if (player?._propChangedId) {
                try { player.disconnect(player._propChangedId); } catch (_) {}
            }
        }
        this._players.clear();
        this._active = null;
        this._activePlaying = false;
    }

    destroy() {
        this.stop();
    }

    async _listExistingPlayers() {
        const reply = await new Promise((resolve, reject) => {
            Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (_, res) => {
                    try { resolve(Gio.DBus.session.call_finish(res)); }
                    catch (e) { reject(e); }
                });
        });
        const [names] = reply.deepUnpack();
        for (const n of names) {
            if (n.startsWith(MPRIS_PREFIX))
                this._addPlayer(n);
        }
    }

    /* Os proxies são inicializados de forma ASSÍNCRONA (com callback),
     * igual ao js/ui/mpris.js do próprio GNOME Shell faz. Chamar a
     * variante síncrona (sem callback) daqui de dentro — um handler de
     * sinal D-Bus/continuação de Promise — é frágil: a chamada síncrona
     * pode falhar silenciosamente nesse contexto, descartando o player
     * sem erro visível (foi isso que fazia a mídia nunca ser detectada,
     * mesmo com a interface certa). */
    _addPlayer(busName) {
        if (this._players.has(busName))
            return;
        const entry = {player: null, root: null};
        this._players.set(busName, entry);

        new PlayerProxy(Gio.DBus.session, busName, '/org/mpris/MediaPlayer2',
            (proxy, error) => {
                if (error) {
                    logError(error, 'dynamic-island:media:player');
                    return;
                }
                const current = this._players.get(busName);
                if (this._stopped || current !== entry)
                    return;
                entry.player = proxy;
                proxy._propChangedId = proxy.connect('g-properties-changed', () => {
                    if (!this._stopped)
                        this._recompute();
                });
                this._recompute();
            });

        new RootProxy(Gio.DBus.session, busName, '/org/mpris/MediaPlayer2',
            (proxy, error) => {
                if (error) {
                    logError(error, 'dynamic-island:media:root');
                    return;
                }
                const current = this._players.get(busName);
                if (this._stopped || current !== entry)
                    return;
                entry.root = proxy;
                this._recompute();
            });
    }

    _removePlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;
        try {
            if (entry.player?._propChangedId)
                entry.player.disconnect(entry.player._propChangedId);
        } catch (_) {}
        this._players.delete(busName);
        this._recompute();
    }

    _pickActive() {
        let paused = null;
        for (const [name, entry] of this._players) {
            if (!entry.player)
                continue;
            let status;
            try { status = entry.player.PlaybackStatus; } catch (_) { continue; }
            if (status === 'Playing')
                return {name, proxy: entry.player, root: entry.root, status};
            if (!paused && status === 'Paused')
                paused = {name, proxy: entry.player, root: entry.root, status};
        }
        return paused;
    }

    _recompute() {
        const best = this._pickActive();
        if (!best) {
            if (this._activePlaying) {
                this._activePlaying = false;
                this._active = null;
                this.emit('playing-stopped');
            }
            this._active = null;
            this._cachedInfo = {playing: false, paused: false};
            this.emit('changed');
            return;
        }

        const wasPlaying = this._activePlaying;
        const wasSamePlayer = this._active?.name === best.name;
        this._active = best;
        this._activePlaying = best.status === 'Playing';

        let iconName = 'audio-x-generic-symbolic';
        try {
            if (best.root?.DesktopEntry)
                iconName = best.root.DesktopEntry;
        } catch (_) {}
        let meta = {};
        try { meta = _extractMeta(best.proxy.Metadata); } catch (_) {}
        // Position é opcional no MPRIS — o Firefox, por exemplo, não
        // implementa a propriedade (o getter devolve undefined). Ela não
        // é mais renderizada na UI (a barra de progresso foi removida),
        // mas fica no info para diagnóstico/testes. null = indisponível.
        let position = null;
        try {
            const p = best.proxy.Position;
            if (typeof p === 'number' && Number.isFinite(p))
                position = p;
        } catch (_) {}
        const safe = (get) => {
            try { return get() !== false; } catch (_) { return true; }
        };

        const info = {
            playing: best.status === 'Playing',
            paused: best.status === 'Paused',
            icon: iconName,
            bus: best.name,
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            artUrl: meta.artUrl,
            length: meta.length,
            position,
            canNext: safe(() => best.proxy.CanGoNext),
            canPrev: safe(() => best.proxy.CanGoPrevious),
            canPlay: safe(() => best.proxy.CanPlay),
            canPause: safe(() => best.proxy.CanPause),
        };

        this._cachedInfo = info;

        if (info.playing && (!wasPlaying || !wasSamePlayer))
            this.emit('playing-started');
        else if (!info.playing && wasPlaying)
            this.emit('playing-stopped');
        this.emit('changed');
    }

    isActive() {
        return !!this._active;
    }

    get info() {
        if (!this._active)
            return {playing: false, paused: false};
        // recompute light: reuse last computed info cached here
        return this._cachedInfo ?? {playing: false, paused: false};
    }

    playPause() { this._call('PlayPauseRemote'); }
    next() { this._call('NextRemote'); }
    previous() { this._call('PreviousRemote'); }
    play() { this._call('PlayRemote'); }
    pause() { this._call('PauseRemote'); }

    /* Lock de transição por método: o MPRIS não confirma a mudança de
     * estado de forma síncrona, e um par de comandos (duplo clique, foco
     * de teclado + clique, repetição de atalho) pode chegar ao player
     * antes de ele refletir o estado novo — resultando em dois toggles
     * seguidos que parecem "não responder". Comandos repetidos do mesmo
     * método num intervalo de 250ms são descartados. */
    _call(method) {
        if (!this._active?.proxy)
            return;
        const now = Date.now();
        if (this._callLock && this._callLock.method === method &&
            now - this._callLock.at < 250)
            return;
        this._callLock = {method, at: now};
        try { this._active.proxy[method](() => {}); }
        catch (e) { logError(e, 'dynamic-island:media:call'); }
    }
});
