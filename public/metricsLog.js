// Certimar RV — Captura de métricas (errores, acciones, actividad, rendimiento).
// Escribe en Firestore /metrics_logs por lotes. Nunca rompe la app: todo en try/catch,
// cola acotada y guardia anti-recursión. Retención 90 días vía campo expireAt (TTL Firestore).

var _M_RETENTION_D = 90;          // días de retención (expireAt)

// ---------- Lógica pura testeable (sin DOM ni Firebase) ----------

// Trunca un string a max chars (null-safe). Devuelve '' si no es string.
function _mTruncate(str, max) {
  if (typeof str !== 'string') return '';
  return str.length > max ? str.slice(0, max) : str;
}

// expireAt en ms = nowMs + días*24h.
function _mExpireAtMs(nowMs, days) {
  return nowMs + days * 24 * 60 * 60 * 1000;
}

// ¿Descartar este error por duplicado reciente? Muta lastMap. true => descartar.
function _mShouldDedupeError(sig, lastMap, nowMs, windowMs) {
  var prev = lastMap[sig];
  if (prev && (nowMs - prev) < windowMs) return true;
  lastMap[sig] = nowMs;
  return false;
}

// Construye el objeto de log (sin serverTimestamp; ts se agrega al volcar).
// ctx = { user, name, view, ua, appVer }. Devuelve un objeto plano y acotado.
function _mBuildEntry(type, event, fields, ctx, nowMs) {
  fields = fields || {};
  var entry = {
    type      : String(type),
    event     : String(event),
    user      : (ctx && ctx.user)   || 'anon',
    name      : (ctx && ctx.name)   || '',
    view      : (ctx && ctx.view)   || '',
    ua        : _mTruncate((ctx && ctx.ua) || '', 300),
    appVer    : (ctx && ctx.appVer) || '',
    clientTs  : nowMs,
    expireAtMs: _mExpireAtMs(nowMs, _M_RETENTION_D)
  };
  if (typeof fields.ok === 'boolean')        entry.ok = fields.ok;
  if (typeof fields.durationMs === 'number') entry.durationMs = Math.round(fields.durationMs);
  if (fields.msg)   entry.msg   = _mTruncate(String(fields.msg), 500);
  if (fields.stack) entry.stack = _mTruncate(String(fields.stack), 1500);
  if (fields.detail && typeof fields.detail === 'object') {
    var d = {}, n = 0;
    for (var k in fields.detail) {
      if (!Object.prototype.hasOwnProperty.call(fields.detail, k)) continue;
      if (n++ >= 20) break;
      var v = fields.detail[k];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string')      d[k] = _mTruncate(v, 200);
      else if (typeof v === 'number' || typeof v === 'boolean') d[k] = v;
    }
    entry.detail = d;
  }
  return entry;
}

// ---------- Exporta lógica pura para test en Node (no afecta al navegador) ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    _mTruncate: _mTruncate,
    _mExpireAtMs: _mExpireAtMs,
    _mShouldDedupeError: _mShouldDedupeError,
    _mBuildEntry: _mBuildEntry
  };
}
