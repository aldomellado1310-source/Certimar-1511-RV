# Certimar RV — Migración a Firebase (Diseño)
**Fecha:** 2026-04-09  
**Estado:** Aprobado por usuario  
**Autor:** Claude Sonnet 4.6 + Aldo Mellado

---

## 1. Objetivo

Migrar la app Certimar RV desde Google Apps Script a una webapp independiente hospedada en Firebase Hosting. Eliminar dependencia de Google Apps Script, Google Drive y Google Sheets. Toda la lógica queda en Firebase (Firestore + Storage + Functions + Hosting).

---

## 2. Stack objetivo

| Capa | Tecnología |
|---|---|
| Frontend hosting | Firebase Hosting |
| Base de datos | Firebase Firestore |
| Archivos (PDFs, fotos) | Firebase Storage |
| Backend / email | Firebase Functions (Node.js 18) |
| Autenticación | Firebase Auth — Google Sign-In |
| Email | nodemailer + Gmail App Password |

**Eliminado:** Google Apps Script, Google Drive, Google Sheets.

---

## 3. Arquitectura

```
Browser (public/index.html)
│
├── Firebase Auth          → Google Sign-In, roles por ADMIN_EMAILS
├── Firebase Firestore     → registros_visita, contador_nro
├── Firebase Storage       → certificados/, fotos/
│
└── Firebase Functions
    ├── enviarNotificacion  → email + adjunto PDF
    ├── generarLinkFirma    → token único + URL firma cliente
    ├── procesarFirmaCliente→ guarda firma en Storage + Firestore
    └── migrarPDFsDrive     → migración única de PDFs desde Drive (se elimina post-migración)
```

---

## 4. Archivos resultantes

```
public/
  index.html            ← Index.html actual, modificado (sin GAS)
  concesiones-data.js   ← extraído de ConcesionesData.html
  config.js             ← FirebaseConfig inline (sin <?!= ?>)
  manifest.json         ← PWA manifest
  sw.js                 ← Service Worker (cache offline)
  icons/                ← iconos PWA (192x192, 512x512)

functions/
  index.js              ← actualizado
  package.json          ← nodemailer, firebase-admin, googleapis (solo auth)

firebase.json           ← hosting + functions + firestore + storage
firestore.rules         ← sin cambios
storage.rules           ← agregar regla certificados/ lectura autenticada
```

---

## 5. Cambios en Index.html

### 5.1 Eliminar sintaxis Apps Script
```html
<!-- ANTES -->
<?!= include('FirebaseConfig') ?>
<?!= include('ConcesionesData') ?>

<!-- DESPUÉS -->
<script src="config.js"></script>
<script src="concesiones-data.js"></script>
```

### 5.2 Autenticación
```javascript
// ANTES
google.script.run.obtenerUsuario().withSuccessHandler(cb)

// DESPUÉS
firebase.auth().onAuthStateChanged(function(user) {
  if (!user) { mostrarPantallaLogin(); return; }
  currentUser = {
    email  : user.email,
    name   : user.displayName,
    isAdmin: ADMIN_EMAILS.includes(user.email)
  };
  iniciarApp();
});

// Login
firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());

// Logout
firebase.auth().signOut();
```

### 5.3 Reemplazos de google.script.run

| Llamada anterior | Reemplazo |
|---|---|
| `guardarRegistro(datos, pdfB64, ...)` | **Eliminado** — cliente hace Storage + Firestore directamente |
| `registrarEnSheets(datos, url)` | **Eliminado** — no hay Sheets |
| `enviarNotificacion(datos, url, pdfB64)` | `httpsCallable(functions, 'enviarNotificacion')({nro, pdfStoragePath})` |
| `actualizarRegistro(datos)` | `db.collection('registros_visita').doc(nro).update(datos)` |
| `fetchArchivoComoBase64(url)` | **Eliminado** — era proxy para Drive/Storage |
| `generarLinkFirma(nro)` | `httpsCallable(functions, 'generarLinkFirma')({nro})` |
| `procesarFirmaCliente(nro, b64)` | `httpsCallable(functions, 'procesarFirmaCliente')({nro, firmaB64})` |
| `borrarFirma(nro)` | `db.collection(...).doc(nro).update({ firmaCliente: '', estadoFirma: '' })` |
| `_generarNroRegistro()` | `fbGenerarNroRegistro()` — ya existe en cliente |
| `admReenviarMail(...)` | `httpsCallable(functions, 'enviarNotificacion')(datos)` |

### 5.4 Flujo guardar registro (nuevo)
```
1. Cliente genera PDF  (jsPDF comprimido)
2. Cliente sube PDF    → Storage: certificados/CertimarRV_{nro}.pdf
3. Cliente sube foto   → Storage: fotos/Foto_{nro}.{ext}
4. Cliente escribe     → Firestore: { urlPdfStorage, urlFoto, ... }
5. Si emailDestinatario → httpsCallable('enviarNotificacion', { nro, pdfStoragePath, datos })
6. Function descarga PDF de Storage → nodemailer → envía con adjunto
7. Function actualiza  → Firestore: { estado: 'ENVIADO' }
```

### 5.5 Lazy-load de jsPDF + html2canvas
```javascript
// Cargar solo al hacer clic en "Vista Previa PDF" o "Descargar PDF"
async function cargarLibsPDF() {
  if (window.jspdf && window.html2canvas) return;
  await Promise.all([
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
  ]);
}
```
Las librerías (~800KB) se cargan bajo demanda, reduciendo el tiempo de carga inicial.

---

## 6. Firebase Functions actualizadas

### 6.1 `enviarNotificacion`
```javascript
// Recibe: { nro, pdfStoragePath, datos }
// 1. Descarga PDF de Storage con Admin SDK (sin CORS)
// 2. Construye mailOptions con attachment Buffer
// 3. Envía con nodemailer
// 4. Actualiza Firestore estado → ENVIADO
// 5. Envía copia interna a certEmail
```

### 6.2 `generarLinkFirma`
```javascript
// Recibe: { nro }
// 1. Genera token UUID
// 2. Guarda en Firestore: { tokenFirma: token, estadoFirma: 'PENDIENTE' }
// 3. Retorna URL: https://{proyecto}.web.app/firma?nro={nro}&token={token}
```

### 6.3 `procesarFirmaCliente`
```javascript
// Recibe: { nro, firmaB64, token }
// 1. Verifica token en Firestore
// 2. Sube firma a Storage: firmas/Firma_{nro}.png
// 3. Actualiza Firestore: { urlFirmaCliente, estadoFirma: 'FIRMADO', tokenFirma: '' }
```

### 6.4 `migrarPDFsDrive` (temporal)
```javascript
// Recibe: { registros: [{ nro, urlCertificado }] }
// Para cada registro con urlCertificado:
//   1. Descarga PDF desde Drive via fetch() + OAuth2 con service account (googleapis)
//   2. Sube a Storage: certificados/CertimarRV_{nro}.pdf
//   3. Actualiza Firestore: { urlPdfStorage: downloadURL }
// Se elimina esta function después de la migración inicial
```

---

## 7. Compresión PDF

```javascript
// html2canvas: scale reducido → ~44% menos píxeles
const canvas = await html2canvas(el, {
  scale  : 1.5,      // era 2
  useCORS: true,
  logging: false
});

// Foto embebida: recomprimir a JPEG antes de insertar en PDF
const fotoDataUrl = appState.fotoB64
  ? recomprimirImagen(appState.fotoB64, 0.82)  // JPEG calidad 82%
  : null;

// jsPDF: compresión DEFLATE interna
const pdf = new jsPDF({
  orientation: 'portrait',
  unit       : 'mm',
  format     : 'a4',
  compress   : true   // NEW
});
```

Resultado esperado: PDFs de 6MB → 1.5–2.5MB manteniendo legibilidad de firma e impresión.

---

## 8. PWA

### `public/manifest.json`
```json
{
  "name": "Certimar RV",
  "short_name": "Certimar",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#003366",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### `public/sw.js` — cache offline
```javascript
// Cachea en instalación: index.html, config.js, concesiones-data.js
// Estrategia: Cache First para assets estáticos
// Estrategia: Network First para llamadas a Firestore/Functions
const CACHE_ASSETS = ['/', '/index.html', '/config.js', '/concesiones-data.js'];
```

---

## 9. Firebase App Check

```javascript
// public/index.html — inicialización
const appCheck = firebase.appCheck();
appCheck.activate('RECAPTCHA_V3_SITE_KEY', true);
```

Protege Functions de llamadas externas no autorizadas. Se configura en Firebase Console → App Check.

---

## 10. Migración de registros existentes

### Registros con PDF en Drive (`urlCertificado` ≠ '')
→ Botón **"Migrar PDFs desde Drive"** en panel Admin (solo admins).  
→ Llama a Firebase Function `migrarPDFsDrive` con la lista de registros.  
→ La Function descarga cada PDF de Drive y lo sube a Storage.  
→ Progreso mostrado en tiempo real en el panel.

### Registros sin PDF (0039, 0040 y similares)
→ Banner en Admin: **"X registros sin PDF — Regenerar todos"**.  
→ Botón itera automáticamente: carga datos → genera PDF → sube a Storage → siguiente.  
→ Sin intervención manual por registro.

---

## 11. Fases de implementación

| Fase | Contenido | Resultado |
|---|---|---|
| **1** | Firebase Hosting + Auth | App accesible en `certimar-rv.web.app`, login con Google |
| **2** | Reemplazar `google.script.run` | Email, firma, sin dependencia de Apps Script |
| **3** | Compresión PDF + migración registros | PDFs livianos, todos los registros con botón Descargar |
| **4** | PWA + lazy-load + App Check | Instalable en móvil, carga rápida, seguridad |

---

## 12. URL de producción

```
https://certimar-rv.web.app        (o dominio personalizado)
https://certimar-rv.firebaseapp.com
```

La URL de Apps Script (`script.google.com/macros/s/.../exec`) queda obsoleta.

---

## 13. Lo que NO cambia

- Todo el HTML/CSS del formulario, histórico y admin
- Lógica de Firestore (fbGuardarRegistro, fbObtenerRegistros, etc.)
- Firebase Storage para fotos
- Estructura de documentos en Firestore (`registros_visita`)
- Checklist de bloqueo
- Panel Admin con filtros, paginación y acciones
- Generación de PDF con jsPDF + html2canvas
