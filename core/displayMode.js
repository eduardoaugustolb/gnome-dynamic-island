export const DISPLAY_MODES = ['pill', 'notch'];

export function normalizeDisplayMode(value) {
    return DISPLAY_MODES.includes(value) ? value : 'pill';
}

export function isNotchMode(value) {
    return normalizeDisplayMode(value) === 'notch';
}
