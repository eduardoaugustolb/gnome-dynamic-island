import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/shell/extensions/prefs.js';

const POSITIONS = ['center', 'left', 'right'];

function hexToRgba(hex) {
    const v = parseInt(hex.slice(1), 16);
    const rgba = new Gdk.RGBA();
    rgba.red = ((v >> 16) & 255) / 255;
    rgba.green = ((v >> 8) & 255) / 255;
    rgba.blue = (v & 255) / 255;
    rgba.alpha = 1;
    return rgba;
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
    row.set_value(settings.get_int(key));
    row.connect('notify::value', r =>
        settings.set_int(key, Math.round(r.value)));
    return row;
}

function switchRow(title, subtitle, key, settings) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
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
        position.selected = Math.max(0, POSITIONS.indexOf(
            settings.get_string('position')));
        position.connect('notify::selected', row =>
            settings.set_string('position', POSITIONS[row.selected]));
        general.add(position);

        general.add(spinRow('Largura expandida',
            'expanded-width', settings,
            {lower: 280, upper: 900, step: 10}));
        general.add(spinRow('Altura recolhida',
            'collapsed-height', settings,
            {lower: 30, upper: 80, step: 2}));
        general.add(spinRow('Raio dos cantos',
            'corner-radius', settings,
            {lower: 10, upper: 80, step: 2}));

        const accentRow = new Adw.ActionRow({
            title: 'Cor de destaque',
            subtitle: 'Usada nos toggles ativos e nos sliders',
        });
        const accentButton = new Gtk.ColorButton({
            rgba: hexToRgba(settings.get_string('accent-color')),
        });
        accentButton.connect('color-set', btn =>
            settings.set_string('accent-color', rgbaToHex(btn.rgba)));
        accentRow.add_suffix(accentButton);
        accentRow.set_activatable_widget(accentButton);
        general.add(accentRow);

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
    }
}
