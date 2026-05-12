// ============================================================
//  CERTIMAR — Firebase Functions  (sin Google Sheets / Drive)
// ============================================================
'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const crypto     = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// ─── Envío de correo vía Apps Script ─────────────────────────────────────────
async function callAppsScript(datos, urlCertificado, internalCopy) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) throw new Error('APPS_SCRIPT_URL no configurada en functions/.env');

  functions.logger.info('[callAppsScript] URL:', url.slice(0, 80) + '...');
  functions.logger.info('[callAppsScript] dest:', datos.emailDestinatario, '| internalCopy:', internalCopy || 'none', '| urlCert:', urlCertificado ? urlCertificado.slice(0, 60) + '...' : '(vacía)');

  const payload = {
    secret        : 'CERTIMAR_FB_2026',
    accion        : 'enviarCorreo',
    datos,
    urlCertificado: urlCertificado || '',
    internalCopy  : internalCopy   || null
  };

  const res  = await fetch(url, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body    : JSON.stringify(payload),
    redirect: 'follow'
  });

  functions.logger.info('[callAppsScript] HTTP status:', res.status, res.statusText);
  functions.logger.info('[callAppsScript] URL final (tras redirects):', res.url);
  functions.logger.info('[callAppsScript] Content-Type respuesta:', res.headers.get('content-type'));
  const text = await res.text();
  functions.logger.info('[callAppsScript] Respuesta (primeros 1500 chars):', text.slice(0, 1500));

  let json;
  try { json = JSON.parse(text); } catch(_) {
    functions.logger.error('[callAppsScript] Respuesta no es JSON. Status:', res.status, '| URL final:', res.url, '| Body:', text.slice(0, 800));
    json = { ok: false, error: 'Apps Script retornó HTML en vez de JSON. Verifica el deployment del script.' };
  }
  if (!json.ok) throw new Error(json.error || 'Apps Script error');
  functions.logger.info('[callAppsScript] OK:', json);
  return json;
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
  const destEmail = datos && datos.emailDestinatario;

  if (!destEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'Email destinatario vacío.');
  }

  await callAppsScript(datos, urlCertificado || '', context.auth.token.email);
  functions.logger.info('Correo enviado a:', destEmail, '| Registro:', datos.nroRegistro);

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
//  FUNCIÓN 4 — procesarMailQueue
//  Escucha mail_queue/{docId} y envía el correo sin HTTP/CORS
// ════════════════════════════════════════════════════════════════════════════
exports.procesarMailQueue = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .firestore.document('mail_queue/{docId}')
  .onCreate(async (snap) => {

  const safeUpdate = (ref, data) => ref.update(data).catch(e => functions.logger.warn('Firestore update (no fatal):', e.message));

  await safeUpdate(snap.ref, { estado: 'PROCESANDO' });

  try {
    const { datos, urlCertificado } = snap.data();

    if (!datos || !datos.emailDestinatario) {
      await safeUpdate(snap.ref, { estado: 'ERROR', error: 'emailDestinatario vacío' });
      return;
    }

    await callAppsScript(datos, urlCertificado || '', datos.emailCertificador || null);
    functions.logger.info('procesarMailQueue enviado a:', datos.emailDestinatario);

    await safeUpdate(db.collection('registros_visita').doc(datos.nroRegistro), {
      estado          : 'ENVIADO',
      emailResponsable: datos.emailDestinatario
    });

    await safeUpdate(snap.ref, {
      estado    : 'ENVIADO',
      enviadoEn : admin.firestore.FieldValue.serverTimestamp()
    });

  } catch (e) {
    functions.logger.error('procesarMailQueue ERROR:', e.message);
    await safeUpdate(snap.ref, { estado: 'ERROR', error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 5 — migrarPDFsDrive  (TEMPORAL — eliminar post-migración)
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
