# Certimar — Sistema de Registro de Visita (RV)

Sistema web de registro de inspecciones técnicas en terreno para centros de cultivo acuícola. Permite crear, firmar, guardar y notificar registros de visita como documentos PDF, con trazabilidad completa en Firebase Firestore. Corre **100% sobre Firebase** (sin Google Apps Script).

App en producción: **https://certimar-rv.web.app**

---

## Arquitectura

| Capa | Tecnología |
|---|---|
| **Frontend (SPA)** | `public/index.html` servido por Firebase Hosting (vanilla JS, sin framework) |
| **Identidad** | Firebase Auth (login con Google), restringido a cuentas `@certimar.cl`; roles en Firestore |
| **Datos** | Firebase Firestore (colecciones `registros_visita`, `metrics_logs`, `config`) |
| **Almacenamiento** | Cloud Storage (`certificados/`, `fotos/`, `firmas/`) |
| **PDF** | Generado en el cliente con `html2canvas` + `jsPDF` 2.5.1; normalizado en `public/pdfMail.js` |
| **Correo** | Gmail API vía Google Identity Services (`public/gmailAuth.js`); se envía con la sesión del certificador |
| **Funciones serverless** | Firebase Functions (Node 20): firma de cliente por link |
| **Gráficos** | Chart.js 4 |

No se usa Google Apps Script, Google Sheets ni Drive.

---

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `public/index.html` | SPA completa: vistas (Dashboard, Histórico, Admin, Registro, Métricas), estilos y lógica |
| `public/firebaseConfig.js` | Config del SDK web de Firebase (`FIREBASE_CONFIG`) + `GOOGLE_OAUTH_CLIENT_ID` |
| `public/gmailAuth.js` | Token de Gmail (`gmail.send`) vía GIS, con refresco silencioso |
| `public/metricsLog.js` | Logger de métricas (buffer + flush por lotes a Firestore) |
| `public/pdfMail.js` | Normalización del PDF (base64) para adjunto de correo y guardado |
| `public/firma.html` + `public/firmaPage.js` | Página pública de firma de cliente por link |
| `public/concesiones.js` | Catálogo de concesiones para autocomplete |
| `public/sw.js` | Service worker (Network-First para HTML, precache de assets) |
| `functions/index.js` | Functions: `generarLinkFirma`, `getRegistroParaFirma`, `procesarFirmaCliente` |
| `functions/firmaHelpers.js` | Helpers puros (validación de token/nombre/email) |
| `firebase.json` | Hosting (rewrites `/firma` + SPA), Functions, reglas Firestore/Storage |
| `test/*.test.js` | Tests de lógica pura (node + `assert`) |

---

## Herramientas de desarrollo y despliegue

| Herramienta | Versión | Uso |
|---|---|---|
| [Firebase CLI](https://firebase.google.com/docs/cli) | Latest | Deploy de Hosting, Functions y reglas Firestore/Storage |
| Node.js | 20 | Runtime de Firebase Functions y de los tests |
| npm | — | Dependencias en `functions/` |

### Comandos frecuentes

```bash
# Tests de lógica pura
for t in test/*.test.js; do node "$t"; done

# Desplegar todo
firebase deploy

# Solo hosting / solo functions
firebase deploy --only hosting
firebase deploy --only functions
```

---

## Vistas / Menús

### Navegación principal (navbar sticky)

| Elemento | Función |
|---|---|
| Logo / marca | Navega al Dashboard |
| **Dashboard** | Métricas, gráficos y filtros |
| **Histórico** | Listado completo de registros con búsqueda |
| **Admin** *(rol restringido)* | Gestión avanzada, archivado, re-envío, firma por link |
| **Métricas** *(superadmin)* | Panel de logs y KPIs (protegido por PIN) |
| **Nueva Visita** | Abre el formulario en blanco |
| **Toggle tema** | Cambia entre modo claro y oscuro |
| **User chip** | Avatar y nombre del usuario logueado |

---

## Vista: Dashboard

- **Filtros:** fecha desde/hasta, centro, N° de registro
- **KPIs:** última inspección, inspecciones del mes, centros únicos en el año
- **Gráficos:** inspecciones por mes (barras), distribución por resolución (dona)
- **Tabla:** certificaciones próximas a vencer
- **Decorativo:** olas SVG animadas + peces en el fondo inferior

---

## Vista: Formulario de Registro (RV)

Simula un documento oficial en papel (`doc-paper`). Header con logo Certimar, título "REGISTRO DE VISITA", fecha autogenerada y N° correlativo (`RV-YYYY-NNNN`).

**Tabla de datos del centro:** Centro de Cultivo, N° de Centro (autocomplete desde catálogo de concesiones), A.C.S., Titular, Ubicación, Fecha última siembra, Tamaño de peces, jaulas, A/N Ensilaje.

**Norma aplicable** (checkboxes): 1821 – CIC E2 / 1821 – CA / 1821 – VS / 1511 / DESINFECCIÓN.

**Coordenadas:** Latitud S, Longitud W, Norte, Este.

**Observaciones:** radio SI/NO + textarea + tipo de observación.

**Firmas (dos columnas):** Certificador (canvas, nombre y RUT) y Responsable del centro (canvas, nombre y email).

### Checklist de completitud
Tarjeta lateral que valida en tiempo real si el formulario está listo para guardar/enviar.

### Cámara / Adjunto
Captura foto desde la cámara o adjunta imagen/PDF, con vista previa inline.

### Barra de acciones

| Botón | Función |
|---|---|
| Guardar | Crea el registro en Firestore y sube PDF/foto/firma a Storage |
| Generar PDF | Genera el PDF en el cliente (jsPDF/html2canvas) |
| Enviar correo | Envía el PDF adjunto vía Gmail API (con CC/CCO) |

> El PDF generado, enviado y guardado es **uno solo**: el adjunto del correo se deriva de los mismos bytes subidos a Storage.

---

## Vista: Histórico

- Búsqueda de texto libre y filtros de fecha
- Selector de columnas visibles
- Tabla con N° registro, fecha, centro, estado y link al PDF
- Acciones por fila: ver, editar, regenerar PDF

---

## Vista: Admin *(rol restringido)*

- Estadísticas en tarjetas y tabla ampliada con filtros
- Acciones: ver PDF, reenviar correo, editar, regenerar PDF, **solicitar firma por link**, eliminar
- Badge púrpura que distingue el acceso de administrador

---

## Sistema de notificaciones

- **Sidebar** (derecha): progreso paso a paso por color (PDF → Storage → Firestore → Email)
- **Toast** (inferior derecha): mensajes rápidos de éxito/error
- **Completion dialog**: modal post-guardado con envío de correo inline

---

## Flujo de firma de cliente por link

1. Desde Admin, el botón **🔗 Firma por link** llama a la Function `generarLinkFirma`, que crea un token UUID, lo guarda en el registro (`tokenFirma`, `estadoFirma: PENDIENTE`) y devuelve la URL `https://certimar-rv.web.app/firma?nro=...&token=...`.
2. El responsable abre esa URL (sin login). `public/firma.html` llama a `getRegistroParaFirma` (valida el token) y muestra los datos del RV.
3. El responsable revisa/corrige nombre y correo, firma en el canvas y envía: `procesarFirmaCliente` valida el token, sube la firma PNG a Storage (`firmas/Firma_<nro>.png`), actualiza Firestore (`estadoFirma: FIRMADO`, `urlFirmaCliente`) e invalida el token.
4. Reabrir el mismo link tras firmar lo rechaza (token vacío).

Las tres Functions son `onCall` (SDK callable). `generarLinkFirma` exige sesión autenticada; `getRegistroParaFirma` y `procesarFirmaCliente` son públicas y se protegen por token.

---

## Firebase Functions (`functions/index.js`)

| Función | Tipo | Descripción |
|---|---|---|
| `generarLinkFirma` | onCall (auth) | Genera token UUID + URL de firma para el registro |
| `getRegistroParaFirma` | onCall (pública, por token) | Devuelve los datos del RV a mostrar en la página de firma |
| `procesarFirmaCliente` | onCall (pública, por token) | Sube la firma a Storage y marca el registro como FIRMADO |

---

## Datos en Firestore

Colección `registros_visita`, doc id = `RV-YYYY-NNNN`. Campos relevantes: `fecha`, `centroCultivo`, `nroCentro`, `acs`, `titular`, `ubicacion`, `resoluciones`, coordenadas, `observaciones`, `tipoObservacion`, `nombreResponsable`, `emailResponsable`, `urlCertificado`, `pdfStoragePath`, `urlFoto`, `urlFirmaCliente`, `estado` (GUARDADO/ENVIADO/ARCHIVADO), `tokenFirma`, `estadoFirma` (PENDIENTE/FIRMADO).

Otras colecciones: `metrics_logs` (logs de uso, con TTL), `config` (p.ej. PIN del panel de métricas).

---

## Estética general

- **Paleta:** azul marino `#003366` / azul medio `#0055a4` / cyan `#0099CC` sobre blancos y grises slate
- **Dark mode** vía `data-theme="dark"` con variables CSS
- **Fuente:** Segoe UI / Arial
- **Motivo decorativo:** olas SVG animadas en multicapa
- **Responsive:** navbar colapsado en móvil, modales como bottom-sheet, grillas adaptables

---

## Guía de despliegue

### 1. Pre-requisitos
- Node.js 20 y Firebase CLI (`npm i -g firebase-tools`), autenticado (`firebase login`).
- Proyecto Firebase `certimar-rv` con Auth (Google), Firestore, Storage y Functions habilitados.

### 2. Configurar credenciales web
Editar `public/firebaseConfig.js` con `FIREBASE_CONFIG` (config web del proyecto) y `GOOGLE_OAUTH_CLIENT_ID` (cliente OAuth para GIS / scope `gmail.send`).

### 3. Dependencias de Functions
```bash
cd functions && npm install
```

### 4. Desplegar
```bash
firebase deploy
```

### 5. Verificación
- Generar un RV y enviar el correo: el PDF adjunto debe abrir bien.
- Ver el PDF en móvil desde Histórico/Admin: proporción correcta.
- Solicitar firma por link, abrir la URL en otro dispositivo, firmar y confirmar `estadoFirma: FIRMADO`.

---

## Qué cambiar al replicar para otro tipo de certificación

| Elemento | Ubicación | Descripción |
|---|---|---|
| Resoluciones | `public/index.html` | Reemplazar 1821-CIC E2, CA, VS, 1511, DESINFECCIÓN por las normas aplicables |
| Campos del formulario | `public/index.html` (sección `doc-table`) | Adaptar al nuevo dominio |
| Autocomplete | `public/concesiones.js` | Catálogo de entidades del nuevo dominio |
| Prefijo del correlativo | `public/index.html` (creación del registro) | `RV-` → el prefijo que corresponda |
| Disclaimer legal | `public/index.html` (sección firma) | Norma y organismo regulador |
| Texto del email | `public/index.html` (`plantillaEmailFrontend`) | Saludo, descripción y referencia normativa |
| Nombre del sistema | `public/index.html` (título, splash, nav) | "Registro de Visita" → nombre del nuevo documento |

Lo **reutilizable sin cambios:** autenticación, Storage, Firestore, generación de PDF, firma canvas, notificaciones, dark mode, dashboard con Charts, Histórico, Admin, firma por link, responsive.
