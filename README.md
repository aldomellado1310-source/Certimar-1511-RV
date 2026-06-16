# Certimar — Sistema de Registro de Visita (RV)

Sistema web de registro de inspecciones técnicas en terreno para centros de cultivo acuícola, desarrollado sobre Google Apps Script. Permite crear, firmar, guardar y notificar registros de visita como documentos PDF, con trazabilidad completa en Google Sheets y Firebase Firestore.

---

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `Code.gs` | Backend: Sheets, Drive, Gmail, firma remota |
| `Index.html` | Frontend SPA completo (vistas, estilos, lógica) |
| `FirebaseConfig.html` | Configuración del SDK de Firebase (incluido en Index) |
| `ConcesionesData` | Catálogo de concesiones para autocomplete |
| `appsscript.json` | Manifiesto de permisos y scopes OAuth |
| `functions/index.js` | Firebase Functions (Node.js 20): correo, firma, mail queue |

---

## Stack tecnológico

- **Frontend/Backend:** Google Apps Script (web app, un solo despliegue)
- **Base de datos:** Google Sheets (hoja `RV`) + Firebase Firestore (tiempo real)
- **Almacenamiento:** Firebase Storage (PDFs, fotos, firmas PNG)
- **Funciones serverless:** Firebase Functions (Node.js 20) — envío de correo, firma remota, procesamiento de cola
- **Librerías cliente:** jsPDF + html2canvas, Chart.js, Firebase SDK v10 compat
- **Autenticación:** Google OAuth (login con cuenta Google) — **acceso restringido a cuentas `@certimar.cl`**
- **Envío de correo:** Gmail API directa (desde la cuenta del certificador logueado) + GmailApp como respaldo en Apps Script

---

## Herramientas de desarrollo y despliegue

| Herramienta | Versión | Uso |
|---|---|---|
| [clasp](https://github.com/google/clasp) | 3.x | CLI para push/deploy de Apps Script sin abrir el editor web |
| [Firebase CLI](https://firebase.google.com/docs/cli) | Latest | Deploy de Functions, Hosting y reglas de Firestore/Storage |
| Node.js | 20 | Runtime de Firebase Functions |
| npm | — | Gestión de dependencias en `functions/` |

### Comandos frecuentes

```bash
# Apps Script — subir código y redesplegar
clasp push
clasp deploy --deploymentId <ID> --description "v3.x - descripción"

# Firebase — desplegar solo funciones
firebase deploy --only functions

# Firebase — desplegar todo
firebase deploy
```

---

## Seguridad y acceso

El sistema restringe el inicio de sesión exclusivamente a cuentas del dominio `@certimar.cl`. Cualquier usuario que intente autenticarse con una cuenta de otro dominio recibe un error y queda deslogueado automáticamente.

---

## Vistas / Menús

### Navegación principal (navbar sticky)

| Elemento | Función |
|---|---|
| Logo / marca | Navega al Dashboard |
| **Dashboard** | Métricas, gráficos y filtros |
| **Histórico** | Listado completo de registros con búsqueda |
| **Admin** *(rol restringido)* | Gestión avanzada, archivado, re-envío |
| **Nueva Visita** | Abre el formulario en blanco |
| **Toggle tema** | Cambia entre modo claro y oscuro |
| **User chip** | Muestra avatar y nombre del usuario logueado |

---

## Vista: Dashboard

- **Filtros:** fecha desde/hasta, centro, N° de registro
- **KPIs:** última inspección, inspecciones del mes, centros únicos en el año
- **Gráficos:** inspecciones por mes (barras), distribución por resolución (dona)
- **Tabla:** certificaciones próximas a vencer
- **Elemento decorativo:** olas SVG animadas + peces nadando en el fondo inferior

---

## Vista: Formulario de Registro (RV)

### Documento principal

Simula un documento oficial en papel (`doc-paper`) con watermark de olas animadas.

**Header del documento**
- Logo Certimar + título "REGISTRO DE VISITA" + subtítulo "Auditoría Técnica en Terreno"
- Fecha autogenerada y N° correlativo (`RV-YYYY-NNNN`) en rojo

**Tabla de datos del centro**

| Campo | Notas |
|---|---|
| Centro de Cultivo | Texto libre |
| N° de Centro | Con autocomplete desde catálogo de concesiones |
| A.C.S. | Agente Certificador Sernapesca |
| Titular del Centro | Texto libre |
| Ubicación | Texto libre |
| Región | Texto libre |
| Sector | Texto libre |
| Fecha última siembra | Texto libre, dispara validación del checklist |
| Tamaño de peces | Texto libre, dispara validación del checklist |
| Largo jaula (m) | Numérico |
| Ancho jaula (m) | Numérico |
| Cantidad de jaulas | Numérico |
| Jaulas sembradas | Numérico |
| A/N Ensilaje | Artefacto naval de ensilaje, texto libre |

**Norma aplicable** — checkboxes múltiples:
- 1821 – CIC E2 / 1821 – CA / 1821 – VS / 1511 / DESINFECCIÓN

**Coordenadas geográficas:** Latitud S, Longitud W, Norte, Este

**Observaciones:**
- Radio SI/NO
- Textarea de texto libre
- Tipo de observación (checkboxes): EXTRACCION, DESNATURALIZACION, ALMACENAMIENTO, ESTRUCTURA, FONDEO, OTRO

**Firmas (dos columnas):**
- Certificador: canvas dibujable, nombre y N° registro preconfigurados, botón "Guardar firma"
- Responsable del centro: canvas dibujable con botón de expansión a modal de pantalla completa, nombre y email (valida formato)

**Disclaimer legal** al pie, con nombre del certificador dinámico

### Modal de firma expandida

El canvas de firma del responsable incluye un botón ⛶ que abre un modal de pantalla completa (`modal-firma-expand`), ideal para dispositivos táctiles. El modal permite dibujar con mayor precisión y al cerrarse copia la firma de vuelta al canvas principal del formulario.

### Checklist de completitud

Tarjeta lateral que valida en tiempo real si el formulario está listo para guardar/enviar. Items: fecha siembra, tamaño peces, observaciones, email, firma. Muestra badge bloqueado/desbloqueado.

### Cámara / Adjunto

Captura foto desde cámara del dispositivo o permite adjuntar imagen/PDF existente. Vista previa inline.

### Barra de acciones

| Botón | Función |
|---|---|
| Guardar | Guarda en Drive + Sheets (sin correo) |
| Generar PDF | Genera PDF en cliente con jsPDF/html2canvas |
| Sincronizar | Fuerza re-subida a Drive/Sheets |
| Enviar correo | Modal con previsualización de email, campos CC/CCO, envío vía Gmail API |

---

## Vista: Histórico

- Barra de búsqueda de texto libre (busca en centro, titular, N° registro)
- Filtros de fecha desde/hasta
- Tabla con columnas: N° registro, fecha, centro, titular, resolución, estado (GUARDADO / ENVIADO), link al PDF
- Acciones por fila: editar campos, reenviar correo, ver log de auditoría, generar link de firma remota

---

## Vista: Admin *(rol restringido)*

- Estadísticas numéricas en tarjetas
- Tabla ampliada con filtros adicionales
- Acciones: archivar registro (con motivo), regenerar PDF, gestionar tokens de firma, reenviar correo directamente vía Gmail API desde la cuenta del certificador
- Badge visual púrpura que distingue el acceso de administrador

---

## Envío de correo — Gmail API directa

El sistema utiliza la **Gmail API** directamente desde el navegador para enviar correos como el usuario logueado (no como cuenta de servicio). Esto requiere que el token OAuth incluya el scope `https://www.googleapis.com/auth/gmail.send`, capturado al momento del login con `getAccessToken()` de Firebase Auth.

**Flujo:**
1. Al iniciar sesión se captura el OAuth token de Google y se almacena en memoria
2. Al guardar + enviar, el frontend construye el correo (MIME/RFC 2822) usando `plantillaEmailFrontend()`
3. El mensaje se codifica en base64url y se despacha a `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`
4. Si el envío vía Gmail API falla, el sistema cae en respaldo hacia Apps Script (GmailApp)

---

## Sistema de notificaciones

- **Sidebar de notificaciones** (derecha, slide-in): muestra progreso paso a paso con indicadores por color (PDF → Drive → Sheets → Email)
- **Toast** (esquina inferior derecha): mensajes rápidos de éxito/error
- **Completion dialog**: modal post-guardado con N° de registro, envío de correo inline (CC/CCO) y acciones para ir al Dashboard, ver Histórico o continuar editando

---

## Flujo de firma remota

1. Desde el panel Admin, se genera un link único con token UUID para el registro
2. El token se almacena en Firestore con estado `PENDIENTE`; la URL apunta a `https://certimar-rv.web.app/firma?nro=...&token=...`
3. El responsable abre la página de firma (sin login requerido), revisa los datos del RV y firma con canvas táctil
4. Si no se registró nombre previamente, la página solicita el nombre del jefe de centro (mínimo 3 caracteres)
5. La firma PNG se sube a Firebase Storage (`firmas/Firma_RV-YYYY-NNNN.png`), el token se invalida y el estado se actualiza en Sheets (`FIRMADO`) y Firestore
6. Se envían dos emails:
   - **Al responsable del centro:** confirmación de conformidad registrada con datos del RV y link al certificado
   - **A `operaciones@certimar.cl` (Certimar interno):** notificación con detalle completo (nombre del firmante, email, link a PNG de firma, link al certificado)
7. El panel Admin muestra un badge `✅ FIRMADO` / `⏳ PENDIENTE` / `— S/F` en la columna Firma; el botón 🔗 se deshabilita automáticamente cuando ya fue firmado

---

## Backend — Funciones principales (`Code.gs`)

| Función | Descripción |
|---|---|
| `guardarYEnviar()` | Sube PDF, foto y firma a Drive, escribe en Sheets, envía correo — en un solo viaje |
| `obtenerRegistros()` | Lee Sheets con filtros, devuelve JSON |
| `obtenerEstadisticas()` | Agrega datos para el Dashboard (por mes, por resolución) |
| `actualizarRegistro()` | Edita una fila existente desde el Histórico |
| `enviarNotificacion()` | Reenvía correo con PDF adjunto desde historial |
| `generarLinkFirma()` | Genera token UUID en Firestore + URL temporal para firma remota |
| `getRegistroParaFirma()` | Valida token (formato + estado FIRMADO), devuelve datos del RV |
| `submitFirma()` | Recibe firma del responsable, sube PNG a Drive, invalida token, notifica al responsable y a Certimar |
| `borrarFirma()` | Borra token, URL y estado de firma — permite re-solicitar firma desde Admin |
| `_enviarCorreoRV()` | Construye HTML email y despacha vía GmailApp (CC, CCO, copia interna) |
| `doPost()` | Webhook receptor de Firebase que escribe en Sheets y envía correo sin service account |
| `_generarNroRegistro()` | Correlativo `RV-YYYY-NNNN` buscando el máximo existente en la hoja |
| `testEnvioCorreo()` | Función de test manual que verifica Drive, Sheets, Gmail y plantilla |

---

## Firebase Functions (`functions/index.js`)

| Función | Trigger | Descripción |
|---|---|---|
| `enviarNotificacion` | HTTPS Callable (auth) | Envía correo con PDF adjunto y actualiza estado en Firestore; requiere que el registro exista en Firestore antes de enviar |
| `generarLinkFirma` | HTTPS Callable (auth) | Genera token UUID, lo escribe en Firestore (`tokenFirma`, `estadoFirma: PENDIENTE`) y retorna URL de firma |
| `procesarFirmaCliente` | HTTPS Callable (público) | Verifica token, sube firma PNG a Storage (`firmas/`), actualiza Firestore (`FIRMADO`) |
| `procesarMailQueue` | Firestore trigger `mail_queue/{docId}` | Escucha nuevos documentos en la cola de correo y los despacha vía Apps Script webhook |
| `migrarPDFsDrive` | HTTPS Callable (auth) | Utilidad de migración: descarga PDFs desde URL pública y los sube a Firebase Storage |

### Variables de entorno (`functions/.env`)

```bash
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
```

---

## Estructura de la hoja Google Sheets (hoja `RV`)

| Col | Encabezado |
|---|---|
| A | Fecha |
| B | N° Registro |
| C | Centro |
| D | N° Centro |
| E | ACS |
| F | Titular |
| G | Área |
| H | Fecha última siembra |
| I | Tamaño peces |
| J | Ubicación |
| K | Lat Long |
| L | Res ext |
| M | Observaciones |
| N | Tipo de observación |
| O | Nombre responsable |
| P | Correo responsable |
| Q | Hipervínculo al certificado |
| R | Estado (GUARDADO / ENVIADO) |
| S | URL Firma Cliente |
| T | Token Firma |
| U | Estado Firma (PENDIENTE / FIRMADO) |

---

## Estética general

- **Paleta:** azul marino `#003366` / azul medio `#0055a4` / cyan `#0099CC` sobre blancos y grises slate
- **Dark mode completo** vía atributo `data-theme="dark"` con variables CSS
- **Fuente:** Segoe UI / Arial, sin-serif
- **Bordes:** radius generoso (10–14px), sombras suaves en capas
- **Motivo decorativo recurrente:** olas SVG animadas en multicapa (splash, dashboard, watermark del documento, formulario)
- **Logo:** SVG inline — grilla de peces + olas + checkmark — en todas las vistas
- **Responsive:** navbar colapsado en móvil, modales como bottom-sheet en pantallas pequeñas, grillas adaptables

---

## Guía de despliegue

### 1. Crear el proyecto en Apps Script

1. Ve a [script.google.com](https://script.google.com)
2. Clic en **Nuevo proyecto** y nómbralo `Certimar - Registro de Visita`

### 2. Copiar los archivos

- **`Code.gs`:** borra el contenido por defecto y pega el contenido del archivo
- **`Index.html`:** clic en **+** → **HTML**, nómbralo `Index` (sin extensión), pega el contenido
- **`FirebaseConfig.html`:** crear como HTML con nombre `FirebaseConfig`
- **`ConcesionesData`:** crear como HTML con nombre `ConcesionesData`
- **`appsscript.json`:** en **Ver → Mostrar archivo de manifiesto**, reemplazar contenido

### 3. Configurar constantes en `Code.gs`

```javascript
const SPREADSHEET_ID    = 'ID_DE_TU_SPREADSHEET';
const SHEET_NAME        = 'RV';
const DRIVE_FOLDER_ID   = 'ID_DE_TU_CARPETA_DRIVE';
const EMAIL_REMITENTE   = 'tu@empresa.cl';
const EMAIL_COPIA_FIRMA = 'otro@empresa.cl';
const TIMEZONE          = 'America/Santiago';
const FIREBASE_PROJECT_ID = 'tu-proyecto-firebase';
const WEBHOOK_SECRET    = 'TU_SECRET_COMPARTIDO';
```

### 4. Inicializar la hoja (una sola vez)

1. Seleccionar función `inicializarHoja` en el editor
2. Clic en **Ejecutar** y aceptar los permisos
3. Esto crea la hoja `RV` con encabezados y formato

### 5. Publicar como Web App

1. **Implementar → Nueva implementación**
2. Tipo: **Aplicación web**
3. Ejecutar como: **Usuario que accede a la aplicación**
4. Quién puede acceder: **Cualquier usuario de Google**
5. Copiar la URL generada (`https://script.google.com/macros/s/.../exec`)

### 6. Configurar Firebase Functions

```bash
cd functions
cp .env.example .env      # si existe, o crear manualmente
# Agregar APPS_SCRIPT_URL=<URL del paso 5>
firebase deploy --only functions
```

### 7. Configurar Firebase (Hosting y Firestore)

Actualizar `FirebaseConfig.html` con las credenciales del proyecto Firebase y desplegar reglas:

```bash
firebase deploy --only firestore:rules,storage
firebase deploy --only hosting
```

---

## Permisos OAuth requeridos

Al ejecutar por primera vez, Google solicitará autorizar:
- Google Sheets (lectura/escritura)
- Gmail (enviar correos) — incluye scope `gmail.send` para Gmail API directa
- Google Drive (subir archivos)
- Información del usuario (email)

---

## Qué cambiar al replicar para otro tipo de certificación

Lo **específico de acuicultura/Sernapesca** que debe adaptarse:

| Elemento | Ubicación | Descripción |
|---|---|---|
| Resoluciones | `Index.html` + `Code.gs` | Reemplazar 1821-CIC E2, CA, VS, 1511, DESINFECCIÓN por las normas aplicables |
| Campos del formulario | `Index.html` (sección `doc-table`) | Centro de Cultivo, ACS, siembra, peces → campos del nuevo dominio |
| Autocomplete | `ConcesionesData` | Catálogo de entidades del nuevo dominio |
| Prefijo del correlativo | `Code.gs` `_generarNroRegistro()` | `RV-` → el prefijo que corresponda |
| Disclaimer legal | `Index.html` (sección firma) | Texto de la norma y organismo regulador |
| Texto del email | `Code.gs` `_plantillaEmail()` + `Index.html` `plantillaEmailFrontend()` | Saludo, descripción y referencia normativa |
| Nombre del sistema | `Index.html` título, splash, nav | "Registro de Visita" → nombre del nuevo documento |
| Dominio restringido | `Index.html` (login handler) | Cambiar `@certimar.cl` por el dominio corporativo correspondiente |

Lo **reutilizable sin cambios:** autenticación, Drive, Sheets, Firebase, generación de PDF, firma canvas + modal expandido, Gmail API directa, notificaciones sidebar, dark mode, dashboard con Charts, Histórico, Admin, responsive.
