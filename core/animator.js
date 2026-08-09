import Clutter from 'gi://Clutter';

/* ================================================================
 * Animator — ponto único para todas as animações da ilha.
 *
 * Centraliza as durações ("tokens de timing") e os modos de easing
 * (curvas estilo Apple) que antes estavam espalhados em ~15 chamadas
 * `actor.ease()` pelo island.js. Também é o único lugar que decide
 * "anima ou aplica direto": quando a preferência `animations` está
 * desligada, o estado final é aplicado instantaneamente (sem transição
 * residual), comportamento antes repetido em cada call site.
 *
 * Depende de gi://Clutter (não roda em GJS puro fora do Shell, como
 * island.js/controls.js) — por isso não entra na suíte de testes.
 * ================================================================ */

export const TIMING = {
    expand: 420,
    collapse: 300,
    fade: 200,
    swapLayerDelay: 110,
    swapLayerFade: 280,
    pageSwipe: 220,
    panelRefit: 340,
    areaSwap: 320,
    pillRefit: 480,
    crossfadeOut: 140,
    crossfadeIn: 220,
    mediaSpin: 8000,
};

export const MODES = {
    easeOutQuint: Clutter.AnimationMode.EASE_OUT_QUINT,
    easeInOutQuad: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
    easeOutQuad: Clutter.AnimationMode.EASE_OUT_QUAD,
    easeOutCubic: Clutter.AnimationMode.EASE_OUT_CUBIC,
    easeInQuad: Clutter.AnimationMode.EASE_IN_QUAD,
    easeInOutSine: Clutter.AnimationMode.EASE_IN_OUT_SINE,
    linear: Clutter.AnimationMode.LINEAR,
};

export class Animator {
    constructor({enabled = true} = {}) {
        this._enabled = enabled;
    }

    get enabled() {
        return this._enabled;
    }

    setEnabled(enabled) {
        this._enabled = enabled;
    }

    clear(actor) {
        actor.remove_all_transitions();
    }

    stop(actor, name) {
        actor.remove_transition(name);
    }

    /* Transição única. Sempre remove transições pendentes antes de
     * começar (matando qualquer ease antigo em conflito), e quando as
     * animações estão desligadas (ou a duração é 0) aplica o estado
     * final direto, disparando `onComplete` de forma síncrona — igual
     * ao que um `ease()` com duração 0 faria no Clutter. */
    animate(actor, props, {
        duration,
        mode = MODES.easeOutCubic,
        delay = 0,
        onComplete = null,
        initial = null,
    } = {}) {
        actor.remove_all_transitions();
        if (!this._enabled || duration === 0) {
            for (const [prop, value] of Object.entries(props))
                actor[prop] = value;
            if (onComplete)
                onComplete();
            return;
        }
        if (initial) {
            for (const [prop, value] of Object.entries(initial))
                actor[prop] = value;
        }
        actor.ease({...props, duration, delay, mode, onComplete});
    }

    /* Animação contínua (loop infinito): disco girando da capa e as
     * barras de nível de reprodução. O controle de liga/desliga é do
     * chamador (a animação É o estado de "tocando"). */
    loop(actor, props) {
        actor.remove_all_transitions();
        actor.ease(props);
    }
}
