# PDF Regenerar + Acciones Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar regeneración de PDFs con subida a Storage, descarga desde Storage, y menú kebab (⋮) con 6 acciones por registro en el panel admin, más botones en la vista certificador.

**Architecture:** Todo en `public/index.html` (HTML + CSS + JS inline). Nuevas funciones JS: `subirPDFaStorage`, `poblarFormulario`, `handleRegenPDF` (certificador), `admRegenPDF` (admin), `admEditarRegistro`, `admArchivar`, `admEliminar`, motor de kebab menu. Modal de edición nuevo siguiendo el patrón de `modal-archive`.

**Tech Stack:** Firebase Storage (compat SDK), Firestore (compat SDK), html2canvas, jsPDF — todos ya cargados.

---

## Archivos a modificar

- **Modify:** `public/index.html` — CSS (~40 líneas), HTML modal editar (~40 líneas), HTML botones certificador (2 botones), JS nuevas funciones (~200 líneas), actualizaciones a `resetFormulario`, `renderAdminTabla`, `handleSyncGoogle`
- **Already done:** `public/favicon.svg` ✅, `public/sw.js` (cache v2) ✅

---

## Task 1: Deploy favicon

**Files:**
- Deploy: `public/favicon.svg`, `public/sw.js`, `public/index.html`

- [ ] **Step 1: Deploy hosting**

```powershell
cd C:\Users\aldon\Documents\Proyectos\Certimar-1511-RV
firebase deploy --only hosting 2>&1
```

Expected output: `+  Deploy complete!`

- [ ] **Step 2: Verificar en browser**

Abrir https://certimar-rv.web.app — el favicon (documento azul con badge verde) debe aparecer en la pestaña del navegador.

---

## Task 2: Agregar CSS — kebab menu y botones certificador

**Files:**
- Modify: `public/index.html` — sección `<style>`, antes del cierre `</style>`

- [ ] **Step 1: Agregar estilos**

Buscar en `public/index.html` el cierre de la sección style. Está alrededor de la línea donde termina el bloque `<style>` (buscar `</style>` antes de los `<script>`). Agregar antes de ese cierre:

```css
/* ===== KEBAB MENU ADMIN ===== */
.kebab-wrapper{position:relative;display:inline-block}
.kebab-btn{background:none;border:1px solid #e2e8f0;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:18px;color:#64748b;line-height:1}
.kebab-btn:hover{background:#f1f5f9;border-color:#cbd5e1}
.kebab-menu{display:none;position:fixed;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.14);z-index:9999;min-width:195px;overflow:hidden}
.kebab-menu.open{display:block}
.kebab-item{display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;font-size:13px;color:#374151;white-space:nowrap;border:none;background:none;width:100%;text-align:left}
.kebab-item:hover{background:#f8fafc}
.kebab-item.kb-danger{color:#dc2626}
.kebab-item.kb-danger:hover{background:#fef2f2}
.kebab-item.kb-disabled{color:#94a3b8;cursor:not-allowed}
.kebab-item.kb-disabled:hover{background:none}
.kebab-sep{height:1px;background:#f1f5f9;margin:4px 0}
/* ===== BOTONES CERTIFICADOR — REGEN / DL STORAGE ===== */
.btn-regen{border-color:#7c3aed;color:#7c3aed;background:white}
.btn-regen:hover:not(:disabled){background:#7c3aed;color:white}
.btn-dl-storage{border-color:#0891b2;color:#0891b2;background:white;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.btn-dl-storage:hover{background:#0891b2;color:white}
```

- [ ] **Step 2: Verificar sin errores**

Abrir la app en el browser — no debe haber errores de CSS en consola.

---

## Task 3: Agregar botones en la vista certificador

**Files:**
- Modify: `public/index.html` — bloque `<div class="actions-bar">` (alrededor de línea 1143)

- [ ] **Step 1: Agregar dos botones después del btn-mail**

Localizar en `public/index.html`:
```html
      <button class="btn-action btn-mail" id="btn-mail" onclick="openModalMail()" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Notificar Cliente
      </button>
    </div>
```

Reemplazar por:
```html
      <button class="btn-action btn-mail" id="btn-mail" onclick="openModalMail()" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Notificar Cliente
      </button>
      <button class="btn-action btn-regen hidden" id="btn-regen-pdf" onclick="handleRegenPDF()">
        🔄 Regenerar PDF
      </button>
      <a class="btn-action btn-dl-storage hidden" id="btn-dl-storage" target="_blank" href="#">
        📄 Descargar PDF
      </a>
    </div>
```

- [ ] **Step 2: Verificar HTML**

Abrir la app — la barra de acciones debe verse igual (los nuevos botones están `hidden`). Sin errores en consola.

---

## Task 4: Agregar modal de edición admin

**Files:**
- Modify: `public/index.html` — después del cierre del modal-mail (buscar `</div>` que cierra `id="modal-mail"`, alrededor de línea 1380)

- [ ] **Step 1: Insertar modal después del modal-mail**

Localizar el bloque que termina con `</div>` del modal-mail. El patrón a buscar es el final de ese modal. Insertar el siguiente HTML inmediatamente después:

```html
<!-- ===================== MODAL EDITAR REGISTRO ===================== -->
<div class="modal-overlay hidden" id="modal-editar">
  <div class="modal-box" style="max-width:500px">
    <div class="modal-header">
      <h2>✏️ Editar <span id="editar-nro-label"></span></h2>
      <button class="modal-close" onclick="closeModalEditar()">×</button>
    </div>
    <div class="modal-body" style="padding:20px 24px">
      <input type="hidden" id="editar-nro">
      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Responsable del Centro</label>
        <input type="text" id="editar-nombreResponsable" class="email-to-input" style="width:100%" placeholder="Nombre Responsable">
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Email Responsable</label>
        <input type="email" id="editar-emailResponsable" class="email-to-input" style="width:100%" placeholder="correo@empresa.cl">
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Observaciones</label>
        <textarea id="editar-observaciones" class="archive-reason-input" rows="3" placeholder="Observaciones técnicas..."></textarea>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">Tipo Observación</label>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label style="font-size:12px"><input type="radio" name="editar-tipoObs" value="EXTRACCION"> EXTRACCION</label>
          <label style="font-size:12px"><input type="radio" name="editar-tipoObs" value="DESNATURALIZACION"> DESNATURALIZACION</label>
          <label style="font-size:12px"><input type="radio" name="editar-tipoObs" value="ALMACENAMIENTO"> ALMACENAMIENTO</label>
          <label style="font-size:12px"><input type="radio" name="editar-tipoObs" value="OTRO"> OTRO</label>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-action btn-save" onclick="closeModalEditar()" style="border-color:#d1d5db;color:#374151">Cancelar</button>
      <button class="btn-action btn-sync" id="btn-confirmar-editar" onclick="handleConfirmarEditar()">
        💾 Guardar Cambios
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Verificar**

Abrir la app — sin errores nuevos en consola. El modal no debe verse (está hidden).

---

## Task 5: Agregar funciones utilitarias JS — subirPDFaStorage y poblarFormulario

**Files:**
- Modify: `public/index.html` — sección JS, antes del cierre `</script>` (línea ~3444)

- [ ] **Step 1: Agregar funciones antes del cierre `</script>`**

Localizar la línea `</script>` que cierra el bloque principal (alrededor de línea 3444, justo después de la función `toast`). Insertar antes de ese cierre:

```javascript
// =====================================================================
//  STORAGE — SUBIR PDF
// =====================================================================
async function subirPDFaStorage(pdfBlob, nroRegistro) {
  var storage = firebase.storage();
  var ref = storage.ref('certificados/' + nroRegistro + '.pdf');
  await ref.put(pdfBlob, { contentType: 'application/pdf' });
  return await ref.getDownloadURL();
}

// =====================================================================
//  FORMULARIO — POBLAR DESDE REGISTRO (para regeneración admin)
// =====================================================================
function poblarFormulario(r) {
  set('r-fecha',               r.fecha               || '');
  set('r-nroRegistro',        r.nroRegistro         || '');
  set('r-centroCultivo',      r.centroCultivo       || '');
  set('r-nroCentro',          r.nroCentro           || '');
  set('r-acs',                r.acs                 || '');
  set('r-titular',            r.titular             || '');
  set('r-ubicacion',          r.ubicacion           || '');
  set('r-fechaSiembra',       r.fechaSiembra        || '');
  set('r-tamanoPeces',        r.tamanoPeces         || '');
  set('r-latitud',            r.latitud             || '');
  set('r-longitud',           r.longitud            || '');
  set('r-norte',              r.norte               || '');
  set('r-este',               r.este                || '');
  set('r-observaciones',      r.observaciones       || '');
  set('r-nombreResponsable',  r.nombreResponsable   || '');
  set('r-emailResponsable',   r.emailResponsable    || '');
  set('r-nombreCertificador', r.nombreCertificador  || '');
  set('r-rutCertificador',    r.rutCertificador     || '');
  // Resoluciones (checkboxes)
  var res = r.resoluciones || '';
  document.getElementById('r-cicE2').checked        = res.includes('CIC E2');
  document.getElementById('r-ca').checked           = res.includes('1821-CA');
  document.getElementById('r-vs').checked           = res.includes('1821-VS');
  document.getElementById('r-res1511').checked      = res.includes('1511');
  document.getElementById('r-desinfeccion').checked = res.includes('DESINFEC');
  // Observaciones radio
  var hasObs = !!(r.observaciones || '').trim();
  document.getElementById('r-obs-si').checked = hasObs;
  document.getElementById('r-obs-no').checked = !hasObs;
  // Tipo observación
  document.querySelectorAll('input[name="tipoObs"]').forEach(function(radio) {
    radio.checked = radio.value === (r.tipoObservacion || '');
  });
  toggleTipoObs();
}
```

- [ ] **Step 2: Verificar en consola del browser**

Abrir la consola del browser y ejecutar:
```javascript
typeof subirPDFaStorage // debe retornar "function"
typeof poblarFormulario // debe retornar "function"
```

---

## Task 6: Agregar handleRegenPDF (certificador) y actualizarBotonesGuardado

**Files:**
- Modify: `public/index.html` — sección JS, antes del cierre `</script>`

- [ ] **Step 1: Agregar funciones**

En el mismo bloque JS, agregar después de las funciones del Task 5:

```javascript
// =====================================================================
//  CERTIFICADOR — REGENERAR PDF (desde formulario activo)
// =====================================================================
async function handleRegenPDF() {
  var nro = appState.savedData && appState.savedData.nroRegistro;
  if (!nro) { toast('Guarde el registro primero', 'error'); return; }
  var btn = document.getElementById('btn-regen-pdf');
  btn.disabled = true;
  pushNotif('regen-cert','info','🔄 Regenerando PDF…',[
    {id:'rc1', label:'Generando PDF',              state:'active'},
    {id:'rc2', label:'Subiendo a Storage',         state:'pending'},
    {id:'rc3', label:'Actualizando base de datos', state:'pending'}
  ]);
  try {
    await cargarLibsPDF();
    var pdf  = await generarPDF();
    var blob = pdf.output('blob');
    updateNotifStep('regen-cert','rc1','done');
    updateNotifStep('regen-cert','rc2','active');
    var url = await subirPDFaStorage(blob, nro);
    updateNotifStep('regen-cert','rc2','done');
    updateNotifStep('regen-cert','rc3','active');
    var estado = (appState.savedData && appState.savedData.estado) || 'GUARDADO';
    await fbActualizarEstado(nro, estado, { urlCertificado: url });
    updateNotifStep('regen-cert','rc3','done');
    appState.savedData.urlCert = url;
    var dlBtn = document.getElementById('btn-dl-storage');
    dlBtn.href = url;
    dlBtn.classList.remove('hidden');
    updateNotifCard('regen-cert','success','✅ PDF guardado en Storage', nro);
  } catch(e) {
    updateNotifCard('regen-cert','error','❌ Error al regenerar PDF', String(e));
  } finally {
    btn.disabled = false;
  }
}

function actualizarBotonesGuardado() {
  var nro = appState.savedData && appState.savedData.nroRegistro;
  if (!nro) return;
  document.getElementById('btn-regen-pdf').classList.remove('hidden');
  var url = appState.savedData && appState.savedData.urlCert;
  if (url) {
    var dlBtn = document.getElementById('btn-dl-storage');
    dlBtn.href = url;
    dlBtn.classList.remove('hidden');
  }
}
```

- [ ] **Step 2: Llamar actualizarBotonesGuardado después del guardado**

Localizar en `public/index.html` (alrededor de línea 2269):
```javascript
    appState.saved = true;
    appState.savedData = Object.assign({}, datos, { urlCert: urlCertificado });
    setBtnGuardar(true);
```

Agregar `actualizarBotonesGuardado();` en la siguiente línea:
```javascript
    appState.saved = true;
    appState.savedData = Object.assign({}, datos, { urlCert: urlCertificado });
    setBtnGuardar(true);
    actualizarBotonesGuardado();
```

- [ ] **Step 3: Ocultar botones en resetFormulario**

Localizar en `public/index.html` la función `resetFormulario` (alrededor de línea 1675). Al final de esa función, antes de su cierre `}`, agregar:

```javascript
  var regenBtn = document.getElementById('btn-regen-pdf');
  var dlBtn    = document.getElementById('btn-dl-storage');
  if (regenBtn) regenBtn.classList.add('hidden');
  if (dlBtn)    dlBtn.classList.add('hidden');
```

- [ ] **Step 4: Verificar en browser**

1. Iniciar sesión y crear un nuevo registro
2. Completar el checklist y guardar (Sync)
3. Verificar que aparece el botón "🔄 Regenerar PDF"
4. Hacer click — debe generar el PDF, subir a Storage y mostrar "📄 Descargar PDF"
5. Click en "📄 Descargar PDF" — debe abrir el PDF desde la URL de Storage

---

## Task 7: Agregar admRegenPDF (admin) y admActualizarUrlEnTabla

**Files:**
- Modify: `public/index.html` — sección JS, antes del cierre `</script>`

- [ ] **Step 1: Agregar funciones**

```javascript
// =====================================================================
//  ADMIN — REGENERAR PDF (carga datos, cambia vista, genera, vuelve)
// =====================================================================
async function admRegenPDF(nro) {
  var r = _adminAll.find(function(x){ return x.nroRegistro === nro; });
  if (!r) { toast('Registro no encontrado', 'error'); return; }
  pushNotif('regen-adm','info','🔄 Regenerando PDF…',[
    {id:'ra1', label:'Cargando datos en formulario', state:'active'},
    {id:'ra2', label:'Generando PDF',                state:'pending'},
    {id:'ra3', label:'Subiendo a Storage',           state:'pending'},
    {id:'ra4', label:'Actualizando base de datos',   state:'pending'}
  ]);
  try {
    // Poblar formulario con datos del registro
    poblarFormulario(r);
    updateNotifStep('regen-adm','ra1','done');
    // Mostrar vista registro sin resetear (bypass showView)
    ['dashboard','registro','historico','admin'].forEach(function(v) {
      var el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== 'registro');
    });
    // Generar PDF
    updateNotifStep('regen-adm','ra2','active');
    await cargarLibsPDF();
    var pdf  = await generarPDF();
    var blob = pdf.output('blob');
    updateNotifStep('regen-adm','ra2','done');
    // Subir a Storage
    updateNotifStep('regen-adm','ra3','active');
    var url = await subirPDFaStorage(blob, nro);
    updateNotifStep('regen-adm','ra3','done');
    // Actualizar Firestore
    updateNotifStep('regen-adm','ra4','active');
    await fbActualizarEstado(nro, r.estado || 'GUARDADO', { urlCertificado: url });
    updateNotifStep('regen-adm','ra4','done');
    r.urlCertificado = url;
    updateNotifCard('regen-adm','success','✅ PDF guardado en Storage', nro);
    showView('admin');
  } catch(e) {
    updateNotifCard('regen-adm','error','❌ Error al regenerar PDF', String(e));
    showView('admin');
  }
}

function admActualizarUrlEnTabla(nro, url) {
  var idx = _adminAll.findIndex(function(x){ return x.nroRegistro === nro; });
  if (idx >= 0) _adminAll[idx].urlCertificado = url;
  renderAdminTabla();
}
```

---

## Task 8: Motor del kebab menu

**Files:**
- Modify: `public/index.html` — sección JS, antes del cierre `</script>`

- [ ] **Step 1: Agregar motor kebab**

```javascript
// =====================================================================
//  KEBAB MENU — ADMIN
// =====================================================================
var _kebabOpen = null;

function toggleKebab(event, nro) {
  event.stopPropagation();
  var menu = document.getElementById('kebab-' + nro);
  if (!menu) return;
  var isOpen = menu.classList.contains('open');
  closeKebab();
  if (!isOpen) {
    var rect = event.currentTarget.getBoundingClientRect();
    menu.style.top   = (rect.bottom + 4) + 'px';
    menu.style.right  = (window.innerWidth - rect.right) + 'px';
    menu.style.left   = 'auto';
    menu.classList.add('open');
    _kebabOpen = nro;
  }
}

function closeKebab() {
  if (_kebabOpen) {
    var menu = document.getElementById('kebab-' + _kebabOpen);
    if (menu) menu.classList.remove('open');
    _kebabOpen = null;
  }
}

document.addEventListener('click', closeKebab);
```

---

## Task 9: Actualizar renderAdminTabla — columna de acciones

**Files:**
- Modify: `public/index.html` — función `renderAdminTabla`, columna de acciones (alrededor de línea 3328)

- [ ] **Step 1: Reemplazar columna de acciones**

Localizar en `renderAdminTabla`:
```javascript
      '<td style="white-space:nowrap">'+
        (urlCert ? '<a href="'+esc(urlCert)+'" target="_blank" class="admin-action-btn">📄</a> ' : '')+
        '<button class="admin-action-btn" onclick="admReenviarMail(\''+esc(r.nroRegistro||'')+'\',\''+esc(r.emailResponsable||'')+'\')">✉️</button>'+
      '</td>'+
```

Reemplazar por:

```javascript
      '<td style="white-space:nowrap">'+
        '<div class="kebab-wrapper">'+
          '<button class="kebab-btn" onclick="toggleKebab(event,\''+esc(r.nroRegistro||'')+'\')">⋮</button>'+
          '<div class="kebab-menu" id="kebab-'+esc(r.nroRegistro||'')+'">'+
            '<button class="kebab-item" onclick="closeKebab();admRegenPDF(\''+esc(r.nroRegistro||'')+'\')">🔄 Regenerar PDF</button>'+
            (urlCert
              ? '<button class="kebab-item" onclick="closeKebab();window.open(\''+esc(urlCert)+'\',\'_blank\')">📄 Descargar PDF</button>'
              : '<button class="kebab-item kb-disabled" disabled>📄 Sin PDF guardado</button>'
            )+
            '<button class="kebab-item" onclick="closeKebab();admReenviarMail(\''+esc(r.nroRegistro||'')+'\',\''+esc(r.emailResponsable||'')+'\')">✉️ Reenviar correo</button>'+
            '<div class="kebab-sep"></div>'+
            '<button class="kebab-item" onclick="closeKebab();admEditarRegistro(\''+esc(r.nroRegistro||'')+'\')">✏️ Editar registro</button>'+
            '<button class="kebab-item" onclick="closeKebab();admArchivar(\''+esc(r.nroRegistro||'')+'\',\''+esc(estado)+'\')">'+
              (estado==='ARCHIVADO' ? '📂 Desarchivar' : '🗂️ Archivar')+
            '</button>'+
            '<div class="kebab-sep"></div>'+
            '<button class="kebab-item kb-danger" onclick="closeKebab();admEliminar(\''+esc(r.nroRegistro||'')+'\',\''+esc(urlCert)+'\')">🗑️ Eliminar</button>'+
          '</div>'+
        '</div>'+
      '</td>'+
```

- [ ] **Step 2: Verificar en browser**

Ir al panel admin. Cada fila debe mostrar un botón `⋮`. Al hacer click debe abrirse el menú con las 6 opciones. Click fuera debe cerrarlo.

---

## Task 10: Agregar admArchivar y admEliminar

**Files:**
- Modify: `public/index.html` — sección JS, antes del cierre `</script>`

- [ ] **Step 1: Agregar funciones**

```javascript
// =====================================================================
//  ADMIN — ARCHIVAR / DESARCHIVAR
// =====================================================================
function admArchivar(nro, estadoActual) {
  var nuevoEstado = estadoActual === 'ARCHIVADO' ? 'GUARDADO' : 'ARCHIVADO';
  var accion = nuevoEstado === 'ARCHIVADO' ? 'Archivar' : 'Desarchivar';
  if (!confirm(accion + ' el registro ' + nro + '?')) return;
  fbActualizarEstado(nro, nuevoEstado, {}).then(function() {
    var idx = _adminAll.findIndex(function(x){ return x.nroRegistro === nro; });
    if (idx >= 0) _adminAll[idx].estado = nuevoEstado;
    filtrarAdmin();
    toast(nro + ' ' + (nuevoEstado === 'ARCHIVADO' ? 'archivado' : 'desarchivado') + ' ✓', 'success');
  }).catch(function(e) {
    toast('Error: ' + String(e), 'error');
  });
}

// =====================================================================
//  ADMIN — ELIMINAR REGISTRO
// =====================================================================
function admEliminar(nro, urlCert) {
  if (!confirm('⚠️ Eliminar definitivamente el registro ' + nro + '?\n\nEsta acción no se puede deshacer.')) return;
  var db = initFirebase();
  if (!db) { toast('Firebase no disponible', 'error'); return; }
  db.collection('registros_visita').doc(nro).delete().then(function() {
    if (urlCert) {
      try { firebase.storage().refFromURL(urlCert).delete().catch(function(){}); } catch(e) {}
    }
    _adminAll = _adminAll.filter(function(x){ return x.nroRegistro !== nro; });
    filtrarAdmin();
    toast(nro + ' eliminado ✓', 'success');
  }).catch(function(e) {
    toast('Error al eliminar: ' + String(e), 'error');
  });
}
```

- [ ] **Step 2: Verificar admArchivar en browser**

En el panel admin, abrir el kebab de un registro y hacer click en "🗂️ Archivar". Confirmar. El badge de estado de esa fila debe cambiar a `📁 ARCHIVADO`.

- [ ] **Step 3: Verificar admEliminar en browser**

Abrir el kebab de un registro de prueba. Click en "🗑️ Eliminar". Cancelar en el confirm → nada cambia. Aceptar → la fila desaparece.

---

## Task 11: Agregar admEditarRegistro + handleConfirmarEditar

**Files:**
- Modify: `public/index.html` — sección JS, antes del cierre `</script>`

- [ ] **Step 1: Agregar funciones**

```javascript
// =====================================================================
//  ADMIN — EDITAR REGISTRO
// =====================================================================
function admEditarRegistro(nro) {
  var r = _adminAll.find(function(x){ return x.nroRegistro === nro; });
  if (!r) { toast('Registro no encontrado', 'error'); return; }
  document.getElementById('editar-nro').value                = nro;
  document.getElementById('editar-nro-label').textContent    = nro;
  document.getElementById('editar-nombreResponsable').value  = r.nombreResponsable || '';
  document.getElementById('editar-emailResponsable').value   = r.emailResponsable  || '';
  document.getElementById('editar-observaciones').value      = r.observaciones     || '';
  document.querySelectorAll('input[name="editar-tipoObs"]').forEach(function(radio) {
    radio.checked = radio.value === (r.tipoObservacion || '');
  });
  document.getElementById('modal-editar').classList.remove('hidden');
}

function closeModalEditar() {
  document.getElementById('modal-editar').classList.add('hidden');
}

async function handleConfirmarEditar() {
  var nro    = document.getElementById('editar-nro').value;
  var nombre = document.getElementById('editar-nombreResponsable').value.trim();
  var email  = document.getElementById('editar-emailResponsable').value.trim();
  var obs    = document.getElementById('editar-observaciones').value.trim();
  var tipoEl = document.querySelector('input[name="editar-tipoObs"]:checked');
  var tipo   = tipoEl ? tipoEl.value : '';
  var r      = _adminAll.find(function(x){ return x.nroRegistro === nro; });
  var estado = r ? r.estado || 'GUARDADO' : 'GUARDADO';
  var btn    = document.getElementById('btn-confirmar-editar');
  btn.disabled    = true;
  btn.textContent = '⏳ Guardando…';
  try {
    await fbActualizarEstado(nro, estado, {
      nombreResponsable: nombre,
      emailResponsable:  email,
      observaciones:     obs,
      tipoObservacion:   tipo
    });
    if (r) Object.assign(r, { nombreResponsable: nombre, emailResponsable: email, observaciones: obs, tipoObservacion: tipo });
    filtrarAdmin();
    closeModalEditar();
    toast(nro + ' actualizado ✓', 'success');
  } catch(e) {
    toast('Error al guardar: ' + String(e), 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '💾 Guardar Cambios';
  }
}
```

- [ ] **Step 2: Verificar en browser**

En el panel admin, abrir el kebab de un registro. Click en "✏️ Editar registro". El modal debe abrirse con los datos actuales. Modificar el nombre del responsable. Click "💾 Guardar Cambios". El modal cierra y la fila muestra el nombre actualizado.

---

## Task 12: Deploy final y verificación completa

**Files:**
- Deploy: `public/` (hosting completo)

- [ ] **Step 1: Deploy hosting**

```powershell
cd C:\Users\aldon\Documents\Proyectos\Certimar-1511-RV
firebase deploy --only hosting 2>&1
```

Expected: `+  Deploy complete!`

- [ ] **Step 2: Verificación completa en certimar-rv.web.app**

1. ✅ Favicon visible en pestaña del navegador
2. ✅ Vista certificador: tras guardar/sync, aparecen botones "🔄 Regenerar PDF" y (si hay URL) "📄 Descargar PDF"
3. ✅ "🔄 Regenerar PDF" en certificador: genera, sube a Storage, activa botón de descarga
4. ✅ "📄 Descargar PDF" en certificador: abre el PDF desde Storage en nueva pestaña
5. ✅ Panel admin: cada fila muestra botón `⋮`
6. ✅ Menú kebab se abre/cierra correctamente, se cierra al hacer click fuera
7. ✅ "🔄 Regenerar PDF" en admin: cambia a vista formulario, genera, vuelve al admin
8. ✅ "📄 Descargar PDF" en admin: abre desde Storage (o aparece deshabilitado si no hay URL)
9. ✅ "✉️ Reenviar correo": comportamiento igual al anterior
10. ✅ "✏️ Editar registro": modal abre con datos, guarda cambios en Firestore
11. ✅ "🗂️ Archivar": toggle de estado en la fila
12. ✅ "🗑️ Eliminar": elimina de Firestore y Storage, desaparece de la tabla
