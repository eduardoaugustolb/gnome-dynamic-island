UUID     = dynamic-island@eduardoaugustolb
EXT_DIR  = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FILES    = extension.js island.js prefs.js metadata.json stylesheet.css
DIRS     = modules schemas
BACKUP_DIR = $(HOME)/.local/share/dynamic-island-backups
BACKUP_TGZ = $(BACKUP_DIR)/extension-$(shell date +%Y%m%d-%H%M%S).tar.gz

.PHONY: install uninstall enable disable restart clean test check backup restore

test:
	gjs -m tests/run.js

check: test
	node --check extension.js island.js prefs.js modules/*.js
	@echo "check: OK"

# Snapshot do diretório instalado (rollback rápido sem tocar no git).
backup:
	mkdir -p $(BACKUP_DIR)
	@if [ -d $(EXT_DIR) ]; then \
		tar -czf $(BACKUP_TGZ) -C "$(shell dirname $(EXT_DIR))" "$(shell basename $(EXT_DIR))"; \
		echo "Backup criado: $(BACKUP_TGZ)"; \
	else \
		echo "Extensão não está instalada (nada a fazer)."; \
	fi

# Restaura o backup mais recente da extensão instalada.
restore:
	@LATEST=$$(ls -1t $(BACKUP_DIR)/extension-*.tar.gz 2>/dev/null | head -1); \
	if [ -z "$$LATEST" ]; then \
		echo "Nenhum backup em $(BACKUP_DIR)."; \
		exit 1; \
	fi; \
	gnome-extensions disable $(UUID) 2>/dev/null || true; \
	rm -rf $(EXT_DIR); \
	mkdir -p "$(shell dirname $(EXT_DIR))"; \
	tar -xzf $$LATEST -C "$(shell dirname $(EXT_DIR))"; \
	glib-compile-schemas $(EXT_DIR)/schemas; \
	echo "Restaurado de $$LATEST"; \
	gnome-extensions enable $(UUID)

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
