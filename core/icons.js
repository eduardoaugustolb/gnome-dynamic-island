import Gio from 'gi://Gio';
import St from 'gi://St';

// Local artwork keeps the extension controls independent from icon themes.
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const iconDir = root.get_child('icons');

export function ownIcon(name, size) {
    return new St.Icon({gicon: ownGIcon(name), icon_size: size});
}

export function ownGIcon(name) {
    const aliases = {
        'window-close-symbolic': 'close',
        'pan-down-symbolic': 'chevron-down',
        'network-wireless-symbolic': 'wifi',
        'bluetooth-active-symbolic': 'bluetooth',
        'dark-mode-symbolic': 'moon',
        'night-light-symbolic': 'night',
        'notifications-disabled-symbolic': 'bell-off',
        'system-lock-screen-symbolic': 'lock',
        'weather-clear-night-symbolic': 'moon',
        'system-shutdown-symbolic': 'power',
        'audio-volume-muted-symbolic': 'volume',
        'audio-volume-low-symbolic': 'volume',
        'audio-volume-medium-symbolic': 'volume',
        'audio-volume-high-symbolic': 'volume',
        'display-brightness-symbolic': 'brightness',
        'media-playback-start-symbolic': 'play',
        'media-playback-pause-symbolic': 'pause',
        'media-skip-backward-symbolic': 'skip-backward',
        'media-skip-forward-symbolic': 'skip-forward',
    };
    const file = iconDir.get_child(`${aliases[name] ?? name}.svg`);
    return Gio.FileIcon.new(file);
}
