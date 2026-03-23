// ============================================================
//  CERTIMAR — Sistema de Registro de Visitas
//  Google Apps Script Backend
//  Última edición : 2026-03-14 - 17:25- Aldo Mellado
//  Último push    : 2026-03-14 - 17:25 - Aldo Mellado
// ===========================================================

const SPREADSHEET_ID     = '1Gq_8OBd75OnSzk9e6GXtOjhs8nhL9fKrlFzs_w4MezM';
const SHEET_NAME         = 'RV';
const DRIVE_FOLDER_ID    = '1RmNcnVq0bBumlwA0KlgL9PIrIB8mQrFk';
const EMAIL_REMITENTE    = 'operaciones@certimar.cl';
const EMAIL_COPIA_FIRMA  = 'eflores@certimar.cl';   // copia en notificaciones de firma
const TIMEZONE           = 'America/Santiago';
const FIREBASE_PROJECT_ID = 'certimar-rv';

// ============================================================
//  ROUTER — GET (Apps Script web app)
// ============================================================
function doGet(e) {
  // Página de firma temporal (link generado desde admin)
  if (e && e.parameter && e.parameter.view === 'firma') {
    return _servirPaginaFirma(e.parameter.nro || '', e.parameter.token || '');
  }
  const tpl = HtmlService.createTemplateFromFile('Index');
  return tpl.evaluate()
    .setTitle('Registro de Visita – Certimar')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
//  ROUTER — POST (webhook para Firebase Functions)
//  Permite que Firebase escriba en Sheets sin service account.
//
//  Deployment requerido:
//    Apps Script → Deploy → New deployment
//    Tipo: Web app | Execute as: Me | Access: Anyone
// ============================================================
const WEBHOOK_SECRET = 'CERTIMAR_FB_2026';   // debe coincidir con functions:config

function doPost(e) {
  const resp = (data) =>
    ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);

  try {
    const payload = JSON.parse(e.postData.contents);

    // Verificar secret compartido
    if (payload.secret !== WEBHOOK_SECRET) {
      return resp({ ok: false, error: 'No autorizado' });
    }

    const accion = payload.accion || 'registrar';

    if (accion === 'registrar') {
      const result = registrarEnSheets(payload.datos, payload.urlCertificado || '');
      return resp({ ok: true, accion: result.accion });
    }

    if (accion === 'actualizarEnviado') {
      const { nroRegistro, emailDestinatario, urlCertificado } = payload;
      _actualizarFilaEnviado(nroRegistro, emailDestinatario, urlCertificado);
      return resp({ ok: true, accion: 'actualizado' });
    }

    return resp({ ok: false, error: 'Acción desconocida: ' + accion });

  } catch(err) {
    Logger.log('doPost error: ' + err);
    return resp({ ok: false, error: err.toString() });
  }
}

// Actualiza columnas P-Q-R (email, URL cert, estado) en una sola operación batch
function _actualizarFilaEnviado(nroRegistro, emailDestinatario, urlCertificado) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return;

  const nros = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < nros.length; i++) {
    if (String(nros[i][0]).trim() === String(nroRegistro).trim()) {
      const fila    = i + 2;
      const urlVal  = urlCertificado
        ? '=HYPERLINK("' + urlCertificado + '","Ver PDF")'
        : sheet.getRange(fila, 17).getValue();  // preservar URL existente si no viene una nueva
      sheet.getRange(fila, 16, 1, 3).setValues([[emailDestinatario || '', urlVal, 'ENVIADO']]);
      SpreadsheetApp.flush();
      return;
    }
  }
}

// ============================================================
//  USUARIO ACTIVO
// ============================================================
function getUserInfo() {
  try {
    const email = Session.getActiveUser().getEmail();
    const name  = email.split('@')[0].replace(/\./g, ' ')
                       .replace(/\b\w/g, c => c.toUpperCase());
    return { ok: true, email, name };
  } catch(e) {
    return { ok: false, email: '', name: 'Usuario' };
  }
}

// ============================================================
//  NÚMERO CORRELATIVO DE REGISTRO
// ============================================================
function _generarNroRegistro() {
  const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet  = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  const year   = new Date().getFullYear();
  const prefix = 'RV-' + year + '-';

  // Buscar el máximo secuencial existente en la columna B (N° Registro).
  // Usar lastRow puro es frágil: filas vacías/limpiadas sin eliminar inflan el conteo.
  let maxSeq = 0;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().forEach(function([val]) {
      const s = String(val || '');
      if (s.startsWith(prefix)) {
        const n = parseInt(s.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
  }

  return prefix + String(maxSeq + 1).padStart(4, '0');
}

// ============================================================
//  GUARDAR + ENVIAR EN UNA SOLA LLAMADA  ← nueva función optimizada
//  Combina Drive upload, Sheets write y envío de correo en un viaje.
//  @param {Object} datos
//  @param {string|null} pdfB64
//  @param {string|null} fotoB64
//  @param {string|null} emailDestinatario  – si null, no envía correo
// ============================================================
function guardarYEnviar(datos, pdfB64, fotoB64, emailDestinatario, firmaB64) {
  const resultado = { ok: false, steps: {} };
  try {
    // — Obtener sheet una sola vez —
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet   = ss.getSheetByName(SHEET_NAME);
    if (!sheet) { sheet = ss.insertSheet(SHEET_NAME); _crearEncabezados(sheet); }
    if (sheet.getLastRow() === 0) _crearEncabezados(sheet);

    // — Carpeta del centro (se crea una sola vez y se reutiliza) —
    let carpetaCentro = null;
    try {
      carpetaCentro = _obtenerCarpetaCentro(datos.centroCultivo, datos.nroCentro);
    } catch(e) {
      Logger.log('guardarYEnviar: no se pudo obtener carpeta centro (no-fatal): ' + e);
    }

    // — 1. PDF a Drive (operación más lenta, hacemos primero) —
    let urlCertificado = '';
    let pdfBlob = null;           // reutilizado como adjunto de correo (sin re-decodificar)
    if (pdfB64) {
      try {
        const driveResult  = _subirPDFDrive(pdfB64, datos.nroRegistro, datos.centroCultivo, carpetaCentro);
        urlCertificado     = driveResult.url;
        pdfBlob            = driveResult.blob;
        resultado.steps.pdf = 'ok';
      } catch(e) {
        resultado.steps.pdf = 'error: ' + e.message;
        // No es fatal — continuamos sin URL
      }
    }

    // — 2. Foto a Drive —
    let urlFoto = '';
    if (fotoB64 && !fotoB64.startsWith('data:application/pdf')) {
      try {
        urlFoto = _subirFotoDrive(fotoB64, datos.nroRegistro, carpetaCentro);
        resultado.steps.foto = 'ok';
      } catch(e) {
        resultado.steps.foto = 'error: ' + e.message;
      }
    }

    // — 2b. Firma cliente a Drive —
    let urlFirmaCliente = '';
    if (firmaB64 && firmaB64.startsWith('data:image/')) {
      try {
        urlFirmaCliente = _subirFirmaClienteDrive(firmaB64, datos.nroRegistro, carpetaCentro);
        resultado.steps.firma = 'ok';
      } catch(e) {
        resultado.steps.firma = 'error: ' + e.message;
      }
    }

    // — 3. Sheets (batch: una sola operación appendRow) —
    const resArray = [];
    if (datos.resoluciones) {
      if (datos.resoluciones.cicE2)        resArray.push('1821-CIC E2');
      if (datos.resoluciones.ca)           resArray.push('1821-CA');
      if (datos.resoluciones.vs)           resArray.push('1821-VS');
      if (datos.resoluciones.res1511)      resArray.push('1511');
      if (datos.resoluciones.desinfeccion) resArray.push('DESINFECCIÓN');
    }
    const resExt = resArray.join(', ');
    const ahora  = new Date();

    sheet.appendRow([
      Utilities.formatDate(ahora, TIMEZONE, 'dd/MM/yyyy HH:mm'),
      datos.nroRegistro,
      datos.centroCultivo,
      datos.nroCentro,
      datos.acs,
      datos.titular,
      datos.area || '',
      datos.fechaSiembra,
      datos.tamanoPeces,
      datos.ubicacion,
      (datos.latitud || '') + (datos.longitud ? ', ' + datos.longitud : ''),
      resExt,
      datos.observaciones,
      datos.tipoObservacion || '',
      datos.nombreResponsable,
      emailDestinatario || datos.emailDestinatario || '',
      urlCertificado ? '=HYPERLINK("' + urlCertificado + '","Ver PDF")' : '',
      'GUARDADO',  // R – Estado
      urlFirmaCliente, // S – URL Firma Cliente
      '',              // T – Token Firma (se llena con generarLinkFirma)
      ''               // U – Estado Firma
    ]);
    SpreadsheetApp.flush();  // Asegurar escritura inmediata
    resultado.steps.sheets = 'ok';

    // — 4. Correo (si se solicitó) — reutiliza pdfBlob ya construido en paso 1 —
    let emailEnviado = false;
    const destEmail = emailDestinatario || datos.emailDestinatario;
    if (destEmail) {
      datos.emailDestinatario = destEmail;   // normalizar para _enviarCorreoRV
      try {
        _enviarCorreoRV(datos, urlCertificado, pdfBlob);
        emailEnviado = true;
        resultado.steps.email = 'ok';
      } catch(e) {
        resultado.steps.email = 'error: ' + e.message;
      }
    }

    // — 5. Actualizar estado en Sheets si el correo salió —
    // Se hace aquí directamente para evitar depender de un segundo viaje desde el cliente.
    if (emailEnviado) {
      try {
        _actualizarFilaEnviado(datos.nroRegistro, destEmail, urlCertificado);
        resultado.steps.estadoEnviado = 'ok';
      } catch(e) {
        resultado.steps.estadoEnviado = 'error: ' + e.message;
      }
    }

    resultado.ok              = true;
    resultado.nroRegistro     = datos.nroRegistro;
    resultado.urlCertificado  = urlCertificado;
    resultado.urlFoto         = urlFoto;
    resultado.emailEnviado    = emailEnviado;
    return resultado;

  } catch(err) {
    Logger.log('guardarYEnviar error: ' + err);
    resultado.error = err.toString();
    return resultado;
  }
}

// ============================================================
//  GUARDAR REGISTRO (mantener por compatibilidad)
// ============================================================
function guardarRegistro(datos, pdfB64, fotoB64, firmaB64) {
  return guardarYEnviar(datos, pdfB64, fotoB64, null, firmaB64);
}

// ============================================================
//  ENVIAR CORREO (compatible + actualiza estado en Sheets)
// ============================================================
function enviarNotificacion(datos, urlCertificado, pdfB64) {
  try {
    if (!datos.emailDestinatario) return { ok: false, error: 'Email destinatario vacío' };

    // Construir blob desde base64 si viene del cliente; si no, _enviarCorreoRV lo resuelve desde Drive
    let pdfBlob = null;
    if (pdfB64) {
      const raw    = pdfB64.replace(/^data:application\/pdf;base64,/, '');
      const nombre = 'CertimarRV_' + datos.nroRegistro + '_'
                   + datos.centroCultivo.replace(/[^a-zA-Z0-9]/g,'_') + '.pdf';
      pdfBlob = Utilities.newBlob(Utilities.base64Decode(raw), 'application/pdf', nombre);
    }

    _enviarCorreoRV(datos, urlCertificado, pdfBlob);

    // Actualizar estado en Sheets
    try {
      _actualizarFilaEnviado(datos.nroRegistro, datos.emailDestinatario, urlCertificado);
    } catch(e) {
      Logger.log('enviarNotificacion: no se pudo actualizar estado en Sheets: ' + e);
    }

    return { ok: true };
  } catch(err) {
    Logger.log('enviarNotificacion error: ' + err);
    return { ok: false, error: String(err) };
  }
}


// ============================================================
//  OBTENER REGISTROS HISTÓRICOS
// ============================================================
function obtenerRegistros(filtro) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: true, data: [] };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: true, data: [] };

    // Leer hasta columna U (21) para incluir firma/token
    const numCols  = Math.min(sheet.getLastColumn(), 21);
    const valores  = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    const registros = [];
    for (let i = 0; i < valores.length; i++) {
      const r = valores[i];
      const nroReg = String(r[1] || '').trim();
      if (!nroReg) continue;  // ignorar filas vacías

      // Formatear fecha: puede venir como Date o string
      let fecha = '';
      if (r[0] instanceof Date) {
        const d = r[0];
        fecha = Utilities.formatDate(d, TIMEZONE, 'dd/MM/yyyy HH:mm');
      } else {
        fecha = String(r[0] || '');
      }

      // urlCert: si es fórmula HYPERLINK extraer la URL
      let urlCert = String(r[16] || '');
      if (urlCert.startsWith('=HYPERLINK')) {
        const m = urlCert.match(/"(https?:\/\/[^"]+)"/);
        urlCert = m ? m[1] : '';
      }

      registros.push({
        rowIndex    : i + 2,
        fecha       : fecha,
        nroReg      : nroReg,
        centro      : String(r[2]  || ''),
        nroCentro   : String(r[3]  || ''),
        acs         : String(r[4]  || ''),
        titular     : String(r[5]  || ''),
        area        : String(r[6]  || ''),
        fechaSiembra: String(r[7]  || ''),
        tamanoPeces : String(r[8]  || ''),
        ubicacion   : String(r[9]  || ''),
        latLong     : String(r[10] || ''),
        resExt      : String(r[11] || ''),
        observaciones: String(r[12] || ''),
        tipoObs     : String(r[13] || ''),
        responsable : String(r[14] || ''),
        emailResp   : String(r[15] || ''),
        urlCert     : urlCert,
        estado      : numCols >= 18 ? String(r[17] || 'GUARDADO') : 'GUARDADO',
        urlFirmaCliente: numCols >= 19 ? String(r[18] || '') : '',
        tokenFirma     : numCols >= 20 ? String(r[19] || '') : '',
        estadoFirma    : numCols >= 21 ? String(r[20] || '') : ''
      });
    }

    // Filtros
    let resultado = registros.reverse();  // más reciente primero
    if (filtro && filtro.busqueda) {
      const q = String(filtro.busqueda).toLowerCase();
      resultado = resultado.filter(r =>
        r.centro.toLowerCase().includes(q) ||
        r.titular.toLowerCase().includes(q) ||
        r.nroReg.toLowerCase().includes(q)
      );
    }

    return { ok: true, data: resultado };
  } catch(err) {
    Logger.log('obtenerRegistros error: ' + err + '\n' + err.stack);
    return { ok: false, error: String(err), data: [] };
  }
}


// ============================================================
//  ESTADÍSTICAS PARA DASHBOARD
// ============================================================
function obtenerEstadisticas() {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) {
      return { ok: true, totalMes: 0, totalAnio: 0, centrosUnicos: 0,
               porMes: [], porResolucion: [], ultimaInspeccion: null };
    }

    const valores = sheet.getRange(2, 1, sheet.getLastRow() - 1, 17).getValues()
                         .filter(r => r[1]);

    const hoy    = new Date();
    const mesAct = hoy.getMonth();
    const anio   = hoy.getFullYear();

    const porMes        = {};
    const porResolucion = {};
    const centros       = new Set();
    let totalMes        = 0;
    let ultimaInspeccion = null;

    valores.forEach(r => {
      const fecha   = r[0] ? new Date(r[0]) : null;
      const centro  = r[2] || '';
      const resExt  = r[11] || '';

      if (centro) centros.add(centro);
      if (ultimaInspeccion === null) ultimaInspeccion = r; // ya están en orden de inserción

      if (fecha && fecha.getFullYear() === anio) {
        const mes = fecha.toLocaleDateString('es-CL', { month: 'short', timeZone: TIMEZONE });
        porMes[mes] = (porMes[mes] || 0) + 1;
        if (fecha.getMonth() === mesAct) totalMes++;
      }

      resExt.split(',').forEach(res => {
        const key = res.trim();
        if (key) porResolucion[key] = (porResolucion[key] || 0) + 1;
      });
    });

    return {
      ok           : true,
      totalMes,
      totalAnio    : valores.length,
      centrosUnicos: centros.size,
      porMes       : Object.entries(porMes).map(([name, v]) => ({ name, inspecciones: v })),
      porResolucion: Object.entries(porResolucion).map(([name, v]) => ({ name, value: v })),
      ultimaInspeccion: ultimaInspeccion ? {
        fecha  : ultimaInspeccion[0],
        centro : ultimaInspeccion[2],
        titular: ultimaInspeccion[5]
      } : null
    };
  } catch(err) {
    return { ok: false, error: err.toString() };
  }
}

// ============================================================
//  INICIALIZAR HOJA (ejecutar manualmente 1 vez)
// ============================================================
function inicializarHoja() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet   = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  sheet.clearContents();
  _crearEncabezados(sheet);
  SpreadsheetApp.flush();
  Logger.log('✅ Hoja ' + SHEET_NAME + ' inicializada correctamente.');
}

// ============================================================
//  HELPERS PRIVADOS
// ============================================================
function _crearEncabezados(sheet) {
  const headers = [
    'Fecha', 'N° Registro', 'Centro', 'N° Centro', 'ACS', 'Titular',
    'Área', 'Fecha última siembra', 'Tamaño peces', 'Ubicación',
    'Lat Long', 'Res ext', 'Observaciones', 'Tipo de observación',
    'Nombre responsable', 'Correo responsable', 'Hipervínculo al certificado',
    'Estado', 'URL Firma Cliente', 'Token Firma', 'Estado Firma'
  ];
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setBackground('#003366').setFontColor('white').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, headers.length, 160);
}

// ============================================================
//  REGISTRAR EN SHEETS (siempre, independiente de Drive/correo)
//  Garantiza que todo RV quede en la hoja aunque falle Drive.
// ============================================================
function registrarEnSheets(datos, urlCertificado) {
  try {
    const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) { sheet = ss.insertSheet(SHEET_NAME); _crearEncabezados(sheet); }
    if (sheet.getLastRow() === 0) _crearEncabezados(sheet);

    // Verificar si ya existe el registro (evitar duplicados)
    if (sheet.getLastRow() >= 2) {
      const nros = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < nros.length; i++) {
        if (String(nros[i][0]).trim() === String(datos.nroRegistro).trim()) {
          // Ya existe: actualizar solo la URL del certificado si se recibió
          if (urlCertificado) {
            sheet.getRange(i + 2, 17).setValue('=HYPERLINK("' + urlCertificado + '","Ver PDF")');
            SpreadsheetApp.flush();
          }
          return { ok: true, accion: 'actualizado' };
        }
      }
    }

    // Construir resoluciones
    const resArray = [];
    if (datos.resoluciones) {
      if (datos.resoluciones.cicE2)        resArray.push('1821-CIC E2');
      if (datos.resoluciones.ca)           resArray.push('1821-CA');
      if (datos.resoluciones.vs)           resArray.push('1821-VS');
      if (datos.resoluciones.res1511)      resArray.push('1511');
      if (datos.resoluciones.desinfeccion) resArray.push('DESINFECCIÓN');
    }

    const ahora = new Date();
    sheet.appendRow([
      Utilities.formatDate(ahora, TIMEZONE, 'dd/MM/yyyy HH:mm'),
      datos.nroRegistro,
      datos.centroCultivo,
      datos.nroCentro,
      datos.acs,
      datos.titular,
      datos.area || '',
      datos.fechaSiembra,
      datos.tamanoPeces,
      datos.ubicacion,
      (datos.latitud || '') + (datos.longitud ? ', ' + datos.longitud : ''),
      resArray.join(', '),
      datos.observaciones,
      datos.tipoObservacion || '',
      datos.nombreResponsable,
      datos.emailDestinatario || '',
      urlCertificado ? '=HYPERLINK("' + urlCertificado + '","Ver PDF")' : '',
      'GUARDADO'
    ]);
    SpreadsheetApp.flush();
    return { ok: true, accion: 'insertado' };

  } catch(err) {
    Logger.log('registrarEnSheets error: ' + err);
    return { ok: false, error: err.toString() };
  }
}

function _obtenerCarpetaDrive() {
  try {
    return DriveApp.getFolderById(DRIVE_FOLDER_ID);
  } catch(e) {
    // Si no existe el folder configura, crea uno nuevo
    const folders = DriveApp.getFoldersByName('Certificados Certimar');
    return folders.hasNext() ? folders.next() : DriveApp.createFolder('Certificados Certimar');
  }
}

// Obtiene (o crea) la subcarpeta del centro dentro de la carpeta raíz.
// Nombre: "NNNN – NOMBRE_CENTRO" (ej: "100 – CACERES") o solo el nombre si no hay N° centro.
function _obtenerCarpetaCentro(centroCultivo, nroCentro) {
  const root   = _obtenerCarpetaDrive();
  const centro = String(centroCultivo || 'SIN_CENTRO').trim().substring(0, 50);
  const nro    = String(nroCentro     || '').trim();
  const nombre = nro ? nro + ' \u2013 ' + centro : centro;
  const iter   = root.getFoldersByName(nombre);
  return iter.hasNext() ? iter.next() : root.createFolder(nombre);
}

// Devuelve { url, blob } — el blob se reutiliza como adjunto de correo sin re-decodificar
function _subirPDFDrive(base64, nroRegistro, centro, carpeta) {
  const raw    = base64.replace(/^data:application\/pdf;base64,/, '');
  const bytes  = Utilities.base64Decode(raw);
  const nombre = 'CertimarRV_' + nroRegistro + '_' + (centro || '').replace(/\s+/g,'_') + '.pdf';
  const folder = carpeta || _obtenerCarpetaDrive();
  const file   = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', nombre));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Blob separado para adjuntar en correo (createFile puede consumir el blob original)
  return { url: file.getUrl(), blob: Utilities.newBlob(bytes, 'application/pdf', nombre) };
}

function _subirFotoDrive(base64, nroRegistro, carpeta) {
  const mediaType = base64.match(/^data:([^;]+);base64,/)?.[1] || 'image/jpeg';
  const datos  = base64.replace(/^data:[^;]+;base64,/, '');
  const bytes  = Utilities.base64Decode(datos);
  const ext    = mediaType.split('/')[1] || 'jpg';
  const blob   = Utilities.newBlob(bytes, mediaType, 'Foto_' + nroRegistro + '.' + ext);
  const folder = carpeta || _obtenerCarpetaDrive();
  const file   = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ============================================================
//  EMAIL — HELPERS PRIVADOS COMPARTIDOS
// ============================================================

// Retorna el email para copia interna con fallback garantizado a EMAIL_REMITENTE
function _getInternalCopyEmail() {
  try {
    return Session.getActiveUser().getEmail()
        || Session.getEffectiveUser().getEmail()
        || EMAIL_REMITENTE;
  } catch(_) {
    return EMAIL_REMITENTE;
  }
}

// Resuelve el blob PDF a adjuntar:
//   - Si viene pdfBlob ya construido → lo usa directamente
//   - Si viene urlCertificado → lo descarga desde Drive
//   - Si ninguno → null (correo sin adjunto; el link queda en el cuerpo)
function _resolverPdfBlob(datos, pdfBlob, urlCertificado) {
  if (pdfBlob) return pdfBlob;
  if (!urlCertificado) return null;
  try {
    const match = urlCertificado.match(/[-\w]{25,}/);
    if (!match) return null;
    const nombre = 'CertimarRV_' + datos.nroRegistro + '_'
                 + datos.centroCultivo.replace(/[^a-zA-Z0-9]/g,'_') + '.pdf';
    return DriveApp.getFileById(match[0]).getAs('application/pdf').setName(nombre);
  } catch(e) {
    Logger.log('_resolverPdfBlob: no se pudo obtener PDF desde Drive: ' + e);
    return null;
  }
}

// Construye y despacha el correo al destinatario + copia interna.
// pdfBlob puede ser null; en ese caso se intenta resolver desde urlCertificado.
function _enviarCorreoRV(datos, urlCertificado, pdfBlob) {
  const destEmail = datos.emailDestinatario;
  if (!destEmail) throw new Error('Email destinatario vacío');

  const fechaLabel = datos.fecha || Utilities.formatDate(new Date(), TIMEZONE, 'dd-MM-yyyy');
  const asunto     = '[Certimar] Registro de Visita – ' + datos.centroCultivo + ' – ' + fechaLabel;
  const htmlBody   = _plantillaEmail(datos, urlCertificado || '');
  const blob       = _resolverPdfBlob(datos, pdfBlob, urlCertificado);

  const opciones = { htmlBody, replyTo: EMAIL_REMITENTE, name: 'Certimar SpA' };
  if (datos.emailCC  && datos.emailCC.trim())  opciones.cc  = datos.emailCC.trim();
  if (datos.emailCCO && datos.emailCCO.trim()) opciones.bcc = datos.emailCCO.trim();
  if (blob) opciones.attachments = [blob];

  GmailApp.sendEmail(destEmail, asunto, '', opciones);

  // Copia interna al remitente corporativo (sin PDF para no duplicar adjuntos en el hilo)
  const copiaEmail = _getInternalCopyEmail();
  if (copiaEmail && copiaEmail !== destEmail) {
    GmailApp.sendEmail(copiaEmail, '[COPIA INTERNA] ' + asunto, '', {
      htmlBody, replyTo: EMAIL_REMITENTE, name: 'Certimar SpA'
    });
  } else if (!copiaEmail) {
    Logger.log('_enviarCorreoRV: no se pudo resolver email para copia interna');
  }
}

function _plantillaEmail(datos, urlCert) {
  // ---- sin emojis: algunos clientes de correo los corrompen ----
  const linkBtn = urlCert
    ? `<a href="${urlCert}" style="display:inline-block;background:#003366;color:#ffffff;padding:13px 32px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;margin-top:8px;letter-spacing:.5px;font-family:Arial,sans-serif">Ver Certificado en Drive &rarr;</a>`
    : '';

  // resoluciones puede venir como objeto {cicE2, ca, vs, ...} (nuevo registro)
  // o como string "1821-CIC E2, 1511" (re-envío desde admin)
  let resStr;
  if (typeof datos.resoluciones === 'string' && datos.resoluciones.trim()) {
    resStr = datos.resoluciones.trim();
  } else {
    const resoluciones = [];
    if (datos.resoluciones) {
      if (datos.resoluciones.cicE2)        resoluciones.push('1821&#8209;CIC E2');
      if (datos.resoluciones.ca)           resoluciones.push('1821&#8209;CA');
      if (datos.resoluciones.vs)           resoluciones.push('1821&#8209;VS');
      if (datos.resoluciones.res1511)      resoluciones.push('1511');
      if (datos.resoluciones.desinfeccion) resoluciones.push('DESINFECCI&Oacute;N');
    }
    resStr = resoluciones.length ? resoluciones.join(', ') : '&#8212;';
  }

  // Filas de la tabla de datos
  const filas = [
    ['N&deg; Registro',    `<strong style="color:#003366">${datos.nroRegistro}</strong>`],
    ['Fecha',              datos.fecha || '&#8212;'],
    ['Centro de Cultivo',  datos.centroCultivo || '&#8212;'],
    ['N&deg; Centro',      datos.nroCentro || '&#8212;'],
    ['Titular',            datos.titular || '&#8212;'],
    ['ACS',                datos.acs || '&#8212;'],
    ['Responsable',        datos.nombreResponsable || '&#8212;'],
    ['Tipo Observaci&oacute;n', datos.tipoObservacion || '&#8212;'],
    ['Resoluciones',       resStr],
    ['Observaciones',      (datos.observaciones || 'S/O').replace(/\n/g,'<br>')],
  ].map(function(r, i) {
    const bg = i % 2 === 0 ? '#ffffff' : '#f1f5f9';
    return `<tr style="background:${bg}">
      <td style="padding:9px 14px;font-weight:600;color:#64748b;font-size:13px;width:38%;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif">${r[0]}</td>
      <td style="padding:9px 14px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif">${r[1]}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 12px rgba(0,0,0,.08)">

    <!-- HEADER -->
    <tr>
      <td style="background:#003366;padding:0">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg,#003366 0%,#005599 50%,#003366 100%);padding:28px 32px 22px;border-bottom:4px solid #0099CC">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:14px;vertical-align:middle">
                    <!-- Logo SVG inline (sin emojis) -->
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 60 60">
                      <rect x="2" y="2" width="56" height="56" rx="8" fill="white" stroke="#0099CC" stroke-width="3"/>
                      <path d="M20 2V40M40 2V40M2 20H58M2 40H58" stroke="#003366" stroke-width="1.5"/>
                      <path d="M2 45Q16 35 30 45T58 45V50Q44 40 30 50T2 50V45Z" fill="#0099CC"/>
                      <path d="M2 50Q16 40 30 50T58 50V58C58 59.1 57.1 60 56 60H4C2.9 60 2 59.1 2 58V50Z" fill="#003366"/>
                      <path d="M25 35L35 45L55 15" stroke="#003366" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </td>
                  <td style="vertical-align:middle">
                    <div style="color:#ffffff;font-size:22px;font-weight:900;letter-spacing:3px;font-family:Arial,sans-serif">CERTIMAR</div>
                    <div style="color:rgba(180,220,255,.85);font-size:12px;letter-spacing:1px;font-family:Arial,sans-serif;margin-top:3px">Sistema de Certificaci&oacute;n &mdash; Registro de Visita</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#0055a4;padding:10px 32px">
              <span style="color:#b8d9ff;font-size:12px;font-family:Arial,sans-serif">Inspecci&oacute;n T&eacute;cnica Oficial &mdash; Sernapesca</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- SALUDO -->
    <tr>
      <td style="padding:28px 32px 16px;background:#ffffff">
        <p style="margin:0 0 12px;color:#1e293b;font-size:15px;font-family:Arial,sans-serif">Estimado(a) <strong>${datos.nombreResponsable || 'Responsable'}</strong>,</p>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.65;font-family:Arial,sans-serif">
          En relaci&oacute;n a la visita t&eacute;cnica de auditor&iacute;a realizada en el centro <strong style="color:#003366">${datos.centroCultivo}</strong>
          (RNA:&nbsp;${datos.nroCentro}, ACS:&nbsp;${datos.acs}) con fecha <strong>${datos.fecha}</strong>,
          adjunto encontrar&aacute; el Registro de Visita oficial emitido por Certimar SpA,
          correspondiente al respaldo de la inspecci&oacute;n t&eacute;cnica realizada seg&uacute;n los protocolos vigentes de Sernapesca.
        </p>
      </td>
    </tr>

    <!-- TABLA DE DATOS -->
    <tr>
      <td style="padding:8px 32px 24px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          ${filas}
        </table>
      </td>
    </tr>

    <!-- BOTÓN CERTIFICADO -->
    ${urlCert ? `<tr><td style="padding:4px 32px 28px;text-align:center">${linkBtn}</td></tr>` : ''}

    <!-- DIVISOR -->
    <tr><td style="padding:0 32px"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0"></td></tr>

    <!-- FOOTER -->
    <tr>
      <td style="background:#1e293b;padding:18px 32px;text-align:center">
        <p style="margin:0;color:#94a3b8;font-size:11px;font-family:Arial,sans-serif">
          Certimar SpA &bull; ${EMAIL_REMITENTE} &bull; +56 9 6115 6322
        </p>
        <p style="margin:6px 0 0;color:#64748b;font-size:11px;font-family:Arial,sans-serif">
          &copy; ${new Date().getFullYear()} Todos los derechos reservados.
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ============================================================
//  ACTUALIZAR REGISTRO EXISTENTE (edición desde histórico)
// ============================================================
function actualizarRegistro(datos) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Hoja no encontrada' };

    const nros = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < nros.length; i++) {
      if (String(nros[i][0]).trim() === String(datos.nroRegistro).trim()) {
        const fila = i + 2;

        // resolucionesStr viene como texto libre desde el frontend
        const resStr = datos.resolucionesStr || datos.resoluciones || '';

        sheet.getRange(fila,  3).setValue(datos.centroCultivo    || '');
        sheet.getRange(fila,  4).setValue(datos.nroCentro        || '');
        sheet.getRange(fila,  5).setValue(datos.acs              || '');
        sheet.getRange(fila,  6).setValue(datos.titular          || '');
        sheet.getRange(fila,  7).setValue(datos.area             || '');
        sheet.getRange(fila,  8).setValue(datos.fechaSiembra     || '');
        sheet.getRange(fila,  9).setValue(datos.tamanoPeces      || '');
        sheet.getRange(fila, 10).setValue(datos.ubicacion        || '');
        sheet.getRange(fila, 12).setValue(resStr);
        sheet.getRange(fila, 13).setValue(datos.observaciones    || '');
        sheet.getRange(fila, 14).setValue(datos.tipoObservacion  || '');
        sheet.getRange(fila, 15).setValue(datos.nombreResponsable|| '');
        sheet.getRange(fila, 16).setValue(datos.emailDestinatario|| datos.emailResponsable || '');
        SpreadsheetApp.flush();
        return { ok: true };
      }
    }
    return { ok: false, error: 'Registro no encontrado: ' + datos.nroRegistro };
  } catch(err) {
    Logger.log('actualizarRegistro error: ' + err);
    return { ok: false, error: err.toString() };
  }
}

// ============================================================
//  DRIVE — FIRMA CLIENTE (PNG)
// ============================================================
function _subirFirmaClienteDrive(base64, nroRegistro, carpeta) {
  const datos  = base64.replace(/^data:image\/[^;]+;base64,/, '');
  const bytes  = Utilities.base64Decode(datos);
  const blob   = Utilities.newBlob(bytes, 'image/png', 'FirmaCliente_' + nroRegistro + '.png');
  const folder = carpeta || _obtenerCarpetaDrive();
  const file   = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ============================================================
//  FIRMA TEMPORAL — Generar link, obtener datos, confirmar
// ============================================================

// Genera un token UUID, lo guarda en col T del registro y devuelve la URL de firma.
function generarLinkFirma(nroRegistro) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Hoja no encontrada');

  const nros = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  let rowIdx = -1;
  for (let i = 0; i < nros.length; i++) {
    if (String(nros[i][0]).trim() === nroRegistro) { rowIdx = i + 2; break; }
  }
  if (rowIdx < 0) throw new Error('Registro no encontrado: ' + nroRegistro);

  // Token incluye expiración 72h: "UUID::EPOCH_EXPIRY"
  const expiry72h = Date.now() + 72 * 3600 * 1000;
  const token = Utilities.getUuid() + '::' + String(expiry72h);
  // Col T = columna 20
  sheet.getRange(rowIdx, 20).setValue(token);
  // Col U = columna 21 — marcar como pendiente si estaba vacío
  const estadoActual = sheet.getRange(rowIdx, 21).getValue();
  if (!estadoActual) sheet.getRange(rowIdx, 21).setValue('PENDIENTE');
  SpreadsheetApp.flush();

  const scriptUrl = ScriptApp.getService().getUrl();
  return scriptUrl + '?view=firma&nro=' + encodeURIComponent(nroRegistro) + '&token=' + encodeURIComponent(token);
}

// Valida token y devuelve los datos del registro para mostrar en la página de firma.
function getRegistroParaFirma(nroRegistro, token) {
  if (!nroRegistro || !token) return { ok: false, error: 'Parámetros inválidos' };
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, error: 'Hoja no encontrada' };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'Sin registros' };
    const valores = sheet.getRange(2, 1, lastRow - 1, 21).getValues();

    for (const r of valores) {
      if (String(r[1]).trim() !== nroRegistro) continue;
      const storedToken = String(r[19] || '').trim();
      if (!storedToken || storedToken !== token) {
        return { ok: false, error: 'Token inválido o expirado' };
      }
      // Verificar expiración (formato "UUID::EPOCH_MS")
      const _tparts = storedToken.split('::');
      if (_tparts.length > 1) {
        const _texp = parseInt(_tparts[1], 10);
        if (!isNaN(_texp) && Date.now() > _texp) {
          return { ok: false, error: 'Token inválido o expirado' };
        }
      }
      const estadoFirma = String(r[20] || '');
      if (estadoFirma === 'FIRMADO') {
        return { ok: false, error: 'Este registro ya fue firmado' };
      }
      return {
        ok: true,
        data: {
          nroRegistro    : String(r[1] || ''),
          fecha          : String(r[0] instanceof Date
            ? Utilities.formatDate(r[0], TIMEZONE, 'dd/MM/yyyy') : r[0] || ''),
          centroCultivo  : String(r[2]  || ''),
          nroCentro      : String(r[3]  || ''),
          acs            : String(r[4]  || ''),
          titular        : String(r[5]  || ''),
          fechaSiembra   : String(r[7]  || ''),
          tamanoPeces    : String(r[8]  || ''),
          resoluciones   : String(r[11] || ''),
          observaciones  : String(r[12] || ''),
          tipoObservacion: String(r[13] || ''),
          nombreResponsable: String(r[14] || ''),
          emailResponsable : String(r[15] || ''),
          urlCertificado : (() => {
            let u = String(r[16] || '');
            if (u.startsWith('=HYPERLINK')) {
              const m = u.match(/"(https?:\/\/[^"]+)"/);
              u = m ? m[1] : '';
            }
            return u;
          })()
        }
      };
    }
    return { ok: false, error: 'Registro no encontrado' };
  } catch(e) {
    return { ok: false, error: String(e) };
  }
}

// Escribe campos de firma en el documento de Firestore vía REST API (no-fatal).
function _actualizarFirmaEnFirestore(nroRegistro, firmaB64, urlFirma, nombreResponsable, emailResponsable) {
  try {
    let mask = '?updateMask.fieldPaths=firmaClienteB64'
             + '&updateMask.fieldPaths=urlFirmaCliente'
             + '&updateMask.fieldPaths=estadoFirma';
    const fields = {
      firmaClienteB64: { stringValue: firmaB64  || '' },
      urlFirmaCliente : { stringValue: urlFirma  || '' },
      estadoFirma     : { stringValue: 'FIRMADO' }
    };
    if (nombreResponsable) {
      mask += '&updateMask.fieldPaths=nombreResponsable';
      fields.nombreResponsable = { stringValue: nombreResponsable };
    }
    if (emailResponsable) {
      mask += '&updateMask.fieldPaths=emailResponsable';
      fields.emailResponsable = { stringValue: emailResponsable };
    }
    const apiUrl = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
                 + '/databases/(default)/documents/registros_visita/'
                 + encodeURIComponent(nroRegistro) + mask;
    const payload = { fields };
    UrlFetchApp.fetch(apiUrl, {
      method            : 'PATCH',
      headers           : { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
                             'Content-Type' : 'application/json' },
      payload           : JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log('_actualizarFirmaEnFirestore error: ' + e);
  }
}

// Recibe la firma del jefe de centro, la sube a Drive, invalida el token y notifica.
function submitFirma(nroRegistro, token, firmaB64, nombreResponsable, emailCorregido) {
  if (!nroRegistro || !token || !firmaB64) return { ok: false, error: 'Datos incompletos' };
  const nombreFinal = (nombreResponsable || '').trim();
  const emailFinal  = (emailCorregido   || '').trim();
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, error: 'Hoja no encontrada' };

    const lastRow = sheet.getLastRow();
    const valores = sheet.getRange(2, 1, lastRow - 1, 21).getValues();
    let rowIdx = -1, emailResp = '', nroCentro = '', centroCultivo = '', urlCert = '', nombreResp = '';

    for (let i = 0; i < valores.length; i++) {
      if (String(valores[i][1]).trim() !== nroRegistro) continue;
      const _st = String(valores[i][19] || '').trim();
      if (!_st || _st !== token) return { ok: false, error: 'Token inválido o expirado' };
      // Verificar expiración (formato "UUID::EPOCH_MS")
      const _tp2 = _st.split('::');
      if (_tp2.length > 1) {
        const _texp2 = parseInt(_tp2[1], 10);
        if (!isNaN(_texp2) && Date.now() > _texp2) return { ok: false, error: 'Token inválido o expirado' };
      }
      if (String(valores[i][20] || '') === 'FIRMADO') return { ok: false, error: 'Ya firmado' };
      rowIdx        = i + 2;
      emailResp     = String(valores[i][15] || '');
      centroCultivo = String(valores[i][2]  || '');
      nroCentro     = String(valores[i][3]  || '');
      nombreResp    = String(valores[i][14] || '');
      let u = String(valores[i][16] || '');
      if (u.startsWith('=HYPERLINK')) { const m = u.match(/"(https?:\/\/[^"]+)"/); u = m ? m[1] : ''; }
      urlCert = u;
      break;
    }
    if (rowIdx < 0) return { ok: false, error: 'Registro no encontrado' };

    // Subir firma a Drive dentro de la carpeta del centro (no-fatal)
    let urlFirma = '';
    try {
      const carpetaFirma = _obtenerCarpetaCentro(centroCultivo, nroCentro);
      urlFirma = _subirFirmaClienteDrive(firmaB64, nroRegistro + '_responsable', carpetaFirma);
    } catch(eDrive) {
      Logger.log('submitFirma: no se pudo subir firma a Drive (no-fatal): ' + eDrive);
    }

    // Actualizar fila: col S (19) = URL firma, col T (20) = vaciar token, col U (21) = FIRMADO
    sheet.getRange(rowIdx, 19).setValue(urlFirma);
    sheet.getRange(rowIdx, 20).setValue('');       // invalidar token
    sheet.getRange(rowIdx, 21).setValue('FIRMADO');
    // Siempre actualizar nombre y email si el responsable los corrigió/completó
    if (nombreFinal) {
      sheet.getRange(rowIdx, 15).setValue(nombreFinal);
      nombreResp = nombreFinal;
    }
    if (emailFinal) {
      sheet.getRange(rowIdx, 16).setValue(emailFinal);
      emailResp = emailFinal;
    }
    SpreadsheetApp.flush();

    // Sincronizar firma + nombre a Firestore para que Regen. PDF los incluya
    _actualizarFirmaEnFirestore(nroRegistro, firmaB64, urlFirma, nombreFinal, emailFinal);

    // Enviar confirmación al responsable + copia a Certimar
    if (emailResp) {
      const asunto = '[Certimar] Conformidad de Visita firmada – ' + centroCultivo;
      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
<tr><td style="background:#003366;padding:28px 36px">
  <h1 style="color:#fff;font-size:22px;margin:0;letter-spacing:1px">CERTIMAR SpA</h1>
  <p style="color:#93c5fd;margin:4px 0 0;font-size:13px">Conformidad de Visita Registrada</p>
</td></tr>
<tr><td style="padding:32px 36px">
  <p style="color:#374151;font-size:15px">Estimado/a <strong>${nombreResp || 'Responsable'}</strong>,</p>
  <p style="color:#374151;font-size:14px">Su conformidad ha sido registrada exitosamente para el siguiente registro de visita:</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="background:#f1f5f9;border-radius:8px;margin:20px 0">
    <tr><td style="font-size:12px;color:#64748b;width:40%">N° Registro</td><td style="font-size:14px;font-weight:700;color:#003366">${nroRegistro}</td></tr>
    <tr><td style="font-size:12px;color:#64748b">Centro de Cultivo</td><td style="font-size:13px;color:#1e293b">${centroCultivo}</td></tr>
    <tr><td style="font-size:12px;color:#64748b">N° Centro</td><td style="font-size:13px;color:#1e293b">${nroCentro}</td></tr>
  </table>
  ${urlCert ? `<p style="text-align:center;margin:24px 0"><a href="${urlCert}" style="display:inline-block;background:#003366;color:#fff;padding:13px 32px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700">Ver Certificado en Drive &rarr;</a></p>` : ''}
  <p style="color:#94a3b8;font-size:11px;margin-top:32px">Certimar SpA · operaciones@certimar.cl</p>
</td></tr>
</table>
</td></tr>
</table></body></html>`;
      GmailApp.sendEmail(emailResp, asunto, '', {
        htmlBody: html, replyTo: EMAIL_REMITENTE, name: 'Certimar SpA'
      });
    }

    // Notificación interna a operaciones@certimar.cl
    try {
      const asuntoInterno = '[Sistema RV] Firma recibida – ' + nroRegistro + ' / ' + centroCultivo;
      const htmlInterno = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.07)">
<tr><td style="background:#003366;padding:20px 28px">
  <h2 style="color:#fff;font-size:18px;margin:0">✅ Firma de conformidad recibida</h2>
  <p style="color:#93c5fd;margin:4px 0 0;font-size:12px">Notificación automática · Sistema Certimar RV</p>
</td></tr>
<tr><td style="padding:24px 28px">
  <table width="100%" cellpadding="7" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
    <tr><td style="font-size:12px;color:#64748b;width:42%">N° Registro</td><td style="font-size:14px;font-weight:700;color:#003366">${nroRegistro}</td></tr>
    <tr><td style="font-size:12px;color:#64748b">Centro de Cultivo</td><td style="font-size:13px;color:#1e293b">${centroCultivo}</td></tr>
    <tr><td style="font-size:12px;color:#64748b">N° Centro</td><td style="font-size:13px;color:#1e293b">${nroCentro}</td></tr>
    <tr><td style="font-size:12px;color:#64748b">Jefe de Centro</td><td style="font-size:13px;color:#1e293b">${nombreFinal || nombreResp || '—'}</td></tr>
    <tr><td style="font-size:12px;color:#64748b">Email</td><td style="font-size:13px;color:#1e293b">${emailResp || '—'}</td></tr>
  </table>
  ${urlFirma ? `<p style="margin-top:16px;font-size:12px;color:#64748b">PNG firma: <a href="${urlFirma}" style="color:#003366">${urlFirma}</a></p>` : ''}
  ${urlCert  ? `<p style="text-align:center;margin:20px 0"><a href="${urlCert}" style="display:inline-block;background:#003366;color:#fff;padding:11px 28px;text-decoration:none;border-radius:6px;font-size:13px;font-weight:700">Ver Certificado en Drive &rarr;</a></p>` : ''}
  <p style="color:#94a3b8;font-size:10px;margin-top:24px">Certimar SpA · Sistema de Registro de Visitas</p>
</td></tr>
</table>
</td></tr>
</table></body></html>`;
      GmailApp.sendEmail(EMAIL_REMITENTE, asuntoInterno, '', {
        htmlBody: htmlInterno, name: 'Sistema Certimar RV',
        cc: EMAIL_COPIA_FIRMA
      });
    } catch(eMail) {
      Logger.log('submitFirma: notificación interna fallida (no-fatal): ' + eMail);
    }

    return { ok: true, urlFirma };
  } catch(e) {
    Logger.log('submitFirma error: ' + e);
    return { ok: false, error: String(e) };
  }
}

// Borra el estado de firma de un registro (token, URL y estado).
// Permite re-generar el link y volver a solicitar firma.
function borrarFirma(nroRegistro) {
  if (!nroRegistro) return { ok: false, error: 'N° registro requerido' };
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, error: 'Hoja no encontrada' };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'Sin registros' };
    const nros = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    let rowIdx = -1;
    for (let i = 0; i < nros.length; i++) {
      if (String(nros[i][0]).trim() === nroRegistro) { rowIdx = i + 2; break; }
    }
    if (rowIdx < 0) return { ok: false, error: 'Registro no encontrado' };

    // Limpiar col S (URLFirma), T (Token), U (EstadoFirma)
    sheet.getRange(rowIdx, 19, 1, 3).clearContent();
    SpreadsheetApp.flush();

    // Limpiar en Firestore (no-fatal)
    try {
      const mask = '?updateMask.fieldPaths=firmaClienteB64'
                 + '&updateMask.fieldPaths=urlFirmaCliente'
                 + '&updateMask.fieldPaths=estadoFirma';
      const apiUrl = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
                   + '/databases/(default)/documents/registros_visita/'
                   + encodeURIComponent(nroRegistro) + mask;
      UrlFetchApp.fetch(apiUrl, {
        method            : 'PATCH',
        headers           : { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
                               'Content-Type' : 'application/json' },
        payload           : JSON.stringify({ fields: {
          firmaClienteB64: { stringValue: '' },
          urlFirmaCliente : { stringValue: '' },
          estadoFirma     : { stringValue: '' }
        }}),
        muteHttpExceptions: true
      });
    } catch(eFs) {
      Logger.log('borrarFirma: Firestore no actualizado (no-fatal): ' + eFs);
    }

    return { ok: true };
  } catch(e) {
    Logger.log('borrarFirma error: ' + e);
    return { ok: false, error: String(e) };
  }
}

// Página HTML autónoma para que el jefe de centro firme
function _servirPaginaFirma(nroRegistro, token) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Firma de Conformidad – Certimar</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#f1f5f9!important;color:#1e293b!important}
body{font-family:Arial,sans-serif;background:#f1f5f9;min-height:100vh;padding:20px}
canvas{background:#fff!important}
.card{background:#fff!important;border-radius:12px;max-width:520px;margin:0 auto;box-shadow:0 2px 16px rgba(0,0,0,.1);overflow:hidden}
.hdr{background:#003366;padding:22px 28px}
.hdr h1{color:#fff;font-size:19px;letter-spacing:1px}
.hdr p{color:#93c5fd;font-size:12px;margin-top:3px}
.body{padding:28px}
.field{margin-bottom:14px}
.label{font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px}
.value{font-size:14px;color:#1e293b;font-weight:500}
.divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}
.firma-wrap{border:2px dashed #93c5fd;border-radius:8px;overflow:hidden;background:#f8fafc;position:relative;touch-action:none}
canvas{display:block;width:100%;height:120px;cursor:crosshair}
.btn-clear{background:none;border:none;color:#ef4444;font-size:12px;cursor:pointer;padding:4px 0;display:block;text-align:right;width:100%;margin-top:6px}
.btn-submit{width:100%;background:#003366;color:#fff;border:none;padding:16px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;margin-top:24px;letter-spacing:.5px}
.btn-submit:disabled{background:#94a3b8;cursor:not-allowed}
.msg{padding:12px 16px;border-radius:8px;font-size:14px;margin-top:16px;display:none}
.msg.ok{background:#dcfce7;color:#166534}
.msg.err{background:#fee2e2;color:#991b1b}
.spinner{display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
#loading{text-align:center;padding:60px 28px;color:#64748b}
#content{display:none}
</style>
</head>
<body>
<div class="card">
  <div class="hdr">
    <h1>CERTIMAR SpA</h1>
    <p>Firma de Conformidad — Registro de Visita</p>
  </div>
  <div id="loading">
    <div class="spinner" style="border-color:rgba(0,51,102,.2);border-top-color:#003366"></div>
    <p style="margin-top:12px">Cargando registro…</p>
  </div>
  <div id="content" class="body">
    <div class="field"><div class="label">N° Registro</div><div class="value" id="f-nro">—</div></div>
    <div class="field"><div class="label">Fecha</div><div class="value" id="f-fecha">—</div></div>
    <div class="field"><div class="label">Centro de Cultivo</div><div class="value" id="f-centro">—</div></div>
    <div class="field"><div class="label">N° Centro</div><div class="value" id="f-nroCentro">—</div></div>
    <div class="field"><div class="label">Titular</div><div class="value" id="f-titular">—</div></div>
    <div class="field"><div class="label">ACS</div><div class="value" id="f-acs">—</div></div>
    <div class="field"><div class="label">Observaciones</div><div class="value" id="f-obs" style="font-size:13px;color:#374151">—</div></div>
    <hr class="divider">
    <hr class="divider" style="margin:16px 0 20px">
    <p style="font-size:12px;color:#64748b;margin-bottom:16px">Verifique y complete sus datos antes de firmar. Puede corregirlos si es necesario.</p>
    <div class="field" style="margin-bottom:14px">
      <div class="label" style="margin-bottom:5px">Nombre del Responsable <span style="color:#ef4444">*</span></div>
      <input type="text" id="f-nombre" placeholder="Ingrese su nombre completo"
        style="width:100%;border:1.5px solid #cbd5e1;border-radius:6px;padding:10px 12px;font-size:14px;font-family:Arial,sans-serif;outline:none"
        oninput="checkForm()">
      <div id="nombre-err" style="color:#dc2626;font-size:11px;margin-top:3px;display:none">Mínimo 3 caracteres.</div>
    </div>
    <div class="field" style="margin-bottom:20px">
      <div class="label" style="margin-bottom:5px">Correo del Responsable <span style="color:#ef4444">*</span></div>
      <input type="email" id="f-email" placeholder="correo@empresa.cl"
        style="width:100%;border:1.5px solid #cbd5e1;border-radius:6px;padding:10px 12px;font-size:14px;font-family:Arial,sans-serif;outline:none"
        oninput="checkForm()">
      <div id="email-err" style="color:#dc2626;font-size:11px;margin-top:3px;display:none">Ingrese un correo válido.</div>
    </div>
    <div class="label" style="margin-bottom:8px">Firma del Responsable del Centro de Cultivo</div>
    <div class="firma-wrap">
      <canvas id="firma-canvas" width="480" height="120"></canvas>
    </div>
    <button class="btn-clear" onclick="clearFirma()">✕ Borrar firma</button>
    <button class="btn-submit" id="btn-submit" onclick="enviarFirma()" disabled>Firmar y Confirmar Conformidad</button>
    <div class="msg ok" id="msg-ok">✅ Firma registrada correctamente. Recibirá una copia en su correo.</div>
    <div class="msg err" id="msg-err"></div>
  </div>
</div>
<script>
var NRO = ${JSON.stringify(nroRegistro)};
var TOKEN = ${JSON.stringify(token)};
var hasFirma = false;
var nombreGuardado = '';   // nombre que venía en el registro (puede estar vacío)
var canvas, ctx, drawing = false;

function checkForm() {
  var nombre = (document.getElementById('f-nombre').value || '').trim();
  var email  = (document.getElementById('f-email').value  || '').trim();
  var nombreOk = nombre.length >= 3;
  var emailOk  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  document.getElementById('nombre-err').style.display = nombreOk ? 'none' : '';
  document.getElementById('email-err').style.display  = emailOk  ? 'none' : '';
  document.getElementById('btn-submit').disabled = !(hasFirma && nombreOk && emailOk);
}

google.script.run
  .withSuccessHandler(function(res) {
    document.getElementById('loading').style.display = 'none';
    if (!res || !res.ok) {
      document.getElementById('content').style.display = 'block';
      document.getElementById('content').innerHTML = '<p style="color:#991b1b;font-size:15px;text-align:center;padding:20px">' + (res ? res.error : 'Error desconocido') + '</p>';
      return;
    }
    var d = res.data;
    document.getElementById('f-nro').textContent       = d.nroRegistro;
    document.getElementById('f-fecha').textContent     = d.fecha;
    document.getElementById('f-centro').textContent    = d.centroCultivo;
    document.getElementById('f-nroCentro').textContent = d.nroCentro;
    document.getElementById('f-titular').textContent   = d.titular;
    document.getElementById('f-acs').textContent       = d.acs;
    document.getElementById('f-obs').textContent       = d.observaciones || '(Sin observaciones)';
    // Pre-rellenar nombre y correo (editables para corrección)
    document.getElementById('f-nombre').value = d.nombreResponsable || '';
    document.getElementById('f-email').value  = d.emailResponsable  || '';
    document.getElementById('content').style.display = 'block';
    initCanvas();
  })
  .withFailureHandler(function(e) {
    document.getElementById('loading').innerHTML = '<p style="color:#991b1b">Error al cargar: ' + e + '</p>';
  })
  .getRegistroParaFirma(NRO, TOKEN);

function initCanvas() {
  canvas = document.getElementById('firma-canvas');
  ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = 120 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    var src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left), y: (src.clientY - r.top) };
  }
  function start(e) { e.preventDefault(); drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e)  { e.preventDefault(); if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function end(e) {
    drawing = false; hasFirma = true;
    checkForm();
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup',   end);
  canvas.addEventListener('mouseleave',end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove',  move,  { passive: false });
  canvas.addEventListener('touchend',   end);
}

function clearFirma() {
  ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
  hasFirma = false;
  document.getElementById('btn-submit').disabled = true;
}

function enviarFirma() {
  if (!hasFirma) return;
  var nombreFinal = (document.getElementById('f-nombre').value || '').trim();
  var emailFinal  = (document.getElementById('f-email').value  || '').trim();
  if (nombreFinal.length < 3) { checkForm(); document.getElementById('f-nombre').focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFinal)) { checkForm(); document.getElementById('f-email').focus(); return; }
  var btn = document.getElementById('btn-submit');
  btn.innerHTML = '<span class="spinner"></span>Enviando…';
  btn.disabled = true;
  var firmaB64 = canvas.toDataURL('image/png');
  google.script.run
    .withSuccessHandler(function(res) {
      if (res && res.ok) {
        document.getElementById('msg-ok').style.display = 'block';
        btn.style.display = 'none';
      } else {
        document.getElementById('msg-err').textContent = '❌ ' + (res ? res.error : 'Error al guardar');
        document.getElementById('msg-err').style.display = 'block';
        btn.innerHTML = 'Reintentar';
        btn.disabled = false;
      }
    })
    .withFailureHandler(function(e) {
      document.getElementById('msg-err').textContent = '❌ Error: ' + e;
      document.getElementById('msg-err').style.display = 'block';
      btn.innerHTML = 'Reintentar';
      btn.disabled = false;
    })
    .submitFirma(NRO, TOKEN, firmaB64, nombreFinal, emailFinal);
}
</script>
</body>
</html>`;
  return HtmlService.createHtmlOutput(html)
    .setTitle('Firma de Conformidad – Certimar')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
//  TEST — Verificar envío de correo  (ejecutar manualmente)
//  Ejecutar desde Apps Script → Ejecutar → testEnvioCorreo
// ============================================================
function testEnvioCorreo() {
  const LOG = [];
  const ok  = (msg) => { Logger.log('✅ ' + msg); LOG.push({ estado: 'OK',    msg }); };
  const err = (msg) => { Logger.log('❌ ' + msg); LOG.push({ estado: 'ERROR', msg }); };
  const inf = (msg) => { Logger.log('ℹ️  ' + msg); LOG.push({ estado: 'INFO',  msg }); };

  // —— 1. Destinatario de prueba ——
  const EMAIL_TEST = Session.getActiveUser().getEmail();
  if (!EMAIL_TEST) {
    err('No se pudo obtener el email del usuario activo — ejecutar autenticado.');
    return LOG;
  }
  inf('Destinatario de prueba: ' + EMAIL_TEST);

  // —— 2. Datos sintéticos de prueba ——
  const datosTest = {
    nroRegistro      : 'RV-TEST-0000',
    fecha            : Utilities.formatDate(new Date(), TIMEZONE, 'dd-MM-yyyy'),
    centroCultivo    : 'Centro Test Certimar',
    nroCentro        : 'RNA-TEST-001',
    acs              : 'ACS-999',
    titular          : 'Empresa Prueba SpA',
    area             : '1.5 ha',
    fechaSiembra     : '01-01-2026',
    tamanoPeces      : '250 g',
    ubicacion        : 'Región de Los Lagos',
    latitud          : '-41.4717',
    longitud         : '-72.9353',
    observaciones    : 'Registro generado automáticamente por testEnvioCorreo(). Ignorar.',
    tipoObservacion  : 'Cumple',
    nombreResponsable: 'Responsable Test',
    emailDestinatario: EMAIL_TEST,
    nombreCertificador: 'Certificador Test',
    rutCertificador  : '11.111.111-1',
    resoluciones     : { cicE2: true, ca: false, vs: true, res1511: true, desinfeccion: false }
  };
  ok('Datos de prueba construidos — nroRegistro: ' + datosTest.nroRegistro);

  // —— 3. Verificar plantilla HTML ——
  try {
    const urlCertTest = 'https://drive.google.com/file/d/TEST_FILE_ID/view';
    const html = _plantillaEmail(datosTest, urlCertTest);
    if (!html || html.length < 500) {
      err('_plantillaEmail() retornó HTML inválido o demasiado corto (' + (html||'').length + ' chars)');
    } else {
      ok('_plantillaEmail() OK — ' + html.length + ' chars generados');
    }
    // Verificar campos críticos en el HTML
    const checks = [
      ['nroRegistro',     datosTest.nroRegistro],
      ['centroCultivo',   datosTest.centroCultivo],
      ['titular',         datosTest.titular],
      ['nombreResponsable', datosTest.nombreResponsable],
      ['fecha',           datosTest.fecha],
      ['botón Drive',     'Ver Certificado en Drive'],
    ];
    checks.forEach(function([campo, valor]) {
      if (html.includes(valor)) {
        ok('Campo en template: ' + campo + ' → "' + valor + '"');
      } else {
        err('Campo AUSENTE en template: ' + campo + ' → "' + valor + '"');
      }
    });
  } catch(e) {
    err('_plantillaEmail() lanzó excepción: ' + e);
  }

  // —— 4. Generar PDF de prueba (Google Doc → PDF, estructura fiel al formulario real) ——
  let pdfBlob = null;
  let pdfDocId = null;
  try {
    const doc  = DocumentApp.create('_TEST_Certimar_Temp_' + Date.now());
    pdfDocId   = doc.getId();
    const body = doc.getBody();

    // Márgenes equivalentes al doc-paper (padding: 32px ≈ 24pt)
    body.setMarginTop(28).setMarginBottom(28).setMarginLeft(42).setMarginRight(42);

    // Helper: fila de tabla con estilo
    function _celda(tabla, textos, esEncabezado) {
      const fila = tabla.appendTableRow();
      textos.forEach(function(txt) {
        const cell = fila.appendTableCell(txt);
        cell.editAsText().setFontSize(esEncabezado ? 9 : 10)
            .setBold(esEncabezado)
            .setForegroundColor(esEncabezado ? '#FFFFFF' : '#1e293b');
        if (esEncabezado) {
          cell.setBackgroundColor('#003366');
        }
        cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(6).setPaddingRight(6);
      });
      return fila;
    }

    // ── ENCABEZADO ──────────────────────────────────────────────────
    const hdrTabla = body.appendTable([['', '']]);
    hdrTabla.setBorderWidth(0);
    const hdrFila = hdrTabla.getRow(0);

    // Celda izquierda: logo texto + título
    const celdaLogo = hdrFila.getCell(0);
    celdaLogo.setText('');
    celdaLogo.editAsText().insertText(0, 'CERTIMAR')
      .setFontSize(22).setBold(true).setForegroundColor('#003366');
    celdaLogo.appendParagraph('REGISTRO DE VISITA')
      .editAsText().setFontSize(14).setBold(true).setForegroundColor('#000000');
    celdaLogo.appendParagraph('Auditoría Técnica en Terreno')
      .editAsText().setFontSize(10).setItalic(true).setForegroundColor('#64748b');
    celdaLogo.setPaddingBottom(6);

    // Celda derecha: FECHA y N° REGISTRO
    const celdaMeta = hdrFila.getCell(1);
    celdaMeta.setText('');
    celdaMeta.appendParagraph('FECHA: ' + datosTest.fecha)
      .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
      .editAsText().setFontSize(10).setBold(false);
    const nroP = celdaMeta.appendParagraph('N° REGISTRO: ' + datosTest.nroRegistro);
    nroP.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    nroP.editAsText().setFontSize(13).setBold(true).setForegroundColor('#B91C1C');

    // Línea separadora azul
    body.appendParagraph('').editAsText().setFontSize(2);
    const sepP = body.appendParagraph('');
    sepP.editAsText().setFontSize(2);

    // ── TABLA DATOS CENTRO ───────────────────────────────────────────
    const encCentro = body.appendParagraph('DATOS DEL CENTRO');
    encCentro.editAsText().setFontSize(9).setBold(true).setForegroundColor('#FFFFFF');
    encCentro.setSpacingBefore(6).setSpacingAfter(0);
    // Simulamos encabezado coloreado con tabla de 1 fila 1 col
    const encTabla = body.appendTable([['DATOS DEL CENTRO']]);
    encTabla.getRow(0).getCell(0)
      .setBackgroundColor('#003366')
      .editAsText().setFontSize(9).setBold(true).setForegroundColor('#FFFFFF');
    encTabla.setBorderColor('#003366');

    const tDatos = body.appendTable();
    tDatos.setBorderColor('#94a3b8');
    [
      ['Centro de Cultivo',       datosTest.centroCultivo,  'N° de Centro', datosTest.nroCentro],
      ['A.C.S.',                  datosTest.acs,             'Titular',      datosTest.titular],
      ['Ubicación',               datosTest.ubicacion,       '',             ''],
      ['Fecha última siembra',    datosTest.fechaSiembra,    'Tamaño peces', datosTest.tamanoPeces],
    ].forEach(function(fila) {
      const r = tDatos.appendTableRow();
      fila.forEach(function(txt, i) {
        const c = r.appendTableCell(txt || '');
        c.editAsText().setFontSize(10)
          .setBold(i % 2 === 0)  // labels en bold
          .setForegroundColor(i % 2 === 0 ? '#64748b' : '#1e293b');
        c.setBackgroundColor(i % 2 === 0 ? '#f1f5f9' : '#ffffff');
        c.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(6).setPaddingRight(6);
      });
    });

    // ── NORMA APLICABLE ──────────────────────────────────────────────
    const encNorma = body.appendTable([['NORMA APLICABLE']]);
    encNorma.getRow(0).getCell(0)
      .setBackgroundColor('#003366')
      .editAsText().setFontSize(9).setBold(true).setForegroundColor('#FFFFFF');
    encNorma.setBorderColor('#003366');

    const normas = ['☑ 1821 – CIC E2', '☐ 1821 – CA', '☑ 1821 – VS', '☑ 1511', '☐ DESINFECCIÓN'];
    const tNorma = body.appendTable([normas]);
    tNorma.getRow(0).editAsText().setFontSize(10).setForegroundColor('#1e293b');
    tNorma.setBorderColor('#94a3b8');

    // ── COORDENADAS ───────────────────────────────────────────────────
    const encCoord = body.appendTable([['COORDENADAS GEOGRÁFICAS CONCESIÓN']]);
    encCoord.getRow(0).getCell(0)
      .setBackgroundColor('#003366')
      .editAsText().setFontSize(9).setBold(true).setForegroundColor('#FFFFFF');
    encCoord.setBorderColor('#003366');

    const tCoord = body.appendTable();
    tCoord.setBorderColor('#94a3b8');
    const rCoordHdr = tCoord.appendTableRow();
    ['LATITUD S', 'LONGITUD W', 'NORTE', 'ESTE'].forEach(function(h) {
      rCoordHdr.appendTableCell(h)
        .setBackgroundColor('#e0f2fe')
        .editAsText().setFontSize(9).setBold(true).setForegroundColor('#003366');
    });
    const rCoordVal = tCoord.appendTableRow();
    [datosTest.latitud, datosTest.longitud, '—', '—'].forEach(function(v) {
      rCoordVal.appendTableCell(v || '—')
        .editAsText().setFontSize(10).setForegroundColor('#1d4ed8').setBold(false);
    });

    // ── OBSERVACIONES ────────────────────────────────────────────────
    const encObs = body.appendTable([['OBSERVACIÓN']]);
    encObs.getRow(0).getCell(0)
      .setBackgroundColor('#003366')
      .editAsText().setFontSize(9).setBold(true).setForegroundColor('#FFFFFF');
    encObs.setBorderColor('#003366');

    const tObs = body.appendTable();
    tObs.setBorderColor('#94a3b8');
    const rObsHdr = tObs.appendTableRow();
    rObsHdr.appendTableCell('Observación: ☑ SI   ☐ NO')
      .editAsText().setFontSize(9).setBold(true);
    const rObsText = tObs.appendTableRow();
    rObsText.appendTableCell(datosTest.observaciones)
      .editAsText().setFontSize(10).setItalic(true).setForegroundColor('#374151');
    const rObsTipo = tObs.appendTableRow();
    rObsTipo.appendTableCell(
      'TIPO OBSERVACIÓN:  ☐ EXTRACCION  ☐ DESNATURALIZACION  ☐ ALMACENAMIENTO  ☑ ESTRUCTURA  ☐ FONDEO  ☐ OTRO'
    ).editAsText().setFontSize(9).setForegroundColor('#374151');

    // ── FIRMAS ────────────────────────────────────────────────────────
    body.appendParagraph('').editAsText().setFontSize(6);
    const tFirmas = body.appendTable();
    tFirmas.setBorderWidth(0);
    const rFirma = tFirmas.appendTableRow();

    const cFirmaCert = rFirma.appendTableCell('');
    cFirmaCert.appendParagraph('\n\n\n')  // espacio firma
      .editAsText().setFontSize(8);
    cFirmaCert.appendParagraph('___________________________________')
      .editAsText().setFontSize(10).setForegroundColor('#94a3b8');
    cFirmaCert.appendParagraph(datosTest.nombreCertificador)
      .editAsText().setFontSize(10).setBold(true).setForegroundColor('#1e293b');
    cFirmaCert.appendParagraph('CERTIFICADOR')
      .editAsText().setFontSize(9).setForegroundColor('#64748b');
    cFirmaCert.appendParagraph(datosTest.rutCertificador)
      .editAsText().setFontSize(9).setForegroundColor('#64748b');

    const cFirmaResp = rFirma.appendTableCell('');
    cFirmaResp.appendParagraph('\n\n\n')
      .editAsText().setFontSize(8);
    cFirmaResp.appendParagraph('___________________________________')
      .editAsText().setFontSize(10).setForegroundColor('#94a3b8');
    cFirmaResp.appendParagraph(datosTest.nombreResponsable)
      .editAsText().setFontSize(10).setBold(true).setForegroundColor('#1e293b');
    cFirmaResp.appendParagraph('Firma Responsable Centro de Cultivo')
      .editAsText().setFontSize(9).setForegroundColor('#64748b');
    cFirmaResp.appendParagraph(datosTest.emailDestinatario)
      .editAsText().setFontSize(9).setForegroundColor('#64748b').setItalic(true);

    // ── DISCLAIMER ────────────────────────────────────────────────────
    body.appendParagraph('').editAsText().setFontSize(4);
    const discP = body.appendParagraph(
      'El presente Registro de Visita es emitido por ' + datosTest.nombreCertificador +
      ', profesional acreditado inscrito en el Registro de Certificadores DS N°15 de Sernapesca, ' +
      'certificando la revisión documental y verificación en terreno del establecimiento conforme a la normativa vigente. ' +
      '— DOCUMENTO DE PRUEBA, NO VÁLIDO —'
    );
    discP.editAsText().setFontSize(8).setItalic(true).setForegroundColor('#374151');
    discP.setSpacingBefore(6);

    doc.saveAndClose();

    pdfBlob = DriveApp.getFileById(pdfDocId)
                .getAs('application/pdf')
                .setName('CertimarRV_' + datosTest.nroRegistro + '_TEST.pdf');
    ok('PDF de prueba generado — ' + pdfBlob.getBytes().length + ' bytes');
  } catch(e) {
    err('Generación PDF de prueba falló: ' + e);
  } finally {
    // Eliminar Doc temporal independiente del resultado
    if (pdfDocId) {
      try { DriveApp.getFileById(pdfDocId).setTrashed(true); } catch(_) {}
    }
  }

  // —— 4b. Enviar correo de prueba (con PDF adjunto si se generó) ——
  try {
    const ahora  = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm');
    const asunto = '[TEST Certimar] ' + datosTest.nroRegistro + ' — Verificación de formato — ' + ahora;
    const urlFake = 'https://drive.google.com/file/d/TEST_FILE_ID/view';
    const html   = _plantillaEmail(datosTest, urlFake);
    const opts   = {
      htmlBody  : html,
      replyTo   : EMAIL_REMITENTE,
      name      : 'Certimar SpA [TEST]'
    };
    if (pdfBlob) opts.attachments = [pdfBlob];
    GmailApp.sendEmail(EMAIL_TEST, asunto, 'Este correo es una prueba automática de Certimar RV.', opts);
    ok('Correo de prueba enviado a: ' + EMAIL_TEST + (pdfBlob ? ' (con PDF adjunto)' : ' (sin PDF — ver error anterior)'));
  } catch(e) {
    err('GmailApp.sendEmail() falló: ' + e);
  }

  // —— 5. Verificar cuota de correo ——
  try {
    const cuota = MailApp.getRemainingDailyQuota();
    if (cuota < 10) {
      err('Cuota diaria de Gmail casi agotada: ' + cuota + ' correos restantes');
    } else {
      ok('Cuota diaria Gmail: ' + cuota + ' correos restantes');
    }
  } catch(e) {
    err('No se pudo verificar cuota Gmail: ' + e);
  }

  // —— 6. Verificar conexión con Spreadsheet ——
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      err('Hoja "' + SHEET_NAME + '" no encontrada en el Spreadsheet');
    } else {
      const lastRow = sheet.getLastRow();
      ok('Sheets OK — hoja "' + SHEET_NAME + '" tiene ' + Math.max(0, lastRow - 1) + ' registros');
      // Verificar encabezados columnas clave
      const headers = sheet.getRange(1, 1, 1, 18).getValues()[0];
      const colMap  = { 'Correo responsable': 16, 'Hipervínculo al certificado': 17, 'Estado': 18 };
      Object.entries(colMap).forEach(function([nombre, col]) {
        const actual = String(headers[col - 1] || '').trim();
        if (actual) {
          ok('Col ' + col + ' (' + nombre + '): "' + actual + '"');
        } else {
          err('Col ' + col + ' (' + nombre + '): encabezado vacío — posible desalineación');
        }
      });
    }
  } catch(e) {
    err('Spreadsheet error: ' + e);
  }

  // —— 7. Verificar Drive folder ——
  try {
    const folder = _obtenerCarpetaDrive();
    ok('Drive folder OK — "' + folder.getName() + '"');
  } catch(e) {
    err('Drive folder error: ' + e);
  }

  // —— 8. Verificar constantes críticas ——
  if (!EMAIL_REMITENTE || !EMAIL_REMITENTE.includes('@')) {
    err('EMAIL_REMITENTE inválido: "' + EMAIL_REMITENTE + '"');
  } else {
    ok('EMAIL_REMITENTE: ' + EMAIL_REMITENTE);
  }
  if (!SPREADSHEET_ID || SPREADSHEET_ID.length < 10) {
    err('SPREADSHEET_ID parece inválido');
  } else {
    ok('SPREADSHEET_ID configurado');
  }
  if (!DRIVE_FOLDER_ID || DRIVE_FOLDER_ID.length < 10) {
    err('DRIVE_FOLDER_ID parece inválido');
  } else {
    ok('DRIVE_FOLDER_ID configurado');
  }

  // —— Resumen ——
  const errores = LOG.filter(l => l.estado === 'ERROR').length;
  const exitosos = LOG.filter(l => l.estado === 'OK').length;
  Logger.log('');
  Logger.log('══════════════════════════════════════════');
  Logger.log('RESULTADO: ' + exitosos + ' OK / ' + errores + ' ERROR(ES)');
  Logger.log('══════════════════════════════════════════');

  return { resumen: exitosos + ' OK / ' + errores + ' ERROR(ES)', detalle: LOG };
}
