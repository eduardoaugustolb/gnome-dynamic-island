import Gio from 'gi://Gio';
import {assertTrue} from './lib/assert.js';

const root = Gio.File.new_for_path(import.meta.url
    .replace('file://', '').replace('/tests/preferences-contract.test.js', ''));

function source(path) {
    const file = root.get_child(path);
    const [, bytes] = file.load_contents(null);
    return new TextDecoder().decode(bytes);
}

function assertIncludes(text, value) {
    assertTrue(text.includes(value), `esperava encontrar: ${value}`);
}

const schema = () => source('schemas/org.gnome.shell.extensions.dynamic-island.gschema.xml');
const prefs = () => source('prefs.js');

export const tests = {
    'schema expõe personalização visual avançada'() {
        const text = schema();
        assertIncludes(text, 'name="appearance-mode" type="s"');
        assertIncludes(text, "<default>'pill'</default>");
        assertIncludes(text, "'pill' ou 'notch'");
        for (const key of [
            'pill-background', 'panel-background', 'background-opacity',
            'border-opacity', 'shadow-enabled', 'shadow-opacity',
            'text-scale', 'font-family', 'border-color', 'content-spacing',
        ])
            assertIncludes(text, `name="${key}"`);
    },

    'schema expõe ordem, atalho e controles individuais'() {
        const text = schema();
        assertIncludes(text, 'name="page-order"');
        assertIncludes(text, 'name="media-playpause-keybinding"');
        for (const key of [
            'show-volume', 'show-brightness', 'show-wifi', 'show-bluetooth',
            'show-dark', 'show-night', 'show-dnd', 'show-power-actions',
        ])
            assertIncludes(text, `name="${key}"`);
    },

    'preferências exibem as novas opções'() {
        const text = prefs();
        assertIncludes(text, 'appearance-mode');
        assertIncludes(text, 'Pill');
        assertIncludes(text, 'Notch');
        for (const key of [
            'pill-background', 'panel-background', 'background-opacity',
            'border-opacity', 'shadow-enabled', 'shadow-opacity',
            'text-scale', 'font-family', 'border-color', 'content-spacing', 'page-order',
            'media-playpause-keybinding', 'show-volume', 'show-brightness',
            'show-wifi', 'show-bluetooth', 'show-dark', 'show-night',
            'show-dnd', 'show-power-actions',
        ])
            assertIncludes(text, `'${key}'`);
    },

    'restaurar padrões percorre todas as chaves do schema'() {
        const text = prefs();
        assertIncludes(text, 'function resetSettings(settings)');
        assertIncludes(text, 'settings.settings_schema.list_keys()');
        assertIncludes(text, 'settings.reset(key)');
        assertIncludes(text, "label: 'Restaurar padrões'");
        const keys = [...schema().matchAll(/<key name="([^"]+)"/g)]
            .map(match => match[1]);
        assertTrue(keys.length > 0);
        assertTrue(text.includes('for (const key of settings.settings_schema.list_keys())'));
    },

    'preferências protegem valores inválidos e sincronizam combos'() {
        const text = prefs();
        assertIncludes(text, 'safeInt(settings');
        assertIncludes(text, 'safeString(settings');
        assertIncludes(text, 'safeStrv(settings');
        assertIncludes(text, 'validColor(settings');
        assertIncludes(text, "settings.connect('changed::position'");
        assertIncludes(text, "settings.connect('changed::appearance-mode'");
        assertIncludes(text, 'safeSet(() =>');
    },

    'controles interativos têm nome, dica e foco de teclado'() {
        const panel = source('components/Panel.js');
        const island = source('island.js');
        const pill = source('components/Pill.js');
        const css = source('stylesheet.css');
        for (const value of [
            'accessible_name: def.label',
            'tooltip_text: `Alternar ${def.label}`',
            "this._volumeSlider.accessible_name = 'Volume'",
            "this._brightnessSlider.accessible_name = 'Brilho'",
            "accessible_name: 'Limpar notificações'",
        ])
            assertIncludes(panel, value);
        assertIncludes(island, 'tooltip_text: accessibleName');
        assertIncludes(island, 'bannerPrevBtn.can_focus = true');
        assertIncludes(pill, "accessible_name: 'Abrir painel da Dynamic Island'");
        assertIncludes(css, '.island-toggle:focus');
        assertIncludes(css, '.slider:focus');
    },

    'runtime aplica tema, escala e ordem configuráveis'() {
        const island = source('island.js');
        const panel = source('components/Panel.js');
        assertIncludes(island, "get_string('appearance-mode')");
        assertIncludes(island, "appearance-notch");
        assertIncludes(island, "get_string('pill-background')");
        assertIncludes(island, "get_int('background-opacity')");
        assertIncludes(island, "get_boolean('shadow-enabled')");
        assertIncludes(island, "get_int('text-scale')");
        assertIncludes(island, "get_string('font-family')");
        assertIncludes(panel, "get_strv('page-order')");
        assertIncludes(panel, "get_boolean('show-volume')");
    },
};
