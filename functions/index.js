// ============================================================
//  CERTIMAR — Firebase Functions  (sin Google Sheets / Drive)
// ============================================================
'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// ─── Configuración ────────────────────────────────────────────────────────────
const cfg = () => ({
  mailUser: (functions.config().mail || {}).user || 'operaciones@certimar.cl',
  mailPass: (functions.config().mail || {}).pass || '',
  timezone: 'America/Santiago'
});

// ─── Transporte de correo ─────────────────────────────────────────────────────
function getTransporter() {
  const c = cfg();
  return nodemailer.createTransport({
    service: 'gmail',
    auth   : { user: c.mailUser, pass: c.mailPass }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Plantilla HTML del correo ────────────────────────────────────────────────
function plantillaEmail(datos, urlCert) {
  const resoluciones = buildResExt(datos.resoluciones) || '—';
  const linkBtn = urlCert
    ? `<a href="${urlCert}" style="display:inline-block;background:#003366;color:#fff;padding:13px 32px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;font-family:Arial,sans-serif">Ver Certificado →</a>`
    : '';

  const filas = [
    ['N° Registro',          `<strong style="color:#003366">${datos.nroRegistro || '—'}</strong>`],
    ['Fecha',                 datos.fecha                     || '—'],
    ['Centro de Cultivo',     datos.centroCultivo             || '—'],
    ['N° Centro',             datos.nroCentro                 || '—'],
    ['ACS',                   datos.acs                       || '—'],
    ['Titular',               datos.titular                   || '—'],
    ['Ubicación',             datos.ubicacion                 || '—'],
    ['Región',                datos.region                    || '—'],
    ['Sector',                datos.sector                    || '—'],
    ['Fecha última siembra',  datos.fechaSiembra              || '—'],
    ['Tamaño peces',          datos.tamanoPeces               || '—'],
    ['Largo jaula (m)',       datos.jaulasLargo               || '—'],
    ['Ancho jaula (m)',       datos.jaulasAncho               || '—'],
    ['Cantidad jaulas',       datos.cantidadJaulas            || '—'],
    ['Jaulas sembradas',      datos.cantidadJaulasSembradas   || '—'],
    ['A/N Ensilaje',          datos.artefactoNaval            || '—'],
    ['Norma aplicable',       resoluciones],
    ['Latitud S',             datos.latitud                   || '—'],
    ['Longitud W',            datos.longitud                  || '—'],
    ['Norte',                 datos.norte                     || '—'],
    ['Este',                  datos.este                      || '—'],
    ['Responsable',           datos.nombreResponsable         || '—'],
    ['Tipo Observación',      datos.tipoObservacion           || '—'],
    ['Observaciones',         (datos.observaciones            || 'S/O').replace(/\n/g, '<br>')],
    ['Certificador',          datos.nombreCertificador        || '—'],
    ['N° Registro Cert.',     datos.rutCertificador           || '—']
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
//  FUNCIÓN 1 — enviarNotificacion
//  Envía correo + adjunto PDF + copia interna + actualiza Firestore
// ════════════════════════════════════════════════════════════════════════════
exports.enviarNotificacion = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const { datos, urlCertificado, pdfStoragePath } = data;
  const destEmail   = datos && datos.emailDestinatario;
  const nroRegistro = datos && datos.nroRegistro;

  if (!destEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'Email destinatario vacío.');
  }
  if (!nroRegistro || /asignar/i.test(nroRegistro)) {
    throw new functions.https.HttpsError('failed-precondition',
      'El registro debe guardarse antes de enviar la notificación.');
  }
  // Verificar que el documento existe en Firestore antes de enviar el correo.
  const snap = await db.collection('registros_visita').doc(nroRegistro).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found',
      `Registro ${nroRegistro} no encontrado en Firestore.`);
  }

  const c       = cfg();
  const asunto  = `[Certimar] Registro de Visita – ${datos.centroCultivo} – ${datos.fecha}`;
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

  if (pdfStoragePath) {
    try {
      const bucket = admin.storage().bucket();
      const [pdfBuffer] = await bucket.file(pdfStoragePath).download();
      mailOpts.attachments = [{
        filename   : `CertimarRV_${datos.nroRegistro}_${(datos.centroCultivo || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        content    : pdfBuffer,
        contentType: 'application/pdf'
      }];
    } catch (ePdf) {
      functions.logger.warn('No se pudo adjuntar PDF desde Storage (no fatal):', ePdf.message);
    }
  }

  const transporter = getTransporter();
  await transporter.sendMail(mailOpts);
  functions.logger.info('Correo enviado a:', destEmail, '| Registro:', datos.nroRegistro);

  // Copia interna al equipo certificador (lista fija)
  const COPIAS_CERTIFICADOR = [
    'operaciones@certimar.cl',
    'eflores@certimar.cl',
    'informes@certimar.cl'
  ];
  const destLower = (destEmail || '').toLowerCase();
  const copias = COPIAS_CERTIFICADOR.filter(e => e.toLowerCase() !== destLower);
  if (copias.length) {
    try {
      await transporter.sendMail({
        from       : mailOpts.from,
        to         : copias.join(', '),
        subject    : `[COPIA INTERNA] ${asunto}`,
        html       : htmlBody,
        attachments: mailOpts.attachments || []
      });
    } catch (eCopia) {
      functions.logger.warn('Copia interna error (no fatal):', eCopia.message);
    }
  }

  // Actualizar estado en Firestore
  try {
    await db.collection('registros_visita').doc(datos.nroRegistro).update({
      estado          : 'ENVIADO',
      emailResponsable: destEmail
    });
  } catch (eFs) {
    functions.logger.warn('Firestore update error (no fatal):', eFs.message);
  }

  return { ok: true };
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 2 — generarLinkFirma
//  Genera token UUID y retorna URL de firma para el cliente
// ════════════════════════════════════════════════════════════════════════════
exports.generarLinkFirma = functions
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const { nro } = data;
  if (!nro) {
    throw new functions.https.HttpsError('invalid-argument', 'nro es requerido.');
  }

  const token = crypto.randomUUID();

  await db.collection('registros_visita').doc(nro).update({
    tokenFirma : token,
    estadoFirma: 'PENDIENTE'
  });

  const projectId = process.env.GCLOUD_PROJECT || 'certimar-rv';
  const url = `https://${projectId}.web.app/firma?nro=${encodeURIComponent(nro)}&token=${encodeURIComponent(token)}`;

  functions.logger.info('generarLinkFirma OK:', nro);
  return { ok: true, url };
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 3 — procesarFirmaCliente
//  Verifica token, sube firma a Storage y actualiza Firestore
// ════════════════════════════════════════════════════════════════════════════
exports.procesarFirmaCliente = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {

  const { nro, firmaB64, token } = data;
  if (!nro || !firmaB64 || !token) {
    throw new functions.https.HttpsError('invalid-argument', 'nro, firmaB64 y token son requeridos.');
  }

  const docRef  = db.collection('registros_visita').doc(nro);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Registro no encontrado.');
  }
  if (docSnap.data().tokenFirma !== token) {
    throw new functions.https.HttpsError('permission-denied', 'Token de firma inválido.');
  }

  const bucket   = admin.storage().bucket();
  const rawB64   = firmaB64.replace(/^data:image\/\w+;base64,/, '');
  const buffer   = Buffer.from(rawB64, 'base64');
  const filePath = `firmas/Firma_${nro}.png`;
  const file     = bucket.file(filePath);

  await file.save(buffer, { contentType: 'image/png', public: false });
  const [url] = await file.getSignedUrl({ action: 'read', expires: '2099-01-01' });

  await docRef.update({
    urlFirmaCliente: url,
    estadoFirma    : 'FIRMADO',
    tokenFirma     : ''
  });

  functions.logger.info('procesarFirmaCliente OK:', nro);
  return { ok: true, urlFirmaCliente: url };
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 4 — migrarPDFsDrive  (TEMPORAL — eliminar post-migración)
//  Descarga PDFs de URL pública y los sube a Firebase Storage
// ════════════════════════════════════════════════════════════════════════════
exports.migrarPDFsDrive = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const { registros } = data;
  if (!Array.isArray(registros) || !registros.length) {
    throw new functions.https.HttpsError('invalid-argument', 'registros debe ser un arreglo no vacío.');
  }

  const bucket  = admin.storage().bucket();
  const results = [];

  for (const r of registros) {
    const { nro, urlCertificado } = r;
    if (!nro || !urlCertificado) {
      results.push({ nro, ok: false, error: 'nro o urlCertificado faltante' });
      continue;
    }
    try {
      const resp = await fetch(urlCertificado);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer   = Buffer.from(await resp.arrayBuffer());
      const filePath = `certificados/CertimarRV_${nro}.pdf`;
      const file     = bucket.file(filePath);
      await file.save(buffer, { contentType: 'application/pdf', public: false });
      const [downloadURL] = await file.getSignedUrl({ action: 'read', expires: '2099-01-01' });
      await db.collection('registros_visita').doc(nro).update({ urlPdfStorage: downloadURL });
      results.push({ nro, ok: true, urlPdfStorage: downloadURL });
    } catch (e) {
      functions.logger.warn('migrarPDFsDrive ERROR:', nro, e.message);
      results.push({ nro, ok: false, error: e.message });
    }
  }

  return { ok: true, results };
});
