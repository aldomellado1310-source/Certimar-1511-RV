// Certimar RV — CC condicional por tipo de certificación seleccionada.
// Regla: 1821-x (CIC E2 / CA / VS) -> informes@certimar.cl;
//        1511 -> operaciones@certimar.cl;
//        ninguno de los dos (ej. solo DESINFECCIÓN) -> ambos como respaldo.
// Ver docs/superpowers/specs/2026-07-01-cc-por-certificacion-design.md

// Normaliza 'resoluciones' (objeto de checkboxes del formulario, o string ya
// persistido en Firestore) a un string tipo "1821-CIC E2, 1511".
// Espejo de buildResExt() en index.html (misma lógica, copia local para no
// reordenar la carga de scripts existente).
function _resolucionesAString(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  var arr = [];
  if (res.cicE2)       arr.push('1821-CIC E2');
  if (res.ca)          arr.push('1821-CA');
  if (res.vs)          arr.push('1821-VS');
  if (res.res1511)     arr.push('1511');
  if (res.desinfeccion) arr.push('DESINFECCIÓN');
  return arr.join(', ');
}

// Dado el estado de 'resoluciones' marcadas, retorna los emails de copia
// (CC) que dependen del tipo de certificación seleccionada.
function getResolucionCCs(resoluciones) {
  var tokens = _resolucionesAString(resoluciones)
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(Boolean);
  var tiene1821 = tokens.some(function(t) { return t.indexOf('1821-') === 0; });
  var tiene1511 = tokens.indexOf('1511') !== -1;

  var emails = [];
  if (tiene1821) emails.push('informes@certimar.cl');
  if (tiene1511) emails.push('operaciones@certimar.cl');
  if (!tiene1821 && !tiene1511) {
    emails.push('informes@certimar.cl', 'operaciones@certimar.cl');
  }
  return emails;
}

// Exporta la lógica pura para test en Node (no afecta al navegador).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getResolucionCCs: getResolucionCCs };
}
