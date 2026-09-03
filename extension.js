import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Island} from './island.js';
import {isNotchMode} from './core/displayMode.js';
import {positionIsland, strutHeight} from './core/layout.js';

const TOP_GAP = 8;

export default class DynamicIslandExtension extends Extension {
    _topGap() {
        return isNotchMode(this._settings?.get_string('appearance-mode')) ? 0 : TOP_GAP;
    }

    enable() {
        this._settings = this.getSettings();

        this._island = new Island(this);
        Main.layoutManager.addTopChrome(this._island, {
            trackFullscreen: true,
            affectsStruts: false,
        });
        // Só agora a ilha está no stage; a sondagem de cores do tema
        // (get_theme_node) precisa disso para funcionar.
        this._island.refreshTheme();

        this._strut = new St.Widget({
            name: 'dynamicIslandStrut',
            reactive: false,
            opacity: 0,
        });
        Main.layoutManager.addChrome(this._strut, {
            affectsStruts: true,
            trackFullscreen: true,
        });

        this._allocationId = this._island.connect('notify::allocation',
            () => this._position());
        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => {
                this._updateStrut();
                this._position();
            });
        this._settingsId = this._settings.connect('changed',
            (_s, key) => {
                if (key === 'hide-top-bar')
                    this._applyTopBar();
                else if (key === 'position')
                    this._position();
                else if (key === 'appearance-mode') {
                    this._position();
                    this._updateStrut();
                } else if (key === 'collapsed-height')
                    this._updateStrut();
            });

        // Atalho global e exclusivo da extensão pra play/pause, em vez de
        // depender do foco de teclado do botão (que brigava com o
        // atalho nativo de Espaço do Spotify/YouTube/etc.).
        Main.wm.addKeybinding(
            'media-playpause-keybinding',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this._island?.toggleMediaPlayPause());

        this._applyTopBar();
        this._island.start();
        this._updateStrut();
        this._position();
    }

    _updateStrut() {
        if (!this._strut)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        // Só reservamos espaço próprio quando a barra nativa está
        // escondida; caso contrário ela já reserva a área.
        const topGap = this._topGap();
        const h = strutHeight(
            this._settings.get_int('collapsed-height'),
            topGap,
            this._topBarHidden);
        this._strut.set_position(monitor.x, monitor.y);
        this._strut.set_size(monitor.width, h);
    }

    _applyTopBar() {
        if (this._settings.get_boolean('hide-top-bar')) {
            this._hideTopBar();
        } else {
            this._showTopBar();
        }
    }

    _hideTopBar() {
        if (this._topBarHidden)
            return;
        this._topBarHidden = true;

        const panelBox = Main.layoutManager.panelBox;
        try {
            Main.layoutManager.removeChrome(panelBox);
            Main.layoutManager.addChrome(panelBox, {
                affectsStruts: false,
                trackFullscreen: false,
            });
        } catch (e) {
            logError(e, 'dynamic-island:hideTopBar');
        }
        panelBox.hide();
        try {
            Main.messageTray._bannerBin?.hide?.();
        } catch (_) {}
        this._updateStrut();
    }

    _showTopBar() {
        if (!this._topBarHidden)
            return;
        this._topBarHidden = false;

        const panelBox = Main.layoutManager.panelBox;
        try {
            Main.messageTray._bannerBin?.show?.();
        } catch (_) {}
        try {
            panelBox.show();
            Main.layoutManager.removeChrome(panelBox);
            Main.layoutManager.addChrome(panelBox, {
                affectsStruts: true,
                trackFullscreen: true,
            });
        } catch (e) {
            logError(e, 'dynamic-island:showTopBar');
        }
        this._updateStrut();
    }

    _position() {
        if (!this._island)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const topGap = this._topGap();
        const {x, y} = positionIsland({
            monitor,
            islandWidth: this._island.width,
            islandHeight: this._island.height,
            position: this._settings.get_string('position'),
            topGap,
        });
        if (this._island.x !== x || this._island.y !== y)
            this._island.set_position(x, y);
    }

    disable() {
        Main.wm.removeKeybinding('media-playpause-keybinding');
        if (this._allocationId) {
            this._island?.disconnect(this._allocationId);
            this._allocationId = 0;
        }
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        if (this._settingsId) {
            this._settings?.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        if (this._island) {
            this._island.destroy();
            this._island = null;
        }
        if (this._strut) {
            Main.layoutManager.removeChrome(this._strut);
            this._strut.destroy();
            this._strut = null;
        }
        this._showTopBar();
        this._settings = null;
    }
}
