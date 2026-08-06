# Dynamic Island

An Apple-inspired **Dynamic Island** for GNOME Shell that replaces the top bar. Clock, media, notifications, and quick settings live in one compact island with smooth animations.

![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)
[![CI](https://github.com/eduardoaugustolb/gnome-dynamic-island/actions/workflows/ci.yml/badge.svg)](https://github.com/eduardoaugustolb/gnome-dynamic-island/actions)

> Tested on **GNOME Shell 50**. It requires only GNOME Shell's built-in GJS, Clutter, and St libraries.

## Features

- **Top bar replacement**: a centered pill shows the date, time, and battery level.
- **Media (MPRIS)**: system media players (Spotify, YouTube Music, and more) with album artwork in the banner and expanded panel, title/artist, and play/pause/previous/next controls.
- **Notifications**: sequential toasts and a scrollable panel list with Clear and click actions. The panel keeps the 50 most recent notifications and batches bursts of updates to keep GNOME Shell responsive.
- **Quick settings**: volume, brightness, Wi-Fi, Bluetooth, dark mode, Night Light, and Do Not Disturb.
- **System actions**: Lock, Suspend, and Power Off, with a two-click confirmation for power-off.
- **Paged panel**: swipe horizontally between **Media / Controls / Notifications**, use the page indicators, or use the keyboard arrow keys.
- **Light/dark theme**: automatically follows GNOME's `color-scheme`.

## How it works

The island has three layers, switched with size and opacity animations:

| State | Behavior |
| --- | --- |
| **Pill** | Idle state: clock, date, battery, and media controls when media is active. |
| **Banner** | A temporary live activity for a notification or newly started media that dismisses itself. |
| **Panel** | Opens with a click or scroll on the center and contains the three swipeable pages. |

## Installation

### Manual installation (recommended for development)

```bash
make install        # copy to ~/.local/share/gnome-shell/extensions and enable it
make restart        # disable, reinstall, and re-enable it (reloads the code)
```

### GNOME Extensions website

_Coming soon: a package published on [extensions.gnome.org](https://extensions.gnome.org)._

## Usage

| Gesture | Action |
| --- | --- |
| Mouse wheel or `scroll` (up/down/left/right) over the pill | Switch the active area (clock / media / notifications) |
| Click the pill | Open the panel |
| `Escape` | Dismiss the banner or panel |
| `Super+Shift+Space` | Play/pause media (global shortcut) |
| Swipe sideways in the panel | Switch page |
| Click a page indicator | Go to that page |
| `←`/`→` arrows (after focusing a panel control) | Switch page |

> The island **never steals keyboard input** from an app. Unlike implementations that focus GNOME Shell and swallow the Space key, keyboard input continues going straight to the app; the island only listens for `Escape` and outside clicks.

## Configuration

Open *Settings → Extensions → Dynamic Island* (or use the gear button). Available preferences include:

- Expanded panel width and pill height
- Toast and media-banner durations
- Show or hide controls, notifications, and media
- Accent color
- Optional animations

## Development

### Layout

```
extension.js   Extension entry point (enable/disable, global keybinding)
island.js      The island: pill, banner, paged panel, and UI
prefs.js       Preferences panel
modules/       Data modules (media.js, controls.js, notifications.js, notifQueue.js)
schemas/       GSettings schema
tests/         Framework-free test suite (runs with plain GJS)
```

### Tests

```bash
gjs -m tests/run.js     # 37 tests: media, notifications, notifQueue, and integration
node --check island.js  # syntax check
```

Tests cover only modules independent from GNOME Shell (`media.js`, `notifications.js`, and `notifQueue.js`). `island.js` and `controls.js` depend on `resource:///org/gnome/shell` and run only inside GNOME Shell.

### CI

`.github/workflows/ci.yml` runs the tests and syntax check on every push and pull request.

## License

Distributed under the **GNU General Public License v3.0**. See [LICENSE](LICENSE).
