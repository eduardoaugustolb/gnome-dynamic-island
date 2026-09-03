import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = ['center', 'left', 'right'];
const APPEARANCE_MODES = ['pill', 'notch'];
const APPEARANCE_LABELS = ['Pill', 'Notch'];
const DEFAULT_COLORS = {
    'accent-color': '#0A84FF',
    'border-color': '#FFFFFF',
    'pill-background': '#141416',
    'panel-background': '#18181C',
};

/* GSettings normally validates values written through its API, but values
 * from an older schema or another settings editor can still be outside the
 * range expected by a widget. Keep the preferences page usable in that case
 * and let the next user change repair the setting. */
function safeInt(settings, key, fallback, lower, upper) {
    let value;
    try {
        value = settings.get_int(key);
    } catch (_) {
        value = fallback;
    }
    if (!Number.isFinite(value))
        value = fallback;
    return Math.min(upper, Math.max(lower, value));
}

function safeString(settings, key, fallback) {
    try {
        const value = settings.get_string(key);
        return typeof value === 'string' && value.length > 0 ? value : fallback;
    } catch (_) {
        return fallback;
    }
}

function safeStrv(settings, key, fallback = []) {
    try {
        const value = settings.get_strv(key);
        return Array.isArray(value) ? value.filter(v => typeof v === 'string') : fallback;
    } catch (_) {
        return fallback;
    }
}

function validColor(settings, key) {
    const value = safeString(settings, key, DEFAULT_COLORS[key]);
    return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_COLORS[key];
}

function hexToRgba(hex) {
    const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000';
    const v = parseInt(value.slice(1), 16);
    const rgba = new Gdk.RGBA();
    rgba.red = ((v >> 16) & 255) / 255;
    rgba.green = ((v >> 8) & 255) / 255;
    rgba.blue = (v & 255) / 255;
    rgba.alpha = 1;
    return rgba;
}

function safeSet(setter) {
    try {
        setter();
    } catch (_) {
        // A concurrent settings/schema change must not tear down the page.
    }
}

function resetSettings(settings) {
    for (const key of settings.settings_schema.list_keys())
        safeSet(() => settings.reset(key));
}

function rgbaToHex(rgba) {
    const toHex = v =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${toHex(rgba.red)}${toHex(rgba.green)}${toHex(rgba.blue)}`.toUpperCase();
}

function spinRow(title, key, settings, {lower, upper, step}) {
    const row = new Adw.SpinRow({title});
    row.set_adjustment(new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
    }));
    row.set_value(safeInt(settings, key, lower, lower, upper));
    row.connect('notify::value', r => safeSet(() =>
        settings.set_int(key, Math.round(Math.min(upper, Math.max(lower, r.value))))));
    return row;
}

function switchRow(title, subtitle, key, settings) {
    const row = new Adw.SwitchRow({title, subtitle});
    row.set_tooltip_text(subtitle);
    safeSet(() => settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT));
    return row;
}

function colorRow(title, subtitle, key, settings) {
    const row = new Adw.ActionRow({title, subtitle});
    const button = new Gtk.ColorButton({
        rgba: hexToRgba(validColor(settings, key)),
        tooltip_text: subtitle,
    });
    button.set_accessible_name(title);
    button.connect('color-set', btn => safeSet(() =>
        settings.set_string(key, rgbaToHex(btn.rgba))));
    row.add_suffix(button);
    row.set_activatable_widget(button);
    return row;
}

function stringRow(title, subtitle, key, settings) {
    const row = new Adw.EntryRow({title, text: safeString(settings, key, '')});
    row.set_tooltip_text(subtitle);
    row.connect('changed', entry => safeSet(() =>
        settings.set_string(key, entry.text)));
    return row;
}

function strvRow(title, subtitle, key, settings) {
    const row = new Adw.EntryRow({
        title,
        text: safeStrv(settings, key).join(', '),
    });
    row.set_tooltip_text(subtitle);
    row.connect('changed', entry => {
        const values = entry.text.split(',').map(value => value.trim()).filter(Boolean);
        safeSet(() => settings.set_strv(key, values));
    });
    return row;
}

export default class DynamicIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        /* ---------- Aparência ---------- */
        const general = new Adw.PreferencesGroup({title: 'Aparência'});
        page.add(general);

        const position = new Adw.ComboRow({
            title: 'Posição',
            subtitle: 'Onde a ilha fica ancorada na borda superior',
            model: new Gtk.StringList({strings: POSITIONS}),
        });
        const positionIndex = POSITIONS.indexOf(
            safeString(settings, 'position', 'center'));
        position.selected = positionIndex >= 0 ? positionIndex : 0;
        position.connect('notify::selected', row => {
            const value = POSITIONS[row.selected] ?? 'center';
            safeSet(() => settings.set_string('position', value));
        });
        settings.connect('changed::position', () => {
            const index = POSITIONS.indexOf(
                safeString(settings, 'position', 'center'));
            position.selected = index >= 0 ? index : 0;
        });
        general.add(position);

        const appearance = new Adw.ComboRow({
            title: 'Estilo',
            subtitle: 'Escolha entre a pill flutuante e o notch conectado ao topo',
            model: new Gtk.StringList({strings: APPEARANCE_LABELS}),
        });
        const appearanceIndex = APPEARANCE_MODES.indexOf(
            safeString(settings, 'appearance-mode', 'pill'));
        appearance.selected = appearanceIndex >= 0 ? appearanceIndex : 0;
        appearance.connect('notify::selected', row => {
            const mode = APPEARANCE_MODES[row.selected] ?? 'pill';
            if (safeString(settings, 'appearance-mode', 'pill') !== mode)
                safeSet(() => settings.set_string('appearance-mode', mode));
        });
        settings.connect('changed::appearance-mode', () => {
            const selected = APPEARANCE_MODES.indexOf(
                settings.get_string('appearance-mode'));
            appearance.selected = selected >= 0 ? selected : 0;
        });
        general.add(appearance);

        general.add(spinRow('Largura expandida',
            'expanded-width', settings,
            {lower: 280, upper: 900, step: 10}));
        general.add(spinRow('Altura recolhida',
            'collapsed-height', settings,
            {lower: 30, upper: 80, step: 2}));
        general.add(spinRow('Raio dos cantos',
            'corner-radius', settings,
            {lower: 10, upper: 80, step: 2}));

        general.add(colorRow('Cor de destaque',
            'Usada nos toggles ativos e nos sliders', 'accent-color', settings));
        general.add(colorRow('Cor da borda',
            'Cor da borda da pill e do painel', 'border-color', settings));
        general.add(colorRow('Fundo da pill',
            'Cor da área recolhida', 'pill-background', settings));
        general.add(colorRow('Fundo do painel',
            'Cor da área expandida', 'panel-background', settings));
        general.add(spinRow('Opacidade do fundo',
            'background-opacity', settings, {lower: 20, upper: 100, step: 1}));
        general.add(spinRow('Opacidade da borda',
            'border-opacity', settings, {lower: 0, upper: 100, step: 1}));
        general.add(switchRow('Sombra', 'Exibe uma sombra ao redor da ilha',
            'shadow-enabled', settings));
        general.add(spinRow('Opacidade da sombra',
            'shadow-opacity', settings, {lower: 0, upper: 100, step: 1}));
        general.add(spinRow('Escala do texto',
            'text-scale', settings, {lower: 80, upper: 140, step: 5}));
        general.add(stringRow('Família da fonte',
            'Nome da família instalada, por exemplo Sans ou Cantarell',
            'font-family', settings));
        general.add(spinRow('Espaçamento do conteúdo',
            'content-spacing', settings, {lower: 0, upper: 24, step: 1}));

        /* ---------- Comportamento ---------- */
        const behavior = new Adw.PreferencesGroup({title: 'Comportamento'});
        page.add(behavior);

        behavior.add(switchRow('Esconder barra superior',
            'A ilha substitui toda a barra do GNOME',
            'hide-top-bar', settings));
        behavior.add(switchRow('Animações',
            'Transições suaves ao expandir e recolher',
            'animations', settings));
        behavior.add(spinRow('Duração do peek de notificação',
            'peek-duration', settings,
            {lower: 1500, upper: 30000, step: 500}));
        behavior.add(spinRow('Duração do banner de mídia',
            'media-banner-duration', settings,
            {lower: 1500, upper: 30000, step: 500}));
        behavior.add(strvRow('Atalho de mídia',
            'Aceleradores GNOME separados por vírgula',
            'media-playpause-keybinding', settings));
        behavior.add(strvRow('Ordem das páginas',
            'Use media, controls e notifications separados por vírgula',
            'page-order', settings));

        /* ---------- Conteúdo ---------- */
        const content = new Adw.PreferencesGroup({title: 'Conteúdo'});
        page.add(content);

        content.add(switchRow('Notificações',
            'Peek de notificações e lista no painel',
            'show-notifications', settings));
        content.add(switchRow('Mídia',
            'Ícone na pill e player no painel',
            'show-media', settings));
        content.add(switchRow('Controles rápidos',
            'Volume, brilho e toggles no painel',
            'show-controls', settings));
        content.add(switchRow('Bateria',
            'Ícone e porcentagem na pill',
            'show-battery', settings));

        const controls = new Adw.PreferencesGroup({title: 'Controles individuais'});
        page.add(controls);
        for (const [key, title] of [
            ['show-volume', 'Volume'], ['show-brightness', 'Brilho'],
            ['show-wifi', 'Wi-Fi'], ['show-bluetooth', 'Bluetooth'],
            ['show-dark', 'Modo escuro'], ['show-night', 'Luz noturna'],
            ['show-dnd', 'Não perturbe'], ['show-power-actions', 'Ações do sistema'],
        ])
            controls.add(switchRow(title, `Mostrar ${title.toLowerCase()}`,
                key, settings));

        const resetGroup = new Adw.PreferencesGroup({title: 'Configuração'});
        const resetRow = new Adw.ActionRow({
            title: 'Restaurar padrões',
            subtitle: 'Volta todas as opções desta extensão aos valores originais',
        });
        const resetButton = new Gtk.Button({
            label: 'Restaurar padrões',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Restaurar todas as opções aos valores originais',
        });
        resetButton.set_accessible_name('Restaurar padrões');
        resetButton.connect('clicked', () => resetSettings(settings));
        resetRow.add_suffix(resetButton);
        resetRow.set_activatable_widget(resetButton);
        resetGroup.add(resetRow);
        page.add(resetGroup);
    }
}
