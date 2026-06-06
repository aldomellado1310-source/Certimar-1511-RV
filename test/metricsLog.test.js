// Test de la lógica pura del logger de métricas (sin DOM ni Firebase).
// Ejecutar: node test/metricsLog.test.js
const assert = require('assert');
const {
  _mTruncate, _mExpireAtMs, _mShouldDedupeError, _mBuildEntry
} = require('../public/metricsLog.js');

// _mTruncate: corta a max y es null-safe
assert.strictEqual(_mTruncate('hola', 10), 'hola',        'no corta si cabe');
assert.strictEqual(_mTruncate('hola mundo', 4), 'hola',   'corta a 4');
assert.strictEqual(_mTruncate(null, 5), '',               'null -> ""');
assert.strictEqual(_mTruncate(undefined, 5), '',          'undefined -> ""');

// _mExpireAtMs: now + días
const NOW = 1000000000000;
assert.strictEqual(_mExpireAtMs(NOW, 90), NOW + 90 * 24 * 60 * 60 * 1000, 'expireAt 90d');

// _mShouldDedupeError: misma firma dentro de la ventana -> descartar
const map = {};
assert.strictEqual(_mShouldDedupeError('sig', map, NOW, 60000), false,         '1ra vez no descarta');
assert.strictEqual(_mShouldDedupeError('sig', map, NOW + 1000, 60000), true,   'dentro de ventana descarta');
assert.strictEqual(_mShouldDedupeError('sig', map, NOW + 61000, 60000), false, 'fuera de ventana no descarta');

// _mBuildEntry: acota detail, trunca strings, no setea campos ausentes
const ctx = { user:'a@certimar.cl', name:'A', view:'admin', ua:'UA', appVer:'v1' };
const e = _mBuildEntry('action', 'rv_create',
  { ok:true, detail:{ nro:'RV-1', big:'x'.repeat(500), nil:null } }, ctx, NOW);
assert.strictEqual(e.type, 'action',          'type');
assert.strictEqual(e.event, 'rv_create',      'event');
assert.strictEqual(e.user, 'a@certimar.cl',   'user');
assert.strictEqual(e.ok, true,                'ok bool');
assert.strictEqual(e.detail.nro, 'RV-1',      'detail.nro');
assert.strictEqual(e.detail.big.length, 200,  'detail string truncado a 200');
assert.ok(!('nil' in e.detail),               'descarta valores null en detail');
assert.strictEqual(e.expireAtMs, NOW + 90 * 24 * 60 * 60 * 1000, 'expireAtMs');
assert.ok(!('durationMs' in e),               'no setea durationMs si no viene');

// _mBuildEntry: user por defecto 'anon' cuando no hay ctx
const e2 = _mBuildEntry('activity', 'login', {}, null, NOW);
assert.strictEqual(e2.user, 'anon', 'sin ctx -> anon');

console.log('OK: metricsLog pure helpers (todos los casos)');
