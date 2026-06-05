# Diseño — Token de Gmail vía GIS con refresco silencioso

**Fecha:** 2026-06-05
**Estado:** Aprobado (pendiente plan de implementación)
**Proyecto:** Certimar RV (`certimar-rv`)

## Problema

El envío de correo desde el frontend falla con *"Sin token Gmail. Vuelve a iniciar sesión."*
([index.html:4755](../../../public/index.html)) cuando la sesión se restaura sola.

**Causa raíz:** `_gmailToken` es una variable en memoria que **solo** se asigna dentro del
callback de `signInWithPopup` en `loginGoogle()` ([index.html:2321](../../../public/index.html)).
Pero la sesión se restaura por otro camino — `onAuthStateChanged`
([index.html:2238](../../../public/index.html)) — que rellena `currentUser` y llama a `showApp()`
**sin pasar nunca por `loginGoogle()`**. Firebase Auth persiste y refresca su propio ID token,
pero **no** el access token OAuth del proveedor (Google), que es ephemeral y solo está disponible
en el resultado del popup interactivo. Resultado: tras recargar / reabrir la PWA / que el service
worker sirva el HTML desde caché, el usuario aparece logueado y puede **guardar** (Firestore solo
necesita el ID token), pero el correo falla porque `_gmailToken` está en `null`.

Causa secundaria: el access token de Google expira en ~1 h y no había refresco.

## Objetivo

Obtener y refrescar el access token de `gmail.send` de forma **silenciosa** (sin popup) usando
Google Identity Services (GIS), de modo que el envío de correo funcione tras restaurar sesión y tras
la expiración del token, manteniendo la arquitectura de que **cada certificador envía desde su
propia cuenta**.

## Decisiones tomadas (brainstorming)

- **Enfoque elegido:** GIS token client (`google.accounts.oauth2.initTokenClient`) con refresco
  silencioso, separado de Firebase Auth.
- **Fallback:** automático — warm-up silencioso tras login; si al enviar falta el token, como el
  envío es un gesto de click, se dispara el consentimiento automáticamente y continúa el envío.
  El usuario solo ve UI de Google la primera vez (o si se revoca el permiso).
- **Organización del código:** módulo aparte `public/gmailAuth.js` (análogo a `firebaseConfig.js`).

## Arquitectura

Se separan las dos credenciales que hoy están enredadas:

- **Firebase Auth** → solo **identidad**: login, gating `@certimar.cl`, roles desde Firestore,
  persistencia de sesión. Se le **quita** el scope `gmail.send` a `loginGoogle()`.
- **GIS token client** → solo el **access token de `gmail.send`**, obtenido y refrescado por
  separado. Sobrevive a recargas porque se re-pide en silencio mientras haya sesión de Google viva.

El módulo `public/gmailAuth.js` encapsula toda la lógica del token; `index.html` solo lo consume.

## Componentes

### `public/firebaseConfig.js`
Agregar la constante de config OAuth (el valor real se copia desde Cloud Console):
```js
var GOOGLE_OAUTH_CLIENT_ID = '272750169092-XXXXXXXX.apps.googleusercontent.com';
```

### `public/gmailAuth.js` (nuevo)
API pública mínima:

- `initGmailAuth()` — crea el `tokenClient` con
  `google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_OAUTH_CLIENT_ID,
  scope: 'https://www.googleapis.com/auth/gmail.send', callback })`. Se llama una vez al cargar
  (cuando `google.accounts` esté disponible).
- `warmGmailToken()` — intento **silencioso** (`requestAccessToken({ prompt: '' })`); si hay
  consentimiento previo deja el token listo; si no, falla sin molestar al usuario.
- `ensureGmailToken()` → `Promise<string>` — devuelve un token válido:
  - si está en memoria y no vencido, lo retorna de inmediato;
  - si no, intenta silencioso (`prompt: ''`); si no alcanza, dispara consentimiento
    (`prompt: 'consent'`).
  - Envuelve el callback de GIS (que no es promesa) en una `Promise`.
- Estado interno del módulo: `_gmailToken` (string) y `_gmailTokenExp` (timestamp). GIS entrega
  `expires_in` (segundos); se refresca ~5 min antes de vencer.

### `public/index.html` (cambios)
- Cargar el SDK de GIS y el módulo:
  `<script src="https://accounts.google.com/gsi/client" async></script>` +
  `<script src="gmailAuth.js?v=YYYYMMDD"></script>`.
- `loginGoogle()`: quitar `provider.addScope('…/auth/gmail.send')`; ya no captura token.
- `onAuthStateChanged` (tras setear `currentUser`): llamar `warmGmailToken()`.
- `sendViaGmailAPI(raw)`: reemplazar el `throw 'Sin token Gmail'` por
  `var token = await ensureGmailToken();` y usar ese token en el header `Authorization`. En 401/403,
  invalidar el token y reintentar **una** vez vía `ensureGmailToken()`.

## Flujo de datos

1. Carga la página → `initGmailAuth()` prepara el `tokenClient`.
2. `onAuthStateChanged` restaura identidad → `currentUser` listo → `warmGmailToken()` pide token en
   silencio (sin popup).
3. Usuario guarda y pulsa enviar → `sendViaGmailAPI` → `ensureGmailToken()`:
   - token caliente y vigente → se usa al instante (caso normal tras warm-up);
   - vencido/ausente → silencioso; si no alcanza → popup de consentimiento (1ª vez o revocado) →
     continúa el envío solo.
4. Gmail responde 401/403 (token revocado a mitad) → invalidar + un reintento.

Los tres puntos de envío — `handleEnviarMail` ([index.html:3528](../../../public/index.html)),
`handleCompletionEnviar` ([index.html:4783](../../../public/index.html)) y `admReenviarMail`
([index.html:5170](../../../public/index.html)) — comparten `sendViaGmailAPI`, así que el cambio es
en un solo punto.

## Manejo de errores y casos límite

- **Consentimiento denegado / popup cerrado:** mensaje accionable *"No se autorizó el acceso a
  Gmail. Intenta de nuevo."* (reemplaza el confuso "vuelve a iniciar sesión").
- **Popup bloqueado por el navegador:** como el warm-up deja el token listo, casi nunca aplica; aun
  así el envío es un gesto de click, lo que maximiza que GIS pueda abrir la UI.
- **Sin sesión de Google en el navegador:** el silencioso falla → cae a consentimiento (selector de
  cuenta).
- **GIS no cargó (offline/bloqueado):** `ensureGmailToken()` detecta `google.accounts` ausente y
  lanza un error claro.

## Configuración en Google Cloud Console (requisito previo, lo realiza el usuario)

- **Gmail API habilitada** en el proyecto `certimar-rv`.
- **OAuth Client ID (tipo Web):** copiar su valor a `firebaseConfig.js`.
- **Orígenes JavaScript autorizados** del client: `https://certimar-rv.web.app`,
  `https://certimar-rv.firebaseapp.com` y `http://localhost` (pruebas).
- **Pantalla de consentimiento OAuth** con el scope `https://www.googleapis.com/auth/gmail.send`. Si
  está en modo "Testing", agregar a los certificadores como test users (o publicar la app).

## Plan de pruebas

- **Local** (`firebase serve` / `localhost`): login → enviar → verificar correo enviado desde la
  cuenta del certificador.
- **Caso crítico (el bug):** login → recargar la página (simula restauración de sesión) → enviar →
  debe funcionar **sin** "Sin token Gmail".
- **Token vencido:** forzar `_gmailTokenExp` al pasado → enviar → refresco silencioso transparente.
- **Primera vez / revocado:** revocar permiso en myaccount.google.com/permissions → enviar →
  aparece consentimiento una vez → luego silencioso.

## Fuera de alcance (YAGNI)

- No se migra el correo a backend (Apps Script / Cloud Function).
- No se persiste el token en localStorage (GIS lo re-pide silenciosamente; persistirlo añade riesgo
  sin beneficio).
- No se cambia la plantilla del correo, los CC fijos, ni el flujo de guardado.
