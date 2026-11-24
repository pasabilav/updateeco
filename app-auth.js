/* Локальний модуль авторизації та стану документа (без сервера, токенів і БД). */
(function () {
    'use strict';

    var LOCAL_PIN = '1111';
    var STORAGE_KEY = 'rid_local_state_v1';

    var DEFAULT_CONFIG = {
        name: ['Толчинський', 'Владислав', 'Валерійович'],
        status: 'Статус обліку',
        photo: '',
        defer: '',
        deferType: '',
        birth: '29.03.1995',
        rnokpp: '3478608192',
        reason: '—',
        vlk: '—',
        vlkDate: '01.01.2025',
        tck: 'Територіальний центр комплектування та соціальної підтримки',
        rank: '—',
        vos: '000000',
        category: '—',
        categoryNote: '—',
        oberig: '00000000000000000000',
        phone: '+380 00 000 0000',
        email: 'example@example.com',
        address: '—',
        updated: '01.01.2025',
        marquee: 'Документ оновлено'
    };

    function cloneConfig(src) {
        var base = Object.assign({}, DEFAULT_CONFIG, src || {});
        if (Array.isArray(src && src.name)) {
            base.name = src.name.slice();
        } else if (Array.isArray(DEFAULT_CONFIG.name)) {
            base.name = DEFAULT_CONFIG.name.slice();
        }
        return base;
    }

    function loadStorage() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function saveStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                pin: _pin,
                config: _config,
                override: _override,
                qrSeed: _qrSeed,
                qrImage: _qrImage,
                noEdit: _noEdit,
                demo: _demo
            }));
        } catch (e) {}
    }

    var saved = loadStorage();
    var _pin = (saved && saved.pin != null) ? String(saved.pin) : LOCAL_PIN;
    var _config = cloneConfig(saved && saved.config);
    var _override = (saved && saved.override && typeof saved.override === 'object') ? Object.assign({}, saved.override) : {};
    var _qrSeed = (saved && saved.qrSeed) ? String(saved.qrSeed) : 'LOCAL-DEMO';
    var _qrImage = (saved && saved.qrImage) ? String(saved.qrImage) : '';
    var _noEdit = !!(saved && saved.noEdit);
    var _demo = !!(saved && saved.demo);
    var _content = null;

    function isProvisioned() {
        return Promise.resolve(true);
    }

    function provision() {
        return Promise.resolve({ ok: true });
    }

    function verify(code) {
        var val = String(code == null ? '' : code);
        if (val === '1111' || val === String(_pin)) {
            _content = cloneConfig(_config);
            return Promise.resolve('ok');
        }
        return Promise.resolve('bad');
    }

    function content() {
        if (!_content) return null;
        return Object.assign({}, _content, _override);
    }

    function sync() {
        if (_content) {
            _content = cloneConfig(_config);
        }
        return Promise.resolve('ok');
    }

    function leaseValid() {
        return Promise.resolve(true);
    }

    function gate() {
        return Promise.resolve({
            ok: true,
            needMain: false,
            needSup: false,
            takeover: false
        });
    }

    function deauthorize() {
        _content = null;
        return Promise.resolve();
    }

    function devSet(patch) {
        if (!patch || typeof patch !== 'object') return Promise.resolve();
        for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) {
                _override[k] = patch[k];
            }
        }
        if (_content) {
            _content = Object.assign({}, _content, _override);
        }
        saveStorage();
        return Promise.resolve();
    }

    function devClear() {
        _override = {};
        _content = cloneConfig(_config);
        saveStorage();
        return Promise.resolve();
    }

    function devOverrides() {
        return Object.assign({}, _override);
    }

    function saveConfig() {
        _config = Object.assign({}, _config, _override);
        saveStorage();
        return Promise.resolve({ ok: true });
    }

    function pdfGate() {
        return Promise.resolve({ ok: true, free: true });
    }

    window.RID = {
        isProvisioned: isProvisioned,
        provision: provision,
        verify: verify,
        content: content,
        sync: sync,
        leaseValid: leaseValid,
        gate: gate,
        deauthorize: deauthorize,
        devSet: devSet,
        devClear: devClear,
        devOverrides: devOverrides,
        saveConfig: saveConfig,
        pdfGate: pdfGate,
        deviceId: function () { return Promise.resolve('LOCAL-DEVICE'); },
        acctKey: function () { return Promise.resolve('LOCAL-ACCOUNT'); },
        qrSeed: function () { return Promise.resolve(_qrSeed); },
        qrImage: function () { return Promise.resolve(_qrImage); },
        noEdit: function () { return _noEdit; },
        demo: function () { return _demo; },
        _botSetConfig: function (patch) {
            _config = Object.assign({}, _config, patch || {});
            if (_content) _content = cloneConfig(_config);
            saveStorage();
            return Promise.resolve();
        },
        _botSetPin: function (newPin) {
            _pin = String(newPin == null ? LOCAL_PIN : newPin);
            saveStorage();
            return Promise.resolve();
        },
        _botSetSub: function () {
            return Promise.resolve();
        },
        _resetDemo: function () {
            _pin = LOCAL_PIN;
            _config = cloneConfig(DEFAULT_CONFIG);
            _override = {};
            _qrSeed = 'LOCAL-DEMO';
            _qrImage = '';
            _noEdit = false;
            _demo = false;
            _content = null;
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            return Promise.resolve();
        }
    };
})();