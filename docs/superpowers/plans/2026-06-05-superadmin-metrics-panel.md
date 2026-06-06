# Panel Superadmin de Métricas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate superadmin "Métricas" panel that captures errors/actions/activity/performance into Firebase and shows KPIs, trend charts, a filterable log table and CSV export, gated by an admin role + self-service PIN.

**Architecture:** Client-side capture module (`public/metricsLog.js`) buffers events and batch-writes them to a Firestore `metrics_logs` collection with a 90-day TTL field (`expireAt`). The existing single-page app (`public/index.html`) is instrumented at key actions and exposes a new `view-metricas` (PIN gate + dashboard). No Cloud Functions. Reuses Chart.js 4.4.1 and the existing `.admin-*` styles.

**Tech Stack:** Vanilla ES5-style JS, Firebase v10 compat (Firestore/Auth), Chart.js 4.4.1, Web Crypto (SHA-256), Node `assert` for pure-logic unit tests (`node test/*.test.js`).

**Spec:** `docs/superpowers/specs/2026-06-05-superadmin-metrics-panel-design.md`

**Conventions verified in the codebase:**
- Pure logic is extracted into named functions and unit-tested with `node test/<name>.test.js` + `assert`, exported via a Node guard `if (typeof module !== 'undefined' && module.exports) { ... }` (see `test/gmailAuth.test.js`, `public/gmailAuth.js:103-106`).
- Helper scripts load as separate files with cache-busting `?v=YYYYMMDD` (`public/index.html:23-25`).
- Roles: Firestore `/usuarios/{email}.rol` ∈ `admin|supervisor|user`; loaded into `currentUser = { email, name, isAdmin, isSupervisor }`.
- `esc(str)` HTML-escape helper and `toast(msg, type)` already exist and are used throughout `index.html`.
- `initFirebase()` returns the Firestore instance and is safe to call repeatedly.

---

## Task 1: Pure helpers for `metricsLog.js` (TDD)

**Files:**
- Create: `public/metricsLog.js`
- Test: `test/metricsLog.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/metricsLog.test.js`:

```js
// Test de la lógica pura del logger de métricas (sin DOM ni Firebase).
// Ejecutar: node test/metricsLog.test.js
const assert = require('assert');
const {
  _mTruncate, _mExpireAtMs, _mShouldDedupeError, _mBuildEntry
} = require('../public/metricsLog.js');

// _mTruncate: corta a max y es null-safe
assert.strictEqual(_mTruncate('hola', 10), 'hola',        'no corta si cabe');
assert.strictEqual(_mTruncate('hola mundo', 4), 'hola',   'corta a 4');
assert.strictEqual(_mTruncate(null, 5), '',               'null -> ""');
assert.strictEqual(_mTruncate(undefined, 5), '',          'undefined -> ""');

// _mExpireAtMs: now + días
const NOW = 1000000000000;
assert.strictEqual(_mExpireAtMs(NOW, 90), NOW + 90 * 24 * 60 * 60 * 1000, 'expireAt 90d');

// _mShouldDedupeError: misma firma dentro de la ventana -> descartar
const map = {};
assert.strictEqual(_mShouldDedupeError('sig', map, NOW, 60000), false,         '1ra vez no descarta');
assert.strictEqual(_mShouldDedupeError('sig', map, NOW + 1000, 60000), true,   'dentro de ventana descarta');
assert.strictEqual(_mShouldDedupeError('sig', map, NOW + 61000, 60000), false, 'fuera de ventana no descarta');

// _mBuildEntry: acota detail, trunca strings, no setea campos ausentes
const ctx = { user:'a@certimar.cl', name:'A', view:'admin', ua:'UA', appVer:'v1' };
const e = _mBuildEntry('action', 'rv_create',
  { ok:true, detail:{ nro:'RV-1', big:'x'.repeat(500), nil:null } }, ctx, NOW);
assert.strictEqual(e.type, 'action',          'type');
assert.strictEqual(e.event, 'rv_create',      'event');
assert.strictEqual(e.user, 'a@certimar.cl',   'user');
assert.strictEqual(e.ok, true,                'ok bool');
assert.strictEqual(e.detail.nro, 'RV-1',      'detail.nro');
assert.strictEqual(e.detail.big.length, 200,  'detail string truncado a 200');
assert.ok(!('nil' in e.detail),               'descarta valores null en detail');
assert.strictEqual(e.expireAtMs, NOW + 90 * 24 * 60 * 60 * 1000, 'expireAtMs');
assert.ok(!('durationMs' in e),               'no setea durationMs si no viene');

// _mBuildEntry: user por defecto 'anon' cuando no hay ctx
const e2 = _mBuildEntry('activity', 'login', {}, null, NOW);
assert.strictEqual(e2.user, 'anon', 'sin ctx -> anon');

console.log('OK: metricsLog pure helpers (todos los casos)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/metricsLog.test.js`
Expected: FAIL — `Cannot find module '../public/metricsLog.js'`.

- [ ] **Step 3: Write minimal implementation (pure helpers only)**

Create `public/metricsLog.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/metricsLog.test.js`
Expected: PASS — prints `OK: metricsLog pure helpers (todos los casos)`.

- [ ] **Step 5: Commit**

```bash
git add public/metricsLog.js test/metricsLog.test.js
git commit -m "feat(metrics): logger pure helpers + node tests"
```

---

## Task 2: Runtime del logger (API, buffer, flush, handlers)

**Files:**
- Modify: `public/metricsLog.js` (append the runtime above the Node export guard)

No automated test (browser/Firebase runtime). Verified manually in Task 3.

- [ ] **Step 1: Add the runtime block**

In `public/metricsLog.js`, insert the following **between** the `_mBuildEntry` function and the `// ---------- Exporta lógica pura ...` guard:

```js
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
```

- [ ] **Step 2: Re-run the pure-logic test (must still pass)**

Run: `node test/metricsLog.test.js`
Expected: PASS — the runtime references `firebase`/`window` only inside functions, so requiring the module in Node still works.

- [ ] **Step 3: Commit**

```bash
git add public/metricsLog.js
git commit -m "feat(metrics): runtime del logger (buffer, flush por lotes, handlers globales)"
```

---

## Task 3: Cargar el logger + init/login/logout + service worker

**Files:**
- Modify: `public/index.html` (script tag ~line 25; init after `var currentUser = null;` ~line 1893; login block ~lines 2260-2268; `cerrarSesion` ~line 2287)
- Modify: `public/sw.js` (cache name + asset list)

- [ ] **Step 1: Load the script**

In `public/index.html`, after the `gmailAuth.js` script tag (line ~25):

```html
<script src="gmailAuth.js?v=20260606"></script>
```

add:

```html
<script src="metricsLog.js?v=20260605"></script>
```

- [ ] **Step 2: Initialize the logger early**

Find `var currentUser  = null;   // { email, name, isAdmin }` (line ~1893). Immediately after it, add:

```js
// Métricas: inicializa captura lo antes posible (handlers globales de error incluidos).
try { Metrics.init(function() { return currentUser; }, initFirebase()); }
catch (e) { console.warn('[metrics] init falló:', e); }
```

- [ ] **Step 3: Log login + setUser**

Find the login block where `currentUser` is assigned (lines ~2260-2268):

```js
        currentUser = {
          email       : user.email,
          name        : name,
          isAdmin     : rol === 'admin',
          isSupervisor: rol === 'supervisor'
        };
```

Immediately after that object literal (before the `// El token de Gmail...` comment / `showApp();`), add:

```js
        try { Metrics.setUser(currentUser); Metrics.activity('login', { detail: { rol: rol } }); } catch (e) {}
```

- [ ] **Step 4: Log logout**

Find `function cerrarSesion() {` (line ~2287). Make the body start with the logout log + flush:

```js
function cerrarSesion() {
  try { Metrics.activity('logout'); Metrics.flush(); } catch (e) {}
  firebase.auth().signOut().then(function() {
```

(Keep the rest of the function unchanged.)

- [ ] **Step 5: Update the service worker**

In `public/sw.js`, change the cache name and asset list (lines 4-5):

```js
const CACHE_NAME    = 'certimar-rv-v7';
const CACHE_ASSETS  = ['/', '/index.html', '/firebaseConfig.js', '/gmailAuth.js', '/metricsLog.js', '/concesiones.js', '/aquachile.js'];
```

- [ ] **Step 6: Manual verification**

Run locally: `firebase serve` (or `firebase emulators:start --only hosting`), open the app, log in with an `@certimar.cl` account.
- In DevTools console, run `Metrics.flush()`.
- In the Firebase console → Firestore → `metrics_logs`, confirm at least one doc exists with `type:'activity'`, `event:'login'`, your email in `user`, and an `expireAt` ~90 days ahead.
Expected: the login doc is present; no console errors from `[metrics]`.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/sw.js
git commit -m "feat(metrics): cargar logger, init + login/logout, bump SW a v7"
```

---

## Task 4: Instrumentar acciones clave (guardar RV, enviar correo, navegación)

**Files:**
- Modify: `public/index.html` (`showView` ~2373; `fbGuardarRegistro` ~2077; `handleEnviarMail` ~3589 y ~3605)

- [ ] **Step 1: Log view changes in `showView`**

Find `function showView(view) {` (line ~2373). Make its body start with:

```js
function showView(view) {
  try { Metrics.activity('view_change', { view: view }); } catch (e) {}
  var views = ['dashboard','registro','historico','admin'];
```

(The `'metricas'` view id and its dispatch are added in Task 6 — leave that for now.)

- [ ] **Step 2: Instrument `fbGuardarRegistro` (RV create action + perf)**

Replace the body of `fbGuardarRegistro` (lines ~2077-2083) with:

```js
async function fbGuardarRegistro(datos, urlCertificado, urlFoto) {
  var db = initFirebase();
  if (!db) throw new Error('Firebase no disponible');
  var docData = buildDocData(datos, datos.nroRegistro, urlCertificado, urlFoto);
  var _stop = Metrics.time();
  try {
    await db.collection('registros_visita').doc(datos.nroRegistro).set(docData);
  } catch (e) {
    try { Metrics.action('rv_create', false, { detail: { nro: datos.nroRegistro } });
          Metrics.error('rv_create_fail', e, { detail: { nro: datos.nroRegistro } }); } catch (x) {}
    throw e;
  }
  try { Metrics.action('rv_create', true, { detail: { nro: datos.nroRegistro } });
        Metrics.perf('rv_create', _stop(), { detail: { nro: datos.nroRegistro } }); } catch (x) {}
  return docData;
}
```

- [ ] **Step 3: Instrument `handleEnviarMail` success path**

Find, inside `handleEnviarMail`, the success lines (~3589-3590):

```js
      await sendViaGmailAPI(raw);
      updateNotifStep('mail-send','m2','done');
```

Insert after `updateNotifStep('mail-send','m2','done');`:

```js
      try { Metrics.action('mail_send', true, { detail: { nro: datos.nroRegistro, dest: emailDest } }); } catch (e) {}
```

- [ ] **Step 4: Instrument `handleEnviarMail` failure path**

Find the catch block (~3605-3609):

```js
    } catch(e) {
      setBtnLoading('btn-enviar-mail', false);
      var errMsg = e && e.message ? e.message : String(e || 'Error desconocido');
      updateNotifCard('mail-send', 'error', '❌ Error al enviar', errMsg);
    }
```

Add, right after the `updateNotifCard(...)` line and before the closing `}`:

```js
      try { Metrics.action('mail_send', false, { detail: { dest: emailDest } });
            Metrics.error('mail_send_fail', e, { detail: { dest: emailDest } }); } catch (x) {}
```

- [ ] **Step 5: Manual verification**

In the running app: create and save a RV, then send the email. Run `Metrics.flush()` in the console.
In Firestore `metrics_logs`, confirm docs:
- `type:'action'`, `event:'rv_create'`, `ok:true`, `detail.nro` set.
- `type:'perf'`, `event:'rv_create'`, numeric `durationMs`.
- `type:'action'`, `event:'mail_send'`, `ok:true`, `detail.dest` set.
Switch between dashboard/historico tabs → confirm `event:'view_change'` docs (one per distinct view).
Expected: all present; app behaves exactly as before.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat(metrics): instrumentar guardar RV, enviar correo y navegacion"
```

---

## Task 5: Reglas Firestore para `metrics_logs` y `/config`

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add the rules**

In `firestore.rules`, inside `match /databases/{database}/documents {`, add these two blocks before the final closing braces (after the `borradores` block):

```
    // Logs de métricas — cualquier @certimar.cl crea; solo admin lee; sin update/delete (TTL borra)
    match /metrics_logs/{id} {
      allow create: if request.auth != null &&
        request.auth.token.email.matches('.*@certimar[.]cl');
      allow read: if request.auth != null &&
        get(/databases/$(database)/documents/usuarios/$(request.auth.token.email)).data.rol == 'admin';
      allow update, delete: if false;
    }

    // Config del panel de métricas (pinHash) — solo admin
    match /config/{docId} {
      allow read, write: if request.auth != null &&
        get(/databases/$(database)/documents/usuarios/$(request.auth.token.email)).data.rol == 'admin';
    }
```

- [ ] **Step 2: Deploy the rules**

Run: `firebase deploy --only firestore:rules`
Expected: `Deploy complete!` with no compile errors.

- [ ] **Step 3: Manual verification**

- As an admin user, in DevTools: `await initFirebase().collection('metrics_logs').limit(1).get()` → resolves (no permission error).
- As a non-admin user (`rol:'user'`), the same read should reject with `permission-denied`.
- Any authenticated `@certimar.cl` user can still `create` logs (already verified in Task 3/4).

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat(metrics): reglas Firestore para metrics_logs y config (pin)"
```

---

## Task 6: Menú, vista `view-metricas`, estilos y wiring de navegación

**Files:**
- Modify: `public/index.html` (nav button ~941; mobile tab ~978; CSS after `.admin-footer` ~389; view markup after `</div><!-- /view-admin -->` ~1607; `showView` array ~2374 + dispatch ~2389; `showApp` reveal ~2341-2345)

- [ ] **Step 1: Add the desktop nav button**

Find the admin nav button (line ~941):

```html
        <button class="nav-btn admin-btn hidden" id="nav-admin" onclick="showView('admin')">
```

Add a sibling button immediately after its closing `</button>`:

```html
        <button class="nav-btn admin-btn hidden" id="nav-metricas" onclick="showView('metricas')">Métricas</button>
```

- [ ] **Step 2: Add the mobile tab**

Find the admin mobile tab (line ~978):

```html
    <button class="mtab hidden" id="mtab-admin" onclick="showView('admin')">
```

Add immediately after its closing `</button>`:

```html
    <button class="mtab admin-tab hidden" id="mtab-metricas" onclick="showView('metricas')">Métricas</button>
```

- [ ] **Step 3: Add CSS**

In the `<style>` block, after the `.admin-footer{...}` rule (line ~389), add:

```css
/* Panel de métricas (superadmin) */
.metrics-gate{max-width:420px;margin:80px auto;padding:0 16px}
.metrics-gate-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:32px 28px;box-shadow:var(--shadow-sm);text-align:center}
.metrics-gate-card h2{font-size:20px;font-weight:800;color:var(--text-pri);margin-bottom:6px}
.metrics-gate-sub{font-size:13px;color:var(--text-sec);margin-bottom:18px}
.metrics-pin-input{width:100%;padding:12px 14px;font-size:18px;letter-spacing:4px;text-align:center;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;background:var(--surface-2);color:var(--text-pri)}
.metrics-gate-err{color:var(--error);font-size:12px;margin-top:8px;min-height:16px}
.metrics-charts{max-width:1440px;margin:18px auto 0;padding:0 32px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.metrics-chart-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:var(--shadow-sm)}
.metrics-header-actions{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:900px){ .metrics-charts{grid-template-columns:1fr} }
```

- [ ] **Step 4: Add the `view-metricas` markup**

Find `</div><!-- /view-admin -->` (line ~1607). Immediately after it, add:

```html
  <!-- ===================== VISTA MÉTRICAS (SUPERADMIN) ===================== -->
  <div id="view-metricas" class="hidden">

    <!-- Reja PIN -->
    <div id="metrics-gate" class="metrics-gate">
      <div class="metrics-gate-card">
        <h2 id="metrics-gate-title">Ingresa el PIN</h2>
        <p id="metrics-gate-sub" class="metrics-gate-sub">Panel de métricas (superadmin)</p>
        <input id="metrics-pin-1" type="password" inputmode="numeric" class="metrics-pin-input" placeholder="PIN" autocomplete="off"
               onkeydown="if(event.key==='Enter')metricsGateSubmit()">
        <input id="metrics-pin-2" type="password" inputmode="numeric" class="metrics-pin-input hidden" placeholder="Confirmar PIN" autocomplete="off"
               onkeydown="if(event.key==='Enter')metricsGateSubmit()">
        <button class="btn-primary" id="metrics-gate-btn" data-mode="enter" onclick="metricsGateSubmit()">Entrar</button>
        <div id="metrics-gate-err" class="metrics-gate-err"></div>
      </div>
    </div>

    <!-- Panel -->
    <div id="metrics-panel" class="hidden">
      <div class="admin-header">
        <div>
          <h1>Panel de Métricas <span class="admin-badge">SUPERADMIN</span></h1>
          <p>Errores, actividad, acciones y rendimiento — solo análisis</p>
        </div>
        <div class="metrics-header-actions">
          <button class="admin-action-btn" onclick="metricsChangePin()">Cambiar PIN</button>
          <button class="admin-action-btn" onclick="cargarMetricas()">↻ Refrescar</button>
          <button class="admin-action-btn ok" onclick="exportarMetricasCSV()">⬇ CSV</button>
        </div>
      </div>

      <div class="admin-filters"><div class="admin-filters-inner">
        <select id="m-rango" onchange="cargarMetricas()">
          <option value="1">Hoy</option>
          <option value="7" selected>7 días</option>
          <option value="30">30 días</option>
          <option value="90">90 días</option>
        </select>
        <select id="m-tipo" onchange="renderMetricas()">
          <option value="">Todos los tipos</option>
          <option value="error">Errores</option>
          <option value="action">Acciones</option>
          <option value="activity">Actividad</option>
          <option value="perf">Rendimiento</option>
        </select>
        <select id="m-user" onchange="renderMetricas()"><option value="">Todos los usuarios</option></select>
        <input id="m-search" type="search" placeholder="Buscar evento/mensaje…" oninput="renderMetricas()">
      </div></div>

      <div class="admin-stats" id="m-kpis">
        <div class="admin-stat warning"><div class="admin-stat-val" id="m-kpi-err">—</div><div class="admin-stat-lbl">Errores</div></div>
        <div class="admin-stat"><div class="admin-stat-val" id="m-kpi-users">—</div><div class="admin-stat-lbl">Usuarios activos</div></div>
        <div class="admin-stat"><div class="admin-stat-val" id="m-kpi-rv">—</div><div class="admin-stat-lbl">RV creadas</div></div>
        <div class="admin-stat success"><div class="admin-stat-val" id="m-kpi-mail">—</div><div class="admin-stat-lbl">Correos ok</div></div>
        <div class="admin-stat warning"><div class="admin-stat-val" id="m-kpi-mailfail">—</div><div class="admin-stat-lbl">Correos fallidos</div></div>
        <div class="admin-stat"><div class="admin-stat-val" id="m-kpi-perf">—</div><div class="admin-stat-lbl">Tiempo prom (ms)</div></div>
      </div>

      <div class="metrics-charts">
        <div class="metrics-chart-card"><canvas id="m-chart-day"></canvas></div>
        <div class="metrics-chart-card"><canvas id="m-chart-user"></canvas></div>
        <div class="metrics-chart-card"><canvas id="m-chart-mail"></canvas></div>
      </div>

      <div class="admin-table-wrap"><div class="admin-table-card">
        <table class="admin-table"><thead><tr>
          <th>Fecha/Hora</th><th>Tipo</th><th>Evento</th><th>Usuario</th><th>Vista</th><th>OK</th><th>Mensaje</th>
        </tr></thead><tbody id="m-tbody">
          <tr><td colspan="7" class="admin-empty">Sin datos</td></tr>
        </tbody></table>
      </div></div>

    </div><!-- /metrics-panel -->
  </div><!-- /view-metricas -->
```

- [ ] **Step 5: Wire `showView` for the new view**

In `showView` (line ~2374), add `'metricas'` to the views array:

```js
  var views = ['dashboard','registro','historico','admin','metricas'];
```

And near the other dispatch lines (after `if (view === 'admin') cargarAdmin();`, line ~2389), add:

```js
  if (view === 'metricas')  abrirMetricas();
```

- [ ] **Step 6: Reveal the menu for admins in `showApp`**

Find the admin reveal block in `showApp` (lines ~2341-2345):

```js
    if (currentUser.isAdmin) {
      document.getElementById('nav-admin').classList.remove('hidden');
      var mtabAdmin = document.getElementById('mtab-admin');
      if (mtabAdmin) mtabAdmin.classList.remove('hidden');
    }
```

Add, inside that `if (currentUser.isAdmin) {` block (after the existing lines, before its closing `}`):

```js
      document.getElementById('nav-metricas').classList.remove('hidden');
      var mtabMet = document.getElementById('mtab-metricas');
      if (mtabMet) mtabMet.classList.remove('hidden');
```

- [ ] **Step 7: Add a temporary stub so the app loads**

The handlers `abrirMetricas`, `metricsGateSubmit`, `metricsChangePin`, `cargarMetricas`, `renderMetricas`, `exportarMetricasCSV` are implemented in Tasks 7-10. To keep the app runnable after this task, add this stub at the end of the main `<script>` (just before its closing `</script>` at line ~5786 — the FIRST of the two, the main app script):

```js
// Stubs temporales — reemplazados en Tasks 7-10.
function abrirMetricas() { document.getElementById('metrics-gate').classList.remove('hidden'); document.getElementById('metrics-panel').classList.add('hidden'); }
function metricsGateSubmit() {}
function metricsChangePin() {}
function cargarMetricas() {}
function renderMetricas() {}
function exportarMetricasCSV() {}
```

- [ ] **Step 8: Manual verification**

Reload as an admin: the "Métricas" button appears in the nav and mobile tab. Clicking it shows the PIN gate card (stub). As a non-admin, the button is hidden. No console errors.

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat(metrics): menu superadmin, vista view-metricas, estilos y navegacion"
```

---

## Task 7: Lógica del PIN (autoservicio) y desbloqueo

**Files:**
- Modify: `public/index.html` (replace the stubs `abrirMetricas`, `metricsGateSubmit` from Task 6; add PIN helpers)

- [ ] **Step 1: Replace the PIN-related stubs with real implementations**

Remove from the Task-6 stub block the lines `function abrirMetricas() {...}`, `function metricsGateSubmit() {}` and `function metricsChangePin() {}`, and add the following functions (anywhere in the main `<script>`, e.g. just below the stub block):

```js
// ===================== MÉTRICAS — REJA PIN (autoservicio) =====================
var _METRICS_UNLOCK_KEY = 'certimar_metrics_unlocked';

async function _metricsSha256Hex(str) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.prototype.map.call(new Uint8Array(buf), function(b) {
    return ('0' + b.toString(16)).slice(-2);
  }).join('');
}

async function abrirMetricas() {
  if (sessionStorage.getItem(_METRICS_UNLOCK_KEY) === '1') { _metricsShowPanel(); return; }
  var hash = null;
  try {
    var snap = await initFirebase().collection('config').doc('metrics').get();
    if (snap.exists) hash = snap.data().pinHash || null;
  } catch (e) {
    toast('No se pudo leer la configuración de métricas', 'error');
    try { Metrics.error('metrics_config_read_fail', e); } catch (x) {}
    return;
  }
  _metricsRenderGate(hash ? 'enter' : 'create');
}

function _metricsRenderGate(mode) {
  document.getElementById('metrics-panel').classList.add('hidden');
  document.getElementById('metrics-gate').classList.remove('hidden');
  var title = document.getElementById('metrics-gate-title');
  var sub   = document.getElementById('metrics-gate-sub');
  var pin2  = document.getElementById('metrics-pin-2');
  var btn   = document.getElementById('metrics-gate-btn');
  document.getElementById('metrics-gate-err').textContent = '';
  document.getElementById('metrics-pin-1').value = '';
  pin2.value = '';
  btn.dataset.mode = mode;
  if (mode === 'create') {
    title.textContent = 'Crea un PIN';
    sub.textContent   = 'Aún no hay PIN configurado. Defínelo (mín. 4 dígitos).';
    pin2.classList.remove('hidden');
    btn.textContent   = 'Crear PIN';
  } else {
    title.textContent = 'Ingresa el PIN';
    sub.textContent   = 'Panel de métricas (superadmin)';
    pin2.classList.add('hidden');
    btn.textContent   = 'Entrar';
  }
  document.getElementById('metrics-pin-1').focus();
}

function metricsGateSubmit() {
  var mode = document.getElementById('metrics-gate-btn').dataset.mode || 'enter';
  if (mode === 'create') _metricsCreatePin();
  else _metricsSubmitPin();
}

async function _metricsCreatePin() {
  var p1  = document.getElementById('metrics-pin-1').value.trim();
  var p2  = document.getElementById('metrics-pin-2').value.trim();
  var err = document.getElementById('metrics-gate-err');
  if (p1.length < 4) { err.textContent = 'El PIN debe tener al menos 4 dígitos.'; return; }
  if (p1 !== p2)     { err.textContent = 'Los PIN no coinciden.'; return; }
  try {
    var hash = await _metricsSha256Hex(p1);
    await initFirebase().collection('config').doc('metrics').set({
      pinHash  : hash,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.email : ''
    });
    _metricsUnlock();
  } catch (e) {
    err.textContent = 'No se pudo guardar el PIN.';
    try { Metrics.error('metrics_pin_create_fail', e); } catch (x) {}
  }
}

async function _metricsSubmitPin() {
  var p1  = document.getElementById('metrics-pin-1').value.trim();
  var err = document.getElementById('metrics-gate-err');
  try {
    var snap   = await initFirebase().collection('config').doc('metrics').get();
    var stored = snap.exists ? (snap.data().pinHash || '') : '';
    var hash   = await _metricsSha256Hex(p1);
    if (hash && hash === stored) { _metricsUnlock(); }
    else { err.textContent = 'PIN incorrecto.'; }
  } catch (e) {
    err.textContent = 'No se pudo verificar el PIN.';
    try { Metrics.error('metrics_pin_verify_fail', e); } catch (x) {}
  }
}

function _metricsUnlock() {
  sessionStorage.setItem(_METRICS_UNLOCK_KEY, '1');
  _metricsShowPanel();
}

function _metricsShowPanel() {
  document.getElementById('metrics-gate').classList.add('hidden');
  document.getElementById('metrics-panel').classList.remove('hidden');
  cargarMetricas();
}

async function metricsChangePin() {
  var actual = prompt('PIN actual:');                if (actual === null) return;
  var nuevo  = prompt('Nuevo PIN (mín. 4 dígitos):'); if (nuevo  === null) return;
  var conf   = prompt('Confirmar nuevo PIN:');       if (conf   === null) return;
  if (nuevo.trim().length < 4)     { toast('El PIN debe tener al menos 4 dígitos', 'error'); return; }
  if (nuevo.trim() !== conf.trim()){ toast('Los PIN no coinciden', 'error'); return; }
  try {
    var snap    = await initFirebase().collection('config').doc('metrics').get();
    var stored  = snap.exists ? (snap.data().pinHash || '') : '';
    var hActual = await _metricsSha256Hex(actual.trim());
    if (hActual !== stored) { toast('PIN actual incorrecto', 'error'); return; }
    var hNuevo = await _metricsSha256Hex(nuevo.trim());
    await initFirebase().collection('config').doc('metrics').set({
      pinHash  : hNuevo,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.email : ''
    });
    toast('PIN actualizado ✓', 'success');
  } catch (e) {
    toast('No se pudo cambiar el PIN', 'error');
    try { Metrics.error('metrics_pin_change_fail', e); } catch (x) {}
  }
}
```

(The stub block from Task 6 now only contains `cargarMetricas`, `renderMetricas`, `exportarMetricasCSV` — those are replaced in Tasks 8-10. `_metricsShowPanel` calls `cargarMetricas`, which is still a stub until Task 8; that is fine.)

- [ ] **Step 2: Manual verification**

As an admin, open "Métricas":
- First time (no `/config/metrics` doc): shows "Crea un PIN"; entering a 4-digit PIN twice creates the doc (check Firestore `config/metrics.pinHash` is a 64-char hex) and reveals the panel.
- Reload the tab, open "Métricas" again: shows "Ingresa el PIN". Wrong PIN → "PIN incorrecto"; correct PIN → panel.
- Click "Cambiar PIN", change it, then reload and unlock with the new PIN.
Expected: all flows work; the PIN is never stored in plaintext.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(metrics): reja PIN autoservicio (crear/ingresar/cambiar) con SHA-256"
```

---

## Task 8: Carga de datos, filtros y KPIs

**Files:**
- Modify: `public/index.html` (replace the `cargarMetricas` and `renderMetricas` stubs; add filter/KPI helpers + state)

- [ ] **Step 1: Add state + replace `cargarMetricas`/`renderMetricas`**

Remove `function cargarMetricas() {}` and `function renderMetricas() {}` from the stub block, and add:

```js
// ===================== MÉTRICAS — DATOS, FILTROS Y KPIs =====================
var _mAll = [];   // logs cargados para el rango actual

async function cargarMetricas() {
  var dias  = parseInt(document.getElementById('m-rango').value, 10) || 7;
  var desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  var tbody = document.getElementById('m-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="admin-empty"><div class="spinner dark" style="margin:0 auto 8px"></div>Cargando…</td></tr>';
  try {
    var snap = await initFirebase().collection('metrics_logs')
      .where('ts', '>=', firebase.firestore.Timestamp.fromDate(desde))
      .orderBy('ts', 'desc').limit(5000).get();
    _mAll = snap.docs.map(function(d) { var x = d.data(); x._id = d.id; return x; });
    _metricsFillUserFilter();
    renderMetricas();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">Error al cargar: ' + esc(e.message || String(e)) + '</td></tr>';
    try { Metrics.error('metrics_load_fail', e); } catch (x) {}
  }
}

function _metricsFillUserFilter() {
  var sel = document.getElementById('m-user');
  var cur = sel.value, users = {};
  _mAll.forEach(function(r) { if (r.user) users[r.user] = 1; });
  var opts = ['<option value="">Todos los usuarios</option>'];
  Object.keys(users).sort().forEach(function(u) { opts.push('<option value="' + esc(u) + '">' + esc(u) + '</option>'); });
  sel.innerHTML = opts.join('');
  sel.value = cur;
}

function _metricsFiltered() {
  var tipo = document.getElementById('m-tipo').value;
  var user = document.getElementById('m-user').value;
  var q    = (document.getElementById('m-search').value || '').toLowerCase();
  return _mAll.filter(function(r) {
    if (tipo && r.type !== tipo) return false;
    if (user && r.user !== user) return false;
    if (q) {
      var hay = (r.event || '') + ' ' + (r.msg || '') + ' ' + (r.user || '') + ' ' + (r.view || '');
      if (hay.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  });
}

function renderMetricas() {
  var rows = _metricsFiltered();
  _metricsRenderKpis(rows);
  _metricsRenderCharts(rows);
  _metricsRenderTable(rows);
}

function _metricsRenderKpis(rows) {
  var err = 0, users = {}, rv = 0, mail = 0, mailfail = 0, perfSum = 0, perfN = 0;
  rows.forEach(function(r) {
    if (r.type === 'error') err++;
    if (r.user) users[r.user] = 1;
    if (r.event === 'rv_create' && r.ok) rv++;
    if (r.event === 'mail_send') { if (r.ok) mail++; else mailfail++; }
    if (r.type === 'perf' && typeof r.durationMs === 'number') { perfSum += r.durationMs; perfN++; }
  });
  document.getElementById('m-kpi-err').textContent      = err;
  document.getElementById('m-kpi-users').textContent    = Object.keys(users).length;
  document.getElementById('m-kpi-rv').textContent       = rv;
  document.getElementById('m-kpi-mail').textContent     = mail;
  document.getElementById('m-kpi-mailfail').textContent = mailfail;
  document.getElementById('m-kpi-perf').textContent     = perfN ? Math.round(perfSum / perfN) : '—';
}
```

- [ ] **Step 2: Add temporary chart/table stubs (replaced in Task 9)**

`renderMetricas` now calls `_metricsRenderCharts` and `_metricsRenderTable`. Add temporary stubs (just below `_metricsRenderKpis`):

```js
function _metricsRenderCharts(rows) {}                       // implementado en Task 9
function _metricsRenderTable(rows) {                         // tabla mínima; mejorada en Task 9
  var tbody = document.getElementById('m-tbody');
  tbody.innerHTML = rows.length
    ? rows.slice(0, 50).map(function(r) {
        return '<tr><td colspan="7">' + esc(r.type) + ' · ' + esc(r.event) + ' · ' + esc(r.user) + '</td></tr>';
      }).join('')
    : '<tr><td colspan="7" class="admin-empty">Sin datos</td></tr>';
}
```

- [ ] **Step 3: Manual verification**

Unlock the panel. KPI cards populate with numbers from the last 7 days. Changing the range reloads; changing tipo/usuario/búsqueda updates the KPIs and the minimal table without a refetch. No console errors.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(metrics): carga por rango, filtros en cliente y KPIs"
```

---

## Task 9: Gráficos (Chart.js) y tabla filtrable

**Files:**
- Modify: `public/index.html` (replace `_metricsRenderCharts` and `_metricsRenderTable` from Task 8)

- [ ] **Step 1: Replace the chart + table functions**

Replace the Task-8 `_metricsRenderCharts` stub and the minimal `_metricsRenderTable` with:

```js
var _mChartDay = null, _mChartUser = null, _mChartMail = null;

function _metricsDayKey(r) {
  var d = (r.ts && r.ts.toDate) ? r.ts.toDate() : new Date(r.clientTs || Date.now());
  return d.toISOString().split('T')[0];
}

function _metricsRenderCharts(rows) {
  var byDay = {}, byDayErr = {}, byUser = {}, mok = 0, mfail = 0;
  rows.forEach(function(r) {
    var k = _metricsDayKey(r);
    byDay[k] = (byDay[k] || 0) + 1;
    if (r.type === 'error') byDayErr[k] = (byDayErr[k] || 0) + 1;
    if (r.user) byUser[r.user] = (byUser[r.user] || 0) + 1;
    if (r.event === 'mail_send') { if (r.ok) mok++; else mfail++; }
  });
  var days = Object.keys(byDay).sort();
  var us   = Object.keys(byUser).sort(function(a, b) { return byUser[b] - byUser[a]; }).slice(0, 8);

  if (_mChartDay) _mChartDay.destroy();
  _mChartDay = new Chart(document.getElementById('m-chart-day'), {
    type: 'line',
    data: { labels: days, datasets: [
      { label: 'Eventos', data: days.map(function(d) { return byDay[d]; }),       borderColor: '#0099cc', tension: .3 },
      { label: 'Errores', data: days.map(function(d) { return byDayErr[d] || 0; }), borderColor: '#d97706', tension: .3 }
    ] },
    options: { responsive: true, plugins: { title: { display: true, text: 'Eventos por día' } } }
  });

  if (_mChartUser) _mChartUser.destroy();
  _mChartUser = new Chart(document.getElementById('m-chart-user'), {
    type: 'bar',
    data: { labels: us, datasets: [{ label: 'Eventos', data: us.map(function(u) { return byUser[u]; }), backgroundColor: '#0099cc' }] },
    options: { responsive: true, plugins: { title: { display: true, text: 'Actividad por usuario (top 8)' } } }
  });

  if (_mChartMail) _mChartMail.destroy();
  _mChartMail = new Chart(document.getElementById('m-chart-mail'), {
    type: 'doughnut',
    data: { labels: ['OK', 'Fallidos'], datasets: [{ data: [mok, mfail], backgroundColor: ['#059669', '#dc2626'] }] },
    options: { responsive: true, plugins: { title: { display: true, text: 'Correos enviados' } } }
  });
}

function _metricsRenderTable(rows) {
  var tbody = document.getElementById('m-tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">Sin datos</td></tr>'; return; }
  tbody.innerHTML = rows.slice(0, 500).map(function(r) {
    var d    = (r.ts && r.ts.toDate) ? r.ts.toDate() : new Date(r.clientTs || Date.now());
    var when = d.toLocaleString('es-CL');
    var ok   = (r.ok === true) ? '✓' : (r.ok === false ? '✗' : '');
    var msg  = esc(r.msg || (r.detail ? JSON.stringify(r.detail) : ''));
    return '<tr title="' + esc(r.stack || '') + '">' +
      '<td>' + esc(when) + '</td>' +
      '<td>' + esc(r.type) + '</td>' +
      '<td>' + esc(r.event) + '</td>' +
      '<td>' + esc(r.user) + '</td>' +
      '<td>' + esc(r.view || '') + '</td>' +
      '<td>' + ok + '</td>' +
      '<td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + msg + '</td>' +
    '</tr>';
  }).join('');
}
```

- [ ] **Step 2: Manual verification**

Unlock the panel: the three charts render (line/bar/doughnut) and the table lists events newest-first with type/event/user/view/ok/message. Hovering an error row shows the stack via the row tooltip. Changing filters updates charts + table live.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(metrics): graficos Chart.js y tabla de logs filtrable"
```

---

## Task 10: Exportar a CSV

**Files:**
- Modify: `public/index.html` (replace the `exportarMetricasCSV` stub)

- [ ] **Step 1: Replace the stub**

Remove `function exportarMetricasCSV() {}` and add:

```js
function exportarMetricasCSV() {
  var rows = _metricsFiltered();
  if (!rows.length) { toast('No hay datos para exportar', 'error'); return; }
  var headers = ['Fecha/Hora','Tipo','Evento','Usuario','Vista','OK','DuracionMs','Mensaje'];
  var lines = rows.map(function(r) {
    var d = (r.ts && r.ts.toDate) ? r.ts.toDate() : new Date(r.clientTs || Date.now());
    return [
      d.toISOString(), r.type, r.event, r.user, r.view || '',
      (r.ok === true ? '1' : r.ok === false ? '0' : ''),
      (r.durationMs || ''), (r.msg || '')
    ].map(function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
  });
  var csv  = [headers.map(function(h) { return '"' + h + '"'; }).join(',')].concat(lines).join('\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'certimar_metricas_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click(); URL.revokeObjectURL(url);
  toast('CSV exportado ✓', 'success');
}
```

- [ ] **Step 2: Manual verification**

Click "⬇ CSV": a `certimar_metricas_YYYY-MM-DD.csv` downloads; open it — it respects the current filters (tipo/usuario/búsqueda), opens cleanly in Excel/Sheets (UTF-8 BOM, quoted fields).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(metrics): exportar logs filtrados a CSV"
```

---

## Task 11: TTL de Firestore + verificación final

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-superadmin-metrics-panel-design.md` (none required) — this task is configuration + end-to-end check.

- [ ] **Step 1: Enable the Firestore TTL policy**

Enable TTL on `metrics_logs.expireAt` (one-time, requires `gcloud` configured for project `certimar-rv`):

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=metrics_logs \
  --project=certimar-rv \
  --enable-ttl
```

(Or: Firebase console → Firestore Database → TTL → Create policy → collection group `metrics_logs`, field `expireAt`.)
Expected: the TTL policy appears as "Active"/"Creating". Docs whose `expireAt` is in the past are deleted automatically within ~24-72h.

- [ ] **Step 2: Deploy hosting + rules**

```bash
firebase deploy --only hosting,firestore:rules
```
Expected: `Deploy complete!`

- [ ] **Step 3: End-to-end verification (production URL)**

1. Hard-reload (the SW updates to `v7`). Log in as admin.
2. Create a RV, send a mail, switch views, trigger a console error (`throw new Error('test')` in DevTools).
3. Open "Métricas" → set/enter PIN → confirm KPIs, 3 charts and the table populate; the test error appears as `type:'error'`.
4. Export CSV and open it.
5. In a separate non-admin session, confirm the "Métricas" menu is hidden and `metrics_logs` reads are denied.
6. Open the public signing page `?view=firma` in a logged-out window → it loads normally with no `[metrics]` errors and no write attempts.

- [ ] **Step 4: Finishing**

Use superpowers:finishing-a-development-branch to decide how to integrate (merge / PR / cleanup).

---

## Self-Review

**Spec coverage:**
- §4 schema → Task 1/2 (`_mBuildEntry`, flush doc shape). ✓
- §5 capture layer → Tasks 1-2. ✓
- §6 instrumentation → Task 4 (save/mail/view) + global handlers (Task 2). ✓
- §7 access + PIN autoservicio → Tasks 6-7. ✓
- §8 panel (KPIs/charts/table/CSV) → Tasks 8-10. ✓
- §9 rules/indexes/TTL → Task 5 (rules) + Task 11 (TTL); no composite index needed (client-side type filter). ✓
- §10 deploy/SW → Task 3 (SW v7, script tag) + Task 11 (deploy). ✓
- §11 logger self-safety → Task 2 (try/catch, guard, bounded queue). ✓
- §12 verification → per-task manual steps + Task 11 E2E. ✓

**Placeholder scan:** Task 6/8 introduce *labeled temporary stubs* that are explicitly replaced in later tasks (each replacement is spelled out with full code). No unresolved TODOs.

**Type/name consistency:** `Metrics.{init,setUser,error,action,activity,perf,time,flush}` used consistently. Pure helpers `_mTruncate/_mExpireAtMs/_mShouldDedupeError/_mBuildEntry` match between `metricsLog.js` and the test. Panel functions `abrirMetricas/metricsGateSubmit/_metricsRenderGate/_metricsCreatePin/_metricsSubmitPin/_metricsUnlock/_metricsShowPanel/metricsChangePin/cargarMetricas/renderMetricas/_metricsRenderKpis/_metricsRenderCharts/_metricsRenderTable/exportarMetricasCSV/_metricsFiltered/_metricsFillUserFilter/_metricsDayKey` are defined once and referenced consistently. Firestore: writes use field `expireAt` (Timestamp) and reads order by `ts`; both match the rules and TTL config.
