// ============================================================
//  CERTIMAR — Firebase Functions
//  Reemplaza el backend de Google Apps Script
// ============================================================
'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');

admin.initializeApp();
const db = admin.firestore();

// ─── Configuración ────────────────────────────────────────────────────────────
// Establecer con:
//   firebase functions:config:set \
//     mail.user="operaciones@certimar.cl" \
//     mail.pass="APP_PASSWORD_GMAIL" \
//     sheets.id="ID_DE_TU_PLANILLA" \
//     sheets.name="RV"
const cfg = () => ({
  mailUser   : (functions.config().mail  || {}).user  || 'operaciones@certimar.cl',
  mailPass   : (functions.config().mail  || {}).pass  || '',
  sheetsId   : (functions.config().sheets|| {}).id    || '1Gq_8OBd75OnSzk9e6GXtOjhs8nhL9fKrlFzs_w4MezM',
  sheetsName : (functions.config().sheets|| {}).name  || 'RV',
  timezone   : 'America/Santiago'
});

// ─── Transporte de correo (Gmail App Password) ───────────────────────────────
function getTransporter() {
  const c = cfg();
  return nodemailer.createTransport({
    service: 'gmail',
    auth   : { user: c.mailUser, pass: c.mailPass }
  });
}

// ─── Google Sheets — autenticación con Service Account ───────────────────────
function getSheetsClient() {
  const keyPath = path.join(__dirname, 'serviceAccount.json');
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      'No se encontró functions/serviceAccount.json. ' +
      'Descárgalo desde Google Cloud Console → IAM → Service Accounts.'
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes : ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildResExt(resoluciones) {
  if (!resoluciones) return '';
  const arr = [];
  if (resoluciones.cicE2)        arr.push('1821-CIC E2');
  if (resoluciones.ca)           arr.push('1821-CA');
  if (resoluciones.vs)           arr.push('1821-VS');
  if (resoluciones.res1511)      arr.push('1511');
  if (resoluciones.desinfeccion) arr.push('DESINFECCIÓN');
  return arr.join(', ');
}

function nowFormatted(timezone) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: timezone || 'America/Santiago',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date()).replace(',', '');
}

// ─── Crear encabezados si la hoja está vacía ─────────────────────────────────
async function crearEncabezadosSiNecesario(sheets, spreadsheetId, sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${sheetName}!A1:R1`
    });
    if (!res.data.values || !res.data.values.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range           : `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody     : { values: [[
          'Fecha', 'N° Registro', 'Centro', 'N° Centro', 'ACS', 'Titular',
          'Área', 'Fecha última siembra', 'Tamaño peces', 'Ubicación',
          'Lat Long', 'Res ext', 'Observaciones', 'Tipo de observación',
          'Nombre responsable', 'Correo responsable', 'Hipervínculo al certificado',
          'Estado'
        ]] }
      });
      functions.logger.info('Encabezados creados en hoja:', sheetName);
    }
  } catch (e) {
    functions.logger.warn('crearEncabezados error (no fatal):', e.message);
  }
}

// ─── Escribir fila en Google Sheets ──────────────────────────────────────────
async function appendRowSheets(datos, urlCertificado, estado) {
  const c       = cfg();
  const sheets  = getSheetsClient();
  const { sheetsId: spreadsheetId, sheetsName: sheetName } = c;

  await crearEncabezadosSiNecesario(sheets, spreadsheetId, sheetName);

  // Verificar si ya existe (evitar duplicados)
  const colB = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${sheetName}!B:B`
  });
  const filas  = (colB.data.values || []).flat();
  const rowIdx = filas.findIndex(v => String(v).trim() === String(datos.nroRegistro).trim());

  if (rowIdx >= 1) {
    // Ya existe: actualizar URL y estado
    if (urlCertificado || estado) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range           : `${sheetName}!P${rowIdx + 1}:R${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody     : { values: [[
          datos.emailDestinatario || '',
          urlCertificado || '',
          estado || 'GUARDADO'
        ]] }
      });
    }
    return { accion: 'actualizado', fila: rowIdx + 1 };
  }

  // Insertar nueva fila
  const resExt  = buildResExt(datos.resoluciones);
  const latLong = [datos.latitud, datos.longitud].filter(Boolean).join(', ');

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range              : `${sheetName}!A1`,
    valueInputOption   : 'RAW',
    insertDataOption   : 'INSERT_ROWS',
    requestBody        : { values: [[
      nowFormatted(c.timezone),
      datos.nroRegistro       || '',
      datos.centroCultivo     || '',
      datos.nroCentro         || '',
      datos.acs               || '',
      datos.titular           || '',
      datos.area              || '',
      datos.fechaSiembra      || '',
      datos.tamanoPeces       || '',
      datos.ubicacion         || '',
      latLong,
      resExt,
      datos.observaciones     || '',
      datos.tipoObservacion   || '',
      datos.nombreResponsable || '',
      datos.emailDestinatario || '',
      urlCertificado          || '',
      estado                  || 'GUARDADO'
    ]] }
  });

  return { accion: 'insertado' };
}

// ─── Plantilla HTML del correo ────────────────────────────────────────────────
function plantillaEmail(datos, urlCert) {
  const resoluciones = buildResExt(datos.resoluciones) || '—';
  const linkBtn = urlCert
    ? `<a href="${urlCert}" style="display:inline-block;background:#003366;color:#fff;padding:13px 32px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;font-family:Arial,sans-serif">Ver Certificado →</a>`
    : '';

  const filas = [
    ['N° Registro',      `<strong style="color:#003366">${datos.nroRegistro || '—'}</strong>`],
    ['Fecha',             datos.fecha            || '—'],
    ['Centro de Cultivo', datos.centroCultivo    || '—'],
    ['N° Centro',         datos.nroCentro        || '—'],
    ['Titular',           datos.titular          || '—'],
    ['ACS',               datos.acs              || '—'],
    ['Responsable',       datos.nombreResponsable|| '—'],
    ['Tipo Observación',  datos.tipoObservacion  || '—'],
    ['Resoluciones',      resoluciones],
    ['Observaciones',     (datos.observaciones   || 'S/O').replace(/\n/g, '<br>')]
  ].map((r, i) => {
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
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
    <tr>
      <td style="background:linear-gradient(135deg,#003366 0%,#005599 50%,#003366 100%);padding:28px 32px;border-bottom:4px solid #0099CC">
        <div style="color:#ffffff;font-size:22px;font-weight:900;letter-spacing:3px;font-family:Arial,sans-serif">CERTIMAR</div>
        <div style="color:rgba(180,220,255,.85);font-size:12px;font-family:Arial,sans-serif;margin-top:3px">Sistema de Certificación — Registro de Visita</div>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 32px 16px">
        <p style="margin:0 0 12px;color:#1e293b;font-size:15px;font-family:Arial,sans-serif">
          Estimado(a) <strong>${datos.nombreResponsable || 'Responsable'}</strong>,
        </p>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.65;font-family:Arial,sans-serif">
          Adjunto encontrará el Registro de Visita oficial del centro
          <strong style="color:#003366">${datos.centroCultivo}</strong>
          con fecha <strong>${datos.fecha}</strong>, emitido por Certimar SpA.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 32px 24px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          ${filas}
        </table>
      </td>
    </tr>
    ${urlCert ? `<tr><td style="padding:4px 32px 28px;text-align:center">${linkBtn}</td></tr>` : ''}
    <tr><td style="background:#1e293b;padding:18px 32px;text-align:center">
      <p style="margin:0;color:#94a3b8;font-size:11px;font-family:Arial,sans-serif">
        Certimar SpA · operaciones@certimar.cl · +56 9 6115 6322
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 1 — registrarEnSheets
//  Llamada desde el cliente al guardar (sin enviar correo)
// ════════════════════════════════════════════════════════════════════════════
exports.registrarEnSheets = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  try {
    const { datos, urlCertificado } = data;

    if (!datos || !datos.nroRegistro) {
      throw new Error('datos.nroRegistro es requerido');
    }

    const result = await appendRowSheets(datos, urlCertificado || '', 'GUARDADO');
    functions.logger.info('registrarEnSheets OK:', datos.nroRegistro, result.accion);
    return { ok: true, accion: result.accion };

  } catch (e) {
    functions.logger.error('registrarEnSheets ERROR:', e.message);
    // No lanzar HttpsError para no bloquear el flujo — el cliente maneja el fallo
    return { ok: false, error: e.message };
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 2 — enviarNotificacion
//  Envía correo + actualiza Firestore + actualiza Sheets
// ════════════════════════════════════════════════════════════════════════════
exports.enviarNotificacion = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const { datos, urlCertificado, pdfB64 } = data;
  const destEmail = datos && datos.emailDestinatario;

  if (!destEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'Email destinatario vacío.');
  }

  const c = cfg();

  // ─── 1. Enviar correo al destinatario ──────────────────────────────────
  const asunto   = `[Certimar] Registro de Visita – ${datos.centroCultivo} – ${datos.fecha}`;
  const htmlBody = plantillaEmail(datos, urlCertificado || '');

  const mailOpts = {
    from   : `"Certimar SpA" <${c.mailUser}>`,
    to     : destEmail,
    subject: asunto,
    html   : htmlBody,
    replyTo: c.mailUser
  };

  if (datos.emailCC  && datos.emailCC.trim())  mailOpts.cc  = datos.emailCC.trim();
  if (datos.emailCCO && datos.emailCCO.trim()) mailOpts.bcc = datos.emailCCO.trim();

  // Adjuntar PDF si viene en base64
  if (pdfB64) {
    const raw = pdfB64.replace(/^data:application\/pdf;base64,/, '');
    mailOpts.attachments = [{
      filename   : `CertimarRV_${datos.nroRegistro}_${(datos.centroCultivo||'').replace(/[^a-zA-Z0-9]/g,'_')}.pdf`,
      content    : Buffer.from(raw, 'base64'),
      contentType: 'application/pdf'
    }];
  }

  const transporter = getTransporter();
  await transporter.sendMail(mailOpts);
  functions.logger.info('Correo enviado a:', destEmail, '| Registro:', datos.nroRegistro);

  // Copia interna al certificador (sin PDF para no duplicar adjunto)
  const certEmail = context.auth.token.email;
  if (certEmail && certEmail !== destEmail) {
    try {
      await transporter.sendMail({
        from   : mailOpts.from,
        to     : certEmail,
        subject: `[COPIA INTERNA] ${asunto}`,
        html   : htmlBody
      });
    } catch (eCopia) {
      functions.logger.warn('Copia interna error (no fatal):', eCopia.message);
    }
  }

  // ─── 2. Actualizar estado en Firestore ─────────────────────────────────
  try {
    await db.collection('registros_visita').doc(datos.nroRegistro).update({
      estado          : 'ENVIADO',
      emailResponsable: destEmail
    });
  } catch (eFs) {
    functions.logger.warn('Firestore update ENVIADO error (no fatal):', eFs.message);
  }

  // ─── 3. Actualizar estado y email en Google Sheets ─────────────────────
  try {
    const sheets = getSheetsClient();
    const { sheetsId: spreadsheetId, sheetsName: sheetName } = c;

    const colB   = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${sheetName}!B:B`
    });
    const filas  = (colB.data.values || []).flat();
    const rowIdx = filas.findIndex(v => String(v).trim() === String(datos.nroRegistro).trim());

    if (rowIdx >= 1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range           : `${sheetName}!P${rowIdx + 1}:R${rowIdx + 1}`,
        valueInputOption: 'RAW',
        requestBody     : { values: [[destEmail, urlCertificado || '', 'ENVIADO']] }
      });
      functions.logger.info('Sheets actualizado ENVIADO, fila:', rowIdx + 1);
    } else {
      // Si no existe la fila aún (raro), insertarla
      await appendRowSheets(datos, urlCertificado || '', 'ENVIADO');
    }
  } catch (eSh) {
    functions.logger.warn('Sheets actualizar ENVIADO error (no fatal):', eSh.message);
  }

  return { ok: true };
});
