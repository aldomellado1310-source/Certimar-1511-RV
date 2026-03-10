// ============================================================
//  CERTIMAR — Sistema de Registro de Visitas
//  Google Apps Script Backend
// ============================================================

const SPREADSHEET_ID  = '1Gq_8OBd75OnSzk9e6GXtOjhs8nhL9fKrlFzs_w4MezM';
const SHEET_NAME      = 'RV';
const DRIVE_FOLDER_ID = '1RmNcnVq0bBumlwA0KlgL9PIrIB8mQrFk';
const EMAIL_REMITENTE = 'operaciones@certimar.cl';
const TIMEZONE        = 'America/Santiago';

// ============================================================
//  ROUTER
// ============================================================
function doGet(e) {
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
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  const last  = Math.max(sheet.getLastRow(), 1);
  const year  = new Date().getFullYear();
  return 'RV-' + year + '-' + String(last).padStart(4, '0');
}

// ============================================================
//  GUARDAR + ENVIAR EN UNA SOLA LLAMADA  ← nueva función optimizada
//  Combina Drive upload, Sheets write y envío de correo en un viaje.
//  @param {Object} datos
//  @param {string|null} pdfB64
//  @param {string|null} fotoB64
//  @param {string|null} emailDestinatario  – si null, no envía correo
// ============================================================
function guardarYEnviar(datos, pdfB64, fotoB64, emailDestinatario) {
  const resultado = { ok: false, steps: {} };
  try {
    // — Obtener sheet una sola vez —
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet   = ss.getSheetByName(SHEET_NAME);
    if (!sheet) { sheet = ss.insertSheet(SHEET_NAME); _crearEncabezados(sheet); }
    if (sheet.getLastRow() === 0) _crearEncabezados(sheet);

    // — 1. PDF a Drive (operación más lenta, hacemos primero) —
    let urlCertificado = '';
    if (pdfB64) {
      try {
        urlCertificado = _subirPDFDrive(pdfB64, datos.nroRegistro, datos.centroCultivo);
        resultado.steps.pdf = 'ok';
      } catch(e) {
        resultado.steps.pdf = 'error: ' + e.message;
        // No es fatal — continuamos sin URL
      }
    }

    // — 2. Foto a Drive (solo si viene; la omitimos del flujo principal para velocidad) —
    let urlFoto = '';
    if (fotoB64 && !fotoB64.startsWith('data:application/pdf')) {
      try {
        urlFoto = _subirFotoDrive(fotoB64, datos.nroRegistro);
        resultado.steps.foto = 'ok';
      } catch(e) {
        resultado.steps.foto = 'error: ' + e.message;
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
      'GUARDADO'   // R – Estado (se actualiza a ENVIADO si hay correo)
    ]);
    SpreadsheetApp.flush();  // Asegurar escritura inmediata
    resultado.steps.sheets = 'ok';

    // — 4. Correo (si se solicitó) — reutilizamos el mismo blob de PDF —
    let emailEnviado = false;
    const destEmail = emailDestinatario || datos.emailDestinatario;
    if (destEmail) {
      try {
        const asunto   = '[Certimar] Registro de Visita – ' + datos.centroCultivo + ' – ' + datos.fecha;
        const htmlBody = _plantillaEmail(datos, urlCertificado);
        const opciones = { htmlBody, replyTo: EMAIL_REMITENTE, name: 'Certimar SpA' };

        // CC y CCO
        if (datos.emailCC  && datos.emailCC.trim())  opciones.cc  = datos.emailCC.trim();
        if (datos.emailCCO && datos.emailCCO.trim())  opciones.bcc = datos.emailCCO.trim();

        if (pdfB64) {
          const raw  = pdfB64.replace(/^data:application\/pdf;base64,/, '');
          const nombre = 'CertimarRV_' + datos.nroRegistro + '_' + datos.centroCultivo.replace(/[^a-zA-Z0-9]/g,'_') + '.pdf';
          const blob = Utilities.newBlob(Utilities.base64Decode(raw), 'application/pdf', nombre);
          opciones.attachments = [blob];
        }

        GmailApp.sendEmail(destEmail, asunto, '', opciones);
        emailEnviado = true;

        // Copia interna al certificador — SIN PDF adjunto para evitar doble adjunto en el hilo
        const userEmail = Session.getActiveUser().getEmail();
        if (userEmail && userEmail !== destEmail) {
          GmailApp.sendEmail(userEmail, '[COPIA INTERNA] ' + asunto, '', {
            htmlBody, replyTo: EMAIL_REMITENTE, name: 'Certimar SpA'
          });
        }
        resultado.steps.email = 'ok';
      } catch(e) {
        resultado.steps.email = 'error: ' + e.message;
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
function guardarRegistro(datos, pdfB64, fotoB64) {
  return guardarYEnviar(datos, pdfB64, fotoB64, null);
}

// ============================================================
//  ENVIAR CORREO (compatible + actualiza estado en Sheets)
// ============================================================
function enviarNotificacion(datos, urlCertificado, pdfB64) {
  try {
    const destEmail = datos.emailDestinatario;
    if (!destEmail) return { ok: false, error: 'Email destinatario vacío' };
    const asunto   = '[Certimar] Registro de Visita – ' + datos.centroCultivo + ' – ' + datos.fecha;
    const htmlBody = _plantillaEmail(datos, urlCertificado || '');
    const opciones = { htmlBody, replyTo: EMAIL_REMITENTE, name: 'Certimar SpA' };
    if (datos.emailCC  && datos.emailCC.trim())  opciones.cc  = datos.emailCC.trim();
    if (datos.emailCCO && datos.emailCCO.trim()) opciones.bcc = datos.emailCCO.trim();
    if (pdfB64) {
      const raw  = pdfB64.replace(/^data:application\/pdf;base64,/, '');
      const nombre = 'CertimarRV_' + datos.nroRegistro + '_' + datos.centroCultivo.replace(/[^a-zA-Z0-9]/g,'_') + '.pdf';
      const blob = Utilities.newBlob(Utilities.base64Decode(raw), 'application/pdf', nombre);
      opciones.attachments = [blob];
    }
    GmailApp.sendEmail(destEmail, asunto, '', opciones);

    // Copia interna al certificador — SIN PDF adjunto (ya tiene acceso en Drive)
    // Esto evita que el hilo muestre "2 archivos adjuntos" al destinatario
    const userEmail = Session.getActiveUser().getEmail();
    if (userEmail && userEmail !== destEmail) {
      GmailApp.sendEmail(userEmail, '[COPIA INTERNA] ' + asunto, '', {
        htmlBody, replyTo: EMAIL_REMITENTE, name: 'Certimar SpA'
      });
    }

    // Actualizar estado en Sheets si el registro ya existe
    try {
      const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_NAME);
      if (sheet && sheet.getLastRow() >= 2) {
        const nros = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
        for (let i = 0; i < nros.length; i++) {
          if (String(nros[i][0]).trim() === datos.nroRegistro) {
            sheet.getRange(i + 2, 18).setValue('ENVIADO');
            SpreadsheetApp.flush();
            break;
          }
        }
      }
    } catch(e) { /* No bloquear si falla la actualización de estado */ }

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

    // Leer hasta columna R (18) para incluir estado
    const numCols  = Math.min(sheet.getLastColumn(), 18);
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
        estado      : numCols >= 18 ? String(r[17] || 'GUARDADO') : 'GUARDADO'
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
    'Estado'
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

function _subirPDFDrive(base64, nroRegistro, centro) {
  const datos  = base64.replace(/^data:application\/pdf;base64,/, '');
  const bytes  = Utilities.base64Decode(datos);
  const blob   = Utilities.newBlob(bytes, 'application/pdf',
                   'CertimarRV_' + nroRegistro + '_' + (centro || '').replace(/\s+/g,'_') + '.pdf');
  const folder = _obtenerCarpetaDrive();
  const file   = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function _subirFotoDrive(base64, nroRegistro) {
  const mediaType = base64.match(/^data:([^;]+);base64,/)?.[1] || 'image/jpeg';
  const datos  = base64.replace(/^data:[^;]+;base64,/, '');
  const bytes  = Utilities.base64Decode(datos);
  const ext    = mediaType.split('/')[1] || 'jpg';
  const blob   = Utilities.newBlob(bytes, mediaType, 'Foto_' + nroRegistro + '.' + ext);
  const folder = _obtenerCarpetaDrive();
  const file   = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function _plantillaEmail(datos, urlCert) {
  // ---- sin emojis: algunos clientes de correo los corrompen ----
  const linkBtn = urlCert
    ? `<a href="${urlCert}" style="display:inline-block;background:#003366;color:#ffffff;padding:13px 32px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;margin-top:8px;letter-spacing:.5px;font-family:Arial,sans-serif">Ver Certificado en Drive &rarr;</a>`
    : '';

  const resoluciones = [];
  if (datos.resoluciones) {
    if (datos.resoluciones.cicE2)        resoluciones.push('1821&#8209;CIC E2');
    if (datos.resoluciones.ca)           resoluciones.push('1821&#8209;CA');
    if (datos.resoluciones.vs)           resoluciones.push('1821&#8209;VS');
    if (datos.resoluciones.res1511)      resoluciones.push('1511');
    if (datos.resoluciones.desinfeccion) resoluciones.push('DESINFECCI&Oacute;N');
  }
  const resStr = resoluciones.length ? resoluciones.join(', ') : '&#8212;';

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
}
