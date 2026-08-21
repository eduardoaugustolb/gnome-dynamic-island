import Gio from 'gi://Gio';
import {assertFalse, assertTrue} from './lib/assert.js';

const root = Gio.File.new_for_path(import.meta.url
    .replace('file://', '').replace('/tests/refactor-contract.test.js', ''));

function source(path) {
    const file = root.get_child(path);
    const [, bytes] = file.load_contents(null);
    return new TextDecoder().decode(bytes);
}

export const tests = {
    'Panel usa a API pública de posicionamento do carrossel'() {
        const panel = source('components/Panel.js');
        assertTrue(panel.includes('positionTrack(index, animate = true)'));
        assertFalse(panel.includes('this._positionTrack('));
    },

    'Panel libera arrasto e debounce ao ser destruído'() {
        const panel = source('components/Panel.js');
        assertTrue(panel.includes('destroy() {'));
        assertTrue(panel.includes('this.endDrag();'));
        assertTrue(panel.includes('GLib.source_remove(this._notifRefreshId)'));
    },

    'Island mantém botões próprios do banner de mídia'() {
        const island = source('island.js');
        assertTrue(island.includes('_makeIconButton(iconName'));
        assertTrue(island.includes("'media-skip-backward-symbolic'"));
    },

    'rede e Bluetooth continuam usando o submenu nativo do GNOME'() {
        const panel = source('components/Panel.js');
        assertTrue(panel.includes('_openNativeDeviceMenu(type)'));
        assertTrue(panel.includes('quickSettings.menu.open()'));
        assertTrue(panel.includes('toggle.menu.open()'));
    },

    'menus de dispositivo não disputam com sliders ou notificações'() {
        const panel = source('components/Panel.js');
        assertTrue(panel.includes('a instanceof Slider'));
        assertTrue(panel.includes('a instanceof St.ScrollView'));
        assertTrue(panel.includes('DEVICE_MENU_HOLD_MS'));
    },

    'a pill tem caminho explícito de clique e rolagem'() {
        const pill = source('components/Pill.js');
        assertTrue(pill.includes("'button-press-event'"));
        assertTrue(pill.includes("'scroll-event'"));
        assertTrue(pill.includes('reactive: true'));
    },

    'Banner mantém ativação, hover e recolhimento temporizado'() {
        const banner = source('components/Banner.js');
        assertTrue(banner.includes("'button-press-event'"));
        assertTrue(banner.includes("'notify::hover'"));
        assertTrue(banner.includes('scheduleCollapse(ms, onTimeout)'));
        assertTrue(banner.includes('cancelCollapse()'));
    },

    'Island captura clique externo sem capturar teclado da aplicação'() {
        const island = source('island.js');
        assertTrue(island.includes("'captured-event'"));
        assertTrue(island.includes('event.type() === Clutter.EventType.KEY_PRESS'));
        assertTrue(island.includes('return Clutter.EVENT_PROPAGATE;'));
        assertTrue(island.includes('NÃO chamamos grab_key_focus() nem pushModal'));
    },

    'Panel limita a altura disponível e torna notificações roláveis'() {
        const panel = source('components/Panel.js');
        const css = source('stylesheet.css');
        assertTrue(panel.includes('maxPageHeight(this._maxHeight(), panelChrome)'));
        assertTrue(panel.includes('St.ScrollView'));
        assertTrue(css.includes('.island-notif-scroll'));
        assertTrue(css.includes('min-height: 0'));
    },

    'controles destrutivos exigem confirmação antes da execução'() {
        const panel = source('components/Panel.js');
        assertTrue(panel.includes("label.text = 'Confirmar?'"));
        assertTrue(panel.includes('powerOff()'));
        assertTrue(panel.includes('2500'));
    },
};
