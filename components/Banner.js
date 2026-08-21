import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import {TIMING, MODES} from '../core/animator.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ================================================================
 * Banner — o toast temporário da ilha (notificação ou mídia).
 *
 * Encapsula a subárvore do banner (ator + bin de conteúdo), o estado
 * de hover, o clique (que recolhe a ilha e dispara a ação pendente) e
 * o timer de auto-colapso. O orquestrador (island.js) decide O QUE
 * mostrar e QUANDO recolher; o Banner cuida do COMO (medição de
 * altura, crossfade do conteúdo, agendamento do timer).
 * ================================================================ */

export const Banner = GObject.registerClass(
class Banner extends St.Widget {
    _init(animator, {
        onActivate = null,
        onHoverChange = null,
    } = {}) {
        super._init({
            name: 'islandBanner',
            style_class: 'island-banner',
            reactive: true,
            track_hover: true,
            can_focus: true,
            clip_to_allocation: true,
            visible: false,
            opacity: 0,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });

        this._animator = animator;
        this._onActivate = onActivate;
        this._onHoverChange = onHoverChange;

        this._bin = new St.Bin({x_expand: true, y_expand: true});
        this.add_child(this._bin);

        this._timer = 0;
        this._hover = false;
        this._action = null;

        this.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const action = this._action;
            this._action = null;
            // O orquestrador recolhe a ilha e (se houver) executa a ação
            // pendente (ex.: abrir o painel a partir do banner de mídia).
            if (this._onActivate)
                this._onActivate(action);
            return Clutter.EVENT_STOP;
        });

        this.connect('notify::hover', () => {
            this._hover = this.hover;
            if (this._onHoverChange)
                this._onHoverChange(this._hover);
        });
    }

    get bin() {
        return this._bin;
    }

    get hover() {
        return this._hover;
    }

    /* Ação a executar quando o usuário clicar no banner (ex.: abrir o
     * painel). Pode ser limpa por _consumeBannerClick para que um
     * clique num controle interno (play/prev/next) não abra o painel. */
    setAction(action) {
        this._action = action;
    }

    clearAction() {
        this._action = null;
    }

    /* Mostra um conteúdo, mede a altura natural dentro dos limites e
     * devolve a altura (para o orquestrador animar o tamanho da ilha). */
    show(child, width, minH = 96, maxH = 240) {
        this._bin.set_child(child);
        this.visible = true;
        let h;
        try {
            const [, natH] = this.get_preferred_height(width);
            h = clamp(natH, minH, maxH);
        } catch (_) {
            h = minH;
        }
        return h;
    }

    /* Timer único de auto-colapso. `onTimeout` decide o que fazer
     * quando dispara (continuar mostrando outro peek, recolher, etc.). */
    scheduleCollapse(ms, onTimeout) {
        this.cancelCollapse();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timer = 0;
            if (onTimeout)
                onTimeout();
            return GLib.SOURCE_REMOVE;
        });
    }

    cancelCollapse() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
    }

    /* Troca o conteúdo com crossfade (fade out + leve deslize, swap,
     * fade in) sem recolher a ilha — usado quando notificações se
     * acumulam na fila. `onResize(h)` recebe a nova altura para o
     * orquestrador animar o tamanho; `after` roda ao final do fade-in. */
    crossfade(child, width, onResize, after) {
        const swap = () => {
            this._bin.set_child(child);
            let h;
            try {
                const [, natH] = this.get_preferred_height(width);
                h = clamp(natH, 96, 240);
            } catch (_) {
                h = 120;
            }
            onResize(h);
        };

        if (!this._animator.enabled) {
            swap();
            if (after)
                after();
            return;
        }

        this._animator.animate(this._bin, {
            opacity: 0,
            translation_x: -16,
        }, {
            duration: TIMING.crossfadeOut,
            mode: MODES.easeInQuad,
            onComplete: () => {
                swap();
                this._bin.translation_x = 16;
                this._animator.animate(this._bin, {
                    opacity: 255,
                    translation_x: 0,
                }, {
                    duration: TIMING.crossfadeIn,
                    mode: MODES.easeOutQuad,
                });
                if (after)
                    after();
            },
        });
    }
});
