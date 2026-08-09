import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {Controls} from './modules/controls.js';
import {MediaWatcher} from './modules/media.js';
import {NotificationManager} from './modules/notifications.js';
import {NotifQueue} from './modules/notifQueue.js';

import {Animator, TIMING, MODES} from './core/animator.js';
import {
    clamp,
    clampPillWidth,
    maxPanelHeight,
    panelInnerWidth,
    carouselTrackWidth,
    pageShift,
    panelChromeHeight,
    maxPageHeight,
    clampPageHeight,
    panelTargetHeight,
    controlCellWidth,
} from './core/layout.js';
import {UiState} from './core/uiState.js';
import {Banner} from './components/Banner.js';

const STARTUP_GRACE_MS = 3000;
const PILL_MIN_WIDTH = 210;
const SWIPE_THRESHOLD = 36;
const PAGE_SWIPE_THRESHOLD = 56;
const NOTIF_REFRESH_DELAY_MS = 80;
const CONTROL_GRID_COLUMNS = 3;
const CONTROL_GRID_GAP = 8;
const DEVICE_MENU_HOLD_MS = 450;

/* Áreas do painel expandido, em ordem: cada uma é uma "página" horizontal
 * deslizável dentro da ilha (ver _buildPanel). A navegação por arrastar/
 * indicadores/setas nunca disputa com sliders, botões ou a rolagem vertical
 * da lista de notificações. */
const PAGE_COUNT = 3;
const PAGE_LABELS = ['Mídia', 'Controles', 'Notificações'];

const AREA_ORDER = ['media', 'notifications', 'clock'];
const DEFAULT_ACCENT = '#0A84FF';

/* Paleta de accent-color do GNOME 46+ (org.gnome.desktop.interface),
 * usada para a ilha seguir o accent do sistema quando o usuário não
 * personalizou a cor da extensão. */
const SYSTEM_ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a',
    yellow: '#c88800', orange: '#ed5b00', red: '#e62d42',
    pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
};

const TOGGLES = [
    {name: 'wifi', label: 'Wi-Fi', icon: 'network-wireless-symbolic'},
    {name: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth-active-symbolic'},
    {name: 'dark', label: 'Modo escuro', icon: 'dark-mode-symbolic'},
    {name: 'night', label: 'Luz noturna', icon: 'night-light-symbolic'},
    {name: 'dnd', label: 'Não perturbe', icon: 'notifications-disabled-symbolic'},
];

const POWER_ACTIONS = [
    {name: 'lock', label: 'Bloquear', icon: 'system-lock-screen-symbolic'},
    {name: 'suspend', label: 'Suspender', icon: 'weather-clear-night-symbolic'},
    {name: 'power', label: 'Desligar', icon: 'system-shutdown-symbolic'},
];

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
        this._animator = new Animator({
            enabled: this._settings.get_boolean('animations'),
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
        this._scrollAccum = 0;
        this._scrollAxis = null;
        this._scrollCooldownId = 0;
        this._pageIndex = 1;
        this._lastPage = null;
        this._pageDrag = null;
        this._notifRefreshId = 0;

        this._controls = new Controls();
        this._media = new MediaWatcher();
        this._notifs = new NotificationManager();

        this._dndSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});

        this._ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._hasSystemAccent =
            this._ifaceSettings.settings_schema.has_key('accent-color');
        if (this._hasSystemAccent) {
            this._ifaceSettings.connectObject('changed::accent-color',
                () => this._applyAccent(), this);
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
        this._buildPanel();

        this._applyAccent();
        this._applyTheme();

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
        this._notifs.connectObject('removed',
            () => {
                // Uma notificação pode ser destruída (pelo próprio app,
                // por expirar, ou por "Clear") enquanto ainda está
                // esperando na fila de peek — tira ela de lá pra não
                // tentar mostrar algo que não existe mais.
                this._notifQueue.discard(
                    n => !this._notifs.notifications.includes(n));
                if (this._state === 'panel')
                    this._queuePanelNotifsRefresh();
                if (this._state === 'collapsed' &&
                    this._areaId === 'notifications' &&
                    !this._notifs.getLatest())
                    this._focusArea('clock', 0);
            }, this);

        this._controls.connectObject('volume-changed',
            (_c, ratio, muted) => this._onVolumeChanged(ratio, muted), this);
        this._controls.connectObject('brightness-changed',
            (_c, value) => this._onBrightnessChanged(value), this);
        this._controls.connectObject('toggle-changed',
            (_c, name, value) => this._onToggleChanged(name, value), this);
        this._controls.connectObject('battery-changed',
            () => this._onBatteryChanged(this._controls.battery), this);

        this._settingsSig = this._settings.connect('changed',
            (_s, key) => this._onSettingChanged(key));

        St.Settings.get().connectObject('notify::color-scheme',
            () => this._applyTheme(), this);

        // O evento normalmente chega na própria pill (o ator sob o cursor),
        // não necessariamente no contêiner raiz. Mantemos também o fallback
        // no raiz para temas/atores filhos que o propaguem diretamente.
        this.connect('scroll-event', (_a, event) => this._onPillScroll(event));
        this._pill.connect('scroll-event',
            (_a, event) => this._onPillScroll(event));

        this.connect('notify::allocation', () => {
            if (this._pendingSize) {
                const [w, h] = this._pendingSize;
                this._pendingSize = null;
                this.set_size(w, h);
            }
            // Depois que a alocação assenta na largura final, as páginas
            // são refeitas com a largura interna real (o cálculo inicial
            // em _fitPages usa a largura alvo menos o padding do CSS).
            if (this._state === 'panel' && this._pagesTrack &&
                this._pageWidth > 0 &&
                Math.abs(this._pagesViewport.width - this._pageWidth) > 1) {
                this._fitPages();
                this._positionTrack(this._pageIndex, false);
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
                this._shiftPage(1);
                return Clutter.EVENT_STOP;
            }
            if (this._state === 'panel' &&
                event.get_key_symbol() === Clutter.KEY_Left) {
                this._shiftPage(-1);
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
        const box = new St.BoxLayout({
            style_class: 'island-pill-content',
            vertical: false,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        this._pillLeft = new St.BoxLayout({
            style_class: 'island-pill-side',
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._mediaIcon = new St.Icon({
            style_class: 'island-pill-icon',
            icon_size: 16,
            visible: false,
        });
        this._pillLeft.add_child(this._mediaIcon);

        this._pillClock = new St.Label({
            style_class: 'island-clock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            text: '',
        });

        this._pillRight = new St.BoxLayout({
            style_class: 'island-pill-side',
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        /* Ícone + percentual formam UM componente (o "indicador de
         * bateria"), com espaçamento interno bem menor que o espaço
         * entre componentes — para não parecerem dois elementos soltos
         * tão separados quanto bateria↔data. */
        this._batteryGroup = new St.BoxLayout({
            style_class: 'island-battery-group',
            vertical: false,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._batteryIcon = new St.Icon({
            style_class: 'island-pill-icon',
            icon_size: 16,
        });
        this._batteryLabel = new St.Label({
            style_class: 'island-pill-battery',
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._batteryGroup.add_child(this._batteryIcon);
        this._batteryGroup.add_child(this._batteryLabel);
        this._pillDate = new St.Label({
            style_class: 'island-pill-date',
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        /* Data no lado ESQUERDO, bateria no DIREITO: espelha os pesos e
         * mantém o horário centrado de verdade na pill (com a data à
         * direita junto da bateria, o lado direito ficava ~50px mais
         * pesado e a hora deslocava pra esquerda do centro óptico). */
        this._pillLeft.add_child(this._pillDate);
        this._pillRight.add_child(this._batteryGroup);

        // Indicador passivo de reprodução: a pill não oferece controle de
        // mídia por clique, então os símbolos play/pause pareciam um botão
        // quebrado. Três barras animadas comunicam estado sem sugerir ação.
        this._pillMediaLevels = new St.BoxLayout({
            style_class: 'island-media-levels',
            vertical: false,
            reactive: false,
            accessible_name: 'Indicador de reprodução',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillMediaBars = [];
        for (let i = 0; i < 3; i++) {
            const bar = new St.Widget({
                style_class: 'island-media-level',
                reactive: false,
                y_align: Clutter.ActorAlign.CENTER,
            });
            // scale_y com pivot no centro faz a barra crescer para cima e
            // para baixo simultaneamente, sem parecer um equalizador preso
            // à base.
            bar.set_pivot_point(0.5, 0.5);
            this._pillMediaBars.push(bar);
            this._pillMediaLevels.add_child(bar);
        }
        this._setPillMediaLevels(false);
        this._pillRight.add_child(this._pillMediaLevels);

        this._pillDismissBtn = new St.Button({
            style_class: 'island-icon-button island-pill-control',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 16,
            }),
            reactive: true,
            can_focus: true,
            accessible_name: 'Dispensar',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillDismissBtn.connect('clicked',
            () => this._showCollapsed());
        this._pillRight.add_child(this._pillDismissBtn);

        box.add_child(this._pillLeft);
        box.add_child(this._pillClock);
        box.add_child(this._pillRight);

        this._pillClock.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._pill = new St.Widget({
            style_class: 'island-pill',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            x_expand: true,
            y_expand: true,
        });
        this._pillBox = box;
        this._pill.add_child(box);
        this._pill.connect('button-press-event',
            (_a, event) => this._onPillPress(event));
        this._pill.connect('notify::hover', () => {
            if (!this._pillHoverStyle)
                return;
            this._pill.set_style(this._pill.hover
                ? this._pillHoverStyle : this._pillBaseStyle);
        });

        this.add_child(this._pill);
    }

    _buildPanel() {
        this._panel = new St.BoxLayout({
            style_class: 'island-panel',
            vertical: true,
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
            visible: false,
            opacity: 0,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        /* ---------- Header ---------- */
        this._header = new St.BoxLayout({
            style_class: 'island-header',
            vertical: false,
        });
        const headerCol = new St.BoxLayout({
            style_class: 'island-header-col',
            vertical: true,
            x_expand: true,
        });
        this._headerTime = new St.Label({
            style_class: 'island-header-time',
            text: '',
            x_align: Clutter.ActorAlign.START,
        });
        this._headerDate = new St.Label({
            style_class: 'island-header-date',
            text: '',
            x_align: Clutter.ActorAlign.START,
        });
        headerCol.add_child(this._headerTime);
        headerCol.add_child(this._headerDate);

        this._collapseBtn = new St.Button({
            style_class: 'island-icon-button island-collapse',
            child: new St.Icon({
                icon_name: 'pan-down-symbolic',
                icon_size: 16,
            }),
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Recolher',
        });
        this._collapseBtn.connect('clicked', () => this._showCollapsed());

        this._header.add_child(headerCol);
        this._header.add_child(this._collapseBtn);

        /* ---------- Páginas (Mídia / Controles / Notificações) ----------
         * Em vez de empilhar todas as seções numa coluna única (que
         * disputava altura com a lista de notificações e estourava a
         * viewport), o painel agora é um carrossel horizontal: cada área
         * tem uma página própria com altura natural, e a lista de
         * notificações ocupa a página inteira (rolável). */
        this._pagesViewport = new St.Widget({
            style_class: 'island-pages-viewport',
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._pagesTrack = new St.BoxLayout({
            style_class: 'island-pages-track',
            vertical: false,
            // x_expand fica DESLIGADO de propósito: o BinLayout do viewport
            // daria ao track a largura do viewport (e apertaria as páginas
            // em PAGE_COUNT fatias). Com largura natural = soma das páginas
            // (definida no _fitPages), o track estoura pra fora e o
            // translateX desloca de "página" em "página".
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._pagesViewport.add_child(this._pagesTrack);

        this._mediaPage = this._buildMediaPage();
        this._controlsPage = this._buildControlsPage();
        this._notifsPage = this._buildNotifsPage();
        this._pages = [this._mediaPage, this._controlsPage, this._notifsPage];
        for (const page of this._pages) {
            page.x_expand = true;
            page.y_expand = true;
            page.clip_to_allocation = true;
            this._pagesTrack.add_child(page);
        }

        /* ---------- Indicadores de página ---------- */
        this._pageIndicators = new St.BoxLayout({
            style_class: 'island-page-indicators',
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._pageDots = [];
        for (let i = 0; i < PAGE_COUNT; i++) {
            const dot = new St.Button({
                style_class: 'island-page-dot',
                reactive: true,
                can_focus: true,
                accessible_name: PAGE_LABELS[i],
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            dot.connect('clicked', () => this._gotoPage(i));
            this._pageDots.push(dot);
            this._pageIndicators.add_child(dot);
        }

        this._panel.add_child(this._header);
        this._panel.add_child(this._pagesViewport);
        this._panel.add_child(this._pageIndicators);
        this.add_child(this._panel);
        this._panel.connect('button-press-event',
            (_a, e) => this._onPagePress(e));
    }

    _buildMediaPage() {
        const page = new St.BoxLayout({
            style_class: 'island-page island-media-page island-content',
            vertical: true,
            x_expand: true,
        });

        this._mediaCard = new St.BoxLayout({
            style_class: 'island-card island-media-card',
            vertical: true,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const mediaTop = new St.BoxLayout({
            style_class: 'island-media-top',
            vertical: false,
        });
        // St.Icon não renderiza de modo confiável algumas URLs remotas de
        // capa MPRIS. Este holder recebe a textura assíncrona da capa.
        this._mediaArt = new St.Widget({
            style_class: 'island-media-art',
            layout_manager: new Clutter.BinLayout(),
            width: 80,
            height: 80,
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const mediaText = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._mediaText = mediaText;
        this._mediaTitle = new St.Label({
            style_class: 'island-media-title',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        this._mediaTitle.clutter_text.line_wrap = true;
        this._mediaTitle.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._mediaTitle.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._mediaArtist = new St.Label({
            style_class: 'island-media-artist',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        mediaText.add_child(this._mediaTitle);
        mediaText.add_child(this._mediaArtist);

        mediaTop.add_child(this._mediaArt);
        mediaTop.add_child(mediaText);

        const mediaCtrls = new St.BoxLayout({
            style_class: 'island-media-controls',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._mediaPrevBtn = this._makeIconButton(
            'media-skip-backward-symbolic', 'Anterior', 18,
            () => this._media.previous());
        this._mediaPlayBtn = this._makeIconButton(
            'media-playback-start-symbolic', 'Reproduzir/Pausar', 22,
            () => this._media.playPause());
        this._mediaPlayBtn.style_class += ' island-play-button';
        // Sem foco de teclado para Espaço não brigar com o atalho nativo
        // do player.
        this._mediaPlayBtn.can_focus = false;
        this._mediaPrevBtn.can_focus = false;
        this._mediaNextBtn = this._makeIconButton(
            'media-skip-forward-symbolic', 'Próxima', 18,
            () => this._media.next());
        this._mediaNextBtn.can_focus = false;
        mediaCtrls.add_child(this._mediaPrevBtn);
        mediaCtrls.add_child(this._mediaPlayBtn);
        mediaCtrls.add_child(this._mediaNextBtn);

        this._mediaCard.add_child(mediaTop);
        this._mediaCard.add_child(mediaCtrls);

        this._mediaEmpty = new St.Label({
            text: 'Nenhuma mídia ativa',
            style_class: 'island-media-empty',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        page.add_child(this._mediaCard);
        page.add_child(this._mediaEmpty);
        return page;
    }

    _buildControlsPage() {
        const page = new St.BoxLayout({
            style_class: 'island-page island-controls-page island-content',
            vertical: true,
            x_expand: true,
        });

        this._controlsSection = new St.BoxLayout({
            style_class: 'island-section',
            vertical: true,
            x_expand: true,
        });
        this._controlsTitle = new St.Label({
            style_class: 'island-section-title',
            text: 'Controles rápidos',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        this._controlsTitle.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._controlsSection.add_child(this._controlsTitle);

        /* Volume */
        this._volumeIcon = new St.Icon({
            style_class: 'island-slider-icon',
            icon_size: 20,
            icon_name: 'audio-volume-medium-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._volumeSlider = new Slider(0);
        this._volumeSlider.accessible_name = 'Volume';
        this._volumeSlider.connect('notify::value',
            () => this._onVolumeSliderChanged());
        this._volumeSlider.connect('drag-begin',
            () => (this._volumeDragging = true));
        this._volumeSlider.connect('drag-end',
            () => (this._volumeDragging = false));
        this._volumeLabel = new St.Label({
            style_class: 'island-slider-value',
            text: '',
        });
        this._volumeRow = this._makeSliderRow(
            this._volumeIcon, this._volumeSlider, this._volumeLabel);
        this._volumeRow.connect('button-press-event', (_a, e) => {
            if (e.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            this._controls.toggleMute();
            return Clutter.EVENT_STOP;
        });
        this._controlsSection.add_child(this._volumeRow);

        /* Brilho */
        this._brightnessIcon = new St.Icon({
            style_class: 'island-slider-icon',
            icon_size: 20,
            icon_name: 'display-brightness-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._brightnessSlider = new Slider(0);
        this._brightnessSlider.accessible_name = 'Brilho';
        this._brightnessSlider.connect('notify::value',
            () => this._onBrightnessSliderChanged());
        this._brightnessSlider.connect('drag-begin',
            () => (this._brightnessDragging = true));
        this._brightnessSlider.connect('drag-end',
            () => (this._brightnessDragging = false));
        this._brightnessLabel = new St.Label({
            style_class: 'island-slider-value',
            text: '',
        });
        this._brightnessRow = this._makeSliderRow(
            this._brightnessIcon, this._brightnessSlider,
            this._brightnessLabel);
        this._controlsSection.add_child(this._brightnessRow);

        /* Grade 3+2 de controles rápidos: Wi-Fi, Bluetooth, Modo escuro,
         * Luz noturna, Não perturbe — células iguais de 3 colunas, como
         * o Quick Settings nativo. A última linha fica com 2 células (a
         * lacuna é preenchida com um slot vazio pra manter a proporção). */
        this._toggleButtons = {};
        this._controlsSection.add_child(this._buildControlsGrid());

        // Ações de sistema ficam em seção PRÓPRIA, separada dos toggles:
        // bloquear/suspender/desligar não são estados contínuos como Wi-Fi
        // ou modo escuro, e desligar em particular é uma ação de alta
        // consequência que não pode parecer mais um toggle comum.
        this._systemSection = this._buildSystemActions();

        page.add_child(this._controlsSection);
        page.add_child(this._systemSection);
        return page;
    }

    _buildNotifsPage() {
        const page = new St.BoxLayout({
            style_class: 'island-page island-notifs-page island-content',
            vertical: true,
            x_expand: true,
        });

        const notifHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._notifHeader = notifHeader;
        this._notifTitle = new St.Label({
            style_class: 'island-section-title',
            text: 'Notificações',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._notifTitle.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._notifClearBtn = new St.Button({
            style_class: 'island-notif-clear',
            label: 'Limpar',
            reactive: true,
            can_focus: true,
            visible: false,
            accessible_name: 'Limpar notificações',
        });
        this._notifClearBtn.connect('clicked', () => {
            this._notifQueue.clear();
            this._notifs.clearAll();
        });
        notifHeader.add_child(this._notifTitle);
        notifHeader.add_child(this._notifClearBtn);

        // A lista é a única área que rola verticalmente dentro da página;
        // a página inteira tem a altura da viewport (definida em
        // _fitPages), então mesmo com muitas notificações nada é cortado.
        this._notifScroll = new St.ScrollView({
            style_class: 'island-notif-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            y_expand: true,
        });
        this._notifList = new St.BoxLayout({
            style_class: 'island-notif-list',
            vertical: true,
            x_expand: true,
        });
        this._notifScroll.set_child(this._notifList);

        page.add_child(notifHeader);
        page.add_child(this._notifScroll);
        return page;
    }

    _makeSliderRow(icon, slider, label) {
        const row = new St.Widget({
            style_class: 'island-slider-row',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        const box = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Coluna fixa pro ícone (o glyph muda com o volume/estado, mas a
        // largura não pode) + slider ocupando o espaço flexível + valor
        // alinhado à direita em largura fixa. Assim as duas linhas
        // (volume/brilho) ficam alinhadas e o slider não "pula" quando o
        // percentual muda entre "7%" e "100%".
        icon.x_expand = false;
        slider.x_expand = true;
        label.x_expand = false;
        label.x_align = Clutter.ActorAlign.END;
        box.add_child(icon);
        box.add_child(slider);
        box.add_child(label);
        row.add_child(box);
        return row;
    }

    _makeIconButton(iconName, accessibleName, iconSize = 20, callback) {
        const btn = new St.Button({
            style_class: 'island-icon-button',
            child: new St.Icon({icon_name: iconName, icon_size: iconSize}),
            reactive: true,
            can_focus: true,
            accessible_name: accessibleName,
        });
        btn.connect('clicked', callback);
        return btn;
    }

    _buildToggle(def) {
        const btn = new St.Button({
            style_class: 'island-toggle',
            toggle_mode: true,
            checked: false,
            reactive: true,
            can_focus: true,
            x_expand: true,
        });
        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        box.add_child(new St.Icon({icon_name: def.icon, icon_size: 20}));
        box.add_child(new St.Label({
            text: def.label,
            style_class: 'island-toggle-label',
        }));
        btn.set_child(box);
        btn.connect('clicked', () => {
            if (btn._suppressToggle) {
                btn._suppressToggle = false;
                return;
            }
            const next = !this._controls.getToggle(def.name);
            this._controls.setToggle(def.name, next);
        });
        if (def.name === 'wifi' || def.name === 'bluetooth')
            this._addDeviceMenuGesture(btn, def.name);
        return btn;
    }

    /* Toque rápido preserva o toggle. Clique direito ou pressionar por
     * 450 ms abre o submenu NATIVO do Quick Settings: assim a ilha ganha
     * redes/dispositivos, área rolável e "Mais configurações" sem duplicar
     * nem assumir a autenticação de Wi-Fi/Bluetooth do Shell. */
    _addDeviceMenuGesture(button, type) {
        let holdId = 0;
        let opened = false;
        const cancelHold = () => {
            if (holdId) {
                GLib.source_remove(holdId);
                holdId = 0;
            }
        };
        button.connect('button-press-event', (_a, event) => {
            const mouseButton = event.get_button();
            if (mouseButton === 3) {
                cancelHold();
                button._suppressToggle = true;
                this._openNativeDeviceMenu(type);
                return Clutter.EVENT_STOP;
            }
            if (mouseButton !== 1)
                return Clutter.EVENT_PROPAGATE;
            opened = false;
            cancelHold();
            holdId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                DEVICE_MENU_HOLD_MS, () => {
                    holdId = 0;
                    opened = true;
                    button._suppressToggle = true;
                    this._openNativeDeviceMenu(type);
                    return GLib.SOURCE_REMOVE;
                });
            return Clutter.EVENT_PROPAGATE;
        });
        button.connect('button-release-event', () => {
            cancelHold();
            // Se o botão foi segurado, o clicked subsequente é ignorado
            // pelo handler acima; no próximo clique curto ele volta a
            // alternar normalmente.
            if (!opened)
                button._suppressToggle = false;
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _openNativeDeviceMenu(type) {
        // network.js e bluetooth.js do próprio Shell já mantêm a lista de
        // redes/dispositivos, conexão, pareamento, rolagem e o link para o
        // painel de configurações. Abrir esse menu evita duas fontes de
        // verdade e mantém inclusive diálogos de senha/polkit corretos.
        this._showCollapsed();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                const quickSettings = Main.panel.statusArea.quickSettings;
                const toggle = type === 'wifi'
                    ? quickSettings?._network?._wirelessToggle
                    : quickSettings?._bluetooth?.quickSettingsItems?.find(
                        item => item?.menu);
                if (!quickSettings?.menu || !toggle?.menu)
                    return GLib.SOURCE_REMOVE;
                // A extensão pode esconder a barra superior. Nesse caso o
                // menu nativo existe, mas o ator-pai está invisível e nada
                // é desenhado. Revelamos a barra somente enquanto o menu
                // estiver aberto e a ocultamos de novo no fechamento.
                const panelBox = Main.layoutManager.panelBox;
                const restoreHiddenPanel = !panelBox.visible &&
                    this._settings.get_boolean('hide-top-bar');
                if (restoreHiddenPanel) {
                    panelBox.show();
                    const signalId = quickSettings.menu.connect(
                        'open-state-changed', (_menu, isOpen) => {
                            if (isOpen)
                                return;
                            quickSettings.menu.disconnect(signalId);
                            if (this._settings.get_boolean('hide-top-bar'))
                                panelBox.hide();
                        });
                }
                quickSettings.menu.open();
                toggle.menu.open();
            } catch (e) {
                logError(e, 'dynamic-island:device-menu');
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildPowerCell(def) {
        const btn = new St.Button({
            style_class: 'island-toggle island-system-action' +
                (def.name === 'power' ? ' island-power-action' : ''),
            reactive: true,
            can_focus: true,
            x_expand: true,
        });
        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        box.add_child(new St.Icon({icon_name: def.icon, icon_size: 20}));
        const label = new St.Label({
            text: def.label,
            style_class: 'island-toggle-label',
        });
        box.add_child(label);
        btn.set_child(box);

        // Desligar é uma ação de alta consequência: o primeiro clique só
        // "arma" o botão (pede confirmação na própria célula), e um
        // segundo clique dentro de 2,5s executa. Qualquer outro clique
        // desarma de volta.
        if (def.name === 'power') {
            let armed = false;
            let timer = 0;
            btn.connect('clicked', () => {
                if (!armed) {
                    armed = true;
                    label.text = 'Confirmar?';
                    btn.set_style(
                        'background-color: rgba(255, 69, 58, 0.22);');
                    timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
                        timer = 0;
                        armed = false;
                        if (btn.get_stage()) {
                            label.text = def.label;
                            btn.set_style('');
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                    return;
                }
                if (timer) {
                    GLib.source_remove(timer);
                    timer = 0;
                }
                this._onPowerAction(def.name);
            });
        } else {
            btn.connect('clicked', () => this._onPowerAction(def.name));
        }
        return btn;
    }

    /* Grade de controles rápidos em 3 colunas — SÓ os toggles de estado
     * contínuo (Wi-Fi, Bluetooth, modo escuro, luz noturna, DND). As
     * ações de sistema (bloquear, suspender, desligar) vivem em seção
     * própria (ver _buildSystemActions). */
    _buildControlsGrid() {
        const grid = new St.BoxLayout({
            style_class: 'island-toggles',
            vertical: true,
            x_expand: true,
        });
        this._toggleRows = [];
        for (let i = 0; i < TOGGLES.length; i += CONTROL_GRID_COLUMNS) {
            const row = new St.BoxLayout({
                style_class: 'island-toggle-row',
                vertical: false,
                x_expand: true,
            });
            for (const def of TOGGLES.slice(i, i + CONTROL_GRID_COLUMNS)) {
                const cell = this._buildToggle(def);
                this._toggleButtons[def.name] = cell;
                row.add_child(cell);
            }
            // Slot vazio pra linha "raggada" (2 células) manter a mesma
            // proporção de 1/3 das linhas cheias.
            while (row.get_n_children() < CONTROL_GRID_COLUMNS)
                row.add_child(new St.Widget({x_expand: true}));
            this._toggleRows.push(row);
            grid.add_child(row);
        }
        return grid;
    }

    /* Ações de sistema: Bloquear / Suspender / Desligar, numa linha de 3
     * células visualmente distintas dos toggles acima. */
    _buildSystemActions() {
        const section = new St.BoxLayout({
            style_class: 'island-section',
            vertical: true,
            x_expand: true,
        });
        const title = new St.Label({
            style_class: 'island-section-title',
            text: 'Ações do sistema',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._systemTitle = title;
        section.add_child(title);
        const row = new St.BoxLayout({
            style_class: 'island-toggle-row',
            vertical: false,
            x_expand: true,
        });
        for (const def of POWER_ACTIONS)
            row.add_child(this._buildPowerCell(def));
        this._powerRow = row;
        section.add_child(row);
        return section;
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
        this._syncToggles();
        this._onBatteryChanged(this._controls.battery);
        // Controls() já emite o valor real de volume/brilho no próprio
        // construtor (síncrono para o brilho, já que Main.brightnessManager
        // existe de imediato) — mas isso acontece ANTES de conectarmos os
        // sinais aqui embaixo, então aquela primeira emissão correta se
        // perde e os sliders ficam presos no 0 inicial. Puxamos o valor
        // atual manualmente para não depender de pegar aquele sinal.
        const brightness = this._controls.brightness;
        if (brightness !== null)
            this._onBrightnessChanged(brightness);
        const {ratio, muted} = this._controls.volume;
        this._onVolumeChanged(ratio, muted);
        this._onMediaChanged(this._media.info);
        // Pré-aquece o conteúdo do painel expandido (layout, fontes, ícones)
        // enquanto ele ainda está invisível, para que a primeira vez que o
        // usuário expandir a ilha não pague esse custo durante a animação
        // (o que causava um engasgo perceptível só na primeira abertura).
        this._updatePanelContent();
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
        if (this._notifRefreshId) {
            GLib.source_remove(this._notifRefreshId);
            this._notifRefreshId = 0;
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

    _animateSize(w, h, spring) {
        this._animator.animate(this, {
            width: w,
            height: h,
        }, {
            duration: spring ? TIMING.expand : TIMING.collapse,
            mode: spring ? MODES.easeOutQuint : MODES.easeInOutQuad,
        });
    }

    _swapLayers(show) {
        const anim = this._animator.enabled;
        const layers = {
            pill: this._pill,
            banner: this._banner,
            panel: this._panel,
        };
        for (const [name, layer] of Object.entries(layers)) {
            if (name === show) {
                layer.visible = true;
                if (anim && layer.opacity < 255) {
                    layer.translation_y = -5;
                    this._animator.animate(layer, {
                        opacity: 255,
                        translation_y: 0,
                    }, {
                        delay: TIMING.swapLayerDelay,
                        duration: TIMING.swapLayerFade,
                        mode: MODES.easeOutQuad,
                    });
                } else {
                    layer.opacity = 255;
                    layer.translation_y = 0;
                }
            } else {
                this._animator.animate(layer, {
                    opacity: 0,
                    translation_y: -3,
                }, {
                    duration: anim ? TIMING.fade : 0,
                    mode: MODES.easeOutQuad,
                    onComplete: () => {
                        if (this._state !== name)
                            layer.visible = false;
                        layer.translation_y = 0;
                    },
                });
            }
        }
    }

    _measurePillWidth() {
        try {
            const [, natW] = this._pill.get_preferred_width(-1);
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

    _maxHeight() {
        // O painel nunca deve ultrapassar a viewport: reserva 8px do topo
        // (gap da ilha) + uma margem inferior de 40px. Em telas baixas
        // isso encolhe o teto automaticamente; o excesso é absorvido pela
        // lista de notificações, que rola internamente.
        const monitor = Main.layoutManager.primaryMonitor;
        return maxPanelHeight(monitor?.height ?? null);
    }

    _showCollapsed() {
        this._clearBannerTimer();
        this._banner.clearAction();
        this._bannerKind = null;
        this._setState('collapsed');
        this._endPageDrag();
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
        // _updatePanelContent() pode alternar a visibilidade dos cards,
        // o que dispara _syncPages/_refit internamente. Nós já vamos medir
        // e animar para o tamanho final logo abaixo, então esse trabalho
        // precoce só serviria pra brigar com a animação de abertura e
        // causar um engasgo na primeira vez. Bloqueado aqui.
        this._revealing = true;
        this._updatePanelContent();
        this._revealing = false;
        const w = this._settings.get_int('expanded-width');
        this._panel.visible = true;
        // Mede a página ativa já ciente da largura alvo. Cada área recebe
        // só a altura de que precisa; notificações continuam limitadas e
        // roláveis quando ultrapassam o teto disponível.
        this._fitPages(w);
        this._positionTrack(this._pageIndex, false);
        let h;
        try {
            const [, natH] = this._panel.get_preferred_height(w);
            h = panelTargetHeight(natH, this._maxHeight());
        } catch (_) {
            h = 320;
        }
        this._animateSize(w, h, true);
        this._swapLayers('panel');
        this._grabFocus();
    }

    /* Responsividade vertical: o viewport das páginas recebe somente a
     * altura que sobra DEPOIS do header, indicadores, espaçamentos e padding
     * do painel. Antes ele podia receber _maxHeight inteiro; o painel então
     * era cortado por fora e o ScrollView nunca era alocado menor que sua
     * lista. Com uma alocação real e limitada, a lista de notificações rola
     * dentro da ilha em vez de expandir a ilha indefinidamente. */
    _fitPages(width) {
        if (this._state !== 'panel')
            return;
        // A animação abre a ilha a partir da largura da pill. Ler
        // pagesViewport.width durante essa animação alternava a largura do
        // track entre valores intermediários e deixava grids/controles
        // calculados para uma página maior que o recorte (o card seguinte
        // aparecia cortado na direita). A geometria do carrossel usa sempre
        // a largura-alvo estável; o parâmetro existe só para a abertura e
        // mudanças explícitas de preferência.
        const w = width ?? this._settings.get_int('expanded-width');
        const inner = panelInnerWidth(w);
        this._pageWidth = inner;
        // Cada página tem a largura exata do viewport (e o track, PAGE_COUNT
        // vezes ela): o deslize anda de "página" em "página" com largura
        // fixa, não pela largura natural de cada conteúdo.
        this._pagesTrack.width = carouselTrackWidth(inner, PAGE_COUNT);
        for (const page of this._pages)
            page.width = inner;
        this._fitPageLabels(inner);
        this._fitControlGrid(inner);
        // Altura estável: usa a maior página visível para não recortar os
        // controles ao alternar o carrossel.
        let pageH = 0;
        for (const page of this._pages) {
            if (!page.visible)
                continue;
            try {
                const [, naturalHeight] = page.get_preferred_height(inner);
                pageH = Math.max(pageH, naturalHeight);
            } catch (_) {
                // Mantém a maior medida disponível.
            }
        }
        let headerH = 0;
        let indicatorsH = 0;
        try { [, headerH] = this._header.get_preferred_height(inner); } catch (_) {}
        try { [, indicatorsH] = this._pageIndicators.get_preferred_height(inner); } catch (_) {}
        // 32px de padding vertical do painel + dois espaços de 16px entre
        // header/páginas/indicadores (valores de .island-panel no CSS).
        const panelChrome = panelChromeHeight(headerH, indicatorsH);
        const maxPageH = maxPageHeight(this._maxHeight(), panelChrome);
        pageH = clampPageHeight(pageH, maxPageH);
        if (this._pagesViewport.height !== pageH)
            this._pagesViewport.height = pageH;
        this._positionTrack(this._pageIndex, false);
    }

    /* St.BoxLayout não mantém uma fração fixa para filhos x_expand quando
     * recebe uma nova alocação durante transições do Shell (screenshot,
     * overview, mudança de escala). Ele podia atribuir toda a largura ao
     * primeiro toggle e deixar os seguintes fora do viewport. A grade tem
     * sempre três colunas, então definimos as larguras de forma explícita. */
    _fitControlGrid(width) {
        if (!this._toggleRows || !this._powerRow)
            return;
        const cellWidth = controlCellWidth(width, {
            columns: CONTROL_GRID_COLUMNS,
            gap: CONTROL_GRID_GAP,
        });
        const fitRow = row => {
            row.width = width;
            for (const child of row.get_children()) {
                child.x_expand = false;
                child.width = cellWidth;
            }
        };
        for (const row of this._toggleRows)
            fitRow(row);
        fitRow(this._powerRow);
    }

    /* Labels de seção não podem ficar só com sua largura natural: em
     * BoxLayout vertical, isso fazia o Pango elipsizar "Notificações" e
     * "Controles rápidos" apesar de a página ter espaço livre. Reservamos
     * explicitamente a largura interna da página; no cabeçalho de
     * notificações descontamos apenas o botão Limpar quando ele existe. */
    _fitPageLabels(width) {
        if (this._controlsSection) {
            this._controlsSection.width = width;
            this._controlsTitle.width = width;
        }
        if (this._systemSection) {
            this._systemSection.width = width;
            this._systemTitle.width = width;
        }
        if (this._notifHeader) {
            this._notifHeader.width = width;
            let clearWidth = 0;
            if (this._notifClearBtn.visible) {
                try {
                    [, clearWidth] = this._notifClearBtn.get_preferred_width(-1);
                } catch (_) {}
            }
            this._notifTitle.width = Math.max(1, width - clearWidth);
            this._notifScroll.width = width;
        }
    }

    /* Posiciona o track: a página ativa encosta na borda esquerda do
     * viewport (translateX = -100% × índice). Com animação, o track
     * desliza; sem, salta direto. Também marca o indicador ativo. */
    _positionTrack(index, animate = true) {
        if (!this._pagesTrack)
            return;
        index = clamp(index, 0, PAGE_COUNT - 1);
        this._pageIndex = index;
        // Durante a construção e a primeira alocação do Shell ainda não há
        // largura de página. Nunca passe NaN para Clutter: uma única
        // translation_x inválida impede a alocação dos filhos, incluindo a
        // textura da capa do álbum.
        const pageWidth = Number.isFinite(this._pageWidth)
            ? this._pageWidth
            : 0;
        const shift = pageShift(pageWidth, index);
        this._animator.animate(this._pagesTrack, {
            translation_x: shift,
        }, {
            duration: animate && this._animator.enabled
                ? TIMING.pageSwipe
                : 0,
            mode: MODES.easeOutCubic,
        });
        for (let i = 0; i < PAGE_COUNT; i++) {
            const dot = this._pageDots[i];
            dot.checked = i === index;
        }
        this._lastPage = index;
    }

    _gotoPage(index, animate = true) {
        this._positionTrack(index, animate);
    }

    /* Páginas navegáveis no momento: espelha exatamente a visibilidade das
     * páginas. Mídia está sempre lá — mostra o card quando há player ativo
     * ou o empty state "Nenhuma mídia ativa"; Controles e Notificações
     * respeitam seus toggles nas preferências. */
    _availablePages() {
        const avail = [0];
        if (this._settings.get_boolean('show-controls'))
            avail.push(1);
        if (this._settings.get_boolean('show-notifications'))
            avail.push(2);
        return avail;
    }

    /* Sincroniza páginas/dots com o que está disponível e garante que o
     * índice atual nunca aponte pra uma página que sumiu. Chamado sempre
     * que o conteúdo muda (mídia inicia/para, toggle de seção, notifs). */
    _syncPages() {
        if (!this._pagesTrack)
            return;
        const avail = this._availablePages();
        for (let i = 0; i < PAGE_COUNT; i++) {
            const ok = avail.includes(i);
            this._pages[i].visible = ok;
            this._pageDots[i].visible = ok;
        }
        // Se a página atual sumiu (mídia parou, seção desligada), sai dela
        // antes de posicionar o track — nunca fica num vazio.
        if (!avail.includes(this._pageIndex))
            this._pageIndex = avail.length > 0 ? avail[0] : 0;
        this._positionTrack(this._pageIndex, false);
        this._fitPages();
        this._refit();
    }

    /* Tecla de seta (ver key-press-event): troca pra página vizinha que
     * existir. */
    _shiftPage(delta) {
        const avail = this._availablePages();
        const idx = avail.indexOf(this._pageIndex);
        if (idx === -1)
            return;
        const next = avail[idx + delta];
        if (next !== undefined)
            this._gotoPage(next);
    }

    /* Arrastar horizontal dentro do painel: segue o dedo/mouse deslocando
     * o track e, soltando além do limiar, completa a troca de página.
     * Nunca disputa com sliders, botões nem com a rolagem vertical da
     * lista — o gesto só começa onde a origem não é um desses (ver
     * _onPagePress). */
    _applyPageDrag(dx, complete) {
        const pageWidth = Number.isFinite(this._pageWidth)
            ? this._pageWidth
            : 0;
        const base = pageShift(pageWidth, this._pageIndex);
        if (!complete) {
            // Arrasto "elástico": o track não pode sair além de meia página
            // pra cada lado, senão mostra um vazio branco além da última.
            const clamped = clamp(dx, -pageWidth * 0.5,
                pageWidth * 0.5);
            this._pagesTrack.remove_all_transitions();
            this._pagesTrack.translation_x = base + clamped;
            return;
        }
        const avail = this._availablePages();
        const idx = avail.indexOf(this._pageIndex);
        let target = this._pageIndex;
        if (dx < -PAGE_SWIPE_THRESHOLD) {
            const next = avail[idx + 1];
            if (next !== undefined)
                target = next;
        } else if (dx > PAGE_SWIPE_THRESHOLD) {
            const prev = avail[idx - 1];
            if (prev !== undefined)
                target = prev;
        }
        if (target !== this._pageIndex)
            this._gotoPage(target);
        else
            this._positionTrack(this._pageIndex);
    }

    _refit() {
        if (this._state !== 'panel' || this._revealing)
            return;
        const w = this._settings.get_int('expanded-width');
        this._fitPages(w);
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
                mode: MODES.easeOutCubic,
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
        this._headerTime.text = this._clockTime;
        this._headerDate.text = now.toLocaleDateString([], {
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
        if (this._areaId === 'clock') {
            this._pillClock.text = this._clockTime;
            this._pillDate.text = this._clockDate;
        }
    }

    /* ================================================================
     * Mídia
     * ================================================================ */

    _onMediaChanged(info) {
        this._mediaInfo = info;
        this._updatePillMedia(info);
        if (this._state === 'panel') {
            this._updatePanelMedia(info);
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
     * já que os botões da UI ficaram com can_focus:false de propósito. */
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
            width: this._settings.get_int('expanded-width'),
            minH: 96,
            maxH: 220,
            duration: this._settings.get_int('media-banner-duration'),
            action: () => this._showPanel(),
        });
    }

    _updatePillMedia(info) {
        this._mediaInfo = info;
        const active = !!(info && (info.playing || info.paused));
        this._setPillMediaLevels(active && !!info.playing);
        if (this._state === 'collapsed' && this._areaId === 'media') {
            this._pillClock.text = info?.title || '';
            this._refitPill();
        }
    }

    /* Disco girando: só enquanto realmente toca uma capa de álbum de
     * verdade (não faz sentido girar um ícone genérico de app). */
    _startMediaSpin() {
        if (this._mediaIcon.get_transition('rotation-angle-z'))
            return;
        this._mediaIcon.set_pivot_point(0.5, 0.5);
        this._animator.loop(this._mediaIcon, {
            rotation_angle_z: 360,
            duration: TIMING.mediaSpin,
            mode: MODES.linear,
            repeatCount: -1,
        });
    }

    _stopMediaSpin() {
        this._animator.stop(this._mediaIcon, 'rotation-angle-z');
        this._mediaIcon.rotation_angle_z = 0;
    }

    _setPillMediaLevels(playing) {
        if (!this._pillMediaBars)
            return;
        const resting = [0.45, 0.75, 0.55];
        const peaks = [0.95, 0.5, 0.82];
        const durations = [620, 470, 760];
        for (let i = 0; i < this._pillMediaBars.length; i++) {
            const bar = this._pillMediaBars[i];
            if (!playing) {
                this._animator.clear(bar);
                bar.scale_y = resting[i];
                continue;
            }
            bar.scale_y = resting[i];
            this._animator.loop(bar, {
                scale_y: peaks[i],
                duration: durations[i],
                mode: MODES.easeInOutSine,
                autoReverse: true,
                repeatCount: -1,
            });
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
            this._pillLeft.visible = true;
            this._mediaIcon.visible = true;
            const art = this._resolveArt(info);
            const gicon = art ?? this._resolveAppIcon(info.icon);
            if (gicon) {
                this._mediaIcon.gicon = gicon;
                this._mediaIcon.icon_name = '';
            } else {
                this._mediaIcon.icon_name = 'multimedia-player-symbolic';
            }
            // Capa de álbum vira um círculo (como o disco girando no
            // player do iOS); ícone de fallback fica quadrado normal.
            this._mediaIcon.set_style(art ? 'border-radius: 999px;' : '');
            this._mediaIcon.opacity = info.playing ? 255 : 140;
            this._pillClock.style_class = 'island-pill-title';
            this._pillClock.text = info.title || 'Sem mídia';
            this._pillDate.visible = false;
            this._batteryGroup.visible = false;
            this._pillMediaLevels.visible = true;
            this._setPillMediaLevels(!!info.playing);
            this._pillDismissBtn.visible = false;
            if (art && info.playing)
                this._startMediaSpin();
            else
                this._stopMediaSpin();
        } else if (id === 'notifications') {
            this._stopMediaSpin();
            const notif = this._notifs.getLatest();
            this._pillLeft.visible = true;
            this._mediaIcon.visible = true;
            this._mediaIcon.gicon = this._notifIcon(notif);
            this._mediaIcon.icon_name = '';
            this._mediaIcon.set_style('');
            this._mediaIcon.opacity = 255;
            this._pillClock.style_class = 'island-pill-title';
            this._pillClock.text = notif?.title ?? '';
            this._pillDate.visible = false;
            this._batteryGroup.visible = false;
            this._pillMediaLevels.visible = false;
            this._pillDismissBtn.visible = true;
        } else {
            this._stopMediaSpin();
            // Lado esquerdo visível: agora carrega a data (a bateria fica
            // à direita), o que mantém o horário centrado na pill.
            this._pillLeft.visible = true;
            this._mediaIcon.visible = false;
            this._pillClock.style_class = 'island-clock';
            this._pillClock.text = this._clockTime ?? '';
            this._pillDate.text = this._clockDate ?? '';
            this._pillDate.visible = true;
            const showBat = !!this._battery &&
                this._settings.get_boolean('show-battery');
            this._batteryGroup.visible = showBat;
            this._pillMediaLevels.visible = false;
            this._pillDismissBtn.visible = false;
        }

        this._areaId = id;

        if (dir) {
            const content = this._pillBox;
            this._animator.animate(content, {
                translation_x: 0,
                opacity: 255,
            }, {
                duration: this._animator.enabled
                    ? TIMING.areaSwap
                    : 0,
                mode: MODES.easeOutCubic,
                initial: {translation_x: dir * 22, opacity: 0},
            });
        }

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

    /* ---------- Arrastar páginas do painel ---------- */

    /* Início do gesto de página: só assume onde a origem não é um controle
     * que precise do gesto horizontal (slider de volume/brilho), um botão
     * ou a lista rolável de notificações — sem isso, puxar o ponteiro por
     * cima desses elementos trocaria de página por acidente. */
    _onPagePress(event) {
        if (event.get_button() !== 1 || this._state !== 'panel')
            return Clutter.EVENT_PROPAGATE;
        const src = event.get_source();
        let a = src;
        while (a && a !== this._pagesViewport) {
            if (a instanceof Slider ||
                a instanceof St.Button ||
                a instanceof St.ScrollView)
                return Clutter.EVENT_PROPAGATE;
            a = a.get_parent();
        }
        const [x, y] = event.get_coords();
        this._pageDrag = {x, y, dx: 0, pageStart: this._pageIndex};
        if (!this._pageDragCaptureId) {
            this._pageDragCaptureId = global.stage.connect(
                'captured-event', (_s, ev) => this._onPageDragEvent(ev));
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onPageDragEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            if (!this._pageDrag)
                return Clutter.EVENT_PROPAGATE;
            const state = event.get_state();
            if (!(state & Clutter.ModifierType.BUTTON1_MASK)) {
                this._endPageDrag();
                return Clutter.EVENT_PROPAGATE;
            }
            const [x] = event.get_coords();
            const dx = x - this._pageDrag.x;
            this._pageDrag.dx = dx;
            this._applyPageDrag(dx, false);
            return Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._endPageDrag();
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _endPageDrag() {
        if (this._pageDragCaptureId) {
            global.stage.disconnect(this._pageDragCaptureId);
            this._pageDragCaptureId = 0;
        }
        const drag = this._pageDrag;
        this._pageDrag = null;
        if (drag)
            this._applyPageDrag(drag.dx, true);
    }

    _updatePillNotifs() {
        if (this._state === 'collapsed' && this._areaId === 'notifications') {
            const notif = this._notifs.getLatest();
            if (notif) {
                this._mediaIcon.gicon = this._notifIcon(notif);
                this._pillClock.text = notif.title ?? '';
            }
        }
    }

    _updatePanelMedia(info) {
        const active = !!(info && (info.playing || info.paused));
        const wasVisible = this._mediaCard.visible;
        if (active) {
            this._setPanelArtwork(info);
            this._mediaTitle.text = info.title || 'Título desconhecido';
            this._mediaArtist.text = info.artist || info.album || '';
            this._mediaArtist.visible = !!(info.artist || info.album);
            this._mediaPlayBtn.child.icon_name =
                info.playing
                    ? 'media-playback-pause-symbolic'
                    : 'media-playback-start-symbolic';
            this._mediaCard.visible = true;
            this._mediaEmpty.visible = false;
        } else {
            this._mediaCard.visible = false;
            this._mediaEmpty.visible = true;
        }
        if (wasVisible !== active)
            this._refit();
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
        bannerPrevBtn.can_focus = false;
        controls.add_child(bannerPrevBtn);
        const bannerPlayBtn = this._makeIconButton(
            info.playing
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic',
            'Reproduzir/Pausar', 22,
            (e) => this._consumeBannerClick(() => this._media.playPause(), e));
        bannerPlayBtn.style_class += ' island-play-button';
        bannerPlayBtn.can_focus = false;
        controls.add_child(bannerPlayBtn);
        const bannerNextBtn = this._makeIconButton(
            'media-skip-forward-symbolic', 'Próxima', 18,
            (e) => this._consumeBannerClick(() => this._media.next(), e));
        bannerNextBtn.can_focus = false;
        controls.add_child(bannerNextBtn);

        box.add_child(art);
        box.add_child(text);
        box.add_child(controls);
        return box;
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

    /* A guarda é essencial porque MediaWatcher emite changed
     * periodicamente; sem ela, a textura seria recarregada e piscaria a
     * cada atualização do player. */
    _setPanelArtwork(info) {
        const artworkKey = `${info?.artUrl ?? ''}\u0000${info?.icon ?? ''}`;
        if (this._panelArtworkKey === artworkKey)
            return;
        this._panelArtworkKey = artworkKey;

        this._mediaArt.destroy_all_children();
        if (!info?.artUrl) {
            this._mediaArt.add_child(new St.Icon({
                icon_size: 80,
                gicon: this._resolveAppIcon(info?.icon) ??
                    Gio.ThemedIcon.new('multimedia-player-symbolic'),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            return;
        }

        try {
            const cache = St.TextureCache.get_default();
            const texture = info.artUrl.startsWith('file://')
                ? cache.load_file_async(
                    Gio.File.new_for_uri(info.artUrl), 80, 80, 1, 1)
                // Spotify e vários outros players publicam uma URL https;
                // load_file_async só entende arquivos locais e a deixava
                // vazia. O carregador de URI é o caminho do Shell para arte
                // remota MPRIS.
                : cache.load_uri_async(info.artUrl, 80, 80, 1, 1);
            texture.set_size(80, 80);
            texture.x_align = Clutter.ActorAlign.CENTER;
            texture.y_align = Clutter.ActorAlign.CENTER;
            this._mediaArt.add_child(texture);
        } catch (error) {
            console.warn(`[dynamic-island] Não foi possível carregar a capa: ${error.message}`);
        }
    }

    /* ================================================================
     * Notificações
     * ================================================================ */

    _onNotificationAdded(notif) {
        if (!this._settings.get_boolean('show-notifications'))
            return;
        if (this._isDnd()) {
            if (this._state === 'panel')
                this._queuePanelNotifsRefresh();
            return;
        }
        if (this._state === 'panel') {
            // Painel já aberto: a notificação já aparece ao vivo na
            // lista rolável, não precisa de peek — não entra na fila.
            this._queuePanelNotifsRefresh();
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
        const cap = Math.min(this._settings.get_int('expanded-width'), 440);
        return clamp(natW, 240, cap);
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
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 16}),
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Dispensar',
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

    _updatePanelNotifs() {
        if (!this._notifList)
            return;
        this._notifList.destroy_all_children();
        // A lista agora rola dentro do próprio contêiner (island-notif-
        // scroll), então não precisa mais truncar em MAX_NOTIF_ROWS —
        // mostra tudo que o NotificationManager mantiver.
        const shown = this._notifs.notifications;
        if (shown.length === 0) {
            const empty = new St.Label({
                text: 'Sem notificações',
                style_class: 'island-empty',
            });
            this._notifList.add_child(empty);
        } else {
            for (const notif of shown)
                this._notifList.add_child(this._buildNotifRow(notif));
        }
        if (this._notifClearBtn)
            this._notifClearBtn.visible = shown.length > 0;
        this._refit();
    }

    /* Uma rajada pode conter dezenas de sinais no mesmo ciclo do Shell.
     * Agrupamos a reconstrução da lista em uma única atualização curta:
     * isso evita destruir/recriar atores e recalcular layout dezenas de
     * vezes, mas mantém o painel atualizado em no máximo 80 ms. */
    _queuePanelNotifsRefresh() {
        if (this._notifRefreshId)
            return;
        this._notifRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            NOTIF_REFRESH_DELAY_MS, () => {
                this._notifRefreshId = 0;
                if (this._state === 'panel')
                    this._updatePanelNotifs();
                return GLib.SOURCE_REMOVE;
            });
    }

    _buildNotifRow(notif) {
        const row = new St.Button({
            style_class: 'island-notif-row',
            reactive: true,
            can_focus: true,
            x_expand: true,
        });
        const box = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        const icon = new St.Icon({
            style_class: 'island-notif-icon',
            icon_size: 20,
            gicon: this._notifIcon(notif),
            y_align: Clutter.ActorAlign.START,
        });
        const text = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        const meta = new St.BoxLayout({vertical: false});
        const appName = new St.Label({
            text: notif.source?.title ?? '',
            style_class: 'island-notif-app',
            x_expand: true,
        });
        appName.clutter_text.line_wrap = true;
        appName.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        appName.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        const time = new St.Label({
            text: this._formatTime(notif.datetime ?? new Date()),
            style_class: 'island-notif-time',
        });
        meta.add_child(appName);
        meta.add_child(time);

        const title = new St.Label({
            text: notif.title ?? '',
            style_class: 'island-notif-title',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        // Quebra em várias linhas em vez de truncar com "..." — a lista
        // agora rola dentro do próprio contêiner, então o título tem
        // espaço de sobra pra aparecer inteiro em vez de cortado.
        title.clutter_text.set_line_wrap(true);
        title.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        title.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        text.add_child(meta);
        text.add_child(title);

        box.add_child(icon);
        box.add_child(text);
        row.set_child(box);
        row.connect('clicked', () => {
            this._activateNotif(notif);
            this._showCollapsed();
        });
        return row;
    }

    _updatePanelContent() {
        const show = this._settings.get_boolean('show-controls');
        this._controlsSection.visible = show;
        this._systemSection.visible = show;
        this._syncToggles();
        this._updatePanelMedia(this._media.info);
        this._updatePanelNotifs();
        this._syncPages();
    }

    /* ================================================================
     * Controles
     * ================================================================ */

    _onVolumeSliderChanged() {
        this._controls.setVolume(this._volumeSlider.value);
        this._volumeLabel.text = `${Math.round(this._volumeSlider.value * 100)}%`;
    }

    _onVolumeChanged(ratio, muted) {
        if (!this._volumeDragging)
            this._volumeSlider.value = ratio;
        this._volumeLabel.text = `${Math.round(ratio * 100)}%`;
        let icon;
        if (muted || ratio === 0)
            icon = 'audio-volume-muted-symbolic';
        else if (ratio < 0.35)
            icon = 'audio-volume-low-symbolic';
        else if (ratio < 0.7)
            icon = 'audio-volume-medium-symbolic';
        else
            icon = 'audio-volume-high-symbolic';
        this._volumeIcon.icon_name = icon;
    }

    _onBrightnessSliderChanged() {
        this._controls.setBrightness(this._brightnessSlider.value);
        this._brightnessLabel.text =
            `${Math.round(this._brightnessSlider.value * 100)}%`;
    }

    _onBrightnessChanged(value) {
        if (!this._brightnessDragging)
            this._brightnessSlider.value = value;
        this._brightnessLabel.text = `${Math.round(value * 100)}%`;
    }

    _onToggleChanged(name, value) {
        const btn = this._toggleButtons[name];
        if (!btn)
            return;
        if (name === 'bluetooth')
            btn.visible = this._controls.hasBluetooth;
        btn.checked = value;
        this._styleToggle(btn, value);
    }

    _syncToggles() {
        for (const def of TOGGLES) {
            const btn = this._toggleButtons[def.name];
            if (!btn)
                continue;
            if (def.name === 'bluetooth') {
                btn.visible = this._controls.hasBluetooth;
                if (!btn.visible)
                    continue;
            }
            const value = this._controls.getToggle(def.name);
            btn.checked = value;
            this._styleToggle(btn, value);
        }
    }

    _onPowerAction(name) {
        this._showCollapsed();
        switch (name) {
        case 'lock': this._controls.lockScreen(); break;
        case 'suspend': this._controls.suspend(); break;
        case 'power': this._controls.powerOff(); break;
        }
    }

    _styleToggle(btn, value) {
        if (!value) {
            btn.set_style('');
            return;
        }
        const accent = this._accentColor();
        btn.set_style(`background-color: ${accent}; color: white;`);
    }

    _onBatteryChanged(battery) {
        this._battery = battery;
        const enabled = this._settings.get_boolean('show-battery');
        if (!battery || !enabled) {
            this._batteryGroup.visible = false;
            return;
        }
        const {percent, charging, full} = battery;
        const level = 10 * Math.floor(clamp(percent, 0, 100) / 10);
        let icon;
        if (full)
            icon = 'battery-level-100-charged-symbolic';
        else if (charging)
            icon = `battery-level-${level}-charging-symbolic`;
        else
            icon = `battery-level-${level}-symbolic`;
        this._batteryIcon.icon_name = icon;
        this._batteryLabel.text = `${Math.round(percent)}%`;
        if (this._state === 'collapsed' && this._areaId === 'clock') {
            this._batteryGroup.visible = true;
            this._refitPill();
        }
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
                mode: MODES.easeOutQuint,
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

    _applyAccent() {
        this._syncToggles();
        const accent = this._accentColor();
        this._volumeSlider.set_style(
            `-barlevel-active-background-color: ${accent};`);
        this._brightnessSlider.set_style(
            `-barlevel-active-background-color: ${accent};`);
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
        const colors = this._nativeColors();
        const colorCss = colors
            ? ` background-color: ${colors.bg}; background-image: none; border-color: ${colors.border};`
            : '';
        this._pillBaseStyle = `border-radius: ${Math.floor(h / 2)}px;${colorCss}`;
        this._pillHoverStyle = colors
            ? `border-radius: ${Math.floor(h / 2)}px; background-color: ${
                this._lighten(colors.bg, 12)}; background-image: none; border-color: ${colors.border};`
            : this._pillBaseStyle;
        this._pill.set_style(
            this._pill.hover ? this._pillHoverStyle : this._pillBaseStyle);
        this._banner.set_style(`border-radius: ${r}px;${colorCss}`);
        this._panel.set_style(`border-radius: ${r}px;${colorCss}`);
    }

    _onSettingChanged(key) {
        if (key === 'animations') {
            this._animator.setEnabled(
                this._settings.get_boolean('animations'));
        } else if (key === 'accent-color') {
            this._applyAccent();
        } else if (key === 'show-controls') {
            if (this._state === 'panel')
                this._updatePanelContent();
        } else if (key === 'show-notifications') {
            if (this._state === 'panel')
                this._updatePanelContent();
        } else if (key === 'expanded-width') {
            if (this._state === 'panel') {
                const w = this._settings.get_int('expanded-width');
                this._fitPages(w);
                this._positionTrack(this._pageIndex, false);
                try {
                    const [, naturalHeight] = this._panel.get_preferred_height(w);
                    this._animateSize(w,
                        panelTargetHeight(naturalHeight, this._maxHeight()),
                        false);
                } catch (_) {}
            }
        } else if (key === 'corner-radius') {
            this._applyShape();
        } else if (key === 'collapsed-height') {
            this._applyShape();
            if (this._state === 'collapsed')
                this._refitPill();
        }
    }
});
