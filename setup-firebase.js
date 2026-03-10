#!/usr/bin/env node
// ============================================================
//  CERTIMAR — Script de migración: Apps Script → Firebase
//  Ejecutar desde la raíz del proyecto:
//    node setup-firebase.js
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname);
const HTML_SRC = path.join(ROOT, 'Index.html');
const CONC_SRC = path.join(ROOT, 'ConcesionesData.html');

// ─── Verificar prerequisitos ──────────────────────────────────────────────────
if (!fs.existsSync(HTML_SRC)) {
  console.error('❌  No se encontró Index.html en:', ROOT);
  process.exit(1);
}

console.log('🚀  Iniciando migración Certimar → Firebase…\n');

// ─── Crear estructura de directorios ─────────────────────────────────────────
['public', 'functions'].forEach(d => {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  console.log('📁  Directorio creado:', d);
});

// ════════════════════════════════════════════════════════════════════════════
//  firebase.json
// ════════════════════════════════════════════════════════════════════════════
write('firebase.json', JSON.stringify({
  hosting: {
    public : 'public',
    ignore : ['firebase.json', '**/.*', '**/node_modules/**'],
    rewrites: [{ source: '**', destination: '/index.html' }]
  },
  functions: { source: 'functions', runtime: 'nodejs18' },
  firestore: { rules: 'firestore.rules' },
  storage  : { rules: 'storage.rules' }
}, null, 2));

// ════════════════════════════════════════════════════════════════════════════
//  .firebaserc
// ════════════════════════════════════════════════════════════════════════════
write('.firebaserc', JSON.stringify({
  projects: { default: 'TU_FIREBASE_PROJECT_ID' }
}, null, 2));

// ════════════════════════════════════════════════════════════════════════════
//  firestore.rules
// ════════════════════════════════════════════════════════════════════════════
write('firestore.rules', `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Registros de visita — solo usuarios autenticados
    match /registros_visita/{docId} {
      allow read, write: if request.auth != null;
    }

    // Contadores correlativos — solo autenticados
    match /meta/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}`);

// ════════════════════════════════════════════════════════════════════════════
//  storage.rules
// ════════════════════════════════════════════════════════════════════════════
write('storage.rules', `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // PDFs — lectura pública (link directo), escritura solo autenticados
    match /certificados/{file} {
      allow read : if true;
      allow write: if request.auth != null
                   && request.resource.contentType == 'application/pdf'
                   && request.resource.size < 20 * 1024 * 1024;
    }

    // Fotos de evidencia
    match /fotos/{file} {
      allow read, write: if request.auth != null
                         && request.resource.size < 20 * 1024 * 1024;
    }
  }
}`);

// ════════════════════════════════════════════════════════════════════════════
//  .gitignore
// ════════════════════════════════════════════════════════════════════════════
write('.gitignore', `node_modules/
functions/node_modules/
functions/serviceAccount.json
.env
*.log
.firebase/
`);

// ════════════════════════════════════════════════════════════════════════════
//  functions/package.json
// ════════════════════════════════════════════════════════════════════════════
writeIn('functions', 'package.json', JSON.stringify({
  name   : 'certimar-functions',
  version: '1.0.0',
  engines: { node: '18' },
  main   : 'index.js',
  scripts: { serve: 'firebase emulators:start --only functions' },
  dependencies: {
    'firebase-admin'    : '^11.11.0',
    'firebase-functions': '^4.5.0',
    'node-fetch'        : '^2.7.0',
    'nodemailer'        : '^6.9.13'
  }
}, null, 2));

// ════════════════════════════════════════════════════════════════════════════
//  functions/index.js  — backend completo
// ════════════════════════════════════════════════════════════════════════════
writeIn('functions', 'index.js', `// ============================================================
//  CERTIMAR — Firebase Functions
//  Sheets: bridge via Apps Script doPost (sin service account)
//  Email:  Nodemailer + Gmail App Password
// ============================================================
'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');
const fetch      = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

// ─── Configuración ────────────────────────────────────────────────────────────
// Establecer con firebase functions:config:set:
//   mail.user        → email remitente
//   mail.pass        → App Password de Gmail
//   sheets.webhook   → URL del doPost de Apps Script
//   sheets.secret    → secret compartido con Code.gs
const cfg = () => ({
  mailUser      : (functions.config().mail   || {}).user    || 'operaciones@certimar.cl',
  mailPass      : (functions.config().mail   || {}).pass    || '',
  sheetsWebhook : (functions.config().sheets || {}).webhook || '',
  sheetsSecret  : (functions.config().sheets || {}).secret  || 'CERTIMAR_FB_2026',
  timezone      : 'America/Santiago'
});

// ─── Transporte de correo (Gmail App Password) ───────────────────────────────
function getTransporter() {
  const c = cfg();
  return nodemailer.createTransport({
    service: 'gmail',
    auth   : { user: c.mailUser, pass: c.mailPass }
  });
}

// ─── Bridge → Apps Script doPost ─────────────────────────────────────────────
// Apps Script actúa como proxy con permisos sobre la planilla.
// No requiere service account ni claves adicionales.
async function callSheetsWebhook(payload) {
  const c = cfg();
  if (!c.sheetsWebhook) {
    functions.logger.warn('sheets.webhook no configurado — se omite escritura en Sheets');
    return { ok: false, error: 'webhook no configurado' };
  }
  try {
    const res = await fetch(c.sheetsWebhook, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ ...payload, secret: c.sheetsSecret }),
      redirect: 'follow',    // Apps Script redirige antes de responder
      timeout : 30000
    });
    if (!res.ok) {
      const txt = await res.text();
      functions.logger.warn('Sheets webhook HTTP error:', res.status, txt.slice(0, 200));
      return { ok: false, error: \`HTTP \${res.status}\` };
    }
    const json = await res.json();
    functions.logger.info('Sheets webhook response:', json);
    return json;
  } catch (e) {
    functions.logger.error('Sheets webhook fetch error:', e.message);
    return { ok: false, error: e.message };
  }
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

// ─── Plantilla HTML del correo ────────────────────────────────────────────────
function plantillaEmail(datos, urlCert) {
  const resoluciones = buildResExt(datos.resoluciones) || '—';
  const linkBtn = urlCert
    ? \`<a href="\${urlCert}" style="display:inline-block;background:#003366;color:#fff;padding:13px 32px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;font-family:Arial,sans-serif">Ver Certificado →</a>\`
    : '';

  const filas = [
    ['N° Registro',      \`<strong style="color:#003366">\${datos.nroRegistro || '—'}</strong>\`],
    ['Fecha',             datos.fecha            || '—'],
    ['Centro de Cultivo', datos.centroCultivo    || '—'],
    ['N° Centro',         datos.nroCentro        || '—'],
    ['Titular',           datos.titular          || '—'],
    ['ACS',               datos.acs              || '—'],
    ['Responsable',       datos.nombreResponsable|| '—'],
    ['Tipo Observación',  datos.tipoObservacion  || '—'],
    ['Resoluciones',      resoluciones],
    ['Observaciones',     (datos.observaciones   || 'S/O').replace(/\\n/g, '<br>')]
  ].map((r, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f1f5f9';
    return \`<tr style="background:\${bg}">
      <td style="padding:9px 14px;font-weight:600;color:#64748b;font-size:13px;width:38%;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif">\${r[0]}</td>
      <td style="padding:9px 14px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif">\${r[1]}</td>
    </tr>\`;
  }).join('');

  return \`<!DOCTYPE html>
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
          Estimado(a) <strong>\${datos.nombreResponsable || 'Responsable'}</strong>,
        </p>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.65;font-family:Arial,sans-serif">
          Adjunto encontrará el Registro de Visita oficial del centro
          <strong style="color:#003366">\${datos.centroCultivo}</strong>
          con fecha <strong>\${datos.fecha}</strong>, emitido por Certimar SpA.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 32px 24px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          \${filas}
        </table>
      </td>
    </tr>
    \${urlCert ? \`<tr><td style="padding:4px 32px 28px;text-align:center">\${linkBtn}</td></tr>\` : ''}
    <tr><td style="background:#1e293b;padding:18px 32px;text-align:center">
      <p style="margin:0;color:#94a3b8;font-size:11px;font-family:Arial,sans-serif">
        Certimar SpA · operaciones@certimar.cl · +56 9 6115 6322
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>\`;
}

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 1 — registrarEnSheets
//  Guarda la fila en Sheets via webhook doPost de Apps Script
// ════════════════════════════════════════════════════════════════════════════
exports.registrarEnSheets = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  try {
    const { datos, urlCertificado } = data;
    if (!datos || !datos.nroRegistro) throw new Error('nroRegistro requerido');

    const result = await callSheetsWebhook({
      accion        : 'registrar',
      datos         : datos,
      urlCertificado: urlCertificado || ''
    });

    functions.logger.info('registrarEnSheets:', datos.nroRegistro, result);
    // Devolver ok:true aunque Sheets falle — Firestore ya tiene los datos
    return { ok: true, sheets: result };

  } catch (e) {
    functions.logger.error('registrarEnSheets ERROR:', e.message);
    return { ok: false, error: e.message };
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  FUNCIÓN 2 — enviarNotificacion
//  Envía correo + actualiza Firestore + actualiza Sheets (estado ENVIADO)
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

  // ─── 1. Enviar correo ─────────────────────────────────────────────────
  const asunto   = \`[Certimar] Registro de Visita – \${datos.centroCultivo} – \${datos.fecha}\`;
  const htmlBody = plantillaEmail(datos, urlCertificado || '');

  const mailOpts = {
    from   : \`"Certimar SpA" <\${c.mailUser}>\`,
    to     : destEmail,
    subject: asunto,
    html   : htmlBody,
    replyTo: c.mailUser
  };

  if (datos.emailCC  && datos.emailCC.trim())  mailOpts.cc  = datos.emailCC.trim();
  if (datos.emailCCO && datos.emailCCO.trim()) mailOpts.bcc = datos.emailCCO.trim();

  if (pdfB64) {
    const raw = pdfB64.replace(/^data:application\\/pdf;base64,/, '');
    mailOpts.attachments = [{
      filename   : \`CertimarRV_\${datos.nroRegistro}_\${(datos.centroCultivo||'').replace(/[^a-zA-Z0-9]/g,'_')}.pdf\`,
      content    : Buffer.from(raw, 'base64'),
      contentType: 'application/pdf'
    }];
  }

  const transporter = getTransporter();
  await transporter.sendMail(mailOpts);
  functions.logger.info('Correo enviado:', destEmail, datos.nroRegistro);

  // Copia interna al certificador (sin PDF)
  const certEmail = context.auth.token.email;
  if (certEmail && certEmail !== destEmail) {
    try {
      await transporter.sendMail({
        from: mailOpts.from, to: certEmail,
        subject: \`[COPIA INTERNA] \${asunto}\`, html: htmlBody
      });
    } catch (eCopia) {
      functions.logger.warn('Copia interna error (no fatal):', eCopia.message);
    }
  }

  // ─── 2. Actualizar Firestore ──────────────────────────────────────────
  try {
    await db.collection('registros_visita').doc(datos.nroRegistro).update({
      estado: 'ENVIADO', emailResponsable: destEmail
    });
  } catch (eFs) {
    functions.logger.warn('Firestore update error (no fatal):', eFs.message);
  }

  // ─── 3. Actualizar Sheets via webhook → accion: actualizarEnviado ─────
  try {
    await callSheetsWebhook({
      accion          : 'actualizarEnviado',
      nroRegistro     : datos.nroRegistro,
      emailDestinatario: destEmail,
      urlCertificado  : urlCertificado || ''
    });
  } catch (eSh) {
    functions.logger.warn('Sheets actualizarEnviado error (no fatal):', eSh.message);
  }

  return { ok: true };
});
`);

// (No se genera serviceAccount.json — la escritura en Sheets se hace via webhook de Apps Script)

// ════════════════════════════════════════════════════════════════════════════
//  public/firebaseConfig.js  (placeholder)
// ════════════════════════════════════════════════════════════════════════════
writeIn('public', 'firebaseConfig.js', `// ─── REEMPLAZA con tu configuración real ────────────────────────────────────
// Firebase Console → Project Settings → Your apps → SDK setup and configuration
const FIREBASE_CONFIG = {
  apiKey           : 'TU_API_KEY',
  authDomain       : 'TU_PROJECT.firebaseapp.com',
  projectId        : 'TU_PROJECT_ID',
  storageBucket    : 'TU_PROJECT.appspot.com',
  messagingSenderId: 'TU_SENDER_ID',
  appId            : 'TU_APP_ID'
};

// Emails con acceso de administrador
const ADMIN_EMAILS = [
  'admin@certimar.cl'
];
`);

// ════════════════════════════════════════════════════════════════════════════
//  public/404.html
// ════════════════════════════════════════════════════════════════════════════
writeIn('public', '404.html', `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>404 – Certimar</title>
  <style>body{font-family:sans-serif;text-align:center;padding:60px;color:#003366}h1{font-size:72px;margin:0}p{color:#64748b}</style>
</head>
<body>
  <h1>404</h1>
  <p>Página no encontrada</p>
  <a href="/" style="color:#003366">Volver al inicio</a>
</body>
</html>`);

// ════════════════════════════════════════════════════════════════════════════
//  Extraer ConcesionesData.html → public/concesiones.js
// ════════════════════════════════════════════════════════════════════════════
if (fs.existsSync(CONC_SRC)) {
  let conc = fs.readFileSync(CONC_SRC, 'utf8');
  // Quitar etiquetas <script> envolventes si las hay
  conc = conc.replace(/^[\s\S]*?<script[^>]*>/i, '').replace(/<\/script>[\s\S]*$/i, '');
  writeIn('public', 'concesiones.js', conc.trim());
  console.log('✅  public/concesiones.js generado desde ConcesionesData.html');
} else {
  writeIn('public', 'concesiones.js', `// Base de datos de concesiones
// Reemplazar con los datos reales de ConcesionesData.html
const CONCESIONES_DB = {};`);
  console.warn('⚠️   ConcesionesData.html no encontrado — public/concesiones.js creado vacío');
}

// ════════════════════════════════════════════════════════════════════════════
//  Transformar Index.html → public/index.html
// ════════════════════════════════════════════════════════════════════════════
console.log('\n📄  Transformando Index.html → public/index.html…');
let html = fs.readFileSync(HTML_SRC, 'utf8');

// Cada par: [buscar, reemplazar]
const REPLACEMENTS = [

  // ── 1. Agregar SDKs de Auth, Storage y Functions junto al de Firestore ──
  [
    `<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"></script>`,
    `<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-functions-compat.js"></script>`
  ],

  // ── 2. Reemplazar include de FirebaseConfig ──────────────────────────────
  [
    `<!-- Configuración Firebase del proyecto -->\n<?!= include('FirebaseConfig') ?>`,
    `<!-- Configuración Firebase del proyecto -->\n<script src="firebaseConfig.js"></script>`
  ],

  // ── 3. Reemplazar include de ConcesionesData ─────────────────────────────
  [
    `<?!= include('ConcesionesData') ?>`,
    `<script src="concesiones.js"></script>`
  ],

  // ── 4. Reemplazar bloque de splash + getUserInfo por Firebase Auth ───────
  [
    `  setTimeout(function() {
    document.getElementById('view-splash').style.opacity = '0';
    setTimeout(function() {
      document.getElementById('view-splash').style.display = 'none';
      google.script.run
        .withSuccessHandler(function(info) {
          if (info && info.ok && info.email) {
            currentUser = {
              email  : info.email,
              name   : info.name,
              isAdmin: (typeof ADMIN_EMAILS !== 'undefined') && ADMIN_EMAILS.includes(info.email)
            };
            showApp();
          } else {
            document.getElementById('view-login').classList.remove('hidden');
          }
        })
        .withFailureHandler(function() {
          document.getElementById('view-login').classList.remove('hidden');
        })
        .getUserInfo();
    }, 500);
  }, 2800);`,
    `  // Firebase Auth — detecta sesión activa automáticamente
  firebase.auth().onAuthStateChanged(function(user) {
    document.getElementById('view-splash').style.opacity = '0';
    setTimeout(function() {
      document.getElementById('view-splash').style.display = 'none';
      if (user) {
        var name = user.displayName ||
          user.email.split('@')[0].replace(/\\./g,' ').replace(/\\b\\w/g, function(c){ return c.toUpperCase(); });
        currentUser = {
          email  : user.email,
          name   : name,
          isAdmin: (typeof ADMIN_EMAILS !== 'undefined') && ADMIN_EMAILS.includes(user.email)
        };
        showApp();
      } else {
        document.getElementById('view-login').classList.remove('hidden');
      }
    }, 400);
  });`
  ],

  // ── 5. Reemplazar loginGoogle → Google Sign-In con Firebase Auth ─────────
  [
    `function loginGoogle() {
  showApp();
}`,
    `function loginGoogle() {
  var provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(function(e) {
    toast('Error al iniciar sesión: ' + e.message, 'error');
  });
}`
  ],

  // ── 6. Reemplazar fallback Apps Script en handleSyncGoogle ───────────────
  [
    `      nroGenerado = await new Promise(function(res, rej) {
        google.script.run
          .withSuccessHandler(function(n){ res(n || 'RV-' + new Date().getFullYear() + '-' + Date.now()); })
          .withFailureHandler(rej)
          ._generarNroRegistro();
      });`,
    `      // Reintentar Firestore una vez más
      nroGenerado = await fbGenerarNroRegistro();`
  ],

  // ── 7. Reemplazar drivePromise (Apps Script / Drive) → Firebase Storage ──
  [
    `    // Drive upload en background (no bloqueamos la escritura en Firestore ni en Sheets)
    var drivePromise = new Promise(function(resolve) {
      if (!pdfB64) { resolve(''); return; }
      google.script.run
        .withSuccessHandler(function(res) { resolve(res && res.ok ? (res.urlCertificado||'') : ''); })
        .withFailureHandler(function()   { resolve(''); })
        .guardarRegistro(datos, pdfB64, appState.fotoB64);
    });`,
    `    // Subir PDF a Firebase Storage
    var drivePromise = (async function() {
      if (!pdfB64) return '';
      try {
        var raw    = pdfB64.replace(/^data:application\\/pdf;base64,/, '');
        var bytes  = Uint8Array.from(atob(raw), function(c){ return c.charCodeAt(0); });
        var nombre = 'CertimarRV_' + datos.nroRegistro + '_' +
                     (datos.centroCultivo || '').replace(/\\s+/g,'_') + '.pdf';
        var ref    = firebase.storage().ref('certificados/' + nombre);
        await ref.put(bytes.buffer, { contentType: 'application/pdf' });
        var url = await ref.getDownloadURL();
        // Subir foto de evidencia si existe
        if (appState.fotoB64 && !appState.fotoB64.startsWith('data:application/pdf')) {
          try {
            var mt   = (appState.fotoB64.match(/^data:([^;]+);base64,/) || [])[1] || 'image/jpeg';
            var rawF = appState.fotoB64.replace(/^data:[^;]+;base64,/, '');
            var bytF = Uint8Array.from(atob(rawF), function(c){ return c.charCodeAt(0); });
            var ext  = mt.split('/')[1] || 'jpg';
            var refF = firebase.storage().ref('fotos/Foto_' + datos.nroRegistro + '.' + ext);
            await refF.put(bytF.buffer, { contentType: mt });
          } catch(eFoto) { console.warn('Foto upload error (no fatal):', eFoto); }
        }
        return url;
      } catch(eStorage) {
        console.error('Storage upload error:', eStorage);
        return '';
      }
    })()`
  ],

  // ── 8. Reemplazar registrarEnSheets (Apps Script) → Firebase Function ────
  [
    `    // 5. SIEMPRE registrar en Google Sheets (independiente de si Drive funcionó o no)
    await new Promise(function(resolve) {
      google.script.run
        .withSuccessHandler(function(res) {
          updateNotifStep('sync','step-sheets', res && res.ok ? 'done' : 'fail');
          resolve(res);
        })
        .withFailureHandler(function(e) {
          updateNotifStep('sync','step-sheets','fail');
          Logger && Logger.log && Logger.log('registrarEnSheets error: ' + e);
          resolve(null);
        })
        .registrarEnSheets(datos, urlCertificado);
    });`,
    `    // 5. Registrar en Google Sheets via Firebase Function
    await new Promise(function(resolve) {
      firebase.functions().httpsCallable('registrarEnSheets')({
        datos: datos, urlCertificado: urlCertificado
      }).then(function(res) {
        updateNotifStep('sync','step-sheets', res && res.data && res.data.ok ? 'done' : 'fail');
        resolve(res.data);
      }).catch(function(e) {
        updateNotifStep('sync','step-sheets','fail');
        console.error('registrarEnSheets error:', e);
        resolve(null);
      });
    });`
  ],

  // ── 9. Reemplazar enviarNotificacion en handleEnviarMail ─────────────────
  [
    `  google.script.run
    .withSuccessHandler(function(res) {
      setBtnLoading('btn-enviar-mail', false);
      if (res && res.ok) {
        updateNotifStep('mail-send','m2','done');
        updateNotifStep('mail-send','m3','done');
        setTimeout(function() {
          updateNotifCard('mail-send', 'success', '✉️ Correo enviado correctamente',
            'Para: ' + emailDest + (emailCC ? ' · CC: ' + emailCC : ''));
        }, 500);
        appState.sent = true;
        var nro = datos.nroRegistro;
        for (var i=0; i<localRecords.length; i++) {
          if (localRecords[i].nroReg === nro) {
            localRecords[i].estado = 'ENVIADO';
            localRecords[i].emailResp = emailDest;
            break;
          }
        }
        lockForm(true);
        showCompletionDialog(nro, true, emailDest);
      } else {
        updateNotifCard('mail-send', 'error', '❌ Error al enviar', res ? (res.error||'Error desconocido') : 'Sin respuesta del servidor');
        toast('Error al enviar: '+(res && res.error ? res.error : 'sin respuesta'),'error');
      }
    })
    .withFailureHandler(function(e) {
      setBtnLoading('btn-enviar-mail', false);
      updateNotifCard('mail-send', 'error', '❌ Error de conexión', String(e||'Verifica permisos del script'));
      toast('Error al enviar correo','error');
    })
    .enviarNotificacion(datos, appState.savedData ? appState.savedData.urlCert : '', appState.pdfB64);`,
    `  firebase.functions().httpsCallable('enviarNotificacion')({
    datos         : datos,
    urlCertificado: appState.savedData ? appState.savedData.urlCert : '',
    pdfB64        : appState.pdfB64
  }).then(function(result) {
    setBtnLoading('btn-enviar-mail', false);
    var res = result.data;
    if (res && res.ok) {
      updateNotifStep('mail-send','m2','done');
      updateNotifStep('mail-send','m3','done');
      setTimeout(function() {
        updateNotifCard('mail-send', 'success', '✉️ Correo enviado correctamente',
          'Para: ' + emailDest + (emailCC ? ' · CC: ' + emailCC : ''));
      }, 500);
      appState.sent = true;
      var nro = datos.nroRegistro;
      for (var i=0; i<localRecords.length; i++) {
        if (localRecords[i].nroReg === nro) {
          localRecords[i].estado = 'ENVIADO';
          localRecords[i].emailResp = emailDest;
          break;
        }
      }
      lockForm(true);
      showCompletionDialog(nro, true, emailDest);
    } else {
      updateNotifCard('mail-send', 'error', '❌ Error al enviar',
        res ? (res.error || 'Error desconocido') : 'Sin respuesta del servidor');
      toast('Error al enviar: ' + (res && res.error ? res.error : 'sin respuesta'), 'error');
    }
  }).catch(function(e) {
    setBtnLoading('btn-enviar-mail', false);
    updateNotifCard('mail-send', 'error', '❌ Error de conexión', String(e || 'Verifica configuración'));
    toast('Error al enviar correo', 'error');
  });`
  ],

  // ── 10. Reemplazar enviarNotificacion en handleCompletionEnviar ───────────
  [
    `  google.script.run
    .withSuccessHandler(function(res) {
      if (res && res.ok) {
        updateNotifCard('mail', 'success', '✉️ Correo enviado', 'Notificación enviada a ' + email);
        document.getElementById('cd-send-btn').textContent = '✓ Enviado';
        document.getElementById('cd-email-section').style.display = 'none';
        document.getElementById('cd-icon').textContent = '🎉';
        document.getElementById('cd-title').textContent = 'Registro Guardado y Notificado';
        document.getElementById('cd-sub').textContent = 'Correo enviado a ' + email + '.';
        appState.sent = true;
        lockForm(true);
        // Actualizar estado en Firestore
        var nro = get('r-nroRegistro');
        fbActualizarEstado(nro, 'ENVIADO', { emailResponsable: email }).catch(function(){});
        for (var i=0; i<localRecords.length; i++) {
          if (localRecords[i].nroReg === nro) { localRecords[i].estado = 'ENVIADO'; localRecords[i].emailResp = email; break; }
        }
      } else {
        updateNotifCard('mail', 'error', '❌ Error al enviar', res ? res.error : 'Reintenta');
        document.getElementById('cd-send-btn').disabled = false;
        document.getElementById('cd-send-btn').textContent = '✉️ Reintentar';
      }
    })
    .withFailureHandler(function(e) {
      updateNotifCard('mail', 'error', '❌ Error de conexión', String(e||''));
      document.getElementById('cd-send-btn').disabled = false;
      document.getElementById('cd-send-btn').textContent = '✉️ Reintentar';
    })
    .enviarNotificacion(datos, appState.savedData ? appState.savedData.urlCert : '', appState.pdfB64);`,
    `  firebase.functions().httpsCallable('enviarNotificacion')({
    datos         : datos,
    urlCertificado: appState.savedData ? appState.savedData.urlCert : '',
    pdfB64        : appState.pdfB64
  }).then(function(result) {
    var res = result.data;
    if (res && res.ok) {
      updateNotifCard('mail', 'success', '✉️ Correo enviado', 'Notificación enviada a ' + email);
      document.getElementById('cd-send-btn').textContent = '✓ Enviado';
      document.getElementById('cd-email-section').style.display = 'none';
      document.getElementById('cd-icon').textContent = '🎉';
      document.getElementById('cd-title').textContent = 'Registro Guardado y Notificado';
      document.getElementById('cd-sub').textContent = 'Correo enviado a ' + email + '.';
      appState.sent = true;
      lockForm(true);
      var nro = get('r-nroRegistro');
      fbActualizarEstado(nro, 'ENVIADO', { emailResponsable: email }).catch(function(){});
      for (var i=0; i<localRecords.length; i++) {
        if (localRecords[i].nroReg === nro) { localRecords[i].estado = 'ENVIADO'; localRecords[i].emailResp = email; break; }
      }
    } else {
      updateNotifCard('mail', 'error', '❌ Error al enviar', res ? res.error : 'Reintenta');
      document.getElementById('cd-send-btn').disabled = false;
      document.getElementById('cd-send-btn').textContent = '✉️ Reintentar';
    }
  }).catch(function(e) {
    updateNotifCard('mail', 'error', '❌ Error de conexión', String(e || ''));
    document.getElementById('cd-send-btn').disabled = false;
    document.getElementById('cd-send-btn').textContent = '✉️ Reintentar';
  });`
  ]
];

let countOK   = 0;
let countFail = 0;

for (const [search, replace] of REPLACEMENTS) {
  if (html.includes(search)) {
    html = html.split(search).join(replace);
    countOK++;
    console.log(`  ✓  ${replace.trim().slice(0, 72)}…`);
  } else {
    countFail++;
    console.warn(`  ⚠️   No encontrado: ${search.trim().slice(0, 72)}…`);
  }
}

writeIn('public', 'index.html', html);
console.log(`\n✅  public/index.html listo (${countOK} OK, ${countFail} no encontrados)\n`);

// ════════════════════════════════════════════════════════════════════════════
//  Instrucciones finales
// ════════════════════════════════════════════════════════════════════════════
console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              MIGRACIÓN COMPLETADA — PASOS SIGUIENTES                ║
╚══════════════════════════════════════════════════════════════════════╝

PASO 1 — Instalar Firebase CLI (si no está)
  npm install -g firebase-tools
  firebase login

PASO 2 — Vincular proyecto en .firebaserc
  Edita .firebaserc y reemplaza "TU_FIREBASE_PROJECT_ID"
  Obtén el ID en: Firebase Console → Project Settings

PASO 3 — Configurar public/firebaseConfig.js
  Copia los valores desde:
  Firebase Console → Project Settings → Your apps → SDK setup

PASO 4 — Habilitar Google Auth en Firebase Console
  Authentication → Sign-in method → Google → Habilitar

PASO 5 — Habilitar Firebase Storage
  Firebase Console → Storage → Get started (selecciona región)

PASO 6 — Publicar Apps Script como Web App (bridge para Google Sheets)
  Este proyecto NO usa Service Account. La escritura en Google Sheets
  se realiza mediante un webhook HTTP a tu Apps Script existente (Code.gs).

  a) Abre tu proyecto en script.google.com
  b) Asegúrate de que Code.gs incluye la función doPost (ya modificada)
  c) Menú → Implementar → Nueva implementación
       Tipo: Aplicación web
       Ejecutar como: Yo (la cuenta dueña de la planilla)
       Quién tiene acceso: Cualquier usuario
  d) Copia la URL de implementación. Tendrá este formato:
       https://script.google.com/macros/s/AKfycb.../exec
  e) Guarda esa URL — la necesitas en el PASO 8

PASO 7 — Instalar dependencias de Functions
  cd functions
  npm install
  cd ..

PASO 8 — Configurar variables de entorno
  firebase functions:config:set \\
    mail.user="operaciones@certimar.cl" \\
    mail.pass="APP_PASSWORD_DE_GMAIL" \\
    sheets.id="1Gq_8OBd75OnSzk9e6GXtOjhs8nhL9fKrlFzs_w4MezM" \\
    sheets.name="RV" \\
    sheets.webhook="https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec" \\
    sheets.secret="CERTIMAR_FB_2026"

  • sheets.webhook → URL obtenida en el PASO 6d
  • sheets.secret  → debe coincidir con WEBHOOK_SECRET en Code.gs
                     (ya configurado como 'CERTIMAR_FB_2026')

  Obtener App Password de Gmail:
  myaccount.google.com → Seguridad → Contraseñas de aplicación

PASO 9 — Deploy completo
  firebase deploy

  O por partes:
    firebase deploy --only hosting
    firebase deploy --only functions
    firebase deploy --only storage
    firebase deploy --only firestore:rules

PASO 10 — URL de tu app
  https://TU_PROJECT_ID.web.app

══════════════════════════════════════════════════════════════════════
  NOTAS IMPORTANTES
══════════════════════════════════════════════════════════════════════
• NO se requiere Service Account ni clave JSON — la escritura en Sheets
  se delega al Apps Script que ya tiene acceso a la planilla como dueño.
• Apps Script (Code.gs) debe estar publicado como Web App (PASO 6).
  Si re-implementas el script, actualiza sheets.webhook con la nueva URL.
• El secreto compartido (WEBHOOK_SECRET / sheets.secret) protege el
  endpoint de escritura contra llamadas no autorizadas.
• Para desarrollo local: firebase emulators:start
══════════════════════════════════════════════════════════════════════
`);

// ─── Utilidades ────────────────────────────────────────────────────────────────
function write(filename, content) {
  const fullPath = path.join(ROOT, filename);
  fs.writeFileSync(fullPath, content);
  console.log('✅  Creado:', filename);
}

function writeIn(dir, filename, content) {
  const fullPath = path.join(ROOT, dir, filename);
  fs.writeFileSync(fullPath, content);
  console.log('✅  Creado:', path.join(dir, filename));
}
