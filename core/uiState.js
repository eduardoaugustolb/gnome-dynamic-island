/* ================================================================
 * uiState.js — máquina de estados da ilha.
 *
 * A ilha alterna entre três camadas: `collapsed` (pill), `banner`
 * (toast temporário de notificação/mídia) e `panel` (painel expandido
 * com as páginas). Antes isso era uma string solta (`this._state`)
 * mudada por `_show*` sem nenhuma validação — um `panel → banner` ou
 * qualquer salto inválido acontecia silenciosamente e corrompia a UI
 * (camada errada visível, foco preso, etc.).
 *
 * Esta máquina é pura (sem imports do Shell/Clutter): testável em GJS
 * puro (tests/uiState.test.js) e a única fonte de verdade para o que
 * pode acontecer. Transições reais levantadas do island.js:
 *
 *   collapsed → {collapsed, banner, panel}
 *   banner    → {collapsed, banner, panel}
 *   panel     → {collapsed, panel}
 *
 * A re-entrada no mesmo estado é permitida (peek de notificação se
 * repetindo, por exemplo) e nunca dispara listeners.
 * ================================================================ */

export const UI_STATES = ['collapsed', 'banner', 'panel'];

export const DEFAULT_TRANSITIONS = {
    collapsed: ['collapsed', 'banner', 'panel'],
    banner: ['collapsed', 'banner', 'panel'],
    panel: ['collapsed', 'panel'],
};

export class UiState {
    constructor(initial = 'collapsed', {
        transitions = DEFAULT_TRANSITIONS,
    } = {}) {
        if (!UI_STATES.includes(initial))
            throw new Error(`UiState: estado inicial inválido '${initial}'`);
        this._value = initial;
        this._transitions = transitions;
        this._listeners = new Set();
    }

    get value() {
        return this._value;
    }

    get isCollapsed() {
        return this._value === 'collapsed';
    }

    get isBanner() {
        return this._value === 'banner';
    }

    get isPanel() {
        return this._value === 'panel';
    }

    get expanded() {
        return this._value !== 'collapsed';
    }

    /* true se a transição atual → `next` é legal. */
    can(next) {
        const allowed = this._transitions[this._value];
        return !!allowed && allowed.includes(next);
    }

    /* Tenta transicionar. Retorna true se a transição é válida (mesmo
     * quando é re-entrada no mesmo estado); false deixa o estado
     * intacto. Sempre que o estado muda, dispara os listeners com
     * (novo, anterior). */
    set(next) {
        if (!this.can(next))
            return false;
        if (next === this._value)
            return true;
        const prev = this._value;
        this._value = next;
        for (const cb of this._listeners)
            cb(next, prev);
        return true;
    }

    collapse() {
        return this.set('collapsed');
    }

    /* Assina mudanças de estado. Retorna uma função que remove o
     * listener. */
    onTransition(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }
}
