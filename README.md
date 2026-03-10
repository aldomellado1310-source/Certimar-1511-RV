# 🐟 Certimar — Registro de Visita en Google Apps Script

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `Code.gs` | Backend: Sheets, Drive, Gmail |
| `Index.html` | Frontend SPA completo |
| `appsscript.json` | Manifiesto de permisos |

---

## 🚀 Pasos para publicar

### 1. Crear el proyecto en Apps Script

1. Ve a [script.google.com](https://script.google.com)
2. Haz clic en **"Nuevo proyecto"**
3. Nómbralo **"Certimar - Registro de Visita"**

---

### 2. Copiar los archivos

#### `Code.gs`
- Borra el contenido del archivo `Code.gs` que viene por defecto
- Copia y pega todo el contenido de tu `Code.gs`

#### `Index.html`
- Haz clic en el ícono **"+"** (junto a los archivos) → **"HTML"**
- Nómbralo exactamente `Index` (sin extensión)
- Copia y pega todo el contenido de `Index.html`

#### `appsscript.json`
- Ve a **Ver → Mostrar archivo de manifiesto**
- Reemplaza todo el contenido con el de `appsscript.json`

---

### 3. Configurar el Spreadsheet ID

En `Code.gs`, línea 7, reemplaza el ID con el de tu Spreadsheet:
```javascript
const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI';
```

El ID lo encuentras en la URL de tu hoja:
`https://docs.google.com/spreadsheets/d/`**`1Gq_8OBd75OnSzk9e6GXtOjhs8nhL9fKrlFzs_w4MezM`**`/edit`

El ID de tu hoja actual es: `1Gq_8OBd75OnSzk9e6GXtOjhs8nhL9fKrlFzs_w4MezM`

---

### 4. Inicializar la hoja (una sola vez)

1. En Apps Script, selecciona la función `inicializarHoja`
2. Haz clic en **"Ejecutar"**
3. Acepta los permisos que solicite
4. Esto crea la hoja `RV` con los encabezados correctos en tu Spreadsheet

---

### 5. Publicar como Web App

1. Haz clic en **"Implementar" → "Nueva implementación"**
2. Tipo: **Aplicación web**
3. Descripción: `v1.0`
4. Ejecutar como: **Usuario que accede a la aplicación**
5. Quién puede acceder: **Cualquier usuario de Google**
6. Copia la URL generada (ej: `https://script.google.com/macros/s/AKfy.../exec`)

---

### 6. (Opcional) Configurar carpeta Drive

Si tienes una carpeta específica en Drive para los PDFs:
- En `Code.gs` línea 8, reemplaza el folder ID:
```javascript
const DRIVE_FOLDER_ID = 'TU_FOLDER_ID';
```
Si no lo configuras, creará automáticamente una carpeta llamada **"Certificados Certimar"** en tu Drive raíz.

---

## 📋 Estructura de la Spreadsheet (hoja "RV")

| Col | Encabezado |
|-----|-----------|
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

---

## 🔧 Notas técnicas

- **Sin OAuth manual**: Apps Script maneja la autenticación de Google automáticamente
- **PDF**: Se genera en el navegador (jsPDF + html2canvas via CDN) y se sube a Drive como base64
- **Email**: Se envía con GmailApp desde la cuenta del usuario que ejecuta la acción
- **Firma digital**: Canvas HTML5, funciona en móvil y escritorio
- **Cámara**: Usa getUserMedia, requiere HTTPS (Apps Script ya es HTTPS)

---

## ⚠️ Permisos requeridos

Al ejecutar por primera vez, Google pedirá autorizar:
- Google Sheets (lectura/escritura)
- Gmail (enviar correos)
- Google Drive (subir archivos)
- Info del usuario (email)

Esto es normal y necesario para que la app funcione.
