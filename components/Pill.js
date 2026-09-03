import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import {TIMING, MODES} from '../core/animator.js';
import {ownIcon} from '../core/icons.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ================================================================
 * Pill — a camada recolhida da ilha (relógio/data/bateria/mídia).
 *
 * Encapsula a subárvore da pill: o conteúdo em três áreas (relógio,
 * mídia, notificação), o indicador passivo de reprodução (barras), o
 * disco girando da capa, o estilo de hover e os gestos de scroll/
 * pressionar. O orquestrador (island.js) decide QUAL área mostrar e
 * com quais dados; a Pill cuida de como renderizar e animar.
 * ================================================================ */

export const Pill = GObject.registerClass(
class Pill extends St.Widget {
    _init(animator, {
        onScroll = null,
        onPress = null,
        onDismiss = null,
    } = {}) {
        super._init({
            name: 'islandPill',
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

        this._animator = animator;
        this._onScroll = onScroll;
        this._onPress = onPress;
        this._onDismiss = onDismiss;
        this._pillBaseStyle = null;
        this._pillHoverStyle = null;

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
        this._levelsPlaying = null;
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
        this.setLevels(false);
        this._pillRight.add_child(this._pillMediaLevels);

        this._pillDismissBtn = new St.Button({
            style_class: 'island-icon-button island-pill-control',
            child: ownIcon('close', 16),
            reactive: true,
            can_focus: true,
            accessible_name: 'Dispensar',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillDismissBtn.connect('clicked', () => {
            if (this._onDismiss)
                this._onDismiss();
        });
        this._pillRight.add_child(this._pillDismissBtn);

        box.add_child(this._pillLeft);
        box.add_child(this._pillClock);
        box.add_child(this._pillRight);

        this._pillClock.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._pillBox = box;
        this.add_child(box);

        this.connect('button-press-event', (_a, event) =>
            this._onPress ? this._onPress(event) : Clutter.EVENT_PROPAGATE);
        this.connect('scroll-event', (_a, event) =>
            this._onScroll ? this._onScroll(event) : Clutter.EVENT_PROPAGATE);
        this.connect('notify::hover', () => this._applyHoverStyle());
    }

    /* ---------- Estilo de hover (setado pelo tema via orquestrador) */

    setStyles(baseStyle, hoverStyle) {
        this._pillBaseStyle = baseStyle;
        this._pillHoverStyle = hoverStyle;
        this._applyHoverStyle();
    }

    _applyHoverStyle() {
        if (!this._pillHoverStyle)
            return;
        this.set_style(this.hover
            ? this._pillHoverStyle : this._pillBaseStyle);
    }

    /* ---------- Relógio / dados ---------- */

    setClock(time, date) {
        this._pillClock.text = time ?? '';
        this._pillDate.text = date ?? '';
    }

    /* Atualização pontual do título na área de mídia já ativa (nova
     * faixa sem trocar de área). */
    setTitle(text) {
        this._pillClock.text = text ?? '';
    }

    setBattery(battery, show) {
        if (!battery || !show) {
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
        this._batteryGroup.visible = true;
    }

    /* ---------- Áreas (relógio / mídia / notificação) ---------- */

    showClockArea(time, date, showBattery) {
        this.setSpin(false);
        // Lado esquerdo visível: agora carrega a data (a bateria fica
        // à direita), o que mantém o horário centrado na pill.
        this._pillLeft.visible = true;
        this._mediaIcon.visible = false;
        this._pillClock.style_class = 'island-clock';
        this._pillClock.text = time ?? '';
        this._pillDate.text = date ?? '';
        this._pillDate.visible = true;
        this._batteryGroup.visible = showBattery;
        this._pillMediaLevels.visible = false;
        this._pillDismissBtn.visible = false;
    }

    showMediaArea(info, gicon, hasArt) {
        this._pillLeft.visible = true;
        this._mediaIcon.visible = true;
        if (gicon) {
            this._mediaIcon.gicon = gicon;
            this._mediaIcon.icon_name = '';
        } else {
            this._mediaIcon.icon_name = 'multimedia-player-symbolic';
        }
        // Capa de álbum vira um círculo (como o disco girando no
        // player do iOS); ícone de fallback fica quadrado normal.
        this._mediaIcon.set_style(hasArt ? 'border-radius: 999px;' : '');
        this._mediaIcon.opacity = info.playing ? 255 : 140;
        this._pillClock.style_class = 'island-pill-title';
        this._pillClock.text = info.title || 'Sem mídia';
        this._pillDate.visible = false;
        this._batteryGroup.visible = false;
        this._pillMediaLevels.visible = true;
        this.setLevels(!!info.playing);
        this._pillDismissBtn.visible = false;
        this.setSpin(hasArt && !!info.playing);
    }

    showNotifArea(notif, icon) {
        this.setSpin(false);
        this._pillLeft.visible = true;
        this._mediaIcon.visible = true;
        this._mediaIcon.gicon = icon;
        this._mediaIcon.icon_name = '';
        this._mediaIcon.set_style('');
        this._mediaIcon.opacity = 255;
        this._pillClock.style_class = 'island-pill-title';
        this._pillClock.text = notif?.title ?? '';
        this._pillDate.visible = false;
        this._batteryGroup.visible = false;
        this._pillMediaLevels.visible = false;
        this._pillDismissBtn.visible = true;
    }

    /* Atualização pontual da área de notificação que já está ativa
     * (nova notificação mais recente chegou). */
    updateNotif(notif, icon) {
        if (!notif)
            return;
        this._mediaIcon.gicon = icon;
        this._pillClock.text = notif.title ?? '';
    }

    /* ---------- Animação de troca de área (deslize do conteúdo) */

    slide(dir) {
        this._animator.animate(this._pillBox, {
            translation_x: 0,
            opacity: 255,
        }, {
            duration: this._animator.enabled ? TIMING.areaSwap : 0,
            mode: MODES.interactive,
            initial: {translation_x: dir * 22, opacity: 0},
        });
    }

    /* ---------- Indicador de reprodução ---------- */

    /* Disco girando: só enquanto realmente toca uma capa de álbum de
     * verdade (não faz sentido girar um ícone genérico de app). */
    setSpin(shouldSpin) {
        if (shouldSpin) {
            if (this._mediaIcon.get_transition('rotation-angle-z'))
                return;
            this._mediaIcon.set_pivot_point(0.5, 0.5);
            this._animator.loop(this._mediaIcon, {
                rotation_angle_z: 360,
                duration: TIMING.mediaSpin,
                mode: MODES.linear,
                repeatCount: -1,
            });
        } else {
            this._animator.stop(this._mediaIcon, 'rotation-angle-z');
            this._mediaIcon.rotation_angle_z = 0;
        }
    }

    setLevels(playing) {
        if (!this._pillMediaBars || this._levelsPlaying === playing)
            return;
        this._levelsPlaying = playing;
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
                mode: MODES.ambient,
                autoReverse: true,
                repeatCount: -1,
            });
        }
    }

    /* ---------- Medição ---------- */

    /* Largura natural da pill (antes do teto/teto mínimo aplicado pelo
     * orquestrador). Retorna null se o ator ainda não pode medir. */
    measureWidth() {
        try {
            const [, natW] = this.get_preferred_width(-1);
            return natW;
        } catch (_) {
            return null;
        }
    }
});
