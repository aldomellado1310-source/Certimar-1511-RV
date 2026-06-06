// Test de la normalización del PDF para el adjunto de correo.
// Reproduce el bug: el primer envío salía dañado porque jsPDF entrega
// "data:application/pdf;filename=generated.pdf;base64,..." y el recorte
// del prefijo solo contemplaba "data:application/pdf;base64,".
// Ejecutar: node test/pdfMail.test.js
const assert = require('assert');
const { pdfDataUriToBase64 } = require('../public/pdfMail.js');

// Base64 de ejemplo (representa los bytes del PDF). NO debe alterarse.
const B64 = 'JVBERi0xLjQKJ+aQ8w==';

// 1) Formato de jsPDF output('datauristring') — con ;filename= en medio.
//    Antes del fix este caso devolvía el prefijo completo => PDF dañado.
assert.strictEqual(
  pdfDataUriToBase64('data:application/pdf;filename=generated.pdf;base64,' + B64),
  B64,
  'jsPDF datauristring con filename debe quedar en base64 limpio'
);

// 2) Prefijo canónico (lo que usa Storage/reenvío) — siempre funcionó.
assert.strictEqual(
  pdfDataUriToBase64('data:application/pdf;base64,' + B64),
  B64,
  'data URI canónico debe quedar en base64 limpio'
);

// 3) Base64 crudo (sin prefijo) se devuelve tal cual.
assert.strictEqual(
  pdfDataUriToBase64(B64),
  B64,
  'base64 sin prefijo se devuelve igual'
);

// 4) Saltos de línea / espacios se eliminan (defensa).
assert.strictEqual(
  pdfDataUriToBase64('data:application/pdf;base64,\n' + B64.slice(0, 8) + '\r\n' + B64.slice(8)),
  B64,
  'whitespace dentro del base64 se elimina'
);

// 5) Entradas vacías / nulas no rompen.
assert.strictEqual(pdfDataUriToBase64(''),   '', 'string vacío');
assert.strictEqual(pdfDataUriToBase64(null), '', 'null');
assert.strictEqual(pdfDataUriToBase64(undefined), '', 'undefined');

console.log('OK: pdfDataUriToBase64 (7 casos)');
