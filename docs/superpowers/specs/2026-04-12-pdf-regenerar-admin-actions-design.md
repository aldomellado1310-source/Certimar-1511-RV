# Design: Regenerar PDF + Acciones Admin

**Fecha:** 2026-04-12  
**Proyecto:** Certimar RV (certimar-rv.web.app)  
**Archivo principal:** `public/index.html`

---

## Objetivo

1. Permitir regenerar y subir PDFs a Firebase Storage desde la vista certificador y desde el panel admin.
2. Agregar botón de descarga del PDF guardado en Storage.
3. Completar el panel admin con un menú kebab (⋮) que incluye 6 acciones por registro.

---

## Arquitectura

### Dos superficies de cambio

**A) Vista Certificador**

Cuando `appState.savedData?.nroRegistro` existe (registro ya guardado), se muestran dos botones nuevos en la barra de acciones:

- **🔄 Regenerar PDF** — siempre visible post-guardado. Genera PDF con formulario actual, sube a Storage, actualiza Firestore.
- **📄 Descargar PDF** — visible solo si `appState.savedData.urlCertificado` existe. Abre desde Storage en nueva pestaña. Se activa automáticamente tras regeneración exitosa.

Ambos se deshabilitan durante la generación para evitar doble click.

**B) Panel Admin (tabla)**

Reemplazar los botones actuales `[📄] [✉️]` por un único botón `⋮` que abre un dropdown con 6 acciones.

---

## Flujo Regenerar PDF (compartido)

1. Poblar el formulario DOM (`#registro-documento`) con los datos del registro
2. Generar PDF con `html2canvas` + `jsPDF` (función `generarPDF()` existente)
3. Subir a Firebase Storage: `certificados/{nroRegistro}.pdf`
4. Obtener download URL
5. Actualizar campo `urlCertificado` en Firestore
6. Activar botón 📄 Descargar en la UI

Para admin: dado que `html2canvas` requiere que `#registro-documento` esté visible en el DOM, el flujo es:
1. Guardar vista actual
2. Cargar datos del registro en el formulario
3. Cambiar a vista certificador (brevemente, con overlay de carga)
4. Generar y subir PDF
5. Volver a vista admin automáticamente

El usuario ve un overlay "Generando PDF…" durante el proceso. El cambio de vista es transparente.

---

## Acciones del menú ⋮ (Admin)

| Acción | Comportamiento |
|--------|---------------|
| 🔄 Regenerar PDF | Ejecuta flujo de regeneración. Actualiza fila al terminar. |
| 📄 Descargar PDF | Abre `urlCertificado` en nueva pestaña. Gris/deshabilitado si no existe URL. |
| ✉️ Reenviar correo | Comportamiento actual sin cambios. |
| ✏️ Editar registro | Modal con campos editables: `nombreResponsable`, `emailResponsable`, `observaciones`, `tipoObservacion`. Campos de identidad (`centroCultivo`, `titular`, `nroCentro`, `acs`, `resoluciones`) son solo lectura por integridad normativa. Guarda en Firestore y refresca fila. |
| 🗂️ Archivar / Desarchivar | Toggle: `estado !== 'ARCHIVADO'` → `ARCHIVADO`; ya archivado → `GUARDADO`. Actualiza Firestore, refresca fila. |
| 🗑️ Eliminar | `confirm()` con N° registro. Elimina documento de Firestore. Si tiene `urlCertificado`, elimina archivo de Storage. Remueve de `_adminAll` y re-renderiza. |

---

## Funciones nuevas en `public/index.html`

- `subirPDFaStorage(pdfBlob, nroRegistro)` — sube a Storage, retorna download URL
- `regenerarPDF(nroRegistro, datosRegistro)` — orquesta flujo completo
- `admEditarRegistro(nroRegistro)` — abre modal de edición
- `admArchivar(nroRegistro, estadoActual)` — toggle archivar
- `admEliminar(nroRegistro, urlCertificado)` — elimina registro y archivo

---

## Cambios HTML

- Botones `🔄 Regenerar PDF` y `📄 Descargar PDF` en barra de acciones del certificador (después de guardar)
- Modal de edición admin: `<div id="modal-editar-registro">` con campos editables
- Columna de acciones admin: reemplazar botones inline por `<div class="kebab-container">⋮</div>`
- Estilos para: dropdown kebab, botones de la barra certificador, modal edición

---

## Storage

- Ruta: `certificados/{nroRegistro}.pdf`
- Si ya existe, se sobreescribe en cada regeneración
- CORS ya configurado para `certimar-rv.web.app` (fix previo)

---

## Manejo de errores

- Si Storage falla: toast de error, no actualizar Firestore
- Si Firestore falla: toast de error, el archivo ya está en Storage pero sin URL registrada (retry posible)
- Eliminar: si borrado de Storage falla, continuar con borrado de Firestore igual (archivo huérfano es aceptable)
