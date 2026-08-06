/**
 * Fila FIFO da amostragem sequencial de notificações.
 *
 * Isolada em módulo próprio (sem depender de GObject/Clutter/St) só por
 * um motivo: island.js precisa de um GNOME Shell de verdade rodando
 * pra sequer ser carregado, então a garantia central pedida — "nenhuma
 * notificação pode ser omitida, mesmo que várias cheguem juntas" — não
 * dava pra cobrir com teste automatizado se ficasse misturada lá. Aqui
 * dá pra testar a ordem/decisão em isolamento (ver
 * tests/notifQueue.test.js); quem decide SE já é seguro exibir o
 * próximo item (estado da ilha, hover, etc.) continua em island.js.
 */
export class NotifQueue {
    constructor() {
        this._items = [];
    }

    get size() {
        return this._items.length;
    }

    /* Nunca substitui nem descarta — só acumula, preservando a ordem de
     * chegada. */
    push(item) {
        this._items.push(item);
    }

    /* Tira e devolve o próximo item na ordem de chegada (FIFO), ou
     * undefined se a fila estiver vazia. */
    next() {
        return this._items.shift();
    }

    /* Remove da fila qualquer item que já não seja mais válido (ex:
     * notificação destruída antes de chegar a vez dela) sem alterar a
     * ordem relativa dos que restam. */
    discard(predicate) {
        this._items = this._items.filter(item => !predicate(item));
    }

    clear() {
        this._items = [];
    }
}
