// Test de la lógica pura de expiración del token de Gmail.
// Ejecutar: node test/gmailAuth.test.js
const assert = require('assert');
const { _isGmailTokenValid } = require('../public/gmailAuth.js');

const NOW  = 1000000000000;     // timestamp fijo en ms
const SKEW = 5 * 60 * 1000;     // 5 min

// Token que expira en 1h -> válido
assert.strictEqual(_isGmailTokenValid('tok', NOW + 3600 * 1000, NOW, SKEW), true,  'token vigente');
// Token ya expirado -> inválido
assert.strictEqual(_isGmailTokenValid('tok', NOW - 1000, NOW, SKEW),        false, 'token expirado');
// Token que expira en 2 min (< skew de 5 min) -> tratar como inválido (toca refrescar)
assert.strictEqual(_isGmailTokenValid('tok', NOW + 2 * 60 * 1000, NOW, SKEW), false, 'dentro del skew');
// Sin token -> inválido aunque la fecha sea futura
assert.strictEqual(_isGmailTokenValid(null,  NOW + 3600 * 1000, NOW, SKEW), false, 'sin token');

assert.strictEqual(_isGmailTokenValid('tok', NOW + SKEW, NOW, SKEW), false, 'exactamente en el límite del skew -> inválido');
console.log('OK: _isGmailTokenValid (4 casos)');
