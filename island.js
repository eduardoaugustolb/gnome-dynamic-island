import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Controls} from './modules/controls.js';
import {MediaWatcher} from './modules/media.js';
import {NotificationManager} from './modules/notifications.js';
import {NotifQueue} from './modules/notifQueue.js';

import {Animator, TIMING, MODES} from './core/animator.js';
import {
    clamp,
    clampPillWidth,
    maxPanelHeight,
    panelTargetHeight,
    expandedWidth,
} from './core/layout.js';
import {UiState} from './core/uiState.js';
import {Banner} from './components/Banner.js';
import {Panel} from './components/Panel.js';
import {Pill} from './components/Pill.js';
import {ownIcon} from './core/icons.js';
import {isNotchMode} from './core/displayMode.js';

const STARTUP_GRACE_MS = 3000;
const PILL_MIN_WIDTH = 210;
const PANEL_SIDE_MARGIN = 16;
const SWIPE_THRESHOLD = 36;

const AREA_ORDER = ['media', 'notifications', 'clock'];
const DEFAULT_ACCENT = '#0A84FF';

function hexToRgb(hex) {
    const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex ?? '');
    return match ? match.slice(1).map(value => parseInt(value, 16)) : [20, 20, 22];
}

function rgbaSetting(hex, opacity) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

/* Paleta de accent-color do GNOME 46+ (org.gnome.desktop.interface),
 * usada para a ilha seguir o accent do sistema quando o usuário não
 * personalizou a cor da extensão. */
const SYSTEM_ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a',
    yellow: '#c88800', orange: '#ed5b00', red: '#e62d42',
    pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
};

export const Island = GObject.registerClass(
class Island extends St.Widget {
    _init(extension) {
        super._init({
            name: 'dynamicIsland',
            style_class: 'dynamic-island',
            reactive: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            layout_manager: new Clutter.BinLayout(),
        });

        this._extension = extension;
        this._settings = extension.getSettings();
        let systemAnimations = true;
        try {
            systemAnimations = St.Settings.get().enable_animations;
        } catch (_) {}
        this._animator = new Animator({
            enabled: this._settings.get_boolean('animations') && systemAnimations,
        });
        this._uiState = new UiState('collapsed');
        this._captureId = 0;
        this._notifQueue = new NotifQueue();
        this._bannerKind = null;
        this._bannerHover = false;
        this._bannerCount = 0;
        this._volumeDragging = false;
        this._brightnessDragging = false;
        this._startedAt = 0;
        this._areaId = 'clock';
        this._areaWidgets = {};
        this._pillPress = null;
        this._pillPanAccum = 0;
        this._pillDragCaptureId = 0;
        this._pendingSize = null;
        this._battery = null;
        this._started = false;
        this._revealing = false;
        this._sizeAnimationId = 0;
        this._scrollAccum = 0;
        this._scrollAxis = null;
        this._scrollCooldownId = 0;

        this._controls = new Controls();
        this._media = new MediaWatcher();
        this._notifs = new NotificationManager();

        this._dndSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});

        this._ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._hasSystemAccent =
            this._ifaceSettings.settings_schema.has_key('accent-color');
        if (this._hasSystemAccent) {
            this._ifaceSettings.connectObject('changed::accent-color',
                () => this._panel.applyAccent(), this);
        }

        this._colorProbe = new St.Bin({
            style_class: 'popup-menu-content quick-settings',
            opacity: 0,
            reactive: false,
            x_expand: false,
            y_expand: false,
        });
        this._colorProbe.set_size(1, 1);
        this.add_child(this._colorProbe);

        this._buildPill();
        this._banner = new Banner(this._animator, {
            onActivate: (action) => {
                this._showCollapsed();
                if (action)
                    action();
            },
            onHoverChange: (hover) => {
                this._bannerHover = hover;
                if (hover)
                    this._banner.cancelCollapse();
                else if (this._state === 'banner')
                    this._scheduleBannerCollapse();
            },
        });
        this.add_child(this._banner);
        this._panel = new Panel(this._animator, {
            settings: this._settings,
            controls: this._controls,
            media: this._media,
            notifs: this._notifs,
            notifQueue: this._notifQueue,
            getState: () => this._state,
            isResizing: () => this._revealing,
            expandedWidth: () => this._expandedWidth(),
            maxHeight: () => this._maxHeight(),
            accentColor: () => this._accentColor(),
            resolveAppIcon: (id) => this._resolveAppIcon(id),
            notifIcon: (n) => this._notifIcon(n),
            formatTime: (d) => this._formatTime(d),
            activateNotif: (n) => this._activateNotif(n),
            onCollapse: () => this._showCollapsed(),
            onRefit: () => this._refit(),
        });
        this.add_child(this._panel);

        this._panel.applyAccent();
        this._applyTheme();
        this._syncMotionPreference();
        this.connect('notify::hover', () => {
            // No notch, a Pill ocupa só a largura natural e fica transparente;
            // o feedback de hover precisa ser aplicado à superfície raiz inteira.
            if (isNotchMode(this._settings.get_string('appearance-mode')) &&
                this._state === 'collapsed')
                this._applyShape();
        });

        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'changed', () => this.refreshTheme(), this);

        // Qualquer interação que não seja com a própria ilha (focar
        // outra janela, abrir a Overview, alt-tab...) deve colapsá-la
        // sozinha. O clique-fora via captured-event (_onCapturedEvent)
        // só cobre cliques/toques; isto aqui cobre trocas de foco e
        // navegação por teclado.
        global.display.connectObject('notify::focus-window',
            () => this._onExternalInteraction(), this);
        Main.overview.connectObject('showing',
            () => this._onExternalInteraction(), this);

        this._media.connectObject('changed',
            () => this._onMediaChanged(this._media.info), this);
        this._media.connectObject('playing-started',
            () => this._onMediaStarted(this._media.info), this);

        this._notifs.connectObject('added',
            () => this._onNotificationAdded(this._notifs.getLatest()), this);
        this._notifs.connectObject('updated',
            () => {
                if (this._state === 'panel')
                    this._panel.refreshNotifsDebounced();
            }, this);
        this._notifs.connectObject('removed',
            () => {
                // Uma notificação pode ser destruída (pelo próprio app,
                // por expirar, ou por "Clear") enquanto ainda está
                // esperando na fila de peek — tira ela de lá pra não
                // tentar mostrar algo que não existe mais.
                this._notifQueue.discard(
                    n => !this._notifs.notifications.includes(n));
                if (this._state === 'panel')
                    this._panel.refreshNotifsDebounced();
                if (this._state === 'collapsed' &&
                    this._areaId === 'notifications' &&
                    !this._notifs.getLatest())
                    this._focusArea('clock', 0);
            }, this);

        this._controls.connectObject('volume-changed',
            (_c, ratio, muted) => this._panel.setVolume(ratio, muted), this);
        this._controls.connectObject('brightness-changed',
            (_c, value) => this._panel.setBrightness(value), this);
        this._controls.connectObject('toggle-changed',
            (_c, name, value) => this._panel.setToggle(name, value), this);
        this._controls.connectObject('battery-changed',
            () => this._onBatteryChanged(this._controls.battery), this);

        this._settingsSig = this._settings.connect('changed',
            (_s, key) => this._onSettingChanged(key));

        St.Settings.get().connectObject('notify::color-scheme',
            () => this._applyTheme(), this);
        St.Settings.get().connectObject('notify::enable-animations',
            () => this._syncMotionPreference(), this);

        // O evento normalmente chega na própria pill (o ator sob o cursor),
        // não necessariamente no contêiner raiz. Mantemos também o fallback
        // no raiz para temas/atores filhos que o propaguem diretamente. (A
        // Pill já conecta o próprio scroll-event e o repassa via callback.)
        this.connect('scroll-event', (_a, event) => this._onPillScroll(event));

        this.connect('notify::allocation', () => {
            if (this._pendingSize) {
                const [w, h] = this._pendingSize;
                this._pendingSize = null;
                this.set_size(w, h);
            }
        });

        this.connect('key-press-event', (_a, event) => {
            // Espaço NUNCA deve acionar nada aqui: players como Spotify e
            // YouTube já tratam a tecla nativamente, e interceptá-la —
            // mesmo por acidente, via foco de teclado do Shell preso num
            // botão — era a origem do loop de play/pause (o espaço tocava
            // o player duas vezes: uma do Shell, outra do próprio app).
            if (event.get_key_symbol() === Clutter.KEY_space)
                return Clutter.EVENT_PROPAGATE;
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this._state !== 'collapsed')
                    this._showCollapsed();
                return Clutter.EVENT_STOP;
            }
            // Navegação de páginas por teclado: só responde quando a ilha
            // (ou um descendente, ex.: um dot de indicador) tem o foco de
            // teclado. Com a ilha sem foco as setas passam direto — o app
            // (Spotify seek, cursor de texto etc.) não pode ser roubado.
            if (this._state === 'panel' &&
                event.get_key_symbol() === Clutter.KEY_Right) {
                this._panel.shiftPage(1);
                return Clutter.EVENT_STOP;
            }
            if (this._state === 'panel' &&
                event.get_key_symbol() === Clutter.KEY_Left) {
                this._panel.shiftPage(-1);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    /* ================================================================
     * Construção da UI
     * ================================================================ */

    /* Troca as áreas da pill com a roda comum e com gestos de touchpad.
     * Antes só LEFT/RIGHT e smooth predominantemente horizontal eram
     * aceitos. Na prática, a roda do mouse produz UP/DOWN e todo o gesto
     * vertical era propagado/ignorado — exatamente por isso a navegação
     * documentada não respondia ao passar o cursor sobre a ilha. */
    _onPillScroll(event) {
        if (this._state !== 'collapsed')
            return Clutter.EVENT_PROPAGATE;

        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.LEFT ||
            dir === Clutter.ScrollDirection.DOWN) {
            this._swapAreaDebounced(1);
            return Clutter.EVENT_STOP;
        }
        if (dir === Clutter.ScrollDirection.RIGHT ||
            dir === Clutter.ScrollDirection.UP) {
            this._swapAreaDebounced(-1);
            return Clutter.EVENT_STOP;
        }
        if (dir !== Clutter.ScrollDirection.SMOOTH)
            return Clutter.EVENT_PROPAGATE;

        const [dx, dy] = event.get_scroll_delta();
        const horizontal = Math.abs(dx) > Math.abs(dy);
        const axis = horizontal ? 'x' : 'y';
        const delta = horizontal ? dx : dy;
        const now = Date.now();
        if (axis !== this._scrollAxis || now - (this._lastScrollAt ?? 0) > 400)
            this._scrollAccum = 0;
        this._scrollAxis = axis;
        this._lastScrollAt = now;
        this._scrollAccum += delta;

        // Deltas smooth de touchpad são pequenos; 1.5 exige um gesto
        // intencional sem obrigar o usuário a repetir a rolagem inteira.
        if (Math.abs(this._scrollAccum) >= 1.5) {
            const next = horizontal
                ? this._scrollAccum < 0
                : this._scrollAccum > 0;
            this._swapAreaDebounced(next ? 1 : -1);
            this._scrollAccum = 0;
        }
        return Clutter.EVENT_STOP;
    }

    _buildPill() {
        this._pill = new Pill(this._animator, {
            onScroll: (event) => this._onPillScroll(event),
            onPress: (event) => this._onPillPress(event),
            onDismiss: () => this._showCollapsed(),
        });
        this.add_child(this._pill);
    }


    /* ================================================================
     * Ciclo de vida
     * ================================================================ */

    start() {
        this._startedAt = Date.now();
        this._media.start();
        this._notifs.start(Main.messageTray);
        this._updateClocks();
        this._scheduleClockTick();
        this._panel.syncToggles();
        this._onBatteryChanged(this._controls.battery);
        // Controls() já emite o valor real de volume/brilho no próprio
        // construtor (síncrono para o brilho, já que Main.brightnessManager
        // existe de imediato) — mas isso acontece ANTES de conectarmos os
        // sinais aqui embaixo, então aquela primeira emissão correta se
        // perde e os sliders ficam presos no 0 inicial. Puxamos o valor
        // atual manualmente para não depender de pegar aquele sinal.
        const brightness = this._controls.brightness;
        if (brightness !== null)
            this._panel.setBrightness(brightness);
        const {ratio, muted} = this._controls.volume;
        this._panel.setVolume(ratio, muted);
        this._onMediaChanged(this._media.info);
        // Pré-aquece o conteúdo do painel expandido (layout, fontes, ícones)
        // enquanto ele ainda está invisível, para que a primeira vez que o
        // usuário expandir a ilha não pague esse custo durante a animação
        // (o que causava um engasgo perceptível só na primeira abertura).
        this._panel.updateContent();
        const areas = this._availableAreas();
        this._areaId = areas[0] ?? 'clock';
        this._setArea(this._areaId, 0);
        this._started = true;
        this._pendingSize = [this._measurePillWidth(),
            this._settings.get_int('collapsed-height')];
    }

    destroy() {
        this._clearBannerTimer();
        this._stopClock();
        this._releaseFocus();
        if (this._pillDragCaptureId) {
            global.stage.disconnect(this._pillDragCaptureId);
            this._pillDragCaptureId = 0;
        }
        if (this._scrollCooldownId) {
            GLib.source_remove(this._scrollCooldownId);
            this._scrollCooldownId = 0;
        }
        if (this._settingsSig) {
            this._settings.disconnect(this._settingsSig);
            this._settingsSig = 0;
        }
        St.Settings.get().disconnectObject(this);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        this._ifaceSettings?.disconnectObject(this);
        this._controls?.disconnectObject(this);
        this._media?.disconnectObject(this);
        this._notifs?.disconnectObject(this);
        this._controls?.destroy();
        this._media?.destroy();
        this._notifs?.destroy();
        super.destroy();
    }

    /* ================================================================
     * Estado e animações
     * ================================================================ */

    /* O estado de camada é uma máquina (core/uiState.js): esta getter
     * mantém os ~20 pontos de leitura de `this._state` funcionando
     * enquanto o orquestrador não assume (fase 7); as ESCRITAS passam
     * sempre por _setState, que valida a transição. */
    get _state() {
        return this._uiState.value;
    }

    _setState(next) {
        if (!this._uiState.set(next)) {
            log(`dynamic-island: transição de estado inválida ` +
                `'${this._uiState.value}' → '${next}' ignorada`);
        }
    }

    get expanded() {
        return this._uiState.expanded;
    }

    collapse() {
        this._showCollapsed();
    }

    /* Animações do tamanho e das camadas evitam `scale`: escalar um
     * ator com cantos arredondados/bordas produz artefatos (borda
     * some ou fica borrada) porque o border-radius não escala junto.
     * Em vez disso, o tamanho é animado diretamente e a troca de
     * camada usa opacidade + um leve deslocamento vertical. */

    _animateSize(w, h, spring, onComplete = null) {
        // Um callback de uma animação interrompida não pode liberar flags ou
        // atualizar o estado depois de uma animação mais nova ter começado.
        const animationId = ++this._sizeAnimationId;
        const complete = onComplete ? () => {
            if (animationId === this._sizeAnimationId)
                onComplete();
        } : null;
        this._animator.animate(this, {
            width: w,
            height: h,
        }, {
            duration: spring ? TIMING.expand : TIMING.collapse,
            mode: spring ? MODES.enter : MODES.exit,
            onComplete: complete,
        });
    }

    _swapLayers(show) {
        const layers = {
            pill: this._pill,
            banner: this._banner,
            panel: this._panel,
        };
        for (const [name, layer] of Object.entries(layers)) {
            // O tamanho do contêiner já faz a transição. Um crossfade aqui
            // cria um segundo movimento e expõe frames do painel piscando,
            // especialmente quando a abertura interrompe um recolhimento.
            layer.remove_transition('translation-y');
            layer.remove_transition('opacity');
            layer.translation_y = 0;
            layer.opacity = 255;
            layer.visible = name === show;
        }
        this._applyShape();
    }

    _measurePillWidth() {
        try {
            const natW = this._pill.measureWidth();
            // Texto longo (título de música, app) não pode esticar a pill
            // pra fora da tela: limita a ~45% da largura do monitor e o
            // título elipsiza (ellipsize END já está setado no label). O
            // cap antigo era um max-width fixo de 480px no CSS, que
            // quebrava em monitores pequenos.
            const monitor = Main.layoutManager.primaryMonitor;
            return clampPillWidth(natW, PILL_MIN_WIDTH, monitor?.width ?? 0);
        } catch (_) {
            return PILL_MIN_WIDTH;
        }
    }

    _expandedWidth() {
        const configured = this._settings.get_int('expanded-width');
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor?.width)
            return configured;
        // Mantém uma margem mínima dos dois lados, inclusive quando a
        // preferência foi definida para um monitor maior e a sessão mudou
        // para uma tela menor ou para uma escala fracionária.
        return expandedWidth(configured, monitor.width, PANEL_SIDE_MARGIN);
    }

    _maxHeight() {
        // O painel nunca deve ultrapassar a viewport: reserva 8px do topo
        // (gap da ilha) + uma margem inferior de 40px. Em telas baixas
        // isso encolhe o teto automaticamente; o excesso é absorvido pela
        // lista de notificações, que rola internamente.
        const monitor = Main.layoutManager.primaryMonitor;
        return maxPanelHeight(monitor?.height ?? null);
    }

    _showCollapsed() {
        this._revealing = false;
        this._clearBannerTimer();
        this._banner.clearAction();
        this._bannerKind = null;
        this._setState('collapsed');
        this._panel.endDrag();
        const areas = this._availableAreas();
        if (!areas.includes(this._areaId))
            this._areaId = areas[0];
        this._setArea(this._areaId, 0);
        const w = this._measurePillWidth();
        const h = this._settings.get_int('collapsed-height');
        this._animateSize(w, h, false);
        this._swapLayers('pill');
        this._releaseFocus();
        // Assim que a ilha fica ociosa, se ainda houver notificação
        // esperando na fila, ela assume a vez imediatamente (a troca de
        // animação é cancelada/substituída por _animateSize/_swapLayers
        // logo abaixo, então não há flicker perceptível).
        this._pumpNotifQueue();
    }

    _showBanner(opts) {
        this._clearBannerTimer();
        this._setState('banner');
        this._banner.setAction(opts.action ?? null);
        const w = opts.width ?? 480;
        const h = this._banner.show(opts.child ?? null, w,
            opts.minH ?? 96, opts.maxH ?? 240);
        this._animateSize(w, h, true);
        this._swapLayers('banner');
        if (!opts.persist)
            this._scheduleBannerCollapse(
                opts.duration ?? this._settings.get_int('peek-duration'));
        this._grabFocus();
    }

    _showPanel() {
        if (this._state === 'panel')
            return;
        this._clearBannerTimer();
        this._banner.clearAction();
        this._bannerKind = null;
        this._setState('panel');
        // updateContent() pode alternar a visibilidade dos cards,
        // o que dispara syncPages/onRefit internamente. Nós já vamos medir
        // e animar para o tamanho final logo abaixo, então esse trabalho
        // precoce só serviria pra brigar com a animação de abertura e
        // causar um engasgo na primeira vez. Bloqueado aqui.
        this._revealing = true;
        this._panel.updateContent();
        const w = this._expandedWidth();
        this._panel.visible = true;
        // Mede a página ativa já ciente da largura alvo. Cada área recebe
        // só a altura de que precisa; notificações continuam limitadas e
        // roláveis quando ultrapassam o teto disponível.
        this._panel.fitPages(w);
        this._panel.positionTrack(this._panel.pageIndex, false);
        let h;
        try {
            const [, natH] = this._panel.get_preferred_height(w);
            h = panelTargetHeight(natH, this._maxHeight());
        } catch (_) {
            h = 320;
        }
        this._animateSize(w, h, true, () => {
            this._revealing = false;
        });
        this._swapLayers('panel');
        this._grabFocus();
    }

    _refit() {
        if (this._state !== 'panel' || this._revealing)
            return;
        const w = this._expandedWidth();
        this._panel.fitPages(w);
        let target;
        try {
            const [, natH] = this._panel.get_preferred_height(w);
            target = panelTargetHeight(natH, this._maxHeight());
        } catch (_) {
            return;
        }
        if (Math.abs(this.height - target) > 3) {
            this._animator.animate(this, {
                height: target,
            }, {
                duration: TIMING.panelRefit,
                mode: MODES.settle,
            });
        }
    }

    /* ---------- Captura de estágio ---------- */

    /* Captura de eventos do estágio enquanto a ilha está expandida.
     * De propósito NÃO chamamos grab_key_focus() nem pushModal: qualquer
     * foco de teclado tomado pela ilha faz as teclas do usuário pararem de
     * chegar ao app — era a raiz do "play/pause fantasma" do Spotify, onde
     * o banner de mídia (disparado pelo próprio espaço) roubava o teclado
     * e os comandos seguintes eram engolidos pelo shell. A ilha NUNCA
     * rouba o teclado do app; só escuta (capture phase) cliques fora dela
     * e a tecla Escape pra colapsar, devolvendo tudo o mais pro app. */
    _grabFocus() {
        if (!this._captureId) {
            this._captureId = global.stage.connect(
                'captured-event', (_s, event) => this._onCapturedEvent(event));
        }
    }

    _releaseFocus() {
        if (this._captureId) {
            global.stage.disconnect(this._captureId);
            this._captureId = 0;
        }
        // Se um clique do usuário deixou o foco de teclado preso em algum
        // descendente (ex: um St.Button do painel), devolve pra ninguém
        // (null) pra próxima tecla voltar a ir pro app normalmente.
        const focus = global.stage.key_focus;
        if (focus === this || (focus && this.contains(focus)))
            global.stage.set_key_focus(null);
    }

    _onExternalInteraction() {
        if (this._state !== 'collapsed')
            this._showCollapsed();
    }

    _onCapturedEvent(event) {
        // Escape fecha a ilha expandida sem precisar de foco de teclado.
        // Espaço e todas as outras teclas passam direto — o app (Spotify,
        // YouTube etc.) precisa continuar recebendo o teclado intacto.
        if (event.type() === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape &&
                this._state !== 'collapsed') {
                this._showCollapsed();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (event.type() !== Clutter.EventType.BUTTON_PRESS &&
            event.type() !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        const [sx, sy] = event.get_coords();
        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        const inside = sx >= x && sx <= x + w && sy >= y && sy <= y + h;
        if (!inside && this._state !== 'collapsed')
            this._showCollapsed();
        return Clutter.EVENT_PROPAGATE;
    }

    /* ---------- Timer de banner ---------- */

    _scheduleBannerCollapse(ms = this._settings.get_int('peek-duration')) {
        this._banner.scheduleCollapse(ms, () => {
            if (this._state !== 'banner' || this._bannerHover)
                return;
            // Ainda tem notificação esperando: troca de conteúdo em vez
            // de recolher e reabrir (ver _pumpNotifQueue/_presentNotifBanner).
            if (this._bannerKind === 'notif' && this._notifQueue.size > 0)
                this._pumpNotifQueue();
            else
                this._showCollapsed();
        });
    }

    _clearBannerTimer() {
        this._banner?.cancelCollapse();
    }

    /* ================================================================
     * Relógio
     * ================================================================ */

    _scheduleClockTick() {
        this._stopClock();
        const now = Date.now();
        const delay = Math.max(20, 60000 - (now % 60000));
        this._clockTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._clockTimer = 0;
            this._updateClocks();
            this._scheduleClockTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopClock() {
        if (this._clockTimer) {
            GLib.source_remove(this._clockTimer);
            this._clockTimer = 0;
        }
    }

    _updateClocks() {
        const now = new Date();
        this._clockTime = now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
        this._headerDate = now.toLocaleDateString([], {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        });
        const day = now.getDate();
        const month = now.toLocaleDateString([], {month: 'long'});
        const monthShort = month.length <= 5
            ? month
            : month.slice(0, 3);
        this._clockDate = `${day} ${monthShort}`;
        this._panel.setClock(this._clockTime, this._headerDate);
        if (this._areaId === 'clock') {
            this._pill.setClock(this._clockTime, this._clockDate);
        }
    }

    /* ================================================================
     * Mídia
     * ================================================================ */

    _onMediaChanged(info) {
        this._mediaInfo = info;
        this._updatePillMedia(info);
        if (this._state === 'panel') {
            this._panel.updateMedia(info);
        } else if (this._state === 'collapsed') {
            const active = !!(info && (info.playing || info.paused));
            if (!active && this._areaId === 'media') {
                const areas = this._availableAreas();
                this._focusArea(areas[0] ?? 'clock', -1);
            } else if (active && this._areaId === 'media') {
                this._setArea('media', 0);
            } else if (active && this._areaId !== 'media' &&
                this._settings.get_boolean('show-media') &&
                Date.now() - this._startedAt < STARTUP_GRACE_MS) {
                // A extensão acabou de iniciar e a MediaWatcher só descobriu
                // o player tocando de forma assíncrona (após o start()),
                // então 'playing-started' pode não ter disparado a tempo.
                this._focusArea('media', 1);
            }
        }
    }

    /* Chamado pelo keybinding global (Super+Shift+Space, ver
     * extension.js) — o único caminho de teclado pra play/pause agora,
     *; os controles do painel permanecem navegáveis por foco quando o
     * usuário já entrou na superfície. */
    toggleMediaPlayPause() {
        this._media.playPause();
    }

    _onMediaStarted(info) {
        if (!this._settings.get_boolean('show-media'))
            return;
        this._mediaInfo = info;
        this._updatePillMedia(info);
        if (this._state !== 'collapsed')
            return;
        // Estilo "Live Activity" do iOS: a ilha abre mostrando a capa e
        // os controles por alguns segundos e depois assenta na pill
        // compacta em modo mídia, onde permanece enquanto tocar.
        const child = this._buildMediaBanner(info);
        this._focusArea('media', 1);
        this._bannerKind = 'media';
        this._showBanner({
            child,
            width: this._expandedWidth(),
            minH: 96,
            maxH: 220,
            duration: this._settings.get_int('media-banner-duration'),
            action: () => this._showPanel(),
        });
    }

    _updatePillMedia(info) {
        this._mediaInfo = info;
        const active = !!(info && (info.playing || info.paused));
        this._pill.setLevels(active && !!info.playing);
        if (this._state === 'collapsed' && this._areaId === 'media') {
            this._pill.setTitle(info?.title || '');
            this._refitPill();
        }
    }

    /* ================================================================
     * Áreas da ilha (estilo Apple)
     * ================================================================ */

    _availableAreas() {
        const areas = [];
        if (this._settings.get_boolean('show-media')) {
            const info = this._media.info;
            if (info && (info.playing || info.paused))
                areas.push('media');
        }
        if (this._settings.get_boolean('show-notifications') &&
            this._notifs.getLatest())
            areas.push('notifications');
        areas.push('clock');
        return areas;
    }

    _focusArea(id, dir = 0) {
        if (!this._availableAreas().includes(id))
            return;
        if (id === this._areaId) {
            this._setArea(id, dir);
            return;
        }
        this._setArea(id, dir);
    }

    _swapArea(delta) {
        const areas = this._availableAreas();
        if (areas.length < 2)
            return;
        const idx = areas.indexOf(this._areaId);
        const next = (idx + delta + areas.length) % areas.length;
        this._setArea(areas[next], delta);
    }

    /* Evita que um único gesto de scroll/arraste dispare várias trocas
     * de área em sequência (o que parecia um "glitch" de tela piscando
     * rapidamente). Depois de trocar, ignora novas trocas por um
     * instante para deixar o gesto atual terminar. */
    _swapAreaDebounced(delta) {
        if (this._scrollCooldownId)
            return;
        this._swapArea(delta);
        this._scrollCooldownId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 280, () => {
                this._scrollCooldownId = 0;
                return GLib.SOURCE_REMOVE;
            });
    }

    _setArea(id, dir = 0) {
        const showMedia = this._settings.get_boolean('show-media');
        const showNotifs = this._settings.get_boolean('show-notifications');

        if (id === 'media') {
            if (!showMedia)
                id = 'clock';
        } else if (id === 'notifications') {
            if (!showNotifs || !this._notifs.getLatest())
                id = 'clock';
        }

        if (id === 'media') {
            const info = this._media.info;
            const art = this._resolveArt(info);
            const gicon = art ?? this._resolveAppIcon(info.icon);
            this._pill.showMediaArea(info, gicon, !!art);
        } else if (id === 'notifications') {
            const notif = this._notifs.getLatest();
            this._pill.showNotifArea(notif, this._notifIcon(notif));
        } else {
            // Lado esquerdo visível: agora carrega a data (a bateria fica
            // à direita), o que mantém o horário centrado na pill.
            this._pill.showClockArea(this._clockTime ?? '',
                this._clockDate ?? '',
                !!this._battery &&
                    this._settings.get_boolean('show-battery'));
        }

        this._areaId = id;

        if (dir)
            this._pill.slide(dir);

        if (this._started)
            this._refitPill();
    }

    /* ---------- Pressionar / arrastar a pill ---------- */

    _onPillPress(event) {
        if (event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._pillPress = {x, y, startedAt: Date.now()};
        this._pillPanAccum = 0;
        if (!this._pillDragCaptureId) {
            this._pillDragCaptureId = global.stage.connect(
                'captured-event', (_s, ev) => this._onPillDragEvent(ev));
        }
        return Clutter.EVENT_STOP;
    }

    _onPillDragEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            if (!this._pillPress)
                return Clutter.EVENT_PROPAGATE;
            // Segurança: se por qualquer motivo perdemos o BUTTON_RELEASE
            // (ex.: consumido por outro handler), o botão 1 não vai mais
            // aparecer no estado do evento de motion. Sem isso, o
            // "arrasto" ficava preso e qualquer movimento do mouse pela
            // tela — mesmo só passando por cima da pill, sem clicar —
            // era interpretado como troca de área.
            const state = event.get_state();
            if (!(state & Clutter.ModifierType.BUTTON1_MASK)) {
                this._endPillDrag();
                return Clutter.EVENT_PROPAGATE;
            }
            // Watchdog: mais de 4s "arrastando" é sinal de estado preso.
            if (Date.now() - this._pillPress.startedAt > 4000) {
                this._endPillDrag();
                return Clutter.EVENT_PROPAGATE;
            }
            const [x] = event.get_coords();
            const dx = x - this._pillPress.x;
            this._pillPanAccum = dx;
            if (this._state === 'collapsed' &&
                Math.abs(dx) > SWIPE_THRESHOLD) {
                this._swapAreaDebounced(dx < 0 ? 1 : -1);
                this._pillPress.x = x;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._endPillDrag();
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _endPillDrag() {
        if (this._pillDragCaptureId) {
            global.stage.disconnect(this._pillDragCaptureId);
            this._pillDragCaptureId = 0;
        }
        const wasClick = this._pillPress &&
            Math.abs(this._pillPanAccum) <= 6;
        this._pillPress = null;
        if (wasClick && this._state === 'collapsed')
            this._showPanel();
    }

    _updatePillNotifs() {
        if (this._state === 'collapsed' && this._areaId === 'notifications') {
            const notif = this._notifs.getLatest();
            this._pill.updateNotif(notif, this._notifIcon(notif));
        }
    }


    _buildMediaBanner(info) {
        const box = new St.BoxLayout({
            style_class: 'island-banner-inner',
            vertical: false,
        });
        const art = new St.Icon({
            style_class: 'island-banner-art',
            icon_size: 44,
            gicon: this._resolveArt(info) ??
                this._resolveAppIcon(info.icon) ??
                Gio.ThemedIcon.new('multimedia-player-symbolic'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        const text = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const title = new St.Label({
            text: info.title || 'Título desconhecido',
            style_class: 'island-banner-title',
        });
        const artist = new St.Label({
            text: info.artist || info.album || '',
            style_class: 'island-banner-subtitle',
            visible: !!(info.artist || info.album),
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        text.add_child(artist);

        const controls = new St.BoxLayout({
            style_class: 'island-banner-controls',
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const bannerPrevBtn = this._makeIconButton(
            'media-skip-backward-symbolic', 'Anterior', 18,
            (e) => this._consumeBannerClick(() => this._media.previous(), e));
        bannerPrevBtn.can_focus = true;
        controls.add_child(bannerPrevBtn);
        const bannerPlayBtn = this._makeIconButton(
            info.playing
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic',
            'Reproduzir/Pausar', 22,
            (e) => this._consumeBannerClick(() => this._media.playPause(), e));
        bannerPlayBtn.style_class += ' island-play-button';
        bannerPlayBtn.can_focus = true;
        controls.add_child(bannerPlayBtn);
        const bannerNextBtn = this._makeIconButton(
            'media-skip-forward-symbolic', 'Próxima', 18,
            (e) => this._consumeBannerClick(() => this._media.next(), e));
        bannerNextBtn.can_focus = true;
        controls.add_child(bannerNextBtn);

        box.add_child(art);
        box.add_child(text);
        box.add_child(controls);
        return box;
    }

    _makeIconButton(iconName, accessibleName, iconSize = 20, callback) {
        const button = new St.Button({
            style_class: 'island-icon-button',
            child: ownIcon(iconName, iconSize),
            reactive: true,
            can_focus: true,
            accessible_name: accessibleName,
            tooltip_text: accessibleName,
        });
        button.connect('clicked', callback);
        return button;
    }

    _consumeBannerClick(callback) {
        this._banner.clearAction();
        callback();
    }

    _resolveAppIcon(desktopId) {
        if (!desktopId)
            return null;
        try {
            const app = Gio.DesktopAppInfo.new(`${desktopId}.desktop`);
            if (app?.get_icon())
                return app.get_icon();
        } catch (_) {}
        return null;
    }

    _resolveArt(info) {
        // Mesmo caminho usado pelo banner de início de mídia: St.Icon
        // recebe o Gio.FileIcon diretamente.
        try {
            if (info?.artUrl)
                return Gio.FileIcon.new(Gio.File.new_for_uri(info.artUrl));
        } catch (_) {}
        return null;
    }


    /* ================================================================
     * Notificações
     * ================================================================ */

    _onNotificationAdded(notif) {
        if (!this._settings.get_boolean('show-notifications'))
            return;
        if (this._isDnd()) {
            if (this._state === 'panel')
                this._panel.refreshNotifsDebounced();
            return;
        }
        if (this._state === 'panel') {
            // Painel já aberto: a notificação já aparece ao vivo na
            // lista rolável, não precisa de peek — não entra na fila.
            this._panel.refreshNotifsDebounced();
            return;
        }
        this._updatePillNotifs();
        // Nunca mostra a notificação na hora se já tem uma janela
        // ('banner') sendo exibida — entra na fila e espera a vez, pra
        // nenhuma notificação ser "engolida" por chegar perto de outra.
        this._notifQueue.push(notif);
        this._pumpNotifQueue();
    }

    /* Orquestra a amostragem sequencial das notificações: mostra uma de
     * cada vez, na ordem de chegada. Avança quando a ilha volta a ficar
     * ociosa (ver _showCollapsed) OU, se já tem outro peek de
     * notificação na tela, troca o conteúdo no lugar (crossfade do
     * Banner) em vez de esperar recolher e reabrir. Nenhuma notificação
     * empilhada aqui é descartada. */
    _pumpNotifQueue() {
        const safeToAdvance = this._state === 'collapsed' ||
            (this._state === 'banner' && this._bannerKind === 'notif');
        if (!safeToAdvance)
            return;
        const notif = this._notifQueue.next();
        if (!notif)
            return;
        this._presentNotifBanner(notif);
    }

    _presentNotifBanner(notif) {
        // Com mais gente esperando na fila, cada notificação fica um
        // tempo mais curto na tela (troca mais rápido, tipo pilha de
        // notificação do iOS/Android) — só a última da leva usa a
        // duração cheia configurada em peek-duration.
        const dwell = this._notifQueue.size > 0
            ? Math.min(this._settings.get_int('peek-duration'), 2200)
            : this._settings.get_int('peek-duration');
        const child = this._buildNotificationBanner(notif);
        const width = this._measureNotifBannerWidth(child);
        const action = () => this._activateNotif(notif);

        if (this._state === 'banner' && this._bannerKind === 'notif') {
            this._banner.setAction(action);
            this._banner.crossfade(child, width,
                (h) => this._animateSize(width, h, true),
                () => this._scheduleBannerCollapse(dwell));
        } else {
            this._bannerKind = 'notif';
            this._showBanner({child, width, duration: dwell, action, minH: 76});
        }
    }

    // O banner de notificação não usa mais a largura cheia do painel
    // (expanded-width) — fica só do tamanho que o conteúdo precisa
    // (com limites razoáveis), pra não sobrar um espaço enorme dos
    // lados quando o texto é curto.
    _measureNotifBannerWidth(child) {
        let natW;
        try {
            [, natW] = child.get_preferred_width(-1);
        } catch (_) {
            natW = 320;
        }
        const cap = Math.min(this._expandedWidth(), 440);
        return clamp(natW, Math.min(240, cap), cap);
    }

    _isDnd() {
        try {
            return !this._dndSettings.get_boolean('show-banners');
        } catch (_) {
            return false;
        }
    }

    _buildNotificationBanner(notif) {
        const box = new St.BoxLayout({
            style_class: 'island-banner-inner',
            vertical: false,
        });

        const icon = new St.Icon({
            style_class: 'island-banner-appicon',
            icon_size: 34,
            gicon: this._notifIcon(notif),
            // Alinhado ao topo com a primeira linha de texto (app+hora),
            // como o toast do iOS — centrado verticalmente parecia solto
            // quando o corpo quebrava em linhas extras.
            y_align: Clutter.ActorAlign.START,
        });

        const text = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const meta = new St.BoxLayout({vertical: false});
        const appName = new St.Label({
            text: notif.source?.title ?? 'Notificação',
            style_class: 'island-banner-app',
            x_expand: true,
        });
        const time = new St.Label({
            text: this._formatTime(notif.datetime ?? new Date()),
            style_class: 'island-banner-time',
        });
        meta.add_child(appName);
        meta.add_child(time);

        const title = new St.Label({
            text: notif.title ?? '',
            style_class: 'island-banner-title',
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        text.add_child(meta);
        text.add_child(title);
        if (notif.body) {
            // Corpo é UM bloco contínuo com clamp de 2 linhas — não duas
            // linhas independentes truncadas. O texto usa toda a largura
            // disponível e só trunca no limite de 2 linhas.
            const body = new St.Label({
                text: notif.body,
                style_class: 'island-banner-subtitle',
            });
            body.clutter_text.line_wrap = true;
            body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            body.clutter_text.max_lines = 2;
            body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(body);
        }

        const dismiss = new St.Button({
            style_class: 'island-icon-button island-banner-dismiss',
            child: ownIcon('close', 16),
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Dispensar notificação',
            tooltip_text: 'Dispensar notificação',
        });
        dismiss.connect('clicked', () => {
            this._showCollapsed();
        });

        box.add_child(icon);
        box.add_child(text);
        box.add_child(dismiss);
        return box;
    }

    _notifIcon(notif) {
        try {
            if (notif.gicon)
                return notif.gicon;
            if (notif.source?.getIcon)
                return notif.source.getIcon();
            if (notif.source?.icon)
                return notif.source.icon;
        } catch (_) {}
        return Gio.ThemedIcon.new('dialog-information-symbolic');
    }

    _formatTime(date) {
        if (!date)
            return '';
        if (typeof date.format === 'function') {
            try { return date.format('%H:%M'); } catch (_) {}
        }
        if (typeof date.toLocaleTimeString === 'function') {
            return date.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
        }
        return '';
    }

    _activateNotif(notif) {
        try {
            if (typeof notif.activate === 'function')
                notif.activate();
        } catch (e) {
            logError(e, 'dynamic-island:activate');
        }
    }



    _onBatteryChanged(battery) {
        this._battery = battery;
        const enabled = this._settings.get_boolean('show-battery');
        const show = this._state === 'collapsed' && this._areaId === 'clock';
        this._pill.setBattery(battery, enabled && show);
        if (show && battery && enabled)
            this._refitPill();
    }

    _refitPill() {
        if (this._state !== 'collapsed')
            return;
        const w = this._measurePillWidth();
        const h = this._settings.get_int('collapsed-height');
        if (Math.abs(this.width - w) > 3 || Math.abs(this.height - h) > 3) {
            this._animator.animate(this, {
                width: w,
                height: h,
            }, {
                duration: TIMING.pillRefit,
                mode: MODES.settle,
            });
        }
    }

    /* ================================================================
     * Preferências
     * ================================================================ */

    _accentColor() {
        const custom = this._settings.get_string('accent-color');
        if (custom && custom !== DEFAULT_ACCENT)
            return custom;
        if (this._hasSystemAccent) {
            const name = this._ifaceSettings.get_string('accent-color');
            if (SYSTEM_ACCENTS[name])
                return SYSTEM_ACCENTS[name];
        }
        return custom || DEFAULT_ACCENT;
    }

    _applyTheme() {
        const dark = Main.getStyleVariant() === 'dark';
        this.remove_style_class_name('island-dark');
        this.remove_style_class_name('island-light');
        this.add_style_class_name(dark ? 'island-dark' : 'island-light');
        this._applyShape();
    }

    /* Painel real do Quick Settings nativo (Main.panel.statusArea.quickSettings
     * .menu.box), que tem as classes 'popup-menu-content quick-settings' —
     * exatamente o que os temas do usuário (via extensão User Themes)
     * costumam estilizar de forma mais distinta (ex.: AMOLED preto puro).
     * Usar o ator real, já presente na cena, garante fidelidade total ao
     * tema ativo, sem depender de adivinhar seletores CSS. */
    _quickSettingsBox() {
        try {
            return Main.panel.statusArea.quickSettings?.menu?.box ?? null;
        } catch (_) {
            return null;
        }
    }

    _probeBackground(actor) {
        if (!actor || !actor.get_stage())
            return null;
        try {
            return actor.get_theme_node().get_background_color();
        } catch (_) {
            return null;
        }
    }

    /* Sonda a cor de fundo real do tema Shell atual. Tenta primeiro o
     * painel de verdade do Quick Settings; se não estiver disponível,
     * cai para um ator sintético com as mesmas classes CSS. Assim, num
     * tema AMOLED preto puro a ilha fica preta de verdade em vez de
     * usar o cinza fixo padrão. */
    _nativeColors() {
        if (!this.get_stage())
            return null;
        const bg = this._probeBackground(this._quickSettingsBox()) ??
            this._probeBackground(this._colorProbe);
        if (!bg || bg.alpha < 10)
            return null;
        const dark = Main.getStyleVariant() === 'dark';
        const alpha = Math.max(0.82, bg.alpha / 255).toFixed(3);
        return {
            bg: `rgba(${bg.red}, ${bg.green}, ${bg.blue}, ${alpha})`,
            border: dark
                ? 'rgba(255, 255, 255, 0.14)'
                : 'rgba(0, 0, 0, 0.10)',
        };
    }

    refreshTheme() {
        this._applyShape();
    }

    _lighten(rgba, amount) {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba);
        if (!m)
            return rgba;
        const clamp = v => Math.min(255, Math.max(0, v));
        const [, r, g, b, a] = m;
        return `rgba(${clamp(+r + amount)}, ${clamp(+g + amount)}, ` +
            `${clamp(+b + amount)}, ${a})`;
    }

    _applyShape() {
        const h = this._settings.get_int('collapsed-height');
        const r = this._settings.get_int('corner-radius');
        const opacity = this._settings.get_int('background-opacity');
        const borderOpacity = this._settings.get_int('border-opacity');
        const shadow = this._settings.get_boolean('shadow-enabled')
            ? `box-shadow: 0 8px 28px rgba(0, 0, 0, ${
                this._settings.get_int('shadow-opacity') / 100});`
            : 'box-shadow: none;';
        const scale = this._settings.get_int('text-scale');
        const spacing = this._settings.get_int('content-spacing');
        const pillBg = rgbaSetting(this._settings.get_string('pill-background'), opacity);
        const panelBg = rgbaSetting(this._settings.get_string('panel-background'), opacity);
        const border = rgbaSetting(this._settings.get_string('border-color'), borderOpacity);
        const notch = isNotchMode(this._settings.get_string('appearance-mode'));
        this.remove_style_class_name('appearance-pill');
        this.remove_style_class_name('appearance-notch');
        this.add_style_class_name(notch ? 'appearance-notch' : 'appearance-pill');
        const common = `background-image: none; border-color: ${border}; ${shadow}` +
            ` font-size: ${13 * scale / 100}px; font-family: ${
                this._settings.get_string('font-family')};`;
        const surface = this._state === 'collapsed' ? pillBg : panelBg;
        const rootHover = notch && this._state === 'collapsed' && this.hover;
        const displayedSurface = rootHover ? this._lighten(pillBg, 12) : surface;
        const radius = this._state === 'collapsed'
            ? (notch ? `0 0 ${Math.floor(h / 2)}px ${Math.floor(h / 2)}px` :
                `${Math.floor(h / 2)}px`)
            : (notch ? `0 0 ${r}px ${r}px` : `${r}px`);
        const surfaceStyle = `border-radius: ${radius}; ` +
            `background-color: ${displayedSurface}; ` +
            'transition-property: background-color; transition-duration: 180ms; ' +
            common;
        this.set_style(surfaceStyle);
        const baseStyle = `border-radius: ${Math.floor(h / 2)}px; ` +
            'background-color: transparent; border-color: transparent; ' +
            'box-shadow: none;';
        const hoverStyle = `border-radius: ${Math.floor(h / 2)}px; ` +
            `background-color: ${this._lighten(pillBg, 12)}; ${common}`;
        this._pill.setStyles(baseStyle, hoverStyle);
        this._banner.set_style(`background-color: transparent; border-color: transparent; ` +
            `box-shadow: none; border-radius: ${r}px;`);
        this._panel.set_style(`background-color: transparent; border-color: transparent; ` +
            `box-shadow: none; border-radius: ${r}px; -st-spacing: ${spacing}px;`);
    }

    _onSettingChanged(key) {
        if (key === 'animations') {
            this._syncMotionPreference();
        } else if (key === 'accent-color') {
            this._panel.applyAccent();
        } else if (key === 'show-controls') {
            if (this._state === 'panel')
                this._panel.updateContent();
        } else if (key === 'show-notifications') {
            if (this._state === 'panel')
                this._panel.updateContent();
        } else if (key === 'expanded-width') {
            if (this._state === 'panel') {
                const w = this._expandedWidth();
                this._panel.fitPages(w);
                this._panel.positionTrack(this._panel.pageIndex, false);
                try {
                    const [, naturalHeight] = this._panel.get_preferred_height(w);
                    this._animateSize(w,
                        panelTargetHeight(naturalHeight, this._maxHeight()),
                        false);
                } catch (_) {}
            }
        } else if (key === 'appearance-mode') {
            this._applyShape();
            if (this._state === 'collapsed')
                this._refitPill();
        } else if (['pill-background', 'panel-background', 'background-opacity',
            'border-opacity', 'shadow-enabled', 'shadow-opacity', 'text-scale',
            'font-family', 'border-color', 'content-spacing', 'corner-radius'].includes(key)) {
            this._applyShape();
        } else if (key === 'collapsed-height') {
            this._applyShape();
            if (this._state === 'collapsed')
                this._refitPill();
        } else if (key === 'page-order' || key.startsWith('show-')) {
            if (this._state === 'panel')
                this._panel.updateContent();
        }
    }

    _syncMotionPreference() {
        let systemAnimations = true;
        try {
            systemAnimations = St.Settings.get().enable_animations;
        } catch (_) {}
        const enabled = this._settings.get_boolean('animations') && systemAnimations;
        this._animator.setEnabled(enabled);
        if (enabled)
            this.remove_style_class_name('motion-reduced');
        else
            this.add_style_class_name('motion-reduced');
    }
});
