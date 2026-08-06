# Contributing

Thank you for contributing to **Dynamic Island**. This guide is intentionally short and practical.

## Getting started

1. Clone the repository and install it for development:

   ```bash
   make install    # install and enable
   make restart    # reload the code after changes
   ```

2. Run the test suite and syntax check after every change:

   ```bash
   gjs -m tests/run.js
   node --check island.js extension.js prefs.js modules/*.js
   ```

## Contribution expectations

- **Keep changes focused**: prefer small pull requests with one clear purpose.
- **Code comments**: existing code comments are in Brazilian Portuguese. Keep that convention unless the related code is being translated as part of a dedicated change.
- **Tests**: when changing `modules/media.js`, `modules/notifications.js`, or `modules/notifQueue.js`, add or update tests under `tests/`.
- **Avoid unnecessary dependencies**: the extension must run with what GNOME Shell already provides.
- **Do not break app keyboard input**: the island must **never** steal an app's keyboard focus. Changes that reintroduce `grab_key_focus()` or `pushModal` for keyboard interaction will be rejected.

## Testing behavior

- The extension works only inside a real GNOME Shell session (Wayland or X11). `tests/` covers only Shell-independent modules.
- Useful manual tests include pressing `Space` while Spotify is playing (it must not pause accidentally), switching panel pages, dragging sliders, and scrolling the notification list without switching pages.

## Pull request process

1. Run `git pull` from `main` before you start.
2. Create a descriptive branch, such as `fix/phantom-play-pause` or `feat/notifications-page`.
3. Use a clear commit message consistent with the repository style.
4. Open a pull request; CI runs tests and syntax checks automatically.
5. Describe what changed and how you tested it.
