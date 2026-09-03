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
    micro: 140,
    hover: 180,
    press: 110,
    enter: 440,
    exit: 240,
    expand: 440,
    collapse: 190,
    pageSwipe: 260,
    panelRefit: 360,
    areaSwap: 300,
    pillRefit: 400,
    crossfadeOut: 120,
    crossfadeIn: 240,
    mediaSpin: 8000,
};

export const MODES = {
    // Semantic names keep the intent visible at each call site.
    smoothOut: Clutter.AnimationMode.EASE_OUT_QUINT,
    enter: Clutter.AnimationMode.EASE_OUT_QUINT,
    exit: Clutter.AnimationMode.EASE_IN_QUAD,
    settle: Clutter.AnimationMode.EASE_OUT_CUBIC,
    interactive: Clutter.AnimationMode.EASE_OUT_CUBIC,
    ambient: Clutter.AnimationMode.EASE_IN_OUT_SINE,
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
        mode = MODES.smoothOut,
        delay = 0,
        onComplete = null,
        initial = null,
        preserve = true,
    } = {}) {
        // Clutter keeps the interpolated property value when a transition is
        // removed. Do not overwrite it with `initial`: this makes quick
        // reversals continue from the user's current visual position.
        const interrupted = preserve && initial && Object.keys(initial).some(
            prop => typeof actor.get_transition === 'function' &&
                actor.get_transition(prop));
        // Cada propriedade tem sua própria transição no Clutter. Cancelar
        // somente os alvos evita que um refit interrompa, por exemplo,
        // uma animação independente de opacity ou translation.
        for (const prop of Object.keys(props))
            actor.remove_transition(prop);
        if (!this._enabled || duration === 0) {
            for (const [prop, value] of Object.entries(props))
                actor[prop] = value;
            if (onComplete)
                onComplete();
            return;
        }
        if (initial && !interrupted) {
            for (const [prop, value] of Object.entries(initial))
                actor[prop] = value;
        }
        actor.ease({...props, duration, delay, mode, onComplete});
    }

    /* Animação contínua (loop infinito): disco girando da capa e as
     * barras de nível de reprodução. O controle de liga/desliga é do
     * chamador (a animação É o estado de "tocando"). */
    loop(actor, props) {
        for (const prop of Object.keys(props))
            actor.remove_transition(prop);
        if (!this._enabled) {
            for (const [prop, value] of Object.entries(props))
                actor[prop] = value;
            return;
        }
        actor.ease(props);
    }
}
