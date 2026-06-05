# Token de Gmail vía GIS con refresco silencioso — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el envío de correo desde el frontend funcione tras restaurar sesión y tras expirar el token, obteniendo/refrescando el access token de `gmail.send` en silencio con Google Identity Services (GIS), sin el error "Sin token Gmail. Vuelve a iniciar sesión."

**Architecture:** Se separan las dos credenciales: Firebase Auth queda solo para identidad (login, gating `@certimar.cl`, roles) y un nuevo módulo `public/gmailAuth.js` obtiene el token de Gmail vía GIS token client, con warm-up silencioso tras el login y consentimiento automático solo la primera vez. `sendViaGmailAPI` pide el token a `ensureGmailToken()` y reintenta una vez ante 401/403.

**Tech Stack:** HTML/JS vanilla (sin framework ni bundler), Firebase Hosting + Auth + Firestore, Google Identity Services (`https://accounts.google.com/gsi/client`), Gmail REST API. Pruebas unitarias de lógica pura con `node` + `assert` (Node 20).

**Spec:** [docs/superpowers/specs/2026-06-05-gmail-gis-silent-token-design.md](../specs/2026-06-05-gmail-gis-silent-token-design.md)

---

## Estructura de archivos

- **Crear** `public/gmailAuth.js` — módulo único responsable del access token de Gmail (init GIS, warm-up, ensure/refresh, invalidación). Lógica pura de expiración exportable para test en Node.
- **Crear** `test/gmailAuth.test.js` — test Node de la lógica pura `_isGmailTokenValid` (fuera de `public/`, no se despliega).
- **Modificar** `public/firebaseConfig.js` — agregar `GOOGLE_OAUTH_CLIENT_ID`.
- **Modificar** `public/index.html` — cargar GIS + `gmailAuth.js`, bumpear versión de `firebaseConfig.js`, quitar manejo viejo del token, warm-up en `onAuthStateChanged`, reescribir `sendViaGmailAPI`.
- **Modificar** `public/sw.js` — bump `CACHE_NAME`, agregar `/gmailAuth.js` a assets, pasar `accounts.google.com` por red.

---

## Task 1: Módulo `gmailAuth.js` + test de lógica pura (TDD)

**Files:**
- Create: `public/gmailAuth.js`
- Test: `test/gmailAuth.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/gmailAuth.test.js`:

```js
// Test de la lógica pura de expiración del token de Gmail.
// Ejecutar: node test/gmailAuth.test.js
const assert = require('assert');
const { _isGmailTokenValid } = require('../public/gmailAuth.js');

const NOW  = 1000000000000;     // timestamp fijo en ms
const SKEW = 5 * 60 * 1000;     // 5 min

// Token que expira en 1h -> válido
assert.strictEqual(_isGmailTokenValid('tok', NOW + 3600 * 1000, NOW, SKEW), true,  'token vigente');
// Token ya expirado -> inválido
assert.strictEqual(_isGmailTokenValid('tok', NOW - 1000, NOW, SKEW),        false, 'token expirado');
// Token que expira en 2 min (< skew de 5 min) -> tratar como inválido (toca refrescar)
assert.strictEqual(_isGmailTokenValid('tok', NOW + 2 * 60 * 1000, NOW, SKEW), false, 'dentro del skew');
// Sin token -> inválido aunque la fecha sea futura
assert.strictEqual(_isGmailTokenValid(null,  NOW + 3600 * 1000, NOW, SKEW), false, 'sin token');

console.log('OK: _isGmailTokenValid (4 casos)');
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node test/gmailAuth.test.js`
Expected: FALLA con `Cannot find module '../public/gmailAuth.js'` (el módulo aún no existe).

- [ ] **Step 3: Crear `public/gmailAuth.js` con la implementación**

Crear `public/gmailAuth.js`:

```js
// Certimar RV — Token de Gmail (scope gmail.send) vía Google Identity Services (GIS).
// Firebase Auth = identidad; GIS = access token de Gmail. Refresco silencioso mientras
// haya sesión de Google viva. Resuelve el error "Sin token Gmail" tras restaurar sesión.

var _gmailToken       = null;   // access token actual
var _gmailTokenExp    = 0;      // timestamp (ms) de expiración
var _gmailTokenClient = null;   // instancia de GIS token client
var _gmailPendingResolve = null;
var _gmailPendingReject  = null;
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

// Pide un token a GIS con el prompt indicado. prompt '' = silencioso; 'consent' = muestra UI.
function _requestGmailToken(prompt, loginHint) {
  return new Promise(function(resolve, reject) {
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
  });
}

// Warm-up silencioso tras el login. No molesta si aún no hay consentimiento.
function warmGmailToken(loginHint) {
  return _whenGisReady(8000).then(function(ready) {
    if (!ready) return null;
    return _requestGmailToken('', loginHint).catch(function(e) {
      console.warn('[gmailAuth] Warm-up silencioso sin token (se pedirá al enviar):', e.message);
      return null;
    });
  });
}

// Garantiza un token válido. Silencioso primero; consentimiento si hace falta.
function ensureGmailToken(loginHint) {
  if (_isGmailTokenValid(_gmailToken, _gmailTokenExp, Date.now(), _GMAIL_SKEW_MS)) {
    return Promise.resolve(_gmailToken);
  }
  return _whenGisReady(8000).then(function(ready) {
    if (!ready) throw new Error('No se pudo cargar Google Identity Services. Revisa tu conexión y recarga.');
    return _requestGmailToken('', loginHint).catch(function() {
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
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node test/gmailAuth.test.js`
Expected: imprime `OK: _isGmailTokenValid (4 casos)` y sale con código 0.

- [ ] **Step 5: Commit**

```bash
git add public/gmailAuth.js test/gmailAuth.test.js
git commit -m "feat(gmail): modulo gmailAuth.js con token GIS y refresco silencioso"
```

> Mensaje en una sola línea (sin comillas dobles internas) para que funcione tal cual en PowerShell. Para añadir el trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, usa un archivo de mensaje con `git commit -F <archivo>` (las comillas/saltos rompen el paso de argumentos a git en PowerShell 5.1).

---

## Task 2: Config del Client ID en `firebaseConfig.js`

**Files:**
- Modify: `public/firebaseConfig.js`

- [ ] **Step 1: Agregar la constante del Client ID**

En `public/firebaseConfig.js`, después del objeto `FIREBASE_CONFIG` (antes del comentario de roles), agregar:

```js
// OAuth Web Client ID del proyecto certimar-rv (Google Cloud Console -> APIs y servicios ->
// Credenciales). Lo usa gmailAuth.js para pedir el token de gmail.send vía GIS.
var GOOGLE_OAUTH_CLIENT_ID = '272750169092-XXXXXXXX.apps.googleusercontent.com';
```

> El valor `272750169092-XXXXXXXX...` es un placeholder: reemplázalo por el Client ID real (Task 5, paso 2). El número de proyecto (`272750169092`) coincide con `messagingSenderId`.

- [ ] **Step 2: Commit**

```bash
git add public/firebaseConfig.js
git commit -m "feat(gmail): agrega GOOGLE_OAUTH_CLIENT_ID para GIS"
```

---

## Task 3: Cablear `index.html` (cargar scripts, quitar token viejo, warm-up, sendViaGmailAPI)

**Files:**
- Modify: `public/index.html` (líneas aproximadas: 23, 1772, 2317-2325, 2259-2265, 4754-4770)

- [ ] **Step 1: Cargar GIS y gmailAuth.js, y bumpear versión de firebaseConfig**

Buscar (línea ~23):

```html
<script src="firebaseConfig.js?v=20260522"></script>
```

Reemplazar por:

```html
<script src="firebaseConfig.js?v=20260605"></script>
<script src="https://accounts.google.com/gsi/client" async></script>
<script src="gmailAuth.js?v=20260605"></script>
```

> El cambio de `?v=` busta la caché HTTP (max-age 3600) y la del service worker para `firebaseConfig.js`.

- [ ] **Step 2: Quitar la variable `_gmailToken` de index.html**

Buscar (línea ~1772):

```js
var _gmailToken = null;   // OAuth access token con scope gmail.send
```

Eliminar esa línea por completo (la variable ahora vive en `gmailAuth.js`; dejarla aquí la reinicializaría a null al cargar).

- [ ] **Step 3: Quitar el scope gmail.send y la captura de token en `loginGoogle()`**

Buscar (líneas ~2317-2325):

```js
function loginGoogle() {
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/gmail.send');
  firebase.auth().signInWithPopup(provider).then(function(result) {
    _gmailToken = result.credential ? result.credential.accessToken : null;
  }).catch(function(e) {
    toast('Error al iniciar sesión: ' + e.message, 'error');
  });
}
```

Reemplazar por:

```js
function loginGoogle() {
  // Firebase Auth solo para identidad. El token de Gmail lo gestiona gmailAuth.js (GIS).
  var provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(function(e) {
    toast('Error al iniciar sesión: ' + e.message, 'error');
  });
}
```

- [ ] **Step 4: Warm-up del token tras restaurar/iniciar sesión**

Buscar en `onAuthStateChanged` el bloque que crea `currentUser` y llama a `showApp()` (líneas ~2259-2265):

```js
        currentUser = {
          email       : user.email,
          name        : name,
          isAdmin     : rol === 'admin',
          isSupervisor: rol === 'supervisor'
        };
        showApp();
```

Reemplazar por:

```js
        currentUser = {
          email       : user.email,
          name        : name,
          isAdmin     : rol === 'admin',
          isSupervisor: rol === 'supervisor'
        };
        // Calienta el token de Gmail en silencio (sin popup) para que el envío funcione
        // aunque la sesión se haya restaurado sin pasar por loginGoogle().
        warmGmailToken(currentUser.email);
        showApp();
```

- [ ] **Step 5: Reescribir `sendViaGmailAPI` para usar `ensureGmailToken` + reintento**

Buscar (líneas ~4754-4770):

```js
async function sendViaGmailAPI(raw) {
  if (!_gmailToken) throw new Error('Sin token Gmail. Vuelve a iniciar sesión.');
  var resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method : 'POST',
    headers: { 'Authorization': 'Bearer ' + _gmailToken, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ raw: raw })
  });
  if (resp.status === 401 || resp.status === 403) {
    _gmailToken = null;
    throw new Error('Sesión de correo expirada. Vuelve a iniciar sesión.');
  }
  if (!resp.ok) {
    var err = await resp.json().catch(function() { return {}; });
    throw new Error((err.error && err.error.message) ? err.error.message : 'Error Gmail API ' + resp.status);
  }
  return resp.json();
}
```

Reemplazar por:

```js
function _gmailSendRaw(raw, token) {
  return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method : 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ raw: raw })
  });
}

async function sendViaGmailAPI(raw) {
  var hint  = (currentUser && currentUser.email) ? currentUser.email : null;
  var token = await ensureGmailToken(hint);
  var resp  = await _gmailSendRaw(raw, token);
  // Token revocado/expirado a mitad: invalidar y reintentar una vez.
  if (resp.status === 401 || resp.status === 403) {
    invalidateGmailToken();
    token = await ensureGmailToken(hint);
    resp  = await _gmailSendRaw(raw, token);
  }
  if (!resp.ok) {
    var err = await resp.json().catch(function() { return {}; });
    throw new Error((err.error && err.error.message) ? err.error.message : 'Error Gmail API ' + resp.status);
  }
  return resp.json();
}
```

> Los 3 puntos de envío (`handleEnviarMail`, `handleCompletionEnviar`, `admReenviarMail`) ya llaman `await sendViaGmailAPI(raw)` dentro de un `try/catch` que muestra `e.message`, así que cualquier rechazo de `ensureGmailToken` (consentimiento denegado, GIS no disponible) se muestra con su mensaje accionable. No requieren cambios.

- [ ] **Step 6: Verificar que no quedan referencias al token viejo**

Run: `git grep -n "_gmailToken" -- public/index.html`
Expected: **sin resultados** (todas las referencias se movieron a `gmailAuth.js`).

Run: `git grep -n "Sin token Gmail" -- public/index.html`
Expected: **sin resultados** (el mensaje del bug fue eliminado).

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat(gmail): index usa gmailAuth (GIS) con warm-up y reintento; elimina token en memoria"
```

---

## Task 4: Service worker — cache y passthrough de GIS

**Files:**
- Modify: `public/sw.js` (líneas 4-5 y ~32-38)

- [ ] **Step 1: Bump del cache y registro del nuevo asset**

Buscar (líneas 4-5):

```js
const CACHE_NAME    = 'certimar-rv-v5';
const CACHE_ASSETS  = ['/', '/index.html', '/firebaseConfig.js', '/concesiones.js', '/aquachile.js'];
```

Reemplazar por:

```js
const CACHE_NAME    = 'certimar-rv-v6';
const CACHE_ASSETS  = ['/', '/index.html', '/firebaseConfig.js', '/gmailAuth.js', '/concesiones.js', '/aquachile.js'];
```

- [ ] **Step 2: Pasar `accounts.google.com` directo por red**

Buscar el bloque Network-First (líneas ~32-39):

```js
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudfunctions.net') ||
    url.hostname.includes('identitytoolkit') ||
    url.pathname.startsWith('/v1/') ||
    event.request.method !== 'GET'
  ) {
    return; // let browser handle normally
  }
```

Reemplazar por:

```js
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudfunctions.net') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('accounts.google.com') ||
    url.pathname.startsWith('/v1/') ||
    event.request.method !== 'GET'
  ) {
    return; // let browser handle normally
  }
```

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "chore(sw): cache v6 + gmailAuth.js + passthrough accounts.google.com"
```

---

## Task 5: Configuración en Google Cloud Console (manual — la realiza el usuario)

> Esta task NO es código. Es requisito para que GIS funcione. Hacerla antes de la verificación (Task 6).

- [ ] **Step 1: Habilitar Gmail API**

En [Google Cloud Console](https://console.cloud.google.com/) → proyecto **certimar-rv** → *APIs y servicios → Biblioteca* → buscar **Gmail API** → *Habilitar* (si ya estaba, continuar).

- [ ] **Step 2: Obtener el OAuth Web Client ID y ponerlo en `firebaseConfig.js`**

*APIs y servicios → Credenciales* → en *ID de cliente de OAuth 2.0* abrir el cliente de tipo **Aplicación web** (normalmente "Web client (auto created by Google Service)") → copiar el **Client ID** (formato `272750169092-XXXX.apps.googleusercontent.com`).
Pegarlo en `public/firebaseConfig.js` reemplazando el placeholder de `GOOGLE_OAUTH_CLIENT_ID`, y commitear:

```bash
git add public/firebaseConfig.js
git commit -m "config: Client ID OAuth real para GIS"
```

- [ ] **Step 3: Orígenes de JavaScript autorizados**

En ese mismo cliente OAuth, *Orígenes autorizados de JavaScript*, asegurar que existan:
- `https://certimar-rv.web.app`
- `https://certimar-rv.firebaseapp.com`
- `http://localhost:5000` (puerto de `firebase serve`/`emulators`; ajustar si usas otro)

Guardar. (Los cambios de orígenes pueden tardar unos minutos en propagarse.)

- [ ] **Step 4: Pantalla de consentimiento OAuth con el scope gmail.send**

*APIs y servicios → Pantalla de consentimiento de OAuth* → en *Scopes* confirmar `https://www.googleapis.com/auth/gmail.send`. Si la app está en modo **Testing**, agregar a cada certificador como *test user* (o *Publicar* la app). Sin esto, el consentimiento fallará para usuarios no listados.

---

## Task 6: Verificación end-to-end (manual, en navegador)

**Files:** ninguno (verificación)

- [ ] **Step 1: Servir localmente**

Run: `firebase serve --only hosting` (o `firebase emulators:start --only hosting`)
Abrir la URL local (p.ej. `http://localhost:5000`).

- [ ] **Step 2: Login + envío normal (primera vez = consentimiento una vez)**

Iniciar sesión con una cuenta `@certimar.cl`. Crear/guardar un registro y enviar el correo.
Expected: la primera vez aparece **una** pantalla de consentimiento de Google (scope "Enviar correo en tu nombre"); luego el correo se envía y llega desde la cuenta del certificador.

- [ ] **Step 3: CASO CRÍTICO — el bug original (sesión restaurada)**

Con la sesión ya iniciada, **recargar la página** (F5) para simular la restauración vía `onAuthStateChanged`. Sin volver a iniciar sesión, guardar/enviar un correo.
Expected: el correo se envía **sin** el mensaje "Sin token Gmail. Vuelve a iniciar sesión." (el warm-up dejó el token listo).

- [ ] **Step 4: Token vencido (refresco silencioso)**

En la consola del navegador: `_gmailTokenExp = 0;` y luego enviar un correo.
Expected: se refresca el token en silencio (sin popup, porque ya hay consentimiento y sesión de Google) y el correo se envía.

- [ ] **Step 5: Sin GIS / sin consentimiento (mensaje accionable)**

Revocar el permiso en [myaccount.google.com/permissions](https://myaccount.google.com/permissions) y enviar.
Expected: aparece el consentimiento una vez; si se cancela, el toast/notif muestra un mensaje claro (p.ej. "Acceso a Gmail no autorizado.") y **nunca** el viejo "Sin token Gmail".

- [ ] **Step 6: Deploy**

Cuando todo lo anterior pase:
Run: `firebase deploy --only hosting`
Verificar en `https://certimar-rv.web.app` el Step 3 (recargar y enviar) en producción.

---

## Notas de verificación final

- El service worker se actualiza solo (`skipWaiting` + `clients.claim`); si en producción ves la versión vieja, fuerza recarga (Ctrl+Shift+R) una vez tras el deploy.
- `firebaseConfig.js` y `gmailAuth.js` están cacheados 1h por HTTP; el bump de `?v=20260605` en `index.html` garantiza que se sirvan frescos.
- El test Node (`node test/gmailAuth.test.js`) solo cubre la lógica de expiración; el flujo GIS/OAuth se valida manualmente (Task 6) porque depende del navegador y del consentimiento de Google.
