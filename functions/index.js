// ============================================================
//  CERTIMAR — Firebase Functions  v2
//  100% Firebase: identidad (Auth), datos (Firestore), archivos (Storage),
//  correo (Gmail API en el frontend). Estas Functions solo cubren la
//  firma de cliente por link. Sin dependencia de Google Apps Script.
// ============================================================
'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const crypto     = require('crypto');
const { tokenCoincide, normalizarNombre, esEmailValido, normalizarEmail } = require('./firmaHelpers');

admin.initializeApp();
const db = admin.firestore();

// ════════════════════════════════════════════════════════════════════════════
//  generarLinkFirma
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
//  getRegistroParaFirma — pública (sin auth), validada por token.
//  Devuelve solo los campos a mostrar en la página de firma.
// ════════════════════════════════════════════════════════════════════════════
exports.getRegistroParaFirma = functions
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .https.onCall(async (data) => {
    const nro   = data && data.nro;
    const token = data && data.token;
    if (!nro || !token) {
      throw new functions.https.HttpsError('invalid-argument', 'nro y token son requeridos.');
    }
    const snap = await db.collection('registros_visita').doc(nro).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registro no encontrado.');
    }
    const r = snap.data();
    if (!tokenCoincide(r.tokenFirma, token)) {
      throw new functions.https.HttpsError('permission-denied', 'Link de firma inválido o ya utilizado.');
    }
    if (r.estadoFirma === 'FIRMADO') {
      throw new functions.https.HttpsError('failed-precondition', 'Este registro ya fue firmado.');
    }
    return { ok: true, data: {
      nroRegistro     : r.nroRegistro || nro,
      fecha           : r.fecha || '',
      centroCultivo   : r.centroCultivo || '',
      nroCentro       : r.nroCentro || '',
      titular         : r.titular || '',
      acs             : r.acs || '',
      observaciones   : r.observaciones || '',
      nombreResponsable: r.nombreResponsable || '',
      emailResponsable : r.emailResponsable || ''
    }};
  });

// ════════════════════════════════════════════════════════════════════════════
//  procesarFirmaCliente
//  Verifica token, sube firma a Storage y actualiza Firestore
// ════════════════════════════════════════════════════════════════════════════
exports.procesarFirmaCliente = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {

  const { nro, firmaB64, token, nombre, email } = data;
  if (!nro || !firmaB64 || !token) {
    throw new functions.https.HttpsError('invalid-argument', 'nro, firmaB64 y token son requeridos.');
  }

  const docRef  = db.collection('registros_visita').doc(nro);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Registro no encontrado.');
  }
  if (!tokenCoincide(docSnap.data().tokenFirma, token)) {
    throw new functions.https.HttpsError('permission-denied', 'Token de firma inválido.');
  }

  const bucket   = admin.storage().bucket();
  const rawB64   = firmaB64.replace(/^data:image\/\w+;base64,/, '');
  const buffer   = Buffer.from(rawB64, 'base64');
  const filePath = `firmas/Firma_${nro}.png`;
  const file     = bucket.file(filePath);

  // URL de descarga estilo Firebase (con token), igual que getDownloadURL() del
  // frontend. Evita getSignedUrl, que requiere firmar con un service account
  // (rol "Token Creator") y falla en el emulador y a menudo en producción.
  const dlToken = crypto.randomUUID();
  await file.save(buffer, {
    contentType: 'image/png',
    metadata: { metadata: { firebaseStorageDownloadTokens: dlToken } }
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${dlToken}`;

  const update = {
    urlFirmaCliente: url,
    estadoFirma    : 'FIRMADO',
    tokenFirma     : ''
  };
  const nombreOk = normalizarNombre(nombre);
  if (nombreOk) update.nombreResponsable = nombreOk;
  if (esEmailValido(email)) update.emailResponsable = normalizarEmail(email);

  await docRef.update(update);

  functions.logger.info('procesarFirmaCliente OK:', nro);
  return { ok: true, urlFirmaCliente: url };
});
