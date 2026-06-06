// Ejecutar: node test/firmaHelpers.test.js
const assert = require('assert');
const { tokenCoincide, normalizarNombre, normalizarEmail, esEmailValido } =
  require('../functions/firmaHelpers.js');

// tokenCoincide: ambos no vacíos e iguales
assert.strictEqual(tokenCoincide('abc', 'abc'), true,  'tokens iguales');
assert.strictEqual(tokenCoincide('abc', 'xyz'), false, 'tokens distintos');
assert.strictEqual(tokenCoincide('',    ''),    false, 'token vacío nunca valida');
assert.strictEqual(tokenCoincide('abc', ''),    false, 'token guardado vacío');
assert.strictEqual(tokenCoincide(null,  'abc'), false, 'null no valida');
assert.strictEqual(tokenCoincide('abc', null),  false, 'token recibido null');

// normalizarNombre: trim; '' si <3 chars
assert.strictEqual(normalizarNombre('  Juan Pérez  '), 'Juan Pérez', 'trim');
assert.strictEqual(normalizarNombre('ab'), '', 'menos de 3 chars => vacío');
assert.strictEqual(normalizarNombre(null),       '',    'null => vacío');

// email
assert.strictEqual(esEmailValido('a@b.cl'), true,  'email válido');
assert.strictEqual(esEmailValido('a@b'),    false, 'sin TLD');
assert.strictEqual(esEmailValido(null),     false, 'null => inválido');
assert.strictEqual(normalizarEmail('  A@B.CL '), 'a@b.cl', 'trim + lowercase');

console.log('OK: firmaHelpers (todos los casos)');
