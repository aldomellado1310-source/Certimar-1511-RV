// ============================================================
//  CERTIMAR — Firebase Functions  (sin Google Sheets / Drive)
//  Envío de correos: OAuth2 + Gmail API (per-user refresh token)
// ============================================================
'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const { google } = require('googleapis');

admin.initializeApp();
const db = admin.firestore();

// ─── Configuración OAuth Gmail ────────────────────────────────────────────────
// Cada certificador conecta una sola vez su cuenta Gmail desde la app y la
// refresh_token resultante se persiste en `users_gmail/{uid}`. A partir de
// ahí los correos salen "as" la cuenta del certificador, sin almacenar
// passwords en ninguna parte.
//
// Setup en Google Cloud Console (proyecto = certimar-rv):
//   1. APIs & Services → OAuth consent screen → Internal o External
//   2. APIs & Services → Library → habilitar "Gmail API"
//   3. APIs & Services → Credentials → Create OAuth Client ID
//        - Type: Web application
//        - Authorized JavaScript origins: https://certimar-rv.web.app
//          (y http://localhost:5000 para emulator)
//        - Authorized redirect URIs:     https://certimar-rv.web.app/oauth-callback.html
//          (y http://localhost:5000/oauth-callback.html para emulator)
//        - Scopes: gmail.send, userinfo.email
//   4. Copiar Client ID + Client Secret a `functions/.env`:
//        GMAIL_OAUTH_CLIENT_ID=...
//        GMAIL_OAUTH_CLIENT_SECRET=...
//      El client_id es público (lo expone el frontend); solo el secret debe
//      mantenerse server-side.
const oauthCfg = () => ({
  clientId    : process.env.GMAIL_OAUTH_CLIENT_ID     || '',
  clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET || ''
});

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email'
];

// Log de arranque — útil tras cada redeploy para confirmar versiones y
// presencia (no contenido) de credenciales OAuth.
try {
  const oc = oauthCfg();
  functions.logger.info('[boot] Certimar Functions cargadas', {
    node            : process.version,
    firebaseFnsVer  : require('firebase-functions/package.json').version,
    googleapisVer   : require('googleapis/package.json').version,
    nodemailerVer   : require('nodemailer/package.json').version,
    oauthClientId   : oc.clientId ? oc.clientId.slice(0, 16) + '…' : '(MISSING)',
    oauthSecretLen  : (oc.clientSecret || '').length,
    gcloudProject   : process.env.GCLOUD_PROJECT || '(no GCLOUD_PROJECT)'
  });
} catch (eBoot) {
  functions.logger.error('[boot] Error inspeccionando config:', eBoot.message);
}

function newOAuthClient(redirectUri) {
  const oc = oauthCfg();
  if (!oc.clientId || !oc.clientSecret) {
    throw new functions.https.HttpsError('failed-precondition',
      'Credenciales OAuth Gmail no configuradas en el servidor (GMAIL_OAUTH_CLIENT_ID / SECRET).');
  }
  return new google.auth.OAuth2(oc.clientId, oc.clientSecret, redirectUri || undefined);
}

// ─── Persistencia de tokens por usuario ───────────────────────────────────────
// Documento `users_gmail/{uid}`:
//   { email, refreshToken, scopes, connectedAt, updatedAt }
// Las reglas de Firestore deniegan acceso de cliente — solo Cloud Functions
// (admin SDK) puede leer/escribir.
async function saveUserTokens(uid, email, refreshToken, scopes) {
  await db.collection('users_gmail').doc(uid).set({
    email,
    refreshToken,
    scopes,
    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt  : admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function getUserTokens(uid) {
  const snap = await db.collection('users_gmail').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function deleteUserTokens(uid) {
  await db.collection('users_gmail').doc(uid).delete();
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────
// Evita que un input con `<`, `>`, `&`, `"` o `'` rompa el markup del correo.
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Valida que la URL sea http/https antes de usarla en un href.
function safeUrl(u) {
  if (!u) return '';
  const s = String(u);
  return /^https?:\/\//i.test(s) ? s : '';
}

// ─── RFC822 build + Gmail API send ───────────────────────────────────────────
// Usa nodemailer en modo streamTransport para construir el mensaje completo
// (headers, MIME, attachments, encoding) y luego lo entrega a Gmail API como
// `raw` base64url. Así no hay SMTP ni passwords en juego.
const _rfcBuilder = nodemailer.createTransport({
  streamTransport: true,
  buffer         : true,
  newline        : 'unix'
});

function buildRawRfc822(mailOpts) {
  return new Promise((resolve, reject) => {
    _rfcBuilder.sendMail(mailOpts, (err, info) => {
      if (err) return reject(err);
      resolve(info.message);
    });
  });
}

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaGmailApi(oauth2, mailOpts) {
  const raw = toBase64Url(await buildRawRfc822(mailOpts));
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const resp = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });
  return resp.data;
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
  const resoluciones = esc(buildResExt(datos.resoluciones)) || '—';
  const urlCertSafe  = safeUrl(urlCert);
  const linkBtn = urlCertSafe
    ? `<a href="${esc(urlCertSafe)}" style="display:inline-block;background:#003366;color:#fff;padding:13px 32px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;font-family:Arial,sans-serif">Ver Certificado →</a>`
    : '';

  // Observaciones: escapar primero, luego convertir \n en <br>.
  const obsHtml = esc(datos.observaciones || 'S/O').replace(/\n/g, '<br>');

  const filas = [
    ['N° Registro',      `<strong style="color:#003366">${esc(datos.nroRegistro) || '—'}</strong>`],
    ['Fecha',             esc(datos.fecha)            || '—'],
    ['Centro de Cultivo', esc(datos.centroCultivo)    || '—'],
    ['N° Centro',         esc(datos.nroCentro)        || '—'],
    ['Titular',           esc(datos.titular)          || '—'],
    ['ACS',               esc(datos.acs)              || '—'],
    ['Responsable',       esc(datos.nombreResponsable)|| '—'],
    ['Tipo Observación',  esc(datos.tipoObservacion)  || '—'],
    ['Resoluciones',      resoluciones],
    ['Observaciones',     obsHtml],
    ['Certificador',      esc(datos.nombreCertificador) || '—'],
    ['N° Registro Cert.', esc(datos.rutCertificador)    || '—']
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
          Estimado(a) <strong>${esc(datos.nombreResponsable) || 'Responsable'}</strong>,
        </p>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.65;font-family:Arial,sans-serif">
          Adjunto encontrará el Registro de Visita oficial del centro
          <strong style="color:#003366">${esc(datos.centroCultivo)}</strong>
          con fecha <strong>${esc(datos.fecha)}</strong>, emitido por Certimar SpA.
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
    ${urlCertSafe ? `<tr><td style="padding:4px 32px 28px;text-align:center">${linkBtn}</td></tr>` : ''}
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

  const uid = context.auth && context.auth.uid;
  functions.logger.info('[enviarNotificacion] BEGIN', {
    uid,
    nroRegistro    : data && data.datos && data.datos.nroRegistro,
    dest           : data && data.datos && data.datos.emailDestinatario,
    centroCultivo  : data && data.datos && data.datos.centroCultivo,
    fecha          : data && data.datos && data.datos.fecha,
    pdfStoragePath : data && data.pdfStoragePath,
    hasUrlCert     : !!(data && data.urlCertificado)
  });

  // Paso 1/6 — autenticación
  if (!context.auth) {
    functions.logger.warn('[enviarNotificacion] paso 1/6 FAIL: no auth context');
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  functions.logger.info('[enviarNotificacion] paso 1/6 OK: auth=' + uid);

  const { datos, urlCertificado, pdfStoragePath } = data;
  const destEmail   = datos && datos.emailDestinatario;
  const nroRegistro = datos && datos.nroRegistro;

  // Paso 2/6 — validación de inputs
  if (!destEmail) {
    functions.logger.warn('[enviarNotificacion] paso 2/6 FAIL: destEmail vacío');
    throw new functions.https.HttpsError('invalid-argument', 'Email destinatario vacío.');
  }
  if (!nroRegistro || /asignar/i.test(nroRegistro)) {
    functions.logger.warn('[enviarNotificacion] paso 2/6 FAIL: nroRegistro inválido', { nroRegistro });
    throw new functions.https.HttpsError('failed-precondition',
      'El registro debe guardarse antes de enviar la notificación.');
  }
  functions.logger.info('[enviarNotificacion] paso 2/6 OK: inputs válidos');

  // Paso 3/6 — token OAuth Gmail del usuario
  const userTokens = await getUserTokens(uid);
  if (!userTokens || !userTokens.refreshToken) {
    functions.logger.warn('[enviarNotificacion] paso 3/6 FAIL: usuario no tiene Gmail conectado', { uid });
    throw new functions.https.HttpsError('failed-precondition',
      'Conecta tu cuenta de Gmail antes de enviar correos. (Botón "Conectar Gmail" en el modal)');
  }
  const fromEmail = userTokens.email;
  functions.logger.info('[enviarNotificacion] paso 3/6 OK: refresh_token disponible', {
    uid, fromEmail, scopes: userTokens.scopes
  });

  let oauth2;
  try {
    oauth2 = newOAuthClient();
    oauth2.setCredentials({ refresh_token: userTokens.refreshToken });
    // Forzar refresh inmediato para detectar token revocado AHORA, no en mitad del envío.
    await oauth2.getAccessToken();
  } catch (eRefresh) {
    const status = eRefresh.response && eRefresh.response.status;
    const body   = eRefresh.response && eRefresh.response.data;
    functions.logger.error('[enviarNotificacion] paso 3/6 FAIL: refresh access_token', {
      uid, status, body, message: eRefresh.message
    });
    // 400 invalid_grant = token revocado o expirado → limpiar y pedir reconexión.
    if (status === 400 || status === 401) {
      await deleteUserTokens(uid).catch(() => {});
      throw new functions.https.HttpsError('failed-precondition',
        'La autorización de Gmail fue revocada o expiró. Vuelve a conectar tu cuenta.');
    }
    throw new functions.https.HttpsError('internal',
      'Error refrescando token Gmail: ' + eRefresh.message);
  }

  // Paso 4/6 — verificar que el documento existe en Firestore antes de enviar
  let snap;
  try {
    snap = await db.collection('registros_visita').doc(nroRegistro).get();
  } catch (eFs) {
    functions.logger.error('[enviarNotificacion] paso 4/6 FAIL: error consultando Firestore', {
      nroRegistro, code: eFs.code, message: eFs.message
    });
    throw new functions.https.HttpsError('internal',
      'Error consultando Firestore: ' + eFs.message);
  }
  if (!snap.exists) {
    functions.logger.warn('[enviarNotificacion] paso 4/6 FAIL: registro no existe', { nroRegistro });
    throw new functions.https.HttpsError('not-found',
      `Registro ${nroRegistro} no encontrado en Firestore.`);
  }
  functions.logger.info('[enviarNotificacion] paso 4/6 OK: registro existe');

  const asunto   = `[Certimar] Registro de Visita – ${datos.centroCultivo} – ${datos.fecha}`;
  const htmlBody = plantillaEmail(datos, urlCertificado || '');

  // Gmail API exige que el From sea la cuenta autenticada (o un alias verificado).
  const mailOpts = {
    from   : `"Certimar SpA" <${fromEmail}>`,
    to     : destEmail,
    subject: asunto,
    html   : htmlBody,
    replyTo: fromEmail
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
      functions.logger.info('[enviarNotificacion] PDF adjuntado', {
        path: pdfStoragePath, sizeBytes: pdfBuffer.length
      });
    } catch (ePdf) {
      functions.logger.warn('[enviarNotificacion] No se pudo adjuntar PDF (no fatal)', {
        path: pdfStoragePath, code: ePdf.code, message: ePdf.message
      });
    }
  }

  // Paso 5/6 — envío principal vía Gmail API
  try {
    const info = await sendViaGmailApi(oauth2, mailOpts);
    functions.logger.info('[enviarNotificacion] paso 5/6 OK: correo enviado', {
      dest: destEmail, messageId: info && info.id, threadId: info && info.threadId
    });
  } catch (eSend) {
    const status = eSend.response && eSend.response.status;
    const body   = eSend.response && eSend.response.data;
    functions.logger.error('[enviarNotificacion] paso 5/6 FAIL: Gmail API send', {
      dest: destEmail, status, body, code: eSend.code, message: eSend.message, stack: eSend.stack
    });
    if (status === 401 || status === 403) {
      throw new functions.https.HttpsError('failed-precondition',
        'Gmail rechazó la autorización (' + status + '). Reconecta tu cuenta.');
    }
    throw new functions.https.HttpsError('internal',
      'Error enviando correo (Gmail API): ' + eSend.message);
  }

  // Paso 6a — copia interna al equipo certificador (no fatal)
  const COPIAS_CERTIFICADOR = [
    'operaciones@certimar.cl',
    'eflores@certimar.cl',
    'informes@certimar.cl'
  ];
  const destLower = (destEmail || '').toLowerCase();
  const fromLower = (fromEmail || '').toLowerCase();
  const copias = COPIAS_CERTIFICADOR.filter(e => {
    const el = e.toLowerCase();
    return el !== destLower && el !== fromLower; // no auto-cc al certificador ni duplicar dest
  });
  if (copias.length) {
    try {
      await sendViaGmailApi(oauth2, {
        from       : mailOpts.from,
        to         : copias.join(', '),
        subject    : `[COPIA INTERNA] ${asunto}`,
        html       : htmlBody,
        attachments: mailOpts.attachments || []
      });
      functions.logger.info('[enviarNotificacion] paso 6a OK: copia interna enviada', { copias });
    } catch (eCopia) {
      functions.logger.warn('[enviarNotificacion] paso 6a FAIL (no fatal): copia interna', {
        copias, code: eCopia.code, message: eCopia.message
      });
    }
  }

  // Paso 6b — actualizar estado en Firestore (no fatal)
  try {
    await db.collection('registros_visita').doc(datos.nroRegistro).update({
      estado          : 'ENVIADO',
      emailResponsable: destEmail
    });
    functions.logger.info('[enviarNotificacion] paso 6b OK: estado actualizado a ENVIADO');
  } catch (eFs) {
    functions.logger.warn('[enviarNotificacion] paso 6b FAIL (no fatal): Firestore update', {
      nroRegistro, code: eFs.code, message: eFs.message
    });
  }

  functions.logger.info('[enviarNotificacion] END OK', { nroRegistro, dest: destEmail });
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

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 5 — obtenerConfigOAuth
//  Devuelve clientId + scopes para que el frontend arme la URL de autorización
//  (el clientId es público; el secret jamás sale del servidor).
// ════════════════════════════════════════════════════════════════════════════
exports.obtenerConfigOAuth = functions
  .runWith({ timeoutSeconds: 10, memory: '128MB' })
  .https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const oc = oauthCfg();
  if (!oc.clientId) {
    throw new functions.https.HttpsError('failed-precondition',
      'OAuth Gmail no configurado en el servidor (GMAIL_OAUTH_CLIENT_ID ausente).');
  }
  return {
    clientId: oc.clientId,
    scopes  : GMAIL_SCOPES
  };
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 6 — completarAuthGmail
//  Recibe el authorization code del frontend, lo cambia por refresh_token,
//  consulta el email del usuario y persiste todo en users_gmail/{uid}.
// ════════════════════════════════════════════════════════════════════════════
exports.completarAuthGmail = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
  const uid = context.auth && context.auth.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const { code, redirectUri } = data || {};
  if (!code || !redirectUri) {
    throw new functions.https.HttpsError('invalid-argument', 'code y redirectUri son requeridos.');
  }
  functions.logger.info('[completarAuthGmail] BEGIN', { uid, redirectUri });

  let tokens;
  try {
    const oauth2 = newOAuthClient(redirectUri);
    const r = await oauth2.getToken(code);
    tokens = r.tokens;
  } catch (e) {
    const status = e.response && e.response.status;
    const body   = e.response && e.response.data;
    functions.logger.error('[completarAuthGmail] FAIL: getToken', {
      uid, status, body, message: e.message
    });
    throw new functions.https.HttpsError('internal',
      'Google rechazó el código (' + (status || '?') + '): ' + (body && body.error_description || e.message));
  }

  if (!tokens.refresh_token) {
    // Google solo devuelve refresh_token la PRIMERA vez que el usuario autoriza
    // (o cuando se pasa prompt=consent). Si falta, normalmente es porque el
    // usuario ya había autorizado antes — toca revocar en
    // https://myaccount.google.com/permissions y reconectar.
    functions.logger.warn('[completarAuthGmail] FAIL: sin refresh_token en respuesta', {
      uid, scope: tokens.scope, hasAccess: !!tokens.access_token
    });
    throw new functions.https.HttpsError('failed-precondition',
      'Google no devolvió refresh_token. Ve a https://myaccount.google.com/permissions, ' +
      'revoca el acceso a Certimar y reconecta.');
  }

  // Obtener email del usuario autorizado.
  let email;
  try {
    const oauth2 = newOAuthClient();
    oauth2.setCredentials(tokens);
    const userinfo = await google.oauth2({ version: 'v2', auth: oauth2 }).userinfo.get();
    email = userinfo.data.email;
  } catch (e) {
    functions.logger.error('[completarAuthGmail] FAIL: userinfo', {
      uid, message: e.message
    });
    throw new functions.https.HttpsError('internal', 'Error obteniendo email del usuario: ' + e.message);
  }

  await saveUserTokens(uid, email, tokens.refresh_token, (tokens.scope || '').split(' '));
  functions.logger.info('[completarAuthGmail] OK', { uid, email });
  return { ok: true, email };
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 7 — estadoGmail
//  Devuelve si el usuario tiene Gmail conectado y con qué email.
// ════════════════════════════════════════════════════════════════════════════
exports.estadoGmail = functions
  .runWith({ timeoutSeconds: 10, memory: '128MB' })
  .https.onCall(async (data, context) => {
  const uid = context.auth && context.auth.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const t = await getUserTokens(uid);
  if (!t || !t.refreshToken) return { connected: false };
  return {
    connected  : true,
    email      : t.email,
    scopes     : t.scopes || [],
    connectedAt: t.connectedAt && t.connectedAt.toMillis ? t.connectedAt.toMillis() : null
  };
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 8 — desconectarGmail
//  Revoca el refresh_token en Google y borra el doc de users_gmail.
// ════════════════════════════════════════════════════════════════════════════
exports.desconectarGmail = functions
  .runWith({ timeoutSeconds: 15, memory: '128MB' })
  .https.onCall(async (data, context) => {
  const uid = context.auth && context.auth.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  functions.logger.info('[desconectarGmail] BEGIN', { uid });
  const t = await getUserTokens(uid);
  if (!t) return { ok: true, alreadyDisconnected: true };

  try {
    const oauth2 = newOAuthClient();
    await oauth2.revokeToken(t.refreshToken);
    functions.logger.info('[desconectarGmail] token revocado en Google', { uid });
  } catch (e) {
    // Si la revocación falla, igual borramos el doc local — el usuario ya
    // pidió desconectar.
    functions.logger.warn('[desconectarGmail] revoke falló (igualmente borro doc local)', {
      uid, message: e.message
    });
  }
  await deleteUserTokens(uid);
  functions.logger.info('[desconectarGmail] OK', { uid });
  return { ok: true };
});
