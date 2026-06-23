// Ejecutar: node test/firmaCanvas.test.js
const assert = require('assert');
const { firmaFitContain } = require('../public/firmaCanvas.js');

// Imagen más ancha que la caja => encaja por ancho, centrada verticalmente
let r = firmaFitContain(560, 90, 280, 90);
assert.strictEqual(r.dw, 280, 'ancho: dw llena la caja');
assert.strictEqual(r.dh, 45,  'ancho: dh escalado');
assert.strictEqual(r.dx, 0,   'ancho: sin offset x');
assert.strictEqual(r.dy, 22.5,'ancho: centrada en y');

// Imagen más alta que la caja => encaja por alto, centrada horizontalmente
r = firmaFitContain(280, 360, 280, 90);
assert.strictEqual(r.dw, 70,  'alto: dw escalado');
assert.strictEqual(r.dh, 90,  'alto: dh llena la caja');
assert.strictEqual(r.dx, 105, 'alto: centrada en x');
assert.strictEqual(r.dy, 0,   'alto: sin offset y');

// Misma proporción => llena la caja sin offset
r = firmaFitContain(280, 90, 280, 90);
assert.deepStrictEqual(r, { dw: 280, dh: 90, dx: 0, dy: 0 }, 'misma proporción');

// imgW/imgH falsy => fallback a caja completa (sin dividir por cero)
r = firmaFitContain(0, 0, 280, 90);
assert.deepStrictEqual(r, { dw: 280, dh: 90, dx: 0, dy: 0 }, 'falsy => caja completa');

console.log('OK: firmaCanvas (todos los casos)');
