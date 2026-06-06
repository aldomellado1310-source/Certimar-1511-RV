'use strict';
// Helpers puros (sin firebase-admin) para poder testear en node.

function tokenCoincide(tokenGuardado, tokenRecibido) {
  return !!tokenGuardado && !!tokenRecibido && tokenGuardado === tokenRecibido;
}

function normalizarNombre(n) {
  const s = (n == null ? '' : String(n)).trim();
  return s.length >= 3 ? s : ''; // mínimo 3 caracteres — evita iniciales/typos
}

function esEmailValido(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e == null ? '' : e).trim());
}

function normalizarEmail(e) {
  return String(e == null ? '' : e).trim().toLowerCase();
}

module.exports = { tokenCoincide, normalizarNombre, esEmailValido, normalizarEmail };
