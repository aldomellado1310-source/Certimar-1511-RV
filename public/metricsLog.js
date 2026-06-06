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

// ---------- Runtime (navegador) ----------

var _mDb          = null;     // instancia Firestore
var _mGetUser     = null;     // function() -> currentUser | null
var _mQueue       = [];       // eventos pendientes de volcado
var _mFlushTimer  = null;
var _mHandlersOn  = false;
var _mGuard       = false;    // evita recursión (no loguear fallos del propio logger)
var _mWarned      = false;
var _mLastErr     = {};       // firma de error -> último ts (dedupe)
var _mLastView    = null;     // última vista logueada (dedupe view_change)
var _M_MAX_QUEUE  = 200;      // tope de cola en memoria
var _M_FLUSH_EVERY= 15000;    // ms entre volcados periódicos
var _M_FLUSH_AT   = 20;       // tamaño de cola que dispara volcado inmediato
var _M_ERR_WINDOW = 60000;    // ventana de dedupe de errores (ms)
var _M_APP_VER    = 'v20260605';

function _mWarnOnce(label, e) {
  if (_mWarned) return; _mWarned = true;
  try { console.warn('[metrics] ' + label + ':', e && e.message ? e.message : e); } catch (x) {}
}

function _mCtx() {
  var u = null;
  try { u = _mGetUser ? _mGetUser() : null; } catch (e) { u = null; }
  return {
    user  : (u && u.email) ? u.email : 'anon',
    name  : (u && u.name)  ? u.name  : '',
    view  : _mLastView || '',
    ua    : (typeof navigator !== 'undefined') ? navigator.userAgent : '',
    appVer: _M_APP_VER
  };
}

function _mCanFlush() {
  var u = null;
  try { u = _mGetUser ? _mGetUser() : null; } catch (e) {}
  return !!(_mDb && u && u.email && /@certimar\.cl$/i.test(u.email));
}

function _mEnqueue(entry) {
  _mQueue.push(entry);
  if (_mQueue.length > _M_MAX_QUEUE) _mQueue.splice(0, _mQueue.length - _M_MAX_QUEUE);
  if (_mQueue.length >= _M_FLUSH_AT) _mFlush();
}

function _mFlush() {
  if (!_mQueue.length) return;
  if (!_mCanFlush()) return;                 // pre-auth / página pública de firma: bufferiza
  var items = _mQueue.splice(0, 450);
  try {
    var batch = _mDb.batch();
    var col   = _mDb.collection('metrics_logs');
    var FV    = firebase.firestore.FieldValue;
    items.forEach(function(it) {
      var doc = {
        ts      : FV.serverTimestamp(),
        type    : it.type, event: it.event, user: it.user, name: it.name,
        view    : it.view, ua: it.ua, appVer: it.appVer, clientTs: it.clientTs,
        expireAt: firebase.firestore.Timestamp.fromMillis(it.expireAtMs)
      };
      if ('ok' in it)         doc.ok = it.ok;
      if ('durationMs' in it) doc.durationMs = it.durationMs;
      if ('msg' in it)        doc.msg = it.msg;
      if ('stack' in it)      doc.stack = it.stack;
      if ('detail' in it)     doc.detail = it.detail;
      batch.set(col.doc(), doc);
    });
    batch.commit().catch(function(e) {
      _mQueue = items.concat(_mQueue).slice(-_M_MAX_QUEUE);   // re-encola acotado
      _mWarnOnce('flush commit failed', e);
    });
  } catch (e) {
    _mQueue = items.concat(_mQueue).slice(-_M_MAX_QUEUE);
    _mWarnOnce('flush build failed', e);
  }
}

function _mLog(type, event, fields) {
  if (_mGuard) return;                        // no loguear desde dentro del logger
  _mGuard = true;
  try {
    var now = Date.now();
    if (type === 'error') {
      var sig = event + '|' + ((fields && fields.msg) || '');
      if (_mShouldDedupeError(sig, _mLastErr, now, _M_ERR_WINDOW)) { _mGuard = false; return; }
    }
    if (event === 'view_change' && fields && fields.view) {
      if (fields.view === _mLastView) { _mGuard = false; return; }
      _mLastView = fields.view;
    }
    _mEnqueue(_mBuildEntry(type, event, fields, _mCtx(), now));
  } catch (e) {
    _mWarnOnce('log failed', e);
  }
  _mGuard = false;
}

function _mInstallHandlers() {
  if (typeof window === 'undefined' || _mHandlersOn) return;
  _mHandlersOn = true;
  window.addEventListener('error', function(ev) {
    Metrics.error('js_error', ev.error || ev.message, {
      detail: { src: ev.filename || '', line: ev.lineno || 0, col: ev.colno || 0 }
    });
  });
  window.addEventListener('unhandledrejection', function(ev) {
    var r = ev.reason;
    Metrics.error('promise_rejection', (r && r.message) ? r : String(r));
  });
  window.addEventListener('visibilitychange', function() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') _mFlush();
  });
  window.addEventListener('pagehide', function() { _mFlush(); });
}

var Metrics = {
  // getUser: function()->currentUser|null ; db: instancia Firestore
  init: function(getUser, db) {
    _mGetUser = getUser; _mDb = db;
    if (!_mFlushTimer) _mFlushTimer = setInterval(_mFlush, _M_FLUSH_EVERY);
    _mInstallHandlers();
  },
  setUser: function() { _mFlush(); },          // al cambiar de usuario, vuelca lo pendiente
  error: function(event, errOrMsg, fields) {
    fields = fields || {};
    if (errOrMsg && errOrMsg.message) { fields.msg = errOrMsg.message; fields.stack = errOrMsg.stack; }
    else if (errOrMsg) { fields.msg = String(errOrMsg); }
    _mLog('error', event, fields);
  },
  action: function(event, ok, fields) { fields = fields || {}; fields.ok = !!ok; _mLog('action', event, fields); },
  activity: function(event, fields) { _mLog('activity', event, fields); },
  perf: function(event, durationMs, fields) { fields = fields || {}; fields.durationMs = durationMs; _mLog('perf', event, fields); },
  time: function() { var t0 = Date.now(); return function() { return Date.now() - t0; }; },
  flush: function() { _mFlush(); }
};

if (typeof window !== 'undefined') window.Metrics = Metrics;

// ---------- Exporta lógica pura para test en Node (no afecta al navegador) ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    _mTruncate: _mTruncate,
    _mExpireAtMs: _mExpireAtMs,
    _mShouldDedupeError: _mShouldDedupeError,
    _mBuildEntry: _mBuildEntry
  };
}
