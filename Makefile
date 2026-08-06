UUID     = dynamic-island@eduardoaugustolb
EXT_DIR  = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FILES    = extension.js island.js prefs.js metadata.json stylesheet.css
DIRS     = modules schemas

.PHONY: install uninstall enable disable restart clean test

test:
	gjs -m tests/run.js

install: uninstall
	mkdir -p $(EXT_DIR)
	cp -r $(FILES) $(DIRS) $(EXT_DIR)/
	glib-compile-schemas $(EXT_DIR)/schemas
	gnome-extensions enable $(UUID)
	@echo "Instalado em $(EXT_DIR)"

uninstall:
	gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(EXT_DIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

restart: disable install enable

clean:
	rm -rf $(EXT_DIR)
