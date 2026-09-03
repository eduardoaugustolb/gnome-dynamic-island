# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [6] - 2026-09-02

### Added
- Pill and top-attached Notch appearance modes, selectable exclusively from the preferences.
- Defensive normalization of the appearance mode, falling back to Pill for invalid settings.
- Automated contracts covering the appearance mode, preferences, and notch integration.

### Fixed
- Reduced layout churn during panel expansion by postponing page fitting until the main resize animation completes.
- Preserved independent Clutter transitions when animating different properties on the same actor.
- Prevented media level animations from restarting on every MPRIS update when playback state is unchanged.

## [5] - 2026-08-21

### Added
- Public GitHub repository with CI for tests and syntax checks on every push and pull request.
- README, CONTRIBUTING guide, and GPL-3.0 license.

### Fixed
- Remote MPRIS artwork now downloads through Gio/GVfs into a local cache before being loaded by GNOME Shell, restoring album covers on GNOME 50 where `St.TextureCache.load_uri_async` is unavailable.
- Completed the Island/Panel refactor, including carousel method references, media banner buttons, teardown cleanup, and expanded test contracts.
- Fixed stale panel callbacks that caused `_fitPages` and `_gotoPage` runtime errors after the refactor.
- The media card no longer shows the "Playing/Paused" labels or the "Open" action. Artwork and metadata now have 16 px spacing, and transport controls retain a 1:1 aspect ratio.
- Wi-Fi and Bluetooth temporarily reveal the native top bar on right-click or long-press so their Quick Settings submenus remain available while the top bar is hidden.
- Expanded-player artwork uses GNOME Shell's asynchronous `St.TextureCache`, renders remote MPRIS URLs, and reloads only when the track changes, preventing fallback flicker while art loads.
- The panel carousel no longer passes a `NaN` horizontal translation to Clutter before page width is known, preventing child allocation failures.
- All pill, banner, and panel container shadows were removed to eliminate rectangular compositor artifacts.
- The panel uses a stable height based on the largest visible page, preventing controls and system actions from being clipped while navigating.
- The pill's play/pause icon was replaced by a passive three-bar indicator. It animates from the center during playback and remains static while paused.
- Section headings now use the page's actual width. Notification title/app text and media titles wrap in the expanded panel instead of being ellipsized.
- The Quick Settings grid explicitly recalculates its three columns on each allocation, keeping it aligned after screenshots, overview, or Shell scale changes.
- The carousel no longer uses its intermediate opening width to calculate pages. Control grids and sliders retain their target width without showing part of the next column.
- Scrolling over the pill accepts the mouse wheel and vertical/horizontal touchpad gestures. The handler is also attached directly to the pill actor under the pointer.
- The notifications page reserves header and indicator height before measuring its list. When cards exceed available space, vertical scrolling appears inside the island instead of clipping the list.
- Notification bursts batch visual updates for up to 80 ms, and history is limited to the 50 newest items to avoid GNOME Shell layout spikes.
- The expanded media player uses 80 px album artwork, matching the visual emphasis of the media banner.

## [4] - 2026-08-06

### Added
- Paged navigation in the expanded panel: three pages (**Media / Controls / Notifications**) navigable by horizontal dragging, clickable indicators, and keyboard arrows.
- "Playing/Paused" status in the panel player and a "No active media" empty state.
- The notification list fills its page and scrolls internally; nothing is clipped by the panel edge.

### Fixed
- **Phantom Spotify play/pause when pressing Space**: the island no longer steals an app's keyboard focus. Space now reaches the app intact; the island only listens for `Escape` and outside clicks.
- Removed the media progress bar, replacing it with Playing/Paused status.
- Completed Brazilian Portuguese labels and added two-click confirmation for Power Off.

## [3] - 2026-08-05

### Fixed
- Date positioning in the pill, mirrored to keep the time centered.
- Album artwork via `http(s)://` URLs in addition to `file://`; Spotify artwork now appears.
- Pill-title ellipsizing is limited to the monitor width.

## [2] - 2026-08-04

### Added
- "Open in app" media-player action.
- Two-click confirmation before power-off.
- Scrollable notification list inside the panel.

## [1] - 2026-08-01

### Added
- Initial release: pill with clock/battery, notification toasts, MPRIS media player, and quick controls for volume, brightness, toggles, and system actions.
