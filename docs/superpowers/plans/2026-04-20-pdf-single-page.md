# PDF Una Página — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El PDF del Registro de Visita cabe en exactamente una página A4, sin texto truncado ni firma cortada ni páginas en blanco extra.

**Architecture:** En lugar de capturar a escala fija y paginar con cortes, se captura el elemento completo (con padding temporal para garantizar el fondo) y se escala la imagen para que quepa en una sola página A4. La paginación manual y la lógica firmaTopPdf se eliminan completamente. El div reemplazo del textarea recibe el ancho exacto renderizado para evitar overflow horizontal.

**Tech Stack:** html2canvas 1.4.1, jsPDF, vanilla JS en `public/index.html`

---

## Archivo a modificar

| Archivo | Cambios |
|---|---|
| `public/index.html` | Función `generarPDF` — reemplazar lógica de paginación y corregir div de textarea |

Todos los cambios están dentro de `async function generarPDF()` (aprox. líneas 2425–2529).

---

### Task 1: Corregir ancho del div reemplazo del textarea

**Problema:** `cs.width` devuelve el ancho del contenido (sin padding/border), pero el div tiene `box-sizing: border-box`. Esto produce un div ligeramente más angosto que el textarea, y en el contexto de html2canvas el texto no se acota y se desborda horizontalmente.

**Archivo:** `public/index.html`

- [ ] **Step 1: Localizar la línea del div replacement**

Buscar en el archivo:
```
div.style.width = cs.width;
```
Está dentro del bloque `el.querySelectorAll('textarea').forEach(...)`, aprox. línea 2444.

- [ ] **Step 2: Reemplazar `cs.width` por el ancho renderizado real del textarea**

Cambiar:
```javascript
    div.style.width = cs.width;
    div.style.padding = cs.padding;
```
Por:
```javascript
    div.style.width = ta.getBoundingClientRect().width + 'px';
    div.style.maxWidth = ta.getBoundingClientRect().width + 'px';
    div.style.padding = cs.padding;
    div.style.overflow = 'hidden';
```

`ta.getBoundingClientRect().width` da el ancho del border-box renderizado en pantalla — el mismo que html2canvas usará como contexto. `max-width` asegura que el div no se expanda más allá de ese límite. `overflow: hidden` evita que texto desbordado se filtre.

- [ ] **Step 3: Verificar visualmente en el formulario**

Abrir el formulario, escribir 3–4 líneas en observación, generar PDF. Confirmar que el texto aparece completo sin cortarse horizontalmente.

---

### Task 2: Eliminar lógica firmaTopPdf y paginación de intervalo fijo

**Problema:** La paginación `while (pos < pdfH) { pos += pageH }` corta el contenido en intervalos fijos. La lógica `firmaTopPdf` intenta compensar pero añade una página extra y no resuelve el corte de fondo.

**Archivo:** `public/index.html`

- [ ] **Step 1: Localizar el bloque de cálculo firmaTopPdf**

El bloque está entre las líneas `var pdfH = ...` y `var pageH = ...`, aprox.:
```javascript
  // Posición Y de la sección de firmas en coordenadas PDF (para evitar salto de página en medio)
  var firmaTopPdf = 0;
  var firmaSec = el.querySelector('.firma-section');
  if (firmaSec) {
    var elR = el.getBoundingClientRect();
    var fR  = firmaSec.getBoundingClientRect();
    firmaTopPdf = (fR.top - elR.top) * 1.5 * (pdfW / canvas.width);
  }
```

- [ ] **Step 2: Eliminar ese bloque completo** (las 7 líneas anteriores)

- [ ] **Step 3: Localizar el bloque de paginación if/else**

Actualmente se ve así:
```javascript
  var pageH = pdf.internal.pageSize.getHeight();
  if (pdfH <= pageH) {
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
  } else {
    var pos = 0;
    var firmaBreakDone = false;
    while (pos < pdfH) {
      if (pos > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, -pos, pdfW, pdfH);
      var nextPos = pos + pageH;
      if (!firmaBreakDone && firmaTopPdf > pos && firmaTopPdf < nextPos && nextPos < pdfH) {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, firmaTopPdf - pos, pdfW, pageH - (firmaTopPdf - pos), 'F');
        firmaBreakDone = true;
        pos = firmaTopPdf;
      } else {
        pos = nextPos;
      }
    }
  }
```

- [ ] **Step 4: Reemplazar todo ese bloque por el escalado fit-one-page**

```javascript
  // Escalar para que quepa exactamente en una página A4 (sin paginar)
  var pageH = pdf.internal.pageSize.getHeight();
  var scale = Math.min(pdfW / (canvas.width / 1.5 * (pdfW / (canvas.width / 1.5))), pdfH / pdfH);
  // Calcular dimensiones de la imagen respetando aspect ratio
  var imgW = pdfW;
  var imgH = (canvas.height / canvas.width) * pdfW;
  if (imgH > pageH) {
    // Si el contenido es más alto que una página A4, escalar para que quepa
    imgH = pageH;
    imgW = (canvas.width / canvas.height) * pageH;
  }
  var xOff = (pdfW - imgW) / 2;
  var yOff = (pageH - imgH) / 2;
  pdf.addImage(imgData, 'JPEG', xOff, yOff, imgW, imgH);
```

**Nota:** `xOff` y `yOff` centran la imagen en la página. Si el contenido cabe al ancho completo (`imgH <= pageH`), `xOff = 0` y `yOff > 0` (pequeño margen vertical). Si escala para altura, `yOff = 0` y `xOff > 0`.

- [ ] **Step 5: Verificar que `pdfH` sigue usándose para la foto en página 2**

Buscar `if (appState.fotoB64)` justo después. Ese bloque hace `pdf.addPage()` y añade la foto — esto es correcto y se mantiene sin cambios.

---

### Task 3: Garantizar captura completa del elemento (padding-bottom temporal)

**Problema:** El `el.scrollHeight` puede quedar corto por unos pixels cuando `overflow:visible` está activo, dejando el fondo de la firma sin capturar.

**Archivo:** `public/index.html`

- [ ] **Step 1: Verificar que el bloque de padding temporal existe**

Buscar en el código:
```javascript
  var savedPB = el.style.paddingBottom;
  el.style.paddingBottom = (parseFloat(window.getComputedStyle(el).paddingBottom) + 100) + 'px';
```

Si existe, está correcto — pasar al Step 3.

Si NO existe, añadirlo justo antes del `await new Promise(function(r){ requestAnimationFrame(r); });`:
```javascript
  var savedPB = el.style.paddingBottom;
  el.style.paddingBottom = (parseFloat(window.getComputedStyle(el).paddingBottom) + 100) + 'px';
```

- [ ] **Step 2: Verificar que el bloque finally restaura el padding**

Buscar en el bloque `finally`:
```javascript
  } finally {
    if (prevTheme === 'dark') root.setAttribute('data-theme', 'dark');
    el.style.paddingBottom = savedPB;
    textareaReplacements.forEach(function(r) {
```

Si `el.style.paddingBottom = savedPB;` no está, añadirlo después de la línea del tema oscuro.

- [ ] **Step 3: Confirmar que `height` y `windowHeight` usan `el.scrollHeight` sin +80**

El html2canvas debe tener:
```javascript
    height: el.scrollHeight,
    windowHeight: el.scrollHeight,
```
(sin el `+ 80` del intento anterior, ya que el padding temporal lo hace innecesario).

Si dice `el.scrollHeight + 80`, cambiar ambos a `el.scrollHeight`.

---

### Task 4: Validar y hacer commit

- [ ] **Step 1: Leer el estado final de `generarPDF` completo**

Leer las líneas 2425–2530 del archivo para confirmar que el código resultante sea coherente. El flujo debe ser:

```
1. Guardar tema → cambiar a light
2. Declarar textareaReplacements = []
3. try {
4.   Reemplazar textareas por divs (con getBoundingClientRect width)
5.   Guardar y aumentar paddingBottom
6.   await requestAnimationFrame
7.   canvas = await html2canvas(scale 1.5, height: el.scrollHeight, ...)
8.   Crear jsPDF A4
9.   imgData = canvas.toDataURL('image/jpeg', 0.88)
10.  Calcular imgW/imgH para fit-one-page
11.  pdf.addImage(imgData, 'JPEG', xOff, yOff, imgW, imgH)
12.  if (appState.fotoB64) → addPage y añadir foto
13.  return pdf
14. } finally {
15.   Restaurar tema
16.   Restaurar paddingBottom
17.   Restaurar textareas
18. }
```

- [ ] **Step 2: Probar con el registro de ejemplo**

Abrir https://certimar-rv.web.app, cargar el registro de visita, generar PDF y verificar:
- [ ] Observación completa sin truncamiento horizontal
- [ ] Firma: ambas firmas visibles con canvas completo
- [ ] RUT del certificador visible
- [ ] Correo del encargado visible
- [ ] TODO en UNA sola página
- [ ] No hay páginas extra en blanco

- [ ] **Step 3: Commit y deploy**

```bash
git add public/index.html
git commit -m "fix: PDF en una página — fit-to-page + ancho correcto en div textarea"
firebase deploy --only hosting
```

---

## Notas de implementación

**¿Por qué fit-to-page y no paginar?**
El formulario de visita está diseñado para caber en una hoja. Paginar a intervalos fijos inevitablemente corta contenido en el punto arbitrario donde cae el corte. Fit-to-page garantiza que todo el contenido aparece y deja al navegador/impresora decidir el zoom.

**¿Qué pasa si el contenido es MUY largo?**
Si la observación tiene muchos párrafos, `imgH > pageH` y se escala todo a la altura de la página. El texto será más pequeño pero legible. Para documentos muy largos, considerar en el futuro un approach de dos pasadas (observación en página 1, firma en página 2), pero eso es fuera del scope actual.

**¿La foto de evidencia sigue en página 2?**
Sí. El bloque `if (appState.fotoB64) { pdf.addPage(); ... }` no se toca. La foto siempre va en página 2.
