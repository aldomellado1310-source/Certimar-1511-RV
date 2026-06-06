// Ejecutar: node test/firmaPage.test.js
const assert = require('assert');
const { firmaFormListo } = require('../public/firmaPage.js');

// firmaFormListo(hasFirma, nombre, email) -> bool
assert.strictEqual(firmaFormListo(true,  'Juan Pérez', 'a@b.cl'), true,  'todo ok');
assert.strictEqual(firmaFormListo(false, 'Juan Pérez', 'a@b.cl'), false, 'sin firma');
assert.strictEqual(firmaFormListo(true,  'ab',         'a@b.cl'), false, 'nombre corto');
assert.strictEqual(firmaFormListo(true,  'Juan Pérez', 'a@b'),    false, 'email inválido');

console.log('OK: firmaPage (4 casos)');
