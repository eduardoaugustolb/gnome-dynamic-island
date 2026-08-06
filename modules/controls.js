import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import UPower from 'gi://UPowerGlib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getDefault as getSystemActions} from 'resource:///org/gnome/shell/misc/systemActions.js';

const BLUEZ_ADAPTER_IFACE_XML = `
<node>
  <interface name="org.bluez.Adapter1">
    <property name="Powered" type="b" access="readwrite"/>
  </interface>
</node>`;
const BluezAdapterProxy = Gio.DBusProxy.makeProxyWrapper(
    BLUEZ_ADAPTER_IFACE_XML);

const NM_IFACE_XML = `
<node>
  <interface name="org.freedesktop.NetworkManager">
    <property name="WirelessEnabled"       type="b" access="readwrite"/>
    <property name="WirelessHardwareEnabled" type="b" access="read"/>
  </interface>
</node>`;
const NMProxy = Gio.DBusProxy.makeProxyWrapper(NM_IFACE_XML);

const UPOWER_DEVICE_IFACE_XML = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="IsPresent"    type="b" access="read"/>
    <property name="Percentage"   type="d" access="read"/>
    <property name="State"        type="u" access="read"/>
    <property name="IconName"     type="s" access="read"/>
  </interface>
</node>`;
const UPowerDeviceProxy = Gio.DBusProxy.makeProxyWrapper(
    UPOWER_DEVICE_IFACE_XML);

const DARK_SCHEMA = 'org.gnome.desktop.interface';
const DARK_KEY = 'color-scheme';
const NIGHT_SCHEMA = 'org.gnome.settings-daemon.plugins.color';
const NIGHT_KEY = 'night-light-enabled';
const DND_SCHEMA = 'org.gnome.desktop.notifications';
const DND_KEY = 'show-banners';

/**
 * Estado de controles do sistema: volume, brilho, Wi-Fi, modo escuro,
 * luz noturna, não perturbe e bateria. Emite sinais quando algo muda.
 */
export const Controls = GObject.registerClass({
    Signals: {
        'volume-changed': {
            param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_BOOLEAN],
        },
        'brightness-changed': {
            param_types: [GObject.TYPE_DOUBLE],
        },
        'toggle-changed': {
            param_types: [GObject.TYPE_STRING, GObject.TYPE_BOOLEAN],
        },
        'battery-changed': {},
    },
}, class Controls extends GObject.Object {
    _init() {
        super._init();
        this._sink = null;

        this._mixer = new Gvc.MixerControl({name: 'dynamic-island-volume'});
        this._mixer.connectObject(
            'state-changed', () => this._syncSink(),
            'default-sink-changed', () => this._syncSink(),
            this);
        this._mixer.open();

        this._nm = new NMProxy(
            Gio.DBus.system,
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            proxy => {
                if (proxy) {
                    proxy.connect('g-properties-changed',
                        () => this._emitToggle('wifi',
                            this._nm?.WirelessEnabled ?? false));
                    this._emitToggle('wifi', this._nm?.WirelessEnabled ?? false);
                }
            });

        this._upower = new UPowerDeviceProxy(
            Gio.DBus.system,
            'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice',
            proxy => {
                if (proxy) {
                    proxy.connect('g-properties-changed',
                        () => this._emitBattery());
                    this._emitBattery();
                }
            });

        // Usa o singleton do próprio shell: é o mesmo objeto que
        // alimenta o botão de energia do Quick Settings nativo.
        this._systemActions = getSystemActions();
        this._bluezAdapter = null;
        this._findBluezAdapter();

        this._darkSettings = new Gio.Settings({schema_id: DARK_SCHEMA});
        this._darkSettings.connectObject(
            `changed::${DARK_KEY}`,
            () => this._emitToggle('dark', this.isDark),
            this);

        this._nightSettings = new Gio.Settings({schema_id: NIGHT_SCHEMA});
        this._nightSettings.connectObject(
            `changed::${NIGHT_KEY}`,
            () => this._emitToggle('night', this.isNightLight),
            this);

        this._dndSettings = new Gio.Settings({schema_id: DND_SCHEMA});
        this._dndSettings.connectObject(
            `changed::${DND_KEY}`,
            () => this._emitToggle('dnd', this.isDnd),
            this);

        if (Main.brightnessManager)
            Main.brightnessManager.connectObject(
                'changed', () => this._syncBrightness(), this);

        this._syncSink();
        this._syncBrightness();
        this._emitBattery();
    }

    destroy() {
        if (this._mixer)
            this._mixer.disconnectObject(this);
        if (Main.brightnessManager)
            Main.brightnessManager.disconnectObject(this);
        this._darkSettings?.disconnectObject(this);
        this._nightSettings?.disconnectObject(this);
        this._dndSettings?.disconnectObject(this);
        if (this._bluezAdapter?._propChangedId) {
            try {
                this._bluezAdapter.disconnect(this._bluezAdapter._propChangedId);
            } catch (_) {}
        }
        this._bluezAdapter = null;
        this._mixer = null;
        this._sink = null;
    }

    /* ---------------- Bluetooth ---------------- */

    async _findBluezAdapter() {
        try {
            const reply = await new Promise((resolve, reject) => {
                Gio.DBus.system.call(
                    'org.bluez', '/',
                    'org.freedesktop.DBus.ObjectManager',
                    'GetManagedObjects', null, null,
                    Gio.DBusCallFlags.NONE, -1, null,
                    (_, res) => {
                        try { resolve(Gio.DBus.system.call_finish(res)); }
                        catch (e) { reject(e); }
                    });
            });
            const [objects] = reply.deepUnpack();
            const path = Object.keys(objects).find(
                p => 'org.bluez.Adapter1' in objects[p]);
            if (!path)
                return;
            const proxy = new BluezAdapterProxy(
                Gio.DBus.system, 'org.bluez', path);
            proxy._propChangedId = proxy.connect('g-properties-changed',
                () => this._emitToggle('bluetooth', this.isBluetooth));
            this._bluezAdapter = proxy;
            this._emitToggle('bluetooth', this.isBluetooth);
        } catch (_) {
            // BlueZ indisponível (sem hardware/serviço) — toggle fica oculto.
        }
    }

    get hasBluetooth() {
        return !!this._bluezAdapter;
    }

    get isBluetooth() {
        try {
            return this._bluezAdapter?.Powered ?? false;
        } catch (_) {
            return false;
        }
    }

    setBluetooth(enabled) {
        if (!this._bluezAdapter)
            return;
        try { this._bluezAdapter.Powered = enabled; }
        catch (e) { logError(e, 'dynamic-island:bluetooth'); }
    }

    /* ---------------- Ações de sistema ---------------- */

    lockScreen() {
        try { this._systemActions.activateLockScreen(); }
        catch (e) { logError(e, 'dynamic-island:lock'); }
    }

    suspend() {
        try { this._systemActions.activateSuspend(); }
        catch (e) { logError(e, 'dynamic-island:suspend'); }
    }

    powerOff() {
        try { this._systemActions.activatePowerOff(); }
        catch (e) { logError(e, 'dynamic-island:poweroff'); }
    }

    get canLock() {
        try { return this._systemActions.canLockScreen ?? true; }
        catch (_) { return true; }
    }

    get canSuspend() {
        try { return this._systemActions.canSuspend ?? true; }
        catch (_) { return true; }
    }

    /* ---------------- Volume ---------------- */

    _syncSink() {
        if (!this._mixer)
            return;
        if (this._mixer.get_state() !== Gvc.MixerControlState.READY) {
            this._setSink(null);
            return;
        }
        this._setSink(this._mixer.get_default_sink());
    }

    _setSink(sink) {
        if (sink === this._sink)
            return;
        this._sink?.disconnectObject(this);
        this._sink = sink;
        if (sink)
            sink.connectObject(
                'notify::volume', () => this._emitVolume(),
                'notify::is-muted', () => this._emitVolume(),
                this);
        this._emitVolume();
    }

    _emitVolume() {
        const {ratio, muted} = this.volume;
        this.emit('volume-changed', ratio, muted);
    }

    get volume() {
        if (!this._sink || !this._mixer)
            return {ratio: 0, muted: false};
        const maxNorm = this._mixer.get_vol_max_norm();
        if (!maxNorm)
            return {ratio: 0, muted: this._sink.is_muted};
        return {
            ratio: this._sink.volume / maxNorm,
            muted: this._sink.is_muted,
        };
    }

    setVolume(ratio) {
        if (!this._sink || !this._mixer)
            return;
        const maxNorm = this._mixer.get_vol_max_norm();
        const target = Math.min(1, Math.max(0, ratio)) * maxNorm;
        const muted = this._sink.is_muted;

        let changed;
        if (target < 1) {
            changed = this._sink.set_volume(0);
            if (!muted)
                this._sink.change_is_muted(true);
        } else {
            changed = this._sink.set_volume(target);
            if (muted)
                this._sink.change_is_muted(false);
        }
        if (changed)
            this._sink.push_volume();
    }

    toggleMute() {
        if (!this._sink)
            return;
        this._sink.change_is_muted(!this._sink.is_muted);
    }

    /* ---------------- Brilho ---------------- */

    get brightness() {
        const scale = Main.brightnessManager?.globalScale;
        if (!scale)
            return null;
        return scale.value;
    }

    setBrightness(value) {
        const scale = Main.brightnessManager?.globalScale;
        if (!scale)
            return;
        scale.value = Math.min(1, Math.max(0, value));
    }

    _syncBrightness() {
        const value = this.brightness;
        if (value !== null)
            this.emit('brightness-changed', value);
    }

    /* ---------------- Toggles ---------------- */

    get isWifi() {
        if (!this._nm)
            return false;
        try {
            return this._nm.WirelessEnabled ?? false;
        } catch (_) {
            return false;
        }
    }

    setWifi(enabled) {
        if (!this._nm)
            return;
        try { this._nm.WirelessEnabled = enabled; }
        catch (e) { logError(e, 'dynamic-island:wifi'); }
    }

    get isDark() {
        return this._darkSettings.get_string(DARK_KEY) === 'prefer-dark';
    }

    setDark(enabled) {
        this._darkSettings.set_string(DARK_KEY,
            enabled ? 'prefer-dark' : 'default');
    }

    get isNightLight() {
        return this._nightSettings.get_boolean(NIGHT_KEY);
    }

    setNightLight(enabled) {
        this._nightSettings.set_boolean(NIGHT_KEY, enabled);
    }

    get isDnd() {
        return !this._dndSettings.get_boolean(DND_KEY);
    }

    setDnd(enabled) {
        this._dndSettings.set_boolean(DND_KEY, !enabled);
    }

    getToggle(name) {
        switch (name) {
        case 'wifi': return this.isWifi;
        case 'bluetooth': return this.isBluetooth;
        case 'dark': return this.isDark;
        case 'night': return this.isNightLight;
        case 'dnd': return this.isDnd;
        }
        return false;
    }

    setToggle(name, enabled) {
        switch (name) {
        case 'wifi': this.setWifi(enabled); break;
        case 'bluetooth': this.setBluetooth(enabled); break;
        case 'dark': this.setDark(enabled); break;
        case 'night': this.setNightLight(enabled); break;
        case 'dnd': this.setDnd(enabled); break;
        }
    }

    _emitToggle(name, value) {
        this.emit('toggle-changed', name, value);
    }

    /* ---------------- Bateria ---------------- */

    get battery() {
        if (!this._upower)
            return null;
        try {
            if (!this._upower.IsPresent)
                return null;
            const state = this._upower.State;
            return {
                percent: this._upower.Percentage,
                charging: state === UPower.DeviceState.CHARGING ||
                    state === UPower.DeviceState.PENDING_CHARGE,
                full: state === UPower.DeviceState.FULLY_CHARGED,
            };
        } catch (_) {
            return null;
        }
    }

    _emitBattery() {
        this.emit('battery-changed');
    }
});
