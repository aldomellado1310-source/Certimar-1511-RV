// Certimar RV — Normalización del PDF para envío y guardado.
//
// Objetivo: que el PDF generado, enviado y guardado sea UNO SOLO (mismos bytes).
//
// El bug histórico: jsPDF `output('datauristring')` entrega
//   "data:application/pdf;filename=generated.pdf;base64,<bytes>"
// (con el segmento `;filename=generated.pdf` en medio). El armado del correo
// recortaba solo "data:application/pdf;base64," y dejaba el prefijo dentro del
// adjunto => PDF dañado en el primer envío. Al reenviar desde Storage el prefijo
// era el canónico y sí se recortaba, por eso reenviar funcionaba.
//
// `pdfDataUriToBase64` recorta cualquier prefijo data-URI (con o sin filename)
// y devuelve base64 limpio, sin espacios ni saltos de línea.

// Prefijo canónico para reconstruir un data-URI de PDF a partir de base64 limpio.
var PDF_DATA_URI_PREFIX = 'data:application/pdf;base64,';

// Normaliza cualquier entrada (data-URI de PDF, con/sin filename, o base64 crudo)
// a base64 limpio. El alfabeto base64 nunca contiene ';base64,', así que ese
// marcador solo aparece en el prefijo de un data-URI: lo usamos como ancla.
function pdfDataUriToBase64(input) {
  var s = (input === null || input === undefined) ? '' : String(input);
  var marker = ';base64,';
  var idx = s.indexOf(marker);
  if (idx !== -1) s = s.slice(idx + marker.length);
  return s.replace(/[\s\r\n]+/g, '');
}

// Envuelve base64 limpio en el data-URI canónico de PDF.
function pdfBase64ToDataUri(b64) {
  return PDF_DATA_URI_PREFIX + pdfDataUriToBase64(b64);
}

// --- Exposición en navegador ---
if (typeof window !== 'undefined') {
  window.pdfDataUriToBase64 = pdfDataUriToBase64;
  window.pdfBase64ToDataUri = pdfBase64ToDataUri;
  window.PDF_DATA_URI_PREFIX = PDF_DATA_URI_PREFIX;
}

// --- Exporta lógica pura para test en Node (no afecta al navegador) ---
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pdfDataUriToBase64: pdfDataUriToBase64,
    pdfBase64ToDataUri: pdfBase64ToDataUri,
    PDF_DATA_URI_PREFIX: PDF_DATA_URI_PREFIX
  };
}
