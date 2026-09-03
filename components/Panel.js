import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {TIMING, MODES} from '../core/animator.js';
import {ownIcon, ownGIcon} from '../core/icons.js';
import {
    clamp,
    panelInnerWidth,
    carouselTrackWidth,
    pageShift,
    panelChromeHeight,
    maxPageHeight,
    clampPageHeight,
    controlCellWidth,
} from '../core/layout.js';

const PAGE_SWIPE_THRESHOLD = 56;
const NOTIF_REFRESH_DELAY_MS = 80;
const CONTROL_GRID_COLUMNS = 3;
const CONTROL_GRID_GAP = 8;
const DEVICE_MENU_HOLD_MS = 450;

/* Áreas do painel expandido, em ordem: cada uma é uma "página" horizontal
 * deslizável dentro da ilha (ver o construtor). A navegação por arrastar/
 * indicadores/setas nunca disputa com sliders, botões ou a rolagem vertical
 * da lista de notificações. */
const PAGE_COUNT = 3;
const PAGE_LABELS = ['Mídia', 'Controles', 'Notificações'];

const TOGGLES = [
    {name: 'wifi', label: 'Wi-Fi', icon: 'wifi'},
    {name: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth'},
    {name: 'dark', label: 'Modo escuro', icon: 'moon'},
    {name: 'night', label: 'Luz noturna', icon: 'night'},
    {name: 'dnd', label: 'Não perturbe', icon: 'bell-off'},
];

const POWER_ACTIONS = [
    {name: 'lock', label: 'Bloquear', icon: 'lock'},
    {name: 'suspend', label: 'Suspender', icon: 'moon'},
    {name: 'power', label: 'Desligar', icon: 'power'},
];

/* ================================================================
 * Panel — a camada expandida da ilha (header + carrossel de páginas
 * Mídia/Controles/Notificações).
 *
 * Encapsula a subárvore completa do painel: header com relógio/data e
 * botão de recolher, o carrossel horizontal de três páginas, os
 * indicadores de página, a geometria do carrossel (_fitPages/
 * _positionTrack/_syncPages), o arrastar de páginas (captura de
 * estágio), o conteúdo de cada página (card de mídia, controles
 * rápidos, lista rolável de notificações) e a abertura do submenu
 * nativo de Wi-Fi/Bluetooth. O orquestrador (island.js) decide QUANDO
 * mostrar/ocultar e com quais dados; o Panel cuida de como renderizar
 * e se medir.
 * ================================================================ */

export const Panel = GObject.registerClass(
class Panel extends St.BoxLayout {
    _init(animator, {
        settings,
        controls,
        media,
        notifs,
        notifQueue,
        getState = null,
        isResizing = null,
        expandedWidth = null,
        maxHeight = null,
        accentColor = null,
        resolveAppIcon = null,
        notifIcon = null,
        formatTime = null,
        activateNotif = null,
        onCollapse = null,
        onRefit = null,
    } = {}) {
        super._init({
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

        this._animator = animator;
        this._settings = settings;
        this._controls = controls;
        this._media = media;
        this._notifs = notifs;
        this._notifQueue = notifQueue;
        this._getState = getState;
        this._isResizing = isResizing;
        this._expandedWidth = expandedWidth;
        this._maxHeight = maxHeight;
        this._accentColor = accentColor;
        this._resolveAppIcon = resolveAppIcon;
        this._notifIcon = notifIcon;
        this._formatTime = formatTime;
        this._activateNotif = activateNotif;
        this._onCollapse = onCollapse;
        this._onRefit = onRefit;

        this._pageIndex = 1;
        this._lastPage = null;
        this._pageDrag = null;
        this._pageDragCaptureId = 0;
        this._notifRefreshId = 0;
        this._panelArtworkKey = null;
        this._artworkRequestId = 0;
        this._volumeDragging = false;
        this._brightnessDragging = false;

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
                icon_size: 16,
                gicon: ownGIcon('chevron-down'),
            }),
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Recolher painel',
            tooltip_text: 'Recolher painel (Escape)',
        });
        this._collapseBtn.connect('clicked', () => {
            if (this._onCollapse)
                this._onCollapse();
        });

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
        const pageMap = {
            media: this._mediaPage,
            controls: this._controlsPage,
            notifications: this._notifsPage,
        };
        const defaultOrder = ['media', 'controls', 'notifications'];
        const requestedOrder = this._settings.get_strv('page-order');
        this._pageKeys = [...requestedOrder, ...defaultOrder]
            .filter((key, index, all) => pageMap[key] && all.indexOf(key) === index)
            .slice(0, PAGE_COUNT);
        this._pages = this._pageKeys.map(key => pageMap[key]);
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
                accessible_name: `Ir para ${PAGE_LABELS[defaultOrder.indexOf(this._pageKeys[i])]}`,
                tooltip_text: `Mostrar página ${PAGE_LABELS[defaultOrder.indexOf(this._pageKeys[i])]}`,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            dot.connect('clicked', () => this.gotoPage(i));
            this._pageDots.push(dot);
            this._pageIndicators.add_child(dot);
        }

        this.add_child(this._header);
        this.add_child(this._pagesViewport);
        this.add_child(this._pageIndicators);
        this.connect('button-press-event',
            (_a, e) => this._onPagePress(e));

        /* Depois que a alocação assenta na largura final, as páginas
         * são refeitas com a largura interna real (o cálculo inicial
         * em _fitPages usa a largura alvo menos o padding do CSS). */
        this.connect('notify::allocation', () => {
            if (this._isResizing?.())
                return;
            if (this._pagesTrack &&
                this._pageWidth > 0 &&
                Math.abs(this._pagesViewport.width - this._pageWidth) > 1) {
                this.fitPages();
                this.positionTrack(this._pageIndex, false);
            }
        });
    }

    get pageIndex() {
        return this._pageIndex;
    }

    /* ---------- Construção das páginas ---------- */

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
        // O foco explícito torna os comandos utilizáveis por teclado; o
        // atalho global continua disponível quando a ilha não está focada.
        this._mediaPlayBtn.can_focus = true;
        this._mediaPrevBtn.can_focus = true;
        this._mediaNextBtn = this._makeIconButton(
            'media-skip-forward-symbolic', 'Próxima', 18,
            () => this._media.next());
        this._mediaNextBtn.can_focus = true;
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
        this._volumeIcon = ownIcon('volume', 20);
        this._volumeIcon.style_class = 'island-slider-icon';
        this._volumeIcon.y_align = Clutter.ActorAlign.CENTER;
        this._volumeSlider = new Slider(0);
        Object.assign(this._volumeSlider, {accessible_name: 'Volume'});
        this._volumeSlider.accessible_name = 'Volume';
        this._volumeSlider.set_tooltip_text('Ajustar volume');
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
        this._brightnessIcon = ownIcon('brightness', 20);
        this._brightnessIcon.style_class = 'island-slider-icon';
        this._brightnessIcon.y_align = Clutter.ActorAlign.CENTER;
        this._brightnessSlider = new Slider(0);
        Object.assign(this._brightnessSlider, {accessible_name: 'Brilho'});
        this._brightnessSlider.accessible_name = 'Brilho';
        this._brightnessSlider.set_tooltip_text('Ajustar brilho');
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
            tooltip_text: 'Remover todas as notificações',
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
        // largura não) + slider ocupando o espaço flexível + valor
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
            child: ownIcon(iconName, iconSize),
            reactive: true,
            can_focus: true,
            accessible_name: accessibleName,
            tooltip_text: accessibleName,
        });
        this._bindPressMotion(btn);
        btn.connect('clicked', callback);
        return btn;
    }

    _bindPressMotion(button) {
        button.set_pivot_point(0.5, 0.5);
        button.connect('button-press-event', (_a, event) => {
            if (event.get_button() === 1)
                this._animator.animate(button, {
                    scale_x: 0.985,
                    scale_y: 0.985,
                }, {
                    duration: TIMING.press,
                    mode: MODES.interactive,
                });
            return Clutter.EVENT_PROPAGATE;
        });
        button.connect('button-release-event', () => {
            this._animator.animate(button, {
                scale_x: 1,
                scale_y: 1,
            }, {
                duration: TIMING.hover,
                mode: MODES.settle,
            });
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildToggle(def) {
        const btn = new St.Button({
            style_class: 'island-toggle',
            toggle_mode: true,
            checked: false,
            reactive: true,
            can_focus: true,
            accessible_name: def.label,
            tooltip_text: `Alternar ${def.label}`,
            x_expand: true,
        });
        this._bindPressMotion(btn);
        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        box.add_child(ownIcon(def.icon, 20));
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
        if (this._onCollapse)
            this._onCollapse();
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
            accessible_name: def.name === 'power'
                ? `${def.label}; requer confirmação` : def.label,
            tooltip_text: def.name === 'power'
                ? 'Desligar; clique novamente para confirmar' : def.label,
            x_expand: true,
        });
        this._bindPressMotion(btn);
        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        box.add_child(ownIcon(def.icon, 20));
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

    /* ---------- Relógio/data do header ---------- */

    setClock(time, date) {
        this._headerTime.text = time ?? '';
        this._headerDate.text = date ?? '';
    }

    /* ---------- Geometria do carrossel ---------- */

    /* Responsividade vertical: o viewport das páginas recebe somente a
     * altura que sobra DEPOIS do header, indicadores, espaçamentos e padding
     * do painel. Antes ele podia receber _maxHeight inteiro; o painel então
     * era cortado por fora e o ScrollView nunca era alocado menor que sua
     * lista. Com uma alocação real e limitada, a lista de notificações rola
     * dentro da ilha em vez de expandir a ilha indefinidamente. */
    fitPages(width) {
        if (!this._getState || this._getState() !== 'panel')
            return;
        // A animação abre a ilha a partir da largura da pill. Ler
        // pagesViewport.width durante essa animação alternava a largura do
        // track entre valores intermediários e deixava grids/controles
        // calculados para uma página maior que o recorte (o card seguinte
        // aparecia cortado na direita). A geometria do carrossel usa sempre
        // a largura-alvo estável; o parâmetro existe só para a abertura e
        // mudanças explícitas de preferência.
        const w = width ?? this._expandedWidth?.() ??
            this._settings.get_int('expanded-width');
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
        this.positionTrack(this._pageIndex, false);
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
    positionTrack(index, animate = true) {
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
            mode: MODES.interactive,
        });
        for (let i = 0; i < PAGE_COUNT; i++) {
            const dot = this._pageDots[i];
            dot.checked = i === index;
        }
        this._lastPage = index;
    }

    gotoPage(index, animate = true) {
        this.positionTrack(index, animate);
    }

    /* Páginas navegáveis no momento: espelha exatamente a visibilidade das
     * páginas. Mídia está sempre lá — mostra o card quando há player ativo
     * ou o empty state "Nenhuma mídia ativa"; Controles e Notificações
     * respeitam seus toggles nas preferências. */
    _availablePages() {
        const avail = [];
        for (let i = 0; i < this._pageKeys.length; i++) {
            const key = this._pageKeys[i];
            if (key === 'media' || this._settings.get_boolean(`show-${key}`))
                avail.push(i);
        }
        return avail;
    }

    _applyPageOrder() {
        const pageMap = {
            media: this._mediaPage,
            controls: this._controlsPage,
            notifications: this._notifsPage,
        };
        const fallback = ['media', 'controls', 'notifications'];
        const requested = this._settings.get_strv('page-order');
        const keys = [...requested, ...fallback]
            .filter((key, index, all) => pageMap[key] && all.indexOf(key) === index)
            .slice(0, PAGE_COUNT);
        if (keys.join(',') === this._pageKeys.join(','))
            return;
        this._pageKeys = keys;
        this._pages = keys.map(key => pageMap[key]);
        this._pagesTrack.remove_all_children();
        for (const page of this._pages)
            this._pagesTrack.add_child(page);
        for (let i = 0; i < this._pageDots.length; i++) {
            const label = PAGE_LABELS[fallback.indexOf(this._pageKeys[i])];
            this._pageDots[i].accessible_name = `Ir para ${label}`;
            this._pageDots[i].tooltip_text = `Mostrar página ${label}`;
        }
    }

    /* Sincroniza páginas/dots com o que está disponível e garante que o
     * índice atual nunca aponte pra uma página que sumiu. Chamado sempre
     * que o conteúdo muda (mídia inicia/para, toggle de seção, notifs). */
    syncPages() {
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
        this.positionTrack(this._pageIndex, false);
        this.fitPages();
        if (this._onRefit)
            this._onRefit();
    }

    /* Tecla de seta (ver key-press-event do orquestrador): troca pra
     * página vizinha que existir. */
    shiftPage(delta) {
        const avail = this._availablePages();
        const idx = avail.indexOf(this._pageIndex);
        if (idx === -1)
            return;
        const next = avail[idx + delta];
        if (next !== undefined)
            this.gotoPage(next);
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
            this.gotoPage(target);
        else
            this.positionTrack(this._pageIndex);
    }

    /* ---------- Arrastar páginas do painel ---------- */

    /* Início do gesto de página: só assume onde a origem não é um controle
     * que precise do gesto horizontal (slider de volume/brilho), um botão
     * ou a lista rolável de notificações — sem isso, puxar o ponteiro por
     * cima desses elementos trocaria de página por acidente. */
    _onPagePress(event) {
        if (event.get_button() !== 1 ||
            !this._getState || this._getState() !== 'panel')
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
                this.endDrag();
                return Clutter.EVENT_PROPAGATE;
            }
            const [x] = event.get_coords();
            const dx = x - this._pageDrag.x;
            this._pageDrag.dx = dx;
            this._applyPageDrag(dx, false);
            return Clutter.EVENT_PROPAGATE;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this.endDrag();
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    /* Encerra o gesto de página (seja por release, colapso ou perda do
     * botão). Se houve arrasto, completa a troca de página. */
    endDrag() {
        if (this._pageDragCaptureId) {
            global.stage.disconnect(this._pageDragCaptureId);
            this._pageDragCaptureId = 0;
        }
        const drag = this._pageDrag;
        this._pageDrag = null;
        if (drag)
            this._applyPageDrag(drag.dx, true);
    }

    destroy() {
        this.endDrag();
        if (this._notifRefreshId) {
            GLib.source_remove(this._notifRefreshId);
            this._notifRefreshId = 0;
        }
        super.destroy();
    }

    /* ---------- Conteúdo ---------- */

    /* Pré-aquecimento / atualização geral do painel: alterna as seções
     * pela preferência e reconstrói o conteúdo e as páginas disponíveis. */
    updateContent() {
        this._applyPageOrder();
        const show = this._settings.get_boolean('show-controls');
        this._controlsSection.visible = show;
        this._systemSection.visible = show &&
            this._settings.get_boolean('show-power-actions');
        this._volumeRow.visible = show && this._settings.get_boolean('show-volume');
        this._brightnessRow.visible = show && this._settings.get_boolean('show-brightness');
        for (const def of TOGGLES) {
            const btn = this._toggleButtons[def.name];
            if (btn)
                btn.visible = show && this._settings.get_boolean(`show-${def.name}`);
        }
        for (const row of this._toggleRows)
            row.visible = row.get_children().some(child => child.visible);
        this.syncToggles();
        this.updateMedia(this._media.info);
        this._updatePanelNotifs();
        this.syncPages();
    }

    updateMedia(info) {
        const active = !!(info && (info.playing || info.paused));
        const wasVisible = this._mediaCard.visible;
        if (active) {
            this._setPanelArtwork(info);
            this._mediaTitle.text = info.title || 'Título desconhecido';
            this._mediaArtist.text = info.artist || info.album || '';
            this._mediaArtist.visible = !!(info.artist || info.album);
            this._mediaPlayBtn.child.gicon = ownGIcon(
                info.playing ? 'pause' : 'play');
            this._mediaCard.visible = true;
            this._mediaEmpty.visible = false;
        } else {
            this._mediaCard.visible = false;
            this._mediaEmpty.visible = true;
        }
        if (wasVisible !== active && this._onRefit)
            this._onRefit();
    }

    /* A guarda é essencial porque MediaWatcher emite changed
     * periodicamente; sem ela, a textura seria recarregada e piscaria a
     * cada atualização do player. */
    _setPanelArtwork(info) {
        const artworkKey = `${info?.artUrl ?? ''}\u0000${info?.icon ?? ''}`;
        if (this._panelArtworkKey === artworkKey)
            return;
        this._panelArtworkKey = artworkKey;
        const requestId = ++this._artworkRequestId;

        const fallback = () => new St.Icon({
            icon_size: 80,
            gicon: this._resolveAppIcon?.(info?.icon) ??
                Gio.ThemedIcon.new('multimedia-player-symbolic'),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._mediaArt.destroy_all_children();
        if (!info?.artUrl) {
            this._mediaArt.add_child(fallback());
            return;
        }

        try {
            const cache = St.TextureCache.get_default();
            if (info.artUrl.startsWith('file://')) {
                const texture = cache.load_file_async(
                    Gio.File.new_for_uri(info.artUrl), 80, 80, 1, 1);
                texture.set_size(80, 80);
                texture.x_align = Clutter.ActorAlign.CENTER;
                texture.y_align = Clutter.ActorAlign.CENTER;
                this._mediaArt.add_child(texture);
                return;
            }

            // GNOME 50 não expõe load_uri_async no St.TextureCache. Baixa
            // via Gio/GVfs, guarda no cache do usuário e entrega um arquivo
            // local ao carregador suportado pelo Shell.
            this._mediaArt.add_child(fallback());
            const remote = Gio.File.new_for_uri(info.artUrl);
            remote.load_contents_async(null, (file, result) => {
                try {
                    const [, contents] = file.load_contents_finish(result);
                    if (requestId !== this._artworkRequestId)
                        return;
                    const cacheDir = Gio.File.new_for_path(
                        GLib.build_filenamev([
                            GLib.get_user_cache_dir(),
                            'dynamic-island', 'artwork',
                        ]));
                    try {
                        cacheDir.make_directory_with_parents(null);
                    } catch (_) {
                        // Diretório já existente: segue usando o cache.
                    }
                    const digest = GLib.compute_checksum_for_string(
                        GLib.ChecksumType.MD5, info.artUrl, -1);
                    const cached = cacheDir.get_child(`${digest}.img`);
                    cached.replace_contents_bytes(
                        GLib.Bytes.new(contents), null, false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                    const texture = cache.load_file_async(cached, 80, 80, 1, 1);
                    texture.set_size(80, 80);
                    texture.x_align = Clutter.ActorAlign.CENTER;
                    texture.y_align = Clutter.ActorAlign.CENTER;
                    this._mediaArt.destroy_all_children();
                    this._mediaArt.add_child(texture);
                } catch (error) {
                    console.warn(`[dynamic-island] Não foi possível baixar a capa: ${error.message}`);
                }
            });
        } catch (error) {
            console.warn(`[dynamic-island] Não foi possível carregar a capa: ${error.message}`);
            this._mediaArt.add_child(fallback());
        }
    }

    _updatePanelNotifs() {
        if (!this._notifList)
            return;
        this._notifList.destroy_all_children();
        // A lista agora rola dentro do próprio contêiner (island-notif-
        // scroll), então não precisa mais truncar em MAX_NOTIF_ROWS —
        // mostra tudo que o NotificationManager mantiver.
        // O array legado continua disponível para banners; a lista visual
        // usa uma linha por fonte, evitando repetir dezenas de notificações
        // do mesmo app. Cada grupo mantém a notificação mais recente como
        // representante para ativação.
        const shown = this._notifs.notificationGroups ??
            this._notifs.notifications.map(notif => ({
                latest: notif,
                notifications: [notif],
                count: 1,
            }));
        if (shown.length === 0) {
            const empty = new St.Label({
                text: 'Sem notificações',
                style_class: 'island-empty',
            });
            this._notifList.add_child(empty);
        } else {
            for (const group of shown)
                this._notifList.add_child(this._buildNotifRow(group));
        }
        if (this._notifClearBtn)
            this._notifClearBtn.visible = shown.length > 0;
        if (this._onRefit)
            this._onRefit();
    }

    /* Uma rajada pode conter dezenas de sinais no mesmo ciclo do Shell.
     * Agrupamos a reconstrução da lista em uma única atualização curta:
     * isso evita destruir/recriar atores e recalcular layout dezenas de
     * vezes, mas mantém o painel atualizado em no máximo 80 ms. */
    refreshNotifsDebounced() {
        if (this._notifRefreshId)
            return;
        this._notifRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            NOTIF_REFRESH_DELAY_MS, () => {
                this._notifRefreshId = 0;
                if (this._getState && this._getState() === 'panel')
                    this._updatePanelNotifs();
                return GLib.SOURCE_REMOVE;
            });
    }

    _buildNotifRow(groupOrNotif) {
        // Aceita uma Notification diretamente para manter compatibilidade
        // com callers antigos e aceita também o grupo do novo modelo.
        const group = groupOrNotif?.latest ? groupOrNotif : null;
        const notif = group?.latest ?? groupOrNotif;
        const count = group?.count ?? 1;
        const row = new St.Button({
            style_class: 'island-notif-row',
            reactive: true,
            can_focus: true,
            accessible_name: notif.title || 'Notificação',
            tooltip_text: 'Abrir notificação',
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
            gicon: this._notifIcon?.(notif),
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
            text: this._formatTime?.(notif.datetime ?? new Date()) ?? '',
            style_class: 'island-notif-time',
        });
        meta.add_child(appName);
        if (count > 1) {
            const countLabel = new St.Label({
                text: `×${count}`,
                style_class: 'island-notif-count',
                x_align: Clutter.ActorAlign.END,
            });
            meta.add_child(countLabel);
        }
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
            if (this._activateNotif)
                this._activateNotif(notif);
            if (this._onCollapse)
                this._onCollapse();
        });
        return row;
    }

    /* ---------- Controles ---------- */

    _onVolumeSliderChanged() {
        this._controls.setVolume(this._volumeSlider.value);
        this._volumeLabel.text = `${Math.round(this._volumeSlider.value * 100)}%`;
    }

    setVolume(ratio, muted) {
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
        this._volumeIcon.gicon = ownGIcon(icon);
    }

    _onBrightnessSliderChanged() {
        this._controls.setBrightness(this._brightnessSlider.value);
        this._brightnessLabel.text =
            `${Math.round(this._brightnessSlider.value * 100)}%`;
    }

    setBrightness(value) {
        if (!this._brightnessDragging)
            this._brightnessSlider.value = value;
        this._brightnessLabel.text = `${Math.round(value * 100)}%`;
    }

    setToggle(name, value) {
        const btn = this._toggleButtons[name];
        if (!btn)
            return;
        if (name === 'bluetooth')
            btn.visible = this._controls.hasBluetooth;
        btn.checked = value;
        this._styleToggle(btn, value);
    }

    syncToggles() {
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
        if (this._onCollapse)
            this._onCollapse();
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
        const accent = this._accentColor ? this._accentColor() : null;
        if (!accent)
            return;
        btn.set_style(`background-color: ${accent}; color: white;`);
    }

    /* Aplica a cor de destaque nos controles que usam o accent (sliders).
     * O orquestrador decide a cor (_accentColor); aqui só aplicamos. */
    applyAccent() {
        this.syncToggles();
        const accent = this._accentColor ? this._accentColor() : null;
        if (!accent)
            return;
        this._volumeSlider.set_style(
            `-barlevel-active-background-color: ${accent};`);
        this._brightnessSlider.set_style(
            `-barlevel-active-background-color: ${accent};`);
    }
});
