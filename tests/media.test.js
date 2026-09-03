import {
    MediaWatcher, _unwrap, _extractMeta,
    _normalizeDuration, _normalizePosition, _progress,
} from '../modules/media.js';
import {
    assertEqual, assertTrue, assertFalse, assertUndefined,
} from './lib/assert.js';

// Player MPRIS falso — só o suficiente pra exercitar a lógica de
// decisão do MediaWatcher (_pickActive/_recompute) sem precisar de uma
// sessão D-Bus de verdade nem de um player rodando.
function fakePlayer(status, meta = {}, caps = {}) {
    return {
        PlaybackStatus: status,
        Metadata: meta,
        CanGoNext: caps.canNext ?? true,
        CanGoPrevious: caps.canPrev ?? true,
        CanPlay: caps.canPlay ?? true,
        CanPause: caps.canPause ?? true,
        _calls: [],
        PlayPauseRemote(cb) { this._calls.push('PlayPauseRemote'); cb?.(); },
        NextRemote(cb) { this._calls.push('NextRemote'); cb?.(); },
        PreviousRemote(cb) { this._calls.push('PreviousRemote'); cb?.(); },
    };
}

function fakeRoot(desktopEntry = 'app') {
    return {DesktopEntry: desktopEntry};
}

export const tests = {
    '_unwrap devolve valores simples sem alterar'() {
        assertEqual(_unwrap('texto'), 'texto');
        assertEqual(_unwrap(42), 42);
        assertUndefined(_unwrap(undefined));
    },

    '_unwrap desempacota algo GVariant-like (com deep_unpack)'() {
        const variant = {deep_unpack: () => 'valor-real'};
        assertEqual(_unwrap(variant), 'valor-real');
    },

    '_extractMeta com metadata ausente devolve valores padrão'() {
        const meta = _extractMeta(null);
        assertEqual(meta, {
            title: '', artist: '', album: '', artUrl: '', length: 0,
        });
    },

    '_extractMeta lê campos xesam/mpris e junta múltiplos artistas'() {
        const meta = _extractMeta({
            'xesam:title': 'Uma Música',
            'xesam:artist': ['Fulano', 'Ciclano'],
            'xesam:album': 'Um Álbum',
            'mpris:artUrl': 'file:///capa.png',
            'mpris:length': 123456,
        });
        assertEqual(meta.title, 'Uma Música');
        assertEqual(meta.artist, 'Fulano, Ciclano');
        assertEqual(meta.album, 'Um Álbum');
        assertEqual(meta.artUrl, 'file:///capa.png');
        assertEqual(meta.length, 123456);
    },

    '_extractMeta com artista único (não-array) não quebra'() {
        const meta = _extractMeta({'xesam:artist': 'Solo'});
        assertEqual(meta.artist, 'Solo');
    },

    'MediaWatcher sem players: info fica inativo'() {
        const mw = new MediaWatcher();
        mw._recompute();
        assertFalse(mw.isActive());
        assertFalse(mw.info.playing);
        assertFalse(mw.info.paused);
    },

    'MediaWatcher prioriza player Playing sobre Paused'() {
        const mw = new MediaWatcher();
        mw._players.set('org.mpris.MediaPlayer2.Paused',
            {player: fakePlayer('Paused', {'xesam:title': 'Pausada'}), root: fakeRoot()});
        mw._players.set('org.mpris.MediaPlayer2.Playing',
            {player: fakePlayer('Playing', {'xesam:title': 'Tocando'}), root: fakeRoot()});

        mw._recompute();

        assertTrue(mw.isActive());
        assertTrue(mw.info.playing);
        assertEqual(mw.info.title, 'Tocando');
        assertEqual(mw.info.bus, 'org.mpris.MediaPlayer2.Playing');
    },

    'MediaWatcher cai pro primeiro Paused quando ninguém está tocando'() {
        const mw = new MediaWatcher();
        mw._players.set('org.mpris.MediaPlayer2.A',
            {player: fakePlayer('Paused', {'xesam:title': 'A'}), root: fakeRoot()});

        mw._recompute();

        assertFalse(mw.info.playing);
        assertTrue(mw.info.paused);
        assertEqual(mw.info.title, 'A');
    },

    'MediaWatcher ignora players sem PlaybackStatus acessível'() {
        const mw = new MediaWatcher();
        const broken = {get PlaybackStatus() { throw new Error('dbus caiu'); }};
        mw._players.set('org.mpris.MediaPlayer2.Broken',
            {player: broken, root: fakeRoot()});

        mw._recompute();

        assertFalse(mw.isActive());
    },

    'transição parado -> tocando emite playing-started e changed'() {
        const mw = new MediaWatcher();
        const events = [];
        mw.connect('changed', () => events.push('changed'));
        mw.connect('playing-started', () => events.push('playing-started'));
        mw.connect('playing-stopped', () => events.push('playing-stopped'));

        mw._players.set('org.mpris.MediaPlayer2.P',
            {player: fakePlayer('Playing'), root: fakeRoot()});
        mw._recompute();

        assertEqual(events, ['playing-started', 'changed']);
    },

    'transição tocando -> pausado (mesmo player) emite playing-stopped'() {
        const mw = new MediaWatcher();
        mw._players.set('org.mpris.MediaPlayer2.P',
            {player: fakePlayer('Playing'), root: fakeRoot()});
        mw._recompute();

        const events = [];
        mw.connect('changed', () => events.push('changed'));
        mw.connect('playing-started', () => events.push('playing-started'));
        mw.connect('playing-stopped', () => events.push('playing-stopped'));

        mw._players.get('org.mpris.MediaPlayer2.P').player.PlaybackStatus = 'Paused';
        mw._recompute();

        assertEqual(events, ['playing-stopped', 'changed']);
        assertFalse(mw.info.playing);
        assertTrue(mw.info.paused);
    },

    'último player desaparecendo emite playing-stopped e zera info'() {
        const mw = new MediaWatcher();
        mw._players.set('org.mpris.MediaPlayer2.P',
            {player: fakePlayer('Playing'), root: fakeRoot()});
        mw._recompute();

        mw._players.delete('org.mpris.MediaPlayer2.P');
        const events = [];
        mw.connect('playing-stopped', () => events.push('playing-stopped'));
        mw._recompute();

        assertEqual(events, ['playing-stopped']);
        assertFalse(mw.isActive());
        assertFalse(mw.info.playing);
    },

    'playPause() sem player ativo não lança erro'() {
        const mw = new MediaWatcher();
        mw.playPause();
    },

    'playPause()/next()/previous() chamam o método remoto certo no player ativo'() {
        const mw = new MediaWatcher();
        const player = fakePlayer('Playing');
        mw._players.set('org.mpris.MediaPlayer2.P', {player, root: fakeRoot()});
        mw._recompute();

        mw.playPause();
        mw.next();
        mw.previous();

        assertEqual(player._calls, [
            'PlayPauseRemote', 'NextRemote', 'PreviousRemote',
        ]);
    },

    'info inclui Position real do player ativo'() {
        const mw = new MediaWatcher();
        const player = fakePlayer('Playing', {'xesam:title': 'T', 'mpris:length': 200000});
        player.Position = 50000;
        mw._players.set('org.mpris.MediaPlayer2.P', {player, root: fakeRoot()});
        mw._recompute();

        assertEqual(mw.info.position, 50000);
    },

    'info usa position null quando o player não implementa Position'() {
        const mw = new MediaWatcher();
        const player = fakePlayer('Paused', {'xesam:title': 'T'});
        mw._players.set('org.mpris.MediaPlayer2.P', {player, root: fakeRoot()});
        mw._recompute();

        assertEqual(mw.info.position, null);
    },

    'seleção entre players é determinística por nome do barramento'() {
        const mw = new MediaWatcher();
        mw._players.set('org.mpris.MediaPlayer2.Z',
            {player: fakePlayer('Playing', {'xesam:title': 'Z'}), root: fakeRoot()});
        mw._players.set('org.mpris.MediaPlayer2.A',
            {player: fakePlayer('Playing', {'xesam:title': 'A'}), root: fakeRoot()});

        mw._recompute();

        assertEqual(mw.info.bus, 'org.mpris.MediaPlayer2.A');
        assertEqual(mw.info.title, 'A');
    },

    'metadados incompletos ou inválidos usam defaults seguros'() {
        const meta = _extractMeta({
            'xesam:title': null,
            'xesam:artist': [null, 'Artista'],
            'mpris:length': -10,
        });
        assertEqual(meta.title, '');
        assertEqual(meta.artist, ', Artista');
        assertEqual(meta.album, '');
        assertEqual(meta.length, 0);
    },

    'helpers de posição e duração rejeitam valores inválidos e limitam progresso'() {
        assertEqual(_normalizeDuration(-1), 0);
        assertEqual(_normalizeDuration('infinito'), 0);
        assertEqual(_normalizePosition(-1, 100), null);
        assertEqual(_normalizePosition(150, 100), 100);
        assertEqual(_normalizePosition(undefined, 100), null);
        assertEqual(_progress(150, 100), 1);
        assertEqual(_progress(10, 0), null);
    },

    'callbacks tardios não reativam watcher parado'() {
        const mw = new MediaWatcher();
        mw._started = true;
        mw.stop();
        mw._players.set('org.mpris.MediaPlayer2.P',
            {player: fakePlayer('Playing'), root: fakeRoot()});
        mw._recompute();
        assertFalse(mw.isActive());
        assertFalse(mw.info.playing);
    },
};
