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

    'largura expandida respeita o monitor atual'() {
        const island = source('island.js');
        assertTrue(island.includes('expandedWidth: () => this._expandedWidth()'));
        assertTrue(island.includes('return expandedWidth(configured, monitor.width, PANEL_SIDE_MARGIN)'));
        assertTrue(island.includes('const w = this._expandedWidth();'));
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

    'troca de camadas não faz crossfade entre pill e painel'() {
        const island = source('island.js');
        const start = island.indexOf('_swapLayers(show)');
        const end = island.indexOf('\n    }', start);
        const swap = island.slice(start, end);
        assertTrue(start >= 0);
        assertTrue(swap.includes('layer.opacity = 255;'));
        assertTrue(!swap.includes('layer.opacity = 0;'));
        assertTrue(!swap.includes('TIMING.fade'));
    },

    'animações de tamanho ignoram callbacks obsoletos'() {
        const island = source('island.js');
        assertTrue(island.includes('_sizeAnimationId'));
        assertTrue(island.includes('animationId === this._sizeAnimationId'));
    },

    'troca de camadas cancela somente suas propriedades'() {
        const island = source('island.js');
        const start = island.indexOf('_swapLayers(show)');
        const end = island.indexOf('\n    }', start);
        const swap = island.slice(start, end);
        assertTrue(swap.includes("remove_transition('translation-y')"));
        assertTrue(swap.includes("remove_transition('opacity')"));
        assertFalse(swap.includes('remove_all_transitions()'));
    },

    'ilha usa uma única superfície visual durante a expansão'() {
        const island = source('island.js');
        assertTrue(island.includes('this.set_style(surfaceStyle)'));
        assertTrue(island.includes('this._applyShape();',
            island.indexOf('_swapLayers(show)')));
        assertTrue(island.includes('background-color: transparent'));
    },

    'preferência de movimento usa a API de classes do St'() {
        const island = source('island.js');
        assertTrue(island.includes("remove_style_class_name('motion-reduced')"));
        assertTrue(island.includes("add_style_class_name('motion-reduced')"));
        assertFalse(island.includes('toggle_style_class_name('));
    },

    'mudança de monitor recalcula posição e strut'() {
        const extension = source('extension.js');
        assertTrue(extension.includes("connect('monitors-changed'"));
        const start = extension.indexOf("connect('monitors-changed'");
        const end = extension.indexOf('\n            });', start);
        const handler = extension.slice(start, end);
        assertTrue(handler.includes('this._updateStrut()'));
        assertTrue(handler.includes('this._position()'));
    },

    'mostrar a barra superior libera o strut'() {
        const extension = source('extension.js');
        const start = extension.indexOf('_showTopBar()');
        const end = extension.indexOf('\n    _position()', start);
        const handler = extension.slice(start, end);
        assertTrue(handler.includes('this._updateStrut()'));
    },

    'hover do Notch é aplicado à superfície raiz'() {
        const island = source('island.js');
        assertTrue(island.includes("notify::hover"));
        assertTrue(island.includes('rootHover'));
        assertTrue(island.includes('displayedSurface'));
        assertTrue(island.includes('appearance-notch'));
    },
};
