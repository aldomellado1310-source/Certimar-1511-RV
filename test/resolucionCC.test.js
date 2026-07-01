// Test de la lógica pura de CC condicional por certificación.
// Ejecutar: node test/resolucionCC.test.js
const assert = require('assert');
const { getResolucionCCs } = require('../public/resolucionCC.js');

// --- Forma objeto (checkboxes del formulario) ---

// Solo 1821-x (una de las tres) -> informes@
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: true, ca: false, vs: false, res1511: false, desinfeccion: false }),
  ['informes@certimar.cl'],
  'solo cicE2 -> informes@'
);
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: false, ca: true, vs: false, res1511: false, desinfeccion: false }),
  ['informes@certimar.cl'],
  'solo ca -> informes@'
);
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: false, ca: false, vs: true, res1511: false, desinfeccion: false }),
  ['informes@certimar.cl'],
  'solo vs -> informes@'
);

// Solo 1511 -> operaciones@
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: false, ca: false, vs: false, res1511: true, desinfeccion: false }),
  ['operaciones@certimar.cl'],
  'solo 1511 -> operaciones@'
);

// 1821-x + 1511 -> ambos
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: true, ca: false, vs: false, res1511: true, desinfeccion: false }),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'cicE2 + 1511 -> ambos'
);

// Múltiples 1821-x + 1511 -> ambos (sin duplicar informes@)
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: true, ca: true, vs: true, res1511: true, desinfeccion: false }),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'cicE2+ca+vs+1511 -> ambos, sin duplicados'
);

// Ninguno (solo desinfección) -> ambos como respaldo
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: false, ca: false, vs: false, res1511: false, desinfeccion: true }),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'solo desinfeccion -> ambos (respaldo)'
);

// Nada marcado -> ambos como respaldo
assert.deepStrictEqual(
  getResolucionCCs({ cicE2: false, ca: false, vs: false, res1511: false, desinfeccion: false }),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'nada marcado -> ambos (respaldo)'
);

// resoluciones vacío/null -> ambos como respaldo
assert.deepStrictEqual(
  getResolucionCCs(null),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'null -> ambos (respaldo)'
);

// --- Forma string (ya persistido en Firestore, vía admReenviarMail) ---

assert.deepStrictEqual(
  getResolucionCCs('1821-CIC E2, 1511'),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'string "1821-CIC E2, 1511" -> ambos'
);
assert.deepStrictEqual(
  getResolucionCCs('1821-VS'),
  ['informes@certimar.cl'],
  'string "1821-VS" -> informes@'
);
assert.deepStrictEqual(
  getResolucionCCs('1511'),
  ['operaciones@certimar.cl'],
  'string "1511" -> operaciones@'
);
assert.deepStrictEqual(
  getResolucionCCs('DESINFECCIÓN'),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'string "DESINFECCIÓN" -> ambos (respaldo)'
);
assert.deepStrictEqual(
  getResolucionCCs(''),
  ['informes@certimar.cl', 'operaciones@certimar.cl'],
  'string vacío -> ambos (respaldo)'
);

console.log('OK: getResolucionCCs (13 casos)');
