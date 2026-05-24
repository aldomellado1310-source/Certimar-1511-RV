# Selector de columnas en Histórico — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un botón "Columnas ▾" en la barra de filtros del Histórico que abre un dropdown agrupado para mostrar/ocultar columnas, con preferencia persistida en localStorage.

**Architecture:** App monolítica en `public/index.html` (vanilla JS, sin framework). Todo el trabajo ocurre en ese único archivo. Se agrega un array de definición de columnas, helpers de localStorage, CSS para el dropdown, HTML para el botón, y se refactoriza `renderHistorico()` para renderizar dinámicamente solo las columnas activas.

**Tech Stack:** HTML/CSS/JavaScript vanilla, localStorage, Google Apps Script / Firestore (backend no cambia).

**Spec de referencia:** `docs/superpowers/specs/2026-05-22-selector-columnas-historico-design.md`

---

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `public/index.html` | Único archivo a modificar — CSS (~línea 521), HTML (~línea 1273), JS (~líneas 1547, 3078, 3163) |

---

## Task 1: Variables globales y helpers de localStorage

**Files:**
- Modify: `public/index.html` — bloque `<script>`, junto a `var historicData = []` (~línea 1547)

- [ ] **Step 1: Insertar después de `var localRecords = [];` (línea 1548)**

Encontrar esta línea:
```javascript
var localRecords = [];
```

Insertar inmediatamente después:
```javascript
var HIST_COL_DEFS = [
  { key: 'titular',           label: 'Titular',              grupo: 'Identificación',   defaultVisible: true  },
  { key: 'nroCentro',         label: 'N° Centro',            grupo: 'Identificación',   defaultVisible: false },
  { key: 'acs',               label: 'ACS',                  grupo: 'Identificación',   defaultVisible: false },
  { key: 'area',              label: 'Área',                 grupo: 'Datos del centro', defaultVisible: false },
  { key: 'fechaSiembra',      label: 'Fecha última siembra', grupo: 'Datos del centro', defaultVisible: false },
  { key: 'tamanioPeces',      label: 'Tamaño peces',         grupo: 'Datos del centro', defaultVisible: false },
  { key: 'ubicacion',         label: 'Ubicación',            grupo: 'Datos del centro', defaultVisible: false },
  { key: 'latLong',           label: 'Lat / Long',           grupo: 'Datos del centro', defaultVisible: false },
  { key: 'resExt',            label: 'Res. Externa',         grupo: 'Visita',           defaultVisible: true  },
  { key: 'tipoObs',           label: 'Tipo Observación',     grupo: 'Visita',           defaultVisible: true  },
  { key: 'observaciones',     label: 'Observaciones',        grupo: 'Visita',           defaultVisible: false },
  { key: 'responsable',       label: 'Responsable',          grupo: 'Visita',           defaultVisible: true  },
  { key: 'correoResponsable', label: 'Correo Responsable',   grupo: 'Visita',           defaultVisible: false },
  { key: 'estadoFirma',       label: 'Estado Firma',         grupo: 'Visita',           defaultVisible: false },
];

function getVisibleHistColumns() {
  try {
    var saved = localStorage.getItem('certimar_hist_columns');
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return HIST_COL_DEFS.filter(function(c){ return c.defaultVisible; }).map(function(c){ return c.key; });
}

function saveVisibleHistColumns(keys) {
  localStorage.setItem('certimar_hist_columns', JSON.stringify(keys));
}
```

- [ ] **Step 2: Verificar en consola del navegador**

Abrir la app en el navegador, abrir DevTools → Consola y ejecutar:
```javascript
console.log(getVisibleHistColumns());
// Esperado: ["titular", "resExt", "tipoObs", "responsable"]

console.log(HIST_COL_DEFS.length);
// Esperado: 14
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: agregar HIST_COL_DEFS y helpers localStorage para selector de columnas"
```

---

## Task 2: CSS del botón y dropdown

**Files:**
- Modify: `public/index.html` — bloque `<style>`, después de `.hist-footer{...}` (~línea 521) y después de `[data-theme="dark"] .hist-search-bar{...}` (~línea 304)

- [ ] **Step 1: Agregar estilos del dropdown después de `.hist-footer{...}`**

Encontrar esta línea (~línea 521):
```css
.hist-footer{padding:12px 16px;border-top:1px solid #f1f5f9;background:#f8fafc;font-size:12px;color:#64748b}
```

Insertar inmediatamente después:
```css
.hist-col-btn{height:32px;background:#0099CC;color:white;border:none;border-radius:8px;padding:0 12px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;white-space:nowrap;transition:.2s}
.hist-col-btn:hover{background:#007aaa}
.hist-col-btn.open{border-bottom-left-radius:0;border-bottom-right-radius:0}
#hist-col-dropdown{position:absolute;top:100%;right:0;width:220px;background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:1000;max-height:400px;overflow-y:auto}
#hist-col-dropdown.hidden{display:none}
.hist-col-fixed-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.hist-col-fixed-chip{background:#f1f5f9;color:#64748b;border-radius:4px;padding:2px 7px;font-size:10px}
.hist-col-group-label{font-size:10px;color:#0099CC;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 5px}
.hist-col-option{display:flex;align-items:center;gap:6px;color:#374151;font-size:12px;margin-bottom:5px;cursor:pointer}
.hist-col-option input[type=checkbox]{cursor:pointer}
```

- [ ] **Step 2: Agregar dark mode overrides después de `[data-theme="dark"] .hist-search-bar{...}`**

Encontrar esta línea (~línea 304):
```css
[data-theme="dark"] .hist-search-bar{background:var(--surface-2);border-color:var(--border)}
```

Insertar inmediatamente después:
```css
[data-theme="dark"] #hist-col-dropdown{background:var(--surface);border-color:var(--border)}
[data-theme="dark"] .hist-col-fixed-chip{background:var(--surface-2);color:var(--text-sec)}
[data-theme="dark"] .hist-col-option{color:var(--text-pri)}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: agregar CSS para botón y dropdown de selector de columnas"
```

---

## Task 3: HTML — botón, dropdown container y ajustes de thead/colspan

**Files:**
- Modify: `public/index.html` — sección HTML del histórico (~líneas 1273-1297)

- [ ] **Step 1: Agregar botón y contenedor del dropdown en `hist-search-bar`**

Encontrar este bloque (~línea 1275):
```html
        <div style="display:flex;gap:8px">
          <input type="date" id="hist-desde" class="filtro-input" style="width:140px" onchange="filtrarHistorico()">
          <input type="date" id="hist-hasta" class="filtro-input" style="width:140px" onchange="filtrarHistorico()">
          <select id="hist-estado" class="filtro-input" style="width:130px" onchange="filtrarHistorico()">
            <option value="">Todos los estados</option>
            <option value="GUARDADO">Guardado</option>
            <option value="ENVIADO">Enviado</option>
            <option value="ARCHIVADO">Archivado</option>
          </select>
        </div>
```

Reemplazarlo con:
```html
        <div style="display:flex;gap:8px;align-items:center">
          <input type="date" id="hist-desde" class="filtro-input" style="width:140px" onchange="filtrarHistorico()">
          <input type="date" id="hist-hasta" class="filtro-input" style="width:140px" onchange="filtrarHistorico()">
          <select id="hist-estado" class="filtro-input" style="width:130px" onchange="filtrarHistorico()">
            <option value="">Todos los estados</option>
            <option value="GUARDADO">Guardado</option>
            <option value="ENVIADO">Enviado</option>
            <option value="ARCHIVADO">Archivado</option>
          </select>
          <div style="position:relative">
            <button id="hist-col-btn" class="hist-col-btn" onclick="toggleHistColDropdown()">⊞ Columnas ▾</button>
            <div id="hist-col-dropdown" class="hidden"></div>
          </div>
        </div>
```

- [ ] **Step 2: Agregar id="hist-thead" al thead**

Encontrar (~línea 1288):
```html
          <thead>
            <tr>
              <th>ID Registro</th><th>Fecha</th><th>Centro</th><th>Titular</th>
              <th>Res. Ext.</th><th>Tipo Obs.</th><th>Responsable</th><th>Estado</th><th>Certificado</th><th>Acciones</th>
            </tr>
          </thead>
```

Reemplazarlo con:
```html
          <thead id="hist-thead">
            <tr>
              <th>ID Registro</th><th>Fecha</th><th>Centro</th><th>Titular</th>
              <th>Res. Ext.</th><th>Tipo Obs.</th><th>Responsable</th><th>Estado</th><th>Certificado</th><th>Acciones</th>
            </tr>
          </thead>
```

- [ ] **Step 3: Cambiar colspan="10" iniciales a colspan="20"**

En el HTML estático (~línea 1295):
```html
            <tr><td colspan="10" class="hist-empty">
```
Cambiar a:
```html
            <tr><td colspan="20" class="hist-empty">
```

En `cargarHistorico()` (~línea 3083) — hay 3 ocurrencias dentro de la función, cambiar todas de `colspan="10"` a `colspan="20"`:
- La del spinner de carga inicial (línea 3083)
- La del estado vacío dentro del `.then()` (línea 3114)
- La del fallback de error (línea 3137)

- [ ] **Step 4: Verificar visualmente**

Abrir el Histórico en el navegador. Debe aparecer el botón azul "⊞ Columnas ▾" a la derecha del selector de estados. Al hacer clic el dropdown aparece vacío (las funciones JS se agregan en Task 4).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: agregar botón Columnas al hist-search-bar y preparar thead dinámico"
```

---

## Task 4: Funciones JS del dropdown

**Files:**
- Modify: `public/index.html` — bloque `<script>`, justo antes del comentario `// HISTÓRICO — carga desde Firestore` (~línea 3078)

- [ ] **Step 1: Insertar las tres funciones antes del comentario de HISTÓRICO**

Encontrar esta línea (~línea 3078):
```javascript
// =====================================================================
//  HISTÓRICO — carga desde Firestore
// =====================================================================
```

Insertar inmediatamente antes:
```javascript
// =====================================================================
//  HISTÓRICO — selector de columnas
// =====================================================================
function renderColumnSelector() {
  var visible = getVisibleHistColumns();
  var groups = {};
  HIST_COL_DEFS.forEach(function(c) {
    if (!groups[c.grupo]) groups[c.grupo] = [];
    groups[c.grupo].push(c);
  });
  var fixed = ['ID Registro','Fecha','Centro','Estado','Certificado','Acciones'];
  var html = '<div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Siempre visibles</div>';
  html += '<div class="hist-col-fixed-chips">';
  fixed.forEach(function(f){ html += '<span class="hist-col-fixed-chip">'+f+'</span>'; });
  html += '</div>';
  html += '<div style="border-top:1px solid var(--border,#f1f5f9);margin-bottom:8px"></div>';
  Object.keys(groups).forEach(function(grp) {
    html += '<div class="hist-col-group-label">'+grp+'</div>';
    groups[grp].forEach(function(c) {
      var checked = visible.indexOf(c.key) !== -1 ? ' checked' : '';
      html += '<label class="hist-col-option"><input type="checkbox" onchange="toggleHistColumn(\''+c.key+'\')"'+checked+'> '+c.label+'</label>';
    });
  });
  document.getElementById('hist-col-dropdown').innerHTML = html;
}

function toggleHistColDropdown() {
  var btn = document.getElementById('hist-col-btn');
  var dd  = document.getElementById('hist-col-dropdown');
  var isOpen = !dd.classList.contains('hidden');
  if (isOpen) {
    dd.classList.add('hidden');
    btn.classList.remove('open');
    return;
  }
  renderColumnSelector();
  dd.classList.remove('hidden');
  btn.classList.add('open');
  setTimeout(function() {
    document.addEventListener('click', function closeOnOutside(e) {
      var btnEl = document.getElementById('hist-col-btn');
      var ddEl  = document.getElementById('hist-col-dropdown');
      if (btnEl && ddEl && !btnEl.contains(e.target) && !ddEl.contains(e.target)) {
        ddEl.classList.add('hidden');
        btnEl.classList.remove('open');
        document.removeEventListener('click', closeOnOutside);
      }
    });
  }, 0);
}

function toggleHistColumn(key) {
  var visible = getVisibleHistColumns();
  var idx = visible.indexOf(key);
  if (idx === -1) visible.push(key);
  else visible.splice(idx, 1);
  saveVisibleHistColumns(visible);
  renderColumnSelector();
  filtrarHistorico();
}

```

- [ ] **Step 2: Verificar el dropdown en el navegador**

1. Abrir el Histórico
2. Hacer clic en "⊞ Columnas ▾" → debe abrirse el dropdown con las 3 secciones (Siempre visibles, Identificación, Datos del centro, Visita)
3. Hacer clic fuera → debe cerrarse
4. Marcar/desmarcar un checkbox → la tabla aún no cambia (eso es Task 5), pero en DevTools → Application → localStorage debe aparecer la clave `certimar_hist_columns` con el array actualizado

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: agregar renderColumnSelector, toggleHistColDropdown y toggleHistColumn"
```

---

## Task 5: Refactorizar renderHistorico() para columnas dinámicas

**Files:**
- Modify: `public/index.html` — función `renderHistorico` (~líneas 3163-3211)

- [ ] **Step 1: Reemplazar toda la función `renderHistorico`**

Encontrar la función completa que empieza en:
```javascript
function renderHistorico(data) {
  var tbody  = document.getElementById('hist-tbody');
  var footer = document.getElementById('hist-footer');
```

Y termina en:
```javascript
  footer.textContent = 'Mostrando ' + data.length + ' registro' + (data.length!==1?'s':'') + ' · Firestore';
}
```

Reemplazar **toda** la función con:
```javascript
function renderHistorico(data) {
  var tbody  = document.getElementById('hist-tbody');
  var thead  = document.getElementById('hist-thead');
  var footer = document.getElementById('hist-footer');

  var visible = getVisibleHistColumns();

  var fixedHeaders  = ['ID Registro', 'Fecha', 'Centro'];
  var optHeaders    = HIST_COL_DEFS.filter(function(c){ return visible.indexOf(c.key) !== -1; }).map(function(c){ return c.label; });
  var trailHeaders  = ['Estado', 'Certificado', 'Acciones'];
  var allHeaders    = fixedHeaders.concat(optHeaders).concat(trailHeaders);
  var totalCols     = allHeaders.length;

  thead.innerHTML = '<tr>' + allHeaders.map(function(h){ return '<th>'+h+'</th>'; }).join('') + '</tr>';

  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="'+totalCols+'" class="hist-empty">No se encontraron registros</td></tr>';
    footer.textContent = '0 registros';
    return;
  }

  var extractors = {
    titular:           function(r){ return esc(r.titular || '—'); },
    nroCentro:         function(r){ return esc(r.nroCentro || '—'); },
    acs:               function(r){ return esc(r.acs || '—'); },
    area:              function(r){ return esc(r.area || '—'); },
    fechaSiembra:      function(r){ return esc(r.fechaUltimaSiembra || r.fechaSiembra || '—'); },
    tamanioPeces:      function(r){ return esc(r.tamanioPeces || '—'); },
    ubicacion:         function(r){ return esc(r.ubicacion || '—'); },
    latLong:           function(r){ return esc(r.latLong || '—'); },
    resExt:            function(r){ return '<span class="badge badge-blue" style="font-size:10px">'+esc(r.resoluciones || r.resExt || '—')+'</span>'; },
    tipoObs:           function(r){ return esc(r.tipoObservacion || r.tipoObs || '—'); },
    observaciones:     function(r){ return esc(r.observaciones || '—'); },
    responsable:       function(r){ return esc(r.nombreResponsable || r.responsable || '—'); },
    correoResponsable: function(r){ return esc(r.emailResponsable || '—'); },
    estadoFirma:       function(r){ return esc(r.estadoFirma || '—'); },
  };

  tbody.innerHTML = data.map(function(r) {
    var nro     = r.nroRegistro || r.nroReg || '—';
    var fecha   = r.fecha || '—';
    var centro  = r.centroCultivo || r.centro || '—';
    var urlCert = r.urlCertificado || r.urlCert || '';
    var estado  = r.estado || 'GUARDADO';
    var certLink = urlCert
      ? '<a href="'+esc(urlCert)+'" target="_blank" class="link-cert"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg> PDF</a>'
      : '<span style="color:var(--text-muted);font-size:11px">—</span>';
    var badgeCls = estado === 'ENVIADO' ? 'badge-ok' : estado === 'ARCHIVADO' ? 'badge-warn' : 'badge-blue';
    var canEdit  = estado === 'GUARDADO';
    var hasPdf   = !urlCert;

    var cells = '<td style="font-weight:600;color:var(--brand)">'+esc(nro)+'</td>'+
                '<td>'+esc(fecha)+'</td>'+
                '<td style="font-weight:600">'+esc(centro)+'</td>';
    visible.forEach(function(key) {
      if (extractors[key]) cells += '<td>' + extractors[key](r) + '</td>';
    });
    cells += '<td><span class="badge '+badgeCls+'">'+estado+'</span></td>'+
             '<td>'+certLink+'</td>'+
             '<td><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">'+
               '<button class="admin-action-btn ok" onclick="verRegistroHistorico(\''+esc(nro)+'\')">'+
                 '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Ver'+
               '</button> '+
               (canEdit ? '<button class="admin-action-btn" onclick="editarRegistroHistorico(\''+esc(nro)+'\')">'+
                 '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar'+
               '</button> ' : '')+
               (hasPdf ? '<button class="admin-action-btn warn" onclick="regenerarPDFHistorico(\''+esc(nro)+'\')">'+
                 '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> Regen. PDF'+
               '</button>' : '')+
             '</div></td>';
    return '<tr>'+cells+'</tr>';
  }).join('');

  footer.textContent = 'Mostrando ' + data.length + ' registro' + (data.length!==1?'s':'') + ' · Firestore';
}
```

- [ ] **Step 2: Verificar el comportamiento completo en el navegador**

1. Abrir el Histórico → la tabla debe mostrar las columnas por defecto (ID, Fecha, Centro, Titular, Res. Externa, Tipo Obs., Responsable, Estado, Certificado, Acciones)
2. Abrir "⊞ Columnas ▾" → desmarcar "Titular" → la columna Titular debe desaparecer inmediatamente de la tabla y del thead
3. Marcar "N° Centro" → debe aparecer como nueva columna
4. Recargar la página → las columnas seleccionadas deben persistir (leídas de localStorage)
5. Abrir DevTools → Application → Local Storage → verificar que `certimar_hist_columns` existe y tiene el array correcto
6. Verificar que los filtros (búsqueda, fechas, estados) siguen funcionando con las columnas visibles activas

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: selector de columnas dinámico en Histórico de Registros"
```

---

## Self-review del plan

### Cobertura del spec

| Requisito del spec | Task |
|---|---|
| Botón "Columnas ▾" en barra de filtros | Task 3 |
| Dropdown con checkboxes | Task 4 |
| Columnas fijas mostradas como chips | Task 4 |
| 3 grupos: Identificación / Datos del centro / Visita | Task 1 + 4 |
| Aplicación inmediata al marcar/desmarcar | Task 4 (`filtrarHistorico()`) |
| Persistencia en `certimar_hist_columns` | Task 1 |
| Estado por defecto (titular, resExt, tipoObs, responsable) | Task 1 |
| Thead dinámico | Task 5 |
| Tbody dinámico por columnas activas | Task 5 |
| Cerrar al clic fuera | Task 4 |
| Dark mode | Task 2 |
| CSV no afectado (exporta todo) | Sin cambios — cumplido |

### Consistencia de nombres

- `getVisibleHistColumns()` — definida en Task 1, usada en Task 4 y Task 5 ✓
- `saveVisibleHistColumns(keys)` — definida en Task 1, usada en Task 4 ✓
- `HIST_COL_DEFS` — definida en Task 1, usada en Task 4 y Task 5 ✓
- `renderColumnSelector()` — definida en Task 4, llamada desde `toggleHistColDropdown` y `toggleHistColumn` ✓
- `filtrarHistorico()` — ya existe en el código; llamada desde `toggleHistColumn` en Task 4 ✓
- `hist-col-btn`, `hist-col-dropdown` — IDs usados en Tasks 3, 4 ✓
- `hist-thead` — ID agregado en Task 3, usado en Task 5 ✓
