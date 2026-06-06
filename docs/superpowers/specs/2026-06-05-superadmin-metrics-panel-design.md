# Diseño — Panel Superadmin de Métricas (logs de errores, actividad y acciones)

**Fecha:** 2026-06-05
**Proyecto:** Certimar RV
**Estado:** Aprobado para implementación

## 1. Objetivo

Agregar un panel de **superadmin** (separado del panel admin actual) que registre en
Firebase los **errores**, **acciones de negocio**, **actividad/sesión** y **rendimiento**
de la app, y los muestre como **KPIs, gráficos de tendencia, una tabla de logs filtrable
y exportación a CSV** — solo para análisis de métricas (lectura/analítica, no operación).

Enfoque elegido: **captura en cliente + Firestore con TTL nativo** (sin Cloud Functions
nuevas). Reusa Chart.js (ya cargado) y los estilos `.admin-*` existentes.

## 2. Alcance

**Incluye:**
- Captura de 4 categorías de eventos: `error`, `action`, `activity`, `perf`.
- Colección Firestore `metrics_logs` con auto-borrado a 90 días (TTL).
- Menú/vista de métricas visible solo para rol `admin`, protegido por una reja PIN.
- Panel con KPIs, gráficos (Chart.js), tabla filtrable y export CSV.
- Reglas Firestore y configuración del PIN en autoservicio.

**No incluye (YAGNI):**
- Cloud Function de ingesta (descartado: sobredimensionado para uso interno).
- Servicio externo de analítica (Sentry/Firebase Analytics) — los datos deben vivir en Firebase.
- Edición de logs desde el cliente. Los logs son inmutables; los borra el TTL.

## 3. Arquitectura y archivos

| Archivo | Cambio |
|---|---|
| `public/metricsLog.js` | **Nuevo.** Captura de eventos: handlers globales de error, API `Metrics.*`, buffer y volcado por lotes a Firestore. |
| `public/index.html` | Cargar el script; instrumentar puntos clave; nuevo botón de menú + tab móvil; vista `view-metricas` (reja PIN + KPIs + gráficos + tabla + CSV) y sus funciones de render. |
| `firestore.rules` | Reglas para `metrics_logs` y `/config/metrics`. |
| `public/sw.js` | Cachear `metricsLog.js` y subir `CACHE_NAME` a `certimar-rv-v7`. |
| `firestore.indexes.json` | Sin índice compuesto (se filtra tipo/usuario en cliente). Orden por `ts` es single-field automático. |
| TTL Firestore | Política sobre campo `expireAt` (paso de setup en consola/gcloud, documentado). |

### Contexto del codebase (verificado)

- SPA en un único `public/index.html` desplegado en Firebase Hosting.
- Roles en Firestore `/usuarios/{email}`, campo `rol` = `admin` | `supervisor` | `user`.
  Cargados en login a `currentUser = { email, name, isAdmin, isSupervisor }`.
- Vistas actuales: `dashboard`, `registro`, `historico`, `admin`; el panel admin se
  muestra con `currentUser.isAdmin` vía `showView()` (array de vistas en la función).
- Botones de menú `nav-*` (desktop) y `mtab-*` (tabs móviles).
- Chart.js 4.4.1 ya cargado por CDN. Firebase SDK v10 compat (app, firestore, auth, storage, functions).
- JS auxiliares se cargan como archivos separados con `?v=` (`concesiones.js`, `gmailAuth.js`).
- Service worker `sw.js` cachea una lista de assets (`CACHE_ASSETS`) y versiona con `CACHE_NAME`.

## 4. Esquema de datos — colección `metrics_logs`

Un documento por evento (id automático), pequeño y truncado:

```
ts         : serverTimestamp()                 // orden y gráficos
type       : 'error' | 'action' | 'activity' | 'perf'
event      : string corto. Ej: 'rv_create', 'mail_send', 'firma_submit',
             'login', 'logout', 'view_change', 'js_error', 'promise_rejection'
ok         : boolean | null                    // acciones/perf: éxito/fallo
user       : string  (email, o 'anon' si pre-auth)
name       : string  (nombre visible)
view       : string  (vista actual)
detail     : map     ({ nro:'RV-2026-0001', dest:'x@y.cl', ... }) — chico, sin blobs
msg        : string  (mensaje corto / de error)
stack      : string  (stack truncado ~1500 chars; solo errores)
durationMs : number  (solo perf)
ua         : string  (navegador/SO)
appVer     : string  (versión de la app, p. ej. 'v20260605', para correlacionar con deploys)
expireAt   : Timestamp = ahora + 90 días        // TTL borra solo
```

Reglas de tamaño: `stack` y `detail` se truncan; `detail` nunca incluye PDFs, imágenes
ni payloads grandes. PII mínima (solo email/nombre del usuario interno y destinatarios de correo).

## 5. Capa de captura — `public/metricsLog.js`

Objeto global `window.Metrics`:

- `Metrics.init(getUser, db)` — conecta el accesor del usuario actual y la instancia de
  Firestore. Se llama desde `index.html` tras inicializar Firebase.
- `Metrics.setUser(user)` — actualiza el usuario en login/logout.
- `Metrics.error(event, errOrMsg, fields)`
- `Metrics.action(event, ok, fields)`
- `Metrics.activity(event, fields)`
- `Metrics.perf(event, durationMs, fields)`
- `Metrics.time(label)` → devuelve `stop()` para medir duración de operaciones.

**Handlers globales:** `window.addEventListener('error', ...)` y `'unhandledrejection'`.

**Buffer + volcado:**
- Cola en memoria. Se vacía: cada ~15 s (`setInterval`), al alcanzar 20 eventos, y en
  `pagehide` / `visibilitychange → hidden` (best-effort).
- Escribe con `db.batch()` (hasta 500 por lote). Fire-and-forget.
- Si el volcado falla, re-encola con tope (máx ~200 eventos; descarta los más viejos)
  para no crecer en memoria sin límite.

**Throttle de ruido:**
- `view_change`: se loguea solo la transición a una vista distinta (no repeticiones inmediatas).
- Errores idénticos (misma firma `event+msg`) dentro de ~60 s se colapsan (se evita spam).

**Seguridad del propio logger (no debe romper la app):**
- Todos los métodos públicos en `try/catch`; **nunca lanzan** hacia el app.
- Guardia anti-recursión: el logger no loguea sus propios fallos (a lo más `console.warn` una vez).
- Cola acotada.

**Pre-auth y página pública de firma:**
- Si no hay usuario @certimar.cl autenticado, **bufferiza pero no vuelca** (las reglas
  exigen auth). `user` se marca `'anon'` hasta que `setUser` reciba el email.
- En la página pública `?view=firma` no escribe (no rompe nada).

## 6. Instrumentación (puntos de llamada en `index.html`)

- Login éxito → `Metrics.setUser(currentUser)` + `Metrics.activity('login')`.
- Logout (`cerrarSesion`) → `Metrics.activity('logout')`.
- `showView(view)` → `Metrics.activity('view_change', { view })`.
- Guardar RV → `Metrics.action('rv_create', ok, { nro })` + `Metrics.perf('rv_create', ms)`;
  en fallo `Metrics.error('rv_create_fail', e, { nro })`.
- Generar PDF → `Metrics.perf('pdf_generate', ms)` + ok/fallo.
- Enviar correo / token Gmail → `Metrics.action('mail_send', ok, { dest })` o `Metrics.error('mail_send_fail', e)`.
- Generar link de firma → `Metrics.action('firma_link', ok, { nro })`.
- Firma cliente (`submitFirma`) → `Metrics.action('firma_submit', ok, { nro })`.
- Reenviar notificación, eliminar registro, exportar → `Metrics.action(...)`.
- Fallos de lectura Firestore / token Gmail → `Metrics.error(...)`.

(Los nombres exactos de funciones se resuelven al implementar; arriba están los flujos.)

## 7. Acceso — menú superadmin + reja PIN

- Nuevo botón `nav-metricas` (desktop) y tab `mtab-metricas` (móvil), ocultos por defecto;
  se muestran solo si `currentUser.isAdmin` (mismo gating que admin). Se agrega `'metricas'`
  al array de vistas de `showView()`, y `if (view === 'metricas') abrirMetricas();`.
- Vista `view-metricas` oculta inicialmente.
- Al entrar a `metricas`: si la sesión no está desbloqueada
  (`sessionStorage['certimar_metrics_unlocked'] !== '1'`), se muestra la **reja PIN** en
  lugar del panel.

### 7.1 Configuración del PIN (autoservicio)

El PIN nunca se guarda en claro. Se guarda `pinHash` = SHA-256 (Web Crypto
`crypto.subtle.digest`) en `/config/metrics`, doc **legible/escribible solo por admin**.

- **Primera vez** (no existe `/config/metrics` o sin `pinHash`): pantalla **"Crea un PIN"**
  (PIN + confirmar; mín. 4 dígitos). Al confirmar, hashea y escribe
  `{ pinHash, updatedAt: serverTimestamp(), updatedBy: email }`. Desbloquea la sesión.
- **Acceso normal:** pantalla **"Ingresa el PIN"**. Hashea lo tecleado y compara con
  `pinHash`. Correcto → `sessionStorage['certimar_metrics_unlocked']='1'` → renderiza panel.
  Incorrecto → toast de error, sigue bloqueado.
- **Cambiar PIN:** botón dentro del panel → pide PIN actual + nuevo + confirmar; verifica
  el actual contra el hash y escribe el nuevo.
- **Recuperación (PIN olvidado):** un admin borra/edita el doc `/config/metrics` en la
  consola Firestore → vuelve a aparecer "Crea un PIN".
- Desbloqueo válido por la sesión del navegador (sessionStorage); se vuelve a pedir al
  cerrar la pestaña.

### 7.2 Nota de seguridad (honesta)

El PIN es una **reja blanda** (un segundo paso deliberado), no seguridad real. La seguridad
real es: dominio @certimar.cl + rol `admin` + reglas de lectura de Firestore sobre
`metrics_logs`. Un admin decidido podría saltarse el PIN en cliente — aceptable para un
panel de métricas interno.

## 8. Panel — `view-metricas` (reusa estilos `.admin-*`)

- **Header** + badge "SUPERADMIN".
- **Filtros:** rango (hoy / 7d / 30d / 90d / personalizado; **default 7d**), tipo
  (error/action/activity/perf/todos), usuario (dropdown construido desde los logs cargados),
  búsqueda de texto, botón **Refrescar** y botón **Exportar CSV**.
- **KPIs** (tarjetas `.admin-stat`): errores en rango, usuarios activos, RV creadas,
  correos ok / fallidos, tiempo promedio de operaciones (ms).
- **Gráficos (Chart.js):**
  - Línea: eventos por día (por tipo, o errores por día).
  - Barras: actividad por usuario (top N).
  - Barras/dona: correos ok vs fallidos.
- **Tabla filtrable** (`.admin-table`, paginada igual que el panel admin): columnas
  `ts`, `tipo`, `evento`, `usuario`, `vista`, `ok`, `mensaje`; click en fila expande
  `detail`/`stack`.
- **Carga — `cargarMetricas()`:** consulta `metrics_logs` `where ts >= rangeStart`
  `orderBy ts desc` con `limit` de seguridad (~5000 lecturas). Agrega en cliente para
  KPIs/gráficos/tabla. El filtro de tipo/usuario/texto se hace en cliente (evita índice compuesto).
- **CSV:** arma el CSV de lo filtrado y dispara descarga (Blob + `a[download]`).

## 9. Reglas Firestore, índices y TTL

### Reglas (agregar a `firestore.rules`)

```
// Logs de métricas — cualquier @certimar.cl crea; solo admin lee; sin update/delete (TTL borra)
match /metrics_logs/{id} {
  allow create: if request.auth != null &&
    request.auth.token.email.matches('.*@certimar[.]cl');
  allow read: if request.auth != null &&
    get(/databases/$(database)/documents/usuarios/$(request.auth.token.email)).data.rol == 'admin';
  allow update, delete: if false;
}

// Config del panel (pinHash) — solo admin
match /config/{docId} {
  allow read, write: if request.auth != null &&
    get(/databases/$(database)/documents/usuarios/$(request.auth.token.email)).data.rol == 'admin';
}
```

### Índices

- Orden por `ts` con `where ts >=` es single-field (índice automático). **Sin compuesto.**
- Si más adelante se filtra por `type` en la consulta del servidor, agregar índice
  compuesto `(type asc, ts desc)`. Por ahora el filtro de tipo es en cliente.

### TTL

- Activar política TTL de Firestore sobre el campo `expireAt` de `metrics_logs`
  (Consola → Firestore → TTL, o `gcloud firestore fields ttls update expireAt
  --collection-group=metrics_logs --enable-ttl`).
- Hasta activarla, los docs persisten (inofensivo). Documentar como paso de setup.

## 10. Despliegue / service worker

- Agregar `<script src="metricsLog.js?v=20260605"></script>` en `index.html`, después de
  `firebaseConfig.js` y antes del script principal (para que `Metrics` exista temprano y
  capture errores tempranos).
- En `sw.js`: agregar `/metricsLog.js` a `CACHE_ASSETS` y subir `CACHE_NAME` a `certimar-rv-v7`.
- Desplegar reglas Firestore (`firebase deploy --only firestore:rules`) y hosting.

## 11. Manejo de errores (resumen)

- El logger nunca lanza al app (try/catch global, guardia anti-recursión, cola acotada).
- Fallos de volcado se reintentan vía re-encolado acotado; si persisten, se descartan
  silenciosamente (a lo más un `console.warn`).
- El panel maneja consultas vacías (estado "sin datos") y errores de lectura (toast + estado vacío).

## 12. Verificación (manual — no hay test harness en el repo)

1. Provocar un error JS → confirmar doc en `metrics_logs` con `type:'error'` y stack.
2. Guardar una RV, enviar un correo, firmar → confirmar `action` ok/fallo y `perf`.
3. Entrar a "Métricas" como admin → flujo "Crea un PIN" la 1ª vez; luego "Ingresa el PIN".
4. Verificar KPIs, los 3 gráficos y la tabla filtrable; exportar CSV y abrirlo.
5. Cambiar el PIN desde el panel y reentrar con el nuevo.
6. Con un usuario no-admin: el menú no aparece y la lectura de `metrics_logs` es rechazada por reglas.
7. Abrir la página pública `?view=firma`: no se rompe y no intenta volcar logs.
8. (Opcional) Confirmar que el TTL elimina docs con `expireAt` vencido tras activarlo.
```
