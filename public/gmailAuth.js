// Certimar RV — Token de Gmail (scope gmail.send) vía Google Identity Services (GIS).
// Firebase Auth = identidad; GIS = access token de Gmail. Refresco silencioso mientras
// haya sesión de Google viva. Resuelve el error "Sin token Gmail" tras restaurar sesión.

var _gmailToken       = null;   // access token actual
var _gmailTokenExp    = 0;      // timestamp (ms) de expiración
var _gmailTokenClient = null;   // instancia de GIS token client
var _gmailPendingResolve = null;
var _gmailPendingReject  = null;
var _gmailPendingPromise = null;
var _GMAIL_SCOPE   = 'https://www.googleapis.com/auth/gmail.send';
var _GMAIL_SKEW_MS = 5 * 60 * 1000; // refrescar 5 min antes de vencer

// --- Lógica pura testeable: ¿el token sigue válido en `nowMs`? ---
function _isGmailTokenValid(token, expMs, nowMs, skewMs) {
  return !!token && (expMs - skewMs) > nowMs;
}

// Espera a que el SDK de GIS esté disponible (se carga con <script async>).
function _whenGisReady(timeoutMs) {
  return new Promise(function(resolve) {
    var start = Date.now();
    (function poll() {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        return resolve(true);
      }
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(poll, 150);
    })();
  });
}

// Crea (una sola vez) el token client de GIS. Devuelve true si quedó listo.
function initGmailAuth() {
  if (_gmailTokenClient) return true;
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return false;
  if (typeof GOOGLE_OAUTH_CLIENT_ID === 'undefined' || !GOOGLE_OAUTH_CLIENT_ID) {
    console.error('[gmailAuth] Falta GOOGLE_OAUTH_CLIENT_ID en firebaseConfig.js');
    return false;
  }
  _gmailTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: _GMAIL_SCOPE,
    callback: function(resp) {
      if (resp && resp.access_token) {
        _gmailToken = resp.access_token;
        var ttlMs = (resp.expires_in ? resp.expires_in : 3600) * 1000;
        _gmailTokenExp = Date.now() + ttlMs;
        if (_gmailPendingResolve) _gmailPendingResolve(_gmailToken);
      } else {
        var msg = (resp && resp.error) ? resp.error : 'No se obtuvo token de Gmail.';
        if (_gmailPendingReject) _gmailPendingReject(new Error(msg));
      }
      _gmailPendingResolve = null; _gmailPendingReject = null;
    },
    error_callback: function(err) {
      var msg = (err && err.message) ? err.message : 'Acceso a Gmail no autorizado.';
      if (_gmailPendingReject) _gmailPendingReject(new Error(msg));
      _gmailPendingResolve = null; _gmailPendingReject = null;
    }
  });
  return true;
}

// Pide un token a GIS con el prompt indicado. prompt 'none' = silencioso; 'consent' = muestra UI.
function _requestGmailToken(prompt, loginHint) {
  if (_gmailPendingPromise) return _gmailPendingPromise;
  _gmailPendingPromise = new Promise(function(resolve, reject) {
    if (!initGmailAuth()) { reject(new Error('Google Identity Services no disponible.')); return; }
    _gmailPendingResolve = resolve;
    _gmailPendingReject  = reject;
    try {
      var opts = { prompt: prompt };
      if (loginHint) opts.hint = loginHint;
      _gmailTokenClient.requestAccessToken(opts);
    } catch (e) {
      _gmailPendingResolve = null; _gmailPendingReject = null;
      reject(e);
    }
  }).finally(function() { _gmailPendingPromise = null; });
  return _gmailPendingPromise;
}

// Garantiza un token válido. Silencioso primero; consentimiento si hace falta.
function ensureGmailToken(loginHint) {
  if (_isGmailTokenValid(_gmailToken, _gmailTokenExp, Date.now(), _GMAIL_SKEW_MS)) {
    return Promise.resolve(_gmailToken);
  }
  return _whenGisReady(8000).then(function(ready) {
    if (!ready) throw new Error('No se pudo cargar Google Identity Services. Revisa tu conexión y recarga.');
    return _requestGmailToken('none', loginHint).catch(function() {
      return _requestGmailToken('consent', loginHint);
    });
  });
}

// Invalida el token actual (p.ej. tras 401/403 de Gmail).
function invalidateGmailToken() {
  _gmailToken = null;
  _gmailTokenExp = 0;
}

// Exporta la lógica pura para test en Node (no afecta al navegador).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _isGmailTokenValid: _isGmailTokenValid };
}
